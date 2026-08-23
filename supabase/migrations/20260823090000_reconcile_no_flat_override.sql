-- ============================================================
-- 입금 확인이 발행된 부과 금액을 덮어쓰지 않게 (2026-08-23)
--
-- 사고: 세션 147(8/23 에이트민턴)을 총액 45,000 · 9명 · 인당 5,000 으로 재발행했는데, 정산함에서
--   "8. 23. 에이트민턴 대관비 **6,000원**" 칩이 떴다. 두 곳이 정액을 하드코딩하고 있었다:
--     · 클라 `ReconcileInRow` 의 신규 세션 칩 금액 = `duesStore.courtFee`(= court_fee_default 6,000)
--     · 서버 `dues_confirm_reconcile` 의 `v_due := v_units * v_court`(같은 정액)
--   그리고 그 아래 `update ... where amount_due < v_due` 가 **기존 5,000 부과를 6,000 으로 올렸다.**
--   즉 칩을 확정하는 순간 재발행해 둔 엔빵 금액이 정액으로 덮인다.
--
-- 고침:
--   ① `dues_court_per_head(session)` — 그 회차의 **인당 금액 단일 소스**. NULL=정액 / 0 이하=무부과(null 반환)
--      / 0 초과=엔빵(10원 절상 + 정액 근처 스냅). 생성기와 같은 산식을 한 곳에 둔다.
--   ② `dues_confirm_reconcile` 이 정액 대신 그 함수를 쓴다.
--   ③ **기존 발행분의 금액을 올리는 UPDATE 를 제거**한다 — 발행된 금액은 사실이고, 바꿔야 하면
--      총액 변경(= 회차 정산 재시작, 20260823080000)으로 한다.
-- ============================================================

-- ① 인당 금액 단일 소스. 생성기(dues_generate_session_court)와 같은 산식.
create or replace function public.dues_court_per_head(p_session_id bigint)
returns int
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
	v_court int;
	v_total int;
	v_head int;
	v_per int;
begin
	select court_fee_default into v_court from public.dues_settings where id = 1;
	select coalesce(s.court_fee, r.court_fee) into v_total
	  from public.sessions s
	  left join public.recurring_schedules r on r.id = s.recurring_schedule_id
	 where s.id = p_session_id;

	if v_total is null then return v_court; end if;      -- 미입력 = 정액
	if v_total <= 0 then return null; end if;            -- 안 걷는 회차 → 부과할 금액이 없다

	select count(*) into v_head from public.dues_court_targets(p_session_id, true);
	if v_head = 0 then return null; end if;

	v_per := ceil(v_total::numeric / v_head / 10)::int * 10;   -- 10원 절상
	if v_per >= v_court and v_per < v_court + 200 then         -- 정액 근처면 정액으로(한방향)
		v_per := v_court;
	end if;
	return v_per;
end $function$;

revoke execute on function public.dues_court_per_head(bigint) from public, anon;
grant  execute on function public.dues_court_per_head(bigint) to authenticated;

comment on function public.dues_court_per_head(bigint) is
	'그 회차 대관비 인당 금액(단일 소스). NULL 총액=정액 / 0 이하=null(무부과) / 0 초과=엔빵(10원 절상 + '
	'정액 근처 스냅). 생성기와 입금 확인이 같은 값을 쓰게 한다. 2026-08-23.';

-- ② + ③ 입금 확인 — 라이브 정의를 그대로 받아 두 곳만 고쳤다(재타이핑 사고 방지).
CREATE OR REPLACE FUNCTION public.dues_confirm_reconcile(p_tx_id bigint, p_payer_member_id uuid, p_charge_ids bigint[], p_ym text, p_sessions jsonb)
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

	if v_total = 0 then raise exception 'nothing to allocate'; end if;

	insert into public.dues_audit_log (actor_member_id, action, bank_tx_id, detail)
	values (v_admin, 'confirm_reconcile', p_tx_id,
	        jsonb_build_object('payer', p_payer_member_id, 'charges', p_charge_ids, 'ym', p_ym, 'sessions', p_sessions, 'total', v_total));

	select is_guest into v_isguest from public.members where id = p_payer_member_id;
	if coalesce(v_isguest, true) = false then
		insert into public.notifications (recipient_member_id, type, session_id, payload)
		values (p_payer_member_id, 'payment_confirmed', null, null);
	end if;

	return jsonb_build_object('allocated', v_total);
end $function$;

revoke execute on function public.dues_confirm_reconcile(bigint, uuid, bigint[], text, jsonb) from public, anon;
grant  execute on function public.dues_confirm_reconcile(bigint, uuid, bigint[], text, jsonb) to authenticated;
