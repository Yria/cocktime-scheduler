-- ============================================================
-- 알림 정리: 본인 삭제 허용(RLS) + 자동 트림(회원당 최근 10개 + 30일 이내만 유지)
-- ============================================================

-- 본인 알림만 삭제 허용 (개별 X 삭제 / 모두 지우기)
create policy notifications_self_delete on public.notifications
	for delete to authenticated
	using (recipient_member_id = public.current_member_id());

-- 새 알림 INSERT 시 해당 회원의 오래된/초과 알림을 자동 정리한다.
-- DELETE는 INSERT 트리거를 타지 않으므로 재귀 없음.
create or replace function public.trim_notifications()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
	-- 30일 지난 알림 삭제(해당 회원)
	delete from public.notifications
	where recipient_member_id = new.recipient_member_id
		and created_at < now() - interval '30 days';

	-- 최근 10개 초과분 삭제(방금 INSERT된 new 포함 최신 10개 유지)
	delete from public.notifications
	where recipient_member_id = new.recipient_member_id
		and id not in (
			select id from public.notifications
			where recipient_member_id = new.recipient_member_id
			order by created_at desc
			limit 10
		);
	return new;
end;
$$;

drop trigger if exists trg_trim_notifications on public.notifications;
create trigger trg_trim_notifications
	after insert on public.notifications
	for each row execute function public.trim_notifications();
