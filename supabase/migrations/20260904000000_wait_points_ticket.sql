-- ============================================================
-- 대기 포인트 / 우선참여권(티켓) — 오래 대기한 회원의 구제책.
--
-- 요청(2026-09-04 운영자 확정 사양):
--   C1. **적립** — 회차가 종료(status='closed')될 때 그 회차에서 `waitlisted` 로 남아 있던 **회원**에게 +1.
--       게스트는 대상이 아니다(계정이 없고 행이 재사용된다 — 20260819030000).
--   C2. **상한 7** — 잔액은 0~7. 7에서 더 쌓이지 않는다. **잔액 7 = 티켓 1장 보유**이며 별도 티켓
--       카운터를 두지 않는다. 티켓은 최대 1장이다.
--   C3. **차감** — 당일 취소·노쇼만 −1. 사전 취소는 감점 없음. 하한 0.
--   C4. **티켓 자리 = 정원 외 자리**(capacity_exempt=true). 신규 프리패스와 같은 모델이라
--       정원 안 빈자리를 소비하지 않는다 → **티켓 사용자가 대기 1번의 승격 기회를 빼앗지 않는다.**
--   C5. **모든 일정에서 쓸 수 있다.** 신규·운영진 프리패스의 session_op_free(부과 없는 일정) 게이트를
--       티켓에는 걸지 않는다. 대기가 실제로 밀리는 것이 인기 있는 정규 일정이라, 거기서 못 쓰면
--       구제책이 되지 않는다. 대관비는 참석했으니 정상 부과된다(dues_court_targets 무수정 = 자동 포함).
--   C6. **명시적 사용** — join_session(p_use_ticket=true) 로 본인이 고른 경우에만 소모된다.
--   C7. **회차당 2명** — 한 회차에서 티켓으로 확정된 인원은 최대 2명. 게스트 상한(20260712010000)·
--       운영진 프리패스와 같은 단위이며, 같은 방식으로 **카운터 락 안에서 count(*)** 로 판정한다.
--   C8. **소급 백필** — 2026-08-01 이후 종료된 회차의 대기 이력을 소급 적립한다(상한 7 그대로).
--   C10. **티켓 사용 후 당일취소·노쇼 → 몰수(환급 없음).** 사전 취소·운영진 제거·회차 취소는 환급.
--
-- 세 번째 프리패스가 되므로 기존 두 개와의 성격 차이를 여기 못박는다(의도된 비대칭):
--   · 운영진 = 정원 카운트에 **든다**. '확정 운영진 총수 < 2'. 부과 없는 일정만. (재론 금지 — 20260806020000)
--   · 신규   = 정원 외(capacity_exempt). 상한 없음. 부과 없는 일정만. (20260903000000/010000)
--   · 티켓   = 정원 외(capacity_exempt). **회차당 2명**. **모든 일정**. 포인트 7점을 지불한다.
--
-- **승격 루프(promote_next_waitlisted)에는 티켓 조건을 넣지 않는다 — 재론 금지.**
--   근거는 20260903000000:166-181 의 starvation 반례가 그대로, 더 나쁘게 적용되기 때문이다:
--   넣으면 정원 안 대기 1순위가 티켓 보유자에게 영구히 추월당한다. 대기 구제가 목적인 기능이
--   대기 1번을 막는 역설이 된다. 부여 지점은 기존 두 프리패스와 같이 **본인이 누른 순간 두 곳**뿐
--   — join_session, set_late_minutes(late_pool → 정시 복귀).
--
-- **capacity_exempt 만으로는 부족하다.** 그 플래그는 '정원을 소비하지 않는다'만 말할 뿐 사유를 남기지
--   않아, 클라 splitConfirmedByCapacity(waitStatus.ts:195)가 정원 외 확정을 **전량 '신규'로 표기**한다.
--   그래서 사유 컬럼 attendances.exempt_reason 을 함께 둔다. capacity_exempt 와 **항상 쌍으로** 세팅한다.
--
-- **원장이 잔액의 유일한 진실이다.** wait_point_balances 는 파생 캐시이고 판정은 언제나
--   wait_points_recount() 의 반환값(= sum(delta))으로 한다. confirmed_count 를 ±1 산술로 관리하다
--   유령 자리로 승격이 30시간 영구 정지한 2026-08-06 사고(20260806010000:11-26)의 처방
--   — *카운터를 파생값으로 강등한다* — 을 처음부터 적용한다.
--
-- **멱등성은 트리거가 주지 않는다.** `when (new.status='closed' and old.status is distinct from 'closed')`
--   는 closed→open→closed 재전이에서 다시 발화한다(회계는 not-exists 가드로, 경기완료는 status='playing'
--   술어로 각자 멱등을 만든다). 포인트 원장은 부분 유니크 인덱스 (member_id, session_id, kind)
--   — kind in ('earn','penalty') — 로 **스스로** 재실행 면역을 갖는다. 백필도 같은 인덱스를 탄다.
--
-- **sessions 에 붙는 트리거는 search_path='' + 모든 참조 public. 한정이 필수다.** 어기면 죽는 것은
--   포인트가 아니라 sync_schedule_occurrences A~E 전 단계이고 회차가 '예정'에 고착된다
--   (2026-07-26 실사고, 20260726090000). 앱의 수동 종료는 호출자 search_path 에 public 이 있어
--   **우연히 성공하므로 로컬 테스트로 안 잡힌다.** 훅 본문은 통째로 예외 격리해 포인트 실패가
--   회차 종료를 막지 못하게 한다.
--
-- 대상: attendances(+exempt_reason) / 신규 테이블 2종 / join_session(시그니처 변경) /
--       set_late_minutes / promote_next_waitlisted / set_session_capacity /
--       cancel_attendance / admin_cancel_attendance / 종료·취소 트리거 2종 / 조회 RPC 3종.
--
-- 기준판은 프로덕션의 현재 정의다(파일 하나가 아니다 — 20260903000000:36-37 의 경고):
--   join_session·promote_next_waitlisted·set_late_minutes·set_session_capacity = 20260903010000,
--   cancel_attendance·admin_cancel_attendance = 20260806010000.
-- ============================================================

