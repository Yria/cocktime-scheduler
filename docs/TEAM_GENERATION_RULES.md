# 팀 추천/편성 알고리즘 규칙

> 사용자 흐름·용어는 [팀매칭 기획](TEAM_MATCHING_SPEC.md), 구현 문제·정책 결정 사항은 [정합성 검토](TEAM_MATCHING_REVIEW.md)를 먼저 참고한다. 이 문서는 공식과 가중치의 상세 기준이다.
> 2026-09-07 문서 대조 반영. 아래 과거 시뮬레이션·프로덕션 수치는 튜닝 당시의 기록이며 이번 검토에서 재측정하지 않았다.
> 같은 날 새 만남 보정(`W_NEW_ENCOUNTER=12`)을 추가했다. 이 변경의 전후 비교는 [2,400세션 합성 검증](TEAM_MIXING_VALIDATION.md)에 별도로 기록했다.

> **2026-06 리팩토링 반영**
> 자동 "팀 후보 생성"(`generateCandidateTeams` / `buildTeam.ts`, `generateBulkTeamCandidates`, 다전략 후보 생성,
> 매치 대기열, 팀 후보 크로스 클라이언트 동기화)은 **전부 제거됨(deprecated)**.
> 현재는 **보드 수동 구성·추천·자동 채움·회원 파티**를 지원한다. 아래 함수가 입력 구성·선발·페어 편성을 담당한다. 추천은 현재 시각, 동점 페어 선택은 난수에 의존한다.
>
> | 함수 | 파일 | 역할 |
> |------|------|------|
> | `skillScore` / `rankCandidates` | `src/lib/teamSelection/rankCandidates.ts` | 후보 점수·정렬 |
> | `matchRowsToGroupHistory` | `src/lib/supabase/transformers.ts` | 완료 매치 → 그룹 이력(4인 묶음) 파생 |
> | `determineGameType` / `pairingScore` / `pairPlayers` | `src/lib/teamSelection/pairPlayers.ts` | 게임 타입 결정·2v2 페어 편성 |
> | `recommendTeammates` / `autoFillTeammates` | `src/lib/teamSelection/recommendTeammates.ts` | 보드 빈 슬롯 추천(랭킹 + 보드 특화 가산) · 추천도순 greedy 자동편성 |
> | `buildRecommendData` | `src/lib/board/recommendPool.ts` | 보드 추천/자동편성 공통 입력(confirmed·pool·ctx) 빌드 |
> | `selectMemberParty` | `src/lib/board/memberParty.ts` | 버튼을 누르고 있는 가용 회원 중 4명 선발 + 2v2 페어 편성 |
>
> CLAUDE.md 프로젝트 규칙상 이 문서는 위 소스 변경 시 **동기화 대상**이다. 공식/가중치는 코드와 일치해야 한다.

## 개요

코트에 들어갈 **4명**을 구성하고, 그 안에서 두 **페어**(2v2)로 편성하는 데 쓰이는 점수 로직.
관리자가 보드에서 멤버를 채울 때 **후보 순위 추천·자동 채움·페어 편성**을 제공한다. 운영진 전원이 경기중일 때는 버튼을 누르고 있는 회원들끼리도 같은 알고리즘으로 4명을 선발한다.

### 핵심 철학 — "4명을 뽑는다 / 2v2는 나중에 나눈다"

이 서비스가 추천·자동편성으로 하는 일은 **"같은 경기를 할 4명"을 고르는 것**이다. 그 4명을 2v2로 어떻게 가를지는 별도 단계(`pairPlayers`, 6절)가 실력 균형(`interDiff`/`intraDiff`)으로 책임진다. 두 단계의 역할이 다르므로 우선순위도 다르다.

**선발의 목표 — 참여 형평·재결성 회피·실력 범위를 함께 평가**

| 축 | 항 | 가중치 | 이유 |
|---|---|---|---|
| 1 | **경기수** | `W_GAME` | 적게 뛴 사람부터 — 모두가 비슷한 판수를 뛰는 게 가장 중요 |
| 2 | **재결성 회피** | `W_GROUP2/3/4` | 과거 경기와 겹치는 인원이 많을수록 비용 증가. 과거 경기 1건의 2인 겹침은 8점이지만 여러 건이면 합산 |
| 3 | **실력** | `W_SKILL` | 선택된 멤버의 등급 범위를 넓히는 폭의 제곱에 비용. 2v2 균형은 `pairPlayers`가 별도로 평가 |
| 4 | **새 만남** | `W_NEW_ENCOUNTER` | 아직 못 만난 선택 멤버와 새 동반 쌍을 만드는 만큼 보너스. 첫 선발은 현재 풀의 미만남 비율 비교 |

