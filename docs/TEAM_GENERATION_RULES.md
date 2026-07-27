# 팀 추천/편성 알고리즘 규칙

> **2026-06 리팩토링 반영**
> 자동 "팀 후보 생성"(`generateCandidateTeams` / `buildTeam.ts`, `generateBulkTeamCandidates`, 다전략 후보 생성,
> 매치 대기열, 팀 후보 크로스 클라이언트 동기화)은 **전부 제거됨(deprecated)**.
> 메인 기능은 **보드(자석 칠판) 수동 편성**이며, 알고리즘은 아래 세 순수 함수로 구성된다.
>
> | 함수 | 파일 | 역할 |
> |------|------|------|
> | `skillScore` / `rankCandidates` | `src/lib/teamSelection/rankCandidates.ts` | 후보 점수·정렬 |
> | `matchRowsToGroupHistory` | `src/lib/supabase/transformers.ts` | 완료 매치 → 그룹 이력(4인 묶음) 파생 |
> | `determineGameType` / `pairingScore` / `pairPlayers` | `src/lib/teamSelection/pairPlayers.ts` | 게임 타입 결정·2v2 페어 편성 |
> | `recommendTeammates` / `autoFillTeammates` | `src/lib/teamSelection/recommendTeammates.ts` | 보드 빈 슬롯 추천(랭킹 + 보드 특화 가산) · 추천도순 greedy 자동편성 |
> | `buildRecommendData` | `src/lib/board/recommendPool.ts` | 보드 추천/자동편성 공통 입력(confirmed·pool·ctx) 빌드 |
>
> CLAUDE.md 프로젝트 규칙상 이 문서는 위 소스 변경 시 **동기화 대상**이다. 공식/가중치는 코드와 일치해야 한다.

## 개요

코트에 들어갈 **4명**을 구성하고, 그 안에서 두 **페어**(2v2)로 편성하는 데 쓰이는 점수 로직.
4명 자동 선발은 더 이상 하지 않으며, 관리자가 보드에서 멤버를 채울 때 **후보 순위 추천**과 **페어 편성**만 제공한다.

### 핵심 철학 — "4명을 뽑는다 / 2v2는 나중에 나눈다"

이 서비스가 추천·자동편성으로 하는 일은 **"같은 경기를 할 4명"을 고르는 것**이다. 그 4명을 2v2로 어떻게 가를지는 별도 단계(`pairPlayers`, 6절)가 실력 균형(`interDiff`/`intraDiff`)으로 책임진다. 두 단계의 역할이 다르므로 우선순위도 다르다.

**선발(4명 고르기)의 가중치 우선순위 — 경기수 > 중복 회피 > 실력**

| 순위 | 항 | 가중치 | 이유 |
|---|---|---|---|
| 1 | **경기수** | `W_GAME` | 적게 뛴 사람부터 — 모두가 비슷한 판수를 뛰는 게 가장 중요 |
| 2 | **재결성 회피** | `W_GROUP2/3/4` | 같은 4명이 다시 뭉치기 힘들게 — 과거 경기 그룹과의 **겹침 수**(2명<3명<4명)에 따라 벌점 급증. 2명 겹침은 경기수 1판 아래의 타이브레이크, 3명+겹침은 경기수 1판을 넘어선다 |
| 3 | **실력** | `W_SKILL` | 상대적으로 약하게 본다. **4명 안의 2v2 실력 균형은 `pairPlayers`가 따로 잡으므로** 선발 단계에서 실력을 앞세울 필요가 없다 |

> 이 서열은 `W_SKILL(3) < W_GROUP2(8) < W_GAME(10) < W_GROUP3(24) < W_PLAYING(30) < W_GENDER(50) < W_GROUP4(60)` 로 코드(`RECOMMEND_WEIGHTS`·`DEFAULT_WEIGHTS`)에 반영돼 있다(7절·2절). 과거엔 `W_SKILL`이 최우선(20)이라 실력이 비슷한 사람끼리 반복해서 같은 경기에 뽑히는 부작용이 있었다.

### 용어 정의
- **팀**: 한 코트에서 경기하는 4명 전체
- **페어**: 팀 안에서 같은 편인 2명 (복식 파트너)
- **그룹 이력(`groupHistory`)**: **완료된 경기 1건당 4명(session_players.id) 한 묶음**의 목록. 완료된 `matches`에서 파생한다(스냅샷 로드 + `match_completed` 로컬 누적 + resync catch-up). 경기 **완료 시점**에만 누적한다. 쌍(2명) 단위 누적(구 `pairHistory`·`pair_history` 테이블 조회)은 2026-07 폐기.

### 데이터 참조 방식 (중요)

`GeneratedTeam.teamA/B`는 `[string, string]` 형태의 **`session_players.id` 참조**다.
알고리즘 내부에서 `SessionPlayer` 객체로 계산하되, 최종 반환 시에는 `.id`만 추출한다.

---

## 1. 스킬 점수 — skillScore

`rankCandidates.ts`의 기준 유틸. 실력은 **단일 등급(1~10, 10이 가장 강함)** 으로 관리한다(구 6종 O/V/X 모델 대체).

```
skillScore(player) = player.skills.grade   → 범위 1 ~ 10
```

- 실력은 `members.skills` jsonb 에 `{ "grade": N }` 로 저장되고 세션 스냅샷(`session_players.skills`)으로 복사된다.
- **하위호환**: `skillScoreOf` 는 구 6종 형태(`{클리어:"V",…}` · O·V·X/상·중·하)를 만나면 선형 환산한다 — 평균(O=3,V=2,X=1) → `round(1 + (avg−1)/2 × 9)`, clamp 1~10. 과거 매치 스냅샷(`matches.player_snapshot`)은 구 형태로 남아 있어도 그대로 읽힌다.

