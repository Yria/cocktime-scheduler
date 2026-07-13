# 팀 추천/편성 알고리즘 규칙

> **2026-06 리팩토링 반영**
> 자동 "팀 후보 생성"(`generateCandidateTeams` / `buildTeam.ts`, `generateBulkTeamCandidates`, 다전략 후보 생성,
> 매치 대기열, 팀 후보 크로스 클라이언트 동기화)은 **전부 제거됨(deprecated)**.
> 메인 기능은 **보드(자석 칠판) 수동 편성**이며, 알고리즘은 아래 세 순수 함수로 구성된다.
>
> | 함수 | 파일 | 역할 |
> |------|------|------|
> | `skillScore` / `rankCandidates` / `recordHistory` | `src/lib/teamSelection/rankCandidates.ts` | 후보 점수·정렬·동반 이력 누적 |
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
| 2 | **중복 회피** | `W_PAIR` | 같은 4명이 반복되지 않게 — 매번 새로운 조합 |
| 3 | **실력** | `W_SKILL` | 가장 약하게만 본다. **4명 안의 2v2 실력 균형은 `pairPlayers`가 따로 잡으므로** 선발 단계에서 실력을 앞세울 필요가 없다 |

> 이 우선순위는 `W_GAME > W_PAIR > W_SKILL` 로 코드(`RECOMMEND_WEIGHTS`·`DEFAULT_WEIGHTS`)에 반영돼 있다(7절·2절). 과거엔 `W_SKILL`이 최우선(20)이라 실력이 비슷한 사람끼리 반복해서 같은 경기에 뽑히는 부작용이 있었다.

### 용어 정의
- **팀**: 한 코트에서 경기하는 4명 전체
- **페어**: 팀 안에서 같은 편인 2명 (복식 파트너)
- **동반 이력(`pairHistory`)**: 두 선수가 **같은 경기에 함께 들어간 누적 횟수**. 같은 편(페어)뿐 아니라 상대팀으로 만난 경우도 포함하여, 한 경기의 4명 전체(6쌍)를 서로 +1 한다(`recordHistory`). 경기 **완료 시점**에만 누적한다.

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

`W_SKILL, W_PAIR, W_GAME, W_MIXED, W_WAIT` 5개.

기본값(`DEFAULT_WEIGHTS`): `W_GAME 10.0, W_PAIR 8.0, W_SKILL 0.67, W_MIXED 0, W_WAIT 0`. (우선순위 **경기수 > 중복 회피 > 실력** — 위 핵심 철학 참조. `DEFAULT_WEIGHTS`는 `rankCandidates`를 weights 없이 호출할 때의 폴백이며, 실제 추천/자동편성은 `RECOMMEND_WEIGHTS`(7절)를 쓴다.)

> `W_SKILL` 0.67: `skillScore` 범위가 등급(1~10, 폭 9)으로 바뀌며 실력차가 구 모델(1~3, 폭 2) 대비 4.5배 커졌다. 선발 단계 실력 기여를 종전 수준으로 유지하려 `3.0 / 4.5 ≈ 0.67` 로 보정했다. (`pairPlayers`의 `intraDiff`/`interDiff`는 상대 비교라 스케일 불변 → 가중치 조정 불필요.)

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
      + pairOverlap · W_PAIR
      + gameCount · W_GAME
      + mixedCount · W_MIXED
      - waitMinutes · W_WAIT
