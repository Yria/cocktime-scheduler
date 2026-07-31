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
- **보기 전용 자동 정렬**: 편집자는 수동 배치(드래그)가 진실의 원천이라 정렬은 "정렬" 버튼으로만. 반면 **보기 전용(`!isEditor`)** 은 드래그를 못 하므로, 멤버십(팀·예약)이나 코트 매치가 바뀔 때마다 `SessionBoard`가 자동으로 `rearrangeAll`을 호출해 레이아웃을 정돈한다. 트리거는 멤버 구성·코트 매치 시그니처(`membershipSig`/`courtSig`) — `arrangeBoard`가 바꾸는 "위치"는 시그니처에 없어 정렬→재정렬 루프가 생기지 않는다.
- **그룹 생성 시 흩어짐**: 새 팀이 만들어질 때(`createPair`/`reservePair`/경기중-선수 페어)만 `settleFreeMagnets`를 호출해, 새 팀 박스와 겹치는 자유 자석을 **화면 바운더리 안에서** 흩어지게 한다(코트 레인 위로는 안 올라감). 경기완료로 4명이 한꺼번에 풀릴 때도 예외적으로 settle.
- **코트 카드 드래그**: 경기중 코트 카드(`CourtMatchCard`)도 드래그로 이동 가능(`courtAnchors` Map에 위치 저장). 멤버 자석을 끌어내면 예약 생성(아래 §12).
- **자유 자석 렌더 조건** = `teamId === null && !playing`.
- 경기중 선수는 자유 자석으로도, anchor로도 렌더되지 않고 **코트 카드 안에서만** 표시. (단 ghost로는 표시될 수 있다 → 예약된 선수가 지금 경기중)
- 경기중 선수의 자석(`teamId===null`인 잔여 토큰)은 `resolveDropTarget`이 `playingIds`로 **페어/합류 대상에서 제외**한다(경기중 선수가 새 팀 anchor가 되는 상태 오염 방지).

---

## 6. 인터랙션 상태머신 (`src/lib/board/dropResolver.ts`)

드래그 노드는 **자유 자석 / anchor 멤버 / ghost** 3종. 자유·anchor는 `handleDrop(playerId)`, ghost는 `handleGhostDrop(resId)`로 분리.

**핵심 3규칙**: ① 자유끼리 겹치면 새 팀 · ② anchor를 빈 공간이면 해제 · ③ anchor를 다른 팀의 **빈 슬롯(구멍)**에 놓으면 예약.

> **그룹 합류는 빈 슬롯(구멍)만 타겟**: 박스 아무 곳이 아니라 4개 슬롯 중 빈 구멍 중심 근처(`SLOT_SNAP_R`=32, `isOnEmptySlot`)에 정확히 놓을 때만 `attach`/`reserve`. 박스 안이지만 슬롯이 아니거나 정원 초과면 `none`(드래그 취소→원위치 복귀). 자유 자석의 `none` 복귀는 상태 무변경이라 re-render가 없어 `PlayerMagnet.handleDragEnd`가 스토어 좌표로 직접 되돌린다. 박스가 겹쳐도 첫 박스에서 멈추지 않고 bounds 안 모든 팀을 보아 슬롯이 맞는 팀을 고른다(없으면 `none`).

| 드래그 | 드롭 | 액션 |
|--------|------|------|
| 자유 자석 | 팀 빈 슬롯(구멍, <4) 또는 이미 그 팀 ghost | `attach` (anchor 합류, ghost면 승격) |
| | 팀 점유 슬롯(멤버 위) | `replace` (그 자리 멤버 교체 — 점유자는 자유 자석으로) |
| | 팀 박스 안이지만 슬롯 밖 | `none` (원위치 복귀) |
| | 다른 자유자석 ≤`PAIR_RADIUS`(중심거리, 지름 10%↑ 겹침) | `createPair` (둘 다 anchor 신규 팀) |
| | 빈 공간 | `move` |
| anchor 멤버 | 빈 공간 | `detach` (요구2: 팀에서 빠짐) |
| | 다른 팀 빈 슬롯(<4) | `attach` (이동 — 원본 팀에서 빠짐, 예약 아님) |
| | 다른 팀 **점유 슬롯(멤버 위)** | `replace` → **두 사람 맞교환(스왑)** — 끌어온 선수는 그 자리로, 점유자는 끌어온 선수가 있던 팀·자리로. 양 팀 인원 불변(해체·확정해제 없음), 양 팀 createdBy 갱신 |
| | 자기 팀 점유 슬롯 | 두 멤버 슬롯만 스왑(둘 다 유지) |
| | 다른 팀 박스 안이지만 슬롯 밖 | `none` (원위치 복귀) |
| | 다른 자유자석 ≤`PAIR_RADIUS_DETACH`(=`MAGNET_R`, 절반 이상 겹침) | `createPair` (원본 팀에서 빠져 새 페어로 이동) |
| | 자기 팀 박스(슬롯 밖) | `none` (슬롯 스냅백) |
| ghost | 다른 팀 박스(<4, 비멤버) | `reReserve` (예약 대상 변경) |
| | 다른 팀 박스(정원초과/이미 멤버) | `none` (스냅백, 예약 유지) |
| | 빈 공간 | 예약 취소 |
| | 원래 팀 | `none` (스냅백) |

