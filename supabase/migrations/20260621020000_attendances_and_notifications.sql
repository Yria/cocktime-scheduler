-- Phase 5: 참석/정원/대기/자동승급 + 알림
-- 계약서: docs/EXPANSION_SPEC.md §4, §5
-- 동시성 핵심: 직렬화 지점은 session_counters 행 FOR UPDATE 단독(보드 편성과 락 분리).
--   정원 판정은 count(*) 금지, session_counters.confirmed_count 권위. 대기 승급은 SKIP LOCKED.
--   취소+승급+알림은 한 트랜잭션 → 롤백 시 알림 미발생(불일치 차단).

-- ============================================================
-- ① attendances : 참석/대기 RSVP + 카풀 의향 (회원당 세션당 1행)
-- ============================================================
create table if not exists public.attendances (
	session_id   bigint not null references public.sessions(id) on delete cascade,
	member_id    uuid   not null references public.members(id) on delete cascade,
	status       text   not null check (status in ('confirmed','waitlisted','cancelled')),
	position     bigint not null,                      -- nextval(seq): 경쟁 없는 단조 순번
	carpool_role text   not null default 'none' check (carpool_role in ('none','can_drive','need_ride')),
	carpool_seats int,
	requested_at timestamptz not null default now(),
	confirmed_at timestamptz,
	cancelled_at timestamptz,
	updated_at   timestamptz not null default now(),
	primary key (session_id, member_id)
);
create sequence if not exists public.attendance_position_seq;
create index if not exists idx_att_session_status_pos
	on public.attendances(session_id, status, position);

-- ============================================================
-- ② session_counters : 정원 동시성 단일 진실 소스 (sessions와 1:1, 락 분리)
-- ============================================================
create table if not exists public.session_counters (
	session_id      bigint primary key references public.sessions(id) on delete cascade,
	confirmed_count int not null default 0
);

-- ============================================================
-- ③ notifications : 앱내 알림 1차 + 푸시 트리거 소스
-- ============================================================
create table if not exists public.notifications (
	id                  uuid primary key default gen_random_uuid(),
	recipient_member_id uuid not null references public.members(id) on delete cascade,
	type                text not null,
	session_id          bigint references public.sessions(id) on delete cascade,
	payload             jsonb,
	read_at             timestamptz,
	sent                boolean not null default false,
	created_at          timestamptz not null default now()
);
create index if not exists idx_notif_recipient
	on public.notifications(recipient_member_id, created_at desc);

-- ============================================================
-- ④ RLS : 신규 테이블은 처음부터 좁게. 쓰기는 SECURITY DEFINER RPC 경유.
-- ============================================================
alter table public.attendances enable row level security;
-- 참석 현황은 로그인 사용자 전원 조회(누가 오는지 공유). 쓰기는 RPC만(직접 정책 없음).
create policy attendances_select on public.attendances
	for select to authenticated using (true);

alter table public.session_counters enable row level security;
create policy session_counters_select on public.session_counters
	for select to authenticated using (true);

alter table public.notifications enable row level security;
-- 본인 알림만 조회 + 읽음 처리. INSERT는 RPC만.
create policy notifications_self_select on public.notifications
	for select to authenticated
	using (recipient_member_id = public.current_member_id());
create policy notifications_self_update on public.notifications
	for update to authenticated
	using (recipient_member_id = public.current_member_id())
	with check (recipient_member_id = public.current_member_id());

-- ============================================================
-- ⑤ RPC: join_session — 정원 여유면 confirmed, 아니면 waitlisted
--    잠금 순서: sessions(검증) → session_counters(직렬화) → attendances
-- ============================================================
create or replace function public.join_session(p_session_id bigint)
returns public.attendances
language plpgsql security definer set search_path = ''
as $$
declare
	v_member   uuid := public.current_member_id();
	v_capacity int;
	v_status   text;
	v_count    int;
	v_existing public.attendances%rowtype;
	v_result   public.attendances%rowtype;
	v_new      text;
	v_pos      bigint;