---

## 2. 후보 점수 — rankCandidates

이미 확정된 N명(`confirmed`)이 있을 때, 풀(`pool`)에서 가장 어울리는 후보를 **점수 오름차순(낮을수록 좋음)** 으로 반환하는 순수 함수. 랜덤 없음. 풀 구성(성별 필터, 대기/경기중 혼합 등)은 호출자 책임.

### 가중치 (Weights)

`W_SKILL, W_GROUP2, W_GROUP3, W_GROUP4, W_GAME, W_MIXED, W_WAIT` 7개.

기본값(`DEFAULT_WEIGHTS`): `W_GAME 10.0, W_GROUP2 8.0, W_GROUP3 24.0, W_GROUP4 60.0, W_SKILL 3.0, W_MIXED 0, W_WAIT 0`. (재결성 회피는 겹침 수에 따라 경기수 1판 아래(`W_GROUP2`)부터 위(`W_GROUP3·4`)까지 걸친다 — 위 핵심 철학 참조. `DEFAULT_WEIGHTS`는 `rankCandidates`를 weights 없이 호출할 때의 폴백이며, 실제 추천/자동편성은 `RECOMMEND_WEIGHTS`(7절)를 쓴다.)

> 그룹 가중치 (8, 24, 60) 근거(200시드 시뮬 스윕): 초안값 (2, 12, 40)은 2인 겹침 회피가 구 `Σc²`의 1/4로 약해져 오히려 순후퇴였다(3인 겹침 경기 3.9% vs 구 방식 1.3%). `W_GROUP2 8`은 "경기수 1판(10)을 못 뒤집는다" 불변식을 지키는 최대값이자 구 `Σc²`의 1회 동반 벌점(8)과 등가이고, `W_GROUP3 24`가 3인 겹침의 주 레버(12→24에서 3.9%→0.7%), `W_GROUP4 60`은 재결성 0% 유지 + `W_GENDER`(50)보다 큰 여유값. 결과: 3인 겹침 0.7%·2인 겹침 67%·고유 동반 16.2명으로 구 방식 전 지표 상회, 판수 형평 비용 std +0.04.

> `W_SKILL` 3.0 (2026-07 개편): 스프레드 증가분 방식에서 실력 항은 **밴드를 넓히는 후보에만** 작동한다(밴드 안은 전부 0). 3.0이면 3등급 초과 확장부터 경기수 1판 차이(`W_GAME` 10)를 넘어서고, 그 이하 확장은 여전히 경기수 우선 — "경기수 > 실력" 철학을 유지하면서 극단 스프레드만 막는다. 200시드 시뮬레이션 스윕({0.67, 1.5, 3, 6}) 근거: 3.0에서 평균 스프레드 3.90→3.51, 타이트(≤2) 경기 26→33%, 판수 형평 비용은 std +0.018로 사실상 0. 6.0은 더 타이트하지만(3.29) 1.7등급 확장부터 경기수를 뒤집어 보류. (구 값 0.67은 구 "평균 거리" 방식의 등급 스케일 보정값(3.0/4.5) — 방식 교체로 근거 소멸.)

> **제거됨(deprecated)**: 가중치 프로필 상수 `WEIGHT_PROFILES`(자동 다전략 후보 생성용 5개 프로필 — `gameCountBalanced`/`newCombination`/`skillBalanced`/`mixedCountBalanced`/`waitTimePriority`)는 소비자가 전부 삭제되어 **코드에서 완전히 제거**되었다.
> 현재 유지되는 가중치는 `recommendTeammates` 의 `RECOMMEND_WEIGHTS`(7절)와 `rankCandidates` 내부 기본값 `DEFAULT_WEIGHTS` 뿐이다.

### 점수 공식 — computeScore

**confirmed가 0명일 때** (첫 멤버 선발 기준): 판수 + 혼복수 + 대기시간만 반영.
```
score = gameCount · W_GAME + mixedCount · W_MIXED - waitMinutes · W_WAIT
```

**confirmed가 1명 이상일 때**:
```
score = skillDiff · W_SKILL
      + regroup2 · W_GROUP2 + regroup3 · W_GROUP3 + regroup4 · W_GROUP4
      + gameCount · W_GAME
      + mixedCount · W_MIXED
      - waitMinutes · W_WAIT
```

| 항 | 정의 | 방향 |
|----|------|------|
| `skillDiff` | 후보 합류 시 팀 등급 밴드(min~max)의 **스프레드 증가분** (아래 정의) | 작을수록 ↓ (실력 유사) |
| `regroup2/3/4` | 후보가 속했던 **과거 경기 4인 그룹** G마다 `k = \|G ∩ confirmed\|`를 세어, 후보 합류로 새 팀이 그 그룹과 **2명(k=1) · 3명(k=2) · 4명(k=3)** 겹치게 되는 그룹 수 | 적을수록 ↓ (재결성 회피) |