- **"진짜 팀 이동"은 v1 미도입** — 빈 공간 detach → attach 2스텝으로 표현(요구5 "겹치면 원본 제거 안 함"에 정합).
- **페어 반경은 출발지에 따라 다르다**: 자유 자석끼리는 `PAIR_RADIUS`(=지름×0.9), **그룹에서 빼내는 anchor**와
  **코트에서 끌어낸 경기중 자석**은 `PAIR_RADIUS_DETACH`(=반지름). 자유 자석 격자의 중심거리가 지름+`MAG_GAP`=74라
  넓은 반경을 쓰면 "자석 사이 빈틈"에 놓아도 옆 사람과 그룹이 묶였다(2026-07-31 운영진 신고). 좁힌 쪽은
  절반 이상 확실히 겹쳐야 그룹이 되고, 빈틈은 의도대로 `detach`/슬롯 복귀(no-op)로 떨어진다.
- **팀 해체(인원 바닥) — `dissolveIfUnderTwo`**: 유효 인원(anchor + 그 팀 ghost, 중복 제외)이 2명 미만이면 팀을
  해체하고 그 팀 향한 예약을 cascade 삭제한다. **인원이 줄 수 있는 모든 경로와 팀이 생기는 경로**가 이 바닥을 지킨다:
  - anchor가 빠짐: `detachAnchor`(드래그 빼내기·빼기존·보드에서 제거)
  - ghost가 빠짐: 예약 취소 · 재예약(원 팀) · 보드에서 제거 · 휴식 · anchor 승격 시 타 팀 ghost 회수(`attachAnchor`,
    경기완료 `resolveFreedReservations` 포함) · **세션에서 선수 이탈**(`initializeFromPool` — 설정에서 게스트 삭제 등)
  - 팀이 태어남: `commitTeammates`(새 그룹 만들기·자동 채움) — 1명만 남으면 만들지 않고 안내 토스트
  - 원격 수신 경계: `reconcileMembership` 불변식 **I3**(유효 인원 판정은 실제로 살아남는 ghost와 같은 기준으로 센다)
  - 경기중 anchor로 유효 인원이 주는 경우만 예외적으로 `healPlayingAnchors`가 `playingIds`로 판정해 담당
  > **왜 필수인가**: 1인 팀을 남기면 그 선수가 화면에서 통째로 사라진다(2026-07-31 실제 사고). 팀 박스는 렌더
  > 게이팅(`wouldDissolveByPlaying`: 유효 인원 < 2 → 안 그림)으로 사라지는데, 남은 멤버의 자석 `teamId`는 그 팀을
  > 계속 가리켜 자유 자석 필터(`teamId===null`)에서도 빠지기 때문이다. 정렬·새로고침·워치독 어느 것도 복구하지
  > 못하고(현장 우회책은 선수 퇴장→재입장), 편집자면 그 상태가 서버 `board_drafts`로 저장돼 전 기기에 퍼진다.
  > 경기중 anchor 때문에 유효 인원이 줄어드는 경우는 `healPlayingAnchors`가 `playingIds`로 판정해 담당한다.
- **자유 자석 영역은 항상 화면 안**: 그룹 밴드가 화면을 넘겨도 자유 자석 줄의 시작점(`arrange.ts`의 `freeTop`)과
  `computeBounds`의 `minY`를 화면 안으로 상한 처리한다. 안 그러면 `minY > maxY`로 역전돼 클램프에서 minY가 이겨
  **대기 선수 자석이 전원 Stage 밖(y=minY)으로 고정**된다 — 자동 fit의 축소가 구제하지만 `manualLayout=true`인
  편집자(자석을 한 번이라도 드래그하면 켜짐)는 그 경로를 타지 않으므로 배치 자체가 안전해야 한다.
  같은 이유로 원격 멤버십 적용 후의 겹침 정리에는 **코트 레인 하단을 `topMargin`으로** 넘긴다(settle은 코트 카드를
  장애물로 모르므로, 0을 주면 재배치된 자석이 불투명 코트 카드 밑으로 들어가 가려진다).

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

