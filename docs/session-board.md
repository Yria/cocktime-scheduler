# 세션 보드 (딱판) 설계 문서

## 1. 개요

`/session/board` 라우트의 **자석 칠판 메타포 수동 팀 구성 페이지**. 보드를 **세션 운영의 메인 화면**으로 사용한다 (자동매칭/후보리스트 등 다른 구현과 공존을 가정하지 않는다).

- 선수를 "자석"처럼 드래그해 겹치면 팀이 되고, 4명이 모이면 경기를 시작한다.
- **다중 예약**: 한 선수가 여러 예비팀에 동시에 "예약(ghost)"으로 들어갈 수 있다. 원본 팀에 남으면서 다음 라운드 팀을 미리 짜둘 수 있다. 이것이 디지털 자석판의 핵심 가치(물리 자석은 1인=1개라 불가능).

---

## 2. 라우트 / 기술 스택

| 항목 | 값 |
|------|------|
| Path | `/session/board` |
| 가드 | `App.tsx`의 `sessionGuarded()` — 활성 세션 없으면 `/`로 |
| 렌더 | **react-konva** (`Stage`/`Layer`). DOM이 아닌 Canvas 2D. |
| 상태 | zustand `boardStore`(예비팀/예약/자석) + `sessionStore`(코트/경기, 구독만) |

> 과거 문서가 언급하던 dnd-kit / tldraw는 채택되지 않았다. 실제 구현은 react-konva다.

---

## 3. 진실의 원천 분리 (가장 중요한 원칙)

- **보드(`boardStore`)는 "구성 중" 예비팀만 소유**한다: 자유 자석, `DraftTeam`(forming/ready), `Reservation`.
- **"경기중" 상태는 보드가 소유하지 않고 `sessionStore.courts`에서 derive**한다. 보드에 `playing`/`queued` 같은 로컬 플래그를 두지 않는다.
- **대기열(matchQueue) 기능은 보드에서 쓰지 않는다.** 빈 코트가 없으면 "경기시작" 버튼을 비활성(disabled)으로 둔다.

---

## 4. 데이터 모델 (`src/types/board.ts`)

```ts
// 자석 = 선수 1개의 물리 토큰. teamId는 "원본(anchor) 소속" 단일 팀만.
type MagnetPosition = { playerId: string; x: number; y: number; teamId: string | null };

// 예비팀. playing/queued/courtId/matchId 없음 (DB에서 derive).
interface DraftTeam { id: string; anchorMemberIds: string[]; anchor: StagePoint; createdAt: number }

// 예약(ghost). 한 선수가 여러 개 가질 수 있다.
interface Reservation { id: string; playerId: string; teamId: string; createdAt: number }
```
```ts
interface BoardState {
  magnets: Map<playerId, MagnetPosition>;
  drafts: Map<draftId, DraftTeam>;
  reservations: Map<resId, Reservation>;
  assigningTeamIds: Set<teamId>;   // 경기시작 진행중 더블클릭 가드
}
```

**다중 소속 표현** = `anchor 1개`(`magnet.teamId`) + `ghost N개`(`reservations`).
예) a,b,c,d 팀에서 d를 두 예비팀에 예약 → d의 `magnet.teamId`는 원본 팀 유지, `reservations`에 `{d→T2}`, `{d→T3}` 추가.

---

## 5. derive 레이어 (`src/lib/board/membership.ts`, 순수 함수)

| 함수 | 역할 |
|------|------|
| `playingIdsFromCourts(courts)` | 코트 배치된 경기중 선수 집합 |
| `teamMembers(teamId)` | 예비팀 유효 멤버(anchor 먼저 + ghost는 createdAt순), 슬롯 0..3, 중복 제거 |
| `deriveLifecycle(playerId)` | `playing`(코트) \| `anchored`(예비팀 원본) \| `free` |
| `isTeamStartable(teamId)` | 멤버 4명 && 전원 not playing && ghost는 다른 팀에 묶이지 않은 free |

- **자유 이동**: 자석/팀/코트 카드는 드롭한 자리에 그대로 둔다(드래그마다 자동 재배치/settle 하지 않음). 겹침 정리는 툴바 **"정렬"** 버튼(`rearrangeAll`)으로만.
- **정렬(`rearrangeAll`)**: ① 이미 구성된 팀부터 정렬 — 멤버 많은(완성된) 팀 먼저, 코트 레인 아래 격자 배치 → ② 나머지 자유 자석을 팀 영역 아래 격자 배치 → ③ `settleFreeMagnets`로 잔여 겹침 정리 + 바운더리 클램프.
- **그룹 생성 시 흩어짐**: 새 팀이 만들어질 때(`createPair`/`reservePair`/경기중-선수 페어)만 `settleFreeMagnets`를 호출해, 새 팀 박스와 겹치는 자유 자석을 **화면 바운더리 안에서** 흩어지게 한다(코트 레인 위로는 안 올라감). 경기완료로 4명이 한꺼번에 풀릴 때도 예외적으로 settle.
- **코트 카드 드래그**: 경기중 코트 카드(`CourtMatchCard`)도 드래그로 이동 가능(`courtAnchors` Map에 위치 저장). 멤버 자석을 끌어내면 예약 생성(아래 §12).
- **자유 자석 렌더 조건** = `teamId === null && !playing`.
- 경기중 선수는 자유 자석으로도, anchor로도 렌더되지 않고 **코트 카드 안에서만** 표시. (단 ghost로는 표시될 수 있다 → 예약된 선수가 지금 경기중)
- 경기중 선수의 자석(`teamId===null`인 잔여 토큰)은 `resolveDropTarget`이 `playingIds`로 **페어/합류 대상에서 제외**한다(경기중 선수가 새 팀 anchor가 되는 상태 오염 방지).

