-- ============================================================
-- 대기 승격 정지 사고(2026-08-06 목 세션 id=84) 방지 3종.
--
-- 사고 요약: 08/03 15:06 확정자(운영진) 1명이 취소됐는데 대기 승격이 0명이었고, 이후 30시간 동안
--   "확정 15 / 정원 16 / 대기 10"이 고착됐다. 신규 참여는 전원 대기로 접수됐고(=서버는 만석으로 판단),
--   취소가 나도 1명씩만 채워져 빈 1칸이 영구히 남았다. 관리자가 정원을 15→16으로 저장해 강제로
--   재정합하면서 해소됐다(그 저장이 유일한 치유였고, 동시에 사고 당시 값들을 덮어써 사후 추적이 불가해졌다).
--
-- 원인은 데이터만으로 확정하지 못했다. 확정된 것은 다음 두 가지이고, 아래 3종은 "원인이 무엇이든
-- 같은 증상이 다시 30시간 지속되지 못하게" 만드는 방지 코드다.
--   · 그 순간 승격 함수는 호출됐고 0명을 반환했다(세션 status는 계속 'open'이었음이 sync_version=1로 확인).
--   · 정원 판정의 권위가 session_counters.confirmed_count(별도 카운터)라, 이 값이 실제 확정 행보다
--     크면(=유령 자리) 빈자리가 있어도 승격이 영구 정지하고, 이를 감지·복구하는 장치가 없었다.
--
-- ① 감사 로그(ops_audit): 참석 상태/카운터/일정(정원·장소·시각·상태) 변경을 트랜잭션 단위로 기록.
--    RPC를 우회한 직접 쓰기도 잡히도록 트리거로 심고, PostgREST GUC(request.method/path, jwt role)까지
--    남겨 "앱의 어느 호출인지 / 서비스키인지"를 구분한다. 이번 조사에서 가장 결정적으로 부족했던 것.
-- ② 프리패스 판정을 "정원 초과 확정 인원 < 2"로 교정: 기존엔 '확정 운영진 총수 < 2'라서 정원 안에
--    들어와 있는 운영진까지 2명에 포함됐고, 그 결과 운영진이 빠지고 들어올 때마다 대기 운영진의
--    승격 자격이 열렸다 닫혔다 했다(정원 초과 허용량 2명이라는 원래 의도와 불일치).
-- ③ 카운터를 파생값으로 강등 + 승격 루프:
--    · session_counter_sync(): 카운터 행을 잠그고 실제 confirmed 행 수로 덮어써 드리프트를 자가 치유.
--      모든 참석 변경 지점이 ±1 산술 대신 이 함수를 호출한다 → 유령 자리가 원리적으로 유지되지 않는다.
--    · 승격은 "빈자리 수만큼" 루프. 한 이벤트에 1명만 채우던 규칙 때문에 한 번 생긴 구멍이 영구히
--      남았으므로, 자격자가 없을 때까지 채운다.
--    · promote_next_waitlisted 의 FOR UPDATE SKIP LOCKED → FOR UPDATE. 후보 행이 순간적으로 잠겨 있으면
--      조용히 "승격자 없음"이 되던 위험을 제거한다(잠금 대기는 밀리초, 교착 없음: 카운터를 먼저 잡는
--      경로들끼리는 상호배제이고 set_carpool_role 은 카운터를 잡지 않는다).
--
-- 취소자의 직전 상태가 confirmed 가 아니어도(대기·정원외늦참) open 세션이면 승격 루프를 돌린다:
-- 카운터 치유로 자리가 드러날 수 있으므로, 모든 취소가 복구 기회가 된다.
-- ============================================================

