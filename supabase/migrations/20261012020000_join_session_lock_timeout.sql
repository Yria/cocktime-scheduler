-- join_session 의 회차 카운터 잠금 대기 상한(lock_timeout 2s).
--
-- 2026-10-11 일요일 18:00 공개 때 약 25초 동안 앱 전체가 멈췄다. join_session 은 같은 회차의 신청을
--   session_counters FOR UPDATE 로 한 줄로 세우는데(정원 초과 방지 — 의도된 설계), 과부하로 앞사람이
--   8초(statement_timeout)를 버티는 동안 뒷사람들이 PostgREST 연결(무료 플랜 약 10개)을 붙잡고 기다렸고,
--   풀이 바닥나 장소 조회 같은 무관한 GET 까지 평균 13초씩 밀렸다. 평상시 잠금 보유는 수십 ms 다.
--
-- 대기 상한을 2초로 두면 오래 기다릴 요청은 55P03(lock_not_available)으로 일찍 연결을 돌려주고,
--   클라이언트(joinSession)가 잠깐 뒤 재시도한다. 실패는 예외 → 롤백이라 정원·티켓 정합성은 그대로다.
--
-- 본문은 프로덕션 정의(20261002000000)와 동일하다 — 바뀐 것은 SET lock_timeout 한 줄뿐.
--   ⚠ join_session 을 다시 정의할 때 이 SET 도 반드시 함께 옮긴다(CREATE OR REPLACE 는 SET 목록을 덮어쓴다).

CREATE OR REPLACE FUNCTION public.join_session(p_session_id bigint, p_use_ticket boolean DEFAULT false)
 RETURNS attendances
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET lock_timeout TO '2s'
AS $function$
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
	v_exempt       boolean := false;
	v_reason       text;
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
		-- 정원 여유 → 확정(회원/운영진 공통). 여기서는 티켓을 쓰지 않는다 —
		--   p_use_ticket=true 로 와도 공짜로 들어갈 수 있으면 소모하지 않는다(분기 순서가 곧 정책이다).
		v_new := 'confirmed';
		update public.session_counters set confirmed_count = v_count + 1
			where session_id = p_session_id;
	else
		-- 만석 — 예외 세 갈래를 **순서대로** 본다.
		if public.session_op_free(p_session_id) then
			-- 부과없음 일정의 두 프리패스(각자 별도 상한). 종전 그대로.
			select count(*) into v_ocount from public.attendances
			where session_id = p_session_id and status = 'confirmed' and public.is_operator(member_id);

			if public.is_operator(v_member) and v_ocount < public.operator_freepass_limit(v_capacity) then
				-- ① 운영진 프리패스 — 종전대로 **정원 카운트에 든다**(초과분이 카운터에 남는다).
				v_new := 'confirmed';
				update public.session_counters set confirmed_count = v_count + 1
					where session_id = p_session_id;
			elsif public.session_newbie_grace(p_session_id, v_member)
				and public.newbie_freepass_used(p_session_id) < public.newbie_freepass_limit() then
				-- ② 신규회원 2주 프리패스 — **정원 외 자리**. 카운터를 올리지 않는다.
				v_new := 'confirmed';
				v_exempt := true;
				v_reason := 'newbie';
			end if;
		end if;

		-- ③ 우선참여권(티켓) — **session_op_free 게이트 밖**이다(C5: 모든 일정).
		--    ①② 뒤에 오므로 공짜로 들어갈 수 있는 사람은 티켓을 절대 소모하지 않는다.
		--    상한·잔액 검사는 session_counters FOR UPDATE(session_counter_sync) 안쪽이라
		--    같은 회차의 동시 신청이 직렬화된다 — 게스트 상한과 같은 규약(20260712010000:15-22).
		if v_new is null and p_use_ticket then
			if public.wait_ticket_session_used(p_session_id) >= public.wait_ticket_session_cap() then
				raise exception 'ticket_session_cap';
			end if;
			if public.wait_points_recount(v_member) < public.wait_ticket_cost() then
				raise exception 'ticket_insufficient';
			end if;
			v_new := 'confirmed';
			v_exempt := true;
			v_reason := 'ticket';
			perform public.wait_points_write(
				v_member, p_session_id, 'spend', -public.wait_ticket_cost(),
				jsonb_build_object('reason', 'join'));
			-- 실패는 전부 **예외**다 → 트랜잭션이 통째로 롤백되므로
			--   "차감됐는데 자리를 못 받은" 상태는 구조적으로 존재할 수 없다.
		end if;

		if v_new is null then v_new := 'waitlisted'; end if;
	end if;

	v_pos := nextval('public.attendance_position_seq');

	if v_has_existing then
		update public.attendances set
			status = v_new, position = v_pos, requested_at = now(),
			confirmed_at = case when v_new = 'confirmed' then now() else null end,
			capacity_exempt = v_exempt,   -- 재신청이면 지난 자리의 성격을 물려받지 않게 항상 덮어쓴다
			exempt_reason = v_reason,     -- capacity_exempt 와 항상 쌍으로
			cancelled_at = null, updated_at = now()
		where session_id = p_session_id and member_id = v_member
		returning * into v_result;
	else
		insert into public.attendances(
			session_id, member_id, status, position, confirmed_at, capacity_exempt, exempt_reason)
		values (p_session_id, v_member, v_new, v_pos,
			case when v_new = 'confirmed' then now() else null end, v_exempt, v_reason)
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
$function$;