---

## 6. 인터랙션 상태머신 (`src/lib/board/dropResolver.ts`)

드래그 노드는 **자유 자석 / anchor 멤버 / ghost** 3종. 자유·anchor는 `handleDrop(playerId)`, ghost는 `handleGhostDrop(resId)`로 분리.

**핵심 3규칙**: ① 자유끼리 겹치면 새 팀 · ② anchor를 빈 공간이면 해제 · ③ anchor를 다른 팀/선수에 겹치면 예약.

| 드래그 | 드롭 | 액션 |
|--------|------|------|
| 자유 자석 | 팀 박스(<4 또는 이미 ghost) | `attach` (anchor 합류, ghost면 승격) |
| | 다른 자유자석 ≤`PAIR_RADIUS` | `createPair` (둘 다 anchor 신규 팀) |
| | 빈 공간 | `move` |
| anchor 멤버 | 빈 공간 | `detach` (요구2: 팀에서 빠짐) |
| | 다른 팀 박스(<4, 비멤버) | `reserve` (원본 유지 + ghost, 요구5) |
| | 다른 자유자석 ≤`PAIR_RADIUS` | `reservePair` (자유자석=anchor, 끌린 선수=ghost로 신규 예비팀) |
| | 자기 팀 박스 | `none` (슬롯 스냅백) |
| ghost | 다른 팀 박스(<4, 비멤버) | `reReserve` (예약 대상 변경) |
| | 다른 팀 박스(정원초과/이미 멤버) | `none` (스냅백, 예약 유지) |
| | 빈 공간 | 예약 취소 |
| | 원래 팀 | `none` (스냅백) |

- **"진짜 팀 이동"은 v1 미도입** — 빈 공간 detach → attach 2스텝으로 표현(요구5 "겹치면 원본 제거 안 함"에 정합).
- 팀 해체: anchor detach 후 `anchorMemberIds===0` 또는 `총 멤버<2`면 dissolve + 그 팀 향한 예약 cascade 삭제.

---

## 7. 예약 라이프사이클

- **생성**: `reserve`/`reservePair`. `(playerId, teamId)` 중복이면 no-op, 정원 4면 거절.
- **취소**: ghost를 빈 공간으로 → 해당 reservation 삭제. 원본 anchor 무영향.
- **승격(자동)**: 예약 멤버가 경기중이면 그 예비팀은 `startable=false`로 자동 잠김. 경기 끝나(`match_completed`) free가 되면 `startable`이 derive로 자동 복구 → "경기시작" 자동 활성. **별도 승격 코드 없음.**
- **경기시작된 4명**은 다른 예비팀의 ghost로 남는다(자동 제거 X) — "다음 라운드 미리 짜기"가 목적.
- **cascade**: 팀 dissolve 시 그 팀 향한 모든 reservation 삭제(고아 ghost 방지). 풀 이탈 선수의 예약도 정리.

---

## 8. DB 연동 — 코트 배치 (요구 3·4)

`sessionStore`를 통해 DB에 반영. **시그니처 무변경**으로 재활용.

> **필수 — Realtime 채널 구독**: `handleAssign`/`handleComplete`는 `sessionStore._channel`이 없으면 early return한다. 채널은 `subscribe()`로 설정되는데, 이는 `SessionMain`이 아니라 **각 화면이 직접** 호출해야 한다. 보드는 `SessionMain` 없이 단독 라우트(`/session/board`)로 마운트되므로, `SessionBoard`가 자체 `useEffect`에서 `subscribe(sessionId, onEnd)` / `unsubscribe()`를 호출한다. (이게 없으면 경기시작·경기완료 버튼이 무반응이 된다 — 코트 카드는 로드된 스냅샷으로 보이지만 핸들러가 동작하지 않음.)

**경기시작** (`boardStore.startMatch(teamId)`):
1. `isTeamStartable` 가드 + 빈 코트(`courts.find(!match)`) 확인 + `assigningTeamIds` 더블클릭 가드.
2. 4명 → `pairPlayers(four, singleWomanIds, "보드 수동 편성")` 로 `GeneratedTeam`(teamA/teamB 2v2 + gameType) 변환. (`src/lib/teamSelection` 재활용, 신규 분할 로직 0)
3. `await sessionStore.handleAssign(gen, court.id)` → RPC `assign_match` + `match_started` 브로드캐스트.
4. **성공 판정**: `handleAssign`은 `Promise<void>`이므로 await 후 해당 코트의 `match`가 **우리 4명으로 채워졌는지**(선수 집합 일치) 확인. 일치하면 예비팀 dissolve(예약 cascade), 아니면 실패 토스트(낙관적 dissolve 금지 + race 오판 방지).