-- ------------------------------------------------------------
-- ① 감사 로그
-- ------------------------------------------------------------
create table if not exists public.ops_audit (
	id         bigserial primary key,
	at         timestamptz not null default clock_timestamp(),
	txid       bigint      not null default txid_current(),
	kind       text        not null check (kind in ('attendance', 'counter', 'session')),
	session_id bigint,
	member_id  uuid,
	detail     jsonb       not null default '{}'::jsonb,
	actor      uuid,   -- current_member_id(): 앱 호출이면 행위자, 서비스키/대시보드면 NULL
	db_user    text,   -- current_user: authenticated / service_role / postgres(대시보드·마이그레이션)
	jwt_role   text,   -- request.jwt.claims->>'role'
	req_method text,   -- PostgREST: POST(rpc) / PATCH(테이블 직접 수정) 등
	req_path   text    -- /rpc/cancel_attendance, /sessions 등
);
comment on table public.ops_audit is
	'참석/카운터/일정 변경 감사 로그. txid 로 묶으면 한 트랜잭션에서 무엇이 함께 바뀌었는지(예: 취소에 카운터 감소가 동반됐는지) 확인된다.';

create index if not exists ops_audit_session_idx on public.ops_audit (session_id, id desc);
create index if not exists ops_audit_txid_idx on public.ops_audit (txid);
create index if not exists ops_audit_at_idx on public.ops_audit (at desc);

alter table public.ops_audit enable row level security;
drop policy if exists ops_audit_admin_select on public.ops_audit;
create policy ops_audit_admin_select on public.ops_audit
	for select to authenticated using (public.is_admin());
-- INSERT 정책 없음 → 트리거(SECURITY DEFINER, owner=postgres)만 기록. 클라이언트는 위조·삭제 불가.

-- 감사 기록 헬퍼. 실패해도 본 작업을 깨뜨리지 않도록 전부 삼킨다(감사 1줄 < 참석 트랜잭션).
create or replace function public.ops_audit_write(
	p_kind text, p_session_id bigint, p_member_id uuid, p_detail jsonb
) returns void
language plpgsql security definer set search_path = ''
as $$
begin
	insert into public.ops_audit(kind, session_id, member_id, detail, actor, db_user, jwt_role, req_method, req_path)
	values (
		p_kind, p_session_id, p_member_id, coalesce(p_detail, '{}'::jsonb),
		public.current_member_id(),
		current_user,
		nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
		nullif(current_setting('request.method', true), ''),
		nullif(current_setting('request.path', true), '')
	);
exception when others then
	null;
end;
$$;
revoke execute on function public.ops_audit_write(text, bigint, uuid, jsonb) from public;

-- 참석 행 변경(상태·순번·확정/취소시각) 기록. 카풀/늦참 분(分) 변경만인 UPDATE 는 기록하지 않는다.
--   PL/pgSQL 에서 OLD/NEW 는 해당 이벤트에서만 할당된다(INSERT 에 OLD 참조 → 런타임 에러로 본 INSERT 가 깨진다).
--   그래서 tg_op 별로 분기해 값을 뽑고, 전체를 예외 블록으로 감싸 감사 실패가 참석 처리를 막지 못하게 한다.
create or replace function public.trg_audit_attendance() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
	v_sid bigint;
	v_mid uuid;
	v_old text;
	v_new text;
	v_pos bigint;
	v_inv uuid;
begin
	begin
		if tg_op = 'INSERT' then
			v_sid := new.session_id; v_mid := new.member_id;
			v_new := new.status;     v_pos := new.position; v_inv := new.invited_by;
		elsif tg_op = 'DELETE' then
			v_sid := old.session_id; v_mid := old.member_id;
			v_old := old.status;     v_pos := old.position; v_inv := old.invited_by;
		else
			v_sid := new.session_id; v_mid := new.member_id;
			v_old := old.status;     v_new := new.status;
			v_pos := new.position;   v_inv := coalesce(new.invited_by, old.invited_by);
		end if;

		perform public.ops_audit_write('attendance', v_sid, v_mid,
			jsonb_strip_nulls(jsonb_build_object(
				'op',           tg_op,
				'old_status',   v_old,
				'new_status',   v_new,
				'position',     v_pos,
				'invited_by',   v_inv,
				'counter_now',  (select confirmed_count from public.session_counters where session_id = v_sid),
				'actual_now',   (select count(*) from public.attendances
				                  where session_id = v_sid and status = 'confirmed'),
				'capacity',     (select capacity from public.sessions where id = v_sid),
				'place_id',     (select place_id from public.sessions where id = v_sid)
			)));
	exception when others then
		null;
	end;
	return null;
end;
$$;