> **절대적인 선발 우선순위가 아니라 합산 비용이다.** 단위 비용은 `W_GROUP2(8) < W_GAME(10) < W_GROUP3(24) < W_PLAYING(30) < W_GENDER(50) < W_GROUP4(60)`이다. 실력 비용 `1.5·k²`는 k≤2일 때 10보다 작고 k=3부터 크다. k=6은 54, k=7은 73.5다. 이력 건수·대기시간·로테이션까지 더하므로 판수나 재결성 회피가 항상 우선하지 않는다. 아래 튜닝 근거의 ‘1판을 못 뒤집는다’는 **다른 조건이 같고 이력 1건의 비용만 비교할 때**로 한정한다([검토 R4](TEAM_MATCHING_REVIEW.md#r4-경기수-우선과-재결성-금지를-절대-규칙으로-설명할-수-없음)).

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
- **하위호환**: `skillScoreOf`는 구 스킬 형태(O·V·X/상·중·하)의 판독 가능한 값 평균을 `round(1 + (avg−1)/2 × 9)`로 환산한다. 정상 구 값의 환산 범위는 1~10이다. 함수 자체에 별도 clamp는 없고 숫자 `grade`는 그대로 반환한다. 판독 불가는 0이며, 페어 계산이 이를 실력 0으로 쓰는 차이는 [검토 R8](TEAM_MATCHING_REVIEW.md#r8-미등급-선수의-의미가-단계마다-다름)에 기록했다.

---

## 2. 후보 점수 — rankCandidates

이미 선택된 N명(`confirmed`)이 있을 때 풀(`pool`)의 후보를 **점수 오름차순(낮을수록 좋음)** 으로 반환한다. 랜덤은 없지만 대기시간 계산은 `Date.now()`에 의존하므로 같은 입력의 비용이 시각에 따라 달라질 수 있다. 풀 구성은 호출자 책임이다. 여기서 `confirmed`는 추천 계산의 선택 멤버이며 보드의 매칭확정(`confirmedMs`)과는 다르다.

### 가중치 (Weights)

`W_SKILL, W_SKILL_EXP, W_GROUP2, W_GROUP3, W_GROUP4, W_NEW_ENCOUNTER, W_GAME, W_MIXED, W_WAIT` 9개. `W_NEW_ENCOUNTER`는 생략하면 0이다.

기본값(`DEFAULT_WEIGHTS`): `W_GAME 10.0, W_GROUP2 8.0, W_GROUP3 24.0, W_GROUP4 60.0, W_NEW_ENCOUNTER 0, W_SKILL 1.5, W_SKILL_EXP 2, W_MIXED 0, W_WAIT 0`. (재결성 회피는 겹침 수에 따라 경기수 1판 아래(`W_GROUP2`)부터 위(`W_GROUP3·4`)까지 걸친다 — 위 핵심 철학 참조. `DEFAULT_WEIGHTS`는 `rankCandidates`를 weights 없이 호출할 때의 폴백이며, 실제 추천/자동편성은 `RECOMMEND_WEIGHTS`(7절)를 쓴다.)

> 그룹 가중치 (8, 24, 60) 근거(과거 200시드 시뮬 스윕): 초안값 (2, 12, 40)은 2인 겹침 회피가 구 `Σc²`의 1/4로 약해져 순후퇴했다(3인 겹침 경기 3.9% vs 구 방식 1.3%). `W_GROUP2 8`은 구 방식의 1회 동반 비용과 같으며 한 건의 비용은 한 판 비용(10) 미만이다. 여러 건 누적 시에도 판수 우선을 지킨다는 불변식은 아니다. `W_GROUP3 24`는 3인 겹침을 줄인 주된 조정값(12→24에서 3.9%→0.7%)이었다. 해당 실험에서 재결성 0%, 3인 겹침 0.7%, 2인 겹침 67%, 고유 동반 16.2명, 판수 표준편차 +0.04를 기록했다.

> `W_SKILL` 1.5 · `W_SKILL_EXP` 2 (2026-07-29 개편 — **확장폭의 제곱**): 실력 벌점 = `1.5 × k²`(k = 밴드 확장폭). k=1→1.5, k=2→6, k=3→13.5, k=4→24, k=5→37.5, k=6→54. **k≤2는 경기수 1판(`W_GAME` 10) 아래라 여전히 경기수 우선**이고, k=3부터 넘어선다 — "경기수 > 실력" 철학을 지키면서 큰 확장만 초선형으로 배제한다.
>
> **왜 선형(구 3.0k)을 버렸나**: 구 선형은 k=6이 18(=1.8판)에 불과해 판수 2판 차이에 밀렸고, 그래서 "많이 벌어진 팀"이 그대로 편성됐다. 밴드가 한번 벌어지면 그 안의 후보는 전부 0점이라 **이후 슬롯의 실력 심사가 통째로 꺼진다** — 남녀 등급 분포가 어긋난 로스터(예: 세션 73 남 평균 6.7 / 여 3.8)의 혼복은 2남2녀가 강제되어 시드 2명만으로 밴드가 벌어지므로, 혼복 스프레드가 동성 경기의 절반밖에 개선되지 않았다(2026-07-28 실로그 감사 — `docs/MATCH_LOG_ANALYSIS.md` §4b). 제곱은 "벌어진 밴드를 사후에 메우는" 대신 **처음부터 벌어지지 못하게** 만든다.
>
> 300시드 × 로스터 3종(A 세션73 M18/F9 · B 균형 M12/F12 · C 여성소수 M20/F5) 스윕 근거: 혼복 스프레드 A 4.49→4.11 · B 3.07→2.92 · C 5.14→4.37, 전체 3.70→3.39, `interDiff` 1.33→1.15(페어 균형도 개선), **판수 형평 비용 gcStd +0.00**(0.54 유지), 3인 겹침 0.4→0.8%(reunion4 0% 유지). 같은 스프레드를 선형 `W_SKILL 6.0`으로 달성하면 gcStd +0.02·interDiff 1.26으로 열위 — 제곱이 파레토 우월. `W_SKILL 2.0`(k²)은 더 타이트하지만(혼복 3.95) 3인 겹침이 로스터 C에서 2.4%까지 올라 보류.
>
> **기각된 대안 — 혼복 전용 실력 배수**(`targetMixed`일 때 skill 항 ×N): 혼복만 겨냥하면 동성 경기의 재결성 비용 없이 개선될 것으로 봤으나, 배수를 키우면 혼복 자체가 실력 벌점을 안고 회피되어 **혼복 비중이 46%→36%(×4)로 떨어진다**. 여성이 소수인 로스터에서 여성 출전 기회를 깎는 부작용이라 채택하지 않았다.

> **제거됨(deprecated)**: 가중치 프로필 상수 `WEIGHT_PROFILES`(자동 다전략 후보 생성용 5개 프로필 — `gameCountBalanced`/`newCombination`/`skillBalanced`/`mixedCountBalanced`/`waitTimePriority`)는 소비자가 전부 삭제되어 **코드에서 완전히 제거**되었다.
> 현재 유지되는 가중치는 `recommendTeammates` 의 `RECOMMEND_WEIGHTS`(7절)와 `rankCandidates` 내부 기본값 `DEFAULT_WEIGHTS` 뿐이다.

### 점수 공식 — computeScore

**confirmed가 0명일 때** (`rankCandidates`의 기본 비용): 판수 + 혼복수 + 대기시간 + 새 만남 비용을 반영. 실제 추천·자동편성은 여기에 `recommendTeammates`의 후보 본인 로테이션·경기중 비용도 더한다.
```
score = gameCount · W_GAME + mixedCount · W_MIXED - waitMinutes · W_WAIT + encounterCost
```

**confirmed가 1명 이상일 때**:
```
score = skillDiff · W_SKILL
      + regroup2 · W_GROUP2 + regroup3 · W_GROUP3 + regroup4 · W_GROUP4
      + encounterCost
      + gameCount · W_GAME
      + mixedCount · W_MIXED
      - waitMinutes · W_WAIT
```

| 항 | 정의 | 방향 |
|----|------|------|
| `skillDiff` | 후보 합류 시 팀 등급 밴드(min~max)의 **스프레드 증가분의 `W_SKILL_EXP`제곱** (아래 정의) | 작을수록 ↓ (실력 유사) |
| `regroup2/3/4` | 후보가 속했던 **과거 경기 4인 그룹** G마다 `k = \|G ∩ confirmed\|`를 세어, 후보 합류로 새 팀이 그 그룹과 **2명(k=1) · 3명(k=2) · 4명(k=3)** 겹치게 되는 그룹 수 | 적을수록 ↓ (재결성 회피) |
| `encounterCost` | 아직 못 만난 선택 멤버 수 × `-W_NEW_ENCOUNTER`. 첫 선발은 현재 다른 후보 중 미만남 비율 × `-W_NEW_ENCOUNTER` | 새 만남이 많을수록 ↓ |
| `gameCount` | 합류·휴식 복귀 보정이 포함된 추천용 판수 (`session_players.game_count`, 아래 3절) | 적을수록 ↓ |
| `mixedCount` | 현재 서버는 혼복 완료 시 남성만 증가. 현재 가중치는 0 | 가중치가 양수일 때 적을수록 ↓ |
| `waitMinutes` | 대기 경과 분 = `(now − waitSince)/60000`. waitSince 없으면 0, **`playingIds`에 든 경기중 후보도 0**(2026-08, 3절·7절) | 클수록 ↓ (음수 반영) |

> **재결성 회피는 그룹 겹침 단위다(2026-07 개편).** 과거 경기 한 건에서 후보 합류 후 2명이 겹치면 8, 3명이면 24, 4명이면 60을 가산한다. 같은 조합으로 여러 번 경기했으면 경기 건수만큼 더한다. 이 비용은 다른 항목과 합산되며 편성을 금지하지 않는다.
>
> `gameCount` 는 클수록 후순위라 **양수 가산**, `waitMinutes` 는 클수록 우선이라 **음수 부호**로 점수를 낮춘다.

#### 새 만남 보정 — 만난 사람의 범위 확대(2026-09-07)

‘만남’은 같은 경기의 4명으로 상대편도 포함한다. `groupHistory`와 현재 코트의 `ongoingGroups`에서 동반 여부를 파생한다. 과거 그룹 벌점은 횟수를 누적하지만 새 만남 보너스는 아직 없는 동반 쌍의 수를 센다. 과거 DB의 `pair_history`를 복구하거나 별도 저장하지 않는다.

- 선택 멤버 1~3명이 있으면 후보가 아직 못 만난 선택 멤버 한 명당 **-12점**. 최대 -36점이다.
- 첫 선발은 현재 다른 후보 중 아직 못 만난 사람의 **비율 × -12점**. 현재 없는 상대는 분모에서 제외하고, 다른 후보가 없으면 0이다.
- 이미 모두 만났으면 이 보너스는 0이고 기존 반복 회피가 계속 작동한다. 보너스는 매 후보 선택 뒤 다시 계산한다.
- 자동편성의 경기중 인원 상한에 걸린 후보는 첫 선발의 미만남 비율 계산에서도 제외한다.
- 당일 세션만 기억한다. 새 만남을 늘리는 합산 비용이며, 모든 사람이 반드시 만나는 일정이나 전체 최적해를 보장하지 않는다.

6가지 합성 모임 × 200시드 × 기존/보정 비교에서, 24명 균형 모임의 미만남 쌍은 74.12→47.05, 1인당 고유 동반자는 16.82→19.08명으로 개선됐다. 실력 양분 모임은 편 간 등급 차이가 커지는 절충도 있었다. [방법·전체 수치·수용 기준](TEAM_MIXING_VALIDATION.md)을 참고한다.

#### `skillDiff` — 스프레드 증가분의 제곱 (2026-07 개편 → 2026-07-29 제곱화)

```
k         = max(0, min(confirmed 등급) − 후보 등급, 후보 등급 − max(confirmed 등급))
skillDiff = k > 0 ? k ** W_SKILL_EXP : 0        // W_SKILL_EXP 미지정이면 1(선형)
```

- **밴드 안 후보는 전부 0**: 후보 등급이 confirmed의 min~max 사이면 벌점 없음(동일 취급).
- **밴드를 넓히는 후보만 벌점**: 넓힌 폭의 제곱. `confirmed` 1명일 때 k는 `|후보 − 확정|`.
- **제곱인 이유**: 작은 확장은 경기수에 양보하고 큰 확장은 강하게 막는 비대칭이 필요하다. 선형에서는 큰 확장도 판수 몇 판으로 상쇄돼 벌어진 밴드가 만들어졌고, 밴드가 벌어진 뒤에는 "밴드 안 전부 0" 규칙 때문에 남은 슬롯의 실력 심사가 꺼졌다(위 `W_SKILL` 항 참조).
- **성별 무관**: 혼복(남녀 혼합) 지향 그룹에서도 남녀 구분 없이 4명 전원의 실력을 본다. (`confirmed`가 0명이면 skillDiff 항 자체가 없다 — 위 0명 공식 참조.)
- **미등급(판독 불가 → `skillScore` 0)은 "정보 없음"**: confirmed 쪽 미등급은 밴드 계산에서 제외(0이 밴드 하한을 무너뜨려 하방 판별이 꺼지는 것 방지)하고, 미등급 후보 본인도 벌점하지 않는다.

> **왜 평균 거리가 아닌가**: 구 방식(`|후보 − confirmed 평균|`)은 이미 벌어진 팀(예: {2,8} — 평균 5)에서 중간 등급(5)을 항상 '최적합(0)'으로 판정해, **중간 등급이 이질 팀의 만능 필러로 흡수되는 비대칭**이 있었다(중간 등급 회원이 균질한 경기(빡겜)를 못 잡는 구조적 원인, 2026-07 경기로그 분석). 스프레드 증가분은 벌어진 팀을 중간 등급으로 가리는 대신, 팀이 처음부터 벌어지는 것 자체를 막는다.
>
> **혼복 "여자만 균형" 규칙 제거**: 구 규칙(혼복 목표 시 남자 후보 skillDiff=0, 여자만 확정 여성 평균과 균형)은 2026-07 기획 변경으로 제거됐다 — 혼복 로테이션이 강제되는 구조에서 경기의 절반가량이 남성 실력 무심사로 편성되어 스프레드를 키우는 주범이었다(혼성 경기 평균 스프레드 4.27 vs 동성 3.84). 이제 혼복에서도 최대한 실력을 맞춘다.

---

## 3. 참여 판수 — gameCount + 합류 시점 평균 보정

**보정 판수(`gameCount`)** 에 `W_GAME`을 곱해 참여 비용을 계산한다. 완료 경기마다 +1이지만 합류·복귀 보정으로도 증가하므로 실제 출전 횟수와 동일하지 않다. 다른 비용이 같으면 이 값이 작은 선수가 우선한다.

> **deficit(기대 경기수 비례) 모델은 제거됨.** 이전에는 `joinedAtMatch`/`totalMatchCount` 기반 `eligibleRounds × playProbability − gameCount` 로 적자를 계산했으나, 합류 시점 평균 보정(아래)으로 단순화하면서 폐기했다. `joined_at_match` 컬럼·`totalMatchCount`/`allSessionPlayers` 컨텍스트는 더 이상 점수 계산에 쓰이지 않는다.

### 늦참자 · 휴식 복귀자 보정 — 합류 시점 평균 판수 + 대기시간 리셋

목적은 늦참·휴식 동안 판수가 정체되어 과도하게 우대되는 현상을 줄이는 것이다. **참가 가능한 상태로 합류하는 시점**에 판수를 당시 기존 참가자 평균 이상으로 맞추고 대기시간을 다시 시작한다. 2026-09-07 보완 SQL 기준이며 운영 DB에는 아직 적용하지 않았다([검토 R5](TEAM_MATCHING_REVIEW.md#r5-합류-보정의-활성-평균과-적용-시점이-불완전)).

```
game_count  = GREATEST(game_count, 참가자 평균 판수)
참가자 평균 판수 = COALESCE(ROUND(AVG(game_count)), 0)
  -- 같은 세션의 기존 waiting/playing 선수. 본인·휴식 제외, 콕 체크 ON이면 미확인 제외.
  -- 완료 판수 + 이전 보정값 기준. 진행 중인 한 판은 추가하지 않는다.
wait_since  = now()  -- 대기시간(W_WAIT) 누적도 합류 시점부터 새로 시작
```

- **콕 체크 ON**: `set_cock_checked` RPC의 최초 확인을 합류 시점으로 삼는다. 미확인 상태로 명단에 등록한 시점에는 보정하지 않는다. 이미 확인된 선수의 재확인은 판수·대기시간을 바꾸지 않는다.
- **콕 체크 OFF**: `session_players` 신규 INSERT에서 보정한다. 운영진 추가·일정 참가 등 추가 경로에 공통 적용한다. 기존 행의 upsert·중복 추가는 재보정하지 않으며, OFF 상태의 콕 확인도 판수·대기시간을 바꾸지 않는다. 확인된 상태로 새 행을 넣는 경로는 ON에서도 INSERT 때 보정한다.
- **ON → OFF 전환**: 기존에 확인된 대기/경기 중 참가자의 평균을 한 번 계산해 미확인 대기자에게 적용한다. 휴식자는 복귀할 때 보정한다. OFF 설정을 다시 저장하는 것만으로는 재보정하지 않는다.
- **휴식 복귀**: `set_player_resting(p_resting=false)` RPC가 같은 보정을 한다. 휴식 진입 시 `wait_since=NULL`이고 `recommendPool`에서 제외한다. `arrange`는 휴식 자석을 숨기지 않고 맨 뒤에 정렬한다. 경기 수정의 예외 경로는 [검토 R1](TEAM_MATCHING_REVIEW.md#r1-경기-수정이-일반-편성의-참여-조건을-우회) 참조.
- `GREATEST`는 기존 판수를 깎지 않는다는 뜻이다. 평균 자체는 올림이 아닌 **반올림**이다.
- 예: 기존 참가자의 판수가 `2, 3, 3, 4`라면 늦참자는 추천용 판수 `3`으로 시작한다. 예비팀 소속도 기존 참가자 평균에는 포함된다. 평균 보정이 이후의 출전 순서까지 보장하는 것은 아니며 실제 완료 경기 기록은 별도로 유지된다.

구현: [늦참 보정 SQL](../supabase/migrations/20260907040000_late_join_game_count.sql). 검증: [로컬 PostgreSQL 테스트](../supabase/tests/late_join_game_count.test.mjs).

수학적 보장과 한계는 [늦참 평균 보정 검증](TEAM_MATCHING_MATH.md)에 정리했다. 신규 참가자 오차는 평균 대비 최대 0.5판(판수 비용 5점), 상태 변화 없는 반복 합류의 반올림 기준은 불변이다. 완료 직전/직후의 합류 기준은 최대 1판 차이가 나며, 그룹 이력 등 다른 비용이 달라 전체 추천 순서는 평균 보정만으로 보장하지 않는다.

> `game_count` 는 `session_players.game_count` 에 대응하며, 매치 완료(`complete_match` 계열 RPC) 시 +1 증가한다. `wait_since` 는 대기 진입(경기 완료·휴식 복귀·콕확인) 시각으로, `W_WAIT`(7절) 의 대기 우선도 기준이다.
>
> **경기 배정(`assign_match`)은 `wait_since` 를 갱신하지 않는다.** 그래서 경기중인 선수는 코트에 서 있는 내내 대기 경과가 계속 쌓인다 — 프로덕션 실측(23세션, 편성 시점 후보 12,184건)으로 경기중 후보의 대기 중앙값 **12.7분** vs 대기 후보 **3.5분**. 점수 쪽에서 `rankCandidates` 가 `playingIds` 로 대기 항을 끄므로(2026-08) DB 는 그대로 둔다 — 배정 시 리셋을 넣어도 그 값은 `playing` 인 동안에만 읽히고 완료 시 덮어써져, 이 가드가 있으면 점수에 도달하지 못한다.

---

## 4. 그룹 이력 누적 — groupHistory

경기 **완료 시점**의 4인 묶음을 그룹 이력에 추가한다. 쌍 단위 클라이언트 누적(`recordTeam`·`src/lib/pairHistory.ts`)과 `pair_history` 테이블 조회는 폐기됨(2026-07).

- **원천 = 완료된 `matches`**: 초기 로드(`fetchSessionSnapshot`)가 진행중+완료 매치를 함께 받아 완료분을 그룹 이력으로 파생하고(`matchRowsToGroupHistory`), 세션 중에는 `match_completed` 처리(`sessionBroadcastHandlers.handleMatchCompleted`)가 4인 묶음을 append 한다. 편집자 기기는 완료 RPC 직후 로컬 디스패치로 즉시 반영되어 다음 추천에 최신 이력이 쓰인다.
- **resync catch-up**: `resyncFromServer` 가 완료 매치의 4인 구성을 병렬 재조회(`dbLoadCompletedMatchTeams`)해 **matchId 집합 기준으로 병합**(`mergeGroupHistory` — 서버 권위 + 스냅샷 이후 로컬 선반영분 보존, append 쪽도 matchId dedup) — broadcast 유실·편집권 이양 후에도 추천/자동편성이 최신 재결성 이력을 보고, "resync 교체 직후 같은 매치 broadcast 도착 → 중복" 레이스가 없다. 각 항목은 `{matchId, members}` 이며 선수 삭제(FK SET NULL)로 members 가 4명 미만일 수 있다.
- 직전·과거를 같은 가중치로 판단한다. 직전 경기도 완료 시 추가하지만, 최근성 가중이나 시간 감쇠는 없다. 해당 겹침의 완료 경기 건수가 많을수록 비용이 커진다.
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

`rankCandidates`/`recommendTeammates`는 풀을 인자로 받기만 하고 구성은 호출자 책임이다. 추천 다이얼로그 훅(`useTeammateRecommendations`), 자동편성 액션(`boardStore.autoFillTeam`), 회원 파티(`selectMemberParty`)는 입력 구성을 공통 순수 함수 `buildRecommendData`로 일원화한다.

- `confirmed` = 팀/시드 멤버 + (다이얼로그) 진행 중 다중선택분
- `pool` = 세션 전체 − 확정 멤버 − 휴식(`resting`) − 콕 체크 on의 미확인 선수 − **자석 없는 선수** − 다른 보드 팀 anchor
  - `excludePlaying:true`면 코트 기준 경기중 선수를 풀에서 제외 (회원 파티에서 사용, 운영진 자동편성은 빈 슬롯에 여러 명 예약 가능, 8절)
  - `excludeReserved:true`(자동편성·회원 파티)면 **다른 팀에 ghost 예약된 선수** 제외 — 이중 예약 방지
  - 자석(`MagnetPosition`) 없는 선수는 제외 — 멤버십 commit(`attachAnchor`)이 자석을 전제로 하기 때문
- `ctx` = `groupHistory` / `ongoingGroups` / `lastGameType` / `playingIds`(코트 기반)

### 추천 가중치 (RECOMMEND_WEIGHTS)

`Weights` 9개(선택 필드 `W_SKILL_EXP`·`W_NEW_ENCOUNTER` 포함) + 보드 특화 5개:

| 상수 | 값 | 의미 |
|------|---:|------|
| `W_GAME` | 10.0 | **판수 형평** — 보정 판수 `gameCount`가 적을수록 우대 |
| `W_GROUP2` | 8.0 | **재결성 회피(약)** — 과거 경기 1건의 2인 겹침 비용. 1건은 1판(10) 미만, 2건은 16으로 초과 |
| `W_GROUP3` | 24.0 | **재결성 회피(중)** — 과거 그룹과 3명 겹침(3명 유지+1명 교체). 경기수 1판을 훌쩍 넘어서는 회피 |
| `W_GROUP4` | 60.0 | **재결성 회피(강)** — 과거 그룹 4명 완전 재결성. `W_PLAYING`(30)·`W_GENDER`(50)보다 커서 "재결성될 바엔 경기중 ghost를 데려온다" |
| `W_NEW_ENCOUNTER` | 12.0 | **새 만남** — 미만남 선택 멤버 한 명당 -12. 첫 선발은 현재 후보 풀의 미만남 비율 × -12 |
| `W_SKILL` | 1.5 | **실력 범위** — 스프레드 증가분(밴드 확장)의 제곱에 곱함. 2v2 균형은 `pairPlayers`가 별도 평가 |
| `W_SKILL_EXP` | 2 | 확장폭의 **제곱** — 벌점 `1.5·k²`. k≤2는 경기수 1판 아래(경기수 우선), k=3부터 넘어선다(2절 참조) |
| `W_MIXED` | 0 | 누적 혼복수는 로테이션(W_ROTATE)으로 대체 |
| `W_WAIT` | 1.0 | **오래 쉰(대기) 사람 강한 우선** — 연속 휴식 편차 완화(아래). 경기중 후보는 대기 항 0. **상한 없음**(아래 한계) |
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
4. **대기시간 (`W_WAIT`, 2절 base에서 반영)**: 대기 경과 분에 비례해 비용을 낮춘다(`−waitMinutes·W_WAIT`). 다른 비용이 같으면 오래 기다린 선수가 우선한다. 같은 판수라도 재결성·실력·로테이션 차이가 있으면 출전을 보장하지 않는다. `waitSince`는 경기 완료·휴식 복귀·콕 확인·경기 수정으로 이탈할 때 갱신된다.

   > **경기중 후보는 대기 항이 0이다(2026-08).** `assign_match`가 `wait_since`를 리셋하지 않아 이 가드가 없으면 경기 시간이 대기로 계산된다. 경기 중 비용 30에서 아직 완료되지 않은 한 판 비용 10을 빼는 단순 비교는 20이지만, 실제 후보 간 총비용 차이는 대기자의 대기시간·이력·판수 등에 따라 달라진다. 모달에서 비용을 해제하는 아래 예외도 구분한다.
   >
   > **알려진 한계 — 상한 없음.** 과거 실측(편성 시점 대기 후보 4,849건)에서는 대기 비용이 단독으로 `W_GAME`(10)을 넘는 후보가 16.5%, `W_GROUP3`(24) 초과 1.4%, `W_PLAYING`(30) 초과 0.9%, `W_GROUP4`(60) 초과 3건(max 63분)이었다. 재결성은 금지가 아닌 비용이라 대기로 상쇄될 수 있다. 경기 순번으로 단위를 바꾸는 것만으로 상한이 생기지는 않으며, 상한·단계 우선순위는 별도 정책이 필요하다.
   >
   > 또한 `complete_match`가 같이 끝난 4명의 `wait_since`를 **동일 타임스탬프**로 세팅하므로(실측: 대기 시각이 있는 398명 중 362명이 다른 선수와 정확히 같은 값, 클러스터 크기 4·8·12·16) 이 항은 **직전에 함께 뛴 4인을 서로 가르지 못한다**. 안정 정렬이라 그 동점은 풀 순서로 깨진다.
> **비(非)스코어 UI 요소 — 생성자 표시**: 팀 박스 라벨에 그 그룹에 사람을 넣은 편집자 이름을 `· by OO`로 표시한다(`DraftTeam.createdBy` — 2명 묶는 시점 기록, 이후 새 멤버를 추가한 편집자로 갱신. `sessionStore._myName` 스냅샷). 점수와 무관한 메타 정보이며, `board_drafts` jsonb(`createdBy`·`confirmedMs` 매칭확정 시각)에 함께 실려 기존 동기·영속 경로를 재사용한다.

### 수동 추천 모달의 경기중 비용 해제 예외

`useTeammateRecommendations`는 기본 비용을 후보 집합의 상대 적합도 0~100%로 바꾼다. **대기 후보 중 10% 이상이 없으면** `W_PLAYING: 0`으로 추천을 다시 계산한다. 자동편성·회원 파티는 이 훅을 거치지 않으므로 이 예외를 적용하지 않는다. 모달 순위와 자동편성 결과를 같다고 보장할 수 없다([검토 R7](TEAM_MATCHING_REVIEW.md#r7-추천-화면과-자동편성의-점수-정책이-다름)).

### RecommendContext 추가 입력

- `lastGameType: Record<string, GameType>` — `session_player.id` → 직전(또는 진행중) 게임 타입
- `playingIds: ReadonlySet<string>` — 현재 코트에서 경기중인 `session_player.id`. `W_PLAYING` 페널티와 **대기 항 차단**(3절) 두 곳에 쓰인다. `RankContext` 에도 선택 필드로 있어 `rankCandidates` 단독 호출에서도 가드가 걸린다
- `ongoingGroups?: readonly (readonly string[])[]` — 현재 코트의 4인 집합. 새 만남 판단에만 사용하며 완료 경기 벌점에는 미리 더하지 않는다. `groupHistory`와 함께 `RankContext`에서 공유한다.
- **복구 누락:** 초기 로드와 시작·완료 이벤트는 `lastGameType`을 채우지만 `resyncFromServer`는 현재 이를 복구하지 않는다([검토 R3](TEAM_MATCHING_REVIEW.md#r3-재연결-복구에서-직전-경기-유형이-누락)).

### 점수 분해 디버그 (ScoreBreakdown)

- `RankedCandidate.breakdown`(`ScoreBreakdown`)에 항목별 기여도(가중치 적용 후 값)를 담는다: `skill`/`group`/`encounter`/`game`/`mixed`/`wait`(base) + `rotate`/`gender`/`playing`(보드 특화). **합 = `score`**.
- 추천 다이얼로그 헤더의 🐛 토글로 분해표를 표시한다. `새 만남`·`대기`·`혼복수` 열까지 추가해 계산 항목을 모두 표시한다. 각 열의 소수점 표시 반올림 외에는 총점과 일치한다([검토 R9](TEAM_MATCHING_REVIEW.md#r9-추천-디버그-표의-표시-항목-합과-총점이-다름)). %는 현재 후보 집합 안의 상대값이다.

---

## 8. 자동편성 — autoFillTeammates

**추천 팀원 모달 하단의 자동편성 버튼**이 빈 슬롯을 한 명씩 채운다. 새 팀·자유 선수 시드·기존 팀에서 사용할 수 있다. 구성 중 팀 박스의 CTA는 자동편성 버튼이 아니라 `N명 더 필요` 또는 `예약 대기` 비활성 안내다.

### 핵심: 매 라운드 재평가 (greedy)

추천 점수는 "현재 확정 멤버가 누구냐"에 따라 매번 달라진다(실력 유사·동반 회피·로테이션·성별 균형 모두 `confirmed` 의존). 그래서 상위 N명을 한 번에 잘라 넣지 않고, **한 명을 뽑을 때마다 재평가**한다.

```
autoFillTeammates(confirmed, pool, ctx, count, weights?, { maxPlaying }):
  반복 count회 (또는 pool 소진까지):
    1. 경기중 선발 상한에 도달했으면 먼저 경기중 후보를 제외
       recommendTeammates(confirmed, eligiblePool, ctx) → 최상위 1명 선택
    2. 그 1명을 confirmed에 추가, pool에서 제거
  → 뽑힌 후보를 추천된 순서대로 반환(풀이 모자라면 가능한 만큼만)
```

> 단순 "상위 N명 자르기"와 다르다: 먼저 들어간 후보가 다음 라운드의 재결성/성별 균형/로테이션 점수를 바꾸므로, 라운드마다 다음 1명이 재선정된다.

### 풀 구성 — 경기중 여러 명 예약 허용 (2026-09-07 변경)

보드 액션 `boardStore.autoFillTarget`은 `buildRecommendData(..., { excludeReserved: true })`로 후보를 만든다. **경기중 선수 팀당 1명 제한을 제거했다.** 자동 추가 예약은 빈 슬롯만큼 허용하며, 기존 예약·수동 선택에 경기중 선수가 있어도 추가 예약을 막지 않는다.

`slotsToFill = 4 − confirmed.length`이고, `maxPlaying = max(0, slotsToFill − (needsAnchor ? 1 : 0))`을 전달한다. `needsAnchor`는 새 팀 모드에서 경기중이 아닌 선수가 아직 선택되지 않은 경우다. 현재 보드는 대기 anchor가 최소 한 명 있어야 팀을 생성·유지하므로 마지막 한 자리를 남긴다. **대기 2명 + 예약 2명**, **대기 1명 + 예약 3명**이 가능하다. 경기중 4명만으로 된 예약 전용 팀은 현재 구조에서 지원하지 않는다.

- 경기중 후보는 `W_PLAYING`(30) 페널티를 안고 경쟁하므로, 대기 후보들이 재결성 벌점(`W_GROUP4` 60 등)·판수 열세로 크게 밀릴 때만 상위로 올라온다 — "같은 4명이 재결성될 바엔 경기중에서 데려온다".
- **공칭 30과 판수 비용**: 진행 중인 경기는 완료 시 +1되므로 아직 그 한 판의 비용 10은 반영되지 않는다. `30 - 10 = 20`은 이 두 항만 비교한 값이며 실제 후보 간 총비용 차이가 고정된다는 뜻은 아니다.
- 경기중 인원 수를 고정하지 않고 새 만남·반복 동반·판수·대기·실력 등 합산 비용으로 결정한다. 진행 중 동반자는 이미 만난 사람으로 취급하므로 서로에게 새 만남 보너스를 주지 않는다. 같은 경기에서 여러 명 예약하는 것을 금지하지는 않는다.
- 경기중 pick은 `commitTeammates`가 예약(ghost) 처리한다. `resolveFreedReservations`는 각자의 경기가 끝나는 순서대로 정식 anchor로 승격한다. **마지막 예약자까지 경기에서 돌아온 4명**이어야 매칭확정 가능하다. 비경기중 picks는 즉시 anchor다. 서로 다른 코트에서 예약하면 가장 늦게 끝나는 경기를 기다릴 수 있다.
- 다른 팀에 이미 ghost 예약된 선수는 풀에서 제외(`excludeReserved`) — 이중 예약 방지.
- 채울 수(`count`) = `4 − 기존 멤버·수동 선택 인원`. 후보가 부족하면 가능한 만큼 채우되, 생성 후 2명 미만인 팀은 해체한다. 새 팀은 경기중이 아닌 anchor가 최소 1명 필요하다.

> 수동 추천도 여러 명 예약할 수 있다. 타 팀 예약자도 포함 가능하고 경기중 비용을 해제하는 모달 예외(§7)가 있다. 직접 선택한 경기중 선수는 ghost 예약이 된다. 새 만남 보정의 기존 1명 제한 실험과 제한 해제 비교는 [검증 문서](TEAM_MIXING_VALIDATION.md)에 구분해 기록한다.

### 회원 파티 — selectMemberParty

> **2026-09-13 임시 비활성화.** `SessionBoard.tsx`의 `MEMBER_PARTY_ENABLED = false`로 패널 전체를 마운트하지 않는다. 버튼·안내와 조회·홀드·자동 확정이 중단된다. 아래 선발 규칙은 보존하며, 재개 시 플래그를 `true`로 변경해 배포한다.

회원 파티는 별도 설정 없이 **해당 세션에 참가한 운영진이 1명 이상이며 전원 경기중**일 때 자동으로 나타나며 **읽기 모드 회원만** 사용할 수 있다. 해당 조건이 아니면 가운데 버튼과 안내를 모두 숨긴다. 현재 편집 권한을 가진 운영진은 참여할 수 없으며, 참여 중 편집 권한을 가져오면 즉시 제외한다. 운영진의 일반 자동편성과 점수 공식은 같고, 후보 범위와 완성 조건이 다르다.

1. 첫 회원이 가운데 버튼을 누르면 **공유 5초 카운트다운**이 시작된다. 회원은 버튼을 계속 누르고 있는 동안만 참가하며, 손을 떼면 후보에서 빠진다.
2. 마감 시점에 누르고 있는 `session_players.id` 집합을 `selectMemberParty(participantIds, inputs)`에 전달한다. 첫 참가자나 요청자를 시드로 확정하지 않는다.
3. `buildRecommendData({ newTeam: true }, [], inputs, { excludePlaying: true, excludeReserved: true })`의 풀과 홀드 참가자 집합을 교차한다. 휴식·자석 없음·타 팀 anchor·ghost 예약·콕 체크가 켜진 세션의 콕 미확인 선수는 제외한다. **회원 연결이 없는 게스트(`memberId === null`)와 `status === "playing"`도 제외**하므로 코트와 상태 중 어느 쪽에라도 경기중이면 뽑히지 않는다. 같은 선수 ID는 한 번만 센다.
4. 남은 후보가 4명 미만이면 **취소**한다. 전체 대기자나 경기중 선수로 부족한 자리를 보충하지 않는다.
5. `autoFillTeammates([], pool, ctx, 4, undefined, { maxPlaying: 0 })`로 매 선발마다 점수를 재평가해 4명을 뽑는다. 경기수·대기시간·재결성 회피·실력·성별·게임 타입 로테이션은 기존 추천 규칙을 그대로 따른다.
6. 정확히 4명이 선발된 경우 `pairPlayers`로 2v2 균형을 맞춰 `teamA` 2명 + `teamB` 2명의 ID 순서로 반환한다. 서버가 운영진 상태·홀드 유효성·선수 가용성·보드 충돌을 다시 검증한 뒤 **한 트랜잭션에서 매칭확정 보드 팀을 생성**한다.

이 기능은 회원에게 일반 보드 편집권이나 경기시작 권한을 주지 않는다. 생성한 팀은 기존 확정 순서대로 코트를 기다리고 경기시작은 기존 운영진 권한을 따른다.

---

## 9. 공통 규칙

### 동점 시 랜덤 선택 (다양성 확보)
- 페어 편성에서 `pairingScore` 가 완전히 동일한 최적 조합이 여러 개면 그중 **무작위**로 선택한다(`bestPairing`/`bestMixedPairing`).
- 동점 페어의 고착을 완화한다. 모든 세션에서 조합 다양성을 보장하거나 파트너 이력을 직접 회피하는 규칙은 아니다.
- `rankCandidates`는 랜덤 없이 안정 정렬로 동점 시 입력 순서를 유지한다. 대기 비용은 현재 시각에 의존한다.

### 보드 멤버십 불변식 (reconcile — `remoteDrafts.ts` / `boardStore.ts`)
팀 편성(`board_drafts`)과 코트 배정(`matches`)은 별도 권위로 비원자적으로 동기화되므로, 동시편집 레이스(유실된 dissolve, 핸드오프/탈취, 로스터 편입)로 멤버십이 어긋날 수 있다. 두 선행조건으로 막는다.

**(가) 편집은 반드시 한 명만** — `board_save_drafts`뿐 아니라 경기 RPC(`assign_match`/`complete_match`/`set_match_roster`)도 `board_assert_editor`로 서버에서 게이팅한다. 편집 락은 **sticky 소유**(`editor_client_id` 신원만; lease 만료 자동 해제·하트비트 폐기 — 마이그레이션 `20260717000000`)라 점유되면 명시적 takeover/handoff로만 이동한다. `board_assert_editor`는 호출자가 이미 편집자면 통과(sessions write 없음), 자유면 self-claim, **남이 보유하면 `'not editor'`로 거부**한다. 거부된(=편집자 아닌) 기기의 코트 변경은 `resyncFromServer`로 보기 전용에 수렴한다. (초기 게이팅은 마이그레이션 `20260624020000`, 운영진 강제는 `20260701020000`.)

회원 파티는 별도 서버 검증을 거친 **4인 확정 팀 생성**만 허용하는 예외다(8절). 일반 보드 저장·경기 RPC의 편집권 검증을 해제하지 않는다.

**(나) 사람 유니크성** — 아래 불변식을 **파생 단계에서 항상 강제**해 "팀에 있는데 게임중"·"A팀·B팀 동시 소속" 중복 표시를 막는다.
- **I1 — 단일 anchor**: 한 선수는 최대 한 예비팀의 anchor. `reconcileMembership`이 payload 팀을 `(createdMs↑, id↑)` 결정적 순서로 처리해 같은 선수가 둘 이상 팀에 있으면 **먼저 만들어진 팀**만 유지(모든 클라가 동일 결과로 수렴).
- **I2 — 경기중은 anchor 아님**: `playingIds`(코트 기반)에 든 선수는 어느 예비팀의 anchor도 아니다. reconcile이 항상 제거하고, 편집자는 `healPlayingAnchors`(코트 변화 시) + reconcile 정제분을 `board_drafts`로 영속화해 서버까지 수렴(새로고침 시 "유령 팀" 부활 방지).
- **ghost(예약)는 예외**: 경기중 선수를 예비팀에 `Reservation`(ghost)으로 빌려두는 것은 의도된 기능(§7 `handlePlayingMagnetDrop`)이라 I2가 건드리지 않는다. I2는 `anchorMemberIds`에만 적용.

**(다) ghost 정합 — "anchor xor ghost" + 복사본 수렴** — ghost는 "한 선수가 [원본 + 여러 팀 복사본]으로 동시에 보이는" 유니크성 예외이므로, 원본(선수) 상태가 바뀔 때 복사본이 stale로 남지 않게 강제한다.
- **anchor xor ghost**: 한 선수가 어느 팀의 anchor로 확정되면 어느 팀에서도 ghost일 수 없다. ① 로컬: `attachAnchor`가 합류 시 그 선수의 **모든** 예약(타 팀 포함)을 제거. ② 동기화 경계: `reconcileMembership`이 `assignedAnchor`에 든 선수의 예약을 버린다(경기중 선수는 I2로 anchor에서 빠져 assignedAnchor에 없으므로 "경기중 + ghost" 빌려주기는 보존).
- **복사본 수렴(승격)**: 경기 종료·로스터 제외로 선수가 자유가 되면 `resolveFreedReservations`가 **가장 오래된 예약**의 팀으로 anchor를 승격하고 나머지 예약을 정리한다. 잠금 팀 우선 분기는 없다. 나머지 인원의 상태까지 충족하면 매칭확정이 가능하다.
- **중복/고아 정리**: 같은 `(선수, 팀)` 쌍 중복 예약은 reconcile이 가장 오래된 것 하나만 유지. 죽은 팀을 가리키는 예약은 `serializeBoardDrafts`가 직렬화에서 제외하고 reconcile이 무시.

---

## 부록 — 제거된 규칙 (deprecated)

아래는 자동 팀 편성 시절의 규칙으로, 2026-06 리팩토링에서 코드와 함께 제거되었다. 참고용으로만 남긴다.

- **미도착(pending) 선수 제외**: `pending` 상태 자체가 제거됨. 세션 시작 시 전원 `waiting`.
- **혼복 "여자만" 실력 균형 (성별 인식 skillDiff)**: 혼복 지향 그룹에서 남자 후보 `skillDiff=0`·여자 후보만 확정 여성 평균과 균형을 보던 규칙. 2026-07 제거 — 혼복에서도 전원 실력을 본다(§2 skillDiff 참조). 같은 개편에서 skillDiff 자체도 평균 거리 → 스프레드 증가분으로 교체.
- **쌍 단위 동반 회피 (`pairHistory`·`W_PAIR`·`Σc²`)**: 두 선수의 누적 동반 횟수를 상대별 제곱해 벌점하던 규칙과 `pair_history` 테이블 클라이언트 조회, `recordTeam`(`src/lib/pairHistory.ts`). 2026-07 제거 — 조합의 정체성을 잃는 문제로 그룹 겹침 단위(`W_GROUP2/3/4`, §2)로 대체. DB `pair_history` 테이블·서버 누적도 `20260727090000`에서 삭제 완료.
- **운영진 자동편성 대기 선수 전용 (`excludePlaying:true`) 및 팀당 예약 1명 제한**: 대기 전용은 2026-07 제거했고, 1명 제한도 2026-09-07 제거했다(§8). 회원 파티는 별도 기능으로 경기중 선수를 항상 제외한다.
- **혼복/빡겜 우선배치 강제(`force_mixed`/`force_hard_game`)**: 토글 액션·플래그 제거됨. 추천은 `W_ROTATE` 로 게임 타입을 자연 분산.
- **"우선배치"(그룹 지정, `forcedIds`·`toggleForced`·`effectiveForcedIds`·핀 배지)**: 2026-07-29 제거. 2026-07에 밸런스 영향 경로(`forcedPairs`·`W_FORCED`·decay)를 떼어낸 뒤로는 **점수·행동 효과가 하나도 없는 순수 시각 배지**만 남아 실사용 의미가 없었다. 함께 사라진 CTA 자리(구성 중 2~3명, 또는 4명이지만 예약자가 경기중)는 회색 비활성 안내(`N명 더 필요` / `예약 대기`)로 대체 — 박스 높이·히트영역 불변식은 그대로다.
- **selectFour / 대기열 선발 우선순위 단계**: 대기열에서 한 번에 4명을 자동 선발하던 로직 제거. 보드에서 수동 구성 + `recommendTeammates` 추천이 기본이며, **팀 단위 점진적 자동편성은 §8 `autoFillTeammates`(추천 재평가 greedy)로 재도입**되었다(과거의 bulk selectFour와 다름).
- **다전략 후보 생성(`generateBulkTeamCandidates`)**: `coPlayerAvoidance` 포함 5전략, 보충 모드(supplement), `usedPlayerIds` 다양성, `team_candidates` 저장/`candidates_updated` 브로드캐스트 등 전부 제거.
- **가중치 프로필(`WEIGHT_PROFILES`)**: 위 다전략 후보 생성용 5개 프로필(`gameCountBalanced`/`newCombination`/`skillBalanced`/`mixedCountBalanced`/`waitTimePriority`) 상수. 소비자 전원 삭제로 코드에서 완전히 제거됨.
- **혼복 남자/여자 실력 유사성 별도 규칙**: 별도 `(mixedCount·10 + skillDiff)` 선발식 제거. 혼복 균등은 `W_MIXED` 가중치와 페어 편성 단계의 균형 점수로 흡수.