**그룹 3단계 흐름(2026-07 개편)**: `매칭확정 → 경기시작 → 경기완료`.
1. **매칭확정** (`boardStore.confirmTeam(teamId)`): 4명 완성 + `isTeamStartable`인 팀의 CTA. 코트가 없어도 누를 수 있고 `confirmedMs`(epoch ms)를 기록 — 확정 순서(오름차순)가 곧 대기열이다. 확정 팀은 딥블루 박스 + "매칭확정 N번째" 라벨 + CTA 좌측 ✕(확정취소=`unconfirmTeam`). 멤버가 빠져 4명 미만이 되면 자동 해제(`clearConfirmIfBelowFull` — detach/예약취소/휴식/heal 전 경로), 4명이 유지되는 교체·스왑은 순번 보존. `confirmedMs`는 `board_drafts` payload에 동승해 전 클라이언트 동기화.
2. **경기시작**: 확정된 팀의 CTA(주황). 빈 코트가 있어야 활성. **코트가 비면 "다음 경기" 팀(가장 먼저 확정 + 시작 가능, `nextUpConfirmedTeamId`)의 버튼이 반짝여**(550ms 토글 — 연속 애니메이션이 아니라 초당 2회 redraw) 누름을 유도한다. 다른 확정 팀도 시작은 가능(유도이지 강제 아님).
3. **경기완료**: 코트 카드의 CTA(아래 참조). 완료로 코트가 비면 1~2의 derive가 자동 갱신된다.

**경기시작 실행** (`boardStore.startMatch(teamId)`):
1. `isTeamStartable` 가드 + 빈 코트(`courts.find(!match)`) 확인 + `assigningTeamIds` 더블클릭 가드.
2. 4명 → `pairPlayers(four, singleWomanIds, "보드 수동 편성")` 로 `GeneratedTeam`(teamA/teamB 2v2 + gameType) 변환. (`src/lib/teamSelection` 재활용, 신규 분할 로직 0)
3. `await sessionStore.handleAssign(gen, court.id)` → RPC `assign_match` + `match_started` 브로드캐스트.
4. **성공 판정**: `handleAssign`은 `Promise<void>`이므로 await 후 해당 코트의 `match`가 **우리 4명으로 채워졌는지**(선수 집합 일치) 확인. 일치하면 예비팀 dissolve(예약 cascade), 아니면 실패 토스트(낙관적 dissolve 금지 + race 오판 방지).

**경기완료** (`boardStore.completeMatch(courtId)` — `CourtMatchCard`의 버튼):
- `await sessionStore.handleComplete(courtId)` → RPC `complete_match`, 선수 status→waiting, `court.match=null`.
- 4명이 다시 자유 자석으로 → `pushAwayFreeMagnets`로 겹침 정리.