**경기완료** (`boardStore.completeMatch(courtId)` — `CourtMatchCard`의 버튼):
- `await sessionStore.handleComplete(courtId)` → RPC `complete_match`, 선수 status→waiting, `court.match=null`.
- 4명이 다시 자유 자석으로 → `pushAwayFreeMagnets`로 겹침 정리.

**"버튼이 경기완료로 바뀐다"**: forming/ready 예비팀의 `경기시작` 버튼과 코트 카드의 `경기완료` 버튼은 별개 노드. assign 성공 시 예비팀이 사라지고 같은 보드 위에 `CourtMatchCard`(경기중)가 등장 → "draft → 코트 카드" 전환으로 요구를 충족.

---

## 9. 요구사항 3 엣지케이스

| 케이스 | 처리 |
|--------|------|
| 빈 코트 없음 | "경기시작" **disabled**(라벨 "코트 대기"). 코트 비면 derive로 자동 활성 |
| RPC 배치 실패 | 낙관적 dissolve 금지 → `court.match` 미생성 시 draft 유지 + 실패 토스트. `assigningTeamIds` 더블클릭 가드 |
| 예약 멤버 경기중 | `startable=false` → disabled(라벨 "선수 경기중") |
| 동시 배치 race | 3중 방어: 로컬 `assigningTeamIds` + `handleAssign` 내부 `if(court.match)return` + RPC 단일 트랜잭션 |
| 2v2 분할·gameType | `pairPlayers`/`determineGameType` 단독 책임 |
| 경기완료→4명 free | `startable` derive 자동 복구, 예약 ghost 유지(승격) |
| anchor detach로 팀원<2 | dissolve + 예약 cascade |
| 같은 팀 중복 예약/attach | `isMemberOf` 가드 no-op |
| 4명 초과 | attach/reserve/reReserve 모두 정원 4면 거절 |

---

## 10. 시각화

- **자유/anchor 자석**: 성별색 + 사진 + 스킬 링(`PlayerMagnet`).
- **ghost(예약)**: opacity `0.5` + 점선 보라 외곽링(`dash=[5,4]`) + 우상단 "예약" 뱃지.
- **예비팀 박스**: startable=초록 / 4명이지만 대기=호박 / 구성중=회색.
- **코트 카드**(`CourtMatchCard`): 호박색, "N번 코트 · 경기중", 멤버 locked(드래그 불가), "경기완료" 버튼.

---

## 11. 파일 구조

```
src/
├─ components/board/
│  ├─ SessionBoard.tsx     — Stage/Layer. 코트카드+예비팀+자유자석 배치, 드롭 배선
│  ├─ BoardToolbar.tsx     — 뒤로/정렬
│  ├─ PlayerMagnet.tsx     — 자석(anchor/ghost/locked 시각 분기)
│  ├─ TeamBackground.tsx   — 예비팀 박스 + 멤버 + 비활성 CTA
│  ├─ CourtMatchCard.tsx   — 경기중 코트(읽기전용) + 경기완료
│  └─ CourtStatusBar.tsx   — 하단 코트 현황 바
├─ lib/board/
│  ├─ dropResolver.ts      — resolveDropTarget 상태머신 (순수)
│  ├─ membership.ts        — teamMembers/deriveLifecycle/isTeamStartable (순수)
│  ├─ geometry.ts          — 슬롯/히트 (순수)
│  ├─ collision.ts         — settleFreeMagnets (경기중 선수 제외)
│  └─ constants.ts         — 치수/색/예약 시각 상수
├─ store/boardStore.ts     — magnets/drafts/reservations + startMatch/completeMatch
├─ types/board.ts          — MagnetPosition/DraftTeam/Reservation/TeamMember
└─ lib/teamSelection/pairPlayers.ts — 4명→GeneratedTeam(2v2+gameType) [재활용]
```

---

## 12. 알려진 제약 / 후속

| 항목 | 상태 | 비고 |
|------|------|------|
| 경기중 선수를 예비팀에 신규 예약 | 지원 | 코트 카드 멤버를 끌어내 팀/선수에 겹치면 예약(ghost) 생성, 원본은 코트 유지(`handlePlayingMagnetDrop`) |
| 캔버스 persist | 미구현 | 새로고침 시 자석/예비팀 레이아웃 유실(의도) |
| 코트 카드 ↔ 예비팀 위치 겹침 | 해소 | 상단 `COURT_LANE_H` 레인 예약 + 코트 카드를 **맨 위로 렌더**(경기완료 버튼 클릭 보장). 풀/예비팀/자유자석은 레인 아래로 클램프 |
| 팬/줌 | 미구현 | 핵심 아님 |
| 여러 라운드 선계획 UI | 부분 | 예약으로 다음 라운드는 가능, 라운드 인덱스 분리는 후속 |
