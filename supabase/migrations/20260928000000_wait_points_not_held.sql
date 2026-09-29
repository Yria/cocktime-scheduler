-- ============================================================
-- 대기 포인트: **열리지 않은 회차(미진행)** 정산 — 신청을 유지한 회원 +1 · 당일취소 감점 환원 · 티켓 환원.
--
-- 요청(2026-09-28 운영자): "주말벙같이 인원이 다 차야만 경기가 진행되는 날에 참여를 눌렀는데 경기가
--   열리지 않았을 때도 포인트를 주고 싶다."
-- 운영자 확정 사양:
--   N1. **미진행 = [경기 시작]을 누른 적이 없는 회차.** 증거는 보드(session_players)다 —
--       start_session_from_schedule 이 시작 순간 확정자 전원을 시드한다. 20260905000000 의 회차 게이트와
--       **같은 술어의 반대편**을 쓰는 것뿐이다(경기 기록 matches 로 내려가지 않는다 — 재론 금지 결정 그대로).
--       회차 옵션·주말 판정·정원 미달 조건은 두지 않는다. 운영자가 "눌렀으면 진행, 아니면 미진행"으로 그었다.
--   N2. **대상 = 끝까지 신청을 유지한 회원 전원** — confirmed · late_pool · waitlisted.
--       게스트·비활성 회원은 제외(기존 적립과 같은 필터). 회차당 1점 — earn 유니크 인덱스가 보장한다.
--   N3. **그 회차의 당일 취소 −1 은 되돌린다**(새 kind 'reversal'). 열리지 않은 회차라 당일 이탈이 회차에
--       끼친 손해가 없다. 되돌리는 양은 실제로 깎인 양(clamp 후 delta)이다 — 0점이라 안 깎였으면 되돌릴 것도 없다.
--   N4. **그 회차에 쓴 티켓은 아직 환원되지 않았으면 전액 환원** — 당일 취소로 몰수된 것까지.
--   N5. **소급 없음**(신규 기능). 이 마이그레이션 이후에 끝나는 회차부터 적용된다.
--   회차별 "+1 적립" 알림은 여전히 보내지 않는다. 7점에 닿는 순간의 wait_ticket_ready 한 건뿐이다
--   (sync A단계는 여러 회차를 한 트랜잭션에서 닫는다 — 20260905000000:76-78 의 호출 폭주 이력).
--
-- **뒤집는 이전 결정(의도):** 20260904000000 ⑭ "적립은 하지 않는다(열리지 않은 회차에는 '못 들어간 손해'가
--   실재하지 않는다)". 이번 보상은 '못 들어간 손해'가 아니라 '신청해 두고 시간을 비워 뒀는데 열리지 않은
--   손해'다. 받는 사람도 대기자가 아니라 주로 확정자다(정원이 안 찬 회차에는 대기자가 거의 없다).
--
-- 미진행 회차가 끝나는 경로 3개 — 셋 다 wait_points_settle_not_held 한 함수로 모은다:
--   ① 방치 → sync A단계가 다음 날 closed                : 종료 훅 → wait_points_settle_session 의 보드 없음 분기
--   ② [삭제] 반복 회차 · 금융 기록 있는 회차 → cancelled : 취소 훅(보드가 없을 때)
--   ③ [삭제] 금융 기록 없는 일회성 회차 → **하드 DELETE** : 새 BEFORE DELETE 훅. attendances 는 CASCADE 로
--      곧 사라지므로 **삭제 직전**에 정산한다. 원장은 session_id FK 가 없어 남는다(20260904000000:100-101).
--      삭제 흐름(dues_delete_session) 자체는 바꾸지 않는다 — 회계 소유 함수이고, 삭제 직전 정산으로 충분하다.
--   세 경로가 한 회차에 겹쳐도(취소 → 삭제, 방치 종료 → 삭제, 되살리기 → 재취소) 결과는 한 번이다:
--   earn·reversal 은 유니크 인덱스가, 티켓 환원은 wait_ticket_spent(spend > refund)가 스스로 막는다.
--
-- 같이 고치는 기존 결함(운영자 선택):
--   F1. ①·③ 경로에서 쓴 티켓이 환원되지 않았다(환원이 cancelled 훅에만 있었다). → N4 가 해소한다.
--   F2. 7점 알림 중복 — 이미 7점인 회원이 또 적립 조건을 만나면 capped(delta 0) 행이 새로 들어가 반환 잔액이
--       7이 되고 알림이 또 나갔다. 20260905000000:77 주석의 '전이(6→7)에서만'이 코드와 달랐다.
--       → 적립·감점 환원 **직전 잔액 < 7 이고 직후 = 7** 일 때만 보낸다(wait_points_credit 한 곳).
--       감점 환원(reversal)도 처음 7점에 닿게 할 수 있으므로 같은 검사를 탄다 — 그러지 않으면 sync A 가 한 UPDATE 로
--       여러 회차를 닫을 때 어느 회차가 먼저 처리되느냐로 알림 여부가 갈린다. 티켓 환원(refund)은 제외한다:
--       티켓을 쓰려면 7점이어야 했으므로, 환원으로 되찾는 7점은 이미 한 번 알린 상태다.
--   F3. 취소 훅이 exempt_reason='ticket' 으로 티켓 사용자를 찾아, 늦참 전환(set_late_minutes 가 exempt_reason 을
--       내려놓는다)을 거친 사용자를 놓쳤다. → **원장의 spend 행**으로 찾는다(지불의 권위는 원장 —
--       20260904000000:79, 같은 이유로 wait_ticket_session_used 도 원장을 본다 :275-279).
--
-- 알려진 한계(수용): 취소 회차를 [되살리기](cancelled→draft)해 결국 진행돼도 이미 준 +1·환원은 회수하지 않는다.
--   되살리기는 운영진 오조작 교정용의 드문 경로이고, 회수 행을 쓰면 재취소 때 유니크 인덱스에 막혀 보상이
--   영영 사라진다. 기존 티켓 환원도 같은 성질이다.
--
-- sessions 에 붙는 훅은 search_path='' + 모든 참조 public. 한정 + 본문 통째 예외 격리(20260904000000:46-50) —
--   포인트 실패가 회차 종료·취소·삭제를 막으면 안 된다. BEFORE DELETE 훅은 반드시 old 를 돌려준다
--   (null 을 돌려주면 삭제 자체가 조용히 취소된다).
--
-- 기준판(적용 완료): wait_points_settle_session = 20260905000000,
--   trg_session_wait_points_on_cancel · wait_points_my_ledger = 20260904000000.
-- ============================================================

