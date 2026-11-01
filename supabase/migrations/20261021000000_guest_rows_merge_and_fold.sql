-- ============================================================
-- 게스트 잔재 행 병합 + 오래된 게스트 접기 (1회성 데이터 정리)
--
-- 배경: 20260819030000 이전엔 게스트 신청마다 members 행을 새로 만들었다. 재사용으로 증가는
--   멈췄지만 잔재가 남았다(2026-10-21 실측: 게스트 87행, 이름+성별 중복 11그룹 28행 → 잉여 17행).
--   당시 병합을 미룬 이유였던 회계 연결(dues_* / bank_transactions)은 지금 이 28행에 0건이다.
--
-- 병합 단위: is_guest · auth_user_id null · gender not null 인 행 중 name_match_key+gender 가 같은 그룹.
--   대표 행 = created_at desc, id (= _register_guest_member 가 재사용으로 고르는 행과 같다).
--   · attendances : 같은 회차에 그룹 행이 둘 이상이면 1행만 남긴다(미취소 우선 → 대표 우선 → 최신 신청).
--                   버려지는 행은 반드시 cancelled 여야 한다(아니면 카운터가 어긋나므로 중단).
--   · session_players : member_id 와 (member_id 와 같던) player_id 를 대표로. 회차 내 충돌 0건(실측).
--   · cock_support_grants : PK(member_id, ym) — 같은 달 여러 행이면 가장 이른 소진 1행만 남긴다.
--   · skills : 옛 행 → 대표 순으로 합쳐 최신 평가가 이긴다.
--   · ops_audit 는 감사 이력이라 옛 id 그대로 둔다(FK 없음).
--   이후 잉여 행 삭제. 삭제는 CASCADE 테이블을 조용히 지우므로, 그 테이블에 참조가 남아 있으면 중단한다
--   ([[member-lifecycle-money-invariant]] — 게스트도 하드삭제는 '참조 0건 확인 뒤'에만).
--
-- 접기: 최근 30일 안(또는 앞으로) 신청·보드 기록이 없는 활성 게스트를 is_active=false 로.
--   효과는 회원관리 '게스트 보기'에서 접히는 것뿐이고, 다시 신청하면 _register_guest_member 가 되살린다.
--   비활성 트리거(dues_cancel_inactive_monthly)는 월회비만 건드리는데 게스트엔 월회비가 없다.
-- ============================================================

create temp table _guest_map on commit drop as
with g as (
  select id, public.name_match_key(name) || ':' || gender as k, created_at
  from public.members
  where is_guest and auth_user_id is null and gender is not null
),
ranked as (
  select id, k, row_number() over (partition by k order by created_at desc, id) as rn,
         count(*) over (partition by k) as n
  from g
)
select r.id as old_id, rep.id as rep_id
from ranked r join ranked rep on rep.k = r.k and rep.rn = 1
where r.n > 1;

-- 1) attendances: 회차별 1행만 남긴다.
create temp table _att_drop on commit drop as
select session_id, member_id
from (
  select a.session_id, a.member_id, a.status,
         row_number() over (
           partition by a.session_id, m.rep_id
           order by (a.status <> 'cancelled') desc, (a.member_id = m.rep_id) desc, a.requested_at desc
         ) as rn
  from public.attendances a join _guest_map m on m.old_id = a.member_id
) x
where rn > 1;

do $$
begin
  if exists (select 1 from public.attendances a join _att_drop d using (session_id, member_id)
             where a.status <> 'cancelled') then
    raise exception 'guest merge: 버릴 참석 행 중 취소가 아닌 행이 있다 — 수동 확인 필요';
  end if;
end $$;

delete from public.attendances a using _att_drop d
where a.session_id = d.session_id and a.member_id = d.member_id;

update public.attendances a set member_id = m.rep_id
from _guest_map m where a.member_id = m.old_id and m.old_id <> m.rep_id;

update public.attendances a set invited_by = m.rep_id
from _guest_map m where a.invited_by = m.old_id and m.old_id <> m.rep_id;

-- 2) session_players
update public.session_players sp
set member_id = m.rep_id,
    player_id = case when sp.player_id = m.old_id::text then m.rep_id::text else sp.player_id end
from _guest_map m where sp.member_id = m.old_id and m.old_id <> m.rep_id;

-- 3) cock_support_grants: 같은 달은 가장 이른 소진만.
delete from public.cock_support_grants c
using (
  select c2.member_id, c2.ym,
         row_number() over (partition by m.rep_id, c2.ym order by c2.granted_at, c2.member_id) as rn
  from public.cock_support_grants c2 join _guest_map m on m.old_id = c2.member_id
) x
where c.member_id = x.member_id and c.ym = x.ym and x.rn > 1;

update public.cock_support_grants c set member_id = m.rep_id
from _guest_map m where c.member_id = m.old_id and m.old_id <> m.rep_id;

-- 4) skills 합치기(옛 행 먼저, 대표가 마지막에 덮는다).
update public.members rep
set skills = s.merged || coalesce(rep.skills, '{}'::jsonb), updated_at = now()
from (
  select m.rep_id, jsonb_object_agg(e.key, e.value order by o.created_at) as merged
  from _guest_map m
  join public.members o on o.id = m.old_id and m.old_id <> m.rep_id
  cross join lateral jsonb_each(coalesce(o.skills, '{}'::jsonb)) e
  group by m.rep_id
) s
where rep.id = s.rep_id;

-- 5) 잉여 행 삭제 — CASCADE 대상에 참조가 남아 있으면 중단.
do $$
declare v_left int;
begin
  select count(*) into v_left from _guest_map m
  where m.old_id <> m.rep_id and (
       exists (select 1 from public.attendances x where x.member_id = m.old_id or x.invited_by = m.old_id)
    or exists (select 1 from public.session_players x where x.member_id = m.old_id)
    or exists (select 1 from public.cock_support_grants x where x.member_id = m.old_id)
    or exists (select 1 from public.user_roles x where x.member_id = m.old_id)
    or exists (select 1 from public.notifications x where x.recipient_member_id = m.old_id)
    or exists (select 1 from public.push_subscriptions x where x.member_id = m.old_id)
    or exists (select 1 from public.member_honorary x where x.member_id = m.old_id)
    or exists (select 1 from public.wait_point_ledger x where x.member_id = m.old_id)
    or exists (select 1 from public.wait_point_balances x where x.member_id = m.old_id)
    or exists (select 1 from public.match_avoid_owner x where x.member_id = m.old_id)
    or exists (select 1 from dues_legacy.dues_charges x where x.member_id = m.old_id)
    or exists (select 1 from dues_legacy.dues_allocations x where x.member_id = m.old_id)
    or exists (select 1 from dues_legacy.dues_charge_drafts x where x.member_id = m.old_id)
  );
  if v_left > 0 then
    raise exception 'guest merge: 잉여 행 % 개에 참조가 남아 있다 — 삭제 중단', v_left;
  end if;
end $$;

delete from public.members mb using _guest_map m
where mb.id = m.old_id and m.old_id <> m.rep_id;

-- 6) 오래된 게스트 접기.
update public.members mb
set is_active = false, updated_at = now()
where mb.is_guest and mb.auth_user_id is null and mb.is_active
  and not exists (
    select 1 from public.attendances a join public.sessions s on s.id = a.session_id
    where a.member_id = mb.id and a.status <> 'cancelled'
      and s.scheduled_at >= now() - interval '30 days'
  )
  and not exists (
    select 1 from public.session_players sp join public.sessions s on s.id = sp.session_id
    where sp.member_id = mb.id and s.scheduled_at >= now() - interval '30 days'
  );
