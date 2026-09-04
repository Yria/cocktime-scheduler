# 프로젝트 로컬 규칙

## 팀 추천/편성 알고리즘 변경 시

`src/lib/teamSelection/`(rankCandidates · recommendTeammates/autoFillTeammates · pairPlayers)와 보드 추천 입력 빌더 `src/lib/board/recommendPool.ts`의 알고리즘 로직을 변경할 때는 반드시 `docs/TEAM_GENERATION_RULES.md`도 함께 업데이트한다.

- 규칙 추가/삭제/변경 → 해당 규칙 섹션 수정
- 함수 시그니처(파라미터) 변경 → 관련 섹션(rankCandidates · recommendTeammates · autoFillTeammates · pairPlayers 등) 반영
- 가중치/점수 공식 변경 → "후보 점수"·"페어 편성"·"추천 가중치" 섹션 업데이트

## 대기 포인트 / 우선참여권 변경 시

서버 규칙(`supabase/migrations/…_wait_points_ticket.sql` 계열의 `join_session` 티켓 분기 ·
`wait_points_*` · `wait_ticket_*` · 종료/취소 트리거)을 바꾸면 **같은 커밋에서** 아래를 함께 고친다.

- `src/lib/schedule/waitStatus.ts` — 상수 미러(`POINT_MAX` · `TICKET_COST` · `TICKET_SESSION_CAP`)와
  `splitConfirmedByCapacity`(정원 외 사유 분류). 서버와 어긋나면 화면이 인원을 거짓 표기한다.
- `docs/EXPANSION_SPEC.md` §3(상태값 레지스트리) · §5.1(프리패스 규칙)
- `docs/SCHEDULE_LIST_PARTICIPANTS_SPEC.md` §2.5(회원이 보는 규칙)
- 부과에 영향이 가면 `docs/ACCOUNTING_SPEC.md` §13
- 알림 타입을 늘리면 `src/lib/supabase/notifications.ts` + `supabase/functions/send-push/index.ts`
  **양쪽**(Edge Function 은 `supabase functions deploy send-push` 를 따로 해야 반영된다)
