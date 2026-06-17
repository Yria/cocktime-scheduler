# 프로젝트 로컬 규칙

## 팀 추천/편성 알고리즘 변경 시

`src/lib/teamSelection/`(rankCandidates · recommendTeammates/autoFillTeammates · pairPlayers)와 보드 추천 입력 빌더 `src/lib/board/recommendPool.ts`의 알고리즘 로직을 변경할 때는 반드시 `docs/TEAM_GENERATION_RULES.md`도 함께 업데이트한다.

- 규칙 추가/삭제/변경 → 해당 규칙 섹션 수정
- 함수 시그니처(파라미터) 변경 → 관련 섹션(rankCandidates · recommendTeammates · autoFillTeammates · pairPlayers 등) 반영
- 가중치/점수 공식 변경 → "후보 점수"·"페어 편성"·"추천 가중치" 섹션 업데이트
