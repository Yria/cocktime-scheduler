-- ============================================================
-- add_guest_attendance — 같은 게스트가 다시 오면 members 행을 재사용한다.
--
-- 배경: 이 함수는 게스트 신청마다 members 를 무조건 insert 했다(20260726100000:222).
--   그래서 "같은 사람"이 방문할 때마다 새 uuid 가 생겨 프로덕션에 게스트 47행이 쌓였고
--   실인원은 30명이었다(잉여 17행). 이 잉여가 새는 유일한 화면이 정산함(/dues/:ym/inbox)
--   납부자 후보·검색이다 — 미납 대관비는 0원이라 돈 문제가 아니라 후보 목록 오염 문제다.
--   (회원관리는 is_guest=false 로 걸러 게스트를 아예 보여주지 않는다.)
--
-- 정책: 이름(공백·대소문자 무시) + 성별이 같은 기존 게스트 행이 있으면 그 행으로 신청을 붙인다.
--   · 성별까지 같아야 재사용한다 — 이름만으로 합치면 동명이인 게스트(남 김민수 / 여 김민수)가
--     한 사람으로 뭉쳐 과거 참석·회계가 남의 것으로 붙는다. 오합치는 되돌리기 어렵고(회계 CASCADE)
--     분리보다 훨씬 비싸므로, 애매하면 새 행을 만드는 쪽으로 기운 판정을 쓴다.
--   · 후보가 여러 행이면 created_at desc 로 최신 1행. 과거 잔재(47행)를 지금 합치지는 않으므로
--     "가장 최근에 쓰던 행"에 계속 붙는 게 사람 감각과 맞다.
--   · skills 는 이번 입력으로 갱신한다(기존 키는 유지하고 들어온 키만 덮는다). 초대자가 부를 때마다
--     grade 를 다시 매기는 게 실측이고(문병기 6→7→1→1), 첫 값을 굳히면 최근 평가가 영원히 묻힌다.
--     과거 편성 근거는 session_players.skills 스냅샷에 남으므로 이력을 잃지 않는다.
--   · is_active=false 로 접힌 게스트 행이면 true 로 되살린다. 게스트는 원래 항상 활성이고,
--     is_active=false 면 명단·편성(fetchMembers)에서 빠져 "신청은 됐는데 보드에 없는" 행이 된다.
--     같은 배포에서 회원관리에 '게스트 보기' 칩이 생겨 운영진이 옛 게스트 행을 접을 수 있게 됐다
--     (그게 오늘 게스트 비활성의 유일한 효과다). 접어둔 사람이 다시 오면 정의상 활성이므로 되살린다.
--
-- 거부한 대안:
--   · 이름만으로 재사용 → 동명이인 오합치(위 참조). 기각.
--   · 재사용 시 name 을 입력값으로 재정규화(btrim) → 표기 흔들림("김 지훈"/"김지훈")이 과거
--     기록 표시를 바꿔 회계 대조가 어긋난다. 이름은 만들 때 한 번만 쓴다.
--   · members 에 부분 unique 인덱스(lower(name), gender) where is_guest → 기존 47행에 이미
--     중복이 있어 인덱스 생성 자체가 실패한다. 백필이 선행돼야 하므로 이번 범위 밖.
--
-- 시그니처·반환형·권한은 그대로. 정원/게스트 상한/동명 회원 차단/카운터 갱신 등 본문 로직은
-- 20260726100000 을 그대로 계승하고, members insert 지점과 attendances insert 지점만 고쳤다.
-- ============================================================

-- 이름 동일성 판정 키(단일 소스). 서버의 두 게이트(동명 회원 차단 · 게스트 행 재사용)와
-- 클라이언트의 후보 위생(matching.normMemberName = NFC + 공백제거 + 소문자)이 같은 정의를 쓴다.
-- 판정이 갈리면 "서버에선 새 사람인데 화면에선 같은 사람"이 되어 만들어지고도 안 보이는 행이 쌓인다.
create or replace function public.name_match_key(p_name text)
returns text
language sql
immutable
set search_path = ''
as $function$
  select regexp_replace(lower(normalize(coalesce(p_name, ''), NFC)), '\s', '', 'g');
$function$;

revoke execute on function public.name_match_key(text) from public, anon, authenticated;

create or replace function public.add_guest_attendance(
	p_session_id bigint, p_name text, p_gender text, p_skills jsonb
) returns public.attendances
language plpgsql security definer set search_path = ''
as $$
declare
	v_inviter        uuid := public.current_member_id();
	v_inviter_status text;
	v_guest          uuid;
	v_capacity       int;
	v_status         text;
	v_ends_at        timestamptz;
	v_count          int;
	v_gcount         int;
	v_gcap           int := public.session_guest_cap(p_session_id);
	v_new            text;
	v_pos            bigint;
	v_result         public.attendances%rowtype;
	v_prev           public.attendances%rowtype;  -- 같은 세션에 이미 있는 그 게스트의 행
	v_reused         boolean := false;
