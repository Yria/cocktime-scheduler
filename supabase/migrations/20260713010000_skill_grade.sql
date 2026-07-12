-- 실력 모델 전환: 6종 스킬(클리어/스매시/…의 O·V·X · 상/중/하) → 단일 등급(1~10).
-- 기존 members.skills / session_players.skills 를 등급으로 보정한다(요청: "현재 입력된 값은 보정해서 변경").
-- 매핑: present 6종 값 평균(O=3, V=2, X=1) → round(1 + (avg-1)/2 * 9), clamp 1..10.
--   전부 '하'→1, 전부 '중'→6, 전부 '상'→10. 값이 없거나 판독 불가면 기본 등급 5.
-- 과거 matches.player_snapshot 은 그대로 둔다(프론트 skillScoreOf 가 구 형태를 하위호환 환산).

create or replace function public._legacy_skill_grade(p jsonb)
returns int
language plpgsql
immutable
as $$
declare
	k     text;
	v     text;
	total numeric := 0;
	cnt   int := 0;
	avg_v numeric;
begin
	if p is null then
		return null;
	end if;
	-- 이미 신 모델({grade})이면 그대로 사용.
	if p ? 'grade' then
		return nullif(p->>'grade', '')::int;
	end if;
	-- 구 6종: O/상=3, V/중=2, X/하=1 로 평균.
	for k in select jsonb_object_keys(p) loop
		v := upper(btrim(coalesce(p->>k, '')));
		if v in ('O', '상') then total := total + 3; cnt := cnt + 1;
		elsif v in ('V', '중') then total := total + 2; cnt := cnt + 1;
		elsif v in ('X', '하') then total := total + 1; cnt := cnt + 1;
		end if;
	end loop;
	if cnt = 0 then
		return null;
	end if;
	avg_v := total / cnt;  -- 1..3
	return greatest(1, least(10, round(1 + (avg_v - 1) / 2 * 9)))::int;
end;
$$;

-- 회원 원본
update public.members
set skills = jsonb_build_object('grade', coalesce(public._legacy_skill_grade(skills), 5)),
    updated_at = now()
where skills is null or not (skills ? 'grade');

-- 진행 중 세션 스냅샷(있다면)
update public.session_players
set skills = jsonb_build_object('grade', coalesce(public._legacy_skill_grade(skills), 5))
where skills is null or not (skills ? 'grade');

drop function public._legacy_skill_grade(jsonb);