**"버튼이 단계별로 바뀐다"**: 예비팀의 `매칭확정`/`경기시작` 버튼과 코트 카드의 `경기완료` 버튼은 별개 노드. 확정은 같은 박스의 CTA가 초록(매칭확정)→주황(경기시작)으로 바뀌는 상태 전이이고, assign 성공 시 예비팀이 사라지고 같은 보드 위에 `CourtMatchCard`(경기중)가 등장 → "draft → 코트 카드" 전환.

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
- **예비팀 박스**: 확정=딥블루(`TEAM_CONFIRMED_*`) / startable=초록 / 4명이지만 예약자 경기중=보라 / 구성중=회색. **박스 높이는 상태와 무관하게 항상 CTA 영역을 포함** → 시각 박스 = 드래그 히트영역(`geometry.teamRect`/`TEAM_BOX_BELOW`)이 모든 상태에서 일치(구성중 박스가 버튼 높이만큼 작아 히트영역과 어긋나던 문제 해소).
- **박스 상단 라벨**: 상태 + `· by {createdBy}` — createdBy는 "그룹에 사람을 넣은 마지막 편집자"(2명 묶는 시점 기록, 이후 새 멤버 추가 시 갱신 — 제거/팀내 이동/ghost 자동승격은 미갱신). 확정 팀은 "매칭확정 N번째"(`confirmRank`).
- **박스 하단 CTA 버튼**(`TeamBackground`): 라벨은 **팀 상태/액션 기준(편집 권한 무관)** 으로 정한다 — 4명 시작 가능=**"매칭확정"**(초록) / 확정됨=**"경기시작"**(주황, 코트 없으면 "코트 대기") + 좌측 ✕(확정취소) / 그 외는 **누를 것이 없어 회색 비활성 안내**(4명 미만=`N명 더 필요`, 4명이지만 예약자가 경기중=`예약 대기`). 코트가 비면 다음 경기 팀의 경기시작 버튼이 반짝임(`CTA_PLAY_FLASH`). (구 "우선배치" 토글은 2026-07-29 제거 — 점수·행동 효과가 없어 의미가 없었다.)
- **보기 전용(`!isEditor`)**: 버튼은 그대로 렌더하되 **편집자와 같은 라벨을 회색 비활성**으로 보여준다("보기 전용" 같은 별도 텍스트를 쓰지 않음). `ctaEnabled=false`라 클릭 무반응이며 `listening=false`(다만 보기 전용은 팀 자체가 `draggable=false`). 박스 높이는 권한과 무관하게 항상 풀사이즈(시각=히트영역 일치).
- **코트 카드**(`CourtMatchCard`): 호박색, "N번 코트 · 경기중", 멤버 locked(드래그 불가), "경기완료" 버튼.
- **겹침 하이라이트(드래그 중)**: 드래그 중 합류/페어 대상이 되는 자석·그룹을 스카이(`HILITE_STROKE`)로 강조 — 자석은 외곽 링, 그룹은 박스 스트로크/글로우. `resolveDropTarget` 결과를 `hoverTarget`(team|magnet)으로 store에 두고, 각 `PlayerMagnet`/`TeamBackground`가 "내가 대상인가" selector로 구독(대상만 리렌더).
- **'팀에서 빼기' 드롭존**(`DetachZoneOverlay`): 팀 소속(anchor/ghost) 자석을 드래그하는 동안에만 **네비(헤더) 영역**에 점선 로즈 DOM 오버레이로 노출. 칠판(Konva) 위 네비까지 자석을 끌어올려 놓으면 detach(자유)/예약 취소. 칠판 안엔 밴드를 그리지 않는다. 판정 경계는 **칠판 상단(논리 `y ≤ 0` = `isInDetachZone`)** — 자석 중심이 칠판을 벗어나 네비로 올라가야 빠진다("칠판 상단 strip"이 아님). 네비가 칠판 밖이라 자석이 거기서 "출발"할 수 없어 출발-존 가드가 없다. 드래그 안 할 땐 숨김(`dragInfo.detachable`).
- **휴식 드롭존 = 하단 바(`RestBar`) 하나**: 자석을 칠판 하단 경계 너머 바까지 내리면(논리 `y ≥ viewH` = `isInRestField`) **휴식 토글** — 대기자는 휴식 진입, **휴식자는 복귀**. 진입·해제가 같은 존의 대칭 동작이라 바가 hot 점등하며 문구도 "휴식"/"복귀"로 갈린다(`RestDropOverlay`). 칠판 안엔 밴드를 그리지 않고, 존이 칠판 밖이라 자석이 거기서 "출발"할 수 없어 출발-존 가드가 없다(detach와 동일).
- **휴식 선수는 보드에 남는다(2026-07 개편)**: 휴식 진입 시 팀 anchor 해제 + 이 선수를 빌려간 예약(ghost) 취소만 하고, 자석은 **"휴식" 딱지(`MagnetBadge`) + 반투명(`RESTING_OPACITY`)** 으로 자유 자석 격자에 남는다(정렬 순서는 맨 뒤 — `arrangeBoard`). 편성 제외는 별개 경로(`recommendPool`이 `status='resting'` 제외)이고, 드롭 해석도 위치 이동만 허용해(`resolveDropTarget`의 휴식 가드) 팀에 끌어다 놓아도 합류하지 않는다. 해제는 하단 바 재드롭(또는 자석 더블탭)뿐.
  - **왜**: 구 구현은 휴식자를 보드에서 숨기고 탭하면 펼쳐지는 별도 패널(`RestZonePanel`)에만 렌더했다. 선수가 화면에서 사라지자 운영진이 "버그로 없어졌다"고 오인해 **게스트를 중복 추가**하는 사고가 있었다(2026-07-28 세션). 패널·펼침 토글(`restZoneOpen`)·패널 레이아웃 산식(`restZoneHeight`/`restSlotOffset`)은 전부 제거됐다.
