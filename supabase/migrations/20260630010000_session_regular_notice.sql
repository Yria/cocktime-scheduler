-- 정모(정기모임) 회차 + 회원 열람용 안내/대진표 페이지
--
-- 일정 생성/편집(OccurrenceEditor)에서 회차별로 '정모' 토글을 켜면, 그 회차에
-- 운영진이 직접 작성한 안내 페이지(마크다운)를 붙여 회원이 열람할 수 있다.
--   - is_regular : 이 회차가 정모인가 (홈 카드에 배지 + '대진표 보기' 진입 노출)
--   - notice_md  : 회원에게 보여줄 본문(마크다운, GFM 표 지원). 매번 수동 작성.
--
-- sessions RLS 는 아직 authenticated 광역(Phase 9 미착수)이라 클라이언트 직접 쓰기로 처리.
-- (OccurrenceEditor → updateOccurrence / createOneOffOccurrence 가 이 컬럼들을 직접 write)

alter table public.sessions
	add column if not exists is_regular boolean not null default false,
	add column if not exists notice_md  text;

-- 홈 일정 목록(open/active)에서 정모만 빠르게 추리기 위한 부분 인덱스
create index if not exists idx_sessions_is_regular
	on public.sessions(is_regular)
	where is_regular = true;
