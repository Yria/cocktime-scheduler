# 경기 결과 입력 · ELO 등급 · 내 정보 통합 — 설계/계약 (2026-11-09)

> 상태: v1 구현 범위. ELO는 **표시용**(뱃지 테두리 모양)만. 팀 밸런싱 반영(1~10 실력 데이터화)은 2단계.
> 2단계에서 `src/lib/teamSelection`·`recommendPool.ts` 를 건드리면 `docs/TEAM_GENERATION_RULES.md` 동반 수정.

## 0. 확정된 결정 (사용자, 2026-11-09)

| 항목 | 결정 |
|---|---|
| 회원 완료 버튼 위치 | **보드 코트 카드**. 보드를 보는 회원이 *자기가 뛰는* 코트에서만 [경기완료] 활성 |
| 회원 완료 후 동작 | 그 코트 그룹에 **대기 중인 준비된 예비팀**을 올리고, 없으면 **새 그룹을 자동 편성**해 올린다. **경기 시작은 하지 않는다**(운영진이 누름) |
| 운영진 완료 | 기존 동작 그대로(`complete_match` → 고스트 해소 → 합류대기 채우기 → 흩기). 추가 자동 동작 없음. 승패 화면은 똑같이 뜬다 |
| 승패 입력자 | 완료를 누른 사람. [건너뛰기] 가능. 건너뛴 경기는 그 경기 4명 누구나 7일 안에 '내 승패 기록'에서 보충. **첫 입력이 확정**, 운영진만 정정 |
| 점수 구분 | **하나로 통합**. `혼합`(성비 불균형) 경기는 기록만 하고 점수 미반영 |
| 대기 포인트 | 이번 범위에서 손대지 않음(폐지 결정 없음). 통합 화면의 '정보' 탭에 그대로 둔다 |
| **실제 편 입력** (2026-11-10) | "우리는 그룹을 뽑지, 팀을 뽑는 게 아니다." 보드는 4명 **그룹**만 정하고 코트의 편은 선수들이 정한다. 결과를 넣을 때(보드 완료 창 편집자·회원, '내 승패 기록' 보충, 운영진 정정) **실제 편을 먼저 고르고** 승자를 고른다. ELO·내 기록은 실제 편을 쓴다. 보드 로스터(`matches.team_*`)는 바꾸지 않는다. 마이그레이션 `20261110000000_match_result_team_override.sql` |

## 1. ELO 규칙 (서버가 권위, 클라 `src/lib/rating/elo.ts` 는 미러)

- 시작 점수: `seed = 1000 + 100 × grade` (grade = `members.skills->>'grade'`, 1~10). grade 없음/0 → **1500**.
  `member_ratings` 행은 첫 반영 때 lazily 생성.
- 팀 전력: `R_team = 0.6 × min(r1,r2) + 0.4 × max(r1,r2)` (복식은 약한 쪽이 집중 공략당한다).
- 기대 승률: `E_A = 1 / (1 + 10^((R_B − R_A)/400))`.
- 개인 K: 반영된 경기 수 `< 10` → **40**(배치), 아니면 **20**.
- 변동: `Δ_i = round(K_i × (S − E_team))`, S=1 승 / 0 패. 같은 팀 두 명은 같은 E, 각자 K.
- **미반영(unrated)**: `game_type = '혼합'`, 4명 중 `session_players.member_id` 가 NULL 인 사람이 있음, 4명이 다 안 채워짐.
  결과 행은 남기되 `rated = false`.
- 반영 순서: 입력(제출) 순서대로 증분 반영. **운영진 정정** 시에는 `ratings_recompute_all()` 로
  전 결과를 `matches.ended_at` 순으로 재생해 `member_ratings`/`rating_events` 를 다시 만든다.
- 상수는 SQL 함수 `public.elo_seed(grade)`, `elo_k(games)`, 0.6/0.4, 400 에 있고 TS 미러에도 같은 값. 미러 일치 테스트 필수.

### 등급(표시)

| 점수 | 등급 키 | 표시명 |
|---|---|---|
| < 1300 | `bronze` | 브론즈 |
| 1300–1499 | `silver` | 실버 |
| 1500–1699 | `gold` | 골드 |
| 1700–1899 | `platinum` | 플래티넘 |
| 1900–2099 | `diamond` | 다이아 |
| ≥ 2100 | `master` | 마스터 |