-- ------------------------------------------------------------
-- ① attendances.exempt_reason — 정원 외 자리의 '사유'
-- ------------------------------------------------------------
alter table public.attendances
	add column if not exists exempt_reason text;

alter table public.attendances drop constraint if exists attendances_exempt_reason_check;
alter table public.attendances add constraint attendances_exempt_reason_check
	check (exempt_reason is null or exempt_reason in ('newbie', 'ticket'));
-- `capacity_exempt = (exempt_reason is not null)` 같은 강한 제약은 **일부러 두지 않는다**.
--   강등 경로(promote_next_waitlisted / set_session_capacity)가 두 컬럼을 한 UPDATE 로 맞추지 못하는
--   순간 참석 취소·정원 저장 트랜잭션 전체가 실패한다. '항상 쌍으로 쓴다'를 규약으로 강제한다.

-- 도입 시점의 정원 외 확정 자리는 전부 신규 프리패스다(티켓 경로가 아직 없었다).
update public.attendances set exempt_reason = 'newbie'
where capacity_exempt and exempt_reason is null;

comment on column public.attendances.exempt_reason is
	'정원 외 확정 자리의 사유. newbie=신규 2주 프리패스 / ticket=우선참여권(대기 포인트 7점). capacity_exempt 와 항상 쌍으로 세팅한다(exempt=false 면 반드시 null). 티켓 지불 이력의 권위는 이 컬럼이 아니라 wait_point_ledger 다. (20260904000000)';

-- ------------------------------------------------------------
-- ② 규칙 상수 — 단일 출처. 클라 미러는 src/lib/schedule/waitStatus.ts.
-- ------------------------------------------------------------
create or replace function public.wait_point_max() returns int
	language sql immutable set search_path = '' as $$ select 7 $$;
create or replace function public.wait_ticket_cost() returns int
	language sql immutable set search_path = '' as $$ select 7 $$;
create or replace function public.wait_ticket_session_cap() returns int
	language sql immutable set search_path = '' as $$ select 2 $$;

comment on function public.wait_point_max() is
	'대기 포인트 잔액 상한. 클라 POINT_MAX(waitStatus.ts)와 반드시 동일하게 유지한다.';
comment on function public.wait_ticket_session_cap() is
	'한 회차에서 우선참여권으로 확정될 수 있는 최대 인원. 클라 TICKET_SESSION_CAP(waitStatus.ts)와 동일 유지.';

-- ------------------------------------------------------------
-- ③ 원장(append-only) — 잔액의 유일한 진실
-- ------------------------------------------------------------
-- ops_audit(20260806010000:37-84) 모델: INSERT 정책이 없어 definer 함수/트리거만 기록할 수 있다.
-- session_id 에 FK 를 **걸지 않는다** — 일회성 회차는 하드 DELETE 되고 attendances 는 CASCADE 로
--   사라진다. 이미 일어난 사실인 원장까지 증발하면 안 된다(회차 라벨은 detail 에 스냅샷한다).
create table if not exists public.wait_point_ledger (
	id            bigserial primary key,
	member_id     uuid   not null references public.members(id) on delete cascade,
	session_id    bigint,
	kind          text   not null check (kind in ('earn', 'spend', 'refund', 'penalty', 'adjust')),
	delta         int    not null,
	balance_after int    not null check (balance_after between 0 and 7),
	detail        jsonb  not null default '{}'::jsonb,
	actor         uuid   references public.members(id) on delete set null,
	created_at    timestamptz not null default now()
);

comment on table public.wait_point_ledger is
	'대기 포인트 원장(append-only). delta 는 요청량이 아니라 **clamp 후 실제로 적용된 증감**이라 잔액은 언제나 sum(delta) 와 정확히 같다(경로 의존 없음). 정정은 UPDATE 가 아니라 반대 부호 adjust 행으로 한다. (20260904000000)';
comment on column public.wait_point_ledger.delta is
	'clamp[0,7] 후 실제 적용된 증감. 상한에 막혀 0이 된 적립도 detail.capped=true 로 남긴다(왜 안 올랐는지 회원이 볼 수 있어야 한다).';

-- ★ 재실행 면역: 회차당·회원당·종류당 1행.
--   spend/refund 는 **일부러 제외한다** — 환원 뒤 같은 회차에 다시 쓰는 경로가 열려 있어야 하고,
--   그때 spend 가 on conflict 로 삼켜지면 포인트를 안 내고 자리를 얻는 '공짜 재사용'이 된다.
create unique index if not exists wait_point_ledger_once_per_session
	on public.wait_point_ledger (member_id, session_id, kind)
	where session_id is not null and kind in ('earn', 'penalty');

-- notifications 의 idx_notif_recipient(20260621020000:48-49)와 같은 형태 — 내 내역 조회용.
create index if not exists wait_point_ledger_member_created
	on public.wait_point_ledger (member_id, created_at desc);
create index if not exists wait_point_ledger_session_kind
	on public.wait_point_ledger (session_id, kind) where session_id is not null;

alter table public.wait_point_ledger enable row level security;
drop policy if exists wait_point_ledger_self_select on public.wait_point_ledger;
create policy wait_point_ledger_self_select on public.wait_point_ledger
	for select to authenticated using (member_id = public.current_member_id());
