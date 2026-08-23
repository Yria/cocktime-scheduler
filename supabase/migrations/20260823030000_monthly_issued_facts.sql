-- ============================================================
-- 회비도 '발행된 사실'로 (2026-08-23, 20260823020000 의 후속)
--
-- 대관비에 적용한 원칙을 회비 생성기에 그대로 옮긴다:
--   **발행된 부과는 규칙이 건드리지 않는다. 발행 안 된 사람만 추가 발행하고, 이상하면 대기.**
--
-- 대관비보다 위험이 낮았던 이유(그래서 뒤로 미뤘던 이유): 회비 생성기에는 자동정리 DELETE 가 없다.
-- 남아 있던 문제는 UPSERT 의 `do update set amount_due = excluded.amount_due` 하나 —
-- 월 첫 진입마다 **이미 발행된 미납 회비의 금액을 다시 써넣었다**. 지금은 회비가 5,000원 고정이라
-- 눈에 보이는 사고가 없었지만, `dues_settings.monthly_fee` 를 바꾸는 순간 **과거 달의 미납 회비까지
-- 새 금액으로 소급 변경**된다. 발행된 금액은 사실이므로 그래선 안 된다.
--
-- 회비의 이상 판정(대관비와 다른 축):
--   · head_count_jump — 이번 대상 인원이 **지난달 발행 인원의 ±40% 밖**. 명단 사고·대량 비활성화를
--     사람에게 올린다. 지난달 발행이 10명 미만이면 기준이 노이즈라 판정하지 않는다
--     (실측: 2026-06 은 2명, 07 은 70명, 08 은 80명 — 06 을 기준으로 삼으면 무조건 걸린다).
--   · new_members — 이미 발행된 달에 초안에만 있는 사람이 생김. 회비는 신규 가입자가 **다음 달부터**
--     부과되므로 그 달 중간에 사람이 늘어나는 건 정상 흐름이 아니다(명예회원 해제·가입월 소급 보정
--     같은 조작의 결과다) → 사람이 확인할 값이 있다.
--
-- 실측 참고: 2026-08 발행 80명인데 현재 자격자는 77명이다. 발행 후 3명이 자격을 잃었고(비활성화 등),
--   새 모델에서 그 3명의 부과는 **사실로 남는다**. 안 걷을 거라면 취소(void)가 맞다 — 중도 탈퇴자도
--   그 달 회비는 낸다는 게 이 프로젝트의 기존 결정이고(§3.1), 비활성화 트리거가 그 처리를 이미 한다.
-- ============================================================

-- ① 대상 술어 단일 소스 — 대관비의 `dues_court_targets` 와 같은 역할.
--    종전 생성기는 이 술어를 INSERT 한 곳에만 갖고 있었는데, 발행 모델에서는 같은 술어를
--    ⓐ 대상 인원 세기 ⓑ 발행 안 된 사람 세기 ⓒ 대기 초안 만들기 ⓓ 발행 네 곳에서 쓴다.
--    복제하면 갈린다(대관비에서 실제로 무한 재부과/재삭제로 갈렸던 그 문제, 20260818000000 주석).
create or replace function public.dues_monthly_targets(p_ym text)
returns table (member_id uuid)
language sql
stable
security definer
set search_path = ''
as $function$
	select m.id
	from public.members m
	cross join lateral (
		-- 실제 합류일 = 계정 생성 ↔ 마지막 재활성화 중 나중(KST date)
		select greatest(
		         (m.created_at at time zone 'Asia/Seoul')::date,
		         coalesce((m.rejoined_at at time zone 'Asia/Seoul')::date,
		                  (m.created_at at time zone 'Asia/Seoul')::date)
		       ) as joined_on
	) j
	cross join (select offset_days, join_cutoff_day from public.dues_settings where id = 1) st
	where m.is_active and not m.is_guest and not m.is_honorary and not public.is_operator(m.id)
	  -- 시작월: 가입월(+offset) 다음 달부터
	  and p_ym >= to_char(
	    date_trunc('month',
	      (coalesce(m.membership_started_at, (m.created_at at time zone 'Asia/Seoul')::date)
	       + st.offset_days)::timestamp)
	    + interval '1 month', 'YYYY-MM')
	  -- 합류월 하한: 컷오프일 이후 합류면 그 달은 미부과
	  and not (p_ym = to_char(j.joined_on, 'YYYY-MM')
	           and extract(day from j.joined_on) >= st.join_cutoff_day);
$function$;

revoke execute on function public.dues_monthly_targets(text) from public, anon, authenticated;

comment on function public.dues_monthly_targets(text) is
	'그 달 회비 부과 대상 회원 id. 회비 룰의 단일 소스(활성·비게스트·비명예·비운영진 + 시작월 + 합류월 하한). '
	'생성기의 네 경로가 같은 정의를 강제로 쓰게 한다. 2026-08-23.';

-- ② 생성기 — 초안 계산 → (정상) 발행 안 된 사람만 추가 발행 / (이상) 대기
create or replace function public.dues_generate_monthly(p_ym text)
returns int
language plpgsql
security definer
set search_path to ''
as $function$
declare
	v_fee int;
	v_new int := 0;
	v_group text := 'monthly:' || p_ym;
	v_target int;   -- 이번 초안 대상 인원(기존 발행 + 새 사람)
	v_issued int;   -- 그 달 이미 발행된(살아있는) 회비 수
	v_missing int;  -- 초안에만 있는 사람 수 = 추가 발행 후보
	v_prev int;     -- 지난달 발행 인원(이상 판정 기준)
	v_hold text;