begin
	if v_inviter is null then raise exception 'not authenticated'; end if;
	if p_name is null or btrim(p_name) = '' then raise exception 'guest name required'; end if;
	if p_gender not in ('M','F') then raise exception 'guest gender required'; end if;

	-- 이름 동일성은 한 가지 키로만 판정한다: NFC 정규화 + 소문자 + 모든 공백 제거.
	--   종전 `btrim(lower(name))` 은 내부 공백을 남겨 "김 지훈" 이 활성 회원 "김지훈" 차단을 통과했고,
	--   그렇게 만들어진 게스트 행은 정산함 후보 위생(matching.normMemberName — 공백 제거 + NFC)에서는
	--   같은 그룹으로 접혀 화면에서 사라졌다. 서버가 더 헐거우면 "만들어지지만 안 보이는 행"이 쌓인다.
	if exists (
		select 1 from public.members
		where is_guest = false and is_active = true
			and public.name_match_key(name) = public.name_match_key(p_name)
	) then
		raise exception 'name_is_member';
	end if;

	select capacity, status, ends_at
		into v_capacity, v_status, v_ends_at
	from public.sessions where id = p_session_id for share;
	if not found then raise exception 'session not found'; end if;
	if v_status <> 'open' then raise exception 'session not open'; end if;
	if v_ends_at is not null and v_ends_at <= now() then
		raise exception 'session ended';
	end if;

	select status into v_inviter_status from public.attendances
	where session_id = p_session_id and member_id = v_inviter
		and status in ('confirmed','waitlisted','late_pool')
	limit 1;
	if not found then raise exception 'must join first'; end if;

	insert into public.session_counters(session_id) values (p_session_id)
		on conflict (session_id) do nothing;
	select confirmed_count into v_count
	from public.session_counters where session_id = p_session_id for update;

	-- (변경) 같은 사람으로 판정되는 기존 게스트 행이 있으면 재사용, 없으면 새로 만든다.
	--   auth_user_id is null 조건: 게스트가 나중에 정회원 계정과 연결됐다면 그건 더 이상
	--   "게스트 행"이 아니므로 재사용 대상이 아니다(정회원은 위 name_is_member 로 막힌다).
	--   이름 비교는 위 name_is_member 와 **같은 키**(name_match_key)를 쓴다 — 두 판정이 갈리면
	--   한쪽에서 막힌 이름이 다른 쪽에서 새 행을 만든다.
	--   gender 는 `is not distinct from` — 성별이 null 인 옛 게스트 행(실측 1행: 우창형)이 `=` 비교에서
	--   영원히 매칭되지 않아 방문마다 새 행이 생기던 구멍을 막는다.
	--   **이 조회를 카운터 FOR UPDATE 뒤에 둔다**: 같은 세션 신청은 그 락으로 직렬화되므로,
	--   두 초대자가 같은 게스트를 동시에 넣어도 뒤엣놈이 앞엣놈이 만든 행을 보고 재사용한다
	--   (앞에 두면 둘 다 후보를 못 보고 각각 INSERT 해서 아래 중복 게이트를 우회한다).
	select id into v_guest from public.members
	where is_guest = true and auth_user_id is null
		and public.name_match_key(name) = public.name_match_key(p_name)
		and gender is not distinct from p_gender
	order by created_at desc
	limit 1;
	v_reused := found;

	if v_reused then
		-- 되살리기 + skills 갱신(이번 입력이 이긴다). name 은 만들 때 값 그대로 보존.
		--   실측 근거: 같은 게스트를 부를 때마다 초대자가 넣는 grade 가 실제로 달라진다
		--   (문병기 6→7→1→1, 김윤호 6→1→3, 김준해 1→8). 첫 값을 굳히면 최근 평가가 영원히 무시되고,
		--   회원관리에서 게스트 실력 편집 진입점도 없어(보드 편집만 가능) 교정할 길이 사실상 없다.
		--   과거 편성의 근거는 그 세션의 session_players.skills 스냅샷에 이미 남으므로 잃는 게 없다.
		update public.members
		set is_active = true,
			skills = coalesce(skills, '{}'::jsonb) || coalesce(p_skills, '{}'::jsonb),
			updated_at = now()
		where id = v_guest;
	else
		insert into public.members(name, gender, skills, is_guest)
		values (btrim(p_name), p_gender, coalesce(p_skills, '{}'::jsonb), true)
		returning id into v_guest;
	end if;

	-- (변경) 같은 세션에 그 게스트 행이 이미 있으면 여기서 끝낸다.
	--   attendances PK 가 (session_id, member_id) 라 어차피 unique_violation 이 나지만,
	--   raw 23505 는 클라가 읽을 수 없어 "게스트 신청 실패"로만 보인다. 명시적으로 던진다.
	--   이 게이트가 실측 사고(session 103 김지훈×2 = 둘 다 취소, 114 공태호×2 = 확정 1 + 취소 1)를
	--   막는다. 재사용 조회와 함께 카운터 락 뒤에 있으므로 동시 신청도 여기서 닫힌다.
	--   FOUND 대신 v_prev.session_id 로 판정하는 이유: 아래 count(*) 가 FOUND 를 덮으므로 이 파일에서는
	--   존재 판정을 한 가지 방법(레코드 필드)으로만 한다.
	select * into v_prev from public.attendances
	where session_id = p_session_id and member_id = v_guest for update;
	if v_prev.session_id is not null and v_prev.status <> 'cancelled' then
		if v_prev.invited_by is not distinct from v_inviter then
			raise exception 'guest_already_joined';
		else
			-- 다른 회원이 같은 이름·성별로 이미 신청한 상태. 진짜 동명이인이면 여기서 막다른 길이 된다
			-- (그 행은 초대자만 취소할 수 있다) → 예외를 갈라 "이름을 구분해 달라"고 안내한다.
			raise exception 'guest_taken_by_other';
		end if;
	end if;

	select count(*) into v_gcount from public.attendances
	where session_id = p_session_id and status = 'confirmed' and invited_by is not null;

	if v_inviter_status = 'late_pool' then
		v_new := 'late_pool';
	elsif (v_capacity is null or v_count < v_capacity) and (v_gcap is null or v_gcount < v_gcap) then
		-- 정원 여유 + 게스트 상한 여유(주말=무제한)면 확정. 그 외 대기.
		v_new := 'confirmed';
		update public.session_counters set confirmed_count = confirmed_count + 1
			where session_id = p_session_id;
	else
		v_new := 'waitlisted';
	end if;

	v_pos := nextval('public.attendance_position_seq');

	if v_prev.session_id is not null then
		-- 취소했던 그 게스트를 같은 세션에 다시 초대: 재사용 전에는 새 members 행이 생겨
		-- insert 가 됐지만 이제는 PK 가 겹친다. 취소 행을 되살린다(재초대자가 소유권을 갖는다 —
		-- cancel_guest_attendance 가 invited_by 로 소유권을 검사하므로 반드시 갱신해야 한다).
		update public.attendances set
			status = v_new, position = v_pos, requested_at = now(),
			confirmed_at = case when v_new = 'confirmed' then now() else null end,
			cancelled_at = null, invited_by = v_inviter, updated_at = now()
		where session_id = p_session_id and member_id = v_guest
		returning * into v_result;
	else
		insert into public.attendances(session_id, member_id, status, position, confirmed_at, invited_by)
		values (p_session_id, v_guest, v_new, v_pos,
			case when v_new = 'confirmed' then now() else null end, v_inviter)
		returning * into v_result;
	end if;

	return v_result;
