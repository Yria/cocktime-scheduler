-- ============================================================
-- 신규회원 2주 프리패스 — 갓 가입한 회원은 첫 2주 동안 만석이어도 대기에 걸리지 않는다.
--
-- 요청(2026-09-03 운영자 확정 사양):
--   R1. 만석이어도 즉시 confirmed(정원 초과 확정). 대기열을 거치지 않는다.
--       **부여 시점은 본인이 누른 순간뿐** — join_session, set_late_minutes(정원외늦참 → 정시 복귀).
--       승격 루프(promote_next_waitlisted)에는 넣지 않는다. 이유는 그 함수 주석(중요).
--   R2. **인원 상한 없음**(2026-09-03 운영자 확정). 유예 중인 신규회원은 몇 명이든 만석을 넘어 확정된다.
--       운영진 프리패스(확정 운영진 총수 < 2)는 그대로 별개 규칙이다.
--       → 정원 18인 회차의 확정 인원은 18 + (그때 유예 중인 신규 신청자 수) + 운영진 최대 2 가 된다.
--       상한이 없어도 폭주하지 않는 이유: 유예는 가입 후 2주뿐이고, 부여 시점이 '본인이 누른 순간'
--       하나뿐이라(R1) 한 사람이 한 회차에서 한 자리만 만든다.
--   R3. 적용 = **부과 없는 일정만**(session_op_free = places.charges_court_fee=false 또는 장소 없음).
--       부과 있는 일정에서는 신규회원도 기존대로 대기한다 — 운영진 프리패스와 같은 게이트.
--   R4. "가입 후 2주" 기산 = **가입일 <= 세션 날짜(KST) <= 가입일 + 14일**. now() 기준이 아니라 세션 날짜
--       기준이라 set_session_capacity 의 그리디 재계산이 며칠 뒤 다시 돌아도 같은 답을 낸다(멱등).
--       가입일 = member_join_date() = coalesce(membership_started_at, created_at@KST)
--       — 회비 부과와 **같은 정의**를 쓴다. 경계는 "2주 뒤 같은 요일 회차까지 포함".
--
-- 두 프리패스의 상한 기준이 다르다(의도된 비대칭):
--   · 운영진 = '확정 운영진 **총수** < 2'  — 정원 안에 들어와 있는 운영진도 그 2명에 포함(20260806020000, 재론 금지).
--   · 신규회원 = **상한 없음**. 신규 유예의 목적이 "정원에 밀려도 첫 2주는 무조건 나올 수 있게"이므로
--     인원으로 자르지 않는다. 자르면 같은 유예 기간의 신규끼리 선착순 경쟁이 생겨 목적이 무너진다.
--
-- '정원 초과'의 정의(표시·그리디용) = 확정 행을 position 오름차순으로 줄 세워 앞 capacity명이 정원 안(base),
--   그 뒤가 초과분. set_session_capacity 그리디의 자리 배분과 클라이언트 미러
--   splitConfirmedByCapacity(waitStatus.ts)가 같은 정의를 쓴다. (신규 상한이 없어진 뒤로는 판정에 쓰지
--   않는다 — 화면에서 '정원 외' 섹션을 가르는 용도만 남았다.)
--
-- 게스트(attendances.invited_by 있음 / members.is_guest)는 프리패스 대상이 아니다 — 게스트 행은 재사용되어
-- created_at 이 과거일 수 있고(20260819030000 guest_row_reuse), 게스트 상한은 별도 규칙이다.
--
-- 승격 루프는 이 변경으로 **건드리지 않는다**(신규 분기 없음) — 종료성·승격 순서 성질이 20260806020000 그대로다.
--   따라서 대기 순번(position)이 여전히 유일한 승격 순서이고, 클라 waitDisplay 미러도 정확하다.
--
-- 재정의 기준판: 프로덕션의 현재 정의(20260806020000 + join_session 의 is_active 게이트 20260821020000).
--   0806020000 파일만 보고 join_session 을 재정의하면 그 게이트가 사라진다 — 실제로 한 번 밟았다.
--
-- 대상: session_newbie_grace(신규) / members_guard_join_date(신규 트리거) / join_session
--       / promote_next_waitlisted / set_late_minutes(풀 복귀) / set_session_capacity(그리디).
--       나머지(취소·게스트·카운터 동기화)는 프리패스 판정을 하지 않아 그대로.
-- ============================================================