-- ------------------------------------------------------------
-- ① 원장 kind 에 'reversal'(감점 환원) 추가
--   컬럼 인라인 CHECK 라 제약 이름이 자동 생성이다 — 이름을 가정하지 않고 kind 를 보는 CHECK 를 찾아 지운다.
--   (drop if exists 로 이름을 틀리면 옛 CHECK 가 남아 'reversal' INSERT 가 전부 실패한다.)
-- ------------------------------------------------------------
do $$
declare
	v_con record;
begin
	for v_con in
		select conname from pg_constraint
		where conrelid = 'public.wait_point_ledger'::regclass
			and contype = 'c'
			and pg_get_constraintdef(oid) ilike '%kind%'
	loop
		execute format('alter table public.wait_point_ledger drop constraint %I', v_con.conname);
	end loop;
end $$;

alter table public.wait_point_ledger add constraint wait_point_ledger_kind_check
	check (kind in ('earn', 'spend', 'refund', 'penalty', 'adjust', 'reversal'));

-- ★ 재실행 면역에 reversal 을 넣는다. 한 회차에서 회원당 penalty 가 최대 1행이므로 되돌림도 최대 1행이다.
--   spend/refund 를 빼는 이유는 그대로다(20260904000000:119-121 — 환원 뒤 재사용 경로).
drop index if exists public.wait_point_ledger_once_per_session;
create unique index wait_point_ledger_once_per_session
	on public.wait_point_ledger (member_id, session_id, kind)
	where session_id is not null and kind in ('earn', 'penalty', 'reversal');

-- ------------------------------------------------------------
-- ② wait_points_credit — 가산(적립 earn · 감점 환원 reversal)과 7점 도달 알림을 한 곳에서. (F2)
--   p_notify_session: 알림의 session_id. 미진행 경로는 null 을 넘긴다 — 하드 DELETE 직전에 정산하면
--   notifications.session_id 의 ON DELETE CASCADE 가 방금 넣은 알림을 지운다. wait_ticket_ready 는
--   회차 정보를 쓰지 않는다(send-push 도 홈으로 보낸다).
-- ------------------------------------------------------------
create or replace function public.wait_points_credit(
	p_member         uuid,
	p_session        bigint,
	p_kind           text,
	p_delta          int,
	p_detail         jsonb,
	p_notify_session bigint
)
returns int
language plpgsql security definer set search_path = ''
as $$
declare
	v_prev int;
	v_bal  int;
	v_max  int := public.wait_point_max();