drop policy if exists wait_point_ledger_admin_select on public.wait_point_ledger;
create policy wait_point_ledger_admin_select on public.wait_point_ledger
	for select to authenticated using (public.is_admin());
-- INSERT/UPDATE/DELETE 정책 없음 → 모든 쓰기가 SECURITY DEFINER 를 통과한다(attendances 와 같은 모델).

-- ------------------------------------------------------------
-- ④ 잔액 캐시 겸 회원 단위 잠금 행
-- ------------------------------------------------------------
create table if not exists public.wait_point_balances (
	member_id  uuid primary key references public.members(id) on delete cascade,
	balance    int not null default 0 check (balance between 0 and 7),
	updated_at timestamptz not null default now()
);

comment on table public.wait_point_balances is
	'대기 포인트 잔액 캐시 + 회원 단위 직렬화 지점. 권위는 wait_point_ledger 의 sum(delta) 이고 이 행은 파생이다 — 어긋나면 wait_points_recount 가 다음 판정에서 자가 치유한다(session_counter_sync 와 같은 성질). CHECK 는 clamp 가 뚫렸을 때 조용한 드리프트 대신 트랜잭션을 실패시키는 트립와이어다.';

alter table public.wait_point_balances enable row level security;
drop policy if exists wait_point_balances_self_select on public.wait_point_balances;
create policy wait_point_balances_self_select on public.wait_point_balances
	for select to authenticated using (member_id = public.current_member_id());
drop policy if exists wait_point_balances_admin_select on public.wait_point_balances;
create policy wait_point_balances_admin_select on public.wait_point_balances
	for select to authenticated using (public.is_admin());

-- Realtime publication 에서 배제한다 — 쿼터 초과 이력이 있어 새 테이블을 구독에 얹지 않는다
--   (ops_audit 이 20260806010000:775-795 에서 같은 이유로 빠졌다. 그 do 블록을 그대로 복제).
do $$
begin
	if exists (select 1 from pg_publication where pubname = 'supabase_realtime' and puballtables) then
		raise notice 'supabase_realtime is FOR ALL TABLES — wait_point_* 가 자동 구독됩니다. 쿼터 확인 필요.';
	else
		if exists (
			select 1 from pg_publication_tables
			where pubname = 'supabase_realtime' and schemaname = 'public'
				and tablename in ('wait_point_ledger', 'wait_point_balances')
		) then
			alter publication supabase_realtime drop table public.wait_point_ledger;
			alter publication supabase_realtime drop table public.wait_point_balances;
		end if;
	end if;
end $$;

-- ------------------------------------------------------------
-- ⑤ wait_points_recount — 회원 단위 잠금 + 자가 치유. 판정은 언제나 이 **반환값**으로 한다.
-- ------------------------------------------------------------
create or replace function public.wait_points_recount(p_member uuid)
returns int
language plpgsql security definer set search_path = ''
as $$
declare
	v_stored int;
	v_actual int;
begin
	insert into public.wait_point_balances(member_id) values (p_member)
		on conflict (member_id) do nothing;
	select balance into v_stored from public.wait_point_balances
	where member_id = p_member for update;

	select coalesce(sum(delta), 0)::int into v_actual
	from public.wait_point_ledger where member_id = p_member;

	if v_stored is distinct from v_actual then
		update public.wait_point_balances
		set balance = v_actual, updated_at = now()
		where member_id = p_member;
	end if;
	return v_actual;
end;
$$;
revoke execute on function public.wait_points_recount(uuid) from public, anon, authenticated;

-- ------------------------------------------------------------
-- ⑥ wait_points_write — 포인트가 움직이는 **유일한 지점**. clamp 도 여기 한 곳에만 있다.
-- ------------------------------------------------------------
create or replace function public.wait_points_write(
	p_member  uuid,
	p_session bigint,
	p_kind    text,
	p_delta   int,
	p_detail  jsonb default '{}'::jsonb,
	p_actor   uuid  default null
)
returns int
language plpgsql security definer set search_path = ''
as $$
declare
	v_bal     int;
	v_max     int := public.wait_point_max();
	v_applied int;
	v_id      bigint;
begin
	v_bal := public.wait_points_recount(p_member);   -- 회원 행 FOR UPDATE 로 직렬화
	-- 결과 잔액이 [0, max] 를 벗어나지 않도록 **적용량 자체**를 줄인다 → sum(delta) = 잔액이 항상 성립.
	v_applied := least(greatest(p_delta, -v_bal), v_max - v_bal);

	insert into public.wait_point_ledger(
		member_id, session_id, kind, delta, balance_after, detail, actor)
	values (
		p_member, p_session, p_kind, v_applied, v_bal + v_applied,
		p_detail || case when v_applied <> p_delta
			then jsonb_build_object('capped', true, 'requested', p_delta)
			else '{}'::jsonb end,
		p_actor)
	on conflict do nothing
	returning id into v_id;

	-- 이미 기록된 사실(종료 트리거 재발화·백필 재실행) — 잔액을 건드리지 않는다.
	if v_id is null then return v_bal; end if;

	v_bal := v_bal + v_applied;
	update public.wait_point_balances
	set balance = v_bal, updated_at = now()
	where member_id = p_member;
	return v_bal;
end;
$$;
revoke execute on function public.wait_points_write(uuid, bigint, text, int, jsonb, uuid)
	from public, anon, authenticated;