-- ------------------------------------------------------------
-- (0-a) 가입일 — coalesce(membership_started_at, created_at@KST). 회비 부과와 **같은 정의**.
--   회비 쪽(generate_dues_charges 계열)은 이 식을 함수마다 인라인해 두었다. 여기서 또 복제하면
--   정의가 세 벌이 되므로 헬퍼로 뽑는다. 회비 함수들도 다음에 손댈 때 이걸 쓰도록 옮길 것.
--   (두 축이 갈라지면 "회비는 신규인데 참여는 아니다"가 생긴다.)
-- ------------------------------------------------------------
create or replace function public.member_join_date(p_member_id uuid)
returns date
language sql stable security definer set search_path = ''
as $$
	select coalesce(
		m.membership_started_at,
		(m.created_at at time zone 'Asia/Seoul')::date)
	from public.members m
	where m.id = p_member_id;
$$;
comment on function public.member_join_date(uuid) is
	'회원 가입일(KST 달력 날짜) = coalesce(membership_started_at, created_at@KST). 회비 부과 시작월과 신규회원 2주 프리패스가 같은 정의를 쓰게 하는 단일 출처.';
revoke execute on function public.member_join_date(uuid) from public, anon, authenticated;

-- ------------------------------------------------------------
-- (0) 이 회원이 이 회차에서 '신규 2주 유예' 대상인가.
--   가입일 <= 세션 날짜(KST) <= 가입일 + 14일. 게스트·일정 미정(scheduled_at null)·없는 회원은 false.
--
--   **하한(가입일 <=)이 왜 필요한가**: 회비 면제 회원을 별도 플래그 없이 membership_started_at 을
--   미래로 두어 처리하는 운영 관행이 있다(20260713130000 주석). 상한만 보면 그 회원은
--   '세션날짜 <= 미래+14' 를 영원히 만족해 **영구 프리패스**가 된다. 하한이 그걸 닫는다.
--   ("가입 후 2주"라는 말 자체가 가입 이전을 포함하지 않으므로 의미상으로도 이게 맞다.)
-- ------------------------------------------------------------
create or replace function public.session_newbie_grace(
	p_session_id bigint, p_member_id uuid
)
returns boolean
language sql stable security definer set search_path = ''
as $$
	select coalesce(
		(select (s.scheduled_at at time zone 'Asia/Seoul')::date
		            between public.member_join_date(m.id)
		                and public.member_join_date(m.id) + 14
		 from public.sessions s
		 join public.members m on m.id = p_member_id
		 where s.id = p_session_id
		   and s.scheduled_at is not null
		   and not m.is_guest
		   and m.is_active),
		false);
$$;
comment on function public.session_newbie_grace(bigint, uuid) is
	'신규회원 2주 프리패스 자격 — 가입일 <= 세션 날짜(KST) <= 가입일 + 14일(가입일 = member_join_date). 게스트·일정미정·비활성 회원은 false. 하한은 membership_started_at 을 미래로 둔 회비 면제 회원의 영구 프리패스를 막는다.';
revoke execute on function public.session_newbie_grace(bigint, uuid) from public, anon, authenticated;