- **줌(0.5~1배)**: 우상단 ＋/－ 버튼·휠·핀치로 Stage를 중앙 기준 축소. 콘텐츠만 스케일되고 논리 좌표는 그대로라 정렬·드롭·휴식/빼기 판정은 동일(드래그 좌표는 `absToStage`로 역변환 복원).
  - **수동 조정은 기기에 기억된다**(`userScale`, localStorage `SCALE_KEY` + 수동 표식 `SCALE_LOCK_KEY`). 자동 fit은
    이 값을 **상한**으로만 쓴다 — 자동 확대는 하지 않되(맞춰둔 배율이 매번 풀리던 문제), 내용이 그 배율에 안 들어가면
    축소는 한다. 배율을 고정해 버리면 자유 자석이 그룹 밴드 아래로 밀려 Stage 밖으로 나가 통째로 안 보인다.
    `setAutoScale`은 `userScale`을 건드리지 않으므로 여유가 생기면 사용자 배율로 복귀한다.
  - 값이 변하지 않는 조작(최대에서 ＋, 라운딩에 먹힌 핀치 한 틱)은 잠금으로 취급하지 않는다 — 아무 변화도 없이
    자동 fit이 영구 비활성되는 것을 막는다. 표식 키를 `SCALE_KEY`와 분리한 이유도 같다(구버전 자동 fit이 같은 키에
    값을 써 왔으므로, 저장값 존재만으로 판정하면 기존 기기가 전부 잠긴다).
- **좌상단 ＋ 버튼**: 빈 추천 모달(0명 선택)을 열어 추천 순으로 새 팀을 만든다(`recommendTarget={newTeam:true}` → `commitTeammates({newTeam})`). 편집자만 노출.

---

## 11. 파일 구조

```
src/
├─ components/board/
│  ├─ SessionBoard.tsx     — Stage/Layer. 코트카드+예비팀+자유자석 배치, 드롭 배선
│  ├─ BoardToolbar.tsx     — 뒤로/정렬
│  ├─ PlayerMagnet.tsx     — 자석(anchor/ghost/locked 시각 분기)
│  ├─ TeamBackground.tsx   — 예비팀 박스 + 멤버 + CTA(구성중=자동편성 / 4명=경기시작) + 겹침 하이라이트
│  ├─ DetachZoneOverlay.tsx — 드래그 중 네비 영역 '팀에서 빼기' DOM 오버레이(판정 y≤0)
│  ├─ RestBar.tsx          — 하단 휴식 바(드롭존 + 휴식 인원 표시, 탭 동작 없음)
│  ├─ RestDropOverlay.tsx  — 드래그 중 바텀 바 영역 휴식/복귀 DOM 오버레이(판정 y≥viewH)
│  ├─ CourtMatchCard.tsx   — 경기중 코트(읽기전용) + 경기완료
│  └─ CourtStatusBar.tsx   — 하단 코트 현황 바
├─ lib/board/
│  ├─ dropResolver.ts      — resolveDropTarget 상태머신 (순수)
│  ├─ membership.ts        — teamMembers/deriveLifecycle/isTeamStartable (순수)
│  ├─ geometry.ts          — 슬롯/히트/빼기존(isInDetachZone:y≤0)/휴식존(isInRestField) (순수)
│  ├─ recommendPool.ts     — 추천/자동편성 입력(confirmed·pool·ctx) 빌드 (순수)
│  ├─ konvaEvents.ts       — isSelfDrag/stopTap/absToStage(줌 좌표 역변환)
│  ├─ collision.ts         — settleFreeMagnets (경기중 선수 제외)
│  └─ constants.ts         — 치수/색/예약·빼기존·하이라이트 상수
├─ store/boardStore.ts     — magnets/drafts/reservations + startMatch/completeMatch/autoFillTeam/detachMember/dragInfo·hoverTarget
├─ types/board.ts          — MagnetPosition/DraftTeam/Reservation/TeamMember
└─ lib/teamSelection/pairPlayers.ts — 4명→GeneratedTeam(2v2+gameType) [재활용]
```

---

## 12. 알려진 제약 / 후속

| 항목 | 상태 | 비고 |
|------|------|------|
| 경기중 선수를 예비팀에 신규 예약 | 지원 | 코트 카드 멤버를 끌어내 팀 **빈 슬롯**(또는 자유 자석)에 놓으면 예약(ghost) 생성, 원본은 코트 유지(`handlePlayingMagnetDrop`) |
| 캔버스 persist | 미구현 | 새로고침 시 자석/예비팀 레이아웃 유실(의도) |
| 코트 카드 ↔ 예비팀 위치 겹침 | 해소 | 상단 `COURT_LANE_H` 레인 예약 + 코트 카드를 **맨 위로 렌더**(경기완료 버튼 클릭 보장). 풀/예비팀/자유자석은 레인 아래로 클램프 |
| 팬/줌 | 미구현 | 핵심 아님 |
| 여러 라운드 선계획 UI | 부분 | 예약으로 다음 라운드는 가능, 라운드 인덱스 분리는 후속 |
