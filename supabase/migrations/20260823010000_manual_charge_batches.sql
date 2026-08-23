-- ============================================================
-- 수동 부과(회식 엔빵·공동구매 등) — dues_charges 의 세 번째 묶음 축
--
-- 배경: 부과의 "묶음"은 지금까지 **이미 존재하는 실체**를 가리키는 컬럼 하나로 표현됐다.
--   · 회비   = `period_ym` ('2026-08' 문자열. 실체 행이 없는 semantic key)
--   · 대관비 = `session_id` (sessions 행이 곧 묶음)
--   둘 다 **대상 명단을 언제든 다시 계산할 수 있어서**(회원 룰 / attendances ∪ session_players)
--   "그때 누구를 골랐나"를 저장할 필요가 없었다. 그게 멱등 재실행의 원천이다.
--
-- 회식·공동구매는 여기서 깨진다: 대상이 **운영진이 손으로 고른 명단**이라 파생 불가능하고
--   (식사 체크는 기본 후보일 뿐 — 체크하고 안 간 사람/안 하고 간 사람이 매번 생긴다),
--   금액 근거(총액)도 어디에도 적혀 있지 않다.
--
-- 결정: **새 테이블을 만들지 않는다.** 회비의 `period_ym` 과 똑같이 semantic key 를 하나 더 둔다.
--   · `batch_key` = 묶음 키. 관례 `'{type}:{scope}'` — 예 `meal:228`(정모 228 회식), `cock:2026-08`.
--                    같은 키로 다시 부르면 그 묶음을 **갱신**한다(멱등). 클라 헬퍼가 만든다.
--   · `label`     = 사람이 볼 이름("8/22 정모 회식"). 부과 행에 스냅샷으로 복제된다 —
--                    `amount_due` 가 정책 스냅샷인 것과 같은 성격이다.
--   · `charged_on`= 발생일(월 귀속). 회비는 period_ym, 대관비는 세션 날짜가 월을 정하는데
--                    수동 부과는 그 근거가 없어서 명시한다.
--   총액은 저장하지 않는다 — 부과합은 `sum(amount_due)` 로 언제든 나오고, 원래 총액과의 차액은
--   만들 때 화면이 보여주는 값이다(splitAmount.diff). 나중에 배치 단위 조작이 더 필요해지면
--   `batch_key` → 별도 테이블의 `batch_id` 로 승격하면 된다.
--
-- **기존 부과 경로는 한 줄도 건드리지 않는다.** 회비·대관비의 `on conflict (member_id, period_ym)` /
--   `(member_id, session_id)` 절과 유니크 인덱스가 그대로다 — 유니크에 kind 를 끼우는 대안은
--   `dues_generate_session_court` 등 라이브 함수 4개를 전부 재작성해야 해서(사고 이력 최다 코드)
--   테이블 하나 아끼려고 위험을 옮기는 거래가 된다.
--
-- 공개 회계(dues_public_ledger)는 수정 불필요: 회비/대관비만 명시 조인(`kind='monthly_fee'|'court_fee'`)
--   하고 나머지 입금은 카테고리 또는 미분류로 흘러가므로 "항목 순액 합 = 남은 돈" 불변식이 유지된다.
--   수동 부과에 배분된 입금은 그 거래에 카테고리를 지정하면 그 항목으로, 안 하면 미분류로 잡힌다
--   (지금 콕 공동구매를 처리하는 방식과 동일).
-- ============================================================

-- ① 컬럼
alter table public.dues_charges
	add column if not exists batch_key  text,
	add column if not exists label      text,
	add column if not exists charged_on date;

comment on column public.dues_charges.batch_key is
	'수동 부과 묶음 키. 관례 ''{type}:{scope}'' (meal:228, cock:2026-08). kind=''manual'' 전용, period_ym/session_id 와 XOR. 2026-08-23.';