-- ------------------------------------------------------------
-- (0-b) 가입일 컬럼 잠금 — 프리패스가 '회원이 스스로 바꿀 수 있는 값'에 걸리면 안 된다.
--
-- `members_update` 정책은 본인 행 UPDATE 를 허용하고(20260817030000), authenticated 에게
-- membership_started_at·created_at 의 컬럼 UPDATE 권한이 남아 있다. 즉 게이트가 없으면 회원이
-- PostgREST PATCH 로 자기 가입일을 오늘로 바꿔 **2주마다 갱신하며 영구 프리패스**를 얻을 수 있고,
-- 같은 값이 회비 부과 시작월도 정하므로 회비 회피 경로이기도 하다(이건 이 기능 전에도 열려 있던 구멍).
--
-- 왜 RLS 로는 못 막나 / 왜 컬럼 REVOKE 가 아닌가: 20260821010000(is_active 게이트) 주석과 같은 이유다.
--   정책의 WITH CHECK 는 OLD 를 못 보고, 컬럼 REVOKE 는 테이블 UPDATE 권한이 있으면 효과가 없다.
--   → 같은 패턴의 BEFORE UPDATE 트리거로 막는다. SECURITY INVOKER 여야 current_user 판별이 성립한다.
--
-- INSERT 도 막아야 한다: `members_insert` 정책(20260817030000)은 본인 행 생성을 허용하고 컬럼을
--   제한하지 않아, 최초 로그인 회원이 앱의 upsert(auth_user_id·name 만) 대신 직접
--   `POST /members {auth_user_id, membership_started_at: <임의>}` 를 넣을 수 있다.
--   단 INSERT 는 **거부하지 않고 정리(sanitize)한다** — created_at 은 DEFAULT now() 라 "값이 왔는지"를
--   구분할 수 없어 거부하면 정상 가입까지 막힌다. 비운영진 클라이언트의 INSERT 에서는
--   membership_started_at 을 NULL 로, created_at 을 now() 로 강제한다(정상 가입과 결과가 같다).
--
-- 통과: 운영진 직접 쓰기(가입월 소급 보정은 실제 운영 작업이다), SECURITY DEFINER 서버 경로,
--       service_role·마이그레이션. 클라이언트에 이 컬럼을 쓰는 코드는 없어 깨질 경로가 없다.
-- ------------------------------------------------------------
create or replace function public.members_guard_join_date()
returns trigger
language plpgsql
-- SECURITY INVOKER(기본) — definer 로 바꾸면 current_user 가 항상 소유자가 되어 게이트가 무력화된다.
set search_path = ''
as $function$
begin
	-- 서버 경로(SECURITY DEFINER 함수·서비스키·마이그레이션)는 통과.
	if current_user not in ('authenticated', 'anon') then
		return NEW;
	end if;
	-- 클라이언트 직접 호출이라도 운영진은 통과(가입월 소급 보정).
	if current_user = 'authenticated' and public.is_admin() then
		return NEW;
	end if;

	if TG_OP = 'INSERT' then
		-- 거부 대신 정리 — created_at 은 DEFAULT 라 명시 여부를 구분할 수 없다(위 주석).
		NEW.membership_started_at := null;
		NEW.created_at := now();
		return NEW;
	end if;

	-- UPDATE: 값이 안 바뀌었으면(컬럼만 언급된 UPDATE) 통과, 바뀌었으면 거부.
	if NEW.membership_started_at is not distinct from OLD.membership_started_at
	   and NEW.created_at is not distinct from OLD.created_at then
		return NEW;
	end if;
	raise exception 'forbidden: members.membership_started_at / created_at 은 운영진만 변경할 수 있다'
		using errcode = '42501';
end $function$;

comment on function public.members_guard_join_date() is
	'가입일 컬럼(membership_started_at·created_at) 게이트. INSERT 는 비운영진 클라이언트 값을 정리(NULL·now())하고 UPDATE 는 거부한다. 이 두 값이 신규회원 2주 프리패스 자격과 회비 부과 시작월을 정하므로 본인이 바꿀 수 없어야 한다. authenticated 직접 UPDATE 는 운영진만, SECURITY DEFINER 서버 경로와 service_role·마이그레이션은 통과. SECURITY INVOKER 여야 성립 — definer 로 바꾸지 말 것.';

-- INSERT 는 컬럼 목록을 쓸 수 없으므로(문법상 UPDATE OF 전용) 트리거를 둘로 나눈다.
drop trigger if exists trg_members_guard_join_date on public.members;
create trigger trg_members_guard_join_date
before update of membership_started_at, created_at on public.members
for each row
execute function public.members_guard_join_date();

drop trigger if exists trg_members_guard_join_date_ins on public.members;
create trigger trg_members_guard_join_date_ins
before insert on public.members
for each row
execute function public.members_guard_join_date();