begin
	if p_kind not in ('earn', 'reversal') then
		raise exception 'wait_points_credit: unsupported kind %', p_kind;
	end if;
	v_prev := public.wait_points_recount(p_member);   -- 회원 행 잠금. write 안의 recount 는 같은 잠금을 다시 잡는다.
	v_bal  := public.wait_points_write(p_member, p_session, p_kind, p_delta, p_detail);

	-- 이번 가산으로 **막** 가득 찼을 때만. 이미 7점이었다면(capped 행 · 재발화 충돌) 보내지 않는다.
	if v_prev < v_max and v_bal >= v_max then
		insert into public.notifications(recipient_member_id, type, session_id, payload)
		values (p_member, 'wait_ticket_ready', p_notify_session,
			jsonb_build_object('balance', v_bal));
	end if;
	return v_bal;
end;
$$;
revoke execute on function public.wait_points_credit(uuid, bigint, text, int, jsonb, bigint)
	from public, anon, authenticated;

-- ------------------------------------------------------------
-- ③ wait_points_refund_session_tickets — 이 회차에서 아직 지불 상태인 티켓 전부 환원. (F1 · F3)
--   찾는 기준은 원장의 spend 행이다. 참석 행(exempt_reason)은 늦참 왕복에서 사유를 내려놓고,
--   하드 DELETE 에서는 행 자체가 사라진다. 이중 환원은 wait_ticket_spent 가 스스로 막는다.
-- ------------------------------------------------------------
create or replace function public.wait_points_refund_session_tickets(
	p_session_id bigint,
	p_detail     jsonb
)
returns int
language plpgsql security definer set search_path = ''
as $$
declare
	v_row record;
	v_n   int := 0;
begin
	for v_row in
		select distinct l.member_id
		from public.wait_point_ledger l
		where l.session_id = p_session_id and l.kind = 'spend'
		order by l.member_id
	loop
		if public.wait_ticket_spent(p_session_id, v_row.member_id) then
			perform public.wait_points_write(
				v_row.member_id, p_session_id, 'refund', public.wait_ticket_cost(), p_detail);
			v_n := v_n + 1;
		end if;
	end loop;
	return v_n;
end;
$$;
revoke execute on function public.wait_points_refund_session_tickets(bigint, jsonb)
	from public, anon, authenticated;

-- ------------------------------------------------------------
-- ④ wait_points_settle_not_held — 미진행 회차 정산 (N1~N4)
--   세 경로(종료·취소·삭제) 공용이며 재실행에 안전하다. 보드가 있으면(= 시작된 회차) 아무것도 하지 않는다 —
--   호출자가 이미 확인했더라도 여기서 다시 막는다. 시작된 회차에 이 정산이 돌면 경기한 확정자 전원이 +1 을 받는다.
-- ------------------------------------------------------------
create or replace function public.wait_points_settle_not_held(p_session_id bigint)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
	v_sched timestamptz;
	v_place text;
	v_ctx   jsonb;
	v_row   record;
begin
	if exists (select 1 from public.session_players sp where sp.session_id = p_session_id) then
		return;
	end if;

	-- 회차 라벨 스냅샷 — 하드 DELETE 뒤에도 내역에 날짜·장소가 남도록(wait_points_my_ledger 가 coalesce).
	select s.scheduled_at, p.name into v_sched, v_place
	from public.sessions s
	left join public.places p on p.id = s.place_id
	where s.id = p_session_id;
	v_ctx := jsonb_strip_nulls(jsonb_build_object(
		'reason', 'session_not_held', 'session_at', v_sched, 'place_name', v_place));

	-- (a) 티켓 환원 — 사전 취소분은 이미 환원돼 있고, 남은 것은 자리를 들고 있던 사람과 당일 취소 몰수분이다.
	perform public.wait_points_refund_session_tickets(p_session_id, v_ctx);

	-- (b) 당일 취소 감점 환원 — 실제로 깎인 양만큼. 노쇼 차감은 보드가 있어야 생기므로 여기엔 없다.
	for v_row in
		select l.id, l.member_id, l.delta
		from public.wait_point_ledger l
		where l.session_id = p_session_id
			and l.kind = 'penalty'
			and l.detail ->> 'reason' = 'day_cancel'
			and l.delta < 0
		order by l.member_id
	loop
		perform public.wait_points_credit(
			v_row.member_id, p_session_id, 'reversal', -v_row.delta,
			v_ctx || jsonb_build_object('penalty_id', v_row.id), null);
	end loop;

	-- (c) 신청을 유지한 회원 +1 — 확정·늦참·대기 모두. 게스트·비활성 제외(기존 적립과 같은 필터).
	for v_row in
		select a.member_id
		from public.attendances a
		join public.members m on m.id = a.member_id
		where a.session_id = p_session_id
			and a.status in ('confirmed', 'late_pool', 'waitlisted')
			and a.invited_by is null
			and not m.is_guest
			and m.is_active
		order by a.member_id
	loop
		perform public.wait_points_credit(v_row.member_id, p_session_id, 'earn', 1, v_ctx, null);
	end loop;