반영 경기 `< 5` 이면 `placement`(배치 중) 플래그 — 등급 테두리는 흐리게 + "배치 n/5" 문구.

## 2. DB 계약 — 마이그레이션 `supabase/migrations/20261109000000_match_results_elo.sql` (+ `20261110000000_match_result_team_override.sql`)

> **실제 편(2026-11-10, `20261110000000`)**: 결과 RPC 들은 `p_team_a uuid[]`(실제 A편을 이룬 `session_players.id` 2개, NULL = 보드 나눔)를 받는다.
> 2명·서로 다름·둘 다 그 경기 로스터 4명 안이 아니면 `22023 'invalid teams'`. `winner` 'A'/'B' 는 **이 실제 A편** 기준(B편 = 나머지 둘).
> 각 편 안의 순서는 로스터 순서로 정규화(`_match_split`). 로스터의 NULL 칸(선수 행 삭제 → FK SET NULL)은 `player_snapshot` 같은 자리 id 로 메운다(`_match_roster`). 운영진 정정은 a1..b2 를 다시 찾지 않고 기록 때 박제한 멤버를 자리만 옮긴다(지워진 선수 칸이 NULL 이 되어 재생에서 빠지지 않게). `match_results.teams jsonb` = 실제 편 sp id `[a1,a2,b1,b2]`(NULL = 이전 행, 보드 나눔으로 읽음),
> `a1..b2`(members.id) 는 실제 편 — `_rating_apply`·`ratings_recompute_all`·RLS 는 이 열만 읽으므로 그대로 맞다.
> 아래 1~3·6 의 시그니처는 이 판으로 대체됐다(옛 오버로드 DROP).

모든 함수 `security definer set search_path = ''`, 객체는 `public.` 한정(일정 sync 사고 교훈).
`revoke … from public, anon` 후 필요한 것만 `grant … to authenticated`.

### 테이블
- `match_results(match_id uuid pk → matches(id) on delete cascade, session_id bigint, game_type text,
  a1 uuid, a2 uuid, b1 uuid, b2 uuid  -- members.id (NULL 가능, 영속 신원),
  winner text not null check (winner in ('A','B')), rated boolean not null,
  recorded_by uuid  -- members.id, recorded_at timestamptz default now(),
  corrected_by uuid, corrected_at timestamptz)`
- `member_ratings(member_id uuid pk → members(id) on delete cascade, rating integer not null,
  games integer not null default 0, wins integer not null default 0, losses integer not null default 0,
  updated_at timestamptz)`
- `rating_events(id bigserial pk, match_id uuid → matches on delete cascade, member_id uuid, before integer,
  after integer, delta integer, expected numeric, won boolean, created_at timestamptz default now(),
  unique(match_id, member_id))`
- `match_completion_grants(match_id uuid pk, session_id bigint, court_id int, member_id uuid,
  created_at timestamptz default now(), used_at timestamptz)` — 회원 완료 후 보드 편성 1회 권한.
- RLS: 전부 enable. 직접 쓰기 정책 없음(RPC 전용). select: `match_results` 는 4명 본인·운영진,
  `member_ratings`/`rating_events` 는 본인·운영진. grants 는 select 정책 없음.

### 함수 (이름·시그니처 고정)
1. `member_complete_match(p_match_id uuid, p_session_id bigint, p_winner text default null, p_team_a uuid[] default null) returns jsonb`
   - `sessions FOR UPDATE` 먼저(잠금 순서 sessions → matches). 세션 `is_active and status='active'`.
   - 호출자 `current_member_id()` 가 그 경기 로스터 4명의 `session_players.member_id` 중 하나여야 함, 아니면 `42501 'not in match'`.
   - `complete_match` 의 1·3·4 단계와 **동일한** 갱신(스냅샷·waiting 복귀·game_count/mixed_count·match_state_version++).
     공통부를 `_complete_match_apply(p_match_id, p_session_id, p_game_type)` 내부 함수로 빼서 `complete_match` 도 그걸 쓰게 해도 됨(그렇다면 complete_match 의 가드·반환 동작 불변).
     이미 완료면 `'Match already completed or not found'` 그대로.
   - `match_completion_grants` 행 생성(court_id 포함).
   - `p_winner` 가 'A'/'B' 면 `_match_result_record(..., p_team_a)` 호출(p_winner NULL 이면 p_team_a 무시). 편 검증 실패는 완료까지 함께 롤백.
   - 반환: `{"players":[session_players rows…], "result": <result json|null>, "courtId": n}`.
