-- 회원 정지(is_active → false) 시 미납 회비를 자동 면제(waived) 한다.
--
-- 배경: 정지는 사실상 탈퇴 처리인데, 정지 전에 이미 생성된 그 달 회비 미납이 그대로 남아
--   미납 현황에 영구히 쌓였다(실측 2026-08-18: 11건 55,000원. 전원 정지된 달에 참석 이력이 없었다).
--   회비 생성 룰(`dues_generate_monthly`)은 `is_active` 를 보므로 **새 부과는 안 생기지만**,
--   월진입 ensure 가 이미 돌아간 뒤 정지하면 그 달 건이 남는다. 그걸 손으로 지우고 있었다.
--
-- 정책: 정지 시 **미납(status='unpaid' AND amount_paid=0) 회비만** 면제한다.
--   · 납부·부분납은 건드리지 않는다(현금주의 원장 무영향 — 받은 돈은 받은 돈이다).
--   · 대관비(court_fee)는 건드리지 않는다. 실제로 코트를 쓴 대가라 탈퇴와 무관하게 받을 돈이다.
--   · 삭제(delete)가 아니라 `waived` 다 — 행을 남겨 "왜 안 걷었나"가 감사로 추적된다.
--     (명예회원 지정 `dues_set_honorary` 는 delete 지만, 그쪽은 '애초에 낼 의무가 없음'이고
--      여기는 '중도 이탈로 걷지 않기로 함'이라 이력을 남기는 게 맞다.)
--   · **재활성화는 면제를 되살리지 않는다.** 되살릴 일이 생기면 그 달만 수동으로
--     `dues_set_charge_status(id,'reset')` 하면 된다.
--
-- 트리거로 두는 이유: 정지 경로가 클라이언트의 members 직접 UPDATE(`setMemberActive`, RLS
--   members_update)라 RPC 게이트가 없다. 어느 경로로 정지해도 함께 돌아야 하므로 테이블에 붙인다.

create or replace function public.members_waive_dues_on_deactivate()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare v_n int;
begin
  update public.dues_charges
  set status = 'waived', updated_at = now()
  where kind = 'monthly_fee'
    and member_id = NEW.id
    and status = 'unpaid'
    and amount_paid = 0;
  get diagnostics v_n = row_count;

  if v_n > 0 then
    insert into public.dues_audit_log (actor_member_id, action, detail)
    values (public.current_member_id(), 'waive_dues_on_deactivate',
            jsonb_build_object('member', NEW.id, 'waived', v_n));
  end if;
  return null;
end $function$;

revoke execute on function public.members_waive_dues_on_deactivate() from public, anon, authenticated;

drop trigger if exists trg_members_waive_dues_on_deactivate on public.members;
create trigger trg_members_waive_dues_on_deactivate
after update of is_active on public.members
for each row
when (OLD.is_active and not NEW.is_active)
execute function public.members_waive_dues_on_deactivate();

-- ── 기존 잔재 정리 ──────────────────────────────────────────────────
-- 이미 정지된 회원의 미납 회비를 같은 규칙으로 면제한다(2026-08-18 기준 11건).
with waived as (
  update public.dues_charges dc
  set status = 'waived', updated_at = now()
  where dc.kind = 'monthly_fee'
    and dc.status = 'unpaid'
    and dc.amount_paid = 0
    and exists (select 1 from public.members m where m.id = dc.member_id and not m.is_active)
  returning dc.member_id, dc.period_ym
)
insert into public.dues_audit_log (actor_member_id, action, detail)
select null, 'waive_dues_on_deactivate_backfill',
       jsonb_build_object('count', count(*), 'items', jsonb_agg(jsonb_build_object('member', member_id, 'ym', period_ym)))
from waived
having count(*) > 0;