> **재결성 회피는 그룹 겹침 단위다(2026-07 개편).** 구 쌍 단위 누적(`Σc²`)은 조합의 정체성을 잃는 문제가 있었다 — 목적은 **같은 4명이 다시 뭉치기 힘들게**이므로, 과거 완료 경기의 4인 그룹과 새 팀의 겹침 수로 벌점한다: **2명 유지+2명 교체**(`W_GROUP2` 8.0)는 경기수 1판(10)을 못 뒤집는 타이브레이크, **3명 유지+1명 교체**(`W_GROUP3` 24.0)는 경기수 1판을 훌쩍 넘어서는 회피, **완전 재결성**(`W_GROUP4` 60.0)은 경기중 ghost 페널티(`W_PLAYING` 30)보다도 커서 "재결성될 바엔 경기중 선수를 데려오는" 선택이 성립한다. 같은 조합이 여러 번 있었으면 그룹 수만큼 중복 가산(반복일수록 강한 회피).
| `gameCount` | 절대 출전 판수 (`session_players.game_count`) (아래 3절) | 적을수록 ↓ (적게 뛴 사람 우선) |
| `mixedCount` | 누적 혼복 출전 횟수 | 적을수록 ↓ |
| `waitMinutes` | 대기 경과 분 = `(now − waitSince)/60000`, waitSince 없으면 0 | 클수록 ↓ (음수 반영) |

> `gameCount` 는 클수록 후순위라 **양수 가산**, `waitMinutes` 는 클수록 우선이라 **음수 부호**로 점수를 낮춘다.

#### `skillDiff` — 스프레드 증가분 (2026-07 개편)

```
skillDiff = max(0, min(confirmed 등급) − 후보 등급, 후보 등급 − max(confirmed 등급))
```

- **밴드 안 후보는 전부 0**: 후보 등급이 confirmed의 min~max 사이면 벌점 없음(동일 취급).
- **밴드를 넓히는 후보만 벌점**: 넓힌 폭만큼. `confirmed` 1명일 때는 `|후보 − 확정|` 로 구 평균 방식과 동일하다.
- **성별 무관**: 혼복(남녀 혼합) 지향 그룹에서도 남녀 구분 없이 4명 전원의 실력을 본다. (`confirmed`가 0명이면 skillDiff 항 자체가 없다 — 위 0명 공식 참조.)
- **미등급(판독 불가 → `skillScore` 0)은 "정보 없음"**: confirmed 쪽 미등급은 밴드 계산에서 제외(0이 밴드 하한을 무너뜨려 하방 판별이 꺼지는 것 방지)하고, 미등급 후보 본인도 벌점하지 않는다.

> **왜 평균 거리가 아닌가**: 구 방식(`|후보 − confirmed 평균|`)은 이미 벌어진 팀(예: {2,8} — 평균 5)에서 중간 등급(5)을 항상 '최적합(0)'으로 판정해, **중간 등급이 이질 팀의 만능 필러로 흡수되는 비대칭**이 있었다(중간 등급 회원이 균질한 경기(빡겜)를 못 잡는 구조적 원인, 2026-07 경기로그 분석). 스프레드 증가분은 벌어진 팀을 중간 등급으로 가리는 대신, 팀이 처음부터 벌어지는 것 자체를 막는다.
>
> **혼복 "여자만 균형" 규칙 제거**: 구 규칙(혼복 목표 시 남자 후보 skillDiff=0, 여자만 확정 여성 평균과 균형)은 2026-07 기획 변경으로 제거됐다 — 혼복 로테이션이 강제되는 구조에서 경기의 절반가량이 남성 실력 무심사로 편성되어 스프레드를 키우는 주범이었다(혼성 경기 평균 스프레드 4.27 vs 동성 3.84). 이제 혼복에서도 최대한 실력을 맞춘다.

---

## 3. 참여 판수 — gameCount + 합류 시점 평균 보정

**절대 경기수(`gameCount`)** 로 참여 균등 우선순위를 매긴다. 적게 뛴 선수일수록 점수가 낮아(우선 선발) `gameCount · W_GAME` 만큼 가산된다.

> **deficit(기대 경기수 비례) 모델은 제거됨.** 이전에는 `joinedAtMatch`/`totalMatchCount` 기반 `eligibleRounds × playProbability − gameCount` 로 적자를 계산했으나, 합류 시점 평균 보정(아래)으로 단순화하면서 폐기했다. `joined_at_match` 컬럼·`totalMatchCount`/`allSessionPlayers` 컨텍스트는 더 이상 점수 계산에 쓰이지 않는다.

### 늦참자 · 휴식 복귀자 보정 — 합류 시점 평균 판수 + 대기시간 리셋

핵심 원칙: **휴식(또는 합류 전)은 "그 시간 동안 평균만큼 경기한 것"과 동일 취급한다 — 빠진 시간이 추천 우선도를 절대 올리지 않는다.** (휴식은 본인 선택이므로 보상 X.) 절대 판수만 쓰거나 대기시간만 쓰면, 늦게 합류했거나(0판·대기 0) 휴식 후 복귀한(판수 정체·대기 정체) 선수가 무조건 추천 1순위로 튀어 불공정하다. 그래서 **매칭 가능해지는 시점(합류·복귀)** 에 두 가지를 함께 보정한다:

```
game_count  = GREATEST(game_count, 활성 평균 판수)   -- "빠진 시간만큼 평균적으로 뛴 걸로 가정"
활성 평균 판수 = AVG(game_count)  -- 같은 세션, status ≠ 'resting', 본인 제외. 없으면 0.
wait_since  = now()                                  -- 대기시간(W_WAIT) 누적도 그 시점부터 새로 시작
```

