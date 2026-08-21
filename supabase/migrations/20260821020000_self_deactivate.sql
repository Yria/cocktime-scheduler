-- 회원 화면 [회원 탈퇴] 를 **비활성 로직**으로 바꾼다 — 계정 삭제를 그만두고 운영진 [비활성] 과 같은 일을 한다.
--
-- 왜: 실제 운영은 회원이 나갈 때 **운영진이 [비활성] 로 처리**한다. 본인 탈퇴(`delete_my_account`)는
--   auth 계정까지 지워 **되돌릴 수 없고**, 돌아오는 사람은 계정을 새로 만들어야 해서 members 행이 하나 더
--   생긴다 — 그러면 회비 이력이 끊기고 운영진이 `membership_started_at` 을 손으로 보정해야 한다
--   (2026-08-21 조민서 님 케이스가 정확히 그 모양이다). 게다가 그 함수는 2026-08-19 부터 `ops_audit`
--   CHECK 누락으로 **항상 실패**해서, 회원이 버튼을 누르면 실패 문구만 봤다.
--   고쳐서 되살릴 이유가 없다 — 쓰지 않는 경로다. 버튼이 하는 일을 비활성으로 바꾸는 게 맞다.
--
-- 바뀌는 것: [회원 탈퇴] → `deactivate_my_account()`
--   · `is_active=false` (→ 기존 트리거들이 그대로 돈다: 그 달 미납 회비 미부과 처리)
--   · 안 끝난 세션 참석은 정식 경로(`cancel_attendance`)로 취소 — 나간 사람이 정원을 잡고 있으면 안 된다
--   · 푸시 구독 삭제 — 나간 사람에게 알림이 가면 안 된다
--   · **계정·개인정보·회원 행은 그대로 둔다.** 돌아올 때 운영진이 [재활성화] 하면 끝이고,
--     `rejoined_at` 스탬프(20260821010000)와 합류월 하한(20260821000000)이 자동으로 적용된다.
--
-- 함께 넣는 것 — `join_session` 에 `is_active` 게이트. 이게 없으면 위 변경이 무의미하다: 계정을 남기므로
--   나간 사람이 다시 로그인할 수 있고, 지금 `join_session` 은 활성 여부를 보지 않아 **그대로 신청이 된다**.
--   그러면 attendances 엔 있는데 명단·편성에는 없는 유령 행이 생긴다(`fetchMembers` 가 is_active 로 걸러냄).
--   이 게이트는 **운영진이 정지시킨 회원에게도 같이 적용된다** — 원래 그래야 했던 동작이다.
--
-- 감사 로그를 위해 `ops_audit.kind` 에 도메인 값 `'member'` 을 추가한다(CHECK 가 attendance|counter|session
--   뿐이라 회원 이벤트를 남길 자리가 없었다). 행위는 `detail.action` 에 둔다 — kind 에 행위를 적으면
--   이벤트가 늘 때마다 CHECK 를 고쳐야 하고, 그걸 안 고쳐서 난 사고가 바로 20260819010000 이다.
--
-- `delete_my_account` 는 **고치지 않고 봉인**한다(authenticated EXECUTE 회수). 안 쓰는 경로를 되살리면
--   "월말 탈퇴로 그 달 회비 회피 후 새 계정 재가입" 구멍이 함께 열린다. 남겨 두되 닫는다.

-- ── 1. ops_audit: 회원 도메인 이벤트 허용 ─────────────────────────────
alter table public.ops_audit
	drop constraint if exists ops_audit_kind_check;
alter table public.ops_audit
	add constraint ops_audit_kind_check
	check (kind in ('attendance', 'counter', 'session', 'member'));

comment on table public.ops_audit is
	'참석/카운터/일정/회원 변경 감사 로그. txid 로 묶으면 한 트랜잭션에서 무엇이 함께 바뀌었는지 확인된다. kind 는 도메인(attendance|counter|session|member)이고 구체적 행위는 detail.action 에 둔다 — kind 에 행위를 적으면 CHECK 를 계속 고쳐야 한다(20260819010000 사고).';

-- ── 2. 본인 비활성 RPC ────────────────────────────────────────────────
create or replace function public.deactivate_my_account()
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare
	v_uid    uuid := auth.uid();
	v_member uuid;
	v_sid    bigint;