-- ------------------------------------------------------------
-- promote_next_waitlisted — **신규 프리패스는 여기에 넣지 않는다**(운영진 프리패스는 기존대로).
--
-- 왜: 승격 루프에 신규 분기를 넣으면 정원 안 대기 1순위가 영구히 밀린다. 정원 18·부과없음에서
--   확정 18(만석) + 초과 확정 신규 1명(=19명) + 대기 [pos20 일반회원, pos21 신규] 를 보자.
--   정원 안 회원 1명이 취소하면 확정 18(=정원)이라 정원 분기는 여전히 닫혀 있는데, 빈 base 자리에
--   pos19 신규가 밀려 들어오므로 '초과 확정 신규'가 0으로 떨어진다. 그래서 신규 분기가 다시 열려
--   pos21 이 확정되고 pos20 은 또 밀린다 — 취소가 반복되는 동안 pos20 은 **영구 정지**한다.
--   프리패스가 "정원을 초과해 자리를 더 만드는 것"에서 "정원 안 빈자리를 가로채는 것"으로 변질된 것이다.
--
-- 그래서 규칙을 못박는다: **신규 프리패스는 본인이 [참석하기]를 누른 그 순간에만 부여된다**
--   (join_session · set_late_minutes 정시 복귀). 그 순간 초과 자리가 이미 2칸 차 있었다면 그 신규는
--   평범한 대기자가 되어 position 순서를 지킨다. 덕분에
--     · position 이 다시 유일한 승격 순서가 된다 → 클라 waitDisplay 미러가 정확하다.
--     · 20260806020000 검증 예시 ④ "만석 && 프리패스 소진이면 아무도 승격 안 됨"이 그대로 성립한다.
--     · 취소 1건에 들어오는 인원이 종전과 같다(빈자리 + 운영진 프리패스).
-- ------------------------------------------------------------
create or replace function public.promote_next_waitlisted(p_session_id bigint)
returns public.attendances
language plpgsql security definer set search_path = ''
as $$
declare
	v_capacity int;
	v_count    int;
	v_gcap     int := public.session_guest_cap(p_session_id);
	v_opfree   boolean := public.session_op_free(p_session_id);
	v_gcount   int;
	v_ocount   int;
	v_promote  public.attendances%rowtype;
begin
	select capacity into v_capacity from public.sessions where id = p_session_id;
	v_count := public.session_counter_sync(p_session_id);
	select count(*) into v_gcount from public.attendances
	where session_id = p_session_id and status = 'confirmed' and invited_by is not null;
	select count(*) into v_ocount from public.attendances
	where session_id = p_session_id and status = 'confirmed' and public.is_operator(member_id);
	-- 대기 1순위(position ASC) 중 승급 자격자:
	--   게스트 상한 통과 && ( 정원 여유 || 부과없음 운영진 프리패스(확정 운영진 총수 < 2) ).
	--   신규 프리패스는 위 주석대로 **여기에 없다** — 부여는 join_session / set_late_minutes 에서만.
	select * into v_promote from public.attendances a
	where a.session_id = p_session_id and a.status = 'waitlisted'
		and (a.invited_by is null or v_gcap is null or v_gcount < v_gcap)
		and (
			(v_capacity is null or v_count < v_capacity)
			or (v_opfree and v_ocount < 2 and public.is_operator(a.member_id))
		)
	order by a.position asc
	for update
	limit 1;
	if not found then return v_promote; end if;

	update public.attendances
	set status = 'confirmed', confirmed_at = now(), updated_at = now()
	where session_id = v_promote.session_id and member_id = v_promote.member_id;
	update public.session_counters set confirmed_count = v_count + 1
	where session_id = p_session_id;
	return v_promote;
end;
$$;
revoke execute on function public.promote_next_waitlisted(bigint) from public, anon, authenticated;

-- ------------------------------------------------------------
-- join_session — 만석인 부과없음 일정에서 두 갈래 프리패스로 정원 초과 확정.
--   ① 운영진: 확정 운영진 총수 < 2   ② 신규회원(가입일 <= 세션날짜 <= 가입일+14): 상한 없음
--   운영진이면서 신규면 어느 쪽이든 통과한다(분기 순서는 결과에 영향 없음).
-- ------------------------------------------------------------
create or replace function public.join_session(p_session_id bigint)
returns public.attendances
language plpgsql security definer set search_path = ''
as $$
declare
	v_member       uuid := public.current_member_id();
	v_capacity     int;
	v_status       text;
	v_ends_at      timestamptz;
	v_count        int;
	v_ocount       int;
	v_existing     public.attendances%rowtype;
	v_result       public.attendances%rowtype;
	v_new          text;
	v_pos          bigint;
	v_has_existing boolean;