- **합류 기준 = 콕확인**: `set_cock_checked` RPC가 **최초** `cock_checked=false → true` 전환 시 1회 보정(판수 + `wait_since`). 멱등 — 이미 확인된 선수는 변경 없음. 콕체크 비활성 세션은 이벤트가 없어 보정도 없다. (`wait_since` 리셋은 `20260626010000` — W_WAIT 활성화 대응.)
- **휴식 복귀**: `set_player_resting(p_resting=false)` RPC가 복귀 시 동일 보정(판수 + `wait_since=now()`). 휴식 진입 시엔 `wait_since=NULL` + 풀에서 제외(`recommendPool`·`arrange` 가 `status='resting'` 제외) → 휴식 중엔 어떤 추천에도 안 나오고, 복귀해도 휴식 시간이 우선도로 환산되지 않는다.
- `GREATEST` 를 쓰므로 이미 평균보다 많이 뛴 선수의 판수는 **깎이지 않고**(올림만) 보정된다.

> `game_count` 는 `session_players.game_count` 에 대응하며, 매치 완료(`complete_match` 계열 RPC) 시 +1 증가한다. `wait_since` 는 대기 진입(경기 완료·휴식 복귀·콕확인) 시각으로, `W_WAIT`(7절) 의 대기 우선도 기준이다.

---

## 4. 그룹 이력 누적 — groupHistory

경기 **완료 시점**의 4인 묶음을 그룹 이력에 추가한다. 쌍 단위 클라이언트 누적(`recordTeam`·`src/lib/pairHistory.ts`)과 `pair_history` 테이블 조회는 폐기됨(2026-07).

- **원천 = 완료된 `matches`**: 초기 로드(`fetchSessionSnapshot`)가 진행중+완료 매치를 함께 받아 완료분을 그룹 이력으로 파생하고(`matchRowsToGroupHistory`), 세션 중에는 `match_completed` 처리(`sessionBroadcastHandlers.handleMatchCompleted`)가 4인 묶음을 append 한다. 편집자 기기는 완료 RPC 직후 로컬 디스패치로 즉시 반영되어 다음 추천에 최신 이력이 쓰인다.
- **resync catch-up**: `resyncFromServer` 가 완료 매치의 4인 구성을 병렬 재조회(`dbLoadCompletedMatchTeams`)해 **matchId 집합 기준으로 병합**(`mergeGroupHistory` — 서버 권위 + 스냅샷 이후 로컬 선반영분 보존, append 쪽도 matchId dedup) — broadcast 유실·편집권 이양 후에도 추천/자동편성이 최신 재결성 이력을 보고, "resync 교체 직후 같은 매치 broadcast 도착 → 중복" 레이스가 없다. 각 항목은 `{matchId, members}` 이며 선수 삭제(FK SET NULL)로 members 가 4명 미만일 수 있다.
- 직전·과거를 통합 판단한다 — 직전 경기도 완료 시 그룹으로 추가되므로, 최근 함께 뛴 조합일수록 `regroup` 항이 커져 자연히 회피된다.
- 이력은 **세션 단위**다(완료 매치가 세션 소속). 새 세션이 시작되면 빈 목록에서 다시 쌓인다.
- (기존의 별도 지표 `lastCoPlayers`·가중치 `W_COPLYR` 는 제거됨.)

> DB 측 `pair_history` 테이블과 서버 누적(`complete_match`·세션종료 백필의 6쌍 upsert)은 **제거 완료**(마이그레이션 `20260727090000_drop_pair_history`) — 점수 계산은 완료 `matches` 파생 그룹 이력만 쓴다.

---

## 5. 게임 타입 결정 — determineGameType

확정된 4명의 **여성 수**로 게임 타입을 결정한다(`pairPlayers.ts`).

| 여성 수 | 결과 | 비고 |
|---------|------|------|
| 0 | `남복` | |
| 1 | `혼합` 또는 `남복` | 해당 여성이 `allowMixedSingle`(UI: "남복 편성 허용 여성")이거나 `singleWomanIds`에 포함되면 `혼합`, 아니면 `남복`. ※ 이 플래그는 추천 성별 페널티 면제에도 쓰인다(위 추천 가중치 §성별 균형 참조). |
| 2 | `혼복` | |
| 3 | `남복` | 남자 1명 포함 |
| 4 | `여복` | |

---

## 6. 페어 편성 — pairingScore / pairPlayers

### 페어링 점수 (낮을수록 좋음)

```
score = intraDiff × 0.5 + interDiff × 1.5
```

| 항 | 정의 | 의미 |
|----|------|------|
| `intraDiff` | `\|s(A1)−s(A2)\| + \|s(B1)−s(B2)\|` | 페어 내 파트너 실력 유사성 (가중 0.5) |
| `interDiff` | `\|(s(A1)+s(A2)) − (s(B1)+s(B2))\|` | 두 페어 실력 합 차이 = 강약 교차 균형 (가중 1.5) |

> `s(x) = skillScore(x)`. **interDiff(팀 간 균형)에 더 큰 가중(1.5)** 을 두어, [강,강] vs [약,약] 보다 [강,약] vs [강,약] 교차 매칭을 우선한다.

### 편성 절차 (pairPlayers)

1. `determineGameType` 으로 게임 타입 결정
2. **혼복**: 여자 2 × 남자 2를 크로스 배치
   - (여A+남A vs 여B+남B) vs (여A+남B vs 여B+남A) 두 조합의 `pairingScore` 비교 → 낮은 쪽 선택, 동점이면 랜덤(`bestMixedPairing`)
3. **그 외**(남복/여복/혼합): 4명의 3가지 페어 조합을 모두 평가 → `pairingScore` 최솟값 선택, 동점이면 동점 조합 중 랜덤(`bestPairing`)
4. `teamA`/`teamB` 를 `session_players.id` 쌍으로 추출하여 `GeneratedTeam` 반환 (점수 0 → "실력 균형 최적", ≤4.5 → "양호" 메모 — 등급 1~10 스케일 기준. 구 1~3 스케일의 ≤1 을 폭 9로 환산)

