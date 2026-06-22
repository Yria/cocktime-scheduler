-- 운영진 실력 편집: 보드(세션) 자석 롱프레스 화면에서 선수 실력 수정.
--   session_players.skills(현재 세션 즉시 반영) + 연결된 members.skills(영구 원본) 동시 갱신.
--   회원이 아닌 게스트/시트선수(member_id NULL)면 session_players 만 갱신.
-- 운영진(is_admin)만. SECURITY DEFINER 로 members RLS 와 무관하게 일관 처리.

create or replace function public.update_player_skill(
	p_session_player_id uuid,
	p_skills jsonb
)
returns public.session_players
language plpgsql
security definer
set search_path = ''
as $$
declare
	v_row public.session_players;
begin
	if not public.is_admin() then
		raise exception 'forbidden';
	end if;

	update public.session_players
		set skills = p_skills
		where id = p_session_player_id
		returning * into v_row;
	if not found then
		raise exception 'session player not found';
	end if;

	-- 회원이면 영구 원본(members.skills)도 갱신
	if v_row.member_id is not null then
		update public.members
			set skills = p_skills, updated_at = now()
			where id = v_row.member_id;
	end if;

	return v_row;
end;
$$;

revoke execute on function public.update_player_skill(uuid, jsonb) from anon;
grant execute on function public.update_player_skill(uuid, jsonb) to authenticated;
