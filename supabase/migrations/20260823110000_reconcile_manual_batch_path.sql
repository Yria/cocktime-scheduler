-- ============================================================
-- 입금 확인에 '수동 부과 묶음에 사람 추가' 경로 추가 (2026-08-23)
--
-- 세 부과가 정산함에서 동등하지 않았다:
--   회비   — 기존 미납 칩 · **신규 생성 칩**(N월 회비) · 자동매칭
--   대관비 — 기존 미납 칩 · **신규 생성 칩**(세션 칩, p_sessions) · 자동매칭
--   수동   — 기존 미납 칩 · **없음** · 자동매칭(직전 커밋에서 추가)
-- 수동 부과의 '신규 생성'에 해당하는 것은 **"이 묶음에 이 사람 추가"** 다 — 회식 명단에서 빠진
-- 사람이 돈을 보낸 경우. 지금은 [부과] 탭에서 명단을 고치고 정산함으로 돌아와야 했다.
--
-- `p_batches`(`[{batch_key, member}]`)를 더해 **부과 생성 + 배분을 한 트랜잭션**으로 한다.
-- p_sessions 블록과 같은 모양이고, 금액은 **그 묶음의 인당 금액**을 기존 부과 행에서 가져온다
-- (정액 하드코딩 금지 — 대관비에서 그게 5,000을 6,000으로 덮은 사고였다, 20260823090000).
--
-- 라이브 정의를 pg_get_functiondef 로 받아 시그니처·선언·블록·감사만 패치했다(재타이핑 사고 방지).
-- ============================================================

-- 5인자 구버전 제거(호출부는 클라 하나뿐).
drop function if exists public.dues_confirm_reconcile(bigint, uuid, bigint[], text, jsonb);