comment on column public.dues_charges.label is
	'수동 부과 표시 이름("8/22 정모 회식"). 같은 배치의 모든 행에 복제되는 스냅샷. 2026-08-23.';
comment on column public.dues_charges.charged_on is
	'수동 부과 발생일(KST date) — 월 귀속 기준. 회비=period_ym, 대관비=세션일 에 대응. 2026-08-23.';

-- ② kind 세 번째 값. 종류(회식·공동구매…)는 batch_key 의 type 접두와 label 이 구분한다 —
--    kind 를 늘리면 이걸 분기하는 함수·화면이 전부 따라 늘어난다.
alter table public.dues_charges drop constraint if exists dues_charges_kind_check;
alter table public.dues_charges add constraint dues_charges_kind_check
	check (kind in ('monthly_fee','court_fee','manual'));

-- ③ 묶음 축 XOR — 정확히 하나.
alter table public.dues_charges drop constraint if exists dues_charge_period_xor;
alter table public.dues_charges add constraint dues_charge_period_xor
	check ((period_ym is not null)::int + (session_id is not null)::int + (batch_key is not null)::int = 1);

-- ④ manual 의 모양 강제: kind='manual' ⇔ batch_key 있음, 그리고 batch_key 가 있으면 label·charged_on 필수.
--    (라벨 없는 배치는 회원 화면에서 이름 없는 미납으로 뜬다 — DB 에서 막는다.)
alter table public.dues_charges drop constraint if exists dues_charge_manual_shape;
alter table public.dues_charges add constraint dues_charge_manual_shape
	check (
		((kind = 'manual') = (batch_key is not null))
		and (batch_key is null or (label is not null and charged_on is not null))
	);

-- ⑤ 멱등 키 + 조회 인덱스
create unique index if not exists uq_charge_batch
	on public.dues_charges(member_id, batch_key) where batch_key is not null;
create index if not exists idx_charge_batch      on public.dues_charges(batch_key);
create index if not exists idx_charge_charged_on on public.dues_charges(charged_on);