2. `match_result_submit(p_match_id uuid, p_winner text, p_team_a uuid[] default null) returns jsonb`
   - 경기 `status='completed'`, `ended_at > now() - interval '7 days'`. 호출자 = 로스터 4명 중 한 명 **또는** `is_admin()`.
   - 이미 결과 있으면 변경 없이(편도 그대로) 기존 결과 반환(`"status":"exists"`). 아니면 실제 편으로 기록 + 반영(`"status":"recorded"`).
     편 검증은 exists 판정보다 먼저.
3. `match_result_admin_set(p_match_id uuid, p_winner text, p_team_a uuid[] default null) returns jsonb` — 운영진 전용. `p_winner` NULL = 결과 삭제.
   편도 고칠 수 있다. 결과가 있으면 `p_team_a` NULL = **기록된 편 그대로**(승자만 고치는 정정이 편을 보드 나눔으로 되돌리지 않게), 없으면 보드 나눔.
   '이긴 두 사람·진 두 사람' 이 같으면 A/B 표기만 달라도 `unchanged`. 바뀌면 `a1..b2`·`teams`·`winner` 갱신 후 `ratings_recompute_all()`.
4. `ratings_recompute_all() returns void` — 내부용(실행권한 회수). 전부 재생.
5. `rating_my_summary() returns jsonb` — `{rating, games, wins, losses, seeded: bool}`; 행이 없으면 seed 값으로 계산해 반환(`games=0`).
6. `match_my_history(p_limit int default 30, p_before timestamptz default null) returns jsonb` —
   내가 뛴 완료 경기(내 member_id 가 로스터 session_players.member_id 에 있는 것) 최신순.
   항목: `{matchId, sessionId, endedAt, gameType, courtId, mySide:'A'|'B', teamA:[{spId,memberId,name,gender}], teamB:[…],
   winner:'A'|'B'|null, rated, delta:int|null, ratingAfter:int|null, canSubmit:bool}`
   (`canSubmit` = 결과 없음 ∧ 7일 이내). `teamA/teamB/mySide` 는 **실제 편**(결과의 `teams`, 없으면 로스터). `spId` = session_players.id(보충 때 실제 편을 다시 보냄).
   이름은 그 회차 session_players, 행이 지워졌으면 `player_snapshot` 의 같은 id 원소로 폴백.