```

| 항 | 정의 | 방향 |
|----|------|------|
| `skillDiff` | 실력 균형 차이 (아래 **성별 인식** 규칙) | 작을수록 ↓ (실력 유사) |
| `pairOverlap` | confirmed **각각**과 함께 뛴 누적 동반 횟수(`pairHistory`)를 **상대별로 제곱해 합산**(`Σ c²`) | 적을수록 ↓ (안 뛴 상대 우선) |

> **동반 회피는 비선형(상대별 제곱)이다.** 한 상대와 c회 만났으면 그 상대에 대한 페널티는 `c²`(선형 `c`가 아님)이고, confirmed 전원에 대해 합산한다. → 특정 상대와 **반복**해 만날수록(2·3회) 페널티가 급격히 커져 "같은 2~3명" 반복 편성을 강하게 흩는다. 합계가 아니라 상대별로 제곱하므로(`(Σc)²` 아님), 여러 명을 한 번씩 만난 경우(각 1회)는 완만히 두고 한 명과 여러 번 만난 경우만 강하게 회피한다. 1회 만남은 `1²=1`로 저렴해 정상적인 경기수 균등을 해치지 않는다.
| `gameCount` | 절대 출전 판수 (`session_players.game_count`) (아래 3절) | 적을수록 ↓ (적게 뛴 사람 우선) |
| `mixedCount` | 누적 혼복 출전 횟수 | 적을수록 ↓ |
| `waitMinutes` | 대기 경과 분 = `(now − waitSince)/60000`, waitSince 없으면 0 | 클수록 ↓ (음수 반영) |

> `gameCount` 는 클수록 후순위라 **양수 가산**, `waitMinutes` 는 클수록 우선이라 **음수 부호**로 점수를 낮춘다.

#### `skillDiff` — 혼복은 "여자만" 실력 균형 (성별 인식)

혼복은 남녀 실력을 동시에 맞추기 어려워 **남자는 실력 무시하고 넣어도 되고, 여자만 서로 실력을 맞춘다**(기획). `confirmed`+후보가 **양성 혼합(혼복 지향)** 이면:

- **남자 후보** → `skillDiff = 0` (실력 균형 대상 아님, 실력이 달라도 점수 동일)
- **여자 후보** → `skillDiff = |skillScore(후보) − 확정된 여자들 평균 skillScore|` (여자끼리 균형, 확정 여자 없으면 0)

**단일 성별(남복/여복)** 그룹은 기존대로 `|skillScore(후보) − confirmed 전체 평균|`. (`confirmed`가 0명이면 skillDiff 항 자체가 없다 — 위 0명 공식 참조.)

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

## 4. 동반 이력 누적 — recordHistory

경기 완료 시 클라이언트 `pairHistory` 를 갱신한다.

- 같은 경기 4명(teamA + teamB) 그룹 전체의 **모든 쌍(6쌍)** 을 서로 +1 누적한다(같은 팀뿐 아니라 상대팀 포함).
- 누적 단일 지표로 직전·과거를 통합 판단한다 — 직전 경기도 완료 시 +1 되므로, 자주(그리고 최근에) 함께 뛴 상대일수록 `pairOverlap` 점수가 커져 자연히 회피된다.
- **점수 반영은 상대별 제곱**(`Σ c²`, 2절 참조): 누적 횟수 자체는 여기서 선형 +1 이지만, `rankCandidates` 가 이를 상대별로 제곱해 쓰므로 반복 상대일수록 회피가 급격히 세진다.
- 이력은 **세션 단위**다(`pair_history.session_id` 로 키잉·로드). 새 세션이 시작되면 0에서 다시 쌓인다.
- (기존의 별도 지표 `lastCoPlayers`·가중치 `W_COPLYR` 는 제거됨.)

> DB 측 `complete_match` RPC 도 클라이언트와 동일하게 **6쌍 전부**를 +1 누적한다(`20260611120000_pair_history_group.sql` 에서 팀 2쌍 → 그룹 6쌍으로 전환, 최신 `20260624020000` 도 동일). 클라이언트 `recordHistory` 와 규칙이 일치한다.

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
  - `excludePlaying:true`(자동편성 전용)면 경기중 선수도 풀에서 제외
  - 자석(`MagnetPosition`) 없는 선수는 제외 — 멤버십 commit(`attachAnchor`)이 자석을 전제로 하기 때문
- `ctx` = `pairHistory` / `lastGameType` / `playingIds`(코트 기반)

### 추천 가중치 (RECOMMEND_WEIGHTS)

`Weights` 5개 + 보드 특화 3개:

| 상수 | 값 | 의미 |
|------|---:|------|
| `W_GAME` | 10.0 | **경기수 최우선** — 적게 뛴 사람부터(절대 판수 `gameCount`) |
| `W_PAIR` | 8.0 | **중복 회피(2순위)** — 같은 4명으로 함께 뛴 누적(직전+과거 통합)의 **상대별 제곱**(`Σc²`, 2절)에 곱한다. 반복 상대일수록 급락, 같이 안 뛴 사람 우선 |
| `W_SKILL` | 0.67 | **실력은 후순위(3순위)** — 4명 안의 2v2 실력 균형은 페어 편성(`pairPlayers`)이 보정하므로 약하게만 본다. 등급(1~10) 스케일 보정값(3.0/4.5) |
| `W_MIXED` | 0 | 누적 혼복수는 로테이션(W_ROTATE)으로 대체 |
| `W_WAIT` | 1.0 | **오래 쉰(대기) 사람 강한 우선** — 연속 휴식 편차 완화(아래) |
| `W_ROTATE` | 6.0 | 로테이션 보너스(직전과 **다른** 타입으로 전환하는 후보) |
| `W_ROTATE_REPEAT` | 2.0 | 반복 페널티(직전과 **같은** 타입 반복) — 보너스보다 작게 |
| `W_GENDER` | 50.0 | 혼복(2남2녀) 목표에서 성별 초과(3명+) 후보 페널티 |
| `W_MIXED_COMPLETE` | 8.0 | 혼복 구조(남녀 혼합) 완성에 필요한 부족 성별 후보 보너스 |
| `W_PLAYING` | 30.0 | 경기중 후보 페널티(대기 선수 우선) |
| `W_FORCED` | 48.0 | "고정배치"로 잠근 그룹의 재편성 회피 — 잠근 직후 초기 페널티(`FORCED_WINDOW=6` 라운드에 걸쳐 0으로 선형 decay) |

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
5. **의도적 그룹 "고정배치" 재편성 회피 (`W_FORCED`, decay)**: 운영진이 그룹(구성 중)에서 **"고정배치" 버튼을 누르면** 그 시점의 그룹 멤버 전체를 🔒 잠금(`forcedIds`)하고, 그 그룹이 경기를 시작하면 잠긴 멤버 쌍을 "재편성 회피"로 기록한다(`forcedPairs`). 이후 추천에서 그 쌍이 다시 만나려 하면 `+W_FORCED × decay`(confirmed별 합산). **절대 금지가 아니라** 점수를 크게 올려 다른 후보가 우선되게 하고, **다른 경기가 지날수록**(세션 누적 배정수 `matchAssignCount` 경과) `FORCED_WINDOW` 라운드에 걸쳐 0으로 **선형 decay**(그 뒤 자연 복귀). 풀이 좁아 그 둘 말곤 후보가 없으면 페널티가 무력화되어 같이 들어갈 수 있다.
   - **트리거**: `toggleForced(teamId)` — "고정배치" 버튼을 누르면 `forcedIds = 현재 멤버 전체(anchor + ghost)`(드래그/+/추천 어떻게 모았든 그 시점 멤버). 다시 누르면 해제. 시각/코스트 전용이며 **실제 락 아님** — 멤버를 드래그로 빼면 `forcedIds ∩ 현재 멤버`로 자동 취소(🔒 사라짐).
   - **버튼 노출 조건**: 구성 중(2명+ 활성, 1명 비활성). **4명이라도 예약(ghost=경기중 빌려온 선수)이 끼면** 매칭 시작 불가이므로 시작 버튼 대신 **"고정배치"** 가 뜨고, 이때 잠그면 **예약 포함 4명 전원 락**(ghost도 🔒). 4명 전원이 anchor(예약 없음)면 매칭확정 버튼.
   - **UI**: 🔒 벡터 자물쇠 배지(anchor·ghost 모두). 버튼 라벨 "고정배치"↔"고정 해제"(잠금 시 인디고). 그룹박스의 "자동편성"(자동 채움) 버튼은 제거되어 **추천 모달 안 버튼**으로 이동(`autoFillTarget`).
   - **저장/동기**: 별도 컬럼/테이블 없이 `board_drafts` jsonb(`forcedIds`·top-level `forcedPairs`)에 함께 — 동기·영속은 기존 board_drafts 경로 재사용. decay 끝난 쌍은 경기 시작/로드 시 prune.
   - **휴식/경기중**: 잠긴 멤버가 경기 시작 시 코트로 가므로(playing) 자동 제외되고, 풀에 복귀하면 forced 페널티가 적용된다.

### RecommendContext 추가 입력

- `lastGameType: Record<string, GameType>` — `session_player.id` → 직전(또는 진행중) 게임 타입
- `playingIds: ReadonlySet<string>` — 현재 코트에서 경기중인 `session_player.id`
- (그 외 `pairHistory` 는 `RankContext` 와 공유)

### 점수 분해 디버그 (ScoreBreakdown)

- `RankedCandidate.breakdown`(`ScoreBreakdown`)에 항목별 기여도(가중치 적용 후 값)를 담는다: `skill`/`pair`/`game`/`mixed`/`wait`(base) + `rotate`/`gender`/`playing`(보드 특화). **합 = `score`**.
- 추천 다이얼로그(`RecommendTeammateDialog`) 헤더의 🐛 토글로 후보별 점수 분해 테이블(각 항목 + 합계 + %)을 표시한다. "왜 이 후보가 N%인가"를 추측 없이 바로 확인하는 용도.

---

## 8. 자동편성 — autoFillTeammates

보드 "팀 구성 중" 박스의 CTA 자리(멤버 4명 미만일 때)에 있는 **자동편성** 버튼이 빈 슬롯을 추천도 높은순으로 채운다.

### 핵심: 매 라운드 재평가 (greedy)

추천 점수는 "현재 확정 멤버가 누구냐"에 따라 매번 달라진다(실력 유사·동반 회피·로테이션·성별 균형 모두 `confirmed` 의존). 그래서 상위 N명을 한 번에 잘라 넣지 않고, **한 명을 뽑을 때마다 재평가**한다.

```
autoFillTeammates(confirmed, pool, ctx, count):
  반복 count회 (또는 pool 소진까지):
    1. recommendTeammates(confirmed, pool, ctx) → 최상위 1명 선택
    2. 그 1명을 confirmed에 추가, pool에서 제거
  → 뽑힌 후보를 추천된 순서대로 반환(풀이 모자라면 가능한 만큼만)