end;
$$;
revoke execute on function public.wait_points_settle_not_held(bigint) from public, anon, authenticated;

comment on function public.wait_points_settle_not_held(bigint) is
	'미진행 회차(보드 없음 = [경기 시작]을 누른 적 없음) 정산: 티켓 환원 · 당일취소 감점 환원(reversal) · 신청 유지 회원(confirmed/late_pool/waitlisted) +1. 종료·취소·삭제 세 훅 공용이며 재실행 안전. (20260928000000)';

-- ------------------------------------------------------------
-- ⑤ wait_points_settle_session — 보드 없음 분기를 미진행 정산으로, 적립을 wait_points_credit 으로. 나머지는 기준판 그대로.
-- ------------------------------------------------------------
create or replace function public.wait_points_settle_session(p_session_id bigint)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
	v_started boolean;
	v_sched   timestamptz;
	v_row     record;
begin
	-- 회차 게이트 = **보드가 만들어졌는가**(= 세션이 시작됐는가). 경기 기록 유무가 아니다.
	--   팀생성을 쓰지 않고 진행한 회차도 여기서 통과해야 대기자가 포인트를 받는다.
	--   보드가 없는 회차(sync A단계가 자동으로 닫은 미진행 회차)는 미진행 정산으로 넘긴다(20260928000000).
	select exists (select 1 from public.session_players sp where sp.session_id = p_session_id)
		into v_started;
	if not v_started then
		perform public.wait_points_settle_not_held(p_session_id);
		return;
	end if;

	select scheduled_at into v_sched from public.sessions where id = p_session_id;

	-- (a) 적립 — 대기인 채로 끝난 회원. order by member_id 로 잠금 순서 고정.
	--   7점 도달 알림은 wait_points_credit 이 '이번 적립으로 막 찼을 때'만 보낸다(F2). 회차별 +1 알림은 보내지 않는다.
	for v_row in
		select a.member_id
		from public.attendances a
		join public.members m on m.id = a.member_id
		where a.session_id = p_session_id
			and a.status = 'waitlisted'
			and a.invited_by is null
			and not m.is_guest
			and m.is_active
			-- 대기였는데 현장에서 보드에 직접 투입된 사람은 '못 나온 사람'이 아니다.
			-- 대기 행은 세션 시작 시 시드되지 않으므로, 이 방향에서 존재는 곧 현장 투입이다.
			-- **경기 출전 여부까지 내려가지 않는다**(20260905000000 헤더 — 재론 금지).
			and not exists (
				select 1 from public.session_players sp
				where sp.session_id = p_session_id and sp.member_id = a.member_id)
		order by a.member_id
	loop
		perform public.wait_points_credit(
			v_row.member_id, p_session_id, 'earn', 1,
			jsonb_build_object('reason', 'waitlisted_at_close', 'session_at', v_sched),
			p_session_id);
	end loop;

	-- (b) 노쇼 차감 — 확정인데 보드에 한 번도 오르지 않은 회원.
	--   start_session_from_schedule 이 확정자 전원을 시드하므로 부재는 '운영진이 보드에서 뺐다'는 뜻이고,
	--   실무에서 그것이 곧 '안 왔다'이다. 여기서도 경기 출전 여부는 보지 않는다.
	for v_row in
		select a.member_id
		from public.attendances a
		join public.members m on m.id = a.member_id
		where a.session_id = p_session_id
			and a.status = 'confirmed'
			and a.invited_by is null
			and not m.is_guest
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