7. `member_commit_completion_drafts(p_session_id bigint, p_match_id uuid, p_base_version bigint, p_payloads jsonb) returns jsonb`
   - `p_payloads` = 후보 payload **배열(1~6개, 우선순위 순)**. 배열이 아니거나 개수 밖이거나, 원소 하나라도 object·`teams`/`reservations` 배열이
     아니면 `22023 'invalid payload'`. 편집락(`editor_client_id`)은 건드리지 않음.
   - 호출자 = 그 match 의 grant 소유자, grant `used_at is null`, `created_at > now() - interval '3 minutes'`.
   - `board_drafts_version = p_base_version` 아니면 `{"status":"stale","version":현재}` (grant 미소모, 다른 검사보다 먼저).
   - **얹기 전용 가드**(버전 일치 뒤, 후보마다): grant 는 is_admin·편집락 없이 보드 전체를 쓰므로, 지금 `board_drafts` 에 올라 있는
     사람을 내리는 후보는 **건너뛴다**(저장 안 함, 다음 후보). ① 현재 anchor(`memberIds`) 선수는
     후보 어느 팀에든 anchor 로 남아야 하고 ② 현재 예약은 같은 id 로 남거나 그 선수가 anchor 가 돼야 한다(예약 승격).
     팀 id·소속 이동·좌표는 정당한 편성에서도 바뀌므로 막지 않는다 — 즉 '그 코트 그룹만' 은 서버가 강제하지 않는다(재배치는 가능, 삭제는 불가).
     전체 거부가 아닌 이유: 정직한 편성도 걸릴 수 있다(자동 편성의 유연 풀이 2인 합류 대기팀에서 한 명을 빼 오면 남은 한 명이 해체로 풀림) —
     그 후보 하나 때문에 안전 후보까지 버리면 코트가 빈 채로 남는다. 클라도 같은 판정(`removesBoardMembers`)으로 그런 후보를 미리 뺀다.
   - **같이 매칭하지 않기**(후보마다, 앞에서부터): 후보의 한 팀 유효 멤버(anchor ∪ 그 팀을 향한 예약)에 `public.match_avoid_groups`
     한 묶음의 서로 다른 회원(`session_players.member_id`) 둘이 있고, **그 둘이 현재 보드 어느 팀에서도 함께 있지 않았으면**(= 이 편성이 새로 만든 짝)
     위반 → 다음 후보. 운영진이 이미 함께 둔 짝은 그 팀에 다른 사람이 더해져도 보지 않는다 — 편집자 편성(`recommendTeammates.ts`:
     손으로 둔 멤버는 그대로, 새로 고르는 사람만 확정 멤버·서로와 묶음 검사)과 같은 의미.
     내부 함수 `_completion_team_sets(jsonb)` · `_completion_avoid_violation(bigint, jsonb, jsonb)`(실행권 전부 회수).
   - 처음 통과한 후보를 저장: `board_drafts = 후보`, version+1, grant `used_at = now()`, `{"status":"ok","version":새값,"chosen":인덱스}`.
   - 전부 걸리면 저장 없이 `{"status":"rejected"}` — **grant 는 소모한다**(검사는 grant 당 한 번. 남겨 두면 지어낸 후보 집합을 3분 안에
     반복해 넣어 보며 숨은 묶음을 캐낼 수 있다. 정직한 클라는 늘 통과하는 안전 후보를 마지막에 넣으므로 rejected 를 받지 않는다).
     **어떤 규칙·누가 걸렸는지는 응답·오류 어디에도 드러내지 않는다**. `chosen` 인덱스는 저장된 보드(모두에게 보임)와 같은 정보라 숨기지 않는다 —
     남는 누설은 '완료한 경기 1회당 후보 ≤6개 중 처음 통과한 것' 수준이고, 지어낸 후보가 통과하면 그 편성이 실제 보드에 올라 운영진 눈에 띈다.
     (묶음 목록은 주인 전용 숨은 설정 — 회원 기기에 규칙을 내려보내는 RPC 는 만들지 않는다).

`_match_result_record(p_match_id, p_winner, p_actor_member, p_team_a uuid[] default null)` 내부 함수: 실제 편(`_match_split`) member_id 4명 해석
→ unrated 판정 → `match_results` insert(`teams` 포함) → rated 면 각자 `member_ratings` upsert(seed)·잠금(`for update`, member_id 순) → `rating_events` 기록.

## 3. 클라 계약

### 3.1 코어 (`src/lib/rating/`)
- `elo.ts`: `ELO = { BASE: 1000, PER_GRADE: 100, DEFAULT: 1500, WEAK_W: 0.6, STRONG_W: 0.4, SCALE: 400, K_PLACEMENT: 40, K_NORMAL: 20, PLACEMENT_K_GAMES: 10, PLACEMENT_SHOW_GAMES: 5 }`,
  `seedRating(grade)`, `teamStrength(r1,r2)`, `expectedWin(rA,rB)`, `kFactor(games)`, `ratingDelta(k, won, expected)`.
- `tier.ts`: `type TierKey = 'bronze'|'silver'|'gold'|'platinum'|'diamond'|'master'`,
  `TIERS` 표(경계·한글명), `tierOf(rating): TierKey`, `isPlacement(games)`, `tierProgress(rating)`(다음 등급까지 0~1).
- 테스트: 수식 값, 경계, **SQL 상수 일치**(마이그레이션 텍스트에서 숫자 grep).

### 3.2 데이터 (`src/lib/supabase/matchResults.ts`, `src/store/ratingStore.ts`)
- RPC 래퍼: `memberCompleteMatch(matchId, sessionId, winner?, teamA?)`, `submitMatchResult(matchId, winner, teamA?)`, `adminSetMatchResult(matchId, winner, teamA?)`, `fetchMyRating`, `fetchMyMatchHistory`, `commitCompletionDrafts`.
  `teamA: MatchTeamA = [spId, spId] | null`(null = 보드 나눔).
