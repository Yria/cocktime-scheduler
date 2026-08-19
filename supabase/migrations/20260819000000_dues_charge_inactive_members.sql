-- 비활성(탈퇴) 회원도 회비 부과 대상으로 되돌린다 + 정지 시 미납 회비 자동 면제 폐지.
--
-- 배경: 어제(2026-08-18) `20260818020000_waive_dues_on_member_deactivate.sql` 로
--   "정지(is_active true→false) 시 미납 회비 자동 waived" 트리거를 넣었다. 그 전제는
--   "정지된 달에 참석 이력이 없다"였는데 **실측에서 거짓이었다**:
--   홍예린은 2026-07-20 세션 158 에 confirmed 로 참석해 실제로 뛰었는데도(session_players 에도 1행)
--   백필이 그 사람의 2026-07 회비를 waived 로 돌려 **7월 정산이 "다 걷힌" 것처럼 풀렸다**.
--   운영진 요구(2026-08-19): "비활성된 사용자가 부과에 자꾸 제외되는데, 그러지 않으면 함."
--
-- 정책(이 파일이 단일 소스, docs/ACCOUNTING_SPEC.md §7 동시 수정):
--   1) **부과는 자동으로 지우지도 면제하지도 않는다.** 회원 상태 변경이 돈 행을 건드리는 경로를 없앤다.
--      → 트리거·함수 삭제. 걷지 않기로 한 건은 운영진이 회비 현황에서 [면제]를 눌러 처리한다
--        (그 진입점을 이번 배포에 함께 넣었다 — 종전에는 회비 행 액션이 [이월] 하나뿐이라
--         손으로 SQL 을 돌리고 있었고, 그래서 트리거라는 잘못된 처방이 나왔다).
--   2) **회비 부과 자격에서 is_active 를 뺀다.** 명단이 아니라 부과가 정산의 기준이라는
--      ACCOUNTING_SPEC §3.1 원칙과 같은 방향이다 — 중도 이탈자도 그 달 회비는 낼 돈으로 남는다.
--      게스트·명예회원·운영진 제외는 그대로다.
--   3) 이미 waived 로 돌아간 11건은 **백필 감사 로그의 items 목록으로 정확히 특정해** 되돌린다.
--
-- 거부한 대안:
--   · 트리거를 "그 달 참석 이력이 없을 때만" 으로 조건화 — 홍예린 반례는 막지만, '활동'의 정의
--     (확정/대기/당일취소/보드 등재)가 갈리는 순간 또 조용히 돈을 지운다. 자동으로 돈을 없애는
--     경로 자체를 두지 않는 편이 감사 가능하다.
--   · `membership_ended_at`(종료월) 도입 후 종료월까지만 부과 — 무한 미납은 막지만 컬럼·UI가 늘고,
--     운영진이 요구한 건 "부과가 남아 있을 것"이다. 무한 부과가 실제로 문제가 되면 그때 넣는다.
--
-- ⚠ 부작용(운영진에게 보고됨): 다음 월진입(`dues_ensure_monthly`)부터 비활성 회원에게도 회비가
--   생긴다. 걷지 않을 사람은 회비 현황 → 미납 명단 → [면제] 로 정리한다(감사 로그 남음).

-- ── 1. 정지 시 미납 회비 자동 면제 폐지 ──────────────────────────────
drop trigger if exists trg_members_waive_dues_on_deactivate on public.members;
drop function if exists public.members_waive_dues_on_deactivate();

-- ── 2. 회비 룰에서 is_active 제거 ────────────────────────────────────
-- 20260720020000_dues_honorary_members.sql 의 정의를 그대로 재선언하고 WHERE 절의
-- `m.is_active and` 한 조각만 뺀다(회비 로직 단일 소스 — ensure/generate/monthly 세 경로가 공유).
create or replace function public.dues_generate_monthly(p_ym text)
returns int
language plpgsql
security definer
set search_path to ''
as $function$
declare v_fee int; v_offset int; v_n int := 0;
begin
  select monthly_fee, offset_days into v_fee, v_offset from public.dues_settings where id = 1;
  if v_fee is null then raise exception 'dues_settings not initialized'; end if;
  insert into public.dues_charges (kind, member_id, period_ym, amount_due)
  select 'monthly_fee', m.id, p_ym, v_fee
  from public.members m
  where not m.is_guest and not m.is_honorary and not public.is_operator(m.id)
    and p_ym >= to_char(
      date_trunc('month',
        (coalesce(m.membership_started_at, (m.created_at at time zone 'Asia/Seoul')::date) + v_offset)::timestamp)
      + interval '1 month', 'YYYY-MM')
  on conflict (member_id, period_ym) where period_ym is not null
  do update set amount_due = excluded.amount_due, updated_at = now()
  where public.dues_charges.amount_paid = 0;
  get diagnostics v_n = row_count;
  return v_n;
end $function$;

revoke execute on function public.dues_generate_monthly(text) from public, anon, authenticated;

comment on function public.dues_generate_monthly(text) is
  '월 회비 부과 생성. 자격 = 비게스트·비명예·비운영진(2026-08-19: is_active 제외 조건 삭제 — 비활성 회원도 부과 대상). 가입월+offset 다음 달부터. 이미 납부분(amount_paid>0)은 금액을 덮지 않는다.';

-- ── 3. 8/18 백필로 waived 된 11건 원복 ───────────────────────────────
-- 대상을 `status='waived'` 전수로 잡지 않는다 — 회비 이월정산도 waived 를 쓰므로(20260714090000)
-- 정상 면제분을 되살릴 위험이 있다. 백필이 남긴 감사 로그의 items(member,ym) 로만 특정한다.
-- 상태는 dues_set_charge_status(id,'reset') 와 같은 산식으로 되돌린다(전원 amount_paid=0 → unpaid).
with tgt as (
  select (i->>'member')::uuid as member_id, i->>'ym' as period_ym
  from public.dues_audit_log l,
       lateral jsonb_array_elements(l.detail->'items') i
  where l.action = 'waive_dues_on_deactivate_backfill'
),
restored as (
  update public.dues_charges dc
  set status = case
                 when dc.amount_paid = 0 then 'unpaid'
                 when dc.amount_paid < dc.amount_due then 'partial'
                 when dc.amount_paid = dc.amount_due then 'paid'
                 else 'overpaid'
               end,
      updated_at = now()
  from tgt
  where dc.kind = 'monthly_fee'
    and dc.status = 'waived'
    and dc.deferred_to is null
    and dc.member_id = tgt.member_id
    and dc.period_ym = tgt.period_ym
  returning dc.id, dc.member_id, dc.period_ym
)
insert into public.dues_audit_log (actor_member_id, action, detail)
select null, 'unwaive_dues_on_deactivate_revert',
       jsonb_build_object(
         'count', count(*),
         'items', jsonb_agg(jsonb_build_object('charge', id, 'member', member_id, 'ym', period_ym)),
         'why', '정지 시 자동 면제 정책 폐지(2026-08-19). 홍예린 2026-07 은 실제 참석자였는데 면제돼 7월 정산이 풀렸다.'
       )
from restored
having count(*) > 0;