begin
	if p_ym is null or p_ym !~ '^\d{4}-\d{2}$' then raise exception 'invalid ym: %', p_ym; end if;
	select monthly_fee into v_fee from public.dues_settings where id = 1;
	if v_fee is null then raise exception 'dues_settings not initialized'; end if;

	select count(*) into v_target from public.dues_monthly_targets(p_ym);

	select count(*) into v_issued
	  from public.dues_charges
	 where kind = 'monthly_fee' and period_ym = p_ym and status <> 'void';

	-- 초안에만 있는 사람. void 된 행도 '있는 것'으로 세므로 취소한 회비가 되살아나지 않는다.
	select count(*) into v_missing
	  from public.dues_monthly_targets(p_ym) t
	 where not exists (
	   select 1 from public.dues_charges c
	    where c.kind = 'monthly_fee' and c.period_ym = p_ym and c.member_id = t.member_id);

	-- 발행할 사람이 없으면 무동작(재실행 완전 무해).
	if v_missing = 0 then
		delete from public.dues_charge_drafts where draft_group = v_group;
		return 0;
	end if;

	select count(*) into v_prev
	  from public.dues_charges
	 where kind = 'monthly_fee' and status <> 'void'
	   and period_ym = to_char((p_ym || '-01')::date - interval '1 month', 'YYYY-MM');

	-- ── 이상 판정 ──
	if v_prev >= 10 and (v_target * 10 < v_prev * 6 or v_target * 10 > v_prev * 14) then
		v_hold := 'head_count_jump';
	elsif v_issued > 0 then
		v_hold := 'new_members';
	end if;

	if v_hold is not null then
		delete from public.dues_charge_drafts where draft_group = v_group;
		insert into public.dues_charge_drafts
			(draft_group, kind, period_ym, label, member_id, amount_due, hold_reason, hold_detail)
		select v_group, 'monthly_fee', p_ym,
		       ltrim(substr(p_ym, 6, 2), '0') || '월 회비',
		       t.member_id, v_fee, v_hold,
		       jsonb_build_object('per_head', v_fee, 'target', v_target, 'already_issued', v_issued,
		                          'prev_month', v_prev, 'head', v_missing)
		  from public.dues_monthly_targets(p_ym) t
		 where not exists (
		   select 1 from public.dues_charges c
		    where c.kind = 'monthly_fee' and c.period_ym = p_ym and c.member_id = t.member_id);
		return 0;
	end if;

	-- ── 정상: 발행 안 된 사람만 추가 발행. 기존 행은 금액도 상태도 건드리지 않는다. ──
	insert into public.dues_charges (kind, member_id, period_ym, amount_due)
	select 'monthly_fee', t.member_id, p_ym, v_fee
	  from public.dues_monthly_targets(p_ym) t
	on conflict (member_id, period_ym) where period_ym is not null
	do nothing;   -- 종전엔 amount_due 를 매달 다시 써넣었다(회비액 변경이 과거 미납에 소급됐다)
	get diagnostics v_new = row_count;

	delete from public.dues_charge_drafts where draft_group = v_group;
	return v_new;
end $function$;

revoke execute on function public.dues_generate_monthly(text) from public, anon, authenticated;

comment on function public.dues_generate_monthly(text) is
	'월 회비 초안 계산 → 정상이면 발행 안 된 사람만 추가 발행, 이상하면 dues_charge_drafts 에 대기. '
	'**발행분(dues_charges 행)은 갱신하지 않는다** — 발행된 금액은 사실이다(회비액을 바꿔도 과거 미납은 '
	'소급 변경되지 않는다). 대상 술어는 dues_monthly_targets 단일 소스. 2026-08-23 재설계.';

-- ============================================================
-- ③ label·charged_on 은 manual 전용이라는 불변식 유지 — 발행 시 kind='manual' 일 때만 복사한다.
--    (회비 초안은 검토 화면용 라벨을 들고 있는데, 그게 dues_charges 로 새면
--     `label is not null` = 수동 부과 라는 판정이 깨진다.)
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
	v_reason text;
begin
	if not public.is_admin() then raise exception 'forbidden'; end if;
	select count(*), max(hold_reason) into v_head, v_reason
	  from public.dues_charge_drafts where draft_group = p_group;
	if v_head = 0 then raise exception 'no drafts for %', p_group; end if;

	insert into public.dues_charges
		(kind, member_id, period_ym, session_id, batch_key, label, charged_on, amount_due, payer_hint, is_day_cancel)
	select d.kind, d.member_id, d.period_ym, d.session_id, d.batch_key,
	       case when d.kind = 'manual' then d.label else null end,
	       case when d.kind = 'manual' then d.charged_on else null end,
	       d.amount_due, d.payer_hint, d.is_day_cancel
	  from public.dues_charge_drafts d
	 where d.draft_group = p_group
	on conflict do nothing;
	get diagnostics v_n = row_count;

	insert into public.dues_audit_log (actor_member_id, action, detail)
	values (v_admin, 'issue_drafts', jsonb_build_object(
		'group', p_group, 'drafts', v_head, 'issued', v_n, 'hold_reason', v_reason));

	delete from public.dues_charge_drafts where draft_group = p_group;
	return jsonb_build_object('issued', v_n, 'skipped', v_head - v_n);
end $function$;

revoke execute on function public.dues_issue_drafts(text) from public, anon;
grant  execute on function public.dues_issue_drafts(text) to authenticated;
