-- 전환기 일회성 오픈: 2026-07-10(금)~07-12(일) 회차를 미리 open.
--
-- 배경: 옛 rolling(+7d) 규칙으로 "다음주 일정 1주 전 배포"가 이미 회원들에게 관례화된 상태
-- (월~목 회차는 이미 open·참석 진행 중). 새 규칙(일요일 18:00 일괄 공개, 20260703010000)을
-- 그대로 두면 금(7/10)·토(7/11) 회차가 옛 규칙 기대 시점(각각 7/3·7/4)보다 늦은
-- 7/5 18:00 에야 열린다. → 금토일 3회차를 지금 한 번에 열어 옛 규칙 배포 상태와 이어붙이고,
-- 새 규칙은 다음 일요일(7/12) 18:00 부터 자연스럽게 첫 작동한다(7/13~7/19 일괄 공개).
-- 7/5 18:00 cron 실행은 열 것이 없어 no-op.
--
-- sync E단계와 동일한 로직(open 전환 + 'session_open' 알림, 멱등 가드)을 고정 날짜로 1회 실행.
-- 재적용(신규 환경 db reset 등) 시엔 날짜가 과거라 no-op — 안전.

with opened as (
	update public.sessions
		set status = 'open'
	where status = 'draft'
		and scheduled_at is not null
		and (scheduled_at at time zone 'Asia/Seoul')::date
			between date '2026-07-03' and date '2026-07-12'
	returning id
)
insert into public.notifications (recipient_member_id, type, session_id, payload)
select m.id, 'session_open', o.id, '{}'::jsonb
from opened o
cross join public.members m
where m.auth_user_id is not null            -- 로그인 가능한 회원만
	and not exists (                        -- 멱등 가드(동일 세션 중복 방지)
		select 1 from public.notifications n
		where n.session_id = o.id
			and n.type = 'session_open'
			and n.recipient_member_id = m.id
	);
