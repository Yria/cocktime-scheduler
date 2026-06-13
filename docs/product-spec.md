# 콕타임 (CockTime) 서비스 기획서

## 1. 서비스 개요

배드민턴 클럽의 정기 모임(세션)을 운영하는 도구.
선수 명단을 관리하고, **자석 칠판(보드)** 위에서 코트별 팀을 직접 편성하며, 대기/경기/휴식 상태를 실시간으로 공유한다.

- 타깃: 배드민턴 클럽 관리자 + 참석 선수 전원
- 환경: 모바일 전용 (PC는 모바일 레이아웃 그대로)
- 실시간 동기화: 관리자 태블릿 + 참석자 개인 스마트폰이 같은 세션 화면을 공유

> **2026-06 리팩토링 반영**
> 기존의 자동 팀 편성(auto team formation) + 매치 대기열(match queue) + pending(미도착) 상태 +
> 수동매칭 로그(manual match logs) + 팀 후보(team candidates) 슬라이스를 **전부 제거**했다.
> 메인 기능은 **보드(수동 드래그 + 추천)** 단일 플로우다.
> - 라우팅: `/session` = 보드(SessionBoard, react-konva 자석 칠판). 구 `/session/board` 는 `/session` 으로 리다이렉트. 구 `/session`(SessionMain)은 삭제됨.
> - 추천 로직(`recommendTeammates` / `rankCandidates` / `pairPlayers` / `skillScore`)은 **유지**된다.

---

## 2. 화면 구성

### 2-1. 홈
- 구글 스프레드시트 URL 입력 → 선수 데이터 로드
- 로드된 선수 목록 확인 후 세션 설정 페이지로 이동

### 2-2. 세션 설정
- **코트 수 선택** (1~6개)
- **혼복 허용 여성 지정**: 여성 선수 중 남3여1 구성에서 단독 배치를 허용할 선수 선택
- **참석자 선택**: 전체 선수 목록에서 오늘 참석한 선수를 체크. 이름 검색, 성별 필터 지원
- **게스트 추가**: 명단에 없는 임시 참가자 추가 (이름·성별·스킬 입력)
- 세션 시작 버튼 → 세션 생성 후 보드 페이지(`/session`)로 이동

### 2-3. 세션 보드 (세션 메인)
세션 진행 중 메인 화면. **react-konva 기반 자석 칠판.**

#### 표시 영역
| 영역 | 내용 |
|------|------|
| 코트 | 코트별 현재 경기 중인 팀 A / 팀 B (자석) |
| 대기 영역 | 경기 대기 중인 선수 자석 |
| 휴식 영역 | 일시 휴식 중인 선수 자석 |
| 팀 구성 영역 | 코트 배정 전 4명을 모아두는 임시 그룹(보드 드래프트) |

#### 헤더 / 푸터 (UI chrome)
- **헤더**: 앱 글래스 톤앤매너(`var(--mat-thick)`/`lq-header`/`lq-bar`) 적용. 우측에 [설정](→`/setup`), [로그](→`/logs`), [세션 종료] 버튼. "뒤로" 버튼은 제거됨.
- **[세션 종료]**: 확인 모달 → `handleEndSession` → `sessions.is_active=false` + 본인 `navigate("/")`. 다른 클라이언트는 `is_active` postgres watch 로 종료 감지.
- **정렬**: 우하단 **플로팅 버튼**으로 이동(헤더에서 분리).
- **세션 설정 화면(SessionSetup) 헤더**: 뒤로 버튼 추가 — 활성 세션이면 `/session`(보드)로, 없으면 `/`(홈)로.

#### 액션
- **자석 드래그**: 선수 자석을 대기/팀 구성/코트/휴식 영역으로 직접 끌어 배치
- **추천 팀원**: 팀 구성 영역의 빈 슬롯(+)을 누르면 현재 멤버에 가장 어울리는 후보 순위를 추천 (`recommendTeammates`)
- **코트 배정**: 팀 구성 영역의 4명을 빈 코트에 배정 → 경기 시작(`assign_match` RPC)
- **경기 완료**: 코트 완료 처리 → 4명 대기 복귀, `game_count`/`mixed_count`/`pair_history` 갱신(`complete_match` RPC)
- **휴식 전환**: 대기 ↔ 휴식 토글
- **세션 종료**: 헤더 [세션 종료] 버튼(위 헤더 항목 참조)