drop trigger if exists trg_att_audit_ins on public.attendances;
create trigger trg_att_audit_ins after insert on public.attendances
	for each row execute function public.trg_audit_attendance();

drop trigger if exists trg_att_audit_del on public.attendances;
create trigger trg_att_audit_del after delete on public.attendances
	for each row execute function public.trg_audit_attendance();

drop trigger if exists trg_att_audit_upd on public.attendances;
create trigger trg_att_audit_upd after update on public.attendances
	for each row
	when (old.status is distinct from new.status
		or old.position is distinct from new.position
		or old.confirmed_at is distinct from new.confirmed_at
		or old.cancelled_at is distinct from new.cancelled_at)
	execute function public.trg_audit_attendance();

-- 카운터 변경 기록. 그 순간 실제 확정 행 수를 함께 남겨 드리프트가 바로 보이게 한다.
--   INSERT 트리거에서 OLD 를 참조하면 런타임 에러이므로 tg_op 로 분기한다.
create or replace function public.trg_audit_counter() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
	v_old int;
begin
	begin
		if tg_op = 'UPDATE' then v_old := old.confirmed_count; end if;
		perform public.ops_audit_write('counter', new.session_id, null,
			jsonb_strip_nulls(jsonb_build_object(
				'op',      tg_op,
				'old',     v_old,
				'new',     new.confirmed_count,
				'actual',  (select count(*) from public.attendances
				             where session_id = new.session_id and status = 'confirmed'),
				'capacity', (select capacity from public.sessions where id = new.session_id)
			)));
	exception when others then
		null;
	end;
	return null;
end;
$$;

-- WHEN 절은 tg_op 를 참조할 수 없고 INSERT 이벤트에서 OLD 를 쓸 수 없다 → INSERT/UPDATE 트리거를 분리한다.
drop trigger if exists trg_counter_audit on public.session_counters;
drop trigger if exists trg_counter_audit_ins on public.session_counters;
create trigger trg_counter_audit_ins after insert on public.session_counters
	for each row execute function public.trg_audit_counter();

drop trigger if exists trg_counter_audit_upd on public.session_counters;
create trigger trg_counter_audit_upd after update on public.session_counters
	for each row
	when (old.confirmed_count is distinct from new.confirmed_count)
	execute function public.trg_audit_counter();

-- 일정의 정원 판정 입력값 변경 기록(정원·장소·시각·상태). 이번 사고에서 사후 추적이 막힌 지점.
create or replace function public.trg_audit_session() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
	begin
	perform public.ops_audit_write('session', new.id, null,
		jsonb_strip_nulls(jsonb_build_object(
			'old_capacity',     case when old.capacity     is distinct from new.capacity     then old.capacity end,
			'new_capacity',     case when old.capacity     is distinct from new.capacity     then new.capacity end,
			'old_place_id',     case when old.place_id     is distinct from new.place_id     then old.place_id end,
			'new_place_id',     case when old.place_id     is distinct from new.place_id     then new.place_id end,
			'old_status',       case when old.status       is distinct from new.status       then old.status end,
			'new_status',       case when old.status       is distinct from new.status       then new.status end,
			'old_scheduled_at', case when old.scheduled_at is distinct from new.scheduled_at then old.scheduled_at end,
			'new_scheduled_at', case when old.scheduled_at is distinct from new.scheduled_at then new.scheduled_at end,
			'old_ends_at',      case when old.ends_at      is distinct from new.ends_at      then old.ends_at end,
			'new_ends_at',      case when old.ends_at      is distinct from new.ends_at      then new.ends_at end,
			'counter_now',      (select confirmed_count from public.session_counters where session_id = new.id),
			'actual_now',       (select count(*) from public.attendances
			                      where session_id = new.id and status = 'confirmed')
		)));
	exception when others then
		null;
	end;
	return null;
end;
$$;

drop trigger if exists trg_sessions_audit on public.sessions;
create trigger trg_sessions_audit after update on public.sessions
	for each row
	when (old.capacity is distinct from new.capacity
		or old.place_id is distinct from new.place_id
		or old.status is distinct from new.status
		or old.scheduled_at is distinct from new.scheduled_at
		or old.ends_at is distinct from new.ends_at)
	execute function public.trg_audit_session();