---

## 7. 보드 추천 — recommendTeammates

보드의 "팀 구성 중" 그룹에서 빈 슬롯(+)을 눌렀을 때 보여줄 추천 팀원 순위.
`rankCandidates` 결과(base cost)에 보드 특화 3요소를 가산하고 다시 오름차순 정렬한다. (점수 = 비용, 낮을수록 상위)

### 풀 구성 — buildRecommendData (`recommendPool.ts`)

`rankCandidates`/`recommendTeammates`는 풀을 인자로 받기만 하고 구성은 호출자 책임이다. 보드의 두 진입점 — 추천 다이얼로그 훅(`useTeammateRecommendations`)과 자동편성 액션(`boardStore.autoFillTeam`) — 은 입력 구성을 공통 순수 함수 `buildRecommendData`로 일원화한다.

- `confirmed` = 팀/시드 멤버 + (다이얼로그) 진행 중 다중선택분
- `pool` = 세션 전체 − 확정 멤버 − 휴식(`resting`) − **자석 없는 선수** − 다른 보드 팀 anchor
  - `excludePlaying:true`면 경기중 선수도 풀에서 제외 (자동편성은 2026-07부터 미사용 — ghost 1명 허용, 8절)
  - `excludeReserved:true`(자동편성 전용)면 **다른 팀에 ghost 예약된 선수** 제외 — 이중 예약 방지
  - 자석(`MagnetPosition`) 없는 선수는 제외 — 멤버십 commit(`attachAnchor`)이 자석을 전제로 하기 때문
- `ctx` = `groupHistory` / `lastGameType` / `playingIds`(코트 기반)

### 추천 가중치 (RECOMMEND_WEIGHTS)

`Weights` 5개 + 보드 특화 3개:

| 상수 | 값 | 의미 |
|------|---:|------|
| `W_GAME` | 10.0 | **경기수 최우선** — 적게 뛴 사람부터(절대 판수 `gameCount`) |
| `W_GROUP2` | 8.0 | **재결성 회피(약)** — 과거 그룹과 2명 겹침(2명 유지+2명 교체). 경기수 1판(10)을 못 뒤집는 최대값(구 `Σc²` 1회 동반과 등가) |
| `W_GROUP3` | 24.0 | **재결성 회피(중)** — 과거 그룹과 3명 겹침(3명 유지+1명 교체). 경기수 1판을 훌쩍 넘어서는 회피 |
| `W_GROUP4` | 60.0 | **재결성 회피(강)** — 과거 그룹 4명 완전 재결성. `W_PLAYING`(30)·`W_GENDER`(50)보다 커서 "재결성될 바엔 경기중 ghost를 데려온다" |
| `W_SKILL` | 3.0 | **실력은 3순위** — 스프레드 증가분(밴드 확장)에만 벌점. 3등급 초과 확장부터 경기수 1판을 넘어선다(2절 참조). 2v2 균형은 페어 편성(`pairPlayers`)이 보정 |
| `W_MIXED` | 0 | 누적 혼복수는 로테이션(W_ROTATE)으로 대체 |
| `W_WAIT` | 1.0 | **오래 쉰(대기) 사람 강한 우선** — 연속 휴식 편차 완화(아래) |
| `W_ROTATE` | 6.0 | 로테이션 보너스(직전과 **다른** 타입으로 전환하는 후보) |
| `W_ROTATE_REPEAT` | 2.0 | 반복 페널티(직전과 **같은** 타입 반복) — 보너스보다 작게 |
| `W_GENDER` | 50.0 | 혼복(2남2녀) 목표에서 성별 초과(3명+) 후보 페널티 |
| `W_MIXED_COMPLETE` | 8.0 | 혼복 구조(남녀 혼합) 완성에 필요한 부족 성별 후보 보너스 |
| `W_PLAYING` | 30.0 | 경기중 후보 페널티(대기 선수 우선) |

### 보드 특화 가산 요소

후보를 더했을 때 팀이 양성 혼합(`m>0 && f>0`)이면 목표 타입은 혼복 지향(`targetMixed=true`), 아니면 동성 지향이다.

1. **게임 타입 로테이션 (`W_ROTATE` / `W_ROTATE_REPEAT`)** — 시드 시점과 후보 시점을 **분리**해 합산한다. 각 주체의 직전(또는 진행중) 타입(`lastGameType`)이 "혼복류(혼복/혼합)인가" === "목표가 혼복 지향인가"를 비교한다.
   - **후보 본인 시점** (대칭 `±W_ROTATE`): 같으면 `+W_ROTATE`(또 같은 경기 → 강하게 하위), 다르면 `−W_ROTATE`. 예) 직전 혼복 후보를 혼복 팀에 넣으면 "또 혼복"이라 하위, 직전 남/여복 후보는 혼복 팀에 우대. → 후보가 "다음에 무슨 타입을 할 차례인지" 제대로 반영.
   - **시드(확정 멤버) 시점** (비대칭): 같으면 **약한 페널티** `+W_ROTATE_REPEAT`(2.0), 다르면 보너스 `−W_ROTATE`(6.0). 반복을 보너스보다 작게 두어, 동성 시드(예: 남필립)에서 동성 후보가 과도하게 하위로 밀리지 않게 한다.
   - (이전엔 시드·후보가 같은 값을 써서, 남필립 양극화 완화로 낮춘 반복 페널티(2)가 후보 시점에도 적용돼 "직전 혼복 후보 누르기"가 약했다. 분리로 두 요구를 양립시킨다.)