begin
	if v_member is null then raise exception 'not authenticated'; end if;
	-- 비활성 회원은 신청할 수 없다. 게이트가 없던 동안, 정지된 사람이(또는 본인 탈퇴 후 다시 로그인한
	--   사람이) 신청하면 attendances 에는 남는데 명단·편성(fetchMembers 가 is_active 로 걸러냄)에는
	--   안 나오는 유령 행이 됐다 — 20260819030000 이 게스트 쪽에서 지적한 "신청은 됐는데 보드에 없는"
	--   상태와 같은 종류다. 게스트는 add_guest_attendance 를 쓰고 그쪽은 이미 is_active 를 본다.
	--   (20260821020000 에서 들어온 게이트 — join_session 재정의 시 반드시 함께 옮긴다.)
	if not exists (select 1 from public.members where id = v_member and is_active) then
		raise exception 'member inactive';
	end if;

	select capacity, status, ends_at
		into v_capacity, v_status, v_ends_at
	from public.sessions where id = p_session_id for share;
	if not found then raise exception 'session not found'; end if;
	if v_status not in ('open', 'active') then raise exception 'session not open'; end if;
	if v_ends_at is not null and v_ends_at <= now() then
		raise exception 'session ended';
	end if;

	v_count := public.session_counter_sync(p_session_id);

	select * into v_existing from public.attendances
	where session_id = p_session_id and member_id = v_member for update;
	v_has_existing := found;

	if v_has_existing and v_existing.status in ('confirmed','waitlisted') then
		raise exception 'already joined';
	end if;

	if v_capacity is null or v_count < v_capacity then
		-- 정원 여유 → 확정(회원/운영진 공통).
		v_new := 'confirmed';
		update public.session_counters set confirmed_count = v_count + 1
			where session_id = p_session_id;
	elsif public.session_op_free(p_session_id) then
		-- 만석인 부과없음 일정 → 프리패스 두 갈래(각자 별도 상한).
		select count(*) into v_ocount from public.attendances
		where session_id = p_session_id and status = 'confirmed' and public.is_operator(member_id);

		if public.is_operator(v_member) and v_ocount < 2 then
			v_new := 'confirmed';                                    -- ① 운영진 프리패스
		elsif public.session_newbie_grace(p_session_id, v_member) then
			v_new := 'confirmed';                                    -- ② 신규회원 2주 프리패스(상한 없음)
		else
			v_new := 'waitlisted';
		end if;

		if v_new = 'confirmed' then
			update public.session_counters set confirmed_count = v_count + 1
				where session_id = p_session_id;
		end if;
	else
		v_new := 'waitlisted';
	end if;

	v_pos := nextval('public.attendance_position_seq');

	if v_has_existing then
		update public.attendances set
			status = v_new, position = v_pos, requested_at = now(),
			confirmed_at = case when v_new = 'confirmed' then now() else null end,
			cancelled_at = null, updated_at = now()
		where session_id = p_session_id and member_id = v_member
		returning * into v_result;
	else
		insert into public.attendances(session_id, member_id, status, position, confirmed_at)
		values (p_session_id, v_member, v_new, v_pos,
			case when v_new = 'confirmed' then now() else null end)
		returning * into v_result;
	end if;

	if v_status = 'active' and v_new = 'confirmed' then
		insert into public.session_players
			(session_id, player_id, member_id, name, gender, skills, status, wait_since)
		select
			p_session_id, m.id::text, m.id, m.name, m.gender,
			case when m.skills ? 'grade' then m.skills else jsonb_build_object('grade', 5) end,
			'waiting', now()
		from public.members m
		where m.id = v_member
		on conflict (session_id, player_id) do nothing;
	end if;

	return v_result;
end;
$$;
grant execute on function public.join_session(bigint) to authenticated;

-- ------------------------------------------------------------
-- set_late_minutes — 정원외늦참 → 정시 복귀 시에도 두 갈래 프리패스(운영진 총수 < 2 / 신규는 상한 없음).
--   (풀 진입 시의 빈자리 루프 승격 등 20260806010000 동작은 유지)
-- ------------------------------------------------------------
create or replace function public.set_late_minutes(p_session_id bigint, p_minutes int)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
	v_member    uuid := public.current_member_id();
	v_start     timestamptz;
	v_end       timestamptz;
	v_capacity  int;
	v_status    text;
	v_max       int;
	v_min       int := p_minutes;
	v_cutoff    timestamptz;
	v_arrival   timestamptz;
	v_pool      boolean;
	v_count     int;
	v_ocount    int;
	v_self      public.attendances%rowtype;
	v_new       text;
	v_promoted  int := 0;
