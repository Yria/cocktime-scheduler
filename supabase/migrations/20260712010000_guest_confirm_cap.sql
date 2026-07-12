-- ============================================================
-- 게스트 확정 상한(세션당 2명) + 동명 회원 게스트 차단 + 기존 위반 데이터 정리
--
-- 요청:
--   ① "세션당 게스트는 최대 2명이 참여하고 나머진 게스트가 빠지기 전까지 대기." — 정원(capacity)과 별개로,
--      confirmed 게스트를 세션당 최대 2명으로 상한. 3번째부터는 waitlisted 로 접수되고, 확정 게스트가
--      빠질(취소/제거/강등) 때만 승급 대상이 된다. 회원은 이 상한과 무관(기존 정원 규칙 그대로).
--   ② "게스트로 이름을 넣는데 회원 중 있으면 회원인 것처럼 들어간다." — 활성 회원(is_guest=false, is_active)과
--      같은 이름은 게스트로 신청할 수 없게 막는다(회원 본인은 직접 참석 신청). 서버가 근본 차단.
--   ③ 기존 DB 위반(현재 open 세션 중 확정 게스트가 2명을 초과한 곳)을 이 마이그레이션에서 함께 정리. 알림 없음.
--
-- 설계:
--   · "확정 게스트 수" 는 별도 카운터를 두지 않고 count(*) 로 판정한다. 이 값은 언제나 session_counters 행을
--     FOR UPDATE 로 잠근 임계구역 안에서만 읽으며, 세션의 모든 참석 상태 전이 RPC(join/cancel/guest/admin/
--     late/capacity)가 같은 락을 먼저 잡아 직렬화되므로 count(*) 가 경쟁 없이 정확하다. (정원 총량 판정에
--     confirmed_count 카운터를 쓰는 규칙은 유지 — 그건 락 밖 노출/비원자 PATCH 이력 때문. 게스트 하위상한은
--     100% 락 안에서만 읽으므로 count(*) 로 충분하고, 6개 전이 지점에 카운터 증감 배선을 추가하는 드리프트
--     위험을 피한다.)
--   · 승급 로직을 단일 헬퍼 promote_next_waitlisted() 로 모아 상한 규칙이 한 곳에 살게 한다(누락 방지).
--     헬퍼는 알림을 넣지 않는다 — 호출자가 상황에 맞는 알림을 그대로 INSERT 한다. set_session_capacity 는
--     배치 승격/강등을 자체 카운팅하므로 헬퍼 대신 인라인으로 상한을 반영한다.
-- ============================================================

-- ① 대기 1순위 자동 승급 헬퍼 — 게스트 확정 상한(2) 존중.
--    호출 규약: 반드시 해당 세션 session_counters 행을 FOR UPDATE 로 잠근 상태에서 호출(직렬화 → count(*) 안전).
--    정원 여유는 호출자가 보장(취소/강등으로 1칸 이상 비운 직후에 호출). 승급 대상이 없으면 NULL 로우 반환.
--    부수효과: 승급 대상 attendance 를 confirmed 로 바꾸고 confirmed_count 를 1 증가. 알림은 넣지 않는다.
create or replace function public.promote_next_waitlisted(p_session_id bigint)
returns public.attendances
language plpgsql security definer set search_path = ''
as $$
declare
	v_gcount  int;
	v_promote public.attendances%rowtype;
begin
	-- 현재 확정 게스트 수(락 보유 하 count(*) 안전).
	select count(*) into v_gcount from public.attendances
	where session_id = p_session_id and status = 'confirmed' and invited_by is not null;

	-- 대기 1순위(position ASC) — 단, 게스트(invited_by 有)는 확정 게스트가 2명 미만일 때만 대상.
	select * into v_promote from public.attendances
	where session_id = p_session_id and status = 'waitlisted'
		and (invited_by is null or v_gcount < 2)
	order by position asc
	for update skip locked
	limit 1;
	if not found then return v_promote; end if;  -- NULL 로우(승급 대상 없음)

	update public.attendances
	set status = 'confirmed', confirmed_at = now(), updated_at = now()
	where session_id = v_promote.session_id and member_id = v_promote.member_id;
	update public.session_counters set confirmed_count = confirmed_count + 1
	where session_id = p_session_id;
	return v_promote;