2. **성별 균형 (`W_GENDER` / `W_MIXED_COMPLETE`)**:
   - 초과 페널티: `targetMixed` 인데 한쪽 성별이 3명 이상(`m>2 || f>2`)이 되는 후보에 `+W_GENDER`(하위 노출).
   - **"남복 편성 허용" 여성 예외**: 1F3M 구성(`m===3 && f===1`)에서 그 **단독 여성이 `allowMixedSingle`(남복 편성 허용)** 이면 위 초과 페널티를 면제한다 — 남자 경기에 넣어도 되는 여성이므로 추천 후보로 올라온다. 단독 여성은 후보 본인(`player`)이거나 `confirmed`의 유일 여성. (3F1M 역방향은 면제 없음 — `allowMixedSingle`은 여성→남복 전용.)
   - 혼복 완성 보너스: `confirmed`가 이미 남녀 혼합(`baseM>0 && baseF>0`, 혼복 구조)이면, 2남2녀에 아직 부족한(2명 미만) 성별 후보에 `−W_MIXED_COMPLETE`(상위 노출). 1남1녀처럼 양쪽 다 부족하면 동일 가산이라 편향이 없다.
3. **경기중 페널티 (`W_PLAYING`)**: 후보가 `playingIds` 에 있으면 `+W_PLAYING`(대기 선수가 상위로).
4. **오래 쉰 사람 우선 (`W_WAIT`, 2절 base에서 반영)**: 대기 경과 분(分)에 비례해 점수를 낮춘다(`−waitMinutes·W_WAIT`). 8명 1코트처럼 4/4가 딱 떨어질 때 "누군 2번 연속·1번 휴식 / 누군 2번 휴식·1번 출전"으로 갈리는 연속 휴식 편차를 완화 — 같은(또는 비슷한) 판수면 **더 오래 기다린 사람**이 다음 경기에 확실히 들어온다. `waitSince`는 경기 완료/휴식 복귀로 대기 진입할 때 갱신되므로(자연 리셋) 계속 못 들어간 사람만 값이 커진다. `W_WAIT`(분당 가중)는 실제 휴식 시간에 비례하는 **튜닝 knob** — 너무 세거나 약하면 조절.
> **비(非)스코어 UI 요소 — "우선배치"(그룹 지정)**: 아래 5번은 **점수/추천에 영향을 주지 않는다**. 스코어링 가산 요소가 아니라 순수 시각 그룹 표시라 이 목록에 두되 "비스코어"로 명시한다. (구 "고정배치"는 경기 시작 시 쌍을 `forcedPairs`로 기록해 추천에 `W_FORCED` 페널티를 줬으나, 2026-07 기획 변경으로 그 밸런스 영향 경로(`forcedPairs`·`W_FORCED`·decay)를 **전면 제거**했다.)

5. **"우선배치"(그룹 지정) — 표시 전용, 점수 영향 없음**: 운영진이 그룹(구성 중)에서 **"우선배치" 버튼을 누르면** 그 시점의 멤버 전체를 그룹으로 표시(`forcedIds`)한다. **추천·자동편성·밸런스 점수에 일절 영향을 주지 않는다** — 그저 "이 팀은 의도적으로 묶은 그룹"임을 핀 배지로 나타낸다. 예약 승격 우선권 등 어떤 행동 효과도 없다(순수 시각).
   - **트리거**: `toggleForced(teamId)` — 누르면 `forcedIds = 현재 멤버 전체(anchor + ghost)`. 다시 누르면 해제. 실제 락 아님 — 멤버를 드래그로 빼면 `forcedIds ∩ 현재 멤버`로 자동 취소(배지 사라짐).
   - **버튼 노출 조건**: 구성 중(2명+ 활성, 1명 비활성). **4명이라도 예약(ghost=경기중 빌려온 선수)이 끼면** 매칭 시작 불가이므로 시작 버튼 대신 **"우선배치"** 가 뜨고, 이때 지정하면 예약 포함 전원 표시. 4명 전원이 anchor(예약 없음)면 매칭확정 버튼.
   - **UI**: 핀(map-pin) 벡터 배지(anchor·ghost 모두, 인디고). 버튼 라벨 "우선배치"↔"우선배치 해제". 그룹박스의 "자동편성"은 추천 모달 안 버튼으로 이동(`autoFillTarget`).
   - **생성자 표시(비스코어)**: 팀 박스 라벨에 그 그룹을 만든 편집자 이름을 `· by OO`로 표시한다(`DraftTeam.createdBy`, 생성 시 `sessionStore._myName` 스냅샷). 점수와 무관한 메타 정보.
   - **저장/동기**: 별도 컬럼 없이 `board_drafts` jsonb(`forcedIds`·`createdBy`)에 함께 — 기존 board_drafts 동기·영속 경로 재사용.

### RecommendContext 추가 입력

- `lastGameType: Record<string, GameType>` — `session_player.id` → 직전(또는 진행중) 게임 타입
- `playingIds: ReadonlySet<string>` — 현재 코트에서 경기중인 `session_player.id`
- (그 외 `groupHistory` 는 `RankContext` 와 공유)

### 점수 분해 디버그 (ScoreBreakdown)

- `RankedCandidate.breakdown`(`ScoreBreakdown`)에 항목별 기여도(가중치 적용 후 값)를 담는다: `skill`/`group`/`game`/`mixed`/`wait`(base) + `rotate`/`gender`/`playing`(보드 특화). **합 = `score`**.
- 추천 다이얼로그(`RecommendTeammateDialog`) 헤더의 🐛 토글로 후보별 점수 분해 테이블(각 항목 + 합계 + %)을 표시한다. "왜 이 후보가 N%인가"를 추측 없이 바로 확인하는 용도.