begin
	if v_uid is null then
		raise exception 'not authenticated';
	end if;

	select id into v_member from public.members where auth_user_id = v_uid;
	if v_member is null then
		-- 회원 행 없이 auth 계정만 남은 경우(가입 중단 등) — 비활성할 대상이 없다.
		return;
	end if;

	-- ① 안 끝난 세션의 참석을 정식 경로로 취소한다(정원·카운터·대기 승격이 함께 정리된다).
	--   closed/cancelled 세션은 cancel_attendance 가 'session ended' 로 거부하므로 제외.
	for v_sid in
		select a.session_id
		from public.attendances a
		join public.sessions s on s.id = a.session_id
		where a.member_id = v_member
		  and a.status <> 'cancelled'
		  and s.status in ('draft', 'open', 'active')
	loop
		perform public.cancel_attendance(v_sid);
	end loop;

	-- ② 비활성. 운영진 [비활성] 과 같은 UPDATE 라 기존 트리거가 그대로 돈다
	--   (trg_members_uncharge_dues_on_deactivate → 그 달 미납 회비 미부과 처리).
	--   auth_user_id·개인정보·회원 행은 건드리지 않는다 — 재활성화로 되돌릴 수 있어야 한다.
	update public.members
	set is_active  = false,
	    updated_at = now()
	where id = v_member;

	-- ③ 나간 사람에게 푸시가 가지 않게 구독 정리.
	delete from public.push_subscriptions where member_id = v_member;

	-- ④ 감사 로그. **업무 트랜잭션을 죽이지 못하게 예외를 삼킨다** — 20260819010000 이 이 자리에서
	--   CHECK 위반으로 탈퇴 전체를 롤백시켰다. actor 는 v_member 로 직접 넣는다(ops_audit_write 는
	--   current_member_id() 를 쓰는데, 그건 auth 링크에 의존해 이 경로에서도 굳이 우회할 이유가 없다).
	begin
		insert into public.ops_audit (kind, member_id, detail, actor, db_user, jwt_role, req_method, req_path)
		values ('member', v_member,
		        jsonb_build_object('action', 'self_deactivate',
		                          'why', '본인 요청 비활성 — 회원 행·계정·부과 이력 보존, 재활성화로 복구 가능'),
		        v_member,
		        current_user,
		        nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
		        nullif(current_setting('request.method', true), ''),
		        nullif(current_setting('request.path', true), ''));
	exception when others then
		null;
	end;
end $function$;

revoke execute on function public.deactivate_my_account() from public, anon;
grant execute on function public.deactivate_my_account() to authenticated;

comment on function public.deactivate_my_account() is
	'본인 요청 비활성(회원 화면 [회원 탈퇴]). is_active=false + 미종료 세션 참석 취소 + 푸시 구독 삭제. 계정·개인정보·회원 행·부과 이력은 보존 — 돌아오면 운영진 [재활성화] 로 복구한다. 계정을 지우는 delete_my_account 를 대체한다(20260821020000).';

-- ── 3. delete_my_account 봉인 ─────────────────────────────────────────
revoke execute on function public.delete_my_account() from authenticated;

comment on function public.delete_my_account() is
	'폐지(20260821020000). 대체 = deactivate_my_account. auth 계정을 지워 되돌릴 수 없고, 돌아오는 사람이 members 행을 새로 만들어 회비 이력이 끊긴다. 2026-08-19 부터 ops_audit CHECK 누락으로 항상 실패했고(고치지 않았다) authenticated EXECUTE 도 회수했다 — 호출하지 말 것.';

-- ── 4. join_session: 비활성 회원 신청 차단 ────────────────────────────
CREATE OR REPLACE FUNCTION public.join_session(p_session_id bigint)
 RETURNS attendances
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
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
begin
	if v_member is null then raise exception 'not authenticated'; end if;
	-- 비활성 회원은 신청할 수 없다. 게이트가 없던 동안, 정지된 사람이(또는 본인 탈퇴 후 다시 로그인한
	--   사람이) 신청하면 attendances 에는 남는데 명단·편성(fetchMembers 가 is_active 로 걸러냄)에는
	--   안 나오는 유령 행이 됐다 — 20260819030000 이 게스트 쪽에서 지적한 "신청은 됐는데 보드에 없는"
	--   상태와 같은 종류다. 게스트는 add_guest_attendance 를 쓰고 그쪽은 이미 is_active 를 본다.
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
	elsif public.is_operator(v_member) and public.session_op_free(p_session_id) then
		-- 만석인 부과없음 일정 → 확정 운영진이 2명 미만이면 프리패스(정원 초과 확정).
		select count(*) into v_ocount from public.attendances
		where session_id = p_session_id and status = 'confirmed' and public.is_operator(member_id);
		if v_ocount < 2 then
			v_new := 'confirmed';
			update public.session_counters set confirmed_count = v_count + 1
				where session_id = p_session_id;
		else
			v_new := 'waitlisted';
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
$function$;
