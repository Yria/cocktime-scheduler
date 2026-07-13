-- 회계 Migration 13: 선택 미납 알림 — 관리자가 현황판에서 특정 그룹(회비/세션별 대관비)의
-- 미납 회원만 골라 발송. dues_notify_unpaid(회비 전체·ym 중복방지)와 달리, 대상 회원 배열을 받아
-- 커스텀 문구(payload.msg)로 발송한다. 중복방지 없음(관리자가 명시적으로 재발송할 수 있어야 함).
--   "특정 미납만 알릴 수 있게 선택 / 세션별·회비별 발송버튼"(2026-07-13 확정).

create or replace function public.dues_notify_selected(p_member_ids uuid[], p_msg text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
	v_admin uuid := public.current_member_id();
	v_n     int := 0;
begin
	if not public.is_admin() then raise exception 'forbidden'; end if;
	if p_member_ids is null or array_length(p_member_ids, 1) is null then
		return jsonb_build_object('notified', 0);
	end if;
	if coalesce(p_msg, '') = '' then raise exception 'message required'; end if;

	-- 푸시 수신 가능(로그인) 회원만. 게스트/미로그인은 auth_user_id 없어 제외 → 대납자에게 안내.
	insert into public.notifications (recipient_member_id, type, session_id, payload)
	select m.id, 'dues_unpaid', null, jsonb_build_object('msg', p_msg)
	from public.members m
	where m.id = any(p_member_ids) and m.auth_user_id is not null;
	get diagnostics v_n = row_count;

	insert into public.dues_audit_log (actor_member_id, action, detail)
	values (v_admin, 'notify_selected', jsonb_build_object('requested', array_length(p_member_ids, 1), 'notified', v_n, 'msg', p_msg));
	return jsonb_build_object('notified', v_n);
end $$;

revoke execute on function public.dues_notify_selected(uuid[], text) from public;
grant execute on function public.dues_notify_selected(uuid[], text) to authenticated;