-- ------------------------------------------------------------
-- ⑦ 티켓 상태 술어
-- ------------------------------------------------------------
-- 이 회차에서 티켓이 **지불된 상태인가** = spend 건수 > refund 건수.
-- 환원하면 저절로 false 가 되므로 이중 환원이 자가 차단된다.
create or replace function public.wait_ticket_spent(p_session_id bigint, p_member uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
	select coalesce(count(*) filter (where kind = 'spend'), 0)
	     > coalesce(count(*) filter (where kind = 'refund'), 0)
	from public.wait_point_ledger
	where session_id = p_session_id and member_id = p_member;
$$;
revoke execute on function public.wait_ticket_spent(bigint, uuid) from public, anon, authenticated;

-- 이 회차에서 **살아 있는** 티켓 자리 수. 저장 카운터가 아니라 실제 행이라 드리프트가 없고,
-- 취소하면 슬롯이 저절로 돌아온다.
--
-- 판정을 `exempt_reason='ticket'` 이 아니라 **원장의 살아 있는 지불(wait_ticket_spent)** 로 한다.
--   exempt_reason 으로 세면 상한이 뚫린다: 티켓 사용자가 정원외늦참으로 전환하면 set_late_minutes 가
--   capacity_exempt·exempt_reason 을 함께 내려놓으므로(확정 자리를 떠나므로 옳다) 카운트에서 빠지고,
--   그 틈에 3번째 사람이 티켓을 쓴 뒤 원래 사람이 정시 복귀하면 — 복귀는 재검증하지 않으므로 —
--   한 회차에 티켓 자리가 3개가 된다. 원장은 늦참 왕복 중에도 지불 사실을 그대로 들고 있다.
--
-- status 필터로 취소 행을 빼므로 슬롯 반환은 그대로다. 당일취소(몰수)로 지불이 살아 있는 행도
--   status='cancelled' 라 빠진다 — 그 사람은 오지 않으므로 실제 정원 외 인원은 상한 안에 남는다.
-- 반대 방향(과소 계수)으로는 절대 틀리지 않는다: 지불이 살아 있고 자리를 들고 있으면 무조건 센다.
create or replace function public.wait_ticket_session_used(p_session_id bigint)
returns int
language sql stable security definer set search_path = ''
as $$
	select count(*)::int from public.attendances a
	where a.session_id = p_session_id
		and a.status in ('confirmed', 'late_pool')
		and public.wait_ticket_spent(p_session_id, a.member_id);
$$;
revoke execute on function public.wait_ticket_session_used(bigint) from public, anon, authenticated;

-- ------------------------------------------------------------
-- ⑧ join_session — 티켓 분기 추가. 시그니처가 넓어지므로 **구 함수를 먼저 drop 한다**.
--   1인자 함수가 남으면 PostgREST 가 {p_session_id} 페이로드에서 후보를 못 골라 참석 신청 전체가 죽는다.
--   (set_late_minutes 가 20260708010000 이래 매번 쓴 관례와 같다.)
-- ------------------------------------------------------------
drop function if exists public.join_session(bigint);

create or replace function public.join_session(
	p_session_id bigint,
	p_use_ticket boolean default false
)
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

			if public.is_operator(v_member) and v_ocount < 2 then
				-- ① 운영진 프리패스 — 종전대로 **정원 카운트에 든다**(초과분이 카운터에 남는다).
				v_new := 'confirmed';
				update public.session_counters set confirmed_count = v_count + 1
					where session_id = p_session_id;
			elsif public.session_newbie_grace(p_session_id, v_member) then
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
$$;
revoke execute on function public.join_session(bigint, boolean) from anon;
grant execute on function public.join_session(bigint, boolean) to authenticated;

-- ------------------------------------------------------------
-- ⑨ promote_next_waitlisted — **자격식은 손대지 않는다(재론 금지, 위 헤더 참조).**
--   승격은 언제나 '정원 안' 자리이므로 exempt_reason 도 함께 내려놓는 위생 한 줄만 더한다.
--   기준판 = 20260903010000:75-117.
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
	--   신규 프리패스는 **여기에 없다** — 부여는 join_session / set_late_minutes 에서만.
	--   **우선참여권(티켓)도 여기에 없다**(20260904000000). 넣으면 정원 안 대기 1순위가 티켓 보유자에게
	--   영구 추월당해, 대기 구제가 목적인 기능이 대기 1번을 막는 역설이 된다. 재론 금지.
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
	set status = 'confirmed', confirmed_at = now(), updated_at = now(),
		capacity_exempt = false,                     -- 승격은 언제나 '정원 안' 자리다
		exempt_reason = null                         -- 정원 외 사유도 함께 내려놓는다(쌍 규약)
	where session_id = v_promote.session_id and member_id = v_promote.member_id;
	update public.session_counters set confirmed_count = v_count + 1
	where session_id = p_session_id;
	return v_promote;
end;
$$;
revoke execute on function public.promote_next_waitlisted(bigint) from public, anon, authenticated;

-- ------------------------------------------------------------
-- ⑩ set_late_minutes — 정원 외 사유의 쌍 규약 + late_pool 복귀 시 티켓 자리 되찾기.
--   기준판 = 20260903010000:230-338.
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
	v_exempt    boolean := false;
	v_reason    text;
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
		set status = 'late_pool', late_minutes = v_min, confirmed_at = null, updated_at = now(),
			capacity_exempt = false,       -- 확정 자리를 떠나므로 '정원 외 확정' 성격도 함께 내려놓는다
			exempt_reason = null           -- 쌍 규약. **티켓은 환원하지 않는다** — 원장 spend 가 남아
		                                   --   자리가 그 회차에 묶여 있고, 정시 복귀하면 되찾는다(아래).
		where session_id = p_session_id and member_id = v_member;

		if v_self.status = 'confirmed' then
			perform public.session_counter_sync(p_session_id);   -- 정원 1칸 반납 반영
			v_promoted := public.promote_waitlist_fill(p_session_id);
		end if;

	elsif v_status = 'open' and not v_pool and v_self.status = 'late_pool' then
		-- 정원 외 풀 → 복귀. 여유면 확정, 만석이면 부과없음 프리패스(운영진 총수 < 2 / 신규 상한 없음),
		--   그다음 **이미 지불한 티켓 자리 되찾기**, 그 외 대기.
		if v_capacity is null or v_count < v_capacity then
			v_new := 'confirmed';
			update public.session_counters set confirmed_count = v_count + 1
				where session_id = p_session_id;
		elsif public.session_op_free(p_session_id) then
			select count(*) into v_ocount from public.attendances
			where session_id = p_session_id and status = 'confirmed' and public.is_operator(member_id);

			if public.is_operator(v_member) and v_ocount < 2 then
				v_new := 'confirmed';                  -- 운영진 프리패스 = 정원 카운트에 든다
				update public.session_counters set confirmed_count = v_count + 1
					where session_id = p_session_id;
			elsif public.session_newbie_grace(p_session_id, v_member) then
				v_new := 'confirmed';                  -- 신규 프리패스 = 정원 외 자리
				v_exempt := true;
				v_reason := 'newbie';
			end if;
		end if;

		if v_new = 'late_pool' and public.wait_ticket_spent(p_session_id, v_member) then
			-- 이 회차에 이미 티켓을 낸 사람이 정시로 돌아왔다 → **재차감 없이** 자리를 되찾는다.
			--   회차당 상한도 다시 걸지 않는다(이미 산 자리라, 다시 걸면 자기 자리를 남에게 뺏긴다).
			v_new := 'confirmed';
			v_exempt := true;
			v_reason := 'ticket';
		end if;

		if v_new = 'late_pool' then v_new := 'waitlisted'; end if;

		update public.attendances
		set status = v_new, late_minutes = v_min,
			position = nextval('public.attendance_position_seq'),
			confirmed_at = case when v_new = 'confirmed' then now() else null end,
			capacity_exempt = v_exempt,
			exempt_reason = v_reason,
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
-- ⑪ set_session_capacity — 로직 무변경. 정원 외 자리 보존 분기가 티켓 자리도 자동으로 지킨다.
--   강등 UPDATE 에 exempt_reason 을 쌍으로 맞추는 한 줄만 더한다(유령 사유 방지).
--   기준판 = 20260903010000:340-441.
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
	v_exempt   boolean;
	v_reason   text;
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

		if v_att.capacity_exempt and v_att.status = 'confirmed' then
			-- 정원 외 확정 자리(신규 프리패스 · 우선참여권)는 **재배분 대상이 아니다**.
			-- 정원을 소비하지 않으므로 그대로 둔다 — 사유도 그대로 물려받는다.
			v_want := 'confirmed';
			v_exempt := true;
			v_reason := v_att.exempt_reason;
		elsif (p_capacity is null or v_cc < p_capacity)
		   and (not v_isguest or v_gcap is null or v_g < v_gcap) then
			v_want := 'confirmed';                                   -- 정원 여유 + 게스트 상한 여유
			v_exempt := false;
			v_reason := null;
		elsif v_opfree and v_isop and v_o < 2 then
			v_want := 'confirmed';                                   -- 부과없음 운영진 프리패스
			v_exempt := false;
			v_reason := null;
		else
			-- 대기자에게 정원 외 자리를 **새로 주지는 않는다** — 부여는 본인이 누른 순간에만.
			v_want := 'waitlisted';
			v_exempt := false;
			v_reason := null;
		end if;

		if v_want = 'confirmed' then
			if not v_exempt then v_cc := v_cc + 1; end if;           -- 정원 외 자리는 정원을 소비하지 않는다
			if v_isop then v_o := v_o + 1; end if;                   -- 운영진 총수는 정원 외도 포함(기존 규칙)
			if v_isguest then v_g := v_g + 1; end if;
		end if;

		if v_want <> v_att.status
			or v_exempt is distinct from v_att.capacity_exempt
			or v_reason is distinct from v_att.exempt_reason then
			update public.attendances
			set status = v_want,
				capacity_exempt = v_exempt,
				exempt_reason = v_reason,
				confirmed_at = case when v_want = 'confirmed' then now() else null end,
				updated_at = now()
			where session_id = p_session_id and member_id = v_att.member_id;
		end if;

		-- 알림은 **상태가 실제로 바뀔 때만**(정원 외 플래그만 정리된 경우는 알리지 않는다).
		if v_want <> v_att.status then

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
-- ⑫ 취소 시 환원/차감 — 세 취소 경로가 공유하는 헬퍼.
--   판정선은 **새로 만들지 않고** 기존 단일 술어 dues_is_day_cancel_chargeable(20260810000000)을
--   그대로 쓴다: 세션 당일(KST) 취소 + 확정 후 1시간 경과(오조작 유예). 회계와 같은 선을 쓰므로
--   "대관비는 물렸는데 포인트는 안 깎였다" 같은 어긋남이 생기지 않는다.
-- ------------------------------------------------------------
create or replace function public.wait_ticket_on_cancel(
	p_session_id bigint, p_member uuid, p_by_admin boolean
)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
	v_self       public.attendances%rowtype;
	v_sched      timestamptz;
	v_day_cancel boolean;
	v_ticket     boolean;
begin
	select * into v_self from public.attendances
	where session_id = p_session_id and member_id = p_member;
	if not found then return; end if;
	-- 게스트 행은 포인트 세계에 존재하지 않는다.
	if v_self.invited_by is not null then return; end if;
	if exists (select 1 from public.members where id = p_member and is_guest) then return; end if;

	select scheduled_at into v_sched from public.sessions where id = p_session_id;
	v_day_cancel := public.dues_is_day_cancel_chargeable(
		v_self.status, v_self.confirmed_at, v_self.cancelled_at, v_sched);
	v_ticket := public.wait_ticket_spent(p_session_id, p_member);

	if v_ticket and not v_day_cancel then
		-- 사전 취소 · 운영진 제거 → 전액 환원. (당일 취소는 몰수 — C10)
		perform public.wait_points_write(
			p_member, p_session_id, 'refund', public.wait_ticket_cost(),
			jsonb_build_object('reason', case when p_by_admin then 'admin_cancel' else 'early_cancel' end));
	end if;

	-- 불참 −1 은 **본인이 당일에 뺀 경우만**이다. 운영진 제거는 귀책이 불분명하므로 벌하지 않는다
	--   (운영진이 노쇼를 정리한 것인지 다른 사정으로 뺀 것인지 이 자리에서 구분할 수 없다).
	if v_day_cancel and not p_by_admin then
		perform public.wait_points_write(
			p_member, p_session_id, 'penalty', -1,
			jsonb_build_object('reason', 'day_cancel'));
	end if;
end;
$$;
revoke execute on function public.wait_ticket_on_cancel(bigint, uuid, boolean)
	from public, anon, authenticated;

-- cancel_attendance — 기준판 20260806010000:423-457. 헬퍼 호출 한 줄만 추가한다.
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

	-- 티켓 환원/불참 차감. capacity_exempt·exempt_reason 은 **지우지 않는다** — 취소된 행의
	--   자리 성격은 기록으로 남긴다. 회차 상한 계수는 status 로 취소 행을 걸러내므로
	--   (wait_ticket_session_used) 취소하면 슬롯이 저절로 돌아온다.
	perform public.wait_ticket_on_cancel(p_session_id, v_member, false);

	perform public.session_counter_sync(p_session_id);   -- 취소 반영(±1 산술 대신 재계산)

	-- 확정자였는지와 무관하게 open 세션이면 빈자리를 채운다(치유로 자리가 드러날 수 있음).
	if v_status = 'open' then
		perform public.promote_waitlist_fill(p_session_id);
	end if;
end;
$$;
grant execute on function public.cancel_attendance(bigint) to authenticated;

-- admin_cancel_attendance — 기준판 20260806010000:462-515. 헬퍼 호출 한 줄만 추가한다.
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

	perform public.wait_ticket_on_cancel(p_session_id, p_member_id, true);

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
-- ⑬ 정산 — 회차 종료 시 적립(+1)과 노쇼 차감(−1)
-- ------------------------------------------------------------
-- '실제로 열린 회차인가' 게이트 = 그 회차에 matches 가 1건이라도 있는가.
--   sync A단계(20260815000000:30-37)는 참석자·경기 유무를 보지 않고 지난 draft/open 을 전부 closed 로
--   만든다. 이 게이트가 없으면 열리지도 않은 유령 회차에서 대기자가 포인트를 받고, 확정자가 전원
--   노쇼로 찍힌다. 회계도 같은 종류의 술어로 '실제로 열렸나'를 판정한다.
--
-- 노쇼 판정 = confirmed 인데 session_players 에 행이 없다.
--   start_session_from_schedule(20260713020000:41-51)이 **확정자 전원을 session_players 로 시드**하고,
--   진행 중 신청(join_session 의 v_status='active' 분기)도 같이 넣는다. 따라서 종료 시점에 행이 없다는
--   것은 운영진이 보드에서 뺐다는 뜻이고, 실무에서 그것이 곧 '안 왔다'이다.
--   dues_court_targets(20260818000000:30-33)가 당일취소 딱지를 뒤집는 데 쓰는 신호와 같은 것이다.
--   한계: 운영진이 다른 사정으로 뺀 경우도 노쇼로 잡힌다 → 운영진 수동 보정(⑯)으로 되돌린다.
create or replace function public.wait_points_settle_session(p_session_id bigint)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
	v_has_matches boolean;
	v_sched       timestamptz;
	v_row         record;
	v_bal         int;
begin
	select exists (select 1 from public.matches m where m.session_id = p_session_id)
		into v_has_matches;
	if not v_has_matches then return; end if;   -- 열리지 않은 회차는 손대지 않는다

	select scheduled_at into v_sched from public.sessions where id = p_session_id;

	-- (a) 적립 — 대기인 채로 끝난 회원. order by member_id 로 잠금 순서를 고정한다.
	for v_row in
		select a.member_id
		from public.attendances a
		join public.members m on m.id = a.member_id
		where a.session_id = p_session_id
			and a.status = 'waitlisted'
			and a.invited_by is null
			and not m.is_guest
			and m.is_active
			-- 대기였는데 현장에서 보드에 직접 투입돼 실제로 뛴 사람은 '못 나온 사람'이 아니다.
			and not exists (
				select 1 from public.session_players sp
				where sp.session_id = p_session_id and sp.member_id = a.member_id)
		order by a.member_id
	loop
		v_bal := public.wait_points_write(
			v_row.member_id, p_session_id, 'earn', 1,
			jsonb_build_object('reason', 'waitlisted_at_close', 'session_at', v_sched));

		-- 잔액이 방금 가득 찼다 → 우선참여권 획득 알림 1건.
		--   전이(6→7)에서만 발화하므로 earn 이 멱등인 한 중복되지 않는다. 회차별 +1 알림은 보내지 않는다
		--   — sync A단계는 여러 회차를 한 트랜잭션에서 닫고 알림 INSERT 마다 푸시가 나간다(호출 폭주 이력).
		if v_bal = public.wait_point_max() then
			insert into public.notifications(recipient_member_id, type, session_id, payload)
			values (v_row.member_id, 'wait_ticket_ready', p_session_id,
				jsonb_build_object('balance', v_bal));
		end if;
	end loop;

	-- (b) 노쇼 차감 — 확정인데 보드에 한 번도 오르지 않은 회원.
	for v_row in
		select a.member_id
		from public.attendances a
		join public.members m on m.id = a.member_id
		where a.session_id = p_session_id
			and a.status = 'confirmed'
			and a.invited_by is null
			and not m.is_guest
			-- 적립 쪽과 같은 필터를 둔다(대칭). 비활성 회원은 포인트 세계에서 빠져 있으므로
			-- 차감도 하지 않는다 — 어차피 못 쓰는 잔액을 깎아 놓으면 복구 시 이유를 알 수 없다.
			and m.is_active
			and not exists (
				select 1 from public.session_players sp
				where sp.session_id = p_session_id and sp.member_id = a.member_id)
		order by a.member_id
	loop
		perform public.wait_points_write(
			v_row.member_id, p_session_id, 'penalty', -1,
			jsonb_build_object('reason', 'noshow', 'session_at', v_sched));
	end loop;
end;
$$;
revoke execute on function public.wait_points_settle_session(bigint) from public, anon, authenticated;

-- 종료 훅. 배선은 trg_session_court_on_close(20260715080000:142-147 / 함수 본문 20260831000000:151-162)와
--   같은 형식. 이름이 trg_session_w* 라 알파벳순으로 complete_matches → court → wait_points 가 되어
--   회계가 먼저 확정된 뒤 포인트가 움직인다.
-- **본문 전체를 예외 격리한다** — 포인트 실패가 회차 종료(나아가 sync 전 단계)를 죽이면 안 된다.
create or replace function public.trg_session_wait_points_on_close()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
	begin
		perform public.wait_points_settle_session(new.id);
	exception when others then
		raise warning 'wait_points settle failed for session %: %', new.id, sqlerrm;
	end;
	return new;
end;
$$;
revoke execute on function public.trg_session_wait_points_on_close() from public, anon, authenticated;

drop trigger if exists trg_session_wait_points_on_close on public.sessions;
create trigger trg_session_wait_points_on_close
	after update of status on public.sessions
	for each row
	when (new.status = 'closed' and old.status is distinct from 'closed')
	execute function public.trg_session_wait_points_on_close();

-- ------------------------------------------------------------
-- ⑭ 회차 취소 훅 — 운영진 사정으로 열리지 않았으니 티켓을 전액 돌려준다.
--   적립은 하지 않는다(열리지 않은 회차에는 '못 들어간 손해'가 실재하지 않는다).
--   closed 훅은 리터럴 매칭이라 취소 회차를 절대 타지 않는다.
-- ------------------------------------------------------------
create or replace function public.trg_session_wait_points_on_cancel()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
	v_row record;
begin
	begin
		for v_row in
			select a.member_id from public.attendances a
			where a.session_id = new.id
				and a.exempt_reason = 'ticket'
				and a.invited_by is null
			order by a.member_id
		loop
			if public.wait_ticket_spent(new.id, v_row.member_id) then
				perform public.wait_points_write(
					v_row.member_id, new.id, 'refund', public.wait_ticket_cost(),
					jsonb_build_object('reason', 'session_cancelled'));
			end if;
		end loop;
	exception when others then
		raise warning 'wait_points refund failed for cancelled session %: %', new.id, sqlerrm;
	end;
	return new;
end;
$$;
revoke execute on function public.trg_session_wait_points_on_cancel() from public, anon, authenticated;

drop trigger if exists trg_session_wait_points_on_cancel on public.sessions;
create trigger trg_session_wait_points_on_cancel
	after update of status on public.sessions
	for each row
	when (new.status = 'cancelled' and old.status is distinct from 'cancelled')
	execute function public.trg_session_wait_points_on_cancel();

-- ------------------------------------------------------------
-- ⑮ 조회 RPC (authenticated)
-- ------------------------------------------------------------
-- 내 포인트 상태. 클라가 상수를 하드코딩하지 않게 규칙 값도 함께 준다.
create or replace function public.wait_points_my_status()
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
	v_member uuid := public.current_member_id();
	v_bal    int;
begin
	if v_member is null then raise exception 'not authenticated'; end if;
	v_bal := public.wait_points_recount(v_member);
	return jsonb_build_object(
		'balance',      v_bal,
		'max',          public.wait_point_max(),
		'cost',         public.wait_ticket_cost(),
		'session_cap',  public.wait_ticket_session_cap(),
		'has_ticket',   v_bal >= public.wait_ticket_cost()
	);
end;
$$;
revoke execute on function public.wait_points_my_status() from public, anon;
grant execute on function public.wait_points_my_status() to authenticated;

-- 내 원장 + 회차 라벨. session_id 에 FK 가 없어 PostgREST 임베드가 안 되므로 여기서 조인해 준다.
create or replace function public.wait_points_my_ledger(p_limit int default 60)
returns table (
	id            bigint,
	session_id    bigint,
	kind          text,
	delta         int,
	balance_after int,
	detail        jsonb,
	created_at    timestamptz,
	session_at    timestamptz,
	place_name    text
)
language sql stable security definer set search_path = ''
as $$
	select l.id, l.session_id, l.kind, l.delta, l.balance_after, l.detail, l.created_at,
		coalesce(s.scheduled_at, (l.detail ->> 'session_at')::timestamptz) as session_at,
		p.name as place_name
	from public.wait_point_ledger l
	left join public.sessions s on s.id = l.session_id
	left join public.places   p on p.id = s.place_id
	where l.member_id = public.current_member_id()
	order by l.created_at desc, l.id desc
	limit greatest(1, least(coalesce(p_limit, 60), 200));
$$;
revoke execute on function public.wait_points_my_ledger(int) from public, anon;
grant execute on function public.wait_points_my_ledger(int) to authenticated;

-- 이 회차에서 우선참여권을 쓸 수 있는가 — 화면이 추측하지 않게 서버가 답한다.
--   클라 스토어에는 부과 여부·다른 회차 정보가 없고, 티켓 상한은 실시간으로 변한다.
create or replace function public.wait_ticket_options(p_session_id bigint)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
	v_member   uuid := public.current_member_id();
	v_bal      int;
	v_cost     int := public.wait_ticket_cost();
	v_cap      int := public.wait_ticket_session_cap();
	v_used     int;
	v_capacity int;
	v_status   text;
	v_count    int;
	v_reason   text;
begin
	if v_member is null then raise exception 'not authenticated'; end if;
	v_bal  := public.wait_points_recount(v_member);
	v_used := public.wait_ticket_session_used(p_session_id);

	select capacity, status into v_capacity, v_status
	from public.sessions where id = p_session_id;
	if not found then raise exception 'session not found'; end if;

	-- 여기서는 카운터를 **읽기만** 한다(session_counter_sync 는 쓰기 잠금이라 조회 RPC 에서 부르지 않는다).
	select count(*)::int into v_count from public.attendances
	where session_id = p_session_id and status = 'confirmed' and not capacity_exempt;

	if public.wait_ticket_spent(p_session_id, v_member) then v_reason := 'already_spent';
	elsif v_status not in ('open', 'active')                then v_reason := 'not_open';
	elsif v_capacity is null or v_count < v_capacity        then v_reason := 'not_full';
	elsif public.session_op_free(p_session_id)
		and (public.session_newbie_grace(p_session_id, v_member)
			or (public.is_operator(v_member) and (
				select count(*) from public.attendances
				where session_id = p_session_id and status = 'confirmed'
					and public.is_operator(member_id)) < 2))
	                                                        then v_reason := 'free_pass';
	elsif v_bal < v_cost                                    then v_reason := 'insufficient';
	elsif v_used >= v_cap                                   then v_reason := 'session_cap';
	else                                                         v_reason := 'ok';
	end if;

	return jsonb_build_object(
		'reason',      v_reason,
		'balance',     v_bal,
		'cost',        v_cost,
		'used',        v_used,
		'session_cap', v_cap
	);
end;
$$;
revoke execute on function public.wait_ticket_options(bigint) from public, anon;
grant execute on function public.wait_ticket_options(bigint) to authenticated;

-- ------------------------------------------------------------
-- ⑯ 운영진 수동 보정 — 오판정(노쇼 오탐 등)을 되돌리는 유일한 통로.
--   원장은 append-only 이므로 정정도 '반대 부호 행 추가'다(UPDATE/DELETE 정책이 없다).
-- ------------------------------------------------------------
create or replace function public.wait_points_admin_adjust(
	p_member_id uuid, p_delta int, p_note text default null
)
returns int
language plpgsql security definer set search_path = ''
as $$
declare
	v_actor uuid := public.current_member_id();
begin
	if not public.is_admin() then raise exception 'forbidden'; end if;
	if p_delta = 0 then raise exception 'invalid delta'; end if;
	return public.wait_points_write(
		p_member_id, null, 'adjust', p_delta,
		jsonb_build_object('note', coalesce(p_note, '')), v_actor);
end;
$$;
revoke execute on function public.wait_points_admin_adjust(uuid, int, text) from public, anon;
grant execute on function public.wait_points_admin_adjust(uuid, int, text) to authenticated;

-- ------------------------------------------------------------
-- ⑰ 소급 백필 — 2026-08-01 이후 종료된 회차의 대기 이력(C8).
--   wait_points_write 를 회차 시각 오름차순으로 호출하므로 상한 7 clamp 가 실제 적립과 동일하게 걸린다.
--   부분 유니크 인덱스 덕에 이 블록을 다시 돌려도 결과가 같다(재실행 안전).
--   노쇼 차감은 소급하지 않는다 — 규칙이 없던 기간의 행동을 사후에 벌하지 않는다.
--   알림도 보내지 않는다(과거분을 한꺼번에 밀어 넣으므로 푸시가 폭주한다).
-- ------------------------------------------------------------
do $$
declare
	v_row record;
	v_n   int := 0;
begin
	for v_row in
		select a.member_id, a.session_id, s.scheduled_at
		from public.attendances a
		join public.sessions s on s.id = a.session_id
		join public.members  m on m.id = a.member_id
		where s.status = 'closed'
			and s.scheduled_at is not null
			and (s.scheduled_at at time zone 'Asia/Seoul')::date >= date '2026-08-01'
			and a.status = 'waitlisted'
			and a.invited_by is null
			and not m.is_guest
			and m.is_active
			and exists (select 1 from public.matches mt where mt.session_id = s.id)
			and not exists (
				select 1 from public.session_players sp
				where sp.session_id = s.id and sp.member_id = a.member_id)
		order by s.scheduled_at asc, a.member_id asc
	loop
		perform public.wait_points_write(
			v_row.member_id, v_row.session_id, 'earn', 1,
			jsonb_build_object('reason', 'backfill', 'session_at', v_row.scheduled_at));
		v_n := v_n + 1;
	end loop;
	raise notice '[wait_points] 소급 적립 % 건(2026-08-01 이후)', v_n;
end $$;
