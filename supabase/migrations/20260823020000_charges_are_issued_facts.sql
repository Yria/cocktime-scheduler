-- ============================================================
-- 부과는 계산되는 값이 아니라 발행되는 문서다 (2026-08-23 재설계)
--
-- 문제: 부과가 **규칙의 계산 결과**였다. 참석 명단·총액이 바뀌면 다시 계산되고, 자동정리 DELETE 가
--   대상에서 빠진 행을 지웠다. 그래서 운영진이 손으로 고친 것이 다음 재실행에서 되살아나거나 사라졌고,
--   그걸 막으려고 `status<>'void'` 가드 · `amount_paid=0` 게이트가 세 경로에 복제됐다. 가드가 얽혀
--   "어떤 조작이 무엇을 되살리는지" 예측이 안 되는 상태였다.
--
-- 원칙: **`dues_charges` 에 행이 있으면 그것은 이미 발행된 사실이다.**
--   · 규칙은 **초안을 만드는 도구**일 뿐이다. 발행된 뒤에는 규칙이 그 행을 절대 건드리지 않는다
--     (금액 갱신도, 삭제도 하지 않는다).
--   · 발행분을 바꾸는 건 **명시적 조작만** — 취소(`dues_set_charge_status`), 금액 정정
--     (`dues_set_session_fee`), 추가 발행. 그 조작은 감사에 남고 규칙이 되돌리지 못한다.
--   · 그래서 발행 표식 컬럼이 필요 없다. `created_at` 이 곧 발행 시각이다.
--
-- 조건부 자동 발행(운영 결정 (c)): 초안이 평소와 같으면 자동 발행, 이상하면 **발행 대기**로 남겨
--   운영진이 보고 결정한다. 매 세션 클릭을 요구하지 않으면서 안전망을 하나 둔다.
--   대기 사유(court):
--     · amount_out_of_range — 인당 금액이 정액의 절반 미만 또는 2.5배 초과(총액 오타를 잡는다)
--     · new_members — 이미 발행된 묶음에 초안에만 있는 사람이 생겼다(추가 발행 후보)
--   **금액 차이는 대기 사유가 아니다.** 발행된 금액은 사실이고 규칙이 관여할 일이 아니다(정정은
--   `dues_set_session_fee` 같은 명시적 조작). 실측으로 확인: 세션 237 은 발행 6,000원(2026-08-18 운영
--   결정으로 고정)인데 지금 대상 20명으로 다시 계산하면 5,850원이 나온다 — 이걸 대기로 올리면 변화가
--   없는데도 매번 확인 요청이 뜬다. 금액 어긋남은 정산 대조 시트가 이미 보여준다.
--   대기 중인 초안은 회원에게 보이지 않는다(별 테이블이라 기존 읽기 경로가 볼 수 없다).
--
-- 이 마이그레이션이 없애는 것: `dues_generate_session_court` 의 **자동정리 DELETE 3경로**와
--   **기존 행 UPSERT 갱신**. 그 자리를 "없는 사람만 추가 발행"이 대신한다.
--   → 무자격 세션·사전취소 유령·엔빵↔정액 전환 고아는 이제 자동으로 지워지지 않는다.
--     운영진이 정산 대조 시트에서 [부과삭제](void)로 처리한다. **삭제가 아니라 취소여야 한다** —
--     지우면 다음 재실행에서 '없는 사람'으로 보여 다시 발행된다(취소는 행이 남아 재발행을 막는다).
-- ============================================================

-- ① 발행 대기 초안 — 파생값이 사는 곳. 언제든 다시 계산·폐기해도 무해하다.
--    묶음 키는 `dues_charge_drafts.draft_group`('court:228', 'monthly:2026-08') — batch_key 와 같은 관례.
create table if not exists public.dues_charge_drafts (
	id           bigserial primary key,
	draft_group  text not null,                                    -- '{kind}:{scope}' 발행 단위
	kind         text not null check (kind in ('monthly_fee','court_fee','manual')),
	-- 발행 시 dues_charges 로 그대로 옮겨질 값들(묶음 축은 기존 3축과 동일)
	period_ym    text,
	session_id   bigint references public.sessions(id) on delete cascade,
	batch_key    text,
	label        text,
	charged_on   date,
	member_id    uuid not null references public.members(id) on delete cascade,
	amount_due   integer not null,
	payer_hint   uuid references public.members(id) on delete set null,
	is_day_cancel boolean not null default false,
	-- 왜 대기인가(묶음 단위로 같은 값이 복제된다 — label 과 같은 성격의 스냅샷)
	hold_reason  text not null,
	hold_detail  jsonb,
	created_at   timestamptz not null default now(),
	unique (draft_group, member_id)
);
create index if not exists idx_draft_group on public.dues_charge_drafts(draft_group);