begin
	if v_member is null then raise exception 'not authenticated'; end if;

	-- FOR SHARE: 동시 상태 변경(set_session_status)으로부터 검증 보호
	select capacity, status into v_capacity, v_status
	from public.sessions where id = p_session_id for share;
	if not found then raise exception 'session not found'; end if;
	if v_status <> 'open' then raise exception 'session not open'; end if;

	-- 카운터 보장 + 락 → 세션 단위 직렬화
	insert into public.session_counters(session_id) values (p_session_id)
		on conflict (session_id) do nothing;
	select confirmed_count into v_count
	from public.session_counters where session_id = p_session_id for update;

	-- 기존 행 락
	select * into v_existing from public.attendances
	where session_id = p_session_id and member_id = v_member for update;

	if found and v_existing.status in ('confirmed','waitlisted') then
		raise exception 'already joined';
	end if;

	-- 정원 판정 (capacity null = 무제한)
	if v_capacity is null or v_count < v_capacity then
		v_new := 'confirmed';
		update public.session_counters set confirmed_count = confirmed_count + 1
			where session_id = p_session_id;
	else
		v_new := 'waitlisted';
	end if;

	v_pos := nextval('public.attendance_position_seq');

	if found then  -- 취소 후 재신청: 같은 행 갱신
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

	return v_result;
end;
$$;

-- ============================================================
-- ⑥ RPC: cancel_attendance — 본인 취소(멱등) + confirmed였으면 대기 1순위 승급 + 알림
-- ============================================================
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
	-- 종료/취소된 세션은 참석 변경 불가
	if v_status in ('closed', 'cancelled') then raise exception 'session ended'; end if;

	insert into public.session_counters(session_id) values (p_session_id)
		on conflict (session_id) do nothing;
	perform 1 from public.session_counters where session_id = p_session_id for update;

	select * into v_self from public.attendances
	where session_id = p_session_id and member_id = v_member for update;
	if not found or v_self.status = 'cancelled' then
		return;  -- 멱등: 이미 취소/미신청
	end if;

	update public.attendances set status = 'cancelled', cancelled_at = now(), updated_at = now()
	where session_id = p_session_id and member_id = v_member;

	-- confirmed였을 때만 자리 비우고 승급
	if v_self.status = 'confirmed' then
		update public.session_counters set confirmed_count = confirmed_count - 1
			where session_id = p_session_id;

		if v_status = 'open' then
			select * into v_promote from public.attendances
			where session_id = p_session_id and status = 'waitlisted'
			order by position asc
			for update skip locked
			limit 1;

			if found then
				update public.attendances set status = 'confirmed', confirmed_at = now(), updated_at = now()
				where session_id = v_promote.session_id and member_id = v_promote.member_id;
				update public.session_counters set confirmed_count = confirmed_count + 1
					where session_id = p_session_id;
				insert into public.notifications(recipient_member_id, type, session_id, payload)
				values (v_promote.member_id, 'promoted', p_session_id,
					jsonb_build_object('session_id', p_session_id));
			end if;
		end if;
	end if;
end;
$$;

-- ============================================================
-- ⑦ RPC: promote_waitlist — 운영진이 정원 상향 후 여유만큼 일괄 승급 + 알림
-- ============================================================
create or replace function public.promote_waitlist(p_session_id bigint)
returns int
language plpgsql security definer set search_path = ''
as $$
declare
	v_capacity int;
	v_count    int;
	v_att      public.attendances%rowtype;
	v_promoted int := 0;
begin
	if not public.is_admin() then raise exception 'forbidden'; end if;

	select capacity into v_capacity from public.sessions where id = p_session_id;
	if not found then raise exception 'session not found'; end if;

	insert into public.session_counters(session_id) values (p_session_id)
		on conflict (session_id) do nothing;
	select confirmed_count into v_count
	from public.session_counters where session_id = p_session_id for update;

	loop
		exit when v_capacity is not null and v_count >= v_capacity;
		select * into v_att from public.attendances
		where session_id = p_session_id and status = 'waitlisted'
		order by position asc
		for update skip locked
		limit 1;
		exit when not found;

		update public.attendances set status = 'confirmed', confirmed_at = now(), updated_at = now()
		where session_id = v_att.session_id and member_id = v_att.member_id;
		v_count := v_count + 1;
		v_promoted := v_promoted + 1;
		insert into public.notifications(recipient_member_id, type, session_id, payload)
		values (v_att.member_id, 'promoted', p_session_id,
			jsonb_build_object('session_id', p_session_id));
	end loop;

	update public.session_counters set confirmed_count = v_count where session_id = p_session_id;
	return v_promoted;
end;
$$;

revoke execute on function public.join_session(bigint) from anon;
revoke execute on function public.cancel_attendance(bigint) from anon;
revoke execute on function public.promote_waitlist(bigint) from anon;
grant execute on function public.join_session(bigint) to authenticated;
grant execute on function public.cancel_attendance(bigint) to authenticated;
grant execute on function public.promote_waitlist(bigint) to authenticated;

-- ============================================================
-- ⑧ Realtime : 참석 현황 + 알림 실시간 반영
-- ============================================================
alter publication supabase_realtime add table public.attendances;
alter publication supabase_realtime add table public.notifications;