CREATE OR REPLACE FUNCTION public.dues_confirm_reconcile(p_tx_id bigint, p_payer_member_id uuid, p_charge_ids bigint[], p_ym text, p_sessions jsonb, p_batches jsonb DEFAULT '[]'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
	v_admin   uuid := public.current_member_id();
	v_fee     int;
	v_court   int;
	v_isguest boolean;
	v_cid     bigint;
	v_owed    int;
	v_txrem   int;
	v_refund  int;
	v_alloc   int;
	v_status  text;
	v_hint    uuid;
	v_elem    jsonb;
	v_sid     bigint;
	v_units   int;
	v_member  uuid;
	v_due     int;
	v_bkey    text;
	v_blabel  text;
	v_bon     date;
	v_total   int := 0;
begin
	if not public.is_admin() then raise exception 'forbidden'; end if;
	if p_payer_member_id is null then raise exception 'payer required'; end if;
	if not exists (select 1 from public.bank_transactions where id = p_tx_id) then
		raise exception 'bank_tx % not found', p_tx_id;
	end if;
	select monthly_fee, court_fee_default into v_fee, v_court from public.dues_settings where id = 1;
	-- 이 입금에 연결된 환불 합계(잔여에서 차감).
	select coalesce(sum(amount), 0) into v_refund from public.bank_transactions where refund_of_tx_id = p_tx_id;

	-- ① 기존 미납 부과 배분(본인/대납/월무관) — waived/void·완납은 스킵.
	if p_charge_ids is not null then
		foreach v_cid in array p_charge_ids loop
			select status, amount_due - amount_paid into v_status, v_owed
				from public.dues_charges where id = v_cid;
			if v_status is null or v_status in ('waived','void') or coalesce(v_owed,0) <= 0 then
				continue;
			end if;
			select bt.amount - v_refund - coalesce((select sum(amount) from public.dues_allocations where bank_tx_id = p_tx_id), 0)
				into v_txrem from public.bank_transactions bt where bt.id = p_tx_id;
			v_alloc := least(v_owed, v_txrem);
			if v_alloc > 0 then
				insert into public.dues_allocations (bank_tx_id, charge_id, member_id, amount, kind, matched_by)
				values (p_tx_id, v_cid, p_payer_member_id, v_alloc, 'payment', v_admin);
				v_total := v_total + v_alloc;
			end if;
		end loop;
	end if;

	-- ② 회비 신규(납부자, 선택 시): 항목 없으면 생성 후 배분. (회비는 개인 귀속 — 납부자 본인만)
	if coalesce(p_ym, '') <> '' then
		if p_ym !~ '^\d{4}-\d{2}$' then raise exception 'invalid ym: %', p_ym; end if;
		insert into public.dues_charges (kind, member_id, period_ym, amount_due)
		values ('monthly_fee', p_payer_member_id, p_ym, v_fee)
		on conflict (member_id, period_ym) where period_ym is not null do nothing;
		select id, amount_due - amount_paid into v_cid, v_owed
			from public.dues_charges where member_id = p_payer_member_id and period_ym = p_ym and kind = 'monthly_fee'
			  and status not in ('waived','void');
		if v_cid is not null and coalesce(v_owed,0) > 0 then
			select bt.amount - v_refund - coalesce((select sum(amount) from public.dues_allocations where bank_tx_id = p_tx_id), 0)
				into v_txrem from public.bank_transactions bt where bt.id = p_tx_id;
			v_alloc := least(v_owed, v_txrem);
			if v_alloc > 0 then
				insert into public.dues_allocations (bank_tx_id, charge_id, member_id, amount, kind, matched_by)
				values (p_tx_id, v_cid, p_payer_member_id, v_alloc, 'payment', v_admin);
				v_total := v_total + v_alloc;
			end if;
		end if;
	end if;

	-- ③ 대관비 신규(선택된 세션·인원·대상 회원): 항목 없으면 생성 후 배분. member 미지정=납부자(하위호환).
	if p_sessions is not null and jsonb_typeof(p_sessions) = 'array' then
		for v_elem in select value from jsonb_array_elements(p_sessions) loop
			v_sid    := (v_elem->>'id')::bigint;
			v_units  := greatest(coalesce((v_elem->>'units')::int, 1), 1);
			v_member := coalesce(nullif(v_elem->>'member','')::uuid, p_payer_member_id);
			if not exists (select 1 from public.sessions where id = v_sid) then
				raise exception 'session % not found', v_sid;
			end if;
			if not exists (select 1 from public.members where id = v_member) then
				raise exception 'member % not found', v_member;
			end if;
			-- 그 세션의 **실제 인당 금액**을 쓴다(정액 하드코딩 금지). 엔빵 회차에서 정액을 넣으면
			-- 재발행해 둔 금액을 아래 UPDATE 가 덮어써 왔다(세션 147: 5,000 → 6,000). 20260823090000
			v_due := v_units * coalesce(public.dues_court_per_head(v_sid), v_court);
			-- 대상 회원이 게스트면 payer_hint=invited_by(대납 후보), 아니면 null(정산 대상은 charge.member_id).
			select case when mm.is_guest then a.invited_by else null end into v_hint
				from public.attendances a join public.members mm on mm.id = a.member_id
				where a.session_id = v_sid and a.member_id = v_member limit 1;
			insert into public.dues_charges (kind, member_id, session_id, amount_due, payer_hint)
			values ('court_fee', v_member, v_sid, v_due, v_hint)
			on conflict (member_id, session_id) where session_id is not null do nothing;
			-- **기존 발행분의 금액은 건드리지 않는다**(20260823020000 원칙). 종전에는 `amount_due < v_due`
			-- 로 올렸는데, 그게 엔빵 5,000 부과를 정액 6,000 으로 덮는 경로였다. 금액을 바꿔야 하면
			-- 총액 변경(dues_set_session_fee = 회차 정산 재시작)으로 한다.
			select id, amount_due - amount_paid into v_cid, v_owed
				from public.dues_charges where member_id = v_member and session_id = v_sid and kind = 'court_fee'
				  and status not in ('waived','void');
			if v_cid is not null and coalesce(v_owed,0) > 0 then
				select bt.amount - v_refund - coalesce((select sum(amount) from public.dues_allocations where bank_tx_id = p_tx_id), 0)
					into v_txrem from public.bank_transactions bt where bt.id = p_tx_id;
				v_alloc := least(v_owed, v_txrem);
				if v_alloc > 0 then
					insert into public.dues_allocations (bank_tx_id, charge_id, member_id, amount, kind, matched_by)
					values (p_tx_id, v_cid, p_payer_member_id, v_alloc, 'payment', v_admin);
					v_total := v_total + v_alloc;
				end if;
			end if;
		end loop;
	end if;

	-- ④ 수동 부과 묶음에 사람 추가 + 배분. 세션(③)과 같은 모양 — 회비·대관비만 '신규 생성' 경로를
	--    갖고 수동 부과는 없던 비대칭을 없앤다(회식 명단에서 빠진 사람이 돈을 보낸 경우).
	--    금액은 그 묶음의 인당 금액을 그대로 쓴다(정액 하드코딩 금지 — 대관비에서 그게 사고였다).
	if p_batches is not null and jsonb_typeof(p_batches) = 'array' then
		for v_elem in select value from jsonb_array_elements(p_batches) loop
			v_bkey   := v_elem->>'batch_key';
			v_member := coalesce(nullif(v_elem->>'member','')::uuid, p_payer_member_id);
			if coalesce(btrim(v_bkey), '') = '' then raise exception 'batch_key required'; end if;
			if not exists (select 1 from public.members where id = v_member) then
				raise exception 'member % not found', v_member;
			end if;
			-- 그 묶음의 인당 금액·이름·발생일을 기존 부과 행에서 가져온다(묶음이 곧 그 정보의 소유자).
			select min(c.amount_due), max(c.label), max(c.charged_on)
			  into v_due, v_blabel, v_bon
			  from public.dues_charges c
			 where c.kind = 'manual' and c.batch_key = v_bkey and c.status <> 'void';
			if v_due is null then raise exception 'batch % has no charges', v_bkey; end if;

			insert into public.dues_charges (kind, member_id, batch_key, label, charged_on, amount_due)
			values ('manual', v_member, v_bkey, v_blabel, v_bon, v_due)
			on conflict (member_id, batch_key) where batch_key is not null do nothing;

			select id, amount_due - amount_paid into v_cid, v_owed
				from public.dues_charges where member_id = v_member and batch_key = v_bkey and kind = 'manual'
				  and status not in ('waived','void');
			if v_cid is not null and coalesce(v_owed,0) > 0 then
				select bt.amount - v_refund - coalesce((select sum(amount) from public.dues_allocations where bank_tx_id = p_tx_id), 0)
					into v_txrem from public.bank_transactions bt where bt.id = p_tx_id;
				v_alloc := least(v_owed, v_txrem);
				if v_alloc > 0 then
					insert into public.dues_allocations (bank_tx_id, charge_id, member_id, amount, kind, matched_by)
					values (p_tx_id, v_cid, p_payer_member_id, v_alloc, 'payment', v_admin);
					v_total := v_total + v_alloc;
				end if;
			end if;
		end loop;
	end if;

	if v_total = 0 then raise exception 'nothing to allocate'; end if;

	insert into public.dues_audit_log (actor_member_id, action, bank_tx_id, detail)
	values (v_admin, 'confirm_reconcile', p_tx_id,
	        jsonb_build_object('payer', p_payer_member_id, 'charges', p_charge_ids, 'ym', p_ym, 'sessions', p_sessions, 'batches', p_batches, 'total', v_total));

	select is_guest into v_isguest from public.members where id = p_payer_member_id;
	if coalesce(v_isguest, true) = false then
		insert into public.notifications (recipient_member_id, type, session_id, payload)
		values (p_payer_member_id, 'payment_confirmed', null, null);
	end if;

	return jsonb_build_object('allocated', v_total);
end $function$;

revoke execute on function public.dues_confirm_reconcile(bigint, uuid, bigint[], text, jsonb, jsonb) from public, anon;
grant  execute on function public.dues_confirm_reconcile(bigint, uuid, bigint[], text, jsonb, jsonb) to authenticated;
