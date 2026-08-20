-- 정지(비활성)로 인한 그 달 회비는 '면제'가 아니라 **미부과**다 → waived 로 남기지 말고 지운다.
--
-- 용어가 정책을 잘못 이끌었다. `waived`(면제)는 "낼 의무가 있는데 걷지 않기로 함"이고, 그래서 행을 남겨
--   "왜 안 걷었나"를 보여줄 필요가 생기고, 그걸 보여주려고 회비 카드에 [면제 N명] 목록까지 붙였다(8/19).
--   그런데 정지된 회원은 **애초에 부과 대상이 아니다** — 부과 룰(`is_active`)이 그렇게 정의돼 있다.
--   낼 의무가 없으니 걷지 않는 게 아니라 **부과가 없는 것**이고, 그러면 남길 행도 없다.
--
-- 선례가 정확히 이 형태다: 명예회원 지정(`dues_set_honorary`, 20260720020000:93-96)은 자격이 사라지는
--   순간 미납 회비를 **delete** 한다 — "애초에 낼 의무가 없음"이라서. 정지도 같은 부류이므로 같은 처리를 쓴다.
--   (그 파일이 delete/waived 를 가른 기준 자체가 '의무가 없음' vs '의무는 있는데 안 걷음'이었다.)
--
-- 지우는 게 안전한 이유
--   · `dues_generate_monthly` 는 `is_active` 를 보므로 지운 뒤 재생성되지 않는다. 월진입 ensure 는
--     그 달 행이 하나라도 있으면 no-op 이라 과거 달도 되살아나지 않는다. (대관비는 self-heal 이 다시
--     만들기 때문에 `void` 로 봉인해야 하지만, 회비엔 그 경로가 없다.)
--   · FK: `dues_allocations.charge_id` 는 CASCADE 지만 `amount_paid = 0` 조건이 배분 있는 행을 애초에
--     제외한다. `dues_audit_log.charge_id` 는 SET NULL 이라 감사 기록은 남는다.
--   · 행이 사라지므로 **감사 로그가 유일한 흔적**이다 → charge id·period_ym·금액을 모두 남긴다.
--
-- 건드리지 않는 것: 납부·부분납(`amount_paid > 0`), 대관비(실제 코트 사용 대가), 이월 중인 건
--   (`deferred_to` 있음 — 다른 달로 넘겨 둔 상태라 지우면 이월 목록이 깨진다), 수동 `waived`/`void`.

-- ── 1. 미부과 트리거(옛 면제 트리거 대체) ────────────────────────────
drop trigger if exists trg_members_waive_dues_on_deactivate on public.members;
drop function if exists public.members_waive_dues_on_deactivate();

create or replace function public.members_uncharge_dues_on_deactivate()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare v_items jsonb;
begin
  with gone as (
    delete from public.dues_charges
    where kind = 'monthly_fee'
      and member_id = NEW.id
      and status = 'unpaid'
      and amount_paid = 0
      and deferred_to is null
    returning id, period_ym, amount_due
  )
  select jsonb_agg(jsonb_build_object('charge', id, 'ym', period_ym, 'due', amount_due)) into v_items from gone;

  if v_items is not null then
    insert into public.dues_audit_log (actor_member_id, action, detail)
    values (public.current_member_id(), 'uncharge_dues_on_deactivate',
            jsonb_build_object('member', NEW.id, 'count', jsonb_array_length(v_items), 'items', v_items,
                               'why', '비활성 회원은 회비 부과 대상이 아니다(미부과). 면제가 아니라 부과 자체를 지운다.'));
  end if;
  return null;
end $function$;

revoke execute on function public.members_uncharge_dues_on_deactivate() from public, anon, authenticated;

-- 정지 경로가 클라이언트의 members 직접 UPDATE(`setMemberActive`, RLS members_update)라 RPC 게이트가
-- 없다. 어느 경로로 정지해도 함께 돌아야 하므로 테이블에 붙인다.
create trigger trg_members_uncharge_dues_on_deactivate
after update of is_active on public.members
for each row
when (OLD.is_active and not NEW.is_active)
execute function public.members_uncharge_dues_on_deactivate();

-- ── 2. 어제 waived 로 돌린 11건을 같은 기준으로 지운다 ────────────────
-- 대상은 어제 sweep 감사 로그의 charge id 로만 특정한다(수동 면제·이월정산 waived 를 건드리지 않기 위해).
with tgt as (
  select (i->>'charge')::bigint as id
  from public.dues_audit_log l,
       lateral jsonb_array_elements(l.detail->'items') i
  where l.action = 'waive_dues_inactive_members_sweep'
),
gone as (
  delete from public.dues_charges dc
  using tgt
  where dc.id = tgt.id
    and dc.kind = 'monthly_fee'
    and dc.status = 'waived'
    and dc.amount_paid = 0
    and dc.deferred_to is null
    and exists (select 1 from public.members m where m.id = dc.member_id and not m.is_active)
  returning dc.id, dc.member_id, dc.period_ym, dc.amount_due
)
insert into public.dues_audit_log (actor_member_id, action, detail)
select null, 'uncharge_dues_inactive_members_sweep',
       jsonb_build_object(
         'count', count(*),
         'items', jsonb_agg(jsonb_build_object('charge', id, 'member', member_id, 'ym', period_ym, 'due', amount_due)),
         'why', '정지로 인한 회비는 면제가 아니라 미부과 → 어제 waived 로 남긴 행을 삭제(2026-08-20).'
       )
from gone
having count(*) > 0;
