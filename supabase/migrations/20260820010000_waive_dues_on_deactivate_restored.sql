-- 비활성(정지) 회원의 남은 미납 회비는 면제한다 — 규칙으로 복원 + 잔재 11건 정리.
--
-- 왜 다시 넣는가(8/18 도입 → 8/19 폐지 → 8/20 복원, 판단이 두 번 뒤집힌 지점이라 근거를 남긴다)
--   회비는 **월 회원 자격에 대한 대가**다. 부과 룰이 `is_active` 를 보므로 "비활성 회원에게는 회비를
--   부과하지 않는다"가 규칙이고, 그렇다면 정지 전에 이미 만들어진 그 달 건도 같은 규칙을 따라야 한다.
--   생성만 막고 잔재를 남기면 규칙이 반만 적용돼 미납 현황에 영구히 쌓인다(운영진이 매번 손으로 지우던 것).
--   선례도 회비 안에 있다: 명예회원 지정(`dues_set_honorary`)은 자격이 사라지는 순간 **이미 생성된 미납을
--   정리**한다. 정지도 자격 상실이므로 같은 취급이 정합적이다.
--
--   8/19 에 이걸 폐지한 근거("홍예린 님은 2026-07-20 에 실제로 뛰었는데 그 달 회비가 면제됐다")는 전제가
--   틀렸다 — 회비는 참석 대가가 아니라 월 회원비이므로 참석 여부는 부과 근거가 아니다(대관비가 참석 대가다).
--   그 사고의 진짜 원인은 하드삭제 CASCADE 였고(`20260819010000`), 그건 별도로 봉인했다.
--
-- 8/18 버전보다 나아진 점 — 그때 위험했던 건 규칙이 아니라 **안 보이고 되돌릴 수 없다**는 것이었다.
--   1) 화면에 회비 **[면제 N명] 접힘 목록 + [되돌리기]** 가 생겼다(어제 배포). 자동 면제분이 어디에도
--      안 남아 묻히던 문제가 사라졌다 — 이 규칙을 되살릴 수 있게 만든 전제 조건이다.
--   2) `deferred_to is null` 가드 추가: 이월 중인 건을 waived 로 돌리면 이월 목록에서 '정산 완료'처럼
--      보이는 오표기가 생긴다(8/18 버전에 있던 구멍).
--   3) 감사 로그에 **charge id 와 period_ym** 을 남긴다. 8/18 트리거는 member 와 건수만 남겨서
--      나중에 정확히 되돌릴 수 없었다(실제로 어제 원복할 때 백필 로그의 items 에 의존해야 했다).
--
-- 건드리지 않는 것: 납부·부분납(`amount_paid > 0` — 받은 돈은 받은 돈), 대관비(실제 코트 사용 대가),
--   이월 중인 건. 그리고 **재활성화는 면제를 되살리지 않는다** — 필요하면 회비 현황에서 [되돌리기].

-- ── 1. 트리거 함수 ───────────────────────────────────────────────────
create or replace function public.members_waive_dues_on_deactivate()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare v_items jsonb;
begin
  with waived as (
    update public.dues_charges
    set status = 'waived', updated_at = now()
    where kind = 'monthly_fee'
      and member_id = NEW.id
      and status = 'unpaid'
      and amount_paid = 0
      and deferred_to is null
    returning id, period_ym
  )
  select jsonb_agg(jsonb_build_object('charge', id, 'ym', period_ym)) into v_items from waived;

  if v_items is not null then
    insert into public.dues_audit_log (actor_member_id, action, detail)
    values (public.current_member_id(), 'waive_dues_on_deactivate',
            jsonb_build_object('member', NEW.id, 'count', jsonb_array_length(v_items), 'items', v_items));
  end if;
  return null;
end $function$;

revoke execute on function public.members_waive_dues_on_deactivate() from public, anon, authenticated;

-- 정지 경로가 클라이언트의 members 직접 UPDATE(`setMemberActive`, RLS members_update)라 RPC 게이트가
-- 없다. 어느 경로로 정지해도 함께 돌아야 하므로 테이블에 붙인다.
drop trigger if exists trg_members_waive_dues_on_deactivate on public.members;
create trigger trg_members_waive_dues_on_deactivate
after update of is_active on public.members
for each row
when (OLD.is_active and not NEW.is_active)
execute function public.members_waive_dues_on_deactivate();

-- ── 2. 잔재 정리(어제 원복한 11건 = 2026-07 홍예린 1 + 2026-08 10명) ──
-- 트리거와 **같은 조건**으로 훑는다 — 대상 판정을 두 곳에 복제하지 않는다.
-- 활성 회원의 미납 3건(강하진 2026-06 · 박병훈 2026-07 · 김지훈 2026-08 이월중)은 조건에서 빠진다.
with waived as (
  update public.dues_charges dc
  set status = 'waived', updated_at = now()
  where dc.kind = 'monthly_fee'
    and dc.status = 'unpaid'
    and dc.amount_paid = 0
    and dc.deferred_to is null
    and exists (select 1 from public.members m where m.id = dc.member_id and not m.is_active)
  returning dc.id, dc.member_id, dc.period_ym
)
insert into public.dues_audit_log (actor_member_id, action, detail)
select null, 'waive_dues_inactive_members_sweep',
       jsonb_build_object(
         'count', count(*),
         'items', jsonb_agg(jsonb_build_object('charge', id, 'member', member_id, 'ym', period_ym)),
         'why', '비활성 회원은 회비 부과 대상이 아니라는 규칙을 이미 생성된 미납에도 적용(2026-08-20). 되돌리기는 회비 현황 [면제 N명] → [되돌리기].'
       )
from waived
having count(*) > 0;
