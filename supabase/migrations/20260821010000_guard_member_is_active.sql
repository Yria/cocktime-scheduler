-- members.is_active 변경을 운영진(+서버 경로)으로 제한한다 — 20260821000000 이 "범위 밖"으로 남긴 구멍을 막는다.
--
-- 구멍: `members_update` RLS 가 `is_admin() OR auth_user_id = auth.uid()` 이고 authenticated 롤에 members
--   UPDATE 테이블 권한이 있어, 로그인한 회원이면 누구나 PostgREST PATCH 로 **자기 행의 is_active 를 끌 수
--   있었다**. 끄는 순간 `trg_members_uncharge_dues_on_deactivate`(20260820020000)가 그 사람의 그 달 미납
--   회비를 지운다 → 자기 회비를 스스로 삭제하는 경로. 다시 켜면(21일 이후면) 합류월 하한(20260821000000)에
--   막혀 재생성 복구까지 안 된다. 앱 UI 엔 없는 경로지만 RLS 는 그걸 구분하지 못한다.
--
-- 왜 RLS 로는 못 막나: 정책의 WITH CHECK 는 **새 행만** 본다 — OLD 를 참조할 수 없어 "is_active 를 바꾸지
--   말 것"을 표현할 방법이 없다. `WITH CHECK (... AND is_active)` 로 끄는 것만 막으면, 운영진이 비활성화해 둔
--   회원이 자기 프로필(이름·거주지)조차 저장 못 하게 되는 부수효과가 생긴다. OLD↔NEW 비교가 필요하므로
--   트리거가 맞는 도구다.
--
-- 왜 컬럼 권한(revoke update (is_active)) 이 아닌가: 컬럼 REVOKE 는 테이블 레벨 UPDATE 권한이 있으면 효과가
--   없다. 테이블 권한을 통째로 회수하고 허용 컬럼을 일일이 GRANT 해야 하는데, 운영진도 authenticated 라
--   `setMemberActive`·`updateMemberSkills` 까지 함께 끊기고, 앞으로 members 에 컬럼이 늘 때마다 GRANT 를
--   빠뜨리면 조용히 저장이 실패한다. 판정 기준이 "누가 부르나"라서 권한이 아니라 게이트가 맞다.
--
-- 판별자 = `current_user`. 프로덕션에서 실측했다:
--   · PostgREST 직접 호출          → current_user = 'authenticated'
--   · SECURITY DEFINER 함수 안     → current_user = 'postgres' (함수 소유자)
--   · 서비스키 / 마이그레이션      → 'service_role' / 'postgres'
--   그래서 "authenticated 로 들어온 직접 UPDATE 인데 운영진이 아니면 거부"만 쓰면 서버 경로는 전부 통과한다.
--   members 를 UPDATE 하는 라이브 함수 4개(add_guest_attendance · delete_my_account · dues_set_honorary ·
--   update_player_skill)는 모두 SECURITY DEFINER · owner=postgres 임을 확인했다.
--
-- **이 트리거 함수만은 SECURITY DEFINER 로 만들면 안 된다.** definer 로 두면 트리거 안에서 current_user 가
--   항상 'postgres' 가 돼 판별자가 죽는다(모든 호출이 통과). INVOKER(기본)여야 호출자 롤이 그대로 보인다.
--   `search_path = ''` + `public.` 한정은 그대로 지킨다.
--
-- 통과시키는 정상 경로 3가지
--   1) 운영진 UI — `setMemberActive`(회원관리 [비활성]/[재활성화]). authenticated + is_admin() → 허용.
--   2) 본인 탈퇴 — `delete_my_account`(secdef). is_active=false + auth_user_id 절단 + auth.users 삭제.
--   3) 게스트 행 재사용 — `add_guest_attendance`(secdef, 20260819030000). 접힌 게스트 행을 is_active=true 로.
--
-- 남는 잔여 위험(막지 않는다): 본인 탈퇴는 여전히 그 달 미납 회비를 지운다(20260820020000 의 설계 —
--   비활성 회원은 부과 대상이 아니다). 월말에 탈퇴해 5,000원을 피하고 새 계정으로 재가입하는 건 이론상
--   가능하지만, 계정·로그인·이력을 다 잃고 운영진 눈에 중복 행으로 보이는 값비싼 회피라 룰로 막지 않는다.

create or replace function public.members_guard_is_active()
returns trigger
language plpgsql
-- SECURITY INVOKER(기본) — 위 주석 참고. definer 로 바꾸면 이 게이트는 무력화된다.
set search_path = ''
as $function$
begin
	-- 값이 안 바뀌었으면(컬럼만 언급된 UPDATE) 통과.
	if NEW.is_active is not distinct from OLD.is_active then
		return NEW;
	end if;
	-- 서버 경로(SECURITY DEFINER 함수·서비스키·마이그레이션)는 통과.
	if current_user not in ('authenticated', 'anon') then
		return NEW;
	end if;
	-- 클라이언트 직접 호출은 운영진만.
	if current_user = 'authenticated' and public.is_admin() then
		return NEW;
	end if;
	raise exception 'forbidden: members.is_active 는 운영진만 변경할 수 있다 (본인 탈퇴는 delete_my_account)'
		using errcode = '42501';
end $function$;

comment on function public.members_guard_is_active() is
	'members.is_active 변경 게이트. authenticated 직접 UPDATE 는 운영진만 허용, SECURITY DEFINER 서버 경로(delete_my_account·add_guest_attendance)와 service_role·마이그레이션은 통과. SECURITY INVOKER 여야 current_user 판별이 성립한다 — definer 로 바꾸지 말 것.';

-- 이름이 stamp 트리거보다 앞서(g < s) 먼저 돌아, 거부될 UPDATE 는 rejoined_at 을 찍지도 않는다.
drop trigger if exists trg_members_guard_is_active on public.members;
create trigger trg_members_guard_is_active
before update of is_active on public.members
for each row
execute function public.members_guard_is_active();
