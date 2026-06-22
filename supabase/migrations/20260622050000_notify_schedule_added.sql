-- 일정 추가 시 전 회원 알림: 운영진이 반복 규칙 또는 일회성 회차를 추가하면
-- 로그인 회원 전원(추가한 본인 제외)에게 'schedule_added' 알림을 INSERT 한다.
-- notifications 는 realtime publication 등록돼 있어 접속 중 회원에게 즉시 토스트.

create or replace function public.notify_members_schedule_added(
	p_session_id bigint, -- 일회성이면 회차 id, 반복 규칙이면 NULL
	p_label text         -- 표시용 요약(예: "매주 수 19:00 · 행복체육관")
)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
	v_count int;
begin
	if not public.is_admin() then
		raise exception 'forbidden';
	end if;

	insert into public.notifications (recipient_member_id, type, session_id, payload)
	select
		m.id,
		'schedule_added',
		p_session_id,
		jsonb_build_object('label', p_label)
	from public.members m
	where m.auth_user_id is not null -- 로그인 가능한 회원에게만
		and m.id is distinct from public.current_member_id(); -- 추가한 본인 제외

	get diagnostics v_count = row_count;
	return v_count;
end;
$$;

revoke execute on function public.notify_members_schedule_added(bigint, text) from anon;
grant execute on function public.notify_members_schedule_added(bigint, text) to authenticated;