-- ------------------------------------------------------------
-- ③-1 카운터 자기치유. 반드시 정원 판정 직전에 호출한다(행 잠금 + 실제값 동기화 + 실제값 반환).
--     내부 전용(클라이언트 EXECUTE 불필요). 호출자는 이 함수 반환값을 정원 비교에 쓴다.
-- ------------------------------------------------------------
create or replace function public.session_counter_sync(p_session_id bigint)
returns int
language plpgsql security definer set search_path = ''
as $$
declare
	v_stored int;
	v_actual int;
begin
	insert into public.session_counters(session_id) values (p_session_id)
		on conflict (session_id) do nothing;
	select confirmed_count into v_stored
	from public.session_counters where session_id = p_session_id for update;

	select count(*)::int into v_actual from public.attendances
	where session_id = p_session_id and status = 'confirmed';

	if v_stored is distinct from v_actual then
		update public.session_counters set confirmed_count = v_actual
		where session_id = p_session_id;
	end if;
	return v_actual;
end;
$$;
revoke execute on function public.session_counter_sync(bigint) from public;

-- ------------------------------------------------------------
-- ②③ promote_next_waitlisted — 실제 확정 인원 기준 + 프리패스는 '정원 초과분 < 2' + SKIP LOCKED 제거.
--   호출 규약: 카운터 행 잠금은 이 함수가 스스로 확보한다(같은 트랜잭션 재잠금은 무해).
--   반환: 승격된 행(없으면 member_id is null). 호출자는 자격자가 없을 때까지 반복 호출한다.
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
	v_promote  public.attendances%rowtype;