---

## 8. 자동편성 — autoFillTeammates

보드 "팀 구성 중" 박스의 CTA 자리(멤버 4명 미만일 때)에 있는 **자동편성** 버튼이 빈 슬롯을 추천도 높은순으로 채운다.

### 핵심: 매 라운드 재평가 (greedy)

추천 점수는 "현재 확정 멤버가 누구냐"에 따라 매번 달라진다(실력 유사·동반 회피·로테이션·성별 균형 모두 `confirmed` 의존). 그래서 상위 N명을 한 번에 잘라 넣지 않고, **한 명을 뽑을 때마다 재평가**한다.

```
autoFillTeammates(confirmed, pool, ctx, count, weights?, { maxPlaying }):
  반복 count회 (또는 pool 소진까지):
    1. recommendTeammates(confirmed, pool, ctx) → 상한 제약을 만족하는 최상위 1명 선택
       (경기중 후보는 이미 maxPlaying명 뽑았으면 건너뛰고 다음 비경기중 후보)
    2. 그 1명을 confirmed에 추가, pool에서 제거
  → 뽑힌 후보를 추천된 순서대로 반환(풀이 모자라면 가능한 만큼만)
```

> 단순 "상위 N명 자르기"와 다르다: 먼저 들어간 후보가 다음 라운드의 재결성/성별 균형/로테이션 점수를 바꾸므로, 라운드마다 다음 1명이 재선정된다.

### 풀 구성 — 대기 우선 + 경기중 ghost 1명 허용 (2026-07 개편)

보드 액션 `boardStore.autoFillTarget`은 `buildRecommendData(..., { excludeReserved: true })` + `autoFillTeammates(..., { maxPlaying: 1 })`로 채운다 — **경기중 선수도 팀당 1명까지 ghost 예약으로** 뽑을 수 있다.

- 경기중 후보는 `W_PLAYING`(30) 페널티를 안고 경쟁하므로, 대기 후보들이 재결성 벌점(`W_GROUP4` 40 등)·판수 열세로 크게 밀릴 때만 상위로 올라온다 — "같은 4명이 재결성될 바엔 경기중에서 데려온다".
- **팀당 ghost 상한 1명**: 상한 없이 열면 같은 진행중 경기의 2명을 함께 뽑아 "방금 같이 뛴 둘이 곧바로 또 뭉치는" 역효과 + 코트 공회전이 급증한다(시뮬레이션 근거 — W_PLAYING 10·20에서 직전겹침 10배 악화). ghost 1명이면 대기 상한이 그 한 경기의 잔여시간으로 캡된다.
- 경기중 pick은 `commitTeammates`가 자동으로 예약(ghost) 처리 → 그 선수의 경기가 끝나면 `resolveFreedReservations`가 정식 anchor로 승격, 4명 확보 시 매칭확정 가능. 비경기중 picks는 즉시 anchor.
- 다른 팀에 이미 ghost 예약된 선수는 풀에서 제외(`excludeReserved`) — 이중 예약 방지.
- 채울 수(`count`) = `4 − 현재 멤버 수`. 후보가 부족하면 채운 만큼만 두고 토스트로 안내(`N명만 채웠어요`), 0명이면 멤버 불변.

> 대비 — 다이얼로그(`RecommendTeammateDialog`)의 수동 추천은 상한 없음(`excludePlaying:false` 기본). 경기중 후보도 `W_PLAYING` 페널티로 하위 노출하되 자유 선택 가능하며, 선택 시 ghost 예약이 된다.

---

## 9. 공통 규칙

### 동점 시 랜덤 선택 (다양성 확보)
- 페어 편성에서 `pairingScore` 가 완전히 동일한 최적 조합이 여러 개면 그중 **무작위**로 선택한다(`bestPairing`/`bestMixedPairing`).
- 매칭 결과 고착화를 막고, 세션이 진행될수록 더 다양한 조합이 만들어지도록 보장한다.
- `rankCandidates` 자체는 순수 함수(랜덤 없음)이며, 정렬은 안정 정렬로 동점 시 입력 순서를 유지한다.

### 보드 멤버십 불변식 (reconcile — `remoteDrafts.ts` / `boardStore.ts`)
팀 편성(`board_drafts`)과 코트 배정(`matches`)은 별도 권위로 비원자적으로 동기화되므로, 동시편집 레이스(유실된 dissolve, 핸드오프/탈취, 로스터 편입)로 멤버십이 어긋날 수 있다. 두 선행조건으로 막는다.

**(가) 편집은 반드시 한 명만** — `board_save_drafts`뿐 아니라 경기 RPC(`assign_match`/`complete_match`/`set_match_roster`)도 `board_assert_editor`로 서버에서 게이팅한다. 편집 락은 **sticky 소유**(`editor_client_id` 신원만; lease 만료 자동 해제·하트비트 폐기 — 마이그레이션 `20260717000000`)라 점유되면 명시적 takeover/handoff로만 이동한다. `board_assert_editor`는 호출자가 이미 편집자면 통과(sessions write 없음), 자유면 self-claim, **남이 보유하면 `'not editor'`로 거부**한다. 거부된(=편집자 아닌) 기기의 코트 변경은 `resyncFromServer`로 보기 전용에 수렴한다. (초기 게이팅은 마이그레이션 `20260624020000`, 운영진 강제는 `20260701020000`.)