begin
	if v_member is null then raise exception 'not authenticated'; end if;
	if v_min is null or v_min < 0 or v_min % 30 <> 0 then
		raise exception 'invalid minutes';
	end if;

	select scheduled_at, ends_at, capacity, status
		into v_start, v_end, v_capacity, v_status
	from public.sessions where id = p_session_id for share;
	if not found then raise exception 'session not found'; end if;
	if v_start is null then raise exception 'session has no schedule'; end if;
	if v_end is not null and v_end <= now() then raise exception 'session ended'; end if;

	-- 세션 길이(분)로 상한 — 종료 시각엔 늦참이 없으므로 "종료 미만" 최대 30분 스텝.
	if v_end is not null then
		v_max := greatest(
			0,
			floor((extract(epoch from (v_end - v_start)) / 60 - 1) / 30)::int * 30
		);
		if v_min > v_max then v_min := v_max; end if;
	end if;

	-- 경계 = 경기 후반 2/3 지점(길이 기준). 예) 18:00~21:00(3h) → +2h = 20:00("8시").
	v_arrival := v_start + make_interval(mins => v_min);
	if v_end is not null then
		v_cutoff := v_start + (v_end - v_start) * (2.0 / 3.0);
		v_pool   := v_arrival >= v_cutoff;
	else
		v_pool := false;
	end if;

	v_count := public.session_counter_sync(p_session_id);

	select * into v_self from public.attendances
	where session_id = p_session_id and member_id = v_member for update;
	if not found or v_self.status = 'cancelled' then raise exception 'not attending'; end if;

	v_new := v_self.status;

	if v_status = 'open' and v_pool and v_self.status in ('confirmed','waitlisted') then
		v_new := 'late_pool';
		update public.attendances
		set status = 'late_pool', late_minutes = v_min, confirmed_at = null, updated_at = now()
		where session_id = p_session_id and member_id = v_member;

		if v_self.status = 'confirmed' then
			perform public.session_counter_sync(p_session_id);   -- 정원 1칸 반납 반영
			v_promoted := public.promote_waitlist_fill(p_session_id);
		end if;

	elsif v_status = 'open' and not v_pool and v_self.status = 'late_pool' then
		-- 정원 외 풀 → 복귀. 여유면 확정, 만석이면 부과없음 프리패스(운영진 총수 < 2 / 신규 상한 없음), 그 외 대기.
		if v_capacity is null or v_count < v_capacity then
			v_new := 'confirmed';
			update public.session_counters set confirmed_count = v_count + 1
				where session_id = p_session_id;
		elsif public.session_op_free(p_session_id) then
			select count(*) into v_ocount from public.attendances
			where session_id = p_session_id and status = 'confirmed' and public.is_operator(member_id);

			if public.is_operator(v_member) and v_ocount < 2 then
				v_new := 'confirmed';
			elsif public.session_newbie_grace(p_session_id, v_member) then
				v_new := 'confirmed';
			else
				v_new := 'waitlisted';
			end if;

			if v_new = 'confirmed' then
				update public.session_counters set confirmed_count = v_count + 1
					where session_id = p_session_id;
			end if;
		else
			v_new := 'waitlisted';
		end if;
		update public.attendances
		set status = v_new, late_minutes = v_min,
			position = nextval('public.attendance_position_seq'),
			confirmed_at = case when v_new = 'confirmed' then now() else null end,
			updated_at = now()
		where session_id = p_session_id and member_id = v_member;

	else
		update public.attendances
		set late_minutes = v_min, updated_at = now()
		where session_id = p_session_id and member_id = v_member;
	end if;

	return jsonb_build_object('status', v_new, 'promoted', v_promoted);
end;
$$;
revoke execute on function public.set_late_minutes(bigint, int) from anon;
grant execute on function public.set_late_minutes(bigint, int) to authenticated;

