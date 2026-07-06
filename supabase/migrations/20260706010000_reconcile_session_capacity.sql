-- 정원 변경 + 참석/대기 재조정을 한 RPC(한 트랜잭션)로 원자 처리 — set_session_capacity.
--
-- 배경: 기존엔 정원(sessions.capacity)만 UPDATE 하고 이미 신청한 attendances 는 손대지 않아,
--   정원을 줄여도 초과 참석자가 그대로 confirmed 로 남고(확정 24/18명), 늘려도 대기자가 자동
--   승격되지 않았다. EXPANSION_SPEC §2-8("정원 상향 시 자동 승급")의 promote_waitlist 는
--   어디에도 배선되지 않은 죽은 코드였다.
--
-- 원자성: 정원 UPDATE 와 재조정을 클라에서 두 번(PATCH + RPC) 나눠 호출하면, 정원만 커밋되고
--   재조정이 실패(락 타임아웃/네트워크)할 때 초과 상태가 조용히 남는다. 그래서 정원 쓰기 자체를
--   이 RPC 안으로 넣어 "정원 변경 AND 재조정/알림"을 all-or-nothing 으로 만든다.
--
-- 규칙:
--   · 정원↑ 또는 무제한(NULL) → 대기자를 position 오름차순(먼저 신청한 순)으로 여유만큼 confirmed 승격.
--   · 정원↓ 로 confirmed_count > capacity → 최근 신청 confirmed(position 내림차순)를 초과분만큼 waitlisted 강등.
--     - 강등 시 position 은 보존 → 이후 정원 재상향 시 원래 순번대로 다시 승격(공정성).
--   · 각 대상에게 알림 INSERT(승격='promoted', 강등='demoted') → 웹푸시 트리거로 이어짐.
--     알림 대상은 coalesce(invited_by, member_id) — 게스트는 계정이 없어 데려온 회원에게 발송.
--     게스트면 payload 에 guest_name 을 실어, 알림 문구가 "내가 대기로 갔다"가 아니라
--     "내 게스트가 대기로 갔다"로 렌더되게 한다(수신자=초대 회원, 대상=게스트 구분).
--
-- 동시성: join_session/cancel_attendance 와 동일한 잠금 순서(sessions → session_counters →
--   attendances). 정원 판정은 count(*) 금지, confirmed_count 가 권위. 승격/강등+알림은 한
--   트랜잭션 → 롤백 시 알림 미발생(불일치 차단). open 세션에만 재조정(draft 는 참석 없음,
--   closed/cancelled/active 는 참석 변경 없음) — 그 외 status 는 정원만 갱신하고 {0,0} 반환.

create or replace function public.set_session_capacity(
	p_session_id bigint, p_capacity int
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
	v_status   text;
	v_count    int;
	v_att      public.attendances%rowtype;
	v_promoted int := 0;
	v_demoted  int := 0;
begin
	if not public.is_admin() then raise exception 'forbidden'; end if;

	-- 정원 변경(sessions 행 배타락). 이후 session_counters → attendances 순으로 잠금 — 기존 규칙 동일.
	update public.sessions set capacity = p_capacity
	where id = p_session_id
	returning status into v_status;
	if not found then raise exception 'session not found'; end if;

	-- open 세션에만 재조정(그 외엔 참석 변경 없음 — 정원만 바뀜).
	if v_status <> 'open' then
		return jsonb_build_object('promoted', 0, 'demoted', 0);
	end if;

	insert into public.session_counters(session_id) values (p_session_id)
		on conflict (session_id) do nothing;
	select confirmed_count into v_count
	from public.session_counters where session_id = p_session_id for update;

	-- ① 강등: 정원 초과분만큼 최근 신청 confirmed(position DESC)를 대기로.
	if p_capacity is not null then
		loop
			exit when v_count <= p_capacity;
			select * into v_att from public.attendances
			where session_id = p_session_id and status = 'confirmed'
			order by position desc
			for update skip locked
			limit 1;
			exit when not found;

			update public.attendances
			set status = 'waitlisted', confirmed_at = null, updated_at = now()
			where session_id = v_att.session_id and member_id = v_att.member_id;
			v_count := v_count - 1;
			v_demoted := v_demoted + 1;
			insert into public.notifications(recipient_member_id, type, session_id, payload)
			values (
				coalesce(v_att.invited_by, v_att.member_id), 'demoted', p_session_id,
				jsonb_build_object('session_id', p_session_id)
					|| case when v_att.invited_by is not null then jsonb_build_object(
						'guest_name', (select name from public.members where id = v_att.member_id))
						else '{}'::jsonb end
			);
		end loop;
	end if;

	-- ② 승격: 여유만큼 대기자(position ASC)를 참석으로. capacity NULL=무제한이면 전부.
	loop
		exit when p_capacity is not null and v_count >= p_capacity;
		select * into v_att from public.attendances
		where session_id = p_session_id and status = 'waitlisted'
		order by position asc
		for update skip locked
		limit 1;
		exit when not found;

		update public.attendances
		set status = 'confirmed', confirmed_at = now(), updated_at = now()
		where session_id = v_att.session_id and member_id = v_att.member_id;
		v_count := v_count + 1;
		v_promoted := v_promoted + 1;
		insert into public.notifications(recipient_member_id, type, session_id, payload)
		values (
			coalesce(v_att.invited_by, v_att.member_id), 'promoted', p_session_id,
			jsonb_build_object('session_id', p_session_id)
				|| case when v_att.invited_by is not null then jsonb_build_object(
					'guest_name', (select name from public.members where id = v_att.member_id))
					else '{}'::jsonb end
		);
	end loop;

	update public.session_counters set confirmed_count = v_count where session_id = p_session_id;
	return jsonb_build_object('promoted', v_promoted, 'demoted', v_demoted);
end;
$$;

revoke execute on function public.set_session_capacity(bigint, int) from anon;
grant execute on function public.set_session_capacity(bigint, int) to authenticated;