end;
$$;

-- 내부 전용(다른 SECURITY DEFINER RPC 및 이 마이그레이션에서만 호출).
revoke execute on function public.promote_next_waitlisted(bigint) from public;

-- ② 게스트 신청 — 동명 회원 차단 + 확정 상한(2). 본문은 20260708010000(late_pool) 최신본 계승.
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
	v_new            text;
	v_pos            bigint;
	v_result         public.attendances%rowtype;
begin
	if v_inviter is null then raise exception 'not authenticated'; end if;
	if p_name is null or btrim(p_name) = '' then raise exception 'guest name required'; end if;
	if p_gender not in ('M','F') then raise exception 'guest gender required'; end if;

	-- 동명 회원 차단 — 활성 회원(계정 보유 = is_guest=false, is_active)과 같은 이름은 게스트로 신청 불가.
	-- (게스트가 실제 회원과 구분 안 돼 "회원처럼" 들어가는 혼동 방지. 회원 본인은 직접 참석 신청하게 유도.)
	if exists (
		select 1 from public.members
		where is_guest = false and is_active = true
			and btrim(lower(name)) = btrim(lower(p_name))
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

	-- 참석 가드 — 본인이 확정/대기/정원외늦참으로 참석 중이어야 게스트 신청 가능.
	select status into v_inviter_status from public.attendances
	where session_id = p_session_id and member_id = v_inviter
		and status in ('confirmed','waitlisted','late_pool')
	limit 1;
	if not found then raise exception 'must join first'; end if;

	insert into public.members(name, gender, skills, is_guest)
	values (btrim(p_name), p_gender, coalesce(p_skills, '{}'::jsonb), true)
	returning id into v_guest;

	insert into public.session_counters(session_id) values (p_session_id)
		on conflict (session_id) do nothing;
	select confirmed_count into v_count
	from public.session_counters where session_id = p_session_id for update;

	-- 확정 게스트 수(락 보유 하 count(*) 안전) — 세션당 상한 2명.
	select count(*) into v_gcount from public.attendances
	where session_id = p_session_id and status = 'confirmed' and invited_by is not null;

	if v_inviter_status = 'late_pool' then
		-- 초대자가 정원 외 늦참이면 게스트도 정원 외(정원·상한 무관).
		v_new := 'late_pool';
	elsif (v_capacity is null or v_count < v_capacity) and v_gcount < 2 then
		-- 정원 여유 + 확정 게스트 2명 미만일 때만 확정. 그 외(정원 만석 또는 게스트 2명)는 대기.
		v_new := 'confirmed';
		update public.session_counters set confirmed_count = confirmed_count + 1
			where session_id = p_session_id;
	else
		v_new := 'waitlisted';
	end if;

	v_pos := nextval('public.attendance_position_seq');

	insert into public.attendances(session_id, member_id, status, position, confirmed_at, invited_by)
	values (p_session_id, v_guest, v_new, v_pos,
		case when v_new = 'confirmed' then now() else null end, v_inviter)
	returning * into v_result;

	return v_result;
end;
$$;

revoke execute on function public.add_guest_attendance(bigint, text, text, jsonb) from anon;
grant execute on function public.add_guest_attendance(bigint, text, text, jsonb) to authenticated;

-- ③ cancel_attendance — 승급을 헬퍼로(상한 인식). 본문은 20260707020000 계승, 승급 블록만 교체.
create or replace function public.cancel_attendance(p_session_id bigint)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
	v_member  uuid := public.current_member_id();
	v_status  text;
	v_self    public.attendances%rowtype;
	v_promote public.attendances%rowtype;
begin
	if v_member is null then raise exception 'not authenticated'; end if;

	select status into v_status from public.sessions where id = p_session_id for share;
	if not found then raise exception 'session not found'; end if;
	if v_status in ('closed', 'cancelled') then raise exception 'session ended'; end if;

	insert into public.session_counters(session_id) values (p_session_id)
		on conflict (session_id) do nothing;
	perform 1 from public.session_counters where session_id = p_session_id for update;

	select * into v_self from public.attendances
	where session_id = p_session_id and member_id = v_member for update;
	if not found or v_self.status = 'cancelled' then return; end if;

	-- 참석 취소와 함께 카풀 의향·늦참 오프셋도 해제
	update public.attendances
	set status = 'cancelled', carpool_role = 'none', carpool_seats = null,
		late_minutes = 0, cancelled_at = now(), updated_at = now()
	where session_id = p_session_id and member_id = v_member;

	if v_self.status = 'confirmed' then
		update public.session_counters set confirmed_count = confirmed_count - 1
			where session_id = p_session_id;

		if v_status = 'open' then
			v_promote := public.promote_next_waitlisted(p_session_id);
			if v_promote.member_id is not null then
				-- 승급 대상이 게스트면 초대 회원에게 guest_name 과 함께(직접 보내면 유실). 20260707020000 패턴.
				insert into public.notifications(recipient_member_id, type, session_id, payload)
				values (coalesce(v_promote.invited_by, v_promote.member_id), 'promoted', p_session_id,
					jsonb_build_object('session_id', p_session_id)
						|| case when v_promote.invited_by is not null then jsonb_build_object(
							'guest_name', (select name from public.members where id = v_promote.member_id))
							else '{}'::jsonb end);
			end if;
		end if;
	end if;
end;
$$;

grant execute on function public.cancel_attendance(bigint) to authenticated;

-- ④ cancel_guest_attendance — 승급을 헬퍼로. 본문은 20260707020000 계승, 승급 블록만 교체.
create or replace function public.cancel_guest_attendance(
	p_session_id bigint, p_guest_member_id uuid
) returns void
language plpgsql security definer set search_path = ''
as $$
declare
	v_inviter uuid := public.current_member_id();
	v_status  text;
	v_self    public.attendances%rowtype;
	v_promote public.attendances%rowtype;
begin
	if v_inviter is null then raise exception 'not authenticated'; end if;

	select status into v_status from public.sessions where id = p_session_id for share;
	if not found then raise exception 'session not found'; end if;
	if v_status in ('closed','cancelled') then raise exception 'session ended'; end if;

	insert into public.session_counters(session_id) values (p_session_id)
		on conflict (session_id) do nothing;
	perform 1 from public.session_counters where session_id = p_session_id for update;

	select * into v_self from public.attendances
	where session_id = p_session_id and member_id = p_guest_member_id for update;
	if not found then raise exception 'guest not found'; end if;
	-- 소유권: 내가 데려온 게스트만 취소 가능
	if v_self.invited_by is distinct from v_inviter then raise exception 'not your guest'; end if;
	if v_self.status = 'cancelled' then return; end if;

	update public.attendances
	set status = 'cancelled', carpool_role = 'none', carpool_seats = null,
		cancelled_at = now(), updated_at = now()
	where session_id = p_session_id and member_id = p_guest_member_id;

	if v_self.status = 'confirmed' then
		update public.session_counters set confirmed_count = confirmed_count - 1
			where session_id = p_session_id;

		if v_status = 'open' then
			v_promote := public.promote_next_waitlisted(p_session_id);
			if v_promote.member_id is not null then
				insert into public.notifications(recipient_member_id, type, session_id, payload)
				values (coalesce(v_promote.invited_by, v_promote.member_id), 'promoted', p_session_id,
					jsonb_build_object('session_id', p_session_id)
						|| case when v_promote.invited_by is not null then jsonb_build_object(
							'guest_name', (select name from public.members where id = v_promote.member_id))
							else '{}'::jsonb end);
			end if;
		end if;
	end if;
end;
$$;

grant execute on function public.cancel_guest_attendance(bigint, uuid) to authenticated;

-- ⑤ admin_cancel_attendance — 승급을 헬퍼로. 본문은 20260707010000 계승, 제거 알림 유지, 승급 블록만 교체.
create or replace function public.admin_cancel_attendance(
	p_session_id bigint, p_member_id uuid
) returns void
language plpgsql security definer set search_path = ''
as $$
declare
	v_actor      uuid := public.current_member_id();
	v_by_name    text;
	v_status     text;
	v_self       public.attendances%rowtype;
	v_promote    public.attendances%rowtype;
	v_recipient  uuid;
	v_guest_name text;
begin
	if not public.is_admin() then raise exception 'forbidden'; end if;

	select name into v_by_name from public.members where id = v_actor;

	select status into v_status from public.sessions where id = p_session_id for share;
	if not found then raise exception 'session not found'; end if;
	if v_status in ('closed', 'cancelled') then raise exception 'session ended'; end if;

	insert into public.session_counters(session_id) values (p_session_id)
		on conflict (session_id) do nothing;
	perform 1 from public.session_counters where session_id = p_session_id for update;

	select * into v_self from public.attendances
	where session_id = p_session_id and member_id = p_member_id for update;
	if not found then raise exception 'attendance not found'; end if;
	if v_self.status = 'cancelled' then return; end if;

	-- 참석 취소 + 카풀 의향·늦참 오프셋 해제(재참석 시 오래된 값 부활 방지 — cancel_attendance 와 동일).
	update public.attendances
	set status = 'cancelled', carpool_role = 'none', carpool_seats = null,
		late_minutes = 0, cancelled_at = now(), updated_at = now()
	where session_id = p_session_id and member_id = p_member_id;

	-- 제거 알림: 게스트(invited_by 有)면 초대 회원에게 게스트 이름과 함께, 회원이면 본인에게.
	-- 수신자가 운영진 본인(본인 게스트를 본인이 제거 등)이면 통지 생략.
	v_recipient := coalesce(v_self.invited_by, p_member_id);
	if v_self.invited_by is not null then
		select name into v_guest_name from public.members where id = p_member_id;
	end if;
	if v_recipient is not null and v_recipient <> v_actor then
		insert into public.notifications(recipient_member_id, type, session_id, payload)
		values (v_recipient, 'removed', p_session_id,
			jsonb_build_object('session_id', p_session_id, 'by_name', v_by_name)
			|| case when v_guest_name is not null
				then jsonb_build_object('guest_name', v_guest_name) else '{}'::jsonb end);
	end if;

	-- 확정자였으면 카운터 감소 + open 이면 대기 1순위 자동 승급(상한 인식 헬퍼).
	if v_self.status = 'confirmed' then
		update public.session_counters set confirmed_count = confirmed_count - 1
			where session_id = p_session_id;

		if v_status = 'open' then
			v_promote := public.promote_next_waitlisted(p_session_id);
			if v_promote.member_id is not null then
				insert into public.notifications(recipient_member_id, type, session_id, payload)
				values (coalesce(v_promote.invited_by, v_promote.member_id), 'promoted', p_session_id,
					jsonb_build_object('session_id', p_session_id)
						|| case when v_promote.invited_by is not null then jsonb_build_object(
							'guest_name', (select name from public.members where id = v_promote.member_id))
							else '{}'::jsonb end);
			end if;
		end if;
	end if;
end;
$$;

revoke execute on function public.admin_cancel_attendance(bigint, uuid) from anon;
grant execute on function public.admin_cancel_attendance(bigint, uuid) to authenticated;

-- ⑥ set_late_minutes — 확정→정원외늦참 전환 시 승급을 헬퍼로. 본문은 20260708010000 계승, 승급 블록만 교체.
drop function if exists public.set_late_minutes(bigint, int);
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
	v_self      public.attendances%rowtype;
	v_promote   public.attendances%rowtype;
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

	-- 세션 길이(분)로 상한 — 종료 30분 전까지, 30분 스텝(클라 슬라이더 max 와 동일 산식).
	if v_end is not null then
		v_max := greatest(
			0,
			floor((extract(epoch from (v_end - v_start)) / 60 - 1) / 30)::int * 30
		);
		if v_min > v_max then v_min := v_max; end if;
	end if;

	-- 경계 = 경기 후반 2/3 지점(길이 기준). 종료시각 필요 — 없으면 풀 판정 없이 오프셋만 갱신.
	v_arrival := v_start + make_interval(mins => v_min);
	if v_end is not null then
		v_cutoff := v_start + (v_end - v_start) * (2.0 / 3.0);
		v_pool   := v_arrival >= v_cutoff;
	else
		v_pool := false;
	end if;

	insert into public.session_counters(session_id) values (p_session_id)
		on conflict (session_id) do nothing;
	select confirmed_count into v_count
	from public.session_counters where session_id = p_session_id for update;

	select * into v_self from public.attendances
	where session_id = p_session_id and member_id = v_member for update;
	if not found or v_self.status = 'cancelled' then raise exception 'not attending'; end if;

	v_new := v_self.status;  -- 기본: 상태 불변(오프셋만 갱신)

	if v_status = 'open' and v_pool and v_self.status in ('confirmed','waitlisted') then
		-- 큐 → 정원 외 풀. 확정자였으면 정원 1칸 반납 + 대기 1순위 승급(상한 인식 헬퍼).
		v_new := 'late_pool';
		update public.attendances
		set status = 'late_pool', late_minutes = v_min, confirmed_at = null, updated_at = now()
		where session_id = p_session_id and member_id = v_member;

		if v_self.status = 'confirmed' then
			update public.session_counters set confirmed_count = confirmed_count - 1
				where session_id = p_session_id;

			v_promote := public.promote_next_waitlisted(p_session_id);
			if v_promote.member_id is not null then
				v_promoted := 1;
				insert into public.notifications(recipient_member_id, type, session_id, payload)
				values (coalesce(v_promote.invited_by, v_promote.member_id), 'promoted', p_session_id,
					jsonb_build_object('session_id', p_session_id)
						|| case when v_promote.invited_by is not null then jsonb_build_object(
							'guest_name', (select name from public.members where id = v_promote.member_id))
							else '{}'::jsonb end);
			end if;
		end if;

	elsif v_status = 'open' and not v_pool and v_self.status = 'late_pool' then
		-- 정원 외 풀 → 정시/일반 복귀. 여유 있으면 확정, 없으면 대기(큐 뒤로 재진입).
		if v_capacity is null or v_count < v_capacity then
			v_new := 'confirmed';
			update public.session_counters set confirmed_count = confirmed_count + 1
				where session_id = p_session_id;
			v_count := v_count + 1;
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
		-- 상태 전환 없음 — 오프셋만 갱신(같은 존 내 이동, 또는 비-open).
		update public.attendances
		set late_minutes = v_min, updated_at = now()
		where session_id = p_session_id and member_id = v_member;
	end if;

	return jsonb_build_object('status', v_new, 'promoted', v_promoted);
end;
$$;

revoke execute on function public.set_late_minutes(bigint, int) from anon;
grant execute on function public.set_late_minutes(bigint, int) to authenticated;

-- ⑦ set_session_capacity — 정원 재조정 시 게스트 확정 상한(2) 인식. 본문은 20260706010000 계승,
--    승격 대상 선택에 게스트 상한 필터를 인라인 반영(배치 승격/강등은 자체 카운팅 → 헬퍼 대신 인라인).
create or replace function public.set_session_capacity(
	p_session_id bigint, p_capacity int
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
	v_status   text;
	v_count    int;
	v_gcount   int;
	v_att      public.attendances%rowtype;
	v_promoted int := 0;
	v_demoted  int := 0;
begin
	if not public.is_admin() then raise exception 'forbidden'; end if;

	update public.sessions set capacity = p_capacity
	where id = p_session_id
	returning status into v_status;
	if not found then raise exception 'session not found'; end if;

	if v_status <> 'open' then
		return jsonb_build_object('promoted', 0, 'demoted', 0);
	end if;

	insert into public.session_counters(session_id) values (p_session_id)
		on conflict (session_id) do nothing;
	select confirmed_count into v_count
	from public.session_counters where session_id = p_session_id for update;

	-- 확정 게스트 수(락 보유 하 count(*) 안전) — 승격 시 상한 2명 유지에 사용. 강등/승격에 맞춰 로컬 추적.
	select count(*) into v_gcount from public.attendances
	where session_id = p_session_id and status = 'confirmed' and invited_by is not null;

	-- ① 강등: 정원 초과분만큼 최근 신청 confirmed(position DESC)를 대기로.
	if p_capacity is not null then
		loop
			exit when v_count <= p_capacity;
			select * into v_att from public.attendances
			where session_id = p_session_id and status = 'confirmed'
			order by position desc
			for update skip locked
			limit 1;
			exit when not found;

			update public.attendances
			set status = 'waitlisted', confirmed_at = null, updated_at = now()
			where session_id = v_att.session_id and member_id = v_att.member_id;
			v_count := v_count - 1;
			if v_att.invited_by is not null then v_gcount := v_gcount - 1; end if;
			v_demoted := v_demoted + 1;
			insert into public.notifications(recipient_member_id, type, session_id, payload)
			values (
				coalesce(v_att.invited_by, v_att.member_id), 'demoted', p_session_id,
				jsonb_build_object('session_id', p_session_id)
					|| case when v_att.invited_by is not null then jsonb_build_object(
						'guest_name', (select name from public.members where id = v_att.member_id))
						else '{}'::jsonb end
			);
		end loop;
	end if;

	-- ② 승격: 여유만큼 대기자(position ASC)를 참석으로. 게스트는 확정 게스트 2명 미만일 때만.
	loop
		exit when p_capacity is not null and v_count >= p_capacity;
		select * into v_att from public.attendances
		where session_id = p_session_id and status = 'waitlisted'
			and (invited_by is null or v_gcount < 2)
		order by position asc
		for update skip locked
		limit 1;
		exit when not found;

		update public.attendances
		set status = 'confirmed', confirmed_at = now(), updated_at = now()
		where session_id = v_att.session_id and member_id = v_att.member_id;
		v_count := v_count + 1;
		if v_att.invited_by is not null then v_gcount := v_gcount + 1; end if;
		v_promoted := v_promoted + 1;
		insert into public.notifications(recipient_member_id, type, session_id, payload)
		values (
			coalesce(v_att.invited_by, v_att.member_id), 'promoted', p_session_id,
			jsonb_build_object('session_id', p_session_id)
				|| case when v_att.invited_by is not null then jsonb_build_object(
					'guest_name', (select name from public.members where id = v_att.member_id))
					else '{}'::jsonb end
		);
	end loop;

	update public.session_counters set confirmed_count = v_count where session_id = p_session_id;
	return jsonb_build_object('promoted', v_promoted, 'demoted', v_demoted);
end;
$$;

revoke execute on function public.set_session_capacity(bigint, int) from anon;
grant execute on function public.set_session_capacity(bigint, int) to authenticated;

-- ⑧ 기존 위반 데이터 정리 — open 세션 중 확정 게스트가 2명을 초과한 곳을 상한(2)에 맞춘다. 알림 없음.
--    · 먼저 신청(position ASC)한 게스트 2명은 확정 유지, 나머지 확정 게스트는 대기로 강등.
--    · 강등으로 빈 정원은 대기(회원 우선; 게스트는 상한 유지)로 재승급(헬퍼 재사용, 알림 없음).
--    · active/closed 등 진행/종료 세션은 건드리지 않는다(보드 편입/정산 이후라 정합성 위험).
do $$
declare
	v_sess   record;
	v_gid    record;
	v_excess int;
	v_prom   public.attendances%rowtype;
begin
	for v_sess in
		select id, capacity from public.sessions where status = 'open'
	loop
		insert into public.session_counters(session_id) values (v_sess.id)
			on conflict (session_id) do nothing;
		perform 1 from public.session_counters where session_id = v_sess.id for update;

		select count(*) into v_excess from public.attendances
		where session_id = v_sess.id and status = 'confirmed' and invited_by is not null;
		if v_excess <= 2 then continue; end if;

		-- 3번째 이후(position ASC 기준) 확정 게스트를 대기로 강등.
		for v_gid in
			select member_id from public.attendances
			where session_id = v_sess.id and status = 'confirmed' and invited_by is not null
			order by position asc
			offset 2
		loop
			update public.attendances
			set status = 'waitlisted', confirmed_at = null, updated_at = now()
			where session_id = v_sess.id and member_id = v_gid.member_id;
			update public.session_counters set confirmed_count = confirmed_count - 1
			where session_id = v_sess.id;
		end loop;

		-- 빈 정원을 대기 회원으로 재승급(게스트는 상한 2 유지 → 방금 강등된 게스트는 재승급되지 않음).
		loop
			exit when v_sess.capacity is not null
				and (select confirmed_count from public.session_counters
					where session_id = v_sess.id) >= v_sess.capacity;
			v_prom := public.promote_next_waitlisted(v_sess.id);
			exit when v_prom.member_id is null;
		end loop;
	end loop;
end;
$$;