begin
	select capacity into v_capacity from public.sessions where id = p_session_id;
	v_count := public.session_counter_sync(p_session_id);
	select count(*) into v_gcount from public.attendances
	where session_id = p_session_id and status = 'confirmed' and invited_by is not null;

	-- 대기 1순위(position ASC) 중 승급 자격자:
	--   게스트 상한 통과 && ( 정원 여유 || 부과없음 운영진 프리패스(정원 초과 확정 2명 미만) ).
	select * into v_promote from public.attendances a
	where a.session_id = p_session_id and a.status = 'waitlisted'
		and (a.invited_by is null or v_gcap is null or v_gcount < v_gcap)
		and (
			(v_capacity is null or v_count < v_capacity)
			or (v_opfree and v_capacity is not null and (v_count - v_capacity) < 2
			    and public.is_operator(a.member_id))
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
revoke execute on function public.promote_next_waitlisted(bigint) from public;

-- ------------------------------------------------------------
-- ③-2 승격 루프 헬퍼 — 자격자가 없을 때까지 승격하고 각자에게 'promoted' 알림. 승격 인원 반환.
--   open 세션에서만 호출한다(진행/종료 세션은 현장 판정이 보드 몫).
-- ------------------------------------------------------------
create or replace function public.promote_waitlist_fill(p_session_id bigint)
returns int
language plpgsql security definer set search_path = ''
as $$
declare
	v_promote public.attendances%rowtype;
	v_n       int := 0;
	v_i       int;
begin
	for v_i in 1..200 loop   -- 폭주 방지 상한(정상 상황에선 0~2회)
		v_promote := public.promote_next_waitlisted(p_session_id);
		exit when v_promote.member_id is null;
		v_n := v_n + 1;
		insert into public.notifications(recipient_member_id, type, session_id, payload)
		values (coalesce(v_promote.invited_by, v_promote.member_id), 'promoted', p_session_id,
			jsonb_build_object('session_id', p_session_id)
				|| case when v_promote.invited_by is not null then jsonb_build_object(
					'guest_name', (select name from public.members where id = v_promote.member_id))
					else '{}'::jsonb end);
	end loop;
	return v_n;
end;
$$;
revoke execute on function public.promote_waitlist_fill(bigint) from public;

-- ------------------------------------------------------------
-- ②③ join_session — 카운터 자기치유 + 프리패스 '정원 초과분 < 2'.
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
	v_existing     public.attendances%rowtype;
	v_result       public.attendances%rowtype;
	v_new          text;
	v_pos          bigint;
	v_has_existing boolean;
begin
	if v_member is null then raise exception 'not authenticated'; end if;

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
	elsif public.is_operator(v_member) and public.session_op_free(p_session_id)
	      and (v_count - v_capacity) < 2 then
		-- 만석인 부과없음 일정 → 정원 초과 확정이 2명 미만이면 운영진 프리패스.
		v_new := 'confirmed';
		update public.session_counters set confirmed_count = v_count + 1
			where session_id = p_session_id;
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
-- ③ cancel_attendance — 카운터 재계산 + 빈자리만큼 승격.
-- ------------------------------------------------------------
create or replace function public.cancel_attendance(p_session_id bigint)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
	v_member uuid := public.current_member_id();
	v_status text;
	v_self   public.attendances%rowtype;
begin
	if v_member is null then raise exception 'not authenticated'; end if;

	select status into v_status from public.sessions where id = p_session_id for share;
	if not found then raise exception 'session not found'; end if;
	if v_status in ('closed', 'cancelled') then raise exception 'session ended'; end if;

	perform public.session_counter_sync(p_session_id);   -- 카운터 잠금 + 드리프트 치유

	select * into v_self from public.attendances
	where session_id = p_session_id and member_id = v_member for update;
	if not found or v_self.status = 'cancelled' then return; end if;

	update public.attendances
	set status = 'cancelled', carpool_role = 'none', carpool_seats = null,
		late_minutes = 0, cancelled_at = now(), updated_at = now()
	where session_id = p_session_id and member_id = v_member;

	perform public.session_counter_sync(p_session_id);   -- 취소 반영(±1 산술 대신 재계산)

	-- 확정자였는지와 무관하게 open 세션이면 빈자리를 채운다(치유로 자리가 드러날 수 있음).
	if v_status = 'open' then
		perform public.promote_waitlist_fill(p_session_id);
	end if;
end;
$$;
grant execute on function public.cancel_attendance(bigint) to authenticated;

-- ------------------------------------------------------------
-- ③ admin_cancel_attendance — 동일 패턴. 'removed' 알림은 기존과 같이 대상(게스트면 초대 회원)에게.
-- ------------------------------------------------------------
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
	v_recipient  uuid;
	v_guest_name text;
begin
	if not public.is_admin() then raise exception 'forbidden'; end if;

	select name into v_by_name from public.members where id = v_actor;

	select status into v_status from public.sessions where id = p_session_id for share;
	if not found then raise exception 'session not found'; end if;
	if v_status in ('closed', 'cancelled') then raise exception 'session ended'; end if;

	perform public.session_counter_sync(p_session_id);

	select * into v_self from public.attendances
	where session_id = p_session_id and member_id = p_member_id for update;
	if not found then raise exception 'attendance not found'; end if;
	if v_self.status = 'cancelled' then return; end if;

	update public.attendances
	set status = 'cancelled', carpool_role = 'none', carpool_seats = null,
		late_minutes = 0, cancelled_at = now(), updated_at = now()
	where session_id = p_session_id and member_id = p_member_id;

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

	perform public.session_counter_sync(p_session_id);

	if v_status = 'open' then
		perform public.promote_waitlist_fill(p_session_id);
	end if;
end;
$$;
revoke execute on function public.admin_cancel_attendance(bigint, uuid) from anon;
grant execute on function public.admin_cancel_attendance(bigint, uuid) to authenticated;

-- ------------------------------------------------------------
-- ③ cancel_guest_attendance — 동일 패턴(소유권 검사는 기존과 같음).
-- ------------------------------------------------------------
create or replace function public.cancel_guest_attendance(
	p_session_id bigint, p_guest_member_id uuid
) returns void
language plpgsql security definer set search_path = ''
as $$
declare
	v_inviter uuid := public.current_member_id();
	v_status  text;
	v_self    public.attendances%rowtype;
begin
	if v_inviter is null then raise exception 'not authenticated'; end if;

	select status into v_status from public.sessions where id = p_session_id for share;
	if not found then raise exception 'session not found'; end if;
	if v_status in ('closed','cancelled') then raise exception 'session ended'; end if;

	perform public.session_counter_sync(p_session_id);

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

	perform public.session_counter_sync(p_session_id);

	if v_status = 'open' then
		perform public.promote_waitlist_fill(p_session_id);
	end if;
end;
$$;
revoke execute on function public.cancel_guest_attendance(bigint, uuid) from anon;
grant execute on function public.cancel_guest_attendance(bigint, uuid) to authenticated;

-- ------------------------------------------------------------
-- ②③ set_late_minutes — 정원외늦참 진입 시 빈자리만큼 승격, 복귀 시 프리패스 '정원 초과분 < 2'.
--   반환 { status, promoted } 유지(promoted 는 이제 2 이상일 수 있다 — 클라는 숫자만 표시).
-- ------------------------------------------------------------
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
		-- 정원 외 풀 → 복귀. 여유면 확정, 만석이면 부과없음 운영진 프리패스(정원 초과분 2명 미만), 그 외 대기.
		if v_capacity is null or v_count < v_capacity then
			v_new := 'confirmed';
			update public.session_counters set confirmed_count = v_count + 1
				where session_id = p_session_id;
		elsif public.is_operator(v_member) and public.session_op_free(p_session_id)
		      and (v_count - v_capacity) < 2 then
			v_new := 'confirmed';
			update public.session_counters set confirmed_count = v_count + 1
				where session_id = p_session_id;
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
-- ②③ set_session_capacity — 그리디의 프리패스를 '정원 초과분 < 2'로 + open 아닌 세션도 카운터는 정합.
--   (기존엔 open 이 아니면 정원만 쓰고 반환해 카운터가 실제와 어긋난 채 남았다 — 종료 세션 드리프트 원인)
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
	v_g        int := 0;   -- 확정 게스트 누계
	v_att      public.attendances%rowtype;
	v_want     text;
	v_isop     boolean;
	v_isguest  boolean;
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

		if (p_capacity is null or v_cc < p_capacity)
		   and (not v_isguest or v_gcap is null or v_g < v_gcap) then
			v_want := 'confirmed';                                   -- 정원 여유 + 게스트 상한 여유
		elsif v_opfree and v_isop and p_capacity is not null and (v_cc - p_capacity) < 2 then
			v_want := 'confirmed';                                   -- 부과없음 운영진 프리패스(초과 2명까지)
		else
			v_want := 'waitlisted';
		end if;

		if v_want = 'confirmed' then
			v_cc := v_cc + 1;
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

-- ------------------------------------------------------------
-- 백필 — 전 세션 카운터를 실제 확정 인원으로 정합(상태 변경·알림 없음).
--   현재 남아있는 드리프트(예: 08/03 월 세션 22 vs 21)를 제거한다. 승격은 하지 않는다
--   (알림 없는 조용한 상태 변경을 만들지 않기 위해 — 자리 회복은 이후 첫 취소/정원 저장에서 일어난다).
-- ------------------------------------------------------------
do $$
declare
	v_sess record;
begin
	for v_sess in
		select s.id from public.sessions s
		where exists (select 1 from public.session_counters c where c.session_id = s.id)
		   or exists (select 1 from public.attendances a where a.session_id = s.id)
	loop
		perform public.session_counter_sync(v_sess.id);
	end loop;
end $$;

-- ------------------------------------------------------------
-- Realtime 보호 — ops_audit 은 구독 대상이 아니다(메시지량 이력이 있어 명시적으로 배제).
--   publication 이 FOR ALL TABLES 면 개별 배제가 불가하므로 알림만 남긴다.
-- ------------------------------------------------------------
do $$
declare
	v_all boolean;
begin
	select puballtables into v_all from pg_publication where pubname = 'supabase_realtime';
	if v_all is null then
		return;                                  -- 그런 publication 이 없음
	elsif v_all then
		raise notice 'supabase_realtime 이 FOR ALL TABLES 입니다 — ops_audit 변경도 Realtime 으로 흐릅니다. 개별 테이블 목록 publication 으로 전환을 검토하세요.';
	elsif exists (
		select 1 from pg_publication_tables
		where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'ops_audit'
	) then
		alter publication supabase_realtime drop table public.ops_audit;
	end if;
end $$;