comment on table public.dues_charge_drafts is
	'발행 대기 부과 초안. 규칙이 만든 파생값이라 언제든 재계산·폐기 가능하고 회원에게 보이지 않는다. '
	'발행(dues_issue_drafts)되면 dues_charges 로 옮겨지고 여기서 사라진다. 2026-08-23.';

alter table public.dues_charge_drafts enable row level security;
-- 운영진만 열람(회원에게 보이면 '아직 안 걷기로 한 돈'이 미납처럼 읽힌다).
drop policy if exists drafts_admin_select on public.dues_charge_drafts;
create policy drafts_admin_select on public.dues_charge_drafts
	for select to authenticated using (public.is_admin());

-- ============================================================
-- ② 세션 대관비 — 초안 계산 → (정상) 없는 사람만 추가 발행 / (이상) 대기
--    발행분은 읽기만 한다. 갱신·삭제 없음.
-- ============================================================
create or replace function public.dues_generate_session_court(p_session_id bigint)
returns int
language plpgsql
security definer
set search_path to ''
as $function$
declare
	v_court int;          -- 정액 기본(6천). 스냅 기준점 + 이상 판정 기준
	v_total int;          -- 엔빵 총액 = coalesce(세션, 규칙). NULL=정액, <=0=무부과, >0=엔빵
	v_eligible boolean;
	v_head int;           -- 엔빵 분모 = 부과 대상 수
	v_per int;            -- 인당 금액
	v_split boolean;
	v_group text := 'court:' || p_session_id::text;
	v_issued int;         -- 이미 발행된(살아있는) 부과 수
	v_new int := 0;       -- 이번에 추가 발행한 수
	v_diff int;           -- 초안에만 있는 사람 수(= 추가 발행 후보). 금액 차이는 세지 않는다.
	v_head_all int;       -- 초안 인원(정액 모드에선 v_head 를 안 쓰므로 별도로 센다)
	v_hold text;
begin
	select court_fee_default into v_court from public.dues_settings where id = 1;

	select (p.charges_court_fee
	        and s.status in ('active','closed')
	        and s.scheduled_at is not null
	        and exists (select 1 from public.matches mt where mt.session_id = s.id)),
	       coalesce(s.court_fee, r.court_fee)
	  into v_eligible, v_total
	from public.sessions s
	left join public.places p on p.id = s.place_id
	left join public.recurring_schedules r on r.id = s.recurring_schedule_id
	where s.id = p_session_id;

	-- 무자격(무산·비대관장소) 또는 무부과(총액 0 이하, 20260823000000) → 발행할 것이 없다.
	-- **이미 발행된 부과를 지우지 않는다.** 잘못 나간 게 있으면 운영진이 취소(void)한다 —
	-- 규칙이 발행분을 지우면 그게 바로 "튀어나오는" 문제의 뿌리였다.
	if v_eligible is not true or v_total <= 0 then
		delete from public.dues_charge_drafts where draft_group = v_group;
		return 0;
	end if;

	v_split := (v_total is not null and v_total > 0);
	if v_split then
		select count(*) into v_head from public.dues_court_targets(p_session_id, true);
		if v_head = 0 then
			delete from public.dues_charge_drafts where draft_group = v_group;
			return 0;
		end if;
		v_per := ceil(v_total::numeric / v_head / 10)::int * 10;      -- 10원 절상
		if v_per >= v_court and v_per < v_court + 200 then            -- 정액 근처면 정액으로(한방향)
			v_per := v_court;
		end if;
	else
		v_per := v_court;
	end if;

	-- 초안은 `dues_court_targets` 를 그대로 다시 부른다(stable 함수). 임시 테이블을 쓰지 않는 이유:
	-- 세션 두 개가 한 트랜잭션에서 종료되면 트리거가 두 번 돌아 `create temp table` 이 충돌한다.
	select count(*) into v_head_all from public.dues_court_targets(p_session_id, v_split);

	select count(*) into v_issued
	  from public.dues_charges
	 where kind = 'court_fee' and session_id = p_session_id and status <> 'void';

	-- 초안에만 있는 사람(= 아직 발행 안 된 사람). void 된 행도 '있는 것'으로 세므로
	-- 취소한 부과가 되살아나지 않는다.
	select count(*) into v_diff
	  from public.dues_court_targets(p_session_id, v_split) d
	 where not exists (
	   select 1 from public.dues_charges c
	    where c.kind = 'court_fee' and c.session_id = p_session_id and c.member_id = d.member_id);

	-- 발행 안 된 사람이 없으면 할 일이 없다(재실행 완전 무해 — 이게 멱등의 새 정의).
	if v_diff = 0 then
		delete from public.dues_charge_drafts where draft_group = v_group;
		return 0;
	end if;

	-- ── 이상 판정 ──
	--  ① 인당 금액이 정액의 절반 미만 / 2.5배 초과 → 총액 오타(0 하나 더/덜)를 잡는다
	--  ② 이미 발행된 묶음에 새 사람이 붙는다 → 규칙이 조용히 늘리지 않고 사람이 결정한다
	--     (세션 237 손형일처럼 뒤늦게 보드 추가분이 드러나는 경우)
	if v_per * 2 < v_court or v_per > v_court * 5 / 2 then
		v_hold := 'amount_out_of_range';
	elsif v_issued > 0 then
		v_hold := 'new_members';
	end if;

	if v_hold is not null then
		delete from public.dues_charge_drafts where draft_group = v_group;
		insert into public.dues_charge_drafts
			(draft_group, kind, session_id, label, charged_on, member_id, amount_due, payer_hint, is_day_cancel, hold_reason, hold_detail)
		select v_group, 'court_fee', p_session_id,
		       to_char((s.scheduled_at at time zone 'Asia/Seoul')::date, 'MM/DD') || ' ' || coalesce(p.name, '대관') || ' 대관비',
		       (s.scheduled_at at time zone 'Asia/Seoul')::date,
		       d.member_id, v_per, d.payer_hint, d.is_day_cancel,
		       v_hold,
		       jsonb_build_object('per_head', v_per, 'flat', v_court, 'total', v_total,
		                          'head', v_head_all, 'already_issued', v_issued)
		  from public.dues_court_targets(p_session_id, v_split) d
		  cross join public.sessions s
		  left join public.places p on p.id = s.place_id
		 where s.id = p_session_id
		   and not exists (
		     select 1 from public.dues_charges c
		      where c.kind = 'court_fee' and c.session_id = p_session_id and c.member_id = d.member_id);
		return 0;
	end if;

	-- ── 정상: 없는 사람만 추가 발행. 기존 행은 금액도 상태도 건드리지 않는다. ──
	insert into public.dues_charges (kind, member_id, session_id, amount_due, payer_hint, is_day_cancel)
	select 'court_fee', d.member_id, p_session_id, v_per, d.payer_hint, d.is_day_cancel
	  from public.dues_court_targets(p_session_id, v_split) d
	on conflict (member_id, session_id) where session_id is not null
	do nothing;   -- 기존 행은 금액도 상태도 그대로 둔다
	get diagnostics v_new = row_count;

	delete from public.dues_charge_drafts where draft_group = v_group;
	return v_new;