comment on function public.wait_points_settle_session(bigint) is
	'회차 종료 시 대기 포인트 정산. 회차 게이트 = 보드(session_players) 존재 = 세션이 시작됐는가(20260905000000). 보드가 없으면 미진행 정산(wait_points_settle_not_held, 20260928000000)으로 넘긴다. 참여 판정도 보드 등록까지만 본다 — 경기 출전 여부로 내려가지 않는다.';

-- ------------------------------------------------------------
-- ⑥ 회차 취소 훅 — 시작 안 된 회차면 미진행 정산, 시작된 회차면 종전처럼 티켓 환원만.
--   트리거 배선(after update of status, when → 'cancelled')은 20260904000000 그대로라 다시 만들지 않는다.
-- ------------------------------------------------------------
create or replace function public.trg_session_wait_points_on_cancel()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
	begin
		if exists (select 1 from public.session_players sp where sp.session_id = new.id) then
			-- 시작된 뒤 취소된 회차(RPC 직접 호출로만 가능) — 진행은 됐으니 적립·감점 환원 없이 티켓만 돌려준다.
			perform public.wait_points_refund_session_tickets(
				new.id, jsonb_build_object('reason', 'session_cancelled'));
		else
			perform public.wait_points_settle_not_held(new.id);
		end if;
	exception when others then
		raise warning 'wait_points settle failed for cancelled session %: %', new.id, sqlerrm;
	end;
	return new;
end;
$$;
revoke execute on function public.trg_session_wait_points_on_cancel() from public, anon, authenticated;

-- ------------------------------------------------------------
-- ⑦ 회차 삭제 훅(신규) — 하드 DELETE 직전에 미진행 정산. (경로 ③)
--   CASCADE 는 부모 행이 지워진 뒤에 돈다 → BEFORE 시점에는 attendances·session_players 가 아직 있다.
--   시작된 회차(보드 있음)의 삭제는 정산 함수가 스스로 건너뛴다 — 이미 일어난 진행의 사실은 건드리지 않는다.
-- ------------------------------------------------------------
create or replace function public.trg_session_wait_points_on_delete()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
	begin
		perform public.wait_points_settle_not_held(old.id);
	exception when others then
		raise warning 'wait_points settle failed for deleted session %: %', old.id, sqlerrm;
	end;
	return old;   -- null 을 돌려주면 삭제가 취소된다.
end;
$$;
revoke execute on function public.trg_session_wait_points_on_delete() from public, anon, authenticated;

drop trigger if exists trg_session_wait_points_on_delete on public.sessions;
create trigger trg_session_wait_points_on_delete
	before delete on public.sessions
	for each row
	execute function public.trg_session_wait_points_on_delete();

-- ------------------------------------------------------------
-- ⑧ wait_points_my_ledger — 삭제된 회차의 날짜·장소를 원장 스냅샷에서. 반환 형태는 그대로.
--   원장은 append-only 라 과거 행(spend · penalty · 사전취소 refund — detail 에 reason 만 있다)을 고치지 않고,
--   회차 행이 사라졌을 때만 **같은 회차의 다른 행**(미진행 정산이 남긴 스냅샷)에서 라벨을 빌린다.
--   빌려 오는 것은 날짜·장소뿐이라 다른 회원의 행을 읽어도 드러나는 것이 없다.
--   그 회차에 스냅샷 행이 하나도 없으면(전원 사전취소 뒤 하드 DELETE) 종전처럼 비어 있다.
-- ------------------------------------------------------------
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
		coalesce(s.scheduled_at, (l.detail ->> 'session_at')::timestamptz,
			(snap.detail ->> 'session_at')::timestamptz) as session_at,
		coalesce(p.name, l.detail ->> 'place_name', snap.detail ->> 'place_name') as place_name
	from public.wait_point_ledger l
	left join public.sessions s on s.id = l.session_id
	left join public.places   p on p.id = s.place_id
	left join lateral (
		select l2.detail
		from public.wait_point_ledger l2
		where s.id is null
			and l2.session_id = l.session_id
			and (l2.detail ? 'session_at' or l2.detail ? 'place_name')
		order by l2.id
		limit 1
	) snap on true
	where l.member_id = public.current_member_id()
	order by l.created_at desc, l.id desc
	limit greatest(1, least(coalesce(p_limit, 60), 200));
$$;
revoke execute on function public.wait_points_my_ledger(int) from public, anon;
grant execute on function public.wait_points_my_ledger(int) to authenticated;