- 타입: `MatchWinner = 'A'|'B'`, `MyRating`, `MyMatchRecord`(§2-6 필드 그대로 camelCase).
- `ratingStore` (zustand): `{ my: MyRating|null, history, loading… }`, `loadMy()`, `loadHistory(more?)`, `submit(matchId, winner)` 후 my/history 갱신.
  폴링·구독 금지(무료 플랜 호출 폭주 이력). 앱 진입 시 1회 + 결과 제출 후 + 내 정보 진입 시.

### 3.3 공용 UI
- `src/components/match/MatchResultDialog.tsx` — **게임스러운** 승패 입력.
  props: `{ teamA: Player[2], teamB: Player[2], mySide?: 'A'|'B', me?, expectedA?: (teamA, teamB) => number, busy?, onSubmit({ winner, teamA }), onSkip(), onClose? }`.
  선수(`MatchDialogPlayer`)는 `spId`(session_players.id)를 가진다. `teamA/teamB` 는 보드 나눔(보충이면 서버가 준 편)이고 '같은 편' 단계의 기본값.
  **'같은 편' 단계**(2026-11-10): 패널 위에 "누구와 같은 편이었나요?"(기준 선수가 내가 아니면 "OO 님과 같은 편은?") — 기준 선수(내가 뛰었으면 나,
  아니면 보드 A편 첫 사람) 아바타 + 나머지 셋 칩(라디오, 보드 짝이 미리 골라짐). 다른 칩을 고르면 두 패널이 다시 나뉜다(기준 선수는 보드에서 있던 쪽
  패널에 남는다 → '우리 팀' 표기 불변). 바뀐 순간 패널 장식 레이어(`mrd-swap`)가 한 번 훑는다(reduced-motion 이면 없음, 아바타 정적). 편을 바꾸면 고른 승자는 지운다.
  순수 로직은 `src/components/match/teamSplit.ts`(`splitWithPartner`·`pickAnchor`·`teamAIds`·`canEditTeams`). 4명 spId 가 다 있어야 단계가 열리고, 아니면 `teamA=null`.
  `onSubmit` 은 `{ winner, teamA: [spId, spId] | null }` — winner 는 **보이는 패널** 기준. 짝을 안 바꿨으면(보드 나눔) `teamA=null` — 다이얼로그 spId 는 열 때의 스냅샷이라, 그 사이 `set_match_roster` 로 같은 경기 id 의 로스터가 바뀌면 명시 spId 가 22023 으로 완료째 되돌려지기 때문. `expectedA` 는 보이는 나눔으로 다시 계산한다.
  호출부: `MatchCompleteFlow`(편집자·회원·이미 완료 세 경로 모두 teamA 전달), `RecordTab`(보충, `ratingStore.submit(matchId, winner, teamA)`). 운영진 정정 UI 는 아직 없다(`adminSetMatchResult(matchId, winner, teamA)` 래퍼만).
  두 팀 패널 + 가운데 VS, 이긴 팀 탭 → 승리 연출, [결과 기록] / [모르겠어요 · 건너뛰기].
  제출 후 결과 단계(선택): 내 Δ 와 등급을 짧게 보여주는 `showOutcome({delta, rating, games})`.
  `ModalSheet`/토큰(`text-strong/muted/faint`) 기반, 다크 대응, 좌측 색 보더 금지, 스크롤락은 ModalSheet 그대로.
- `src/components/rating/TierFrame.tsx` — `PlayerAvatar` 를 감싸 등급별 테두리 **모양**(CSS 레이어)을 그린다.
  props: `{ tier: TierKey, placement?: boolean, size, children }`. 아바타 DOM 은 정지, 장식 레이어만 움직임(티켓 정적 불변식과 같은 원칙).
  `prefers-reduced-motion` 시 정지.