end;
$$;

-- 권한은 기존과 동일(클라 RPC): anon·PUBLIC 회수, authenticated 유지.
revoke execute on function public.add_guest_attendance(bigint, text, text, jsonb) from public, anon;
grant execute on function public.add_guest_attendance(bigint, text, text, jsonb) to authenticated;

-- ------------------------------------------------------------
-- 백필(기존 47행 → 30명 병합)은 이 마이그레이션에서 하지 않는다.
--   · 같은 세션에 잔재 두 행이 함께 있는 사례가 실제로 있어(103 = 둘 다 취소, 114 = 확정 1 + 취소 1)
--     병합하면 attendances PK (session_id, member_id) 가 충돌한다. 어느 행을 버릴지는 회계를 봐야 한다.
--   · dues_charges / dues_allocations 가 member_id 로 매달려 있어 병합은 공개회계 수치를
--     움직인다(누가 얼마 냈나의 귀속이 바뀐다). 마이그레이션이 조용히 할 일이 아니다.
--   · 하드삭제는 금지 — dues_charges·dues_allocations·attendances 가 ON DELETE CASCADE 라
--     행을 지우면 회계가 함께 사라진다. 정리는 delete 가 아니라 병합/비활성으로만.
--   이 마이그레이션의 목적은 "증가를 멈추는 것"이다. 잔재 정리는 별도 작업으로 다룬다.
-- ------------------------------------------------------------
