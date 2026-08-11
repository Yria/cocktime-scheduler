-- 정모 식사(회식) 참여 체크: 정모 회차에서 참석자가 "식사 참여 / 안 먹음" 을 표시한다.
-- carpool_role(20260621020000) · late_minutes(20260706030000) 와 같은 층 —
-- attendances 에 개인 선택 컬럼 1개 + 설정 RPC 1개. 노출 게이트만 세션 단위로 둔다.
--
--   · sessions.meal_enabled : carpool_enabled 미러. 정모라도 회식 없는 회차가 있으므로
--     is_regular 만으로 자동 노출하지 않고 회차별 토글로 받는다(운영진 편집기).
--     is_regular(20260630010000) 처럼 recurring_schedules 에 미러 컬럼을 두지 않는다 →
--     sync_schedule_occurrences 의 회차 UPDATE 목록에 없으므로 규칙 sync 가 값을 덮지 않는다.
--     (규칙 쪽에 컬럼을 만들면 뷰 recurring_valid_occurrences + sync 함수까지 재정의해야 하고,
--      그 함수는 search_path 위반 시 sync 전체가 롤백되는 사고 이력이 있다 — 20260726090000)
--
--   · attendances.meal_joining : 기본값 true(참여). "회식은 기본 참여, 안 먹는 사람만 해제"
--     운영 모델이라 미응답과 참여를 구분하지 않는다(집계는 '참여 N명' 단일 숫자).
--
-- sessions.meal_enabled 쓰기는 기존 is_regular 와 같은 경로(클라이언트 직접 update,
-- RLS sessions_admin_write 로 운영진 한정)라 RPC 를 만들지 않는다.
-- attendances 는 UPDATE 정책이 없으므로(20260621020000: SELECT 정책 단독) 쓰기는 RPC 필수.
-- 재적용 안전(idempotent): add column if not exists / create or replace.

-- ① 세션 단위 노출 게이트 (정모 && meal_enabled 일 때만 식사 체크를 받는다)
alter table public.sessions
	add column if not exists meal_enabled boolean not null default false;

-- ② 참석자 단위 선택 — 기본 참여
alter table public.attendances
	add column if not exists meal_joining boolean not null default true;

-- ③ 식사 참여 설정 — 본인 행, 또는 내가 데려온 게스트 행.
--    게스트는 로그인 계정이 없어 current_member_id() 가 그 행을 가리킬 수 없다 → 초대 회원이 대신 고른다
--    (소유권 기준은 cancel_guest_attendance 와 동일: attendances.invited_by = 나).
--    set_carpool_role(20260621070000) 미러링 + set_late_minutes 처럼 세션 행을 읽어 게이팅.
--    카운터(session_counters)·승격(promote_*)·알림은 건드리지 않는다 — 상태(status)를 바꾸지 않으므로
--    정원/대기와 무관하고, 카운터를 잡지 않는 것이 set_carpool_role 과 같은 무교착 전제다(20260806010000:26).
create or replace function public.set_meal_joining(
	p_session_id bigint,
	p_joining boolean,
	p_member_id uuid default null
)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
	v_actor   uuid := public.current_member_id();
	v_target  uuid := coalesce(p_member_id, public.current_member_id());
	v_regular boolean;
	v_meal    boolean;
	v_status  text;
	v_invited uuid;
begin
	if v_actor is null then raise exception 'not authenticated'; end if;
	if p_joining is null then raise exception 'invalid choice'; end if;

	select is_regular, meal_enabled, status
	into v_regular, v_meal, v_status
	from public.sessions where id = p_session_id;
	if not found then raise exception 'session not found'; end if;
	if not (v_regular and v_meal) then raise exception 'meal check not enabled'; end if;
	if v_status in ('closed', 'cancelled') then raise exception 'session ended'; end if;

	-- 남의 행이면 "내가 데려온 게스트" 만 허용
	if v_target is distinct from v_actor then
		select invited_by into v_invited from public.attendances
		where session_id = p_session_id and member_id = v_target;
		if not found then raise exception 'attendance not found'; end if;
		if v_invited is distinct from v_actor then raise exception 'not your guest'; end if;
	end if;

	update public.attendances
	set meal_joining = p_joining, updated_at = now()
	where session_id = p_session_id and member_id = v_target and status <> 'cancelled';
	if not found then raise exception 'not attending'; end if;
end;
$$;

revoke execute on function public.set_meal_joining(bigint, boolean, uuid) from anon;
grant execute on function public.set_meal_joining(bigint, boolean, uuid) to authenticated;

-- ④ 취소 시 식사 의향을 기본값(참여)으로 되돌린다 — 취소했다가 다시 참석할 때 옛 '안 먹음' 이
--    조용히 부활하는 것 방지. carpool_role·late_minutes 가 같은 이유로 리셋된다(20260623010000).
--    다만 취소 경로는 cancel_attendance / admin_cancel_attendance / cancel_guest_attendance 3개로
--    갈라져 UPDATE 술어가 복제돼 있다(20260806010000:445, 491, 546 — 그 중 게스트 경로엔 이미
--    late_minutes 리셋이 빠져 있다). 함수마다 한 줄씩 넣으면 한 곳을 빠뜨리는 비대칭 버그가
--    반복되므로, 세 경로가 반드시 지나가는 BEFORE UPDATE 트리거 하나로 덮는다.
--    감사 트리거(trg_att_audit_upd)는 status/position/확정·취소시각만 보므로 영향 없다.
create or replace function public.trg_att_reset_meal() returns trigger
language plpgsql set search_path = ''
as $$
begin
	new.meal_joining := true;
	return new;
end;
$$;

drop trigger if exists trg_att_reset_meal on public.attendances;
create trigger trg_att_reset_meal before update on public.attendances
	for each row
	when (new.status = 'cancelled' and old.status is distinct from 'cancelled')
	execute function public.trg_att_reset_meal();