**(나) 사람 유니크성** — 아래 불변식을 **파생 단계에서 항상 강제**해 "팀에 있는데 게임중"·"A팀·B팀 동시 소속" 중복 표시를 막는다.
- **I1 — 단일 anchor**: 한 선수는 최대 한 예비팀의 anchor. `reconcileMembership`이 payload 팀을 `(createdMs↑, id↑)` 결정적 순서로 처리해 같은 선수가 둘 이상 팀에 있으면 **먼저 만들어진 팀**만 유지(모든 클라가 동일 결과로 수렴).
- **I2 — 경기중은 anchor 아님**: `playingIds`(코트 기반)에 든 선수는 어느 예비팀의 anchor도 아니다. reconcile이 항상 제거하고, 편집자는 `healPlayingAnchors`(코트 변화 시) + reconcile 정제분을 `board_drafts`로 영속화해 서버까지 수렴(새로고침 시 "유령 팀" 부활 방지).
- **ghost(예약)는 예외**: 경기중 선수를 예비팀에 `Reservation`(ghost)으로 빌려두는 것은 의도된 기능(§7 `handlePlayingMagnetDrop`)이라 I2가 건드리지 않는다. I2는 `anchorMemberIds`에만 적용.

**(다) ghost 정합 — "anchor xor ghost" + 복사본 수렴** — ghost는 "한 선수가 [원본 + 여러 팀 복사본]으로 동시에 보이는" 유니크성 예외이므로, 원본(선수) 상태가 바뀔 때 복사본이 stale로 남지 않게 강제한다.
- **anchor xor ghost**: 한 선수가 어느 팀의 anchor로 확정되면 어느 팀에서도 ghost일 수 없다. ① 로컬: `attachAnchor`가 합류 시 그 선수의 **모든** 예약(타 팀 포함)을 제거. ② 동기화 경계: `reconcileMembership`이 `assignedAnchor`에 든 선수의 예약을 버린다(경기중 선수는 I2로 anchor에서 빠져 assignedAnchor에 없으므로 "경기중 + ghost" 빌려주기는 보존).
- **복사본 수렴(승격)**: 경기 종료(`completeMatch`)·로스터 제외(`setMatchRoster`)로 빌려졌던 선수가 자유가 되면 `resolveFreedReservations`가 그 선수의 예약을 한 팀(잠금 팀 우선, 없으면 최古)의 정식 anchor로 승격하고 나머지 예약을 정리 → 4명+예약 팀이 매칭확정 가능 상태가 된다.
- **중복/고아 정리**: 같은 `(선수, 팀)` 쌍 중복 예약은 reconcile이 가장 오래된 것 하나만 유지. 죽은 팀을 가리키는 예약은 `serializeBoardDrafts`가 직렬화에서 제외하고 reconcile이 무시.

---

## 부록 — 제거된 규칙 (deprecated)

아래는 자동 팀 편성 시절의 규칙으로, 2026-06 리팩토링에서 코드와 함께 제거되었다. 참고용으로만 남긴다.

- **미도착(pending) 선수 제외**: `pending` 상태 자체가 제거됨. 세션 시작 시 전원 `waiting`.
- **혼복 "여자만" 실력 균형 (성별 인식 skillDiff)**: 혼복 지향 그룹에서 남자 후보 `skillDiff=0`·여자 후보만 확정 여성 평균과 균형을 보던 규칙. 2026-07 제거 — 혼복에서도 전원 실력을 본다(§2 skillDiff 참조). 같은 개편에서 skillDiff 자체도 평균 거리 → 스프레드 증가분으로 교체.
- **쌍 단위 동반 회피 (`pairHistory`·`W_PAIR`·`Σc²`)**: 두 선수의 누적 동반 횟수를 상대별 제곱해 벌점하던 규칙과 `pair_history` 테이블 클라이언트 조회, `recordTeam`(`src/lib/pairHistory.ts`). 2026-07 제거 — 조합의 정체성을 잃는 문제로 그룹 겹침 단위(`W_GROUP2/3/4`, §2)로 대체. DB `pair_history` 테이블·서버 누적도 `20260727090000`에서 삭제 완료.
- **자동편성 대기 선수 전용 (`excludePlaying:true`)**: 자동편성이 경기중 선수를 아예 제외하던 규칙. 2026-07 제거 — 팀당 1명까지 ghost 허용(§8).
- **혼복/빡겜 우선배치 강제(`force_mixed`/`force_hard_game`)**: 토글 액션·플래그 제거됨. 추천은 `W_ROTATE` 로 게임 타입을 자연 분산.
- **selectFour / 대기열 선발 우선순위 단계**: 대기열에서 한 번에 4명을 자동 선발하던 로직 제거. 보드에서 수동 구성 + `recommendTeammates` 추천이 기본이며, **팀 단위 점진적 자동편성은 §8 `autoFillTeammates`(추천 재평가 greedy)로 재도입**되었다(과거의 bulk selectFour와 다름).
- **다전략 후보 생성(`generateBulkTeamCandidates`)**: `coPlayerAvoidance` 포함 5전략, 보충 모드(supplement), `usedPlayerIds` 다양성, `team_candidates` 저장/`candidates_updated` 브로드캐스트 등 전부 제거.
- **가중치 프로필(`WEIGHT_PROFILES`)**: 위 다전략 후보 생성용 5개 프로필(`gameCountBalanced`/`newCombination`/`skillBalanced`/`mixedCountBalanced`/`waitTimePriority`) 상수. 소비자 전원 삭제로 코드에서 완전히 제거됨.
- **혼복 남자/여자 실력 유사성 별도 규칙**: 별도 `(mixedCount·10 + skillDiff)` 선발식 제거. 혼복 균등은 `W_MIXED` 가중치와 페어 편성 단계의 균형 점수로 흡수.