> **세션 종료(유지)**: 보드 헤더 [세션 종료] 버튼 → 확인 모달 → `handleEndSession` → `sessions.is_active=false` + 본인 `navigate("/")`.
> 다른 클라이언트는 `is_active` postgres watch 로 종료를 감지한다(`session_ended` 브로드캐스트는 미사용).
>
> **제거됨(deprecated)**: 자동 "팀 생성"(대기열에서 알고리즘으로 4명 자동 선발), 매치 대기열, 예약 그룹,
> 혼복 우선배치(`force_mixed`)·빡겜 우선배치(`force_hard_game`).
> 이들 화면/액션은 더 이상 존재하지 않는다.
> (`force_mixed`/`force_hard_game` 은 기능·DB 컬럼 모두 제거됨 — 상세는 5절 상태 머신 참고.)

---

## 3. 핵심 기능 상세

### 3-1. 보드 추천 로직 (recommendTeammates)

자동 4명 선발은 제거됐다. 대신 관리자가 보드에서 팀 구성 영역에 멤버를 채워갈 때,
**빈 슬롯에 어울리는 후보 순위**를 계산해 제시한다. 점수는 "낮을수록 좋음"(비용)이며 오름차순 정렬한다.

기반은 `rankCandidates`(아래 3-2)이며, 보드 추천에 특화된 세 가지 요소를 가산한다.

| 요소 | 가중치 상수 | 의미 |
|------|-------------|------|
| 게임 타입 로테이션 | `W_ROTATE` (6.0) | 확정 멤버·후보 각자의 직전 게임 타입이 "이 팀이 향하는 목표 타입"과 같으면 페널티(+), 다르면 보너스(−). 직전에 남복을 했으면 혼복 쪽(여성 후보)에, 직전에 혼복을 했으면 동성(남복) 쪽(남성 후보)에 우대가 쏠림 |
| 성별 균형 | `W_GENDER` (50.0) | 혼복(2남2녀) 목표에서 한쪽 성별이 3명 이상이 되는 후보에 큰 페널티(하위 노출) |
| 경기중 후보 | `W_PLAYING` (30.0) | 현재 코트에서 경기 중인 후보에 페널티 → 대기 선수가 상위에 오도록 |

`RECOMMEND_WEIGHTS` 기본값: `W_SKILL 20.0, W_PAIR 8.0, W_GAME 1.0, W_MIXED 0, W_WAIT 2.0, W_ROTATE 6.0, W_GENDER 50.0, W_PLAYING 30.0`.

### 3-2. 후보 점수 (rankCandidates)

이미 확정된 N명(`confirmed`)이 있을 때, 풀(`pool`)에서 가장 어울리는 후보를 점수 오름차순으로 반환하는 순수 함수.

- **confirmed가 0명**일 때: deficit(참여율 적자)과 대기시간만 반영
  - `score = -deficit·W_GAME + mixedCount·W_MIXED - waitMinutes·W_WAIT`
- **confirmed가 1명 이상**일 때:
  - `score = skillDiff·W_SKILL + pairOverlap·W_PAIR - deficit·W_GAME + mixedCount·W_MIXED - waitMinutes·W_WAIT`
  - `skillDiff`: 후보 skillScore와 confirmed 평균 skillScore 차이 (실력 유사할수록 ↓)
  - `pairOverlap`: confirmed 각각과 함께 뛴 누적 동반 횟수(`pairHistory`) 합산 (적게 뛴 상대일수록 ↓)
  - `deficit`: 기대 경기수 대비 적자. 클수록 우선 선발 → 점수에 음수로 반영

> deficit·대기시간은 적자/대기가 클수록 점수를 낮춰 우선 선발되게 한다(음수 반영).

#### 참여율(deficit) 공식
- `eligibleRounds = totalMatchCount − joinedAtMatch`
- `playProbability = (totalMatchCount × 4) / Σ(모든 활성 선수의 eligibleRounds)`
- `expectedGames = eligibleRounds × playProbability`
- `deficit = expectedGames − gameCount`
- `totalEligible == 0` 또는 `totalMatchCount == 0` 이면 `deficit = 0`

#### 가중치

> **제거됨(deprecated)**: 가중치 프로필 상수 `WEIGHT_PROFILES`(자동 다전략 후보 생성용 5개 프로필 — `gameCountBalanced`/`newCombination`/`skillBalanced`/`mixedCountBalanced`/`waitTimePriority`)는 소비자가 전부 삭제되어 **코드에서 완전히 제거**되었다.
> 현재 유지되는 가중치는 `recommendTeammates` 의 `RECOMMEND_WEIGHTS`(보드 추천용: `W_SKILL 20.0, W_PAIR 8.0, W_GAME 1.0, W_MIXED 0, W_WAIT 2.0` + `W_ROTATE 6.0, W_GENDER 50.0, W_PLAYING 30.0`)와 `rankCandidates` 내부 기본값 `DEFAULT_WEIGHTS`(`W_SKILL 4.0, W_PAIR 6.0, W_GAME 1.0, W_MIXED 0, W_WAIT 0`) 뿐이다.