-- ============================================================
-- ⑥ 배치 생성·갱신 RPC — 같은 batch_key 로 다시 부르면 명단·금액을 맞춘다(멱등).
--    회비/대관비 생성기와 같은 규칙: UPSERT 는 `amount_paid = 0` 게이트, 명단에서 빠진 사람의
--    미납만 삭제하고 **납부분과 void 는 보존**한다.
-- ============================================================
create or replace function public.dues_upsert_manual_batch(
	p_batch_key  text,
	p_label      text,
	p_charged_on date,
	p_amount     integer,
	p_member_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
	v_admin   uuid := public.current_member_id();
	v_charged int := 0;
	v_removed int := 0;
	v_locked  int := 0;
begin
	if not public.is_admin() then raise exception 'forbidden'; end if;
	if coalesce(btrim(p_batch_key), '') = '' then raise exception 'batch_key required'; end if;
	if coalesce(btrim(p_label), '')     = '' then raise exception 'label required'; end if;
	if p_charged_on is null                  then raise exception 'charged_on required'; end if;
	if p_amount is null or p_amount <= 0     then raise exception 'amount must be > 0'; end if;
	if p_member_ids is null or array_length(p_member_ids, 1) is null then raise exception 'no members'; end if;

	-- 모르는 회원이 섞이면 거부한다. 조용히 빼면 화면이 보여준 명단과 실제 부과가 갈린다.
	if exists (
		select 1 from unnest(p_member_ids) x(id)
		where not exists (select 1 from public.members m where m.id = x.id)
	) then
		raise exception 'unknown member in list';
	end if;

	insert into public.dues_charges (kind, member_id, batch_key, label, charged_on, amount_due, payer_hint)
	select 'manual', m.id, btrim(p_batch_key), btrim(p_label), p_charged_on, p_amount,
	       -- 게스트는 계정이 없어 스스로 못 낸다 → 가장 최근에 데려온 회원을 대납자로(대관비와 같은 모델).
	       case when m.is_guest then (
	           select a.invited_by from public.attendances a
	            where a.member_id = m.id and a.invited_by is not null
	            order by a.requested_at desc limit 1
	       ) else null end
	  from (select distinct id from unnest(p_member_ids) as t(id)) x
	  join public.members m on m.id = x.id
	on conflict (member_id, batch_key) where batch_key is not null
	do update set amount_due = excluded.amount_due,
	              label      = excluded.label,
	              charged_on = excluded.charged_on,
	              payer_hint = excluded.payer_hint,
	              updated_at = now()
	where public.dues_charges.amount_paid = 0;
	get diagnostics v_charged = row_count;

	-- 명단에서 빠진 사람의 미납 정리(납부분·void 보존).
	delete from public.dues_charges dc
	where dc.kind = 'manual' and dc.batch_key = btrim(p_batch_key)
	  and dc.amount_paid = 0 and dc.status <> 'void'
	  and not (dc.member_id = any(p_member_ids));
	get diagnostics v_removed = row_count;

	-- 이미 낸 사람을 명단에서 뺐다면 지울 수 없다 → 몇 건인지 알려주고 운영진이 개별 처리하게 한다.
	select count(*) into v_locked
	  from public.dues_charges dc
	 where dc.kind = 'manual' and dc.batch_key = btrim(p_batch_key)
	   and not (dc.member_id = any(p_member_ids)) and dc.amount_paid > 0;

	insert into public.dues_audit_log (actor_member_id, action, detail)
	values (v_admin, 'upsert_manual_batch', jsonb_build_object(
		'batch_key', btrim(p_batch_key), 'label', btrim(p_label), 'charged_on', p_charged_on,
		'amount', p_amount, 'head', array_length(p_member_ids, 1),
		'charged', v_charged, 'removed', v_removed, 'locked', v_locked));

	return jsonb_build_object('charged', v_charged, 'removed', v_removed, 'locked', v_locked);
end $function$;

revoke execute on function public.dues_upsert_manual_batch(text, text, date, integer, uuid[]) from public, anon;
grant  execute on function public.dues_upsert_manual_batch(text, text, date, integer, uuid[]) to authenticated;

-- ============================================================
-- ⑦ 배치 삭제 — 운영진의 명시적 조작이므로 void 까지 함께 지운다(자동정리와 다른 점).
--    납부분은 지우지 않는다: 실제로 받은 돈을 지우면 배분(dues_allocations)이 고아가 된다.
-- ============================================================
create or replace function public.dues_delete_manual_batch(p_batch_key text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
	v_admin   uuid := public.current_member_id();
	v_removed int := 0;
	v_locked  int := 0;
	v_label   text;
begin
	if not public.is_admin() then raise exception 'forbidden'; end if;
	if coalesce(btrim(p_batch_key), '') = '' then raise exception 'batch_key required'; end if;

	select max(label) into v_label
	  from public.dues_charges where kind = 'manual' and batch_key = btrim(p_batch_key);

	delete from public.dues_charges
	 where kind = 'manual' and batch_key = btrim(p_batch_key) and amount_paid = 0;
	get diagnostics v_removed = row_count;

	select count(*) into v_locked
	  from public.dues_charges where kind = 'manual' and batch_key = btrim(p_batch_key);

	insert into public.dues_audit_log (actor_member_id, action, detail)
	values (v_admin, 'delete_manual_batch', jsonb_build_object(
		'batch_key', btrim(p_batch_key), 'label', v_label, 'removed', v_removed, 'kept_paid', v_locked));

	return jsonb_build_object('removed', v_removed, 'kept_paid', v_locked);
end $function$;

revoke execute on function public.dues_delete_manual_batch(text) from public, anon;
grant  execute on function public.dues_delete_manual_batch(text) to authenticated;