```

> 단순 "상위 N명 자르기"와 다르다: 먼저 들어간 후보가 다음 라운드의 동반 이력/성별 균형/로테이션 점수를 바꾸므로, 라운드마다 다음 1명이 재선정된다.

### 풀 구성 — 대기 선수만

보드 액션 `boardStore.autoFillTeam(teamId)`는 `buildRecommendData(..., { excludePlaying: true })`로 풀을 만든다 → **경기중 선수 제외, 대기 선수만**으로 채운다.

- picks는 전원 비경기중이라 `commitTeammates`에서 모두 anchor로 붙는다(ghost 미생성) → 4명이 채워지면 즉시 경기시작 가능.
- 채울 수(`count`) = `4 − 현재 멤버 수`. 대기 선수가 부족하면 채운 만큼만 두고 토스트로 안내(`N명만 채웠어요`), 0명이면 멤버 불변.

> 대비 — 다이얼로그(`RecommendTeammateDialog`)의 수동 추천은 `excludePlaying:false`(기본). 경기중 후보도 `W_PLAYING` 페널티로 하위 노출하되 선택 가능하며, 선택 시 ghost 예약이 된다.

---

## 9. 공통 규칙

### 동점 시 랜덤 선택 (다양성 확보)
- 페어 편성에서 `pairingScore` 가 완전히 동일한 최적 조합이 여러 개면 그중 **무작위**로 선택한다(`bestPairing`/`bestMixedPairing`).
- 매칭 결과 고착화를 막고, 세션이 진행될수록 더 다양한 조합이 만들어지도록 보장한다.
- `rankCandidates` 자체는 순수 함수(랜덤 없음)이며, 정렬은 안정 정렬로 동점 시 입력 순서를 유지한다.

### 보드 멤버십 불변식 (reconcile — `remoteDrafts.ts` / `boardStore.ts`)
팀 편성(`board_drafts`)과 코트 배정(`matches`)은 별도 권위로 비원자적으로 동기화되므로, 동시편집 레이스(유실된 dissolve, 핸드오프/탈취, 로스터 편입)로 멤버십이 어긋날 수 있다. 두 선행조건으로 막는다.

**(가) 편집은 반드시 한 명만** — `board_save_drafts`뿐 아니라 경기 RPC(`assign_match`/`complete_match`/`set_match_roster`)도 `board_assert_editor`(editor lease self-claim CAS)로 서버에서 게이팅한다(마이그레이션 `20260624020000`). 유효 lease를 보유하지 않은 낙관적 편집자/stale 기기의 코트 변경을 'not editor'로 거부하고, 거부된 기기는 `resyncFromServer`로 보기 전용으로 수렴한다.

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
- **혼복/빡겜 우선배치 강제(`force_mixed`/`force_hard_game`)**: 토글 액션·플래그 제거됨. 추천은 `W_ROTATE` 로 게임 타입을 자연 분산.
- **selectFour / 대기열 선발 우선순위 단계**: 대기열에서 한 번에 4명을 자동 선발하던 로직 제거. 보드에서 수동 구성 + `recommendTeammates` 추천이 기본이며, **팀 단위 점진적 자동편성은 §8 `autoFillTeammates`(추천 재평가 greedy)로 재도입**되었다(과거의 bulk selectFour와 다름).
- **다전략 후보 생성(`generateBulkTeamCandidates`)**: `coPlayerAvoidance` 포함 5전략, 보충 모드(supplement), `usedPlayerIds` 다양성, `team_candidates` 저장/`candidates_updated` 브로드캐스트 등 전부 제거.
- **가중치 프로필(`WEIGHT_PROFILES`)**: 위 다전략 후보 생성용 5개 프로필(`gameCountBalanced`/`newCombination`/`skillBalanced`/`mixedCountBalanced`/`waitTimePriority`) 상수. 소비자 전원 삭제로 코드에서 완전히 제거됨.
- **혼복 남자/여자 실력 유사성 별도 규칙**: 별도 `(mixedCount·10 + skillDiff)` 선발식 제거. 혼복 균등은 `W_MIXED` 가중치와 페어 편성 단계의 균형 점수로 흡수.