-- ------------------------------------------------------------
-- set_session_capacity — 그리디는 운영진 프리패스는 종전대로 부여하고, 신규 프리패스는 **유지만** 한다.
--   position 순으로 훑으며 v_o(확정 운영진 누계, 정원 안 포함)를 센다.
--   만석 이후: v_o < 2 인 운영진은 초과 확정(기존 규칙 그대로),
--              **이미 confirmed 인** 신규는 그 자리를 유지(대기 신규에게 새로 주지 않는다 — 상한이 없어도
--              그리디가 부여까지 하면 대기 신규가 앞 순번 일반 회원을 추월한다).
--   이 비대칭이 런타임(promote 에 신규 분기 없음)과 그리디를 같은 결과로 묶는다 — 정원을 같은 값으로
--   다시 저장해도 승격/강등 0이고, 대기 신규가 정원 안 대기 1순위를 추월하지도 않는다.
-- ------------------------------------------------------------
create or replace function public.set_session_capacity(
	p_session_id bigint, p_capacity int
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
	v_status   text;
	v_opfree   boolean := public.session_op_free(p_session_id);
	v_gcap     int     := public.session_guest_cap(p_session_id);
	v_cc       int := 0;   -- 확정 누계(회원+운영진+게스트)
	v_o        int := 0;   -- 확정 운영진 누계(정원 안·초과 모두 포함)
	v_g        int := 0;   -- 확정 게스트 누계
	v_att      public.attendances%rowtype;
	v_want     text;
	v_isop     boolean;
	v_isguest  boolean;
	v_isnew    boolean;
	v_promoted int := 0;
	v_demoted  int := 0;
begin
	if not public.is_admin() then raise exception 'forbidden'; end if;

	update public.sessions set capacity = p_capacity
	where id = p_session_id
	returning status into v_status;
	if not found then raise exception 'session not found'; end if;

	if v_status <> 'open' then
		perform public.session_counter_sync(p_session_id);   -- 진행/종료 세션도 카운터는 실제값으로
		return jsonb_build_object('promoted', 0, 'demoted', 0);
	end if;

	perform public.session_counter_sync(p_session_id);

	for v_att in
		select * from public.attendances
		where session_id = p_session_id and status in ('confirmed', 'waitlisted')
		order by position asc
		for update
	loop
		v_isop := public.is_operator(v_att.member_id);
		v_isguest := v_att.invited_by is not null;
		v_isnew := not v_isguest
			and public.session_newbie_grace(p_session_id, v_att.member_id);

		if (p_capacity is null or v_cc < p_capacity)
		   and (not v_isguest or v_gcap is null or v_g < v_gcap) then
			v_want := 'confirmed';                                   -- 정원 여유 + 게스트 상한 여유
		elsif v_opfree and v_isop and v_o < 2 then
			v_want := 'confirmed';                                   -- 부과없음 운영진 프리패스
		elsif v_opfree and v_isnew and v_att.status = 'confirmed' then
			-- 이미 프리패스로 들어와 있는 신규는 **유지**(재계산으로 강등되면 demoted 알림이 날아간다).
			-- 새로 **부여**하지는 않는다 — 부여는 본인이 누른 순간에만.
			v_want := 'confirmed';
		else
			v_want := 'waitlisted';
		end if;

		if v_want = 'confirmed' then
			v_cc := v_cc + 1;
			if v_isop then v_o := v_o + 1; end if;
			if v_isguest then v_g := v_g + 1; end if;
		end if;

		if v_want <> v_att.status then
			update public.attendances
			set status = v_want,
				confirmed_at = case when v_want = 'confirmed' then now() else null end,
				updated_at = now()
			where session_id = p_session_id and member_id = v_att.member_id;

			if v_want = 'confirmed' then v_promoted := v_promoted + 1;
			else v_demoted := v_demoted + 1; end if;

			insert into public.notifications(recipient_member_id, type, session_id, payload)
			values (
				coalesce(v_att.invited_by, v_att.member_id),
				case when v_want = 'confirmed' then 'promoted' else 'demoted' end,
				p_session_id,
				jsonb_build_object('session_id', p_session_id)
					|| case when v_att.invited_by is not null then jsonb_build_object(
						'guest_name', (select name from public.members where id = v_att.member_id))
						else '{}'::jsonb end
			);
		end if;
	end loop;

	update public.session_counters set confirmed_count = v_cc where session_id = p_session_id;
	return jsonb_build_object('promoted', v_promoted, 'demoted', v_demoted);
end;
$$;
revoke execute on function public.set_session_capacity(bigint, int) from anon;
grant execute on function public.set_session_capacity(bigint, int) to authenticated;