### 3.4 보드 (회원 완료 경로)
- `projection.ts`: 진행 코트 CTA — `isEditor` 면 기존. 아니면 **현재 사용자 memberId 가 그 경기 로스터에 있으면** `ctaLabel='경기완료'`, `ctaEnabled=!busy`.
- 탭 시: 편집자 → `MatchResultDialog` → 기존 `completeMatch(courtId)` → winner 있으면 `submitMatchResult(…, teamA)`.
  회원 → `MatchResultDialog` → `memberCompleteMatch(matchId, sessionId, winner, teamA)` → 로컬 반영(기존 `match_completed` 브로드캐스트와 동일 처리)
  → **회원 편성 후보**(규칙 없이 — 회원 기기엔 '같이 매칭하지 않기' 묶음이 없다): 로컬 drafts 에서 편집자와 같은 순서
  `resolveFreedReservations` → `fillWaitingTeams` → 그 코트 그룹에 `autoFillEmptyCourts(courtId)`(준비된 예비팀 우선, 없으면 새 그룹 자동 편성) → 흩기.
  후보 목록(최대 5, `planMemberCandidates`): ⓪ 그 계획 ①… ⓪이 편성 단계에서 새 조합에 넣은 선수(새로 그룹에 든 사람과 다른 그룹에서 빼 와 예전 팀원과 떨어진 사람을 번갈아)를 **한 명씩** 풀에서 뺀
  (`excludeIds`) 대안 계획 ⓛ 마지막은 **안전 계획** — `fillWaitingTeams` 없이 `autoFillEmptyCourts(courtId, { queuedOnly: true })`
  (준비된 예비팀 옮기기만, 없으면 코트 그룹 그대로; 새 조합이 없어 늘 통과). 같은 payload 는 하나로(안전 계획과 같으면 안전 계획 자리만).
  서버 보드의 사람을 내리는 편성 후보는 보내지 않는다(서버가 건너뜀). 계획·되돌리기 중 보드 변화는 저장 구독(board_save_drafts)을 타지 않는다(`withoutDraftSave`),
  편집자인데 `exclusiveDraftEdit` 로 막힌 기기는 회원 경로로 열지 않는다.
  각 계획은 같은 출발 상태에서 돌고, 끝나면 로컬은 첫 후보 상태. 서버가 `chosen` 을 고르면 로컬도 그 후보 상태로 맞춘다
  (기다리는 사이 로컬이 바뀌었으면 저장된 payload 를 `applyRemoteDrafts`). `rejected` 면 서버 상태로 되돌리고 특별한 안내 없이 "경기를 완료했어요".
  payload 는 로컬 보드 전체가 아니라 `mergeDrafts(계획 전, 계획 후, 서버 원본 raw)` — 이 기기가 못 그린 배치·관전자 로컬 좌표를 덮지 않는다.
  `commitCompletionDrafts(sessionId, matchId, baseVersion, payloads[])` 로 CAS 저장. `stale` 이면 `resyncFromServer({force:true})`(drafts+경기+선수) 후 최대 2회 재계산.
  `claimEdit()` 게이트는 **이 한 번의 커밋 범위에서만** 회원에게 열린다(전역 편집권 아님, 다른 편집 동작은 계속 막힘).
- 이미 완료(동시 탭) → "이미 완료된 경기예요" 안내 후, 결과가 비어 있으면 결과만 제출 가능.

### 3.5 내 정보 통합 (`/me`)
- 라우트 `/me`, `/me/:tab` — 탭 `record`(기본·내 승패) · `dues`(내 회비) · `ledger`(클럽 회계) · `profile`(정보 수정).
  `/my-dues` → `/me/dues`, `/my-dues/ledger` → `/me/ledger` 리다이렉트. `AccountingEntryAlert` 경로 판정·이동 갱신.
- 상단 히어로: `TierFrame`+`PlayerAvatar`, 이름, 등급명/점수/배치 표시, 승·패·승률.
- `record` 탭: `match_my_history` 목록(경기 카드: 우리팀/상대팀, 승패, Δ). `canSubmit` 항목은 [결과 입력] → `MatchResultDialog`.
- `dues`/`ledger` 탭: `AccountingMember` 본문 재사용(파일 경로 고정 — 옮기지 말 것, `.design-sync/config.json`). 회계 모드 꺼짐이면 탭 비활성 안내.
- `profile` 탭: `ProfileSetup` edit 본문(폼·`WaitPointsSection`·탈퇴)을 모달 없이. signup 모달은 그대로.
- `HeaderMenu`: "내 정보" → `/me`, "내 회비" 항목은 없앤다(회비는 /me 의 탭), 사용자 헤더에 `TierFrame` 아바타.

## 4. 범위 밖 (v1)
- 보드 자석(Pixi 캔버스)의 등급 테두리, 다른 회원 등급 공개, 팀 밸런싱 반영, 회원 직접 경기 시작.