end $function$;

revoke execute on function public.dues_generate_session_court(bigint) from public, anon, authenticated;

comment on function public.dues_generate_session_court(bigint) is
	'세션 대관비 초안 계산 → 정상이면 없는 사람만 추가 발행, 이상하면 dues_charge_drafts 에 대기. '
	'**발행분(dues_charges 행)은 갱신·삭제하지 않는다** — 발행된 부과는 사실이고 규칙이 못 건드린다. '
	'총액: NULL=정액 / 0 이하=무부과 / 0 초과=엔빵. 2026-08-23 재설계.';

-- ============================================================
-- ③ 대기 초안 발행 / 폐기 (운영진)
-- ============================================================
create or replace function public.dues_issue_drafts(p_group text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
	v_admin uuid := public.current_member_id();
	v_n int := 0;
	v_head int;
begin
	if not public.is_admin() then raise exception 'forbidden'; end if;
	select count(*) into v_head from public.dues_charge_drafts where draft_group = p_group;
	if v_head = 0 then raise exception 'no drafts for %', p_group; end if;

	-- 초안 → 발행. 이미 발행된 사람은 건너뛴다(금액 정정은 별도 조작).
	insert into public.dues_charges
		(kind, member_id, period_ym, session_id, batch_key, label, charged_on, amount_due, payer_hint, is_day_cancel)
	select d.kind, d.member_id, d.period_ym, d.session_id, d.batch_key, d.label, d.charged_on,
	       d.amount_due, d.payer_hint, d.is_day_cancel
	  from public.dues_charge_drafts d
	 where d.draft_group = p_group
	on conflict do nothing;
	get diagnostics v_n = row_count;

	insert into public.dues_audit_log (actor_member_id, action, detail)
	values (v_admin, 'issue_drafts', jsonb_build_object(
		'group', p_group, 'drafts', v_head, 'issued', v_n,
		'hold_reason', (select max(hold_reason) from public.dues_charge_drafts where draft_group = p_group)));

	delete from public.dues_charge_drafts where draft_group = p_group;
	return jsonb_build_object('issued', v_n, 'skipped', v_head - v_n);
end $function$;

revoke execute on function public.dues_issue_drafts(text) from public, anon;
grant  execute on function public.dues_issue_drafts(text) to authenticated;

create or replace function public.dues_discard_drafts(p_group text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
	v_admin uuid := public.current_member_id();
	v_n int := 0;
begin
	if not public.is_admin() then raise exception 'forbidden'; end if;
	insert into public.dues_audit_log (actor_member_id, action, detail)
	select v_admin, 'discard_drafts', jsonb_build_object(
		'group', p_group, 'drafts', count(*), 'hold_reason', max(hold_reason),
		'members', jsonb_agg(jsonb_build_object('member', member_id, 'due', amount_due)))
	  from public.dues_charge_drafts where draft_group = p_group;
	delete from public.dues_charge_drafts where draft_group = p_group;
	get diagnostics v_n = row_count;
	return jsonb_build_object('discarded', v_n);
end $function$;

revoke execute on function public.dues_discard_drafts(text) from public, anon;
grant  execute on function public.dues_discard_drafts(text) to authenticated;

-- ============================================================
-- ④ 금액 정정 — 사람이 부르는 명시적 조작. 발행분을 고칠 수 있는 **유일한 금액 경로**.
--
--    새 모델에서 규칙(생성기)은 발행된 금액을 건드리지 않는다. 그래서 "종료 후에 실제 총액을 알게 됐다"
--    같은 정상적인 정정을 할 곳이 필요하다. 그게 이 RPC 다(종전 정의는 생성기를 불러 UPSERT 갱신에
--    의존했는데, 그 갱신이 사라졌으므로 정정을 여기서 직접 한다).
--
--    · 미납(amount_paid=0)·살아있는(status<>'void') 부과만 금액을 바꾼다.
--      납부분을 소급 변경하면 이미 받은 돈과 부과가 어긋난다 — 그건 환불/추가징수의 영역이다.
--    · 대상 인원 변화는 건드리지 않는다(추가 발행은 생성기 → 대기 → [발행] 경로).
-- ============================================================
create or replace function public.dues_set_session_fee(p_session_id bigint, p_amount integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
	v_admin uuid := public.current_member_id();
	v_court int;
	v_head int;
	v_per int;
	v_fixed int := 0;
	v_locked int := 0;
begin
	if not public.is_admin() then raise exception 'forbidden'; end if;
	if p_amount is not null and p_amount < 0 then raise exception 'invalid amount'; end if;

	update public.sessions set court_fee = p_amount where id = p_session_id;
	if not found then raise exception 'session % not found', p_session_id; end if;

	select court_fee_default into v_court from public.dues_settings where id = 1;

	-- 새 인당 금액(생성기와 같은 산식). 총액 NULL=정액 / 0 이하=무부과(정정 대상 없음) / >0=엔빵.
	if p_amount is null then
		v_per := v_court;
	elsif p_amount <= 0 then
		v_per := null;   -- 안 걷는 회차 → 금액 정정이 아니라 취소(void)로 처리할 일
	else
		select count(*) into v_head from public.dues_court_targets(p_session_id, true);
		if v_head = 0 then
			v_per := null;
		else
			v_per := ceil(p_amount::numeric / v_head / 10)::int * 10;
			if v_per >= v_court and v_per < v_court + 200 then v_per := v_court; end if;
		end if;
	end if;

	if v_per is not null then
		update public.dues_charges
		   set amount_due = v_per, updated_at = now()
		 where kind = 'court_fee' and session_id = p_session_id
		   and status <> 'void' and amount_paid = 0 and amount_due <> v_per;
		get diagnostics v_fixed = row_count;

		-- 이미 낸 사람은 금액을 못 바꾼다 → 몇 건인지 알려주고 운영진이 환불/추가징수로 처리하게 한다.
		select count(*) into v_locked
		  from public.dues_charges
		 where kind = 'court_fee' and session_id = p_session_id
		   and status <> 'void' and amount_paid > 0 and amount_due <> v_per;
	end if;

	insert into public.dues_audit_log (actor_member_id, action, detail)
	values (v_admin, 'set_session_fee', jsonb_build_object(
		'session_id', p_session_id, 'amount', p_amount,
		'per_head', v_per, 'head', v_head, 'fixed', v_fixed, 'locked', v_locked));

	return jsonb_build_object('court_fee', p_amount, 'per_head', v_per, 'fixed', v_fixed, 'locked', v_locked);
end $function$;

revoke execute on function public.dues_set_session_fee(bigint, integer) from public, anon;
grant  execute on function public.dues_set_session_fee(bigint, integer) to authenticated;

comment on function public.dues_set_session_fee(bigint, integer) is
	'세션 대관 총액 저장 + 미납 발행분 금액 정정(납부분·void 는 보존). 새 모델에서 발행분 금액을 '
	'바꿀 수 있는 유일한 경로 — 규칙(생성기)은 발행된 금액을 건드리지 않는다. 2026-08-23.';