### 3-3. 페어 편성 (pairPlayers)

확정된 4명을 받아 게임 타입을 결정하고, 최적 페어(2v2)로 편성해 `GeneratedTeam`을 반환하는 순수 함수.

#### 게임 타입 결정 (determineGameType)
4명의 여성 수로 결정한다.
| 여성 수 | 결과 |
|---------|------|
| 0 | 남복 |
| 1 | 해당 여성이 `allowMixedSingle` 또는 혼합 허용 목록(`singleWomanIds`) 포함 → **혼합**, 아니면 남복 |
| 2 | 혼복 |
| 3 | 남복 (남자 1명 포함) |
| 4 | 여복 |

#### 페어링 점수 (pairingScore — 낮을수록 좋음)
```
score = intraDiff × 0.5 + interDiff × 1.5
```
- `intraDiff = |skill(A1) − skill(A2)| + |skill(B1) − skill(B2)|` (페어 내 실력 유사성)
- `interDiff = |(skill(A1)+skill(A2)) − (skill(B1)+skill(B2))|` (두 팀 실력 합 차이, 강약 교차)

- **혼복**: 여자 2 × 남자 2를 크로스 배치(여A+남A vs 여B+남B) vs (여A+남B vs 여B+남A) 중 낮은 점수 선택
- **그 외**: 3가지 페어 조합 중 pairingScore 최솟값 선택
- 동점이면 동점 조합 중 **랜덤 선택**(다양성 확보)

### 3-4. 실시간 동기화

- **Supabase Realtime Broadcast** 사용
- 모든 상태 변경(배정, 완료, 휴식, 보드 드래프트 등)을 브로드캐스트로 즉시 전파
- 재연결 시 DB에서 현재 세션 상태를 쿼리하여 복구
- 자신이 보낸 이벤트는 자신에게 돌아오지 않음 (루프 없음)

---

## 4. 선수 데이터 구조

| 필드 | 타입 | 설명 |
|------|------|------|
| id | string | 구글 시트 기반 고유 ID |
| name | string | 이름 |
| gender | 'M' \| 'F' | 성별 |
| skills | object | 7가지 스킬 각 O/V/X |

#### 스킬 항목
클리어 / 스매시 / 로테이션 / 드랍 / 헤어핀 / 드라이브 / 백핸드

#### 스킬 점수 (skillScore)
- O (잘함) = 3점
- V (보통) = 2점
- X (못함) = 1점
- 선수 실력 = 7개 스킬 점수의 **평균** (1.0 ~ 3.0)

---

## 5. 선수 상태 전이

```
[waiting] ──배정──▶ [playing] ──완료──▶ [waiting]
    │
    ├──휴식──▶ [resting] ──복귀──▶ [waiting]
```

- **waiting**: 대기 중 (추천/배정 대상)
- **playing**: 코트에서 경기 중
- **resting**: 일시 휴식, 추천 대상에서 제외

> **제거됨(deprecated)**: `pending`(미도착) 상태와 활성화 전이. 세션 시작 시 전원 `waiting`으로 등록된다.
> `force_mixed`(혼복 우선배치)·`force_hard_game`(빡겜 우선배치)는 **기능·DB 컬럼 모두 제거**됐다.
> 토글/쓰기 경로뿐 아니라 DB 컬럼까지 마이그레이션 `20260612120000` 에서 DROP 됐고,
> 코드 필드·transformer·타입·`DebugMatchModal` 표시도 전부 삭제되어 더 이상 어디서도 참조하지 않는다.

---

## 6. 세션 라이프사이클

```
세션 생성 → 참여자 전원 waiting 등록
    ↓
[반복] 보드에서 4명 구성 → 코트 배정 → 경기 완료 → 대기 복귀
```

> **세션 종료**: 보드 헤더 [세션 종료] 버튼으로 가능하며, 세션 활성/비활성은 `sessions.is_active` 로 관리한다(`dbEndSession` → `is_active=false`).
> 종료 전파는 `is_active` postgres watch 로만 이뤄진다(`session_ended` **브로드캐스트 이벤트는 미사용**).

---

## 7. 비고

- 점수 계산 없음 (팀 편성 도구)
- 세션 간 통계/히스토리는 현재 범위 외 (추후 확장)
- 게스트 선수는 구글 시트에 없는 임시 참가자 (`guest-` prefix ID)
