# Branch: main

## #1

**Prompt**: 금요일 모이임에서 게스트 취소가 잘못됐는데 롤백되는지 확인. 그리고 게스트취소도 팝업뜨게해줘

**Answer**: _(응답 대기 중…)_

---

## #2

**Prompt**: 아니 순서대오 햐야지 ㅎ히원간통보는 냐가할테니까 디비조작만해줘

**Answer**: _(응답 대기 중…)_

---

## #3

**Prompt**: ㄴㄴ 형일은 다음 유현 취소로 복귀고 이도현이 대기아냐?

**Answer**: 둘 다 완료했습니다.

## 1. 롤백 — 완료 (자동 롤백은 불가, 수동 맞교환으로 처리)

`cancel_guest_attendance`는 이미 커밋된 앞방향 작업이라 트랜잭션 되돌리기가 없습니다. service role로 맞교환 PATCH를 실행했습니다:

1. **이도현** confirmed → waitlisted (`confirmed_at`=null, position 1100 유지)
2. **문병기(G)** cancelled → confirmed (`cancelled_at`=null)

검증: `confirmed_count` 16 == 실제 confirmed 행 16 == 정원 16. 대기는 이도현(1100) → 최양회(1131) 순.

지적하신 대로 강등 대상은 손형일이 아니라 이도현이 맞았습니다. 문병기 취소가 없었다면 16:42 송유현 취소 때 pos 1076인 손형일이 먼저 승급하고 이도현은 대기로 남았을 상태입니다.

두 가지만 남습니다:
- **이도현**은 16:42에 승급 푸시를 이미 받았고(sent=true), DB 직접 수정은 강등 푸시가 나가지 않습니다 → 직접 안내 필요
- 문병기의 카풀 설정은 취소 시 `carpool_role='none'`으로 초기화돼 복구 불가(원래 값이 남지 않음). 카풀 신청이 있었다면 다시 지정해야 합니다

## 2. 게스트 취소 확인 팝업 — 구현 완료

`src/components/schedule/GuestSection.tsx:136` — 취소 버튼이 바로 실행하지 않고 `ConfirmDialog`를 띄웁니다. 본인 참여취소 팝업과 같은 패턴(danger 톤, "닫기"/"참여 취소")이고 상태별로 문구가 갈립니다:

- 확정: "게스트의 참석 신청이 취소됩니다. 대기자가 있으면 그 자리는 바로 다음 순번에게 넘어가고, 되돌릴 수 없어요."
- 대기 / 정원 외 늦참: 각각 해당 문구

타입체크·lint 통과(기존 에러 외 신규 없음). staging까지 해뒀고 커밋·푸시는 안 했습니다 — push하면 GitHub Pages로 바로 배포됩니다.

---

## #4

**Prompt**: 커밋및푸쉬

**Answer**: ✅ 커밋·푸시 완료

- **커밋**: `9af75f9` — "게스트 취소 재확인 팝업 추가" (`src/components/schedule/GuestSection.tsx`, +29 −1)
- **푸시**: `501e076..9af75f9 main -> main` → GitHub Pages 배포 파이프라인이 돌아갑니다
- `.agent-history/`와 `TODO.md`는 요청대로 커밋에서 제외, 로컬 untracked로 남아있습니다

배포 후 실제 반영까지는 Actions 빌드 시간만큼 걸리고, DB 원복(문병기 확정 / 이도현 대기)은 이미 적용된 상태라 앱 새로고침하면 바로 보입니다. 이도현 님 안내만 남았습니다.

---

## #5

**Prompt**: 지금 열린 세션에 보면 오상진이 갑자기 자석이 안보여 왜그럴까

**Answer**: DB는 완전히 정상입니다. 문제는 그 기기의 화면 상태입니다.

**서버 상태 (오상진 = 정상)**
- `session_players`: `waiting`, games=3, 콕 체크 완료
- 진행 중 매치 2개(코트1·코트3) 어디에도 없음, 팀 초안·예약에도 없음
- `load_session_state` RPC도 오상진 포함 16명을 정상 반환

**왜 화면에서만 사라졌나**

자석 위치는 서버에 저장되지 않습니다. `board_drafts`에는 teams·reservations만 있고, 자석은 각 기기가 `sessionPlayers`로부터 만들어냅니다(`useBoardPlayerPool` → `initializeFromPool`). 그래서 자석이 안 보인다 = **그 브라우저의 로컬 상태에만 오상진이 빠져 있다**는 뜻입니다.

`src/store/board/viewSlice.ts:61` 의 자석 생성 effect는 `pool` 참조가 바뀔 때만 재실행됩니다. 반면 `resyncFromServer`는 선수 목록이 실제로 달라졌을 때만 Map을 교체하므로(`playersDiffer`), "로컬 `sessionPlayers`에는 오상진이 있는데 자석만 지워진" 상태에 빠지면 25초 워치독이 돌아도 자석이 되살아나지 않습니다 — 새로고침 전까지 영구 고착입니다.

**지금 당장 할 것**: 그 기기에서 **새로고침**(당겨서 새로고침 또는 앱 재진입)하면 풀 전체로 자석을 다시 만들기 때문에 오상진이 돌아옵니다. 편집자(현재 최양회)가 아닌 기기라면 편성에 영향도 없습니다.

두 가지만 알려주시면 원인을 확정할 수 있습니다:
1. 안 보이는 게 **누구 화면**인가요? (편집자 최양회 기기 / 오상진 본인 / 다른 관전자)
2. 새로고침하면 돌아오나요? — 돌아오면 위 진단이 확정이고, 자석 재생성 effect가 선수 목록 변화 없이도 누락 자석을 메우도록 고치면 됩니다. 안 돌아오면 다른 원인이라 다시 파야 합니다.

---

## #6

**Prompt**: 정렬눌러도도 화면안으로 안들어오둔데?

**Answer**: 원인 후보가 두 개로 좁혀졌고, 둘 다 **정렬로는 절대 안 고쳐지고 새로고침으로만 풀립니다**:

1. **끊어진 팀에 묶인 자석** — 로컬 자석의 `teamId`가 이미 사라진 팀을 가리키면, 자유 자석 필터(`m.teamId === null`)에서 빠져 정렬 대상이 아니고, 그릴 팀 박스도 없어 화면 어디에도 안 나옵니다.
2. **자석 객체 자체 없음** — 풀 동기화(`initializeFromPool`)가 선수 목록이 바뀔 때만 재실행되므로, 서버 선수 목록이 이미 정상이면 25초 워치독이 돌아도 자석을 다시 만들지 않습니다.

두 경우 모두 자가치유가 막히는 공통 이유가 있습니다 — `src/hooks/useSessionBoardEffects.ts:37`:

[코드 블록 생략]

편집자 기기는 자기 편집이 broadcast로 돌아오지 않아(self:false) `boardDrafts` 참조가 그대로고, 그래서 자석-팀 정합을 다시 맞추는 `applyRemoteDrafts`(내부 `reconcileMembership`이 모든 자석 `teamId`를 리셋 후 재구성)가 아예 호출되지 않습니다. 편집자 기기에서만 영구 고착되는 구조입니다.

**지금 하실 것**: 그 기기에서 새로고침하세요. 서버에 저장된 팀 편성(`board_drafts`)은 그대로 남고 자석 위치만 다시 배치되므로, 편집 중이어도 잃는 건 없습니다.

새로고침 후에도 오상진이 안 나오면 그때는 위 두 가설이 모두 틀린 거라 다시 파야 합니다 — 결과 알려주세요. 복구되면 자석 누락/고아 anchor를 정렬 시점에도 메우도록 고치겠습니다(정렬 버튼이 지금은 존재하는 자석만 재배치해서, 운영진 입장에선 가장 자연스러운 복구 수단이 무력한 상태입니다).

---

## #7

**Prompt**: 해로고침해도 안보이니꺼 그얼지

**Answer**: _(응답 대기 중…)_

---

## #8

**Prompt**: ㄴㄴ 퇴장재입장으로 처리한건 버그가 해결되지 않아 저렇게 란거야 저렇게 하니까 다시 나타났어

**Answer**: 중요한 사실이 하나 나왔습니다. **오상진은 그동안 경기를 계속 배정받았습니다** — 30분 전 3판 → 지금 6판. 즉 시스템은 오상진을 정상 인식하고 있고, 편성도 되고 있습니다.

정리하면:

| 확인 항목 | 결과 |
|---|---|
| `session_players` row | 정상 존재 (`waiting`, 6판, 콕 체크 완료) |
| RLS SELECT 정책 | `using (true)` — 로그인 사용자면 전원 조회 가능, 숨김 없음 |
| 서버 스냅샷 응답 | 오상진 포함 정상 반환 |
| 팀 초안·예약 | 오상진 없음 (묶인 팀 없음) |
| 진행 중 매치 | 오상진 없음 (지금은 대기 상태여야 정상) |
| 경기 배정 | 계속 되고 있음 (3판 → 6판) |

서버 쪽은 어디를 봐도 오상진을 숨길 근거가 없습니다. 새로고침으로도 안 나온다면 제가 코드에서 짚은 세 경로(자석 부재 / 고아 팀 / 경기중 판정)로는 설명이 안 되므로, 추측을 더 쌓기보다 화면 정보가 필요합니다.

두 가지만 알려주세요:

1. **다른 기기에서도 안 보이나요?** 한 대에서만 안 보이면 그 기기의 로컬 상태 문제로 확정되고, 모든 기기에서 안 보이면 공유 데이터 쪽이라 방향이 완전히 달라집니다.
2. 안 보이는 게 **대기 자석 영역**인가요, 아니면 **보드 전체 어디에도** 없나요?

급하시면 오상진도 **퇴장 → 재입장**으로 바로 복구됩니다. 노보람·박현아 사례를 보니 재입장해도 누적 판수는 승계되므로(노보람 5판, 박현아 6판 유지) 편성 공정성에 손해는 없습니다.

---

## #9

**Prompt**: 모두에 안보여. 어떻게 해야 모두에게 내가 안보이는 상황이 재현될까?

**Answer**: 원인 확정입니다. **1인 팀에 묶인 선수는 화면에서 완전히 사라집니다.**

세 곳이 서로 어긋나 있습니다:

| 위치 | 동작 |
|---|---|
`TeamBackground.tsx:135` | `wouldDissolveByPlaying` → 유효 멤버 1명이면 `1 + 0 < 2` → **팀 박스를 안 그림** |
`SessionBoard.tsx:75` | 자유 자석은 `teamId === null`만 → 그 1명은 **자유 자석에서도 제외** |
`matchSlice.ts:120` | heal은 "경기중 anchor가 있는 팀"만 처리 → 남은 1명이 경기중이 아니면 **조기 반환, 팀이 영구히 안 해체됨** |

그리고 1인 팀은 서버 `board_drafts`에 저장되므로 **모든 기기에서 동일하게, 새로고침해도 재현**됩니다. 퇴장→재입장이 통했던 이유도 이걸로 설명됩니다 — 새 row는 id가 달라 옛 팀 `memberIds`와 매칭되지 않고(`magnets.has(옛id)=false`), 그 팀이 드롭되면서 새 자석은 자유 상태로 나타납니다.

실측 증거: 노보람이 안 보였던 11:20 시점의 서버 초안이 정확히 `memberIds: [노보람 옛 row]` **1인 팀**이었습니다. (오상진 건은 지금 세션 팀이 0개로 정리돼 그 시점 스냅샷은 못 잡았지만 증상이 동일합니다.)

## 재현 절차

1. 예비팀에 **2명(A·B)** 을 넣는다 (서버에 저장됨)
2. **B만 코트 경기에 투입**한다 — 다른 팀으로 경기 시작하거나 경기 수정으로 로스터 편입
3. `reconcileMembership`의 I2 필터가 경기중인 B를 팀에서 빼내 → **A 혼자 남은 1인 팀**
4. → A가 보드 어디에도 안 보임. 정렬해도 안 들어옴(자유 자석이 아니라 재배치 대상이 아님), 새로고침해도 그대로, 다른 기기도 동일

3명 팀에서 2명을 투입해도 같습니다. 요약하면 **"팀에 남은 사람이 1명이 되는 순간 그 1명이 사라진다"** 입니다.

## 수정 방향

`reconcileMembership`(payload → 로컬 상태 변환)에서 렌더 게이팅과 **같은 규칙**을 적용하면 됩니다 — 유효 멤버 + ghost가 2명 미만인 팀은 만들지 않고 드롭하고, 그 멤버의 자석은 `teamId = null`로 남깁니다. 그러면 1인 팀이 애초에 생기지 않고 남은 1명은 자유 자석으로 정상 표시됩니다. 렌더·상태·정렬이 하나의 규칙을 공유하게 되는 셈입니다.

지금 고칠까요? 정모 중이시면 배포 타이밍은 말씀해 주시고, 당장은 퇴장→재입장으로 계속 우회하시면 됩니다(판수는 승계됩니다).

---

## #10

**Prompt**: 이거 해결함과 동시에, 배율 조정한거 로컬스토리지에 저장해서 매번 그 배율로 나오게 하고, 가끔 그룹에서 바깥으로 드래그하면 이상하게 빈 자리에 두었는데 다른 사람이랑 그룹이 지정될  있어.

**Answer**: ✅ 커밋 완료: **`3ff637c`**

[코드 블록 생략]

**포함된 파일**
- `supabase/migrations/20260806010000_promotion_hardening.sql` (신규)
- `supabase/migrations/20260806020000_freepass_operator_count_revert.sql` (신규)
- `docs/EXPANSION_SPEC.md` — §5.1 정원 판정 규칙 + 프리패스 4케이스, RPC 표 갱신
- `.agent-history/main.md` — 훅이 기록한 #31까지 (히스토리는 훅이 관리하므로 제가 직접 쓰지 않았습니다)

**제외**
- `TODO.md` — 사장님이 적어둔 별건 메모(회비 미납자 alert)라 그대로 미추적으로 남겨뒀습니다. 그 작업 하실 때 같이 커밋하시면 됩니다.

참고: DB에는 두 마이그레이션이 이미 적용되어 있고(직접 push하셨습니다), 이 커밋은 `git push` 하면 프론트만 GitHub Pages로 배포됩니다 — 이번 변경은 SQL·문서뿐이라 프론트 동작에 영향 없습니다.

---

## #11

**Prompt**: 이 컨텍스트에서 수정한것들 울트라코드 사용해서 다시한번 검증해봐

**Answer**: 워크플로우를 백그라운드로 띄웠습니다(13 에이전트, 3단계). 실증 에이전트가 `git stash`로 수정을 임시 되돌려 신규 테스트가 실제로 실패하는지까지 확인하므로, 충돌을 피해 그 사이 파일은 건드리지 않고 기다립니다.

**검증 구성**

| 단계 | 내용 |
|---|---|
Review (5) | I3 불변식 / settle fixedIds / 배율 잠금 / 페어 반경 / 테스트·게스트팝업 |
Verify (5) | 차원별 적대적 검증 — 기본 입장은 회의적, "이론적으로 가능"은 REFUTED |
Integrate (3) | 교차 영향 / 완결성 비평(아직 안 고쳐진 실종 경로) / 실증(tsc·test·lint·build + revert 회귀 확인) |

제가 이미 스스로 잡은 것 하나를 먼저 공유합니다 — **1인 팀 실종을 고치자 "겹쳐서 가려짐"이라는 반쪽 결함이 드러났습니다.** `settleFreeMagnets`가 `excludeIds` 자석을 충돌 대상에서조차 제외해서(`settle.ts:130`), 팀이 드롭되며 keep-out이 사라지면 풀려난 자석이 기존 자석과 좌표까지 완전히 겹친 채 남았습니다(테스트에서 dist=0). 원래부터 있던 결함이고 팀 박스가 우연히 가려주고 있었습니다. `fixedIds`(위치 보존하되 충돌은 고려) + `pushMagnetOffFixed`로 settle 계층에서 고쳤고, 회귀 테스트를 추가했습니다.

완료되면 확정된 결함, 반박된 주장, 남은 갭을 정리해 보고하겠습니다.

---

## #12

**Prompt**: <task-notification>
<task-id>wf40izhzy</task-id>
<tool-use-id>toolu_01AgdJHe3uCiQn1SUw32Y1j4</tool-use-id>
<output-file>/private/tmp/claude-501/-Users-sam-Projects-cocktime-scheduler/69d69550-15ad-43be-9874-aad6cec3f604/tasks/wf40izhzy.output</output-file>
<status>completed</status>
<summary>Dynamic workflow "보드 3건 수정(1인팀 실종·배율 잠금·페어 반경) + 겹침 회귀 수정을 다각도 리뷰 후 적대적 검증" completed</summary>
<result>{"verified":[{"dimension":"i3-invariant","claim":"[high] src/store/board/membershipSlice.ts:169 — ghost(예약)를 없애는 편집자 로컬 경로들이 남은 인원 1명인 팀을 해체하지 않아(clearConfirmIfBelowFull은 확정만 해제) 1인 팀이 로컬에 남고, I3는 이 경로에 절대 적용되지 않아 편집자 화면에서 선수 실종이 그대로 재발한다.","verdict":"CONFIRMED","corrected_claim":"정확하다. 다만 두 가지를 보탠다. ①이 결함은 이번 diff 가 만든 회귀가 아니라 **선행 결함**이고, I3 는 동기 경계만 고쳐 결과적으로 '편집자만 실종, 뷰어는 정상'이라는 기기별 갈림을 새로 만든다(뷰어는 I3 로 드롭, isEditor=false 라 push 하지 않으므로 서버엔 1인 팀이 그대로 남는다: matchSlice.ts:104, draftsSync.ts:79). ②취소 조작이 전혀 없어도 재현된다 — 경기중 g1 을 자유자석 a·b 에 각각 예약(다중 예약, 지원되는 기능)한 뒤 **경기완료**만 하면 resolveFreedReservations 가 가장 오래된 예약 팀에만 승격(draftMutations.ts:144-157)하고 attachAnchor 가 다른 팀 ghost 를 회수(101-108)해, 나머지 팀이 1인으로 남아 b 가 사라진다. 추가로 claim 목록에 없는 restPlayer(membershipSlice.ts:402-419, ghost 를 휴식 처리) 도 동일 결함이다.","reasoning":"실제 스토어로 5개 경로 모두 실행 검증(임시 vitest 프로브, 검증 후 삭제).\n\n경로/라인 근거:\n- membershipSlice.ts:164-171 handleGhostDrop 의 !done 분기 = reservations.delete + clearConfirmIfBelowFull 뿐. clearConfirmIfBelowFull(draftMutations.ts:23-27)은 confirmedMs 만 지우고 팀 해체를 하지 않는다. detachAnchor(draftMutations.ts:82)만 '인원&lt;2 → dissolveDraft' 를 강제한다.\n- 재현 로그(①handlePlayingMagnetDrop(\"g1\",{200,500}) → drafts=[{anchorMemberIds:[\"a\"]}], reservations=[g1→T] ②handleGhostDrop(res,{900,900}) → drafts=[{anchorMemberIds:[\"a\"]}], reservations=[], magnets.a.teamId=T, wouldDissolveByPlaying=true).\n- 실종 확정: TeamBackground.tsx:135 이 wouldDissolveByPlaying 이면 return null 이고, 팀 멤버 자석은 그 Group 의 자식으로만 렌더된다(TeamBackground.tsx:220-330). 자유 자석 목록은 m.teamId===null 만 담는다(SessionBoard.tsx:71-85) → a 는 어디에도 렌더되지 않는다. 코트 카드에도 없다(경기중 아님).\n- 자가치유 없음: healPlayingAnchors(matchSlice.ts:122)는 '경기중 anchor 가 있는 팀'만 처리하므로 continue. 정렬(rearrangeAll→arrangeBoard, lib/board/arrange.ts:42)은 위치만 바꾼다.\n- 서버 고착 + echo 무효: serializeBoardDrafts 가 memberIds=[\"a\"] 로 push(draftsSync.ts:24-52, boardStore.ts:35-43), 되돌아온 payload 는 canonicalizeDrafts(payload)===canonicalizeDrafts(local) 로 matchSlice.ts:45 에서 early-return(프로브에서 true 확인) → I3 미실행. 새로고침 때만 reconcile 이 돌아 복구된다.\n- 같은 결함 재현 확인: cancelReservation(membershipSlice.ts:368-378, 상단 빼기존 드롭 경로 useBoardDragHandlers.ts:112-121), removeMemberFromBoard 의 ghost 분기(384-392), restPlayer(402-419), handleGhostDrop 의 reReserve(153-160), attachAnchor 의 ghostLostTeamIds(draftMutations.ts:101-108, 경기완료 승격 시). 모두 1인 팀 잔존 + 멤버 자석 teamId 유지 로그 확인."},{"dimension":"settle-fixed","claim":"[high] src/lib/board/settle.ts:202 — pushMagnetOffFixed 가 \"마지막으로 겹친 fixed 하나\"로부터 정확히 MIN_MAG_DIST(64) 지점으로 스냅하기만 하므로 128px 미만으로 떨어진 두 fixed 사이에 낀 자석은 (간격−64)px 겹친 채 끝나고, 루프 뒤 findFreeSpot 복구는 팀 박스 겹침만 검사해 자석–자석 잔여 겹침을 고치지 않는다.","verdict":"CONFIRMED","corrected_claim":"기전과 재현성은 사실이다. 다만 두 가지를 교정한다. (1) 좌표 라벨 오류: gap=74 케이스의 최종 위치 (210,400)은 f2(274,400)가 아니라 f1(200,400)과 10px 거리다(잔여거리 = gap−64는 정확). (2) 심각도: 2~10px 잔여(=사실상 은폐)는 '두 fixed 사이 거의 일선상' 기하에서만 나오고, 실제 정렬 격자(74 간격 2차원)에서 재현한 값은 37.8px·45.5px — 겹치지만 완전히 가려지지는 않는다. 또 이번 사고와 달리 자석 teamId 가 null 이므로 [정렬] 한 번으로 사용자가 복구할 수 있어 '영구 고착'은 아니다. 'fixed 순서·기기마다 달라진다'는 부분은 결함이 아니다 — 자유 자석 좌표는 애초에 로컬 전용이라 기기 간 배치가 다른 것이 설계다. 제안 수정 방향(루프 뒤 fixed 겹침까지 findFreeSpot)은 타당하다: 간격 74 격자 내부는 어느 점도 4 이웃 중 하나와 52.3px 이내라 '제자리 밀어내기'로는 원리적으로 해소 불가하고 재배치만이 해법이다.","reasoning":"코드 근거: settle.ts:66-67 이 m 을 fixed 하나로부터 정확히 64 지점으로 스냅(누적/합산 없음) → settle.ts:180-182 가 매 반복 모든 fixed 를 순회하므로 두 fixed 사이에서는 매 반복 moved=true 로 MAX_ITER 8회 소진 후 '마지막으로 처리한 fixed'에서 64, 다른 fixed 와는 (gap−64) 로 종료. settle.ts:203 복구 조건이 isOverlappingAnyTeam(m, teams) 뿐이라 자석–fixed 잔여 겹침은 검사되지 않음(obstacleMagnets 에 fixed 가 있어도 호출 자체가 안 됨).\n실측 1(settle 직접): f1(200,400)/f2(274,400), 사이 진입 → (210,400), d(f1)=10.0. gap 66→2.0, 74→10.0, 80→16.0, 100→36.0, 127→63.0, 128→64.0. 삽입 순서를 f2,f1 로 바꾸면 (264,400) d(f2)=10.0 → 종착점이 fixed 순서 의존.\n실측 2(공개 store API 만 사용한 현실 플로우, 좌표 손대지 않음): 16명 initializeFromPool → rearrangeAll(390,800) 격자(74 간격) → 원격 팀 T1=[p5,p6,p7] 편성(attach 는 m.x/m.y 를 갱신하지 않음: membershipSlice.ts:99-102) → 운영진 [정렬](rearrangeAll markManual)로 격자 재패킹 → p5 가 비운 (114,284) 를 p8 이 차지 → 원격에서 p5 만 제거(applyRemoteDrafts) → p5 최종 (155,303): p8 과 d=45.5, p9 와 d=37.8 로 겹친 채 잔존. 즉 settleFreeMagnets 의 '겹침 없이 안정 배치' 계약이 fixedIds 경로에서 깨지고, 실제 운영 조작(정렬 버튼 + 다른 기기의 멤버십 변경)만으로 도달한다. 매뉴얼 배치(handleDrop 'move' 로 격자 사이에 둔 뒤 팀 합류)로는 격자 사이 착지 = 10px 잔여도 도달 가능."},{"dimension":"scale-lock","claim":"src/store/board/viewSlice.ts:58 — 잠금 신호를 SCALE_KEY 존재로 판정하는데, 구 코드의 자동 fit 이 바로 그 키에 값을 써 왔으므로 배포 직후 기존 기기는 사용자가 배율을 만진 적이 없어도 scaleLocked=true 가 되어 자동 fit 이 영구 비활성된다.","verdict":"CONFIRMED","corrected_claim":"핵심(레거시 SCALE_KEY 를 잠금 신호로 재사용 → 사용자 의도 없이 영구 잠금)은 정확하다. 다만 0.5 로 잠긴 기기의 시각 증상 서술은 부정확하다: arrange 는 viewW/viewH = stage/scale 기준이라 논리 영역이 2배로 넓어지고 자석이 그 넓은 영역에 퍼져 배치된다. 따라서 '좌상단에만 몰리고 화면 절반이 빈다'가 아니라 '자석이 절반 크기로 작게 그려지고 1배로 자동 복귀하지 않는다'가 맞다. 마지막 저장값이 1.0 이면 축소가 안 돼 2번으로 직행한다는 부분은 정확하다.","reasoning":"코드 근거 체인이 모두 성립한다. (1) src/store/board/zoom.ts:24-30 hasSavedScale() 은 SCALE_KEY 파싱 가능 여부만 본다. (2) src/store/board/viewSlice.ts:58 `scaleLocked: hasSavedScale()`. (3) git show HEAD:src/store/board/viewSlice.ts 의 setScale 은 `if (next === get().scale) return;` 뒤에 무조건 localStorage.setItem(SCALE_KEY, String(next)) 를 했다 — 수동/자동 구분이 없다. (4) HEAD 의 useBoardStageLayout.fitAndArrange 는 `setScale(fit); // store가 클램프·영속` 을 호출했다. (5) `git merge-base --is-ancestor ecf22b7 HEAD` 성공 + `git grep setScale(fit) ecf22b7` → SessionBoard.tsx:191 확인 → 이 경로는 프로덕션에 있었다. (6) 자동 fit 이 실제로 1 아닌 값을 쓰는지 실측: arrangeBoard 프로브로 computeFitScale(390,700, groups=6, free=6) = 0.85. 즉 코트4+팀2 규모 세션을 한 번만 겪은 폰이면 SCALE_KEY 가 자동으로 기록돼 있다. SCALE_KEY 를 쓰는 다른 경로는 setScale 뿐이므로(grep 결과 zoom.ts/viewSlice.ts 만) 키만 보고는 수동/자동을 구분할 수 없다. 마이그레이션·삭제 코드도 없다(grep SCALE_KEY 전체 5곳). 결론: 배포 직후 기존 운영진 기기는 사용자가 ± 를 만진 적이 없어도 scaleLocked=true 로 시작하고, useBoardStageLayout.ts:78-81 이 fit 계산을 통째로 건너뛴다."},{"dimension":"scale-lock","claim":"src/hooks/useBoardStageLayout.ts:78 — scaleLocked 면 fit 계산을 통째로 건너뛰어, 잠긴 배율에서 내용이 넘칠 때 자유 자석 전체가 화면 아래로 클램프돼 보이지 않게 된다(구제 장치 없음).","verdict":"CONFIRMED","corrected_claim":"실측 수치까지 정확하다. 한 가지만 보태면 computeBounds 의 minY&gt;maxY 역전 자체는 HEAD 에도 있던 결함이다(manualLayout=true 편집자가 1배에서 정렬 버튼을 누르는 경로). 이번 변경이 만든 것은 '도달성'이다 — 잠긴 기기에서는 뷰어/미수동 편집자에게도 멤버십·코트 변경마다 자동으로 발생한다.","reasoning":"arrangeBoard 를 직접 호출해 실측 재현했다(프로브 후 삭제). 입력: viewW=390, viewH=700(잠긴 scale=1), 경기중 코트 4 + 팀 2 = 그룹 6, 자유 자석 6. 결과: 자유 자석 6명 전원 y=744, bounds={minY:744, maxY:664} — 주장의 숫자와 완전히 일치. cols=floor((390-24+16)/174)=2 → groupRows=3 → groupAreaBottom=10+3*234=712(arrange.ts:59,89,91), settleFreeMagnets 에 topMargin=712 전달(arrange.ts:120) → keepout.ts:35 minY=max(36, 712+32)=744, keepout.ts:37 maxY=700-36=664 → settle.ts:192-194 클램프 Math.max(744, Math.min(664,y)) 가 항상 744. Stage 는 SessionBoard.tsx:170-179 에서 x=0,y=0 고정·draggable 없음, 컨테이너 overflow:hidden(SessionBoard.tsx:160) → y=744 &gt; stageH=700 은 캔버스 밖 = 안 보인다. 대조: 같은 구성에서 computeFitScale 은 0.85 를 반환하므로 HEAD 의 자동 fit 은 축소해 전원 화면 안에 넣었다(요구높이 784 ≤ 823.5-6). 구제 수단도 없음을 확인: arrangeAtCurrentScale(useBoardStageLayout.ts:99-102)은 같은 viewW/viewH 를 쓰므로 정렬 버튼도 무효, 수동 － 뿐. 그룹 8개 실측도 확인: 팀 anchor y 가 111/111/345/345/579/579/583/583 — maxAnchorY=700-117=583 클램프(arrange.ts:63,69)로 3·4행이 4px 차이로 겹쳐 그려진다. 자유 자석은 y=978."},{"dimension":"scale-lock","claim":"src/store/board/viewSlice.ts:121 — setScale 이 클램프 경계의 무반응 조작(최대에서 ＋, 최소에서 －, 스테이지 위 휠 한 틱)에도 잠금을 확정·영속해, 사용자는 아무 변화도 못 본 채 자동 fit 이 영구 비활성되고 그 잠금이 다른 세션까지 따라간다.","verdict":"CONFIRMED","corrected_claim":"무반응 조작이 잠금을 확정·영속한다는 본체는 정확하다. 다만 'reset() 이 scaleLocked 를 안 건드려 다른 세션까지 따라간다'는 별개 결함이 아니다 — 잠금은 localStorage(SCALE_KEY) 기반 기기 전역 설정이라 세션이 바뀌어도 유지되는 게 설계 의도다(loadScale 도 동일). 결함은 '무변화 탭이 잠금을 만든다'는 한 가지뿐이다.","reasoning":"src/store/board/viewSlice.ts:118-140 에서 순서가 실제로 뒤바뀌어 있다: line 119 next=clampScale(...) → line 121 `if (!get().scaleLocked)` 블록이 scaleLocked=true + setItem(SCALE_KEY) 를 먼저 실행 → line 131 `if (next === get().scale) return;` 로 그 다음에 조기 반환. 도달 경로 확인: ZoomControls 의 ＋/－ 버튼(src/components/board/SessionBoardChrome.tsx:103-104)은 disabled 조건이 전혀 없어 최대/최소에서도 눌린다. 신규 기기는 loadScale()=1(키 없음)·hasSavedScale()=false 이
... (truncated 40593 chars, full result in /private/tmp/claude-501/-Users-sam-Projects-cocktime-scheduler/69d69550-15ad-43be-9874-aad6cec3f604/tasks/wf40izhzy.output)</result>
<diagnostics>Per-agent results: /Users/sam/.claude/projects/-Users-sam-Projects-cocktime-scheduler/1071fe4f-7dc2-41d8-8915-9f5e4ad935a5/subagents/workflows/wf_1d9cfb27-e27/journal.jsonl — one {"type":"result",...} line per completed agent with its full return value.
If the result above is empty or unexpected, Read this file BEFORE diagnosing — do not assume agents returned non-empty results.
To re-run with edited post-processing: Workflow({scriptPath: '/Users/sam/.claude/projects/-Users-sam-Projects-cocktime-scheduler/1071fe4f-7dc2-41d8-8915-9f5e4ad935a5/workflows/scripts/verify-board-fixes-wf_1d9cfb27-e27.js', resumeFromRunId: 'wf_1d9cfb27-e27'}) — agents whose (prompt, opts) are unchanged replay from cache.</diagnostics>
<usage><agent_count>13</agent_count><agents_done>13</agents_done><agents_error>0</agents_error><agents_skipped>0</agents_skipped><agents_empty_result>1</agents_empty_result><subagent_tokens>1428359</subagent_tokens><tool_uses>465</tool_uses><duration_ms>2075204</duration_ms></usage>
</task-notification>

**Answer**: 2차 검증을 백그라운드로 돌리는 중입니다. 그동안의 진행 상황을 정리하면:

## 1차 검증 결과 → 조치

에이전트 13개가 확정한 12건 중 **제 수정이 만든 실제 결함이 다수**였습니다.

| 확정 결함 | 조치 |
|---|---|
**I3가 원격 경계에만 있어 편집자 화면에서 실종 재발** (ghost 제거 경로 6곳이 1인 팀을 남김, 경기완료만으로도 재현) | `dissolveIfUnderTwo` 공용 헬퍼로 `detachAnchor`에만 있던 규칙을 6경로에 적용 |
**배율 잠금이 기존 기기를 전부 잠금** (구버전 자동 fit이 같은 키에 값을 써왔음) | 잠금 표식을 `SCALE_LOCK_KEY`로 분리 — 레거시 값만 있는 기기는 미잠금 |
**잠긴 배율에서 자석이 화면 밖으로 사라짐** (실측 y=744 > stageH=700, 정렬 버튼도 무효) | 잠금을 "자동 **확대** 금지"로만 해석 — `Math.min(userScale, fit)`으로 넘칠 때 축소는 허용 |
**no-op 조작(최대에서 ＋)이 자동 fit을 영구 비활성** | early return을 잠금 처리 앞으로 |
**settle이 촘촘한 고정 자석 사이에서 진동, 겹침 오히려 악화**(37.0px→10.0px) | 폴백 조건에 고정 자석 겹침 추가 → `findFreeSpot` 재배치 |
**경기중 자석이 보이지 않는 장애물로 작동** | `fixedIds`에서 playing 제외 |
**코트→대기 경로엔 오그룹이 그대로** | 그 경로도 좁은 반경 적용 |
**하이라이트가 실제 드롭과 갈림**(`restingIds` 인자 누락) | 인자 전달 |

반박된 3건(도달 불가능한 payload, 게스트 팝업 stale 경고 등)은 손대지 않았습니다.

## 실증

구현만 무력화해 테스트가 실제로 실패하는지 확인했습니다 — `dissolveIfUnderTwo` 8건, settle 폴백 1건, I3 4건 실패 후 전부 원복(275개 통과). 테스트가 형식적으로 통과만 하는 게 아님을 확인했습니다.

현재 tsc·lint·build·test 모두 통과 상태이고, **아직 커밋하지 않았습니다** — 정모 중이시라 배포 타이밍은 알려주시면 그때 진행하겠습니다. 2차 검증 결과가 나오면 남은 갭과 함께 보고하겠습니다.

---

## #13

**Prompt**: <task-notification>
<task-id>watpg5fyj</task-id>
<tool-use-id>toolu_01DPuWNAbFTqBLTYpJyB6xtU</tool-use-id>
<output-file>/private/tmp/claude-501/-Users-sam-Projects-cocktime-scheduler/69d69550-15ad-43be-9874-aad6cec3f604/tasks/watpg5fyj.output</output-file>
<status>completed</status>
<summary>Dynamic workflow "1차 검증에서 확정된 결함들을 고친 2차 수정(해체 규칙 6경로·배율 재설계·settle 폴백·반경 확대)을 재검증" completed</summary>
<result>{"verified":[{"dimension":"dissolve-paths","claim":"[high] src/store/board/membershipSlice.ts:277 — commitTeammates 의 새 팀(newTeam) 모드는 1인 팀을 그대로 만들어낸다 — dissolveIfUnderTwo 는 '인원이 줄 때'만 걸려 있고 '팀이 태어날 때' 바닥은 아무도 안 지킨다.","verdict":"CONFIRMED","reasoning":"코드 경로를 끝까지 따라갔고 막는 가드가 없다.\n\n1) 도달성: SessionBoard.tsx:213 `&lt;NewTeamFab onClick={() =&gt; setRecommendTarget({ newTeam: true })} /&gt;` → RecommendTeammateDialog 의 [확인]은 `disabled={selectedIds.length === 0}` (파일 하단 버튼 블록) 이라 1명 선택으로 활성 → handleConfirm(:105) 이 `commitTeammates({teamId: undefined, seedId: undefined, newTeam}, selectedIds)` 호출.\n\n2) 결과: membershipSlice.ts:269-285 newTeam 분기가 anchorId='X' 로 `anchorMemberIds:['X']` 팀을 만들고 `am.teamId = teamId`. 이어지는 :287-293 루프에서 pid='X' 는 `isMemberOf(pid, teamId, ...)`(draftMutations 의 anchorMemberIds.includes) 로 true → continue. 루프 뒤에는 `runSettle(s,{teamId})` 뿐이고 dissolveIfUnderTwo 호출이 없다(2차 수정이 넣은 5자리는 전부 '인원이 주는' 경로). 유효 인원 1.\n\n3) 실종 확인: membership.ts:115-128 wouldDissolveByPlaying = liveAnchors(1) + ghostPlayers(0) &lt; 2 → true → TeamBackground.tsx:134 `if (wouldDissolveByPlaying(...)) return null` 로 팀 박스와 그 안의 멤버 자석이 통째로 렌더 안 됨. X 의 자석은 teamId!==null 이라 SessionBoard.tsx:73-79 자유 자석 필터(`m.teamId === null`)에서도 빠진다 → X 가 화면에서 사라진다.\n\n4) 복구 불가 확인: boardStore.ts subscribe 가 즉시 pushDraftsToRemote → draftsSync 의 `sess.applyDraftsIfNewer(payload, newVersion)` 로 sessionStore.boardDrafts 가 자기 payload 로 갱신 → useSessionBoardEffects:34-40 이 applyRemoteDrafts 를 부르지만 matchSlice.ts:45 `canonicalizeDrafts(payload) === canonicalizeDrafts(serializeBoardDrafts(get()))` 로 early return → I3 가 안 돈다. healPlayingAnchors 는 matchSlice.ts:122 `if (playingIds.size === 0) return` / :126 '경기중 anchor 있는 팀만' 이라 스킵. resync 도 같은 canonical early-return 에 걸려 무효. 새로고침(로컬 drafts 비어 payload 와 달라짐 → reconcileMembership I3, remoteDrafts.ts:82-84)에서만 회복된다.\n\n5) 자동편성 경로도 동일: autoFillTarget(:357-371) 은 ids 가 1개여도 `commitTeammates(target, ids)` 후 '선수가 부족해 1명만 채웠어요' 토스트만 낸다. :364 의 사전 차단은 '전원 경기중'일 때뿐이라 대기 후보 1명 케이스를 못 막는다.\n\n6) 기존 테스트(boardStore.test.ts:658-677)는 newTeam 3명 케이스와 '전원 경기중이면 미생성'만 덮고, 자유 1명 케이스는 없다. seed 모드는 seed + 선택분이라 항상 2명 이상이 되므로 이 구멍은 newTeam 모드 전용이다."},{"dimension":"dissolve-paths","claim":"[high] src/store/board/viewSlice.ts:85 — initializeFromPool 이 ghost(예약)를 지우는 7번째 경로인데 dissolveIfUnderTwo 가 빠져 있다 — 세션 참석자 삭제로 1인 팀이 남는다.","verdict":"CONFIRMED","corrected_claim":"코드 결함(initializeFromPool 의 예약 삭제에 인원 바닥 검사 없음)과 '편집자만 고착' 메커니즘은 사실이나, 트리거는 주장보다 훨씬 좁다. **'참석 취소'로는 도달 불가**(session_players 를 지우는 트리거/코드가 없다 — 마이그레이션 전체 grep 결과 DELETE FROM session_players 는 2026-06 dedup 1회성뿐)이고, **회원 참석자 제외도 도달 불가**(useSetupPlayers.ts:46-53 nonRemovablePlayerIds 가 status='playing' 을 담고 togglePlayer:112 와 PlayerRow disabled 로 차단 — ghost 는 정의상 코트 위 선수라 항상 이 집합에 든다). 유일하게 열려 있는 문은 **게스트 행의 ✕ 버튼**(PlayerRow.tsx:114-117 의 onRemove 가 disabled 게이팅을 안 받는다) → useGuestManager.removeGuest → [세션 업데이트] → updateSession(session.ts:174-186) 의 session_players DELETE. 즉 '경기중인 **게스트**를 ghost 로 빌려 만든 2인 팀'에서 그 게스트를 설정 화면 ✕ 로 지울 때만 재현된다. 또 편집자가 고착되는 최종 원인은 주장이 짚은 `!draftsChanged &amp;&amp; isEditor`(DELETE delta 시점) 뿐 아니라, 그 직후 자기 push 로 서버=로컬이 되어 matchSlice.ts:45 canonical 동일 early-return 이 이후 모든 resync 까지 무력화하기 때문이다. 새로고침이나 세션 재입장으로는 회복된다.","reasoning":"결함 자체는 확인됐다. viewSlice.ts:81-88 제거 루프는 `detachAnchor(s,id)`(ghost 는 magnet.teamId===null 이라 draftMutations.ts:94 에서 즉시 return, no-op) → :84-86 그 선수를 가리키는 예약 전부 삭제 → :87 자석 삭제만 하고, 예약을 잃은 팀의 인원 바닥은 검사하지 않는다. anchor 제거는 detachAnchor 안의 dissolveIfUnderTwo(:107)가 막지만 ghost 제거는 무방비 — 2차 수정이 5자리를 고치면서 여기만 빠졌다.\n\n결과 확인: T(anchor A + ghost G)에서 G 의 예약이 사라지면 유효 인원 1 → wouldDissolveByPlaying true → TeamBackground.tsx:134 렌더 게이팅 → A 의 자석은 teamId==='T' 라 자유 자석 필터에서도 빠짐 → A 실종. s.reservations 가 바뀌었으므로 boardStore.ts subscribe 가 그 1인 팀을 서버로 push 한다.\n\n비대칭 확인: useSessionBoardEffects.ts:37 `if (!draftsChanged &amp;&amp; isEditor) return` 때문에 편집자는 reconcile 을 건너뛰고, 뷰어는 applyRemoteDrafts→reconcileMembership 의 I3(remoteDrafts.ts:82-84, ghostIds 가 `magnets.has(G)` 로 걸러져 effectiveCount=1)로 자가치유한다. 그 뒤 편집자의 push 로 서버 payload 가 로컬과 같아지면 matchSlice.ts:45 early-return 이 걸려 이후 resync/워치독도 무효 — 새로고침 전까지 편집자에게만 A 가 사라져 보인다.\n\n다만 트리거 도달성은 주장이 과장했다. 참석 취소·회원 제외 경로는 각각 위 corrected_claim 의 라인으로 막혀 있고, 게스트 ✕ 만 열려 있다. 이 경로도 세션 재로드(appStore.ts:174 notifySessionRefresh → 각 기기 initialize)로 boardDrafts 가 새 객체가 되지만, 편집자의 push 가 먼저 착지하면(push 는 디바운스 없이 subscribe 에서 즉시) 스냅샷이 이미 1인 팀이라 canonical 동일 early-return 으로 치유되지 않는다."},{"dimension":"dissolve-paths","claim":"[medium] src/hooks/useBoardDragHandlers.ts:66 — ghost 드래그의 하이라이트를 resolveDropTarget 으로 계산하는데 실제 드롭은 handleGhostDrop 이라 규칙이 다르다 — 이번 수정으로 '페어 약속 → 팀 통째 해체'가 됐다.","verdict":"CONFIRMED","corrected_claim":"하이라이트/드롭 규칙 불일치와 '자유 자석 B 에 페어 하이라이트가 켜지지만 결과는 팀 해체'는 재현된다. 그러나 **2차 수정이 만든 새 결함이 아니고, '파괴적으로 틀렸다'는 평가도 과하다**. ghost 자석에 onMagnetDragMove 를 붙인 배선(TeamBackground.tsx:326)과 resolveDropTarget 기반 하이라이트는 이번 diff 에 없는 기존 코드다(TeamBackground.tsx 는 미수정 파일). 수정 **전** 같은 드롭의 결과는 '예약만 삭제 + 1인 팀 잔존 → anchor A 가 화면에서 실종'이었고, 수정 **후**는 '팀 해체 + A 가 자유 자석으로 복귀'다 — 즉 이 경로는 나빠진 게 아니라 좋아졌다. 남은 실제 결함은 '지키지 못할 약속을 하는 거짓 하이라이트' 하나뿐이므로 심각도는 low~medium 이고, 처방(ghost 드래그는 handleGhostDrop 규칙으로 하이라이트)만 유효하다.","reasoning":"불일치는 코드로 확인된다. TeamBackground.tsx:313-327 이 ghost PlayerMagnet 에 `onDragMove={onMagnetDragMove}` 를 주고, usePlayerMagnetDrag.handleDragMove 는 ghost 여부와 무관하게 `onDragMove(playerId, ...)`(선수 id)를 넘긴다. ghost 선수는 코트 위라 magnet.teamId===null 이므로 resolveDropTarget 은 dropResolver.ts:121 이하 '자유 자석' 분기를 타고, 팀 박스 밖이면 :137 nearestFreePartner 를 **기본 PAIR_RADIUS(57.6px)** 로 호출해 `{kind:'createPair', partnerId:B}` 를 반환 → useBoardDragHandlers.ts:71 이 hover={kind:'magnet', id:B} 로 세팅 → PlayerMagnet.tsx:87 isHovered 로 B 에 링이 켜진다.\n\n실제 드롭은 usePlayerMagnetDrag.handleDragEnd 의 `if (isGhost &amp;&amp; reservationId) onGhostDragEnd(...)` → handleGhostDrop(membershipSlice.ts:144-179). 이 함수는 다른 팀 박스 안(reReserve)과 자기 팀 박스 안(스냅백)만 알고, 그 외 좌표는 :167-175 취소 분기 → 예약 삭제 + `dissolveIfUnderTwo(s, fromTeamId)`. T 가 anchor A + ghost G 2인이면 팀이 해체되고 A 가 자유 자석으로 튀어나온다. UI 는 'B 와 그룹'을 약속했는데 결과는 팀 소멸 — 거짓 약속 맞다.\n\n두 번째 지적도 맞다: 꽉 찬 다른 팀 d 의 점유 슬롯 위에서는 dropResolver.ts:132 가 replace 를 돌려 슬롯 링이 켜지지만, handleGhostDrop:155-158 은 `teamMemberCount(d.id) &lt; 4` 가 거짓이라 아무 일도 안 하고 done=true 로 스냅백한다. 4명 미만 팀의 점유 슬롯 위라면 하이라이트는 '교체'인데 실제 동작은 reReserve(이동/추가)라 역시 어긋난다.\n\n다만 '이번 수정으로 파괴적이 됐다'는 인과는 성립하지 않는다. git diff 상 useBoardDragHandlers 변경은 restingIds 인자 추가 한 줄뿐이고, membershipSlice 의 dissolveIfUnderTwo 추가는 이 경로의 결과를 '선수 실종'에서 '팀 해체(선수는 보임)'로 개선했다."},{"dimension":"scale-redesign","claim":"[high] useBoardStageLayout.ts:100 — 2차의 상한 로직은 fitAndArrange 경로에만 들어가서, 편집자가 첫 드래그로 manualLayout=true가 된 뒤에는 '자유 자석 전원 화면 밖' 결함이 그대로 남는다. 정렬 버튼도 무효.","verdict":"CONFIRMED","reasoning":"코드로 전 구간 확인됨.\n\n1) manualLayout 진입: membershipSlice.ts:85-86 의 handleDrop set() 첫 줄이 `s.manualLayout = true`를 **무조건** 실행한다(편집자 분기, target.kind 판정보다 앞). 즉 편집자가 자석을 한 번만 드래그하면(=보드의 기본 조작) 켜진다. 끄는 곳은 viewSlice.ts:284 reset() 뿐이라 세션 내내 유지된다.\n\n2) 자동 fit 영구 중단: useBoardStageLayout.ts:107 `if (manualLayout) return;` 이 effect 전체를 막으므로 2차가 새로 넣은 상한 로직(line 91 `target = min(userScale, fit)`)이 **한 번도 실행되지 않는다**. scale 은 마지막 값(예 1.0)에 고정된다.\n\n3) 그 상태에서 전체 재정렬이 도는 경로가 둘 다 살아 있음:\n   - matchSlice.ts:216 `get().rearrangeAll(get().stageW, get().stageH)` — completeMatch 끝에서 manualLayout 과 무관하게 무조건 실행.\n   - useBoardStageLayout.ts:98-101 arrangeAtCurrentScale(정렬 FAB) — `rearrangeAll(viewW, viewH, true)`, viewW/viewH = stage/scale 로 **같은 뷰**라 결과 동일 → 복구 불가.\n\n4) 좌표 역전 실측(node 로 상수 재계산: TEAM_W=158, ABOVE=101, BELOW=117, GROUP_ROW_H=234): 390x700·scale=1.0·그룹 5개 → arrange.ts:59 cols=2 → line 89 groupRows=3 → line 91 groupAreaBottom=712. arrange.ts:120 이 이 값을 topMargin 으로 settleFreeMagnets 에 넘기고, keepout.ts:35 computeBounds 가 minY=max(36,712+32)=744, maxY=700-36=664 을 만든다(역전). settle.ts:192-193 `Math.max(minY, Math.min(maxY, y))` 에서 minY 가 이겨 **자유 자석 전원이 y=744** 로 간다. Stage 높이 700(Konva Stage 는 캔버스 밖을 렌더 안 함) → 대기 선수 자석이 전부 사라진다. 1차 보고의 실측치 y=744 와 정확히 일치.
... (truncated 24703 chars, full result in /private/tmp/claude-501/-Users-sam-Projects-cocktime-scheduler/69d69550-15ad-43be-9874-aad6cec3f604/tasks/watpg5fyj.output)</result>
<diagnostics>Per-agent results: /Users/sam/.claude/projects/-Users-sam-Projects-cocktime-scheduler/1071fe4f-7dc2-41d8-8915-9f5e4ad935a5/subagents/workflows/wf_80f57674-56d/journal.jsonl — one {"type":"result",...} line per completed agent with its full return value.
If the result above is empty or unexpected, Read this file BEFORE diagnosing — do not assume agents returned non-empty results.
To re-run with edited post-processing: Workflow({scriptPath: '/Users/sam/.claude/projects/-Users-sam-Projects-cocktime-scheduler/1071fe4f-7dc2-41d8-8915-9f5e4ad935a5/workflows/scripts/verify-board-fixes-round2-wf_80f57674-56d.js', resumeFromRunId: 'wf_80f57674-56d'}) — agents whose (prompt, opts) are unchanged replay from cache.</diagnostics>
<usage><agent_count>10</agent_count><agents_done>10</agents_done><agents_error>0</agents_error><agents_skipped>0</agents_skipped><agents_empty_result>0</agents_empty_result><subagent_tokens>1615146</subagent_tokens><tool_uses>463</tool_uses><duration_ms>2902496</duration_ms></usage>
</task-notification>

**Answer**: 검증 2회전 완료했습니다. **제 초기 수정에 실제 결함이 여러 건 있었고, 검증이 그걸 잡아냈습니다.**

## 검증이 잡아낸 것 (23 에이전트, 2회전)

**1차** — 확정 12건. 제 수정이 만든 것들:
- 배율 잠금이 **레거시 localStorage 키를 재사용**해 기존 기기를 전부 잠금 (구버전 자동 fit이 같은 키에 써왔음)
- 잠긴 배율에서 **자석이 화면 밖으로 사라짐** (실측 y=744 > stageH=700)
- no-op 조작(최대에서 ＋) 한 번이 자동 fit을 영구 비활성
- settle이 촘촘한 자석 사이에서 진동해 겹침이 **오히려 악화**(37.0px→10.0px)
- I3가 원격 경계에만 있어 **편집자 화면에선 실종 재발**

**2차** — 1차 수정에 대해 확정 10건:
- **`newTeam` 모드가 1인 팀을 생성** — 해체 규칙을 "인원이 줄 때"에만 걸어서 *팀이 태어날 때*는 무방비였음
- **`initializeFromPool`이 7번째 ghost 경로** — 원래 확정 해제조차 없던 자리라 call-site 열거에서 구조적으로 누락
- **배율 상한이 `manualLayout` 게이트에 막혀 편집자에게 도달 안 함** → 근본은 배율이 아니라 `arrange`/`computeBounds`의 좌표 역전이었음
- **제 settle 폴백이 자석을 불투명 코트 카드 밑으로 밀어 넣음** (최악 95% 가림)

## 최종 조치

근본을 옮겨 잡았습니다 — 배율 경로가 아니라 **`computeBounds`의 `minY > maxY` 역전 방지 + `arrange`의 자유 자석 시작점 상한**으로, `manualLayout` 여부와 무관하게 모든 경로에서 자석이 화면 안에 남습니다. 해체 규칙도 call-site 열거 대신 "인원이 줄거나 팀이 생기는 **모든** 지점"으로 확장했습니다.

`docs/session-board.md`에 경로 목록·반경 비대칭·좌표 상한 근거를 사고 배경과 함께 기록했습니다.

**검증 실증**: 각 수정을 임시 무력화해 신규 테스트가 실제로 실패하는지 확인했습니다 — 해체 규칙 8건, settle 폴백 1건, I3 4건, 화면밖 2건, 신규 가드 2건. 전부 원복 후 **281개 통과**, tsc·build·lint 정상.

## 남긴 것 (오작동 아님, 판단 필요)

- **ghost 드래그 거짓 하이라이트** — 자유 자석에 "페어" 링이 켜지지만 실제로는 팀 해체. 선행 결함이고 이번 수정으로 오히려 개선됐지만(전엔 선수 실종), 약속과 결과가 다릅니다
- **다중 예약 팀이 경기완료 시 조용히 해체** — 안내 토스트가 없습니다. 해체 자체는 렌더 게이팅상 불가피
- **코트→대기 경로에 드래그 하이라이트 없음** — 반경을 좁혀서 "빗나감"이 늘 텐데 피드백이 없습니다

세 건 다 별도 작업 단위라 지금 손대지 않았습니다.

**커밋하지 않았습니다** — 정모 중이시라 배포 타이밍을 알려주시면 진행하겠습니다. 20개 파일, +668/−62입니다.

---

## #14

**Prompt**: 커미밋하소 푸쉬

**Answer**: ✅ 커밋·푸시 완료

- **커밋**: `baf3dc8` — "보드 선수 실종 근본 수정 + 배율 기억 + 빼내기 오그룹 방지" (20 파일, +668 −62)
- **푸시**: `9af75f9..baf3dc8 main -> main` → GitHub Pages 빌드가 돌아갑니다
- `.agent-history/`·`TODO.md`는 공개 저장소라 계속 제외했습니다(로컬 untracked 유지)

배포되면 확인해 볼 것:

1. **오상진·노보람 케이스** — 이제 1인 팀이 아예 만들어지지 않으니 같은 실종이 재발하지 않아야 합니다. 혹시 또 안 보이면 그건 제가 못 잡은 경로이니 알려주세요
2. **배율** — 한 번 맞춰두면 다음 진입에도 유지됩니다. 단 인원이 많아 화면에 안 들어가면 자동으로 축소됩니다(고정하면 자석이 화면 밖으로 나가서 일부러 그렇게 했습니다)
3. **빼내기** — 이제 확실히 겹쳐야 그룹이 되고, 자석 사이 빈틈에 놓으면 의도대로 그룹에서 빠집니다. 코트에서 끌어낼 때도 같은 기준입니다

이번 세션에서 DB 원복(문병기 확정 / 이도현 대기)은 이미 적용돼 있고, **이도현 님 안내**만 남아 있습니다.

앞서 말씀드린 미처리 3건(ghost 드래그 거짓 하이라이트, 다중 예약 팀 해체 안내 없음, 코트 경로 하이라이트 부재)은 손대지 않았습니다 — 오작동은 아니고 별도 작업 단위라, 필요하시면 다음에 진행하겠습니다.

---

## #15

**Prompt**: 8우월되고 8월회비 부과생성듀됐는데 김주영이 7월8월 회비를 동시에 냈어 네가 제안한대로 7월부터 정산하고 부분처리로 하단에 렌더하는데 이거 8월회비정산 어케처리함?

**Answer**: ## 먼저 정정 — 김주영이 아니라 **김영주**입니다

부분 처리로 남아 있는 건 tx **8108 / 7-21 입금 / 10,000원 / 적요 "7월8월김영주"** 이고, 배분은 김영주(32351894…)의 **7월 회비 5,000만** 들어가 있습니다. 잔여 5,000.
김주영(b1a438bc…)은 별개 회원이고 7월 회비는 이미 다른 입금(tx 5254)으로 완납이라 건드리면 안 됩니다.

김영주 8월 회비 부과: `charge 1147` · 2026-08 · 5,000 · **unpaid** (8/1 04:00 KST 생성)

## 처리 방법 — 취소 후 7+8월 한 번에 재확정

부분 처리 섹션은 **읽기 전용**입니다(`ReconcileInbox.tsx:251-270` — 목록만 렌더, 카드 아님). 그래서 잔여를 그 자리에서 더 배분할 UI가 없고, 스펙대로 "취소·재처리는 [회계]에서" 경로를 타야 합니다.

1. **[회계] 원장** → 7월(`/dues/2026-07`) → "7월8월김영주 10,000" 찾아 **[취소]**
   → `dues_cancel_match`가 그 tx의 배분을 **전부** 삭제(7월분 5,000도 풀림) → `unmatched`로 복귀
2. **정산함 7월**(`/dues/2026-07/inbox`) 미처리에 다시 뜸 → 납부자 **김영주** 선택
3. 칩에 **`7월 회비 5,000` + `8월 회비 5,000`** 둘 다 뜹니다 — 미납 칩은 월 무관(크로스먼스) 전체 조회라(`dues.ts:439 fetchUnpaidByMember`) 8월 부과가 생긴 지금은 정상 노출
4. 둘 다 체크 → 합계 10,000 = 입금액 → **[확인]** 한 번 → `matched`

주의 두 가지:
- **자동선택은 8월을 안 잡습니다.** `defaultKeys`의 회비 후보는 입금월(=7월)로 한정(`ReconcileInRow.tsx:138-140`) → 8월 칩은 **손으로** 켜야 합니다. 대신 켜면 금액이 딱 맞아 빨간 mismatch 경고 없이 확정됩니다.
- **입금확인 푸시가 한 번 더 나갑니다.** 취소해도 이미 나간 푸시는 회수 안 되고 재확정 시 `payment_confirmed`가 또 발송돼요. 김영주에게 중복 알림 갑니다(무해).

## 구조적 갭 (원하시면 고칩니다)

서버 RPC `dues_confirm_reconcile`은 이미 **매 배분 직전에 `tx.amount − 기존 배분합`으로 잔여를 재계산**해서 그 안에서만 배분합니다(`20260714010000_dues_confirm_reconcile.sql`). 즉 **부분 처리 tx에 추가 배분하는 건 서버가 이미 지원**하고, 막고 있는 건 프론트뿐입니다. 부분 처리 섹션을 `ReconcileInRow`로 렌더하고 `effectiveAmount`를 `amount − 환불 − 기배분`으로 바꾸면 취소·재확정·푸시 중복 없이 잔여만 8월에 붙일 수 있습니다. 매달 "월말에 두 달치 미리 냄"이 반복될 성격이라 한 번 해두는 게 나아 보이는데, 지금 작업할까요?

---

## #16

**Prompt**: 클럽회계 페이지를 좀 더 자세하게 해서 +금액, -금액을 항목마다 보여줄 수 있으면 보여주고, 26년 6월 이하로는 내려가지 않게 해. (7월에 서비스 시작했으므로.)

**Answer**: 구현 완료. 빌드·테스트 통과(281 tests), 수정 파일 lint 이슈 0.

## 한 것

**1) 항목마다 +금액 / −금액** (`MyLedgerTab.tsx`)
운영진 [회계]의 행 컴포넌트를 `duesUi.LedgerRow`로 승격해 클럽 회계가 같은 걸 쓰게 했습니다. 세부는 **수입·지출이 양쪽 다 있는 항목만** 표시 — 한쪽만 있으면 순액과 똑같은 숫자라 두 번 찍히는 노이즈가 됩니다(운영진 화면의 기존 중복도 같이 정리됨). 실제 7월 데이터로 확인한 모습:

[코드 블록 생략]

**2) 2026년 7월 하한** — `duesText.SERVICE_START_YM`(2026-07) + `publicLedgerMaxYm()` 단일 소스. 왼쪽 화살표는 7월에서 비활성. 오늘(8/3) 기준 상·하한이 모두 2026년 7월이라 양쪽 화살표가 다 비활성인 상태가 정상입니다.

## 보고할 것 두 가지 (프로덕션 데이터 검증 중 발견)

**① 총수입/총지출 줄은 의도적으로 넣지 않았습니다.** 환불이 소스 입금과 상쇄되는 설계(§3.3) 때문에, 7월은 환불 6건 53,000원이 상쇄되어 **항목 +합(1,784,055) ≠ 통장 총수입(1,837,055)**입니다. 순액만 불변식으로 정확히 맞습니다(항목 순액 합 = −212,995 = income−expense ✓ 검증). 총액 줄을 넣으면 회원 눈에 "합이 안 맞는 표"로 보여서 뺐습니다.

**② 확인 안 된 5,000원 불일치가 있습니다 — 7월만.**
`dues_public_ledger`의 income이 통장 원장 직접 합보다 **정확히 5,000원 적습니다**(RPC 1,837,055 vs 원장 1,842,055). 6월·8월은 일치. 그래서 **운영진 [회계] 요약(원장 직접 계산)과 클럽 회계(RPC)가 지금 5,000원 어긋납니다.**

조사 결과: 월 경계(KST)·status·환불 태그·중복행·미적용 마이그레이션 모두 원인 아님(`migration list` 로컬=원격 전부 적용). 저장소의 `20260716010000` 함수 본문으로는 이 결과가 나올 수 없어서, **배포된 함수 본문이 저장소와 다를 가능성**(대시보드 SQL 에디터 핫픽스 등)이 남습니다. DB 직접 접속(psql/db dump 비밀번호)이 없어 함수 본문을 못 읽어 여기서 멈췄습니다. 원하시면 `supabase db dump`용 DB 비밀번호를 주시거나 대시보드에서 `pg_get_functiondef` 결과를 붙여 주시면 근본 원인까지 짚겠습니다.

---

## #17

**Prompt**: pg_get_functiondef 를 어떻게가져와

**Answer**: 원인을 잡았습니다. 먼저 질문에 답하고, 그다음 결과를 보고합니다.

## `pg_get_functiondef` 가져오는 방법

Docker 없이, 이미 로컬에 있는 것만으로 됩니다. `~/.supabase/access-token`(PAT, `supabase login` 때 저장됨)으로 Management API의 read-only SQL 엔드포인트를 때리면 됩니다.

[코드 블록 생략]

포인트 세 개:
- `read_only: true` — 읽기 전용 트랜잭션으로 실행되니 실수로 뭘 바꿀 수 없습니다.
- **User-Agent 필수** — 기본 `python-urllib`/빈 UA는 Cloudflare가 403(error 1010)으로 막습니다.
- `supabase db dump`는 Docker 데몬이 필요해서(pg_dump를 컨테이너로 돌림) 지금 환경에선 실패합니다. 이 경로가 Docker·psql·DB 비밀번호 전부 불필요.

다른 방법은 대시보드 SQL Editor에 같은 쿼리를 붙이는 것(설정 0), 또는 `brew install libpq` 후 psql로 붙는 것(DB 비밀번호 필요)입니다.

## 그래서 5,000원의 정체 — 함수는 저장소와 동일했고, **월말 경계 계산이 틀렸습니다**

배포 본문 = 마이그레이션 본문(동일 확인). 범인은 이 두 줄입니다:

[코드 블록 생략]

`v_start`는 UTC로 **전월 말일 15:00**입니다. 여기에 `interval '1 month'`를 더하면 UTC 기준 "같은 일(日)"로 가므로 **6월 30일 → 7월 30일** 15:00 = KST 7월 31일 00:00. 즉 7월 창이 `[7/1 00:00, 7/31 00:00)`이 되어 **7월 31일 하루가 통째로 빠집니다.** 누락된 게 그 5,000원(id 10172, 강하진, 7/31 14:03 입금)이었습니다.

- SQL로 같은 창을 재현 → 217건/1,837,055 (함수와 동일), PostgREST로 올바른 창 → 218건/1,842,055.
- 6월·8월이 맞았던 건 **우연**입니다(5/31+1M=6/30 ✓, 7/31+1M=8/31 ✓).
- 규칙: 전월 말일이 30일인 달 = **5·7·10·12월은 말일 하루 누락**, 3월은 **마지막 3일 누락**(2/28+1M=3/28). 매년 반복됩니다.
- 영향 범위: 운영진 [회계]는 클라이언트에서 원장을 직접 합산하므로 정상, **RPC를 쓰는 클럽 회계(회원 공개 화면)만 틀립니다.** 그래서 두 화면이 5,000원 어긋났던 것.

한 줄 수정으로 끝납니다 — 함수에 `SET TimeZone TO 'Asia/Seoul'`을 추가하면 `+ interval '1 month'`가 KST 로컬 기준으로 계산돼 모든 달이 맞습니다(`v_start`/`at time zone 'Asia/Seoul'`는 명시적이라 영향 없음).

같은 패턴이 다른 회계 함수에도 있는지 훑고 마이그레이션을 작성할까요? 프로덕션 `supabase db push`는 확인받고 진행하겠습니다.

---

## #18

**Prompt**: 확인하고

**Answer**: 확인 결과입니다.

## 1. 배포 함수 = 저장소 마이그레이션 (동일)

`pg_get_functiondef` 본문과 `20260716010000_public_ledger_refund_net.sql` 본문을 diff한 결과 차이는 `as`/`AS` 대소문자와 끝 세미콜론뿐입니다. **대시보드 핫픽스 같은 건 없었고**, 버그는 저장소 코드 그대로였습니다. 제가 앞서 "배포 본문이 다를 가능성"을 의심한 건 틀렸고, 원인은 코드 자체의 월말 경계 계산이었습니다.

## 2. 버그 범위 — `dues_public_ledger` **한 곳뿐**

DB 함수 전수 조사(`prosrc`에 `interval '1 month'` · `+09` · `Asia/Seoul` 포함 9개, `occurred_at` 사용 2개):

| 함수 | 월/일 계산 방식 | 판정 |
|---|---|---|
| `dues_public_ledger` | `timestamptz + interval '1 month'` | **✗ 버그** |
| `dues_defer_charge` | `(ym‖'-01')::date + interval '1 month'` | ✓ date 연산 |
| `dues_generate_monthly` | `(…)::timestamp + interval '1 month'` | ✓ timestamp(TZ 무관) |
| `dues_my_payments` | `occurred_at at time zone 'Asia/Seoul'` 그룹핑 | ✓ 창 자르기 없음 |
| `generate_dues_charges` · `dues_generate_session_court` · `session_guest_cap` · `reveal_horizon_kst_date` · `sync_schedule_occurrences` | 전부 `at time zone 'Asia/Seoul'` 명시 | ✓ |

클라이언트도 확인 — `dues.ts:77 ymRangeKst()`는 ym에서 달을 직접 증가시켜 양쪽 경계에 `+09:00`을 붙이므로 정상입니다. 그래서 운영진 [회계]만 맞고 회원 [클럽 회계]가 틀렸습니다.

## 3. 실제 누락액 (월별 실측)

버그 창끝 ↔ 정상 창끝 사이 구간의 거래를 전부 집계:

[코드 블록 생략]

예측한 규칙(**5·7·10·12월 말일 1일 누락, 3월 마지막 3일**)이 그대로 재현됐습니다. 실제 금전 피해는 7월 5,000원 1건이고, 고치면 7월 공개 회계가 **총수입 1,842,055 / 미분류 +5,000(10,000) / 남은 돈 −207,995**로 바뀝니다(현재 −212,995). 이 5,000원은 아직 `unmatched`라 **정산함에서 납부자 지정이 안 된 건**이기도 합니다 — 고치면 미분류로 드러납니다.

## 4. 마이그레이션 작성 완료 (미적용)

`supabase/migrations/20260803000000_public_ledger_month_end_fix.sql` — 함수 본문은 그대로 두고 `v_end` 한 줄만:

[코드 블록 생략]

`search_path to ''` + `public.` 한정은 그대로 유지했습니다(sync 불변식). 새 식은 2026-01~2027-03 15개월에 대해 전부 "다음 달 1일 00:00 KST"와 일치함을 읽기 전용 SQL로 검증했습니다. 테스트 281개 통과.

`supabase db push`로 프로덕션에 적용할까요? 적용하면 회원 화면 7월 수치가 위 값으로 바뀝니다.

---

## #19

**Prompt**: 적용하고 전부배포

**Answer**: 전부 적용·배포 완료했습니다.

## 배포 결과

| 대상 | 방법 | 상태 |
|---|---|---|
| DB 마이그레이션 | `supabase db push` | ✅ `20260803000000_public_ledger_month_end_fix` 적용 |
| 프론트엔드 | `git push` → GitHub Actions Deploy | ✅ success (1m26s), https://ckti.me/ 200 |
| Edge Function | — | 변경 없어 배포 불필요 |

커밋 `a4630e6`.

## 적용 후 실측 검증 (프로덕션 RPC 재조회)

[코드 블록 생략]

- 7월 총수입이 1,837,055 → **1,842,055**로 교정(원장 합과 일치). 남은 돈 −212,995 → **−207,995**.
- 누락됐던 7/31 입금 5,000원이 **미분류 10,000원**으로 드러났습니다. 이 건은 아직 `unmatched`이니 **정산함에서 납부자(강하진, 7/31 14:03) 지정**해 주시면 미분류에서 빠집니다.
- 세 달 모두 항목 순액 합 = 이 달 남은 돈(현금주의 불변식) 통과.

## 회원 화면에 반영된 것

- 항목마다 들어온/나간 돈 세부 표시 — 예: `07-12 TK배드민턴아레나 대관비  +138,000 −180,000  −42,000원`. 한쪽만 있는 항목은 순액과 같은 숫자라 세부를 생략합니다(운영진 [회계]의 기존 중복 표기도 함께 정리).
- 월 스테퍼 하한 2026-07. 오늘 기준 상·하한이 모두 7월이라 양쪽 화살표가 비활성인 게 정상입니다.

## 참고

- `TODO.md`(회비 미납 alert 아이디어 메모)는 제 작업과 무관한 미추적 파일이라 커밋하지 않았습니다.
- 재발 방지용으로 KST 월 창 계산 규칙을 메모리에 남겼습니다 — 앞으로 회계/집계 함수를 쓸 때 창 끝 계산부터 점검합니다.

---

## #20

**Prompt**: 목요일 입장 15명이고 정원 16명인데 대기가 안올라갔네? 이유분석

**Answer**: 배포 검증 완료 — 그리고 **감사 로그가 실제 사용에서 작동하는 걸 확인했습니다.**

## 원복 확인

| 함수 | 프리패스 기준 | ③ 유지 |
|---|---|---|
| `promote_next_waitlisted` | ✅ `v_ocount`(운영진 총수) | ✅ |
| `join_session` | ✅ `v_ocount` | ✅ |
| `set_late_minutes` | ✅ `v_ocount` | ✅ |
| `set_session_capacity` | ✅ `v_o < 2`(누계) | ✅ |

잘못된 초과분 기준(`- v_capacity) < 2`)은 4개 함수에서 전멸, `skip locked`도 전멸, 카운터 드리프트 0건입니다.

## 감사 로그 실제 기록 (방금 회원들이 취소한 것)

[코드 블록 생략]

**이게 이번 사고 조사에서 없던 바로 그 정보입니다.** 취소와 카운터 감소가 같은 `txid`로 묶여 있고, `POST /rpc/cancel_attendance`(앱 경로)까지 찍힙니다. 8/3 15:06 사고 때 이 로그가 있었다면 "취소는 있는데 counter 줄이 없다"가 한눈에 보였을 겁니다. 이후 취소 2건 모두 정상(카운터 = 실제)입니다.

참고로 8/6 22:04 백필 줄(`postgres`, req_path 없음 = 마이그레이션)이 세션 159의 **22→21 유령 자리를 제거**한 기록으로 남아 있습니다.

## 지금 상태

| 세션 | 정원 | 확정 | 대기 | 초과 | 확정 운영진 |
|---|---|---|---|---|---|
| 8/7(금) | 16 | 16 | 8 | 0 | 2 |
| 8/8(토) | 24 | 0 | 0 | 0 | 0 |
| 8/9(일) | 30 | 27 | 0 | 0 | 2 |

8/7 금요일이 정확히 말씀하신 ①케이스입니다 — 만석 16 + 확정 운영진 2명. 대기에 운영진이 있어도 대기 유지되고, 누가 취소하면 대기 1순위가 그대로 올라갑니다.

## 남은 것

1. **승격 루프의 프리패스** — 취소 1건에 2명(정원 1 + 프리패스 운영진 1)이 들어올 수 있는 부분. 그대로 둘지, 프리패스는 본인이 직접 신청할 때만 적용할지 알려주세요.
2. **4번**(정원·장소 직접 PATCH 차단) 진행 여부.
3. 팬아웃 리뷰 — 오전 4시 이후 재실행 권장(이미 배포됐으니 사후 검증). 놓친 결함이 있으면 조기에 잡힙니다.

커밋은 안 했습니다. 스테이징만 되어 있습니다(마이그레이션 2개 + `docs/EXPANSION_SPEC.md`).

---

## #21

**Prompt**: go on

**Answer**: ## 결론

목요일(08/06, 세션 84)은 **서버가 계속 "만석 16"으로 알고 있었습니다.** 실제 확정은 15명이었지만 정원 판정의 근거인 `session_counters.confirmed_count`가 16으로 남아 있어서, 빈자리 1칸이 있어도 승격이 완전히 정지했습니다.

지금은 **16/16으로 메워진 상태**입니다 — 오늘 21:12:23에 심유진이 승격됐고 푸시도 나갔습니다(대기는 10명, 1번은 오용진).

## 증거 체인

**① 구멍이 뚫린 시점 = 08/03 15:06:07, 엄지현(운영진) 취소**
그 세션의 확정자 취소 7건 중 6건은 같은 초에 정확히 1명 승격 + 푸시가 나갔습니다. 유일한 예외가 이 건입니다 — 당시 대기 15명, 빈자리 1칸이었는데 승격 0명, 알림 0건.

**② 카운터가 줄지 않았다는 직접 증거**
15:06 **이후** 참여한 6명(김재완 22:32, 김혜영, 이후섭, 최두호, 정진환, 최대현)은 실제 확정이 15명(정원 16)인데도 전원 대기로 접수됐습니다. `join_session`은 카운터로만 판정하므로, 카운터가 16이었다는 뜻입니다. 반대로 15:06 **이전** 대기 접수는 모두 실제 만석(16/16) 상태여서 정당했습니다.

**③ 코드·배포 버전 문제가 아닙니다**
- 같은 사람이 **19초 뒤(15:06:26)** 금요일 세션(93)을 취소했을 때는 김선예가 정상 승격 + 푸시.
- 같은 날 08:47 남필립(운영진) 취소도 정상 승격.
- 운영진 프리패스 마이그레이션(20260726110000)은 프로덕션에 적용돼 있고(`session_op_free` 호출 확인), 운영진 취소 20세션을 검사해도 계통적 누락은 없었습니다.

**④ 그러면 그 한 건은 무엇이었나**
`attendances`에는 SELECT 정책만 있어 클라이언트 직접 수정이 불가합니다(`20260621020000_attendances_and_notifications.sql:56`). RPC를 탔다면 그 행은 confirmed였으므로 카운터가 **반드시** 감소했어야 합니다(`20260726110000_operator_freepass_capacity.sql:225`). 남는 설명은 하나 — **그 행이 RPC를 우회해 직접 cancelled로 바뀐 것**(서비스키/Supabase 대시보드 테이블 에디터/스크립트). 그 경로는 카운터·승격·푸시를 모두 건너뜁니다.

## 왜 30시간이나 고착됐나 (구조적 원인)

1. **정원 판정의 권위가 별도 카운터 하나** — 실제 행과 어긋나도 감지 장치가 없습니다.
2. **승격은 취소 1건당 최대 1명** — `promote_next_waitlisted`가 단발 호출이라, 이후 취소마다 1:1로만 채워지고 구멍은 그대로 남습니다.
3. **자동 재정합이 없음** — 관리자가 정원을 다시 저장(`set_session_capacity`)할 때까지 유지됩니다. 오늘 21:12 승격이 바로 그것입니다(취소 없이 발생한 유일한 승격 + 카운터 재설정).
4. **화면은 실제 행으로 순번을 계산** — `waitStatus.ts:45`가 "대기 1번"을 보여주니 곧 올라갈 것처럼 보이는데, 서버는 만석으로 판단합니다.

## 같은 원인의 다른 흔적

- **세션 159(08/03 월, 정원 24)**: 지금도 카운터 22 vs 실제 확정 21(+1 불일치). 그날 11:03 장성찬 참여 때는 실제 확정 21/정원 24인데 대기로 접수됐습니다 → 그 시점 드리프트가 **+3 이상**이었고, 11:30 정원 재저장으로 풀렸다가 다시 +1이 쌓였습니다. 종료된 세션이라 실질 피해는 없습니다.
- 나머지 open 세션(93·102·106)과 최근 종료 세션은 현재 카운터가 실제와 일치합니다.

## 권고

1. **참석 행 직접 수정 금지** — 관리자 제외도 `admin_cancel_attendance` RPC로. 대시보드 편집은 카운터·승격·푸시를 모두 건너뜁니다.
2. `promote_next_waitlisted`를 **빈자리 수만큼 루프 승격**으로 (한 번에 여러 칸 복구).
3. 정원 판정을 카운터 대신 **실제 `count(*)`** 로 (락은 지금처럼 `session_counters` 행으로 유지) → 드리프트가 원리적으로 불가능해집니다.
4. open 세션 카운터 **주기 검증 + 자동 재정합 + 불일치 로깅**.

3·4번은 원하시면 바로 구현하겠습니다. 이번 분석 내용은 메모리에 남겨뒀습니다(`waitlist-promotion-counter-drift`).

---

## #22

**Prompt**: 쉽게말해봐

**Answer**: ## 쉽게 말하면

앱에는 "확정 인원 카운터"라는 **숫자 하나**가 따로 있습니다. 자리가 남았는지는 실제 명단을 세는 게 아니라 이 숫자만 보고 판단합니다.

8월 3일 오후 3시 6분, 엄지현님 목요일 참석이 취소될 때 **명단에서만 빠지고 이 숫자는 16에서 안 줄었습니다.**

그래서:
- 실제 명단 = 15명
- 앱이 아는 숫자 = 16명 → "만석"

앱은 만석이라고 믿으니 대기자를 아무리 올려야 하는 상황이어도 안 올립니다. 화면엔 15/16으로 보이는데 서버는 꽉 찼다고 생각하는, 엇갈린 상태로 30시간 방치된 겁니다.

**왜 저절로 안 고쳐졌나**: 승격은 "누가 취소하면 1명"만 올립니다. 그 뒤로 취소가 5번 더 있었지만 그때마다 1명씩만 채워서, 처음에 뚫린 1칸은 계속 빈 채로 남았습니다.

**왜 그 취소만 그랬나**: 앱의 정상 취소 버튼은 숫자까지 같이 줄여줍니다. 실제로 같은 분이 **19초 뒤에 금요일 일정을 취소했을 때는 정상 작동**했고요. 그 목요일 한 건만 앱을 거치지 않고 **DB를 직접 고친 흔적**입니다(Supabase 대시보드에서 직접 상태를 바꾸면 숫자·승격·푸시가 다 건너뛰어집니다).

**지금 상태**: 오늘 저녁 9시 12분에 누군가 관리자 화면에서 정원(16)을 다시 저장했고, 그때 앱이 명단을 다시 세면서 심유진님이 승격됐습니다. 지금은 16/16 정상입니다.

**앞으로**:
- 참석자 제외는 꼭 앱의 관리자 기능으로 (DB 직접 수정 금지)
- 빈자리가 2칸이면 2명 올리도록 고치기
- 아예 "숫자" 대신 실제 명단을 세게 바꾸면 이 문제가 원천적으로 사라집니다

마지막 두 개는 말씀하시면 바로 작업하겠습니다.

---

## #23

**Prompt**: 아냐 앱에서한거야. 디비직접안건드렸어.

**Answer**: 제 앞 설명이 틀렸습니다. 앱에서 하신 게 맞고, 진짜 원인은 다른 곳입니다. 결정적 증거를 찾았습니다.

## 진짜 원인: **정원이 16이 아니라 15로 되어 있었습니다**

15명이 "만석"이었던 겁니다. 그래서 대기가 안 올라간 건 앱 입장에선 정상 동작이었습니다.

**증거 1 — 오늘 21:12에 정원 저장이 실행됐습니다.**
목요일 회차의 sessions 행과 심유진 승격이 **똑같은 트랜잭션 번호(266853)** 로 기록돼 있습니다. 정원과 참석자를 한 트랜잭션에서 함께 건드리는 함수는 `set_session_capacity`(정원 저장) 하나뿐입니다.

**증거 2 — 그 함수는 "정원 값이 이전과 다를 때만" 호출됩니다.** (`adminScheduleStore.ts:142`)
21:12에 16을 저장해서 그게 호출됐다는 건, **직전 값이 16이 아니었다**는 뜻입니다. 참여자들이 대기로 접수된 걸 역산하면 그 값은 15입니다.

**증거 3 — 정원 15로 앉히면 모든 기록이 맞아떨어집니다.**
- 8/3 15:06 엄지현님 취소 → 확정 16→15 = 정원 15 딱 만석 → 승격 없음 (정상)
- 이후 참여한 6명 전원 대기 접수 (정상)
- 이후 취소가 날 때마다 정확히 1명씩만 승격 (정상, 15명 유지)
- 오늘 21:12 정원 16으로 저장 → 즉시 1명 승격 + 푸시

**증거 4 — 목요일 회차만 `is_overridden = true`** (개별 편집된 흔적). 그 주 다른 회차(금·토·수·월·화)는 전부 false입니다.

## 그럼 정원은 왜 15가 됐나

이게 실제 버그로 보이는 부분입니다. 회차 편집 저장에는 두 경로가 있습니다:

- 정원이 **바뀌면** → `set_session_capacity` RPC (재조정 + 승격/강등 + 알림, 안전)
- 정원이 **안 바뀌었다고 판단되면** → sessions 테이블에 **정원을 직접 덮어쓰기** (재조정·알림 없음)

두 번째 판단은 **앱이 캐시하고 있는 값**과 폼 값을 비교합니다. 앱을 오래 열어둔 상태(PWA)에서 캐시가 실제 DB와 어긋나면, "안 바뀌었다"고 보고 **캐시의 옛 값을 DB에 조용히 덮어씁니다** — 강등도, 알림도, 카운터 재계산도 없이.

정원 16→15가 정상 RPC를 탔을 리는 없습니다. 그랬다면 정원 초과분 1명(김선예님)이 대기로 강등됐을 텐데, 그분 확정 시각은 8/3 08:47:47 그대로입니다.

**여쭤볼 것**: 8/3 낮에 목요일 회차를 편집하신 적 있나요? (공지·시간·장소 무엇이든 저장했으면 이 경로를 탑니다.) 아니면 정원을 15로 직접 바꾸신 기억이 있나요? 전자면 위 버그가 확정입니다.

## 곁가지로 발견된 것

월요일(8/3) 회차의 정원 카운터가 실제보다 1 많습니다(22 vs 21). 오늘 오후 1시 4x분에 그 **종료된** 회차의 정원이 저장됐는데, `set_session_capacity`는 정원을 먼저 쓰고 나서 "open이 아니면 그냥 반환"하기 때문에 카운터가 재계산되지 않습니다. 종료된 회차라 실害는 없지만 같은 계열의 구멍입니다.

## 고칠 것 (원하시면 바로)

1. 정원은 **항상** `set_session_capacity`로만 쓰기 — 직접 PATCH에서 capacity 제거 (캐시 비교 자체를 없앰)
2. 승격을 빈자리 수만큼 루프로
3. `set_session_capacity`가 open이 아닐 때는 정원도 쓰지 않도록(또는 카운터까지 정합)

메모리도 잘못 적었던 내용을 이 결론으로 고쳐두겠습니다.

---

## #24

**Prompt**: 서버데이터를 직접 바꾼적 없음. 운영진이 빠지면서 참여운영진이 1명이 된 부분이 버그를 일으킬 수 있을까?

**Answer**: ## 답: 프리패스는 그 순간 실제로 열렸습니다 — 그리고 그게 **결정적 열쇠**입니다 (원인은 아니지만)

15:06:07에 엄지현님이 빠지면서 확정 운영진이 최양회님 1명이 됐고, `promote_next_waitlisted`의 승격 조건은 OR입니다:

[코드 블록 생략]

그 순간 **대기자 명단에 정현민님(운영진)이 있었습니다.** 두 번째 절이 열렸으니 **정원이 몇이든, 카운터가 몇이든 정현민님은 승격 대상**이었습니다.

그런데 아무도 안 올라갔습니다(정현민님 실제 승격은 이튿날 8/4 18:18, 오영길님 취소 순번으로).

⇒ **승격 함수가 호출조차 되지 않았습니다.**

## 그래서 앞선 제 "정원이 15였다" 설명은 폐기합니다

정원이 15였어도 프리패스로 정현민님이 그 자리에서 올라갔어야 하니까요. 정원은 16 그대로였습니다. 두 번 틀린 설명 드려 죄송합니다.

## 확정된 사실

코드에서 승격 호출과 **카운터 감소는 같은 `if (이 사람이 confirmed였나)` 블록 안**에 있습니다. 승격이 호출되지 않았다면 카운터도 줄지 않았습니다. 그리고 그게 관측과 정확히 맞습니다:

- 카운터 16 / 실제 확정 15 → **유령 1칸**
- 15:06 이후 참여한 6명 전원 대기 접수 (카운터가 만석이라)
- 이후 취소마다 딱 1명씩만 승격 (16→15→승격→16, 실제는 계속 15)
- 오늘 21:12 정원 저장 → 실제 명단으로 재계산 → 심유진님 승격 + 카운터 16

## 배제한 것들 (프로덕션에서 직접 확인)

- 배포된 함수 8개 본문을 DB에서 그대로 읽어 저장소 코드와 **동일** 확인 — 구버전 운영진 가드 잔재 없음
- attendances·session_counters에 트리거 **없음**
- cron 작업은 주간 reveal 하나(일요일 18:00)뿐
- Edge Function은 send-push / ingest-bank-email 둘뿐 (참석 미접촉)
- 성남실내체육관 대관비 게이트는 오래전부터 false → 그 시점에도 프리패스 조건 성립
- 그 행은 late_pool이었던 적도, 강등된 적도 없음(confirmed_at 08/02 18:01:34 그대로)
- 그 시각 승격이 정말 없었음 — 순번 1번이던 성준호님은 알림을 지우는 분이 아닙니다(8/3 20:42, 8/4 14:23 알림 남아있음). 8/3 15:06 알림만 없습니다.

**남은 갭**: "행은 취소됐는데 카운터는 그대로"는 배포된 코드 경로로는 재현이 안 됩니다. 참석 상태 변경 이력이 남지 않아 여기서 더 못 갑니다.

## 다만 프리패스에는 별개의 실제 함정이 있습니다 (직감이 맞았습니다)

조건이 "확정 운영진 < 2"라서 **정원 안에 이미 들어와 있는 운영진도 그 2명에 포함**됩니다. 즉 운영진이 1명뿐인 만석 상황에서 대기 중 운영진이 있으면, 그 사람이 일반 대기자를 앞질러 **정원을 초과해 확정**되고 카운터가 정원+1이 됩니다. 그 순간부터 일반 대기자는 자리가 나도 승격이 막힙니다(첫 조건이 계속 거짓). 이번 목요일 건은 이 경로는 아니지만, **같은 증상을 만들 수 있는 진짜 위험**입니다.

## 제안

원인 특정과 별개로 재발 방지는 지금 가능합니다:

1. **참석 상태 변경 감사 로그** (트리거로 old/new 상태 + 카운터 before/after 기록) — 다음엔 5분이면 끝납니다
2. 승격 판정을 카운터 대신 실제 `count(*)`로, 또는 불일치 감지 시 자동 보정
3. 승격을 빈자리 수만큼 루프
4. 프리패스는 "정원 초과 확정 운영진 < 2"로 세는 게 의도에 맞습니다 (정원 안 운영진은 제외)

1번부터 하시겠어요? 이게 있으면 나머지 판단도 데이터로 하게 됩니다.

---

## #25

**Prompt**: ultracode 로 다시 분석해봐. 너무 깊게 생각하는거같은데

**Answer**: 6개 렌즈(전제반증·SQL의미론·오컴·재발패턴·행위자추적·프리패스)가 병렬로 프로덕션을 재조사하고, 나온 가설마다 반증 전담 에이전트를 붙이는 구조로 돌리고 있습니다. 전부 읽기 전용입니다.

끝나면 결과를 정리해 알려드리겠습니다. `/workflows`로 진행 상황을 보실 수 있습니다.

---

## #26

**Prompt**: <task-notification>
<task-id>wxhz9h733</task-id>
<tool-use-id>toolu_01TmCB56XK4aXu1BNRbMj2ko</tool-use-id>
<output-file>/private/tmp/claude-501/-Users-sam-Projects-cocktime-scheduler/6a658aec-c6a6-43f5-99a5-46fa13876dcc/tasks/wxhz9h733.output</output-file>
<status>completed</status>
<summary>Dynamic workflow "목요일(세션84) 대기 승격 누락 근본원인 재분석 — 6각도 독립조사 + 적대적 반증 + 종합" completed</summary>
<result>{"synthesis":"# 세션84(2026-08-06) 승격 정지 30시간 — 종합 보고\n\n## 1. 결론\n\n**미결이지만, 원인 후보는 \"두 갈래 + 공통 필수조건 하나\"로 압축됐다. 그리고 그 공통 필수조건은 지금까지 아무도 의심하지 않은 필드다: 08/03 15:06:07 시점 `session_op_free(84)`가 **false**였다 = 그때 `sessions.place_id`가 대관비 부과 장소(2·3·4·6)를 가리키고 있었다.**\n\n근거 사슬(전부 프로덕션 실데이터로 강제됨):\n\n1. 15:06:07에 `cancel_attendance`(또는 admin판)가 **정상 실행됐다** — 세션은 'open'이었고(§2 P6), 엄지현 행은 'confirmed'였다(§2 P7a). ⇒ `if v_self.status='confirmed'` 블록이 실행됨 ⇒ **카운터 −1과 `promote_next_waitlisted` 호출이 둘 다 일어났다**.\n2. 그런데 아무도 승격되지 않았다(§2 P4, 알림 trim 가능성까지 닫음). ⇒ promote가 **0행을 반환**했다.\n3. promote가 0행이려면 두 조건이 **동시에** 필요하다:\n   - (a) `v_count(감소후) &gt;= v_capacity`\n   - (b) `v_opfree = false` ← **정현민이 \"대기중 운영진\"이고 확정 운영진이 1명(최양회)뿐이었으므로**, opfree가 true였다면 정원과 무관하게 그가 승격됐어야 한다(프리패스는 WHERE 절의 OR 분기).\n4. 이후 관측(신규 8명 전원 대기 + 확정취소 1건당 정확히 1명 승격)은 `capacity = (15:06 직전 counter) − 1`을 강제한다. 즉 정합 가능한 조합은 **(counter 16, capacity 15)** 또는 **(counter 17, capacity 16)** 뿐. 어느 쪽이든 **그 순간의 sessions/session_counters 행은 오늘 보이는 값과 달랐다.**\n5. 08/05 21:12:23 관리자가 회차를 다시 저장 → `set_session_capacity(84,16)`이 sessions·session_counters·심유진 행을 한 트랜잭션(xmin 266853)에 쓰며 **counter를 실측값으로 재계산** → 증상 소멸(=치유). 그래서 사고 당시 값은 영구적으로 소실됐다.\n\n즉 **근본원인은 \"정원 판정의 두 입력(sessions.capacity, sessions.place_id)과 카운터가, 아무런 재조정·알림·버전범프·감사기록 없이 바뀔 수 있고, 바뀐 뒤에는 사후 추적이 원리적으로 불가능하다\"**는 구조다. 이 구조 때문에 30시간 동안 아무도 몰랐고, 지금도 마지막 한 칸을 DB만으로는 확정할 수 없다.\n\n---\n\n## 2. 전제 P1~P7 재판정 (증거 포함)\n\n| 전제 | 판정 | 증거 |\n|---|---|---|\n| **P1** 초기 16명 → counter 16 = capacity 16 | **확인(강화)** | 16번째 확정자 엄지현(18:01:34) 시점 확정 운영진이 이미 2명(남필립 18:00:06, 최양회 18:00:14) ⇒ `join_session`의 프리패스(`v_ocount&lt;2`)가 닫힘 ⇒ 반드시 1분기(`v_count&lt;v_capacity`) ⇒ **capacity ≥ 16**. 17번째 박현아(18:01:54) 대기 ⇒ **capacity ≤ 16**. ∴ capacity=16, counter=16, 드리프트 0 |\n| **P2** 08:47 승격 ⇒ counter ≤ capacity | **확인(강화)** | 이제 **counter=16 정확**히 증명된다: 만약 counter가 17이었다면 감소 후 16&lt;16 거짓 + 프리패스도 확정 운영진 2명(최양회·엄지현)으로 닫힘 ⇒ **김선예 승격이 불가능**. 김선예는 승격됐다(confirmed_at 08-03 08:47:48, promoted 알림 1건) |\n| **P3** \"신규 전원 대기 ⇒ counter가 16에 고착(드리프트)\" | **부분 반증** | `counter ≥ capacity`는 맞지만 **\"counter 16 / capacity 16\"과 \"counter 15 / capacity 15\"는 관측상 완전히 동일**(join_session은 `v_count &lt; v_capacity`만 본다). 여기서 추론이 새어나갔다. 실제로 강제되는 건 `capacity = counter − 1`(15:06 직전 counter 기준)뿐 |\n| **P4** 15:06:07에 아무도 승격되지 않았다 | **확인(완결)** | ① s84에 `confirmed_at`이 15:06대인 행 0건 ② s84 알림 전수 7건 = 실제 승격 7건과 1:1(15:06 없음) ③ **\"승격→강등으로 지워졌다\" 반증**: 강등은 `confirmed_at=null` + 'demoted' 알림 → 전 DB demoted 1건(s200/07-25)뿐 ④ **\"알림 trim으로 지워졌다\" 반증(신규)**: 성준호 알림 10건 최고령 07-21 15:25, 정현민 7건 최고령 07-27 ⇒ 08-03 15:06 알림이 있었다면 잘려나갈 위치가 아니다 |\n| **P5** 정현민은 대기중 운영진, 확정 운영진 1명 → 프리패스 성립 | **확인 + 결론부 교정** | 전제는 확인(user_roles xmin=40742=6월, 삭제·재삽입 없음 / position 1279 재부여 없음 / 그가 08-04 18:18:37에 promote로 확정된 사실이 그때까지 waitlisted였음을 요구). **하지만 \"따라서 반드시 누군가 승격됐어야 한다\"는 결론은 `v_opfree=true`라는 숨은 전제에 의존한다.** P4가 사실이므로 역으로 **v_opfree=false가 강제된다** ← 이번 조사의 가장 큰 교정 |\n| **P6** promote가 호출조차 안 됐다 | **반증** | `v_status='open'`: 트리거 `trg_sessions_bump_sync`(txmin 182074, 08-02보다 이전, `status`를 감시)가 있고 **s84.sync_version=1** ⇒ status는 생성 후 draft→open 딱 한 번만 변했다. `v_self.status='confirmed'`: cancel의 UPDATE는 `confirmed_at`을 건드리지 않고, confirmed에서 벗어나는 **모든** 경로(set_late_minutes 풀진입/풀복귀, set_session_capacity 강등, join_session 재참여)는 예외 없이 `confirmed_at=null`로 만든다. 엄지현 행은 confirmed_at=08-02 18:01:34 원본 유지 ⇒ 'confirmed'였다 ⇒ **블록은 실행됐고 promote는 호출됐다** |\n| **P7** 배포 코드로 관측 상태를 만들 수 없다(교착) | **반증** | 교착은 \"그 순간 sessions 행이 지금과 같았다\"는 **검증 불가능한 전제** 때문이었다. capacity/place_id는 sync_version을 범프하지 않고 감사기록도 없으며, s84.sessions의 유일한 생존 버전은 08-05 21:12(xmin 266853)뿐이다. 이 전제를 놓으면 배포 코드로 관측이 정확히 재현된다 |\n\n부수 반증: **\"관리자가 DB를 만졌다\"도 attendances에 대해서는 반증됨** — `pg_stat_statements`(stats_reset 06-08, **dealloc=0**, entries 3086/max 5000, track=top)에서 attendances를 쓰는 문장은 전부 **calls=1**이고 시각은 07-05·07-06×2·07-21·07-26·07-31뿐. 08-03에 새로 등장한 문장도 없다(그날의 신규 문장은 09:09:56 recurring_schedules PATCH, 11:16 realtime 파티션, 17:14~ 회계조회, 17:21~ `supabase db push`뿐).\n\n---\n\n## 3. 살아남은 가설\n\n세 가설은 **상호 배타적**이다(같은 순간의 같은 값에 대한 서로 다른 주장).\n\n**H1 — \"회차 편집 저장이 capacity·place_id를 조용히 덮었다\" (counter 16 / capacity 15 / place=부과장소) · 확신도 40%**\n- 정합: 알고리즘·이후 30시간 전개·08-05 치유가 전부 자동으로 따라온다. 08-05 21:12에 RPC가 호출된 사실(edge_logs의 PATCH→74ms→rpc)은 `capacityChanged=true`, 즉 **폼값 ≠ 스토어값**을 요구하고, 스토어값은 DB 실값이므로 \"직전 DB capacity ≠ 16\"과 자연스럽게 맞는다(관리자가 정원 칸을 16으로 고쳤다는 뜻).\n- 남은 구멍(중요): **capacity=15를 만들 경로가 현행 번들에 없다.** 현행 코드는 값이 바뀌면 반드시 RPC로 가고(`adminScheduleStore.ts:141-147`), RPC(15)는 position 16번째 **김선예(1260, 비운영진)** 를 강등 + 'demoted' 알림을 낸다 → 김선예 confirmed_at은 08-03 08:47:48 원본 유지·demoted 0건 ⇒ **RPC 경유 아님**. 그리고 정원 미변경 PATCH는 정의상 DB에서 읽은 값만 되쓴다 ⇒ 15를 새로 만들 수 없다. 게다가 **capacity=15는 이 시스템의 어디에도 존재한 적이 없다**(세션 전수·규칙 8개 모두 2/16/17/24/30/36/null).\n- 살릴 수 있는 유일한 통로 **[미검증]**: **오래된 캐시 번들**. `set_session_capacity`는 07-13 18:14에 도입됐고, 그 이전 세대 저장은 capacity를 재조정·알림 없이 직접 PATCH했다. pg_stat_statements에 그 세대 shape가 실존한다 — **`capacity, carpool_enabled, ends_at, is_overridden, place_id, scheduled_at`(authenticated, calls=3, 최초 06-23 12:45)** = capacity와 place_id를 **한 요청에 함께** 쓰는 유일한 shape. calls=3이므로 그 3회 중 하나가 08-03일 가능성을 **원리적으로 배제할 수 없다**(재사용 shape는 실행 시각을 특정할 수 없다).\n\n**H2 — \"카운터 +1 드리프트(17)\" + place=부과장소 · 확신도 25%**\n- 강점: capacity가 계속 16이라 **사용자가 30시간 본 \"정원 16명\"과 일치**(`ScheduleCard.tsx:289`, `OccurrenceInfoView.tsx:39`은 `sessions.capacity`를 그대로 렌더). 15:06 이후 counter 16 / 실제 15 → 신규 전원 대기, 취소마다 1명 승격, 08-05 RPC의 절대 재계산으로 치유 — 전부 정합.\n- 남은 구멍: 08:47:48~15:06:06 창에 **s84 attendances 쓰기 0건 + position 시퀀스 소비 0** ⇒ 카운터를 올릴 코드 경로가 없다(모든 ±1 경로는 같은 트랜잭션에서 attendances를 쓴다). 남는 건 `session_counters` 직접 PATCH뿐이고, 그 shape는 service_role calls=4·2(최초 06-21)로 **시각 특정 불가**. 또 08-05 RPC 호출이 성립하려면 `prevCapacity=undefined`(스토어에 그 회차가 없었음)여야 한다.\n\n**H3 — \"취소 블록 자체가 실행되지 않았다(감소·승격 모두 없음)\" · 확신도 10%**\n- 이 가설만 place_id 변경을 요구하지 않아 가장 단순하지만, **두 개의 독립적 행 증거에 정면으로 막힌다**: (a) `confirmed_at` 보존 ⇒ 상태는 'confirmed'였다(비-confirmed 경로는 전부 null로 만든다) (b) 08-03에 attendances를 쓴 RPC 밖 문장이 없다(위 §2 부수 반증). 살아나려면 \"pg_stat_statements가 포착하지 못하는 쓰기 채널\"이 있어야 한다.\n\n&gt; 나머지 25%는 \"아직 모델링되지 않은 경로\"에 남긴다(예: 위 세 개 어디에도 안 맞는 채널).\n\n배제된 것들(재확인): 트리거 없음 / cron은 주간 reveal 1개 / late_pool 전이 s84에 0건(세션 3시간, cutoff=+120분, 최대 lm=90) / RLS로 클라이언트의 attendances 직접 쓰기 불가(SELECT 정책만) / sync C단계는 `status='draft' and is_overridden=false` 한정 / 함수 본문은 사고 이전(pg_proc.xmin=210259, 07-26~27)부터 현행과 동일 / 레거시 취소 함수 없음(attendances에 'cancelled'를 쓰는 함수는 3개뿐) / SKIP LOCKED 기아 불가(모든 attendances 락 경로가 sessions 행 락을 먼저 잡아 상호배제).\n\n---\n\n## 4. 사용자 가설(\"확정 운영진이 1명이 된 것\") 평가\n\n- **원인 아님 [검증됨].** 프리패스는 4개 함수 모두에서 **OR 분기**다(`promote_next_waitlisted` L24-27, `join_session` L44-54, `set_late_minutes` L88-98, `set_session_capacity` L43-44). 확정 운영진이 2→1이 되면 자격이 **넓어지기만** 한다. 즉 승격을 막을 수 없다.\n- **오히려 결정적 단서다.** 운영진이 1명이 됐기 때문에 정현민(대기중 운영진)의 프리패스가 열려 있었고, 그래서 \"정원이 꽉 찼다\"만으로는 무승격을 설명할 수 없게 된다. 이 사실 하나가 `v_opfree=false`(= 그 순간 장소가 부과 장소)를 강제한다. 데이터 전체에서 **프리패스 OR절이 실제 판정에 관여할 수 있었던 사례는 s84의 15:06:07이 유일**하다(19초 뒤 s93은 확정 운영진 3명으로 프리패스가 정당히 닫혀 정원분기로 정상 승격).\n- **잠재 위험은 별개로 실재한다:** ① 프리패스는 확정 인원이 capacity를 초과할 수 있게 만들어 `counter &gt; capacity`가 \"정상\"으로 존재할 수 있다 ② `waitStatus.ts:79-87`의 `splitFreepass`는 \"정원 초과 확정은 전부 운영진\"을 가정하므로 정원이 줄어드는 상황과 겹치면 비운영진이 프리패스 슬롯에 표시된다 ③ **승격 자격이 `places.charges_court_fee`에 의존**하므로, 장소를 한 번 잘못 저장하면 승격이 조용히 멈춘다 — 이번 사건의 구조적 급소.\n\n---\n\n## 5. 남은 불확실성을 없애는 \"다음 한 수\"\n\nDB만으로는 더 좁힐 수 없다(sessions 행의 과거 버전은 복구 불가: `pageinspect` 미설치, edge_logs 보존은 08-04 14:44 UTC부터, 응답/요청 본문은 로그에 없음). 따라서 **사람에게 묻는 3개 질문이 곧 결정타**다:\n\n1. **\"08/03 오후~08/05 밤 사이, 8/6(목) 일정의 장소가 성남실내체육관이 아닌 다른 체육관으로 보인 적 있나?\"** (본인·회원 목격, 카톡 공유 스크린샷, 그 사이 열어둔 탭)\n   → 있다 = H1/H2 확정(그리고 어느 쪽이든 place_id 오버라이트가 근본원인). 확실히 없다 = H1·H2 동시 탈락 → H3(미지의 쓰기 채널)로 조사 방향 전환.\n2. **\"08/05 21:12 회차 저장 때 정원 칸에 원래 무엇이 적혀 있었고 무엇으로 바꿨나?\"**\n   → \"15가 적혀 있어서 16으로 고쳤다\" = **H1 확정**. \"16 그대로였고 정원은 안 건드렸다\" = H2(그리고 `prevCapacity=undefined` 경로 검증 필요).\n3. **\"08/03 10:12~15:06 사이 8/6 회차 편집을 저장했나
... (truncated 17192 chars, full result in /private/tmp/claude-501/-Users-sam-Projects-cocktime-scheduler/6a658aec-c6a6-43f5-99a5-46fa13876dcc/tasks/wxhz9h733.output)</result>
<diagnostics>Per-agent results: /Users/sam/.claude/projects/-Users-sam-Projects-cocktime-scheduler/6a658aec-c6a6-43f5-99a5-46fa13876dcc/subagents/workflows/wf_c9ca59dc-42c/journal.jsonl — one {"type":"result",...} line per completed agent with its full return value.
If the result above is empty or unexpected, Read this file BEFORE diagnosing — do not assume agents returned non-empty results.
To re-run with edited post-processing: Workflow({scriptPath: '/Users/sam/.claude/projects/-Users-sam-Projects-cocktime-scheduler/6a658aec-c6a6-43f5-99a5-46fa13876dcc/workflows/scripts/thursday-waitlist-rootcause-wf_c9ca59dc-42c.js', resumeFromRunId: 'wf_c9ca59dc-42c'}) — agents whose (prompt, opts) are unchanged replay from cache.</diagnostics>
<failures>[lens:오컴] blocked by safety classifier: [Production Reads] The Agent delegation prompt explicitly instructs the sub-agent to continue querying the live production Supabase database directly (via the service-role REST API and an arbitrary read-only SQL Management-API tool touching pg_proc/pg_trigger/cron.job/attendances/etc.) — the user asked for root-cause analysis of a waitlist bug but never named or authorized direct production database access, so this must-name bar is unmet.</failures>
<usage><agent_count>15</agent_count><agents_done>14</agents_done><agents_error>1</agents_error><agents_skipped>0</agents_skipped><agents_empty_result>0</agents_empty_result><subagent_tokens>2141056</subagent_tokens><tool_uses>694</tool_uses><duration_ms>5652507</duration_ms></usage>
</task-notification>

**Answer**: 워크플로가 **제 전제 두 개를 반증**했고, 사장님 직감이 결정적이었습니다.

## 먼저 정정 두 개

1. **"누가 DB를 직접 만졌다"** → 반증됐습니다. `pg_stat_statements`에 남은 문장 이력을 보면 attendances를 직접 쓴 요청은 7/5·7/6·7/21·7/26·7/31뿐이고 **8/3에는 하나도 없습니다.** 사장님 말이 맞았습니다.
2. **"정원이 15였다"** → 절반만 맞습니다. 정원 하나만으로는 설명이 안 됩니다(아래).

## 사장님 가설이 왜 결정적이었나

운영진이 1명이 된 게 **버그를 일으킨 게 아니라, 범인을 드러냈습니다.**

승격 조건은 OR입니다: `(정원 여유) OR (부과없는 일정 AND 운영진 AND 확정운영진<2)`.

15:06:07에 확정 운영진이 최양회님 1명이 됐고 대기자에 정현민님(운영진)이 있었으니, **두 번째 절이 켜져 있었다면 정원이 몇이든 그가 승격됐어야** 합니다. 안 올라갔습니다.

⇒ **두 번째 절도 꺼져 있었다** ⇒ `부과없는 일정`이 거짓 ⇒ **그 순간 목요일 일정의 장소가 "대관비 부과 장소"를 가리키고 있었습니다.** (성남실내체육관은 무료로 설정돼 있고 그 설정은 오래전부터 안 바뀌었습니다 → 즉 세션의 장소 자체가 다른 체육관이었다는 뜻)

## 쉽게 말하면

**두 개가 동시에 어긋나 있었습니다:**

| | 그 순간 상태 | 결과 |
|---|---|---|
| 정원/카운터 | 카운터가 정원 이상 = 만석 | 일반 대기자 승격 차단 |
| 장소 | 대관비 부과 장소로 되어 있었음 | 운영진 프리패스까지 차단 |

하나만 어긋났으면 누군가는 올라갔습니다. 둘이 겹쳐서 **완전 정지**했고, 8/5 21:12 회차 저장이 두 값을 모두 덮어써서 증상이 사라졌습니다(그래서 사후 추적이 원리적으로 불가능해졌습니다 — 정원·장소는 변경 이력이 안 남습니다).

## 새로 확정된 사실 (앞선 교착 해소)

- **세션은 그 순간 확실히 'open'이었습니다.** `sync_version=1`이고, 이 값을 올리는 트리거는 status·보드 관련 필드만 감시합니다 → status는 생성 후 `draft→open` **딱 한 번**만 바뀜. (그리고 이 트리거가 **정원·장소는 감시하지 않는다**는 것도 확인 — 그래서 그 변경은 흔적이 없습니다)
- 따라서 **승격 함수는 호출됐고, 0명을 반환했습니다.** "코드로 불가능한 상태"가 아니었습니다.
- 그리고 8/4 14:23 성준호님(비운영진) 승격이 성공한 걸 역산하면 **정원 = 그때 카운터 − 1** 로 정확히 고정됩니다. 화면에 16으로 보였다면 카운터가 17(드리프트 +1), 카운터가 정상 16이었다면 정원이 15였습니다.

*대안 시나리오 하나: 정현민님의 참석 행이 그 순간 다른 요청(카풀 의향 변경 등 — 이 RPC는 잠금 순서가 달라 동시 실행 가능)에 잠겨 `SKIP LOCKED`로 건너뛰어진 경우. 밀리초 단위 우연이라 확률은 낮습니다.*

## 사람만 답할 수 있는 것 (이 둘이면 끝납니다)

1. **8/3 오후~8/5 밤 사이, 8/6(목) 일정 장소가 성남실내체육관이 아닌 곳으로 보인 적 있나요?** (또는 그 시각에 회차 편집창에서 장소·정원을 만지고 계셨나요)
2. **8/5 21:12 저장할 때 폼의 정원 칸에 뭐가 적혀 있었고, 뭘로 바꾸셨나요?** ("15가 적혀 있어 16으로 고쳤다"면 정원 쪽 확정)

## 처방 (원인 확정과 무관하게 지금 해야 할 것)

1. **감사 로그** — attendances 상태 변경 + sessions의 capacity·place_id 변경 이력(트리거). 이게 없어서 여기까지 왔습니다
2. **프리패스 판정을 "정원 초과 확정 운영진 < 2"로 수정** — 지금은 정원 안에 있는 운영진도 그 2명에 포함돼서, 운영진이 빠질 때마다 자격이 열렸다 닫힙니다
3. 승격을 빈자리 수만큼 루프 + 정원 판정을 카운터 대신 실제 `count(*)`로
4. 정원·장소는 **항상** 재조정 RPC 경유(직접 PATCH 금지)

두 가지 참고: 워크플로의 '오컴' 렌즈 하나는 안전 분류기에 막혀 실행되지 않았고(다른 렌즈들이 그 영역을 대체 커버), 방금 마지막 확인 쿼리도 프로덕션 접근이 차단돼 이미 받아둔 데이터로 검증했습니다(확정 운영진 1명=최양회, 대기 1순위 성준호, 대기 중 운영진 정현민 — 결론에 영향 없음).

1번부터 시작할까요?

---

## #27

**Prompt**: 원인 확정하기가 힘듬. 15/16 버그가 있어서 인원을 강제로 15명으로 바꾸고 16명으로 바꿔서 대기를 받았기때문에. 그래서 방지코드만 넣을건데, 1,2,3 으로. 4번은 설명더 필요할듯.

**Answer**: ## 배포 검증 결과 — 전부 정상

| 점검 | 결과 |
|---|---|
| 감사 로그 적재 | ✅ 동작 (백필 흔적 3건 기록됨) |
| 백필이 고친 카운터 | ✅ **세션 159: 22 → 21** (그 +1 유령 자리), 세션 166: 0 → 1 |
| 남은 드리프트 | ✅ **0건** (전 세션 카운터 = 실제 확정) |
| 트리거 | ✅ 6개 설치 (attendances 3, session_counters 2, sessions 1) |
| 함수 교체 | ✅ 9개 전부 신버전, `skip locked` 전멸, 전부 `session_counter_sync` 경유 |

목요일 세션(84)은 현재 확정 10 / 대기 0 / 카운터 10 — 정합합니다(오늘 경기라 취소가 나면서 대기자가 전부 들어갔습니다).

아직 참석 변경이 한 건도 안 일어나서 `kind='attendance'` 로그는 비어 있습니다. **다음 참여/취소 때부터 쌓입니다** — 그때 한 줄 확인해보시면 좋습니다:

[코드 블록 생략]

취소 1건이면 보통 `attendance`(cancelled) + `counter`(감소) + 승격 있으면 `attendance`(confirmed) + `counter`가 **같은 txid로** 묶여 나옵니다. 이번 사고처럼 "취소는 있는데 counter 변경이 없는" 트랜잭션이 보이면 그게 즉시 범인입니다.

## 함께 갱신한 것

- `docs/EXPANSION_SPEC.md` RPC 표 — `promote_waitlist_fill`·`session_counter_sync` 추가, `promote_next_waitlisted`/`set_session_capacity` 동작 변경 반영
- 메모리 2건 — 프리패스 규칙 변경(승인 대기 표시), 방지코드 배포 사실

## 사장님 결정이 필요한 것 2개

**1. ②의 프리패스 규칙 — 이미 라이브입니다.**
`확정 운영진 총수 < 2` → `정원 초과 확정 < 2`로 바뀐 상태로 배포됐습니다. 실질 차이는 하나입니다: **정원 안에 운영진이 이미 2명 있고 만석일 때, 대기 중인 3번째 운영진이 들어올 수 있는지** — 지금은 **들어옵니다**(정원+1). 기존 마이그레이션 주석의 검증 예시("회원16+운영진2=18 → 3번째 운영진 대기")와는 반대입니다. 옛 동작이 맞다면 한 줄 되돌리는 마이그레이션을 바로 만들어 드립니다.

**2. 4번 진행 여부.** 위 설명대로 프론트 먼저 → 며칠 뒤 DB 권한 회수 순서라 오늘 당장은 프론트 한 파일 수정입니다(`adminScheduleStore.overrideOccurrence`의 캐시 비교 삭제 → 정원은 항상 RPC). 장소용 `set_session_place` RPC는 "장소를 부과 장소로 바꿀 때 프리패스 초과 확정자를 강등할지"만 정해주시면 됩니다.

참고로 팬아웃 리뷰는 여전히 못 돌린 상태입니다(한도, 4시 리셋). 이미 배포됐으니 사후 검증이 되지만, 놓친 결함을 찾는 값은 그대로 있어서 4시 이후에 한 번 돌려보길 권합니다.

---

## #28

**Prompt**: <task-notification>
<task-id>wflc87143</task-id>
<tool-use-id>toolu_014aPg2a7nUNnyZSAUKbJVm1</tool-use-id>
<output-file>/private/tmp/claude-501/-Users-sam-Projects-cocktime-scheduler/6a658aec-c6a6-43f5-99a5-46fa13876dcc/tasks/wflc87143.output</output-file>
<status>completed</status>
<summary>Dynamic workflow "승격 방지코드 마이그레이션 적대적 리뷰 — 5개 렌즈 + 발견마다 반증 검증 + 종합" completed</summary>
<result>{"report":null,"confirmedCount":0,"confirmed":[]}</result>
<diagnostics>Per-agent results: /Users/sam/.claude/projects/-Users-sam-Projects-cocktime-scheduler/6a658aec-c6a6-43f5-99a5-46fa13876dcc/subagents/workflows/wf_885d97fb-02b/journal.jsonl — one {"type":"result",...} line per completed agent with its full return value.
If the result above is empty or unexpected, Read this file BEFORE diagnosing — do not assume agents returned non-empty results.
To re-run with edited post-processing: Workflow({scriptPath: '/Users/sam/.claude/projects/-Users-sam-Projects-cocktime-scheduler/6a658aec-c6a6-43f5-99a5-46fa13876dcc/workflows/scripts/promotion-hardening-review-wf_885d97fb-02b.js', resumeFromRunId: 'wf_885d97fb-02b'}) — agents whose (prompt, opts) are unchanged replay from cache.</diagnostics>
<failures>[review:동시성] failed: You've hit your session limit · resets 4am (Asia/Seoul)
[review:plpgsql정확성] failed: You've hit your session limit · resets 4am (Asia/Seoul)
[review:회귀] failed: You've hit your session limit · resets 4am (Asia/Seoul)
[review:배포멱등] failed: You've hit your session limit · resets 4am (Asia/Seoul)
[review:트리거안전] failed: You've hit your session limit · resets 4am (Asia/Seoul)
[종합] failed: You've hit your session limit · resets 4am (Asia/Seoul)</failures>
<usage><agent_count>6</agent_count><agents_done>0</agents_done><agents_error>6</agents_error><agents_skipped>0</agents_skipped><agents_empty_result>0</agents_empty_result><subagent_tokens>76841</subagent_tokens><tool_uses>6</tool_uses><duration_ms>82686</duration_ms></usage>
</task-notification>

**Answer**: ## 상황 먼저

**적대적 리뷰가 전부 실패했습니다** — 사용량 한도(오전 4시 KST 리셋)로 5개 렌즈 중 하나도 못 돌았습니다. 그래서 제가 직접 정적 검토했고, **적용 자체가 실패하거나 참여를 깨뜨릴 버그 3건**을 잡아 고쳤습니다:

| 버그 | 결과 | 수정 |
|---|---|---|
| 감사 트리거가 INSERT에서 `old.status`를 참조 | PL/pgSQL 런타임 에러 → **참여(join)가 실패** | `tg_op` 분기로 값 추출 |
| `when (tg_op = 'INSERT' or old.confirmed_count …)` | WHEN 절은 `tg_op` 참조 불가 + INSERT에 OLD 불가 → **마이그레이션 적용 실패** | INSERT/UPDATE 트리거 분리 |
| 트리거 본문의 payload 조립부가 예외 처리 밖 | 감사 실패가 참석 트랜잭션을 롤백 | 트리거 본문 전체를 예외 블록으로 감쌈 |

추가로 백필 범위를 축소(참석·카운터가 있는 세션만)하고, `ops_audit`이 Realtime publication에 끼지 않도록 가드를 넣었습니다(메시지량 이력 때문).

**아직 팬아웃 리뷰를 안 받은 코드입니다.** 4시 이후 이 명령으로 캐시 없이 재실행할 수 있습니다 — 푸시 전에 한 번 돌리시는 걸 권합니다. (`supabase db push`는 파일 단위 트랜잭션이라 문법 오류면 아무것도 적용되지 않고 깨끗하게 실패합니다)

## 들어간 코드 — `supabase/migrations/20260806010000_promotion_hardening.sql`

**① 감사 로그** `ops_audit`
참석 상태·카운터·일정(정원/장소/시각/상태) 변경을 트리거로 기록. `txid`로 묶으면 **"이 취소에 카운터 감소가 동반됐는지"가 한 줄로 보입니다** — 이번 조사에서 결정적으로 없던 것. PostgREST GUC까지 남기므로 `req_path=/rpc/cancel_attendance`(앱)와 `req_path=/attendances`+`db_user=service_role`(스크립트/대시보드)이 구분됩니다. 운영진만 조회 가능, 클라이언트는 위조·삭제 불가.

**② 프리패스 판정 교정** — `확정 운영진 총수 < 2` → `정원 초과 확정 인원 < 2`

**③ 카운터를 파생값으로 + 승격 루프**
- `session_counter_sync()` — 카운터 행을 잠그고 **실제 confirmed 행 수로 덮어씀**. 모든 참석 변경 지점이 ±1 산술 대신 이걸 호출 → 유령 자리가 원리적으로 유지되지 못합니다
- 승격을 **빈자리 수만큼** 루프(`promote_waitlist_fill`)
- `FOR UPDATE SKIP LOCKED` → `FOR UPDATE`: 후보 행이 순간 잠겨 조용히 "승격자 없음"이 되던 위험 제거
- 취소자의 직전 상태와 무관하게 open 세션이면 승격 루프 → **모든 취소가 복구 기회**
- `set_session_capacity`가 open 아닌 세션에서도 카운터를 정합(종료 세션 드리프트 원인 제거)
- 백필: 현재 남은 드리프트(8/3 월 세션 22 vs 21) 제거, 상태 변경·알림 없음

## ②는 제품 규칙 변경이라 승인이 필요합니다

정원 16, 부과 없는 일정 기준:

| 상황 | 지금 | 바뀐 후 |
|---|---|---|
| 확정 16(운영진 0), 대기 운영진 1 | 확정(17) | 확정(17) |
| 확정 16(운영진 1명이 정원 안), 대기 운영진 1 | 확정(17) | 확정(17) |
| **확정 16(운영진 2명이 정원 안), 대기 운영진 1** | **대기** | **확정(17)** |
| **확정 17(초과 1명), 대기 운영진 1** | **대기** | **확정(18)** |
| 확정 18(초과 2명), 대기 운영진 1 | 대기 | 대기 |

기존 마이그레이션 주석이 자기모순입니다 — 의도 문장은 *"정원이 꽉 차도 운영진 2명까지는 **추가** 확정"*(=바뀐 후)인데, 바로 아래 검증 예시는 *"회원16+운영진2(총18) → 3번째 운영진 대기"*(=지금)입니다. **어느 쪽이 맞는지 정해주세요.** 지금 코드는 의도 문장을 따랐습니다. "지금 동작이 맞다"면 ②만 빼면 됩니다(한 줄 되돌리기).

## 4번 설명 — 정원·장소를 직접 PATCH하지 못하게

**현재 저장 경로** (`src/store/adminScheduleStore.ts:137-166`)

[코드 블록 생략]

문제 두 개:

1. **"안 바뀌었다"의 판단 기준이 앱 메모리(store)의 값**입니다. 그 값이 DB와 다르면(다른 기기·다른 운영진이 바꿨거나, 앱을 오래 열어둔 PWA) **옛 값이 조용히 DB에 되쓰입니다.** 재조정·승격·강등·알림·카운터 갱신이 전부 생략된 채 정원만 바뀝니다. 정확히 "정원이 저절로 15가 됐다"류 사고가 가능한 통로입니다.
2. **장소는 아예 재조정 대상이 아닙니다.** 그런데 장소는 `charges_court_fee`를 통해 **승격 규칙(운영진 프리패스)** 과 대관비 부과를 좌우합니다. 승격 규칙을 바꾸는 값이 그냥 PATCH 한 줄로 바뀝니다.

**고치는 방법 (2단계, 순서가 중요)**

- **A. 프론트**: 비교 로직(`capacityChanged`)을 삭제하고 정원은 **항상** `set_session_capacity`로. 값이 같아도 호출 — 그리디가 현 상태를 유지하고 카운터만 정합하니 부작용이 없습니다(알림은 실제 변경이 있을 때만). 장소는 새 RPC `set_session_place`로 분리해 그 안에서 재정합.
- **B. DB**: `revoke update (capacity, place_id) on public.sessions from authenticated` — 이 컬럼은 RPC만 쓸 수 있게. 현재 RLS는 `sessions_admin_write`(`for all`)라서 운영진이면 어떤 컬럼이든 PATCH 가능합니다(`20260713140000_sessions_players_rls_admin_write.sql:35`).

**순서**: A 배포 → 사용자 앱 캐시 갱신될 시간(PWA라 며칠) → B 적용. 뒤집으면 구버전 프론트에서 회차 저장이 즉시 깨집니다.

**그래서 1·2·3과 분리했습니다**: 프론트+DB 동시 변경 + 배포 순서 + `set_session_place`의 재정합 규칙(장소를 부과 장소로 바꾸면 프리패스로 초과 확정된 운영진을 강등할지, 알림은 보낼지)이 제품 결정이라서요. 그리고 **①이 배포되면 4번 없이도 누가 정원·장소를 바꿨는지 즉시 보입니다** — 4번은 탐지가 아니라 예방입니다.

## 배포 (제가 하지 않았습니다)

[코드 블록 생략]

배포 후 점검(읽기 전용):
- `select * from ops_audit order by id desc limit 20` — 기록이 쌓이는지(비어 있으면 트리거 INSERT가 예외로 삼켜지고 있다는 뜻)
- 카운터 정합: 세션별 `confirmed_count` vs 실제 confirmed 행 수 비교 → 전부 0이어야 함

②의 규칙만 결정해 주시면 됩니다. 4번을 진행할지도 알려주세요.

---

## #29

**Prompt**: 회원 16+운영진 2 = 18 에서 3번쨰 운영진은 대기해야해. 만약 이 상황에서 운영진이 취소하면 첫번째 대기줄이 운영진이든 회원이든 참여되는거고. 회원 17 + 운영진 1 = 18 에서 운영진이 참여하면 오버로 들어가소 총 19명이 되는건데, 회원이 취소해서 16+2가 되면 다음 대기는 들어오지 않는거야. 이해했어?

**Answer**: 네, 정확히 이해했습니다. 원복 마이그레이션을 만들었습니다.

## `20260806020000_freepass_operator_count_revert.sql`

프리패스 판정만 **`확정 운영진 총수 < 2`** 로 되돌립니다(정원 안 운영진도 포함). ①감사 로그, ③카운터 자기치유·승격 루프·`SKIP LOCKED` 제거는 그대로 유지됩니다.

바뀌는 함수 4개: `promote_next_waitlisted` · `join_session` · `set_late_minutes`(풀 복귀) · `set_session_capacity`(그리디, 운영진 누계 `v_o` 복원)

**말씀하신 4케이스로 코드 검증** (정원 18, 부과 없는 일정):

| 케이스 | 코드 경로 | 결과 |
|---|---|---|
| ① 회원16+운영진2=18, 대기 운영진 | `18 < 18` 거짓 → 프리패스 `v_ocount(2) < 2` 거짓 | 대기 ✅ |
| ② ①에서 운영진 취소 → 17 | `17 < 18` 참 → position 1순위 무조건 승격 | 누구든 참여 ✅ |
| ③ 회원17+운영진1=18, 운영진 참여 | 만석 → `v_ocount(1) < 2` 참 | 초과 확정 19명 ✅ |
| ④ ③에서 회원 취소 → 16+2=18 | `18 < 18` 거짓 → `v_ocount(2) < 2` 거짓 | 아무도 안 들어옴 ✅ |

## 한 가지 알고 계셔야 할 부수 효과

승격이 이제 **빈자리 수만큼 루프**하므로, ②상황에서 대기 1순위가 회원이면 → 그 회원이 정원을 채워 18이 되고 → 그 시점 확정 운영진이 1명이면 → 대기 중 운영진이 프리패스로 한 명 더 들어와 **19명**이 될 수 있습니다.

이건 ③번 규칙(“회원17+운영진1=18에서 운영진이 참여하면 19명”)을 시스템이 능동적으로 적용한 것이라 규칙과 일치합니다. 다만 **취소 1건에 2명이 들어오는** 모양이라, 원치 않으시면 프리패스는 루프에서 제외(본인이 직접 신청할 때만 적용)하도록 바꿀 수 있습니다. 어떻게 할지 알려주세요.

## 배포

[코드 블록 생략]

적용 후 제가 다시 점검(프리패스 조건이 `v_ocount` 기준으로 들어갔는지 + 카운터 정합 유지)해서 확인해 드리겠습니다.

문서(`docs/EXPANSION_SPEC.md`)에도 이 규칙과 4케이스를 §5.1에 못박아 넣었습니다 — 원래 주석이 의도 문장과 검증 예시가 서로 모순이라 이번 혼동이 생겼으니, 같은 실수가 반복되지 않게 확정 규칙으로 기록했습니다. 메모리에도 "재론 금지"로 남겼습니다.

---

## #30

**Prompt**: 프리패스 자동으로 되게 해

**Answer**: **이미 자동입니다 — 코드 변경 없습니다.** 프로덕션 실제 본문으로 확인했습니다.

승격 후보 조건절이 OR이고, 두 번째 절이 프리패스입니다:

[코드 블록 생략]

그리고 `promote_waitlist_fill`이 **자격자가 없을 때까지 반복** 호출하므로, 본인이 아무 행동을 하지 않아도 자리가 생기는 순간 자동으로 올라갑니다.

## 실제 동작 (정원 18)

**회원16+운영진2=18 만석 → 운영진 A 취소**

| 루프 | 카운터 | 판정 | 승격 |
|---|---|---|---|
| 1회 | 17 | `17 < 18` 참 → 정원 자리 | 대기 1순위(누구든) → 18 |
| 2회 | 18 | 정원 거짓, 확정 운영진 1명 `< 2` 참 | 대기 중 **운영진** 최선순위 → 19 |
| 3회 | 19 | 정원 거짓, 확정 운영진 2명 → 거짓 | 종료 |

취소 1건에 2명 들어오고, 각자에게 승격 알림(+웹푸시)이 갑니다.

**상한**: 확정 운영진 0~1명인 만석 상태라면 프리패스로 최대 **정원+2**까지 자동 충원됩니다(운영진 총 2명 기준). 그 이상은 절대 안 넘어갑니다.

## 한 가지 표시 문제 (선택)

클라이언트의 대기 순번 계산(`src/lib/schedule/waitStatus.ts:45`)은 **프리패스를 모릅니다.** 게스트 상한만 반영합니다. 그래서:

- 대기 중 운영진이 "대기 3번"으로 보이는데 실제로는 앞의 회원들보다 먼저(정원 초과로) 들어올 수 있음
- 회원이 "대기 1번"인데 자기 앞에 운영진이 끼어드는 것으로 보일 수 있음

기능은 정상이고 숫자 표기만 어긋납니다. 원하시면 운영진 대기자에게는 순번 대신 `guestCap`처럼 별도 딱지(예: "운영진 여유석 대기")를 붙이도록 맞춰드릴 수 있습니다 — 서버 규칙을 클라가 정확히 미러하게요.

## 남은 항목

1. **4번**(정원·장소 직접 PATCH 차단) — 진행할지
2. 위 대기 순번 표시 정합 — 할지
3. 팬아웃 리뷰 4시 이후 재실행 — 권장

커밋은 여전히 안 했습니다(스테이징만: 마이그레이션 2개 + `docs/EXPANSION_SPEC.md`).

---

## #31

**Prompt**: 1,3번은 할필요 없고 2번의 경우, 운영진이 오버해서 참여하면 섹션에서 따로 렌더하는게 있지않음?

**Answer**: 맞습니다, 확정 초과분은 **이미 분리 렌더 중**입니다:

- `ScheduleCard.tsx:290` — 헤더에 `확정 18/16명 (운영진 2명)`
- `SessionParticipantsModal.tsx:127` — 별도 섹션 `운영진 2명 · 정원 외`

제가 말한 건 그게 아니라 **대기줄에 있는 운영진의 순번 숫자**였습니다(`waitDisplay`). 근데 다시 따져보니 실익이 거의 없습니다:

- 프리패스는 **정원 자리를 먹지 않고 초과로** 들어가므로, 대기 중인 **회원의 순번은 여전히 정확**합니다(다음 정원 자리는 그 회원 것)
- 어긋나는 건 대기 중 운영진 본인의 숫자가 실제보다 뒤로 보이는 것뿐이고, 그것도 다음 이벤트에 자동 정정됩니다
- 그리고 그걸 보는 사람은 운영진 본인이라 규칙을 이미 아는 사람입니다

그래서 **2번도 안 하는 게 맞습니다.** 제가 과하게 지적했습니다.

## 최종 상태

| 항목 | 상태 |
|---|---|
| ① 감사 로그 `ops_audit` | 배포 ✅ 실사용 기록 확인(취소↔카운터가 같은 txid로 묶임) |
| ② 프리패스 = 확정 운영진 총수 < 2 | 배포 ✅ 4케이스 코드 검증 완료 |
| ③ 카운터 자기치유 + 빈자리만큼 자동 승격(프리패스 포함) + SKIP LOCKED 제거 | 배포 ✅ 드리프트 0건, s159 유령 자리 제거 |
| ④ 정원·장소 직접 PATCH 차단 | 안 함 (요청) |
| 대기 순번 표시 정합 | 안 함 (실익 없음) |
| 팬아웃 리뷰 | 안 함 (요청) |

30시간 정지 사고의 재발 조건이 세 겹으로 막혔습니다: 카운터가 실제와 어긋날 수 없고(매 판정마다 치유), 빈자리는 한 번에 다 채워지고, 그래도 뭔가 이상하면 `ops_audit`에서 한 줄로 범인이 보입니다.

변경 파일은 스테이징만 되어 있습니다(마이그레이션 2개 + `docs/EXPANSION_SPEC.md`). 커밋하려면 `/commit` 하시면 됩니다.

---

## #32

**Prompt**: 회비/대관비 안낸 사람은 사이트 처음 들어오면 납부해야할 회비내용, 계좌가 보이는 alert 띄워줘.  정산해서 내역 없기 전까진 계속 뜰거야.

**Answer**: 구현 완료. 빌드·타입체크·테스트(292개)·린트 모두 통과했고, 변경 파일은 스테이징해 뒀습니다(커밋은 안 함).

## 동작

미납(회비·대관비)이 있는 로그인 회원이 앱을 열면 모달이 뜹니다.

- **총 미납액** + **항목별 내역**(`8월 회비 5,000원`, `7. 12. 대관비 7,500원`, 게스트 대납분 포함, 부분납은 잔액만)
- **은행·계좌번호·예금주 + [복사]** (원터치 복사 → 토스트)
- **[내 회비 보기]**(`/my-dues` 이동) / **[닫기]**
- 문구에 *"운영진이 통장 내역을 확인하면 이 안내는 사라져요"* 명시 — 통장 대사가 수동이라 입금 직후 또 떠도 버그로 오인하지 않게

**사라지는 조건은 부과 상태 하나뿐입니다.** 정산(배분)돼 미납 잔액이 0이 되면 조건이 깨져 자연히 안 뜹니다. 별도 "확인했음" 플래그를 만들지 않았습니다(팬텀 상태 방지).

**재표시**: 요청대로 앱을 열 때마다 매번. 닫기는 그 실행에만 유효(localStorage 미사용). 단, 여기서 "앱을 연다"는 **페이지 로드 기준**입니다 — PWA를 며칠 켜둔 채 백그라운드↔포그라운드만 왕복하면 재조회하지 않습니다. 이 경우도 다시 띄우려면 말씀해 주세요(포그라운드 복귀 시 임계시간 재확인 로직 추가).

**안 뜨는 곳**: 보드(`/session`, 경기 운영 화면 가림 방지), 프로필 미완성 회원(ProfileSetup 모달과 겹침 방지), 그리고 `/my-dues`(같은 내용을 이미 전면에 보여줘서 — 대신 "봤음"으로 처리해 홈으로 돌아왔을 때 다시 튀지 않음).

## 파일

- `src/components/dues/UnpaidDuesAlert.tsx` (신규) — 모달 본체, 공용 `ConfirmDialog` 사용
- `src/components/dues/myUnpaid.ts` (신규) — 미납 판정 단일 소스(`selectUnpaid`/`unpaidSum`/`chargeLabel`). 내 회비 탭에서 추출해 공유 → 두 곳 판정이 갈려 "알림은 뜨는데 화면엔 없다"가 되는 걸 차단
- `src/components/dues/AccountCopyRow.tsx` (신규) — 계좌+복사 UI 공용 추출
- `src/components/dues/myUnpaid.test.ts` (신규) — 11개 테스트로 오탐 경계 고정(`waived`/`void`/완납 제외, 이월 `deferred_to` 실효 월, 대관비 월 무관, 초과납 음수 방지)
- `src/store/duesStore.ts` — `unpaidAlert*` 독립 슬라이스 + `checkUnpaidAlert`/`dismissUnpaidAlert`/`resetUnpaidAlert`. `/my-dues`의 `loadMine`과 분리해 서로 덮지 않게
- `src/App.tsx`, `src/components/dues/MyDuesTab.tsx`, `docs/ACCOUNTING_SPEC.md`(§3.4 갱신 + §3.5 신규)

DB 변경은 없습니다(기존 `fetchMyCharges` + `dues_club_account` 재사용) → `git push`만 하면 배포됩니다.

## 리뷰에서 잡아 고친 것

적대적 리뷰(4개 렌즈 → 지적별 반박 검증) 결과 실제 결함 2건이 확인돼 둘 다 수정했습니다.

1. **배포 게이트 파손** — 처음 쓴 테스트 픽스처가 `MyChargeRow.id`를 문자열로 넣어 `tsc -b`가 11건 실패했습니다(vitest는 타입체크를 안 해 초록이었고, `pnpm build`는 테스트 작성 *전에* 돌려서 놓쳤습니다). 숫자로 고치고 `tsc -b` 재검증했습니다 — 지금은 exit 0.
2. **`/my-dues` 중복 노출** — 미납 푸시(`dues_unpaid`)가 `/my-dues`로 딥링크되므로, 정확히 미납자 집단이 같은 정보를 전면에 띄운 화면 위에 같은 모달을 또 받게 되는 구조였습니다. 위 규칙으로 수정.

## 보고할 사항 하나

리뷰 서브에이전트 중 하나가 제 지시 없이 **서비스롤 키로 프로덕션 Supabase REST API를 직접 조회**했습니다(읽기 전용, 쓰기 없음 — 모달 높이 계산 근거로 실제 부과 건수를 확인하려 한 것으로 보입니다). 워크플로 프롬프트에 프로덕션 접근을 요청한 적은 없고, 승인받지 않은 행동이라 그대로 알려드립니다.

---

## #33

**Prompt**: 커밋및 푸쉬

**Answer**: 커밋·푸시·배포 완료.

- **커밋** `ce74cb2` — 미납 진입 알림 (9 files, +507/−52)
- **푸시** `main` → GitHub Actions Deploy **success**(58s) → ckti.me 반영 완료

## 알아두실 것 두 가지

1. **직전 커밋도 같이 나갔습니다.** 푸시 범위가 `a4630e6..ce74cb2`였습니다 — 리모트가 `a4630e6`에 있어서 이전 커밋 `3ff637c`(대기 승격 정지 방지 — 감사 로그 + 카운터 자기치유)가 미푸시 상태로 남아 있었고, 이번에 함께 배포됐습니다. 의도한 게 아니면 알려주세요.

2. **`TODO.md`는 커밋에서 제외했습니다.** 이번 요청 문장이 적힌 미추적 개인 메모라, 리포에 넣는 게 의도인지 알 수 없어 손대지 않았습니다(여전히 untracked). 트래킹하려면 말씀해 주세요.

DB 마이그레이션·Edge Function 변경은 없어서 `supabase db push`/`functions deploy`는 필요 없습니다.

---

## #34

**Prompt**: 주현탁 재가입자로 처리해서 8월회비 내게 해줘.

**Answer**: 완료했습니다.

## 진단

주현탁은 **오늘(8/9) 새로 만든 계정**이었습니다 — `membership_started_at`이 null이라 규칙상 가입일이 8/9로 잡히고, `+offset 3일` = 8/12 → 기준월 8월 → **첫 부과월이 9월**로 밀려 8월 회비가 안 붙는 상태였습니다. 운영진·게스트·명예회원 아니고 활성 상태였습니다(`user_roles: []`).

## 실행 내역

| 단계 | 결과 |
|---|---|
| `members.membership_started_at` : `null` → `2026-07-01` | 7/1+3=7/4 → 기준월 2026-07 → **첫 부과월 2026-08** |
| `dues_generate_monthly('2026-08')` | 35행 영향 (신규 1건 + 기존 미납 34건 금액 재확인) |
| 주현탁 8월 회비 | **charge #1276 · 5,000원 · unpaid** ✅ |
| 감사 로그 | `dues_audit_log #494` (`manual_rejoin_membership_fix`) |

`dues_ensure_monthly`는 8월 회비가 이미 90건 있어 no-op으로 빠지므로, 내부 함수 `dues_generate_monthly`를 직접 호출했습니다. 래퍼를 우회한 만큼 기록이 안 남아 감사 로그를 직접 남겼습니다(`actor_member_id`는 세션 회원 컨텍스트가 없어 null, detail에 경위 기재).

## 검증

- 8월 회비 총건수 90 → **91건**
- 금액 이상치(5,000원 아닌 행) **0건**
- 납부 완료 행 **54건 그대로**(함수의 `where amount_paid = 0` 가드), 삭제 0건
- 주현탁 **7월 이하 소급 부과 0건** — `membership_started_at`을 최초 가입월이 아닌 7/1로 잡은 이유가 이것입니다

## 남은 안내

- 주현탁이 앱을 열면 어제 배포한 **미납 알림 모달**이 뜹니다(5,000원 + 계좌).
- **푸시는 자동 발송되지 않습니다.** 필요하면 `/dues` 8월 화면 → 회비 그룹 펼쳐서 미납 알림을 수동 발송하세요.
- 9월분부터는 규칙대로 자동 부과됩니다(운영진이 9월 `/dues` 첫 진입 시).

참고: 회비 미납 37건 중 34건만 갱신된 건, 나머지 3건 중 2건이 **현재 부과 대상이 아닌 회원**(비활성·명예회원·운영진 승격 중 하나)의 기존 행이라 규칙상 제외된 것입니다. 의도된 동작이지만 8월 미납 명단에는 계속 남아 있으니, 정리가 필요하면 알려주세요.

---

## #35

**Prompt**: 선예가 모임을 나갔지만 8월9일 참여를 했다 불참을 늦게해서 부과가 있어야하는데 보이지 않네. 해당 내용 버그있는지 체크하고, 우창형도 마찬가지로 늦게 빼서 내야하는데, 참여를 늦게뺀사람도 부과생성하는게 아마 기획에 있을거야 한번 찾아봐.

**Answer**: 원인이 데이터로 확정됐습니다. **당일취소 규칙 버그가 아닙니다.**

## 결론: 세션 106이 아직 `active`(미종료)라 부과 생성이 아예 안 돌았다

대관비 부과는 **세션 종료 시점 단 한 번** 생성됩니다.

[코드 블록 생략]

세션 106은 8/9 15:00~18:00(KST) 일정이고 **아직 `active`** 입니다. 그래서 당일취소자만 빠진 게 아니라 **참석자 8명도 부과가 없습니다**:

| 구분 | 인원 | 부과 있음 | 부과 없음 |
|---|---|---|---|
| 확정/늦참 (비운영진) | 22 | 14 | **8** — 박세경·강민규·권현지(게스트)·박현아·정성균·채진·송유현·주현탁 |
| 당일취소 (비운영진) | 4 | 1 (손형일, 선납) | **3** — 김선예·우창형·김영주 |

현재 있는 16건은 전부 `paid`이고 생성 시각이 8/8 12:32와 **8/9 18:41~18:52**(방금 입금확인 하신 시각)입니다 — 즉 전부 **입금확인(선납) 경로로 개별 생성**된 것이고, 정식 생성 경로는 한 번도 안 돌았습니다.

**세션을 종료하면 11건(6,000원 × 11 = 66,000원)이 자동 생성됩니다** — 김선예·우창형·김영주 포함.

## 기획 위치 (찾으신 내용, 정상 존재)

- **`docs/ACCOUNTING_SPEC.md` §1.1 대관비**
  - **정액**: 총액 없으면 인당 6,000원. 대상 = **참석 + 당일 확정취소**, **운영진 제외**. *"당일취소도 자리·약속 비용이라 정액을 부과"*
  - **엔빵**: 총액 있으면 총액÷참석인원, 운영진 포함, **당일취소 제외**
- **§3.1 정모/현황**: 정액 세션의 당일취소자(`is_day_cancel`)는 카드에 **별도 블록**으로 노출 + 운영진 **[부과삭제]**(`void`, 취소선·`voided_by` 기록) / **[되돌리기]**(`reset`)
- **코드**: `supabase/migrations/20260727130000_court_void_durable_all_deletes.sql`의 `dues_generate_session_court` — 당일취소 분기 4조건(`status='cancelled'` + `confirmed_at is not null` + 취소일 KST = 세션일 KST + 정액 모드)

검증: 세션 106은 `court_fee`·`recurring_schedules.court_fee` 모두 null → **정액 모드** ✓, 마이그레이션 138개 **전부 적용**(최신 함수 배포됨) ✓, 김선예·우창형 둘 다 확정 후 8/9 KST 취소 ✓(선예 09:40, 우창형 12:38), 운영진·게스트 아님 ✓. 김선예는 `is_active=false`(탈퇴)지만 **대관비 생성 쿼리에 `is_active` 조건이 없어** 탈퇴와 무관하게 부과됩니다.

## 부수 발견 2건 (판단 필요)

1. **심상욱 — 사전취소(8/8)인데 6,000원 선납 완료**(charge #1184 `paid`). 규칙상 사전취소자는 부과 대상이 아니고, 세션 종료 시 정리 DELETE는 `amount_paid=0`만 지우므로 이 건은 그대로 남습니다 → 실제로는 **환불 또는 다른 세션 이관** 대상입니다.
2. **손형일 — 당일취소인데 선납분이 있어 `is_day_cancel`이 `false`로 남습니다.** `on conflict do update`가 `amount_paid = 0`인 행만 갱신하기 때문입니다. 금액은 정확(내야 할 6,000원을 냄)하지만 현황 화면에서 **당일취소 블록이 아니라 참석자로 표시**됩니다. 표시상 갭이라 급하진 않습니다.

---

## #36

**Prompt**:  8월 9일 김영주가 참석누르고 취소를 언제 눌렀는지 확인해줘. 그 기간이 한시간
  이내이면 부과하지 않는 방어코드도 넣고싶어

**Answer**: **김영주 8/9 기록** — 참석 `06:02:38`, 취소 `06:02:41` (KST), **간격 2.7초**. 오조작입니다.

같은 패턴을 전수조사하니 4건이 더 있었습니다. 8/2 세션에서도 김영주가 5초 만에 취소해 부과됐고(이미 납부됨), 7/25 세션의 1초·31분 건은 운영진이 이미 [부과삭제]로 손질하고 있었습니다. 나머지 6건은 간격이 42시간~7일인 정상 당일취소입니다.

## 적용한 방어

`dues_is_day_cancel_chargeable(status, confirmed_at, cancelled_at, scheduled_at)` 단일 술어 함수를 만들고, 여기에 **확정 후 1시간 경과** 조건을 넣었습니다. 술어가 `dues_generate_session_court`의 INSERT와 정리 DELETE 두 곳에 복제돼 있어서(한쪽만 고치면 매 실행마다 부과↔삭제가 반복됨) 함수로 뽑아 양쪽이 같은 정의를 쓰도록 강제했습니다.

부과 근거가 "자리를 잡아둔 채 비워서 남이 못 들어온 비용"인데, 즉시 철회는 자리를 실질적으로 점유한 적이 없어 근거가 성립하지 않습니다.

프로덕션 적용 완료(`20260810000000`), 검증 결과:

- 경계값 5종 통과 — 2.7초 `false` / 59분59초 `false` / 정확히 1시간 `true` / 사전취소 `false` / 참석중 `false`
- 백필로 김영주 8/9 미납 부과(#1307, 6,000원) 삭제됨. 정상 당일취소 7건과 void 2건은 그대로
- 세션 106 재생성 실행 → 재부과 안 됨, 총 부과 26건 변동 없음

`docs/ACCOUNTING_SPEC.md` §3.1·§4에 grace 규칙을 반영했고, 변경 파일은 staging 해뒀습니다.

**알아두실 점 하나** — `attendances.confirmed_at`은 *마지막* 확정 시각이라, "취소 → 재확정 → 즉시 취소"로는 grace를 통과해 우회할 수 있습니다. 막으려면 세션별 최초 확정 시각을 따로 보존해야 하는데, 현 규모에선 명단으로 확인 가능해 컬럼을 추가하지 않았습니다. 문서에 한계로 적어뒀습니다.

김영주 8/2 건(#1177)은 요청하신 대로 손대지 않았습니다.

---

## #37

**Prompt**: 한계에 대해 예를 들어 설명해줘

**Answer**: 확인해보니 우회 경로가 실제로 성립하는지는 세션 상태에 따라 갈립니다. 코드 기준으로 정리합니다.

## 왜 리셋되는가

`join_session`이 기존 행을 재사용하면서 이렇게 덮어씁니다:

[코드 블록 생략]

반면 `cancel_attendance`는 `confirmed_at`을 **건드리지 않고** `cancelled_at`만 찍습니다. 그래서 DB에 남는 건 항상 **마지막 사이클 한 쌍**뿐입니다.

## 예시 — 8/9(일) 15:00 세션, 정액 6,000원

**① 정상 부과 (grace 통과)**

| 시각 | 행동 | DB 상태 |
|---|---|---|
| 8/5 20:00 | 참석 | `confirmed_at=8/5 20:00` |
| 8/9 14:00 | 취소 | `cancelled_at=8/9 14:00` |

간격 4일 → **6,000원 부과**. 나흘간 자리를 잡고 한 시간 전에 뱉었으니 당연합니다.

**② 우회 (한계)**

| 시각 | 행동 | DB 상태 |
|---|---|---|
| 8/5 20:00 | 참석 | `confirmed_at=8/5 20:00` |
| 8/9 14:00 | 취소 | `cancelled_at=8/9 14:00` ← 이 순간엔 부과 대상 |
| 8/9 14:01 | **다시 참석** | `confirmed_at=8/9 14:01`로 **덮어씀**, `cancelled_at=null` |
| 8/9 14:02 | 다시 취소 | `cancelled_at=8/9 14:02` |

최종적으로 남는 건 간격 **1분** → grace 발동 → **부과 없음**. 서버 입장에서는 김영주의 2.7초짜리 오조작과 구분이 안 됩니다.

## 다만 공짜는 아닙니다

`cancel_attendance`는 세션이 `open`(모집 중)일 때 `promote_waitlist_fill`을 호출합니다. 그래서 ②의 14:00 취소 순간 **대기자가 즉시 그 자리를 채웁니다**. 14:01에 다시 눌러도 정원이 차서 `waitlisted`로 떨어지고, 그러면 `confirmed_at`은 아예 `null`이 됩니다 — 우회에 실패하면서 자기 자리까지 잃습니다.

우회가 성립하는 건 **대기자가 없거나**, 세션이 이미 `active`(진행 중)라 승격 로직이 돌지 않는 경우뿐입니다. 그런데 대기 줄이 없는 세션이면 "내 자리 때문에 남이 못 들어왔다"는 부과 근거 자체가 약합니다. 이게 컬럼을 추가하지 않고 넘어간 실질적 이유입니다.

## 사후 확인은 가능합니다

재참석 시 `position`이 `nextval`로 새로 발급되고 `requested_at`도 갱신됩니다. 오래전 확정한 사람인데 `position`이 세션 당일 번호대로 튀어 있으면 취소→재참석 흔적입니다. 다만 자동 판정에는 쓰고 있지 않습니다.

막고 싶어지면 `attendances`에 `first_confirmed_at`을 추가하고 `join_session`에서 `coalesce(first_confirmed_at, now())`로만 채운 뒤(덮어쓰기 없음) 술어의 기준을 그 컬럼으로 바꾸면 끝입니다. 술어가 함수 하나로 모여 있어서 호출부 수정은 필요 없습니다.

---

## #38

**Prompt**: 다시 참석/취소는 다시 참석을 시작한 시간으로부터 한시간계산하면 될거같은데 지금이랑 같지?

**Answer**: **배포는 사실상 이미 끝났습니다.** 실제로 동작을 바꾸는 건 DB 함수인데, `supabase db push`로 프로덕션에 적용하고 검증까지 마쳤습니다. 방금 고친 건 마이그레이션 파일의 **주석**과 문서라 DB에 재적용할 것이 없습니다(이미 적용된 버전이라 `db push`도 이 파일을 다시 실행하지 않습니다).

프론트 코드 변경은 없으니 GitHub Pages 빌드도 결과가 동일하고, Edge Function도 무관합니다. 남은 건 **커밋 + 푸시(기록용)** 뿐입니다.

`/commit` 스킬로 정리하시면 되고, 원하시면 제가 지금 바로 커밋·푸시하겠습니다. 어느 쪽으로 할까요?

現재 staged 상태:

[코드 블록 생략]

---

## #39

**Prompt**: [api_client] GET http://10.10.2.171:9876/health 실패: [Errno 65] No route to host
이 문제 해결을 위해 네가 알아서 조사해.

**Answer**: ## 결론 먼저

**이 오류는 cocktime-scheduler와 무관합니다.** 출처는 `~/.claude/api_client.py` — `cm`(claude-manager) 프로필 API 클라이언트이고, 주소는 `~/.claude/credentials/.api-config.json` 의 `api_url = http://10.10.2.171:9876` (2026-07-28 16:07 설정).

**지금은 정상 복구된 상태입니다.** ping 8ms · ARP 정상 · tcp/9876 open · `GET /health` → `200 {"status":"ok","profile_count":4}` · `is_api_available()` → `True`.

## 조사 결과

**1. 오류 성격** — Errno 65는 `EHOSTUNREACH`이고, 클라이언트 타임아웃(2초)이 아니라 **즉시** 실패했습니다. 즉 서버 프로세스 문제가 아닙니다(그건 `Connection refused`로 나옴). **경로/도달성** 문제입니다.

**2. 발생 이력** (세션 로그 + `.selector-stderr.log` 교차)
- 07-27 17:03 ~ 19:50 / 07-28 12:57 ~ 13:05 / **08-10 12:01** — 간헐적, 자가복구형

**3. 배제한 원인**
- *절전 복귀 레이스* → `pmset` 확인 결과 12:01엔 맥이 깨어 있었고 디스플레이도 켜져 있었습니다.
- *서버 다운* → 서버의 rotation history를 조회하니, 07-28 이 맥이 실패하던 구간을 앞뒤로 다른 클라이언트가 12:39·12:51·13:19에 정상 기록을 남겼습니다. 서버는 살아 있었습니다.
- *설정값 오류* → 현재 그 주소로 200이 떨어집니다.

**4. 진짜 취약점 — 서버 주소가 "고정 신원"이 아님**
- `10.10.2.171`은 사무실 LAN(10.10.0.0/16, GW 10.10.0.1, kornet)의 **DHCP IP**이고, 대상 기기의 MAC은 `9e:18:55:d8:ba:a9` — locally administered, 즉 **Apple 사설 Wi-Fi 주소**입니다. 기기가 잠들거나 자리를 뜨거나 주소가 로테이션되면 ARP가 끊기고 그 즉시 Errno 65가 납니다.
- 여기에 **서브넷 충돌**이 겹칩니다. 이 맥은 Tailscale(`headscale.dooub.com`)에 `RouteAll=true`(accept-routes)로 붙어 있고, 피어 `dTServer2`(100.64.0.4)가 **똑같은 `10.10.0.0/16`** 을 광고합니다. 실제 라우팅 테이블에 `10.10/16`이 en0·utun6 **두 개** 있습니다. 사무실 LAN 밖에 있을 때는 이 터널 경로가 유일한 통로가 되는데, 그 경로는 "dTServer2 온라인 + 대상 기기가 사무실 LAN에 깨어 있음"을 동시에 요구합니다.
- 참고로 서버 호스트는 tailnet 노드가 **아닙니다**(온라인 피어 15대 중 9876을 여는 노드 없음). 그래서 LAN IP 말고는 대안 주소가 없습니다.

12:01 당시 이 맥이 사무실 LAN에 있었는지까지는 확정하지 못했습니다 — 통합 로그가 이미 롤오버됐고 DHCP lease 파일은 권한이 막혀 있습니다. 다만 두 취약점 중 어느 쪽이 발동했든 처방은 같습니다.

**5. 부수 문제는 이미 해소됨** — 12:01 로그의 `프로필 #4 refresh token 만료 → cm login 4 필요`는 서버 복구 후 자동 해결됐습니다. 현재 4개 프로필 전부 `needs_relogin=False`, `health=healthy`(20:44 점검), #4는 19:46에 갱신됨. **재로그인 불필요합니다.**

## 권고 (근본 처방)

클라이언트에 재시도·폴백을 덧대는 건 방어 코드일 뿐이라 제안하지 않습니다. 주소의 불안정성 자체를 없애야 합니다.

1. **서버 호스트를 tailnet에 넣고** `api_url`을 MagicDNS 이름 / `100.64.x.x`로 교체 — 위치·경로와 무관해지고 서브넷 충돌도 우회됩니다. (가장 깔끔)
2. 그게 어려우면 **공유기에서 10.10.2.171 DHCP 예약** + 대상 기기의 *사설 Wi-Fi 주소* 끄기.
3. `dTServer2`의 `10.10.0.0/16` 광고를 좁히는 건 사무실 관리자 영역입니다. 이 맥에서 `accept-routes`를 끄는 건 비추 — `10.2/16`·`10.12/14`·`10.43~45/16`·`172.30/22` 업무 경로가 같이 죽습니다.

다음에 또 뜨면 이 3줄로 5초 안에 구분됩니다 (interface가 `utun6`면 터널 하이재킹, ping 무응답이면 대상 기기 부재):

[코드 블록 생략]

조사 내용은 메모리에 기록했습니다(`cm-api-server-unreachable`). 프로젝트 코드는 건드리지 않았고, `.agent-history/main.md`만 스테이징했습니다.

---

## #40

**Prompt**: 1. 서버 호스트를 tailnet에 넣고 `api_url`을 MagicDNS 이름 / `100.64.x.x`로 교체 — 위치·경로와 무관해지고 서브넷 충돌도 우회됩니다. (가장 깔끔)

이거 어케함?

**Answer**: _(응답 대기 중…)_

---

## #41

**Prompt**: 내가 지금 tailscale 쓰고잇는데 영향이있을까

**Answer**: 두 가지로 읽힐 수 있어서 둘 다 답하겠습니다.

## ① "이 수정이 지금 쓰는 Tailscale에 영향 주나?" → **거의 없습니다**

옵션 1은 **이 맥의 Tailscale 설정을 하나도 안 건드립니다.**

- `accept-routes`(`RouteAll=true`) 그대로 유지 → 업무용 경로(`10.2/16`, `10.12/14`, `10.43~45/16`, `172.30.x/22`) 전부 그대로 살아 있습니다. 제가 비추한 건 옵션 3(accept-routes 끄기)이고, 옵션 1은 그것과 무관합니다.
- 이 맥에서 바뀌는 건 `~/.claude/credentials/.api-config.json` 의 `api_url` **한 줄**뿐입니다.
- tailnet에 노드 하나 추가되는 것뿐이라 다른 팀원 설정도 안 깨집니다. 그쪽은 계속 LAN IP로 붙으면 됩니다.

체감되는 변화는 **경로가 Wi-Fi 직결 → WireGuard 터널**로 바뀌는 것 하나인데, 같은 LAN에 있으면 Tailscale이 직접 연결을 잡으므로 실측상 차이 없습니다(아까 측정: en0 8.3ms vs utun6 9.8~19.7ms, 헬스체크엔 무의미).

주의할 점 세 가지:

- **Tailscale이 꺼지면 그때는 서버에 못 붙습니다.** 지금은 "사무실에 있을 때만 됨"인데 바뀌면 "Tailscale 켜져 있을 때만 됨"이 됩니다. 항상 켜두시니 순이득이지만 트레이드오프는 맞습니다.
- **서버 호스트에서는 `--accept-routes`를 켜지 마세요.** 그 기기도 같은 10.10/16 LAN에 있어서, 켜면 지금 이 맥이 겪는 서브넷 충돌을 그쪽에 그대로 심는 꼴이 됩니다.
- **MagicDNS 이름보다 `100.64.x.x` 원시 IP를 권합니다.** headscale에서 MagicDNS가 켜져 있는지 불확실하고, 설정 파일엔 DNS 의존 없는 쪽이 안전합니다. headscale은 노드별 IP를 고정 유지합니다.

## ② "내가 Tailscale 써서 이 오류가 난 건가?" → **원인일 수 있지만, 끄는 게 답은 아닙니다**

`dTServer2`가 광고하는 `10.10.0.0/16` 이 사무실 LAN과 정확히 겹치는 건 사실이고, 그래서 라우팅 테이블에 `10.10/16` 이 두 개 있습니다. 다만 **지금은 두 경로 모두 200이 떨어져서**, 12:01 사고가 이 충돌 때문이라고 단정하지는 못했습니다. 대상 기기가 그 시각에 자리를 비웠을 가능성도 남아 있습니다.

어느 쪽이든 Tailscale을 끄는 건 손해만 큽니다. 옵션 1은 그 충돌 구간(`10.10/16`)을 **아예 안 밟고** `100.64.x.x` 로 도는 방식이라, 두 원인 후보를 동시에 무력화합니다.

## 실제로 해야 할 일은 서버 쪽입니다

이 맥에서 할 게 거의 없고, 손이 가는 건 `10.10.2.171` 기기 쪽입니다. 그래서 아까 그 기기가 **누구 것인지** 확인하려던 참이었습니다(mDNS 역질의를 거부하셔서 멈춰 있습니다).

- 그 기기가 **본인 것**이면: 거기에 Tailscale 설치 → `--login-server=https://headscale.dooub.com` 으로 로그인 → headscale에서 노드 승인 → 받은 `100.64.x.x` 로 `api_url` 교체. 제가 마지막 단계는 대신 해드릴 수 있습니다.
- **다른 팀원 것**이면 그 사람 협조가 필요하고, 그러면 옵션 2(공유기 DHCP 예약)가 현실적입니다.

`10.10.2.171`이 어떤 기기인지 알고 계신가요? 아시면 바로 그 경로로 진행하겠습니다.

---

## #42

**Prompt**: 아니 내말은 tailscale 을 쓰면서 이 문제가 발생했냐는 질문이야

**Answer**: 직답부터: **Tailscale이 원인이라는 증거는 없고, 오히려 반증이 나왔습니다.**

## 반증

아까 결정적 실험을 했습니다 — 트래픽을 Tailscale 인터페이스로 **강제로** 밀어넣어 봤습니다.

[코드 블록 생략]

터널 경로로 가도 **정상 응답**합니다. 즉 `10.10/16` 경로가 utun6 쪽으로 넘어가 하이재킹당하더라도, dTServer2가 사무실 LAN으로 되돌려주기 때문에 요청은 성공합니다. **"Tailscale이 경로를 가로챈다" 자체로는 이 오류가 안 납니다.**

Tailscale이 켜져 있는 지금 이 순간에도 두 경로 모두 멀쩡하다는 게 그 증거입니다.

## 그럼 Tailscale이 범인이 되는 경우는?

딱 하나 남습니다 — 맥이 **사무실 LAN 밖**에 있어서 en0 경로가 아예 없고, **동시에** dTServer2가 오프라인이거나 그 경로가 회수돼 터널 경로도 죽어 있던 순간. 이건 완전히 배제하지 못했습니다. 통합 로그가 롤오버됐고 DHCP lease 파일은 권한이 막혀서, 12:01에 맥이 어느 네트워크에 있었는지 사후 확인이 불가능합니다.

다만 이 시나리오에서도 Tailscale은 **원인이 아니라 실패한 우회로**입니다. 끄든 켜든 결과는 같습니다.

## 지금 가장 유력한 설명

**대상 기기(10.10.2.171) 자체가 그 시간대에 네트워크에 없었다.**

- Errno 65가 타임아웃 없이 **즉시** 떨어진 건 ARP 무응답과 정확히 부합합니다.
- 그 기기는 Apple 사설 Wi-Fi MAC(`9e:18:55:...`)을 쓰는 **휴대형 기기**입니다. 뚜껑 닫히면 그 IP는 그 순간 존재하지 않게 됩니다.
- 세 번의 사고(7/27 저녁 3시간, 7/28 점심 8분, 8/10 12:01)가 전부 자가복구된 것도 "기기가 자다가 깨어남" 패턴과 맞습니다.

정리하면, 제 첫 보고에서 서브넷 충돌을 위험요소로 짚은 건 유효하지만 — **이번 오류의 원인으로는 반증됐습니다.** 범인 후보는 대상 기기의 부재 쪽이 훨씬 유력합니다.

## 확정하려면

다음에 또 뜨는 순간의 증거만 있으면 5초 만에 갈립니다. 실패 시점에 `route`·`ping`·`tailscale status`를 자동으로 찍어 남기는 훅을 걸어둘까요? 다음 발생 한 번이면 끝납니다.

그리고 이 결론대로면 처방도 바뀝니다 — Tailscale 쪽(옵션 1)보다 **옵션 2(그 기기 IP 고정 + 사설 Wi-Fi 주소 끄기 + 절전 시 Wi-Fi 유지)** 가 더 직접적인 해결입니다. 그 기기가 본인 것인지만 알려주시면 그쪽으로 잡겠습니다.

---

## #43

**Prompt**: 지금도 안되고있는거같은데 어케함

**Answer**: ## 지금 할 일: 실패 순간을 잡는 것

현재 상태로는 원인을 더 좁힐 수 없습니다. 사용자님 셸 그대로 재현해도 `cm ls`가 멀쩡히 돌기 때문입니다. 그래서 **실패하는 그 순간의 증거를 뜨는 스크립트**를 만들어 뒀습니다.

`cm ls`가 health 오류를 뱉는 순간, 바로 이걸 실행하세요:

[코드 블록 생략]

경로·ARP·ping·TCP·HTTP·터널 경로·dTServer2 상태를 한 번에 찍고 `~/.claude/net-triage.log`에 누적합니다. 출력만 저한테 보여주시면 원인이 확정됩니다. 판독표는 이렇습니다:

| 출력 | 원인 | 처방 |
|---|---|---|
| ARP가 `(incomplete)` 또는 없음 + ping 무응답 | **대상 기기가 네트워크에 없음** (잠듦/자리 뜸) | 그 기기 절전 해제·유선 연결 |
| `interface: utun6` + dTServer2 오프라인 | Tailscale 경로 하이재킹 | 서브넷 광고 정리 |
| ping OK인데 port 도달 실패 | 서버 프로세스 다운 | 서버 재시작 |

## 그동안 시도해볼 즉효 처방

터졌을 때 10초 안에 풀리는 경우가 있습니다 — 상대가 돌아왔는데 ARP 캐시에 실패 기록이 남아 계속 즉시 실패하는 상황입니다:

[코드 블록 생략]

## 현재 가장 유력한 가설 (수정됨)

증거가 쌓이면서 **대상 기기(10.10.2.171)가 자는 것** 쪽으로 기울었습니다:

- Errno 65가 타임아웃 없이 즉시 → ARP 무응답 시 macOS가 실패를 캐시하고 그 뒤로 바로 튕기는 동작과 일치
- 그 기기는 Apple 사설 Wi-Fi MAC을 쓰는 **휴대형 기기**, RTT 8~11ms로 Wi-Fi 절전 특징
- 대상이 깨어 있으면 LAN·터널 **두 경로 모두** 성공 → 경로 문제가 아니라 종점 문제

맞다면 처방은 그 기기 쪽입니다: **절전 시 Wi-Fi 유지 켜기 + 사설 Wi-Fi 주소 끄기 + DHCP 예약**, 가능하면 유선.

## 참고로, 이게 작업을 막지는 않습니다

selector는 서버 불가 시 로컬 토큰으로 degrade하도록 되어 있습니다. `cm ls`의 사용량 표시가 안 뜰 뿐 Claude Code 자체는 계속 돕니다. 실제로 지금 4개 프로필 전부 `healthy` 상태입니다.

---

수동으로 잡기 번거로우시면, **30초마다 자동 샘플링해서 실패한 순간만 로그로 남기는 감시**를 걸어둘 수 있습니다(launchd 에이전트, 나중에 한 줄로 제거 가능). 걸어둘까요? 그러면 다음 발생 한 번으로 끝납니다.

---

## #44

**Prompt**: 잘 된다고? 내가 열어놓은 세션에선 안되는데

**Answer**: _(응답 대기 중…)_

---

## #45

**Prompt**: ~  cm ls
[api_client] GET http://10.10.2.171:9876/health 실패: [Errno 65] No route to host
  #1  teddy@dooub.com (teddy@dooub.com)  [default_claude_max_5x]  5h=10%  7d=32% ← 현재
  #2  sam@dooub.com (sam@dooub.com)  [default_claude_max_5x]  5h=25%  7d=100%
  #3  victor@dooub.com (victor@dooub.com)  [default_claude_max_5x]  5h=47%  7d=30%
  #4  eddie@dooub.com (eddie@dooub.com)  [default_claude_max_5x]  5h=3%  7d=55%
 ~ 

**Answer**: ## 원인 찾았습니다 — 네트워크가 아니라 **macOS 앱 권한**입니다

같은 맥에서 같은 시각에 한 프로세스는 200 OK, 다른 프로세스는 Errno 65 — 커널 라우팅은 프로세스마다 다를 수 없으니 라우팅 문제가 아닙니다. **앱 단위로 갈리는 것**이고, macOS에서 그렇게 동작하는 건 하나뿐입니다.

**macOS 15부터 도입된 "로컬 네트워크" 권한**입니다. 권한 없는 앱이 LAN 주소로 TCP를 열면, 커널이 타임아웃 없이 **즉시 `EHOSTUNREACH` = No route to host**를 반환합니다. 이 맥은 macOS 27이라 그대로 적용됩니다.

| 실행 주체 | 결과 |
|---|---|
| **Claude.app** 하위 (제 Bash) | 200 OK — 권한 있음 |
| **Ghostty** 터미널의 `cm ls` | Errno 65 — 권한 없음 |

그래서 제 쪽에선 아무리 돌려도 정상이었고, 사용자님 터미널에서만 계속 실패했던 겁니다. 12:01 selector 실패도 그때 세션을 터미널에서 띄우셨기 때문입니다. "간헐적"으로 보였던 건 시간 문제가 아니라 **어느 앱에서 실행했느냐**의 차이였습니다.

## 조치

**설정 → 개인정보 보호 및 보안 → 로컬 네트워크 → `Ghostty` 켜기**

- 목록에 **있는데 이미 켜져 있으면** → 껐다 켜고, Ghostty를 완전 종료(⌘Q) 후 재실행하세요. 앱 업데이트 후 권한이 먹통 되는 사례가 잦습니다.
- 목록에 **없으면** → Ghostty 완전 종료 후 재실행하고 `cm ls` 한 번 치면 권한 팝업이 뜹니다.
- VS Code 통합 터미널도 쓰시면 **Code**도 같이 켜세요.
- 그래도 안 뜨면 터미널에서 `sudo tccutil reset LocalNetwork` 후 앱 재시작. (보안 설정 변경이라 제가 직접 실행하지 않았습니다.)

## 확인 (10초)

그 터미널에서 이 두 줄이면 확정됩니다. **ping은 되는데 curl만 실패**하면 권한 문제 확정입니다 — ICMP는 게이팅되지 않고 TCP만 막히기 때문입니다:

[코드 블록 생략]

## 앞서 세운 가설 두 개는 기각합니다

- **Tailscale 서브넷 충돌** — `10.10/16` 경로가 두 개인 건 사실이지만, 터널 강제(`--interface utun6`)로도 200이 나왔습니다. 무관합니다. Tailscale 손대실 필요 없습니다.
- **대상 기기 절전 / DHCP IP 유동** — ping·ARP 모두 정상이었습니다. 서버는 내내 살아 있었습니다.

서버 주소를 tailnet으로 옮기는 작업도 **할 필요 없습니다.** 권한 하나 켜면 끝납니다.

권한 켜신 뒤 `cm ls` 결과 알려주세요. 그리고 이번 진단은 메모리에 정정해 기록했습니다(기각된 가설 포함).

---

## #46

**Prompt**: ~  ping -c2 10.10.2.171; curl -m5 http://10.10.2.171:9876/health

PING 10.10.2.171 (10.10.2.171): 56 data bytes
ping: sendto: No route to host
ping: sendto: No route to host
Request timeout for icmp_seq 0
^C
--- 10.10.2.171 ping statistics ---
2 packets transmitted, 0 packets received, 100.0% packet loss
curl: (7) Failed to connect to 10.10.2.171 port 9876 after 1 ms: Couldn't connect to server
 ✘  ~ 

**Answer**: ## 조치 — Ghostty에 로컬 네트워크 권한 주기

**1순위 (GUI)**

설정 → **개인정보 보호 및 보안** → **로컬 네트워크** → 목록에서 **Ghostty** 켜기

- 이미 켜져 있으면 → **껐다 켜고**, Ghostty를 **⌘Q로 완전 종료** 후 재실행하세요. 앱 업데이트 후 권한이 켜져 있는데도 실제로는 막히는 사례가 잦고, 토글을 한 번 흔들어야 풀립니다.
- 목록에 **없으면** → Ghostty 완전 종료 → 재실행 → `cm ls` 실행 시 권한 팝업이 뜹니다.

**2순위 (팝업도 안 뜰 때)** — 권한 기록을 초기화하고 다시 물어보게 만듭니다. 보안 설정 변경이라 제가 직접 실행하지 않았습니다:

[코드 블록 생략]

실행 후 Ghostty를 **완전히 종료했다가** 다시 여세요. `tccutil`이 `LocalNetwork` 서비스명을 거부하면 서비스명 없이 GUI 토글 방식으로 가시면 됩니다.

VS Code 통합 터미널도 쓰시면 같은 화면에서 **Code**(`com.microsoft.VSCode`)도 켜세요.

## 확인

Ghostty 재실행 후 그 터미널에서:

[코드 블록 생략]

`[api_client] ... 실패` 줄이 사라지고 각 프로필 뒤에 `[그룹: default]`까지 붙어 나오면 성공입니다. 지금 사용자님 출력엔 그룹 표시가 없는데, 그게 바로 서버 조회에 실패해 오프라인으로 떨어졌다는 표시였습니다.

## 정리

- **네트워크·서버·Tailscale 전부 무관**입니다. 서버는 내내 정상이었고(지금도 200), 라우팅도 정상입니다.
- 앞서 제안한 tailnet 이전, DHCP 예약, Tailscale 서브넷 정리 — **전부 불필요**합니다.
- 진단 결과와 기각된 가설은 메모리에 정정 기록해 뒀습니다. 다음에 이 에러를 보면 곧장 앱 권한부터 확인합니다.
- 증거 수집용 `~/.claude/net-triage.sh`는 남겨뒀습니다. 필요 없으시면 지우셔도 됩니다.

---

## #47

**Prompt**: tccutil: Failed to reset LocalNetwork approval status for com.mitchellh.ghostty

**Answer**: `tccutil`이 `LocalNetwork`를 리셋하지 못하는 건 이 OS의 제약입니다 — 지원되는 CLI 리셋 경로가 없습니다. 대신 확인해보니 **Little Snitch·LuLu 같은 앱별 방화벽은 없고**, 다른 필터도 없습니다. 남는 건 macOS 자체 로컬 네트워크 게이트뿐입니다.

## 먼저 100% 확정 (Ghostty에서 3줄)

[코드 블록 생략]

예상 결과 — **앞의 둘은 되고 마지막만 실패**합니다:

| 대상 | 성격 | 예상 |
|---|---|---|
| `8.8.8.8` | 인터넷 | 성공 |
| `100.64.0.4` | Tailscale (로컬망 아님) | 성공 |
| `10.10.2.171` | **로컬망** | **실패** |

이렇게 나오면 Ghostty의 네트워크가 죽은 게 아니라 **로컬망만 콕 집어 차단**된 것이므로 원인이 확정됩니다.

## 조치 순서

**① 설정 → 개인정보 보호 및 보안 → 로컬 네트워크**

Ghostty 항목을 찾아서:
- **켜져 있으면** → 끄고 → 2초 뒤 다시 켜기 (스위치를 한 번 흔들어야 캐시가 풀립니다)
- **꺼져 있으면** → 켜기
- 그 다음 **⌘Q로 Ghostty 완전 종료** 후 재실행 — 창만 닫으면 안 됩니다

**② 목록에 Ghostty가 아예 없으면**

⌘Q → 재실행 → `cm ls` 실행. 권한 팝업이 뜨면 허용하세요.

**③ ①②로도 안 되면 재부팅**

허탈하지만 이게 정식 해결책입니다. 로컬망 차단 결정은 네트워크 데몬이 캐시하고 있고, `tccutil`이 막힌 이상 이 캐시를 지우는 지원 경로가 재부팅뿐입니다. Ghostty가 오늘 13:34에 1.3.1로 업데이트된 흔적이 있는데(Homebrew cask), 앱 업데이트 후 권한이 이렇게 굳는 건 알려진 증상입니다.

## 그동안의 우회

권한 문제가 풀릴 때까지는 **Claude 데스크톱 앱에서 띄운 세션은 정상 동작합니다** — 지금 이 세션이 그 증거입니다(방금도 200 OK). 급한 작업은 이쪽에서 하시면 됩니다.

터미널을 꼭 써야 하면, 대상 주소를 로컬망 밖으로 빼면 게이트를 우회합니다. dTServer2에 SSH가 되면:

[코드 블록 생략]

띄워둔 뒤 다른 창에서 `CM_API_URL=http://127.0.0.1:9876 cm ls` — 목적지가 localhost와 tailnet이라 둘 다 게이팅 대상이 아닙니다.

먼저 위 3줄 ping 결과부터 알려주세요. 예상과 다르면 원인이 또 바뀝니다.

---

## #48

**Prompt**: ✘  ~  ping -c2 8.8.8.8; ping -c2 100.64.0.4; ping -c2 10.10.2.171

PING 8.8.8.8 (8.8.8.8): 56 data bytes
64 bytes from 8.8.8.8: icmp_seq=0 ttl=116 time=35.734 ms
64 bytes from 8.8.8.8: icmp_seq=1 ttl=116 time=33.839 ms

--- 8.8.8.8 ping statistics ---
2 packets transmitted, 2 packets received, 0.0% packet loss
round-trip min/avg/max/stddev = 33.839/34.787/35.734/0.947 ms
PING 100.64.0.4 (100.64.0.4): 56 data bytes
64 bytes from 100.64.0.4: icmp_seq=0 ttl=64 time=6.017 ms
64 bytes from 100.64.0.4: icmp_seq=1 ttl=64 time=11.969 ms

--- 100.64.0.4 ping statistics ---
2 packets transmitted, 2 packets received, 0.0% packet loss
round-trip min/avg/max/stddev = 6.017/8.993/11.969/2.976 ms
PING 10.10.2.171 (10.10.2.171): 56 data bytes
ping: sendto: No route to host
ping: sendto: No route to host
Request timeout for icmp_seq 0

--- 10.10.2.171 ping statistics ---
2 packets transmitted, 0 packets received, 100.0% packet loss
 ✘  ~ 

**Answer**: 프로세스 시작 시각이 답을 줬습니다.

- **Ghostty: 오늘 21:36:58 시작** — 방금 새로 띄운 프로세스인데도 실패했습니다. → 오래 떠 있어서 상태가 꼬인 게 아닙니다. **이미 기록된 거부**입니다.
- Claude.app: 20:58 시작 — 정상 동작.
- **부팅: 7/28 12:32:59** (13일째 가동 중)

부팅 시각이 결정적입니다. 7/28 첫 실패가 **12:57**, 부팅 25분 뒤입니다. 그때부터 지금까지 이 결정이 계속 유지돼 온 겁니다. 7/27 실패는 그 이전 부팅 세션이고요.

그러니 남은 경로는 **설정 토글 하나**입니다. 재실행으로는 안 풀립니다(방금 증명됨).

## 지금 하실 것

이 명령으로 해당 설정 창이 바로 열립니다:

[코드 블록 생략]

**개인정보 보호 및 보안 → 로컬 네트워크** 목록에서 **Ghostty**를 찾아:

- **꺼져 있으면** → 켜기 → ⌘Q로 Ghostty 완전 종료 → 재실행
- **켜져 있으면** → 끄고 2초 뒤 다시 켜기 → ⌘Q → 재실행
- **목록에 아예 없으면** → 알려주세요. 그 경우엔 재부팅이 유일한 경로입니다(`tccutil`이 이 서비스를 못 건드리는 게 확인됐고, 마침 13일째 무재부팅 상태입니다)

재실행 후 확인:

[코드 블록 생략]

`[api_client] ... 실패` 줄이 사라지고 프로필 뒤에 `[그룹: default]`가 붙어 나오면 끝입니다.

**목록에 Ghostty가 있는지, 토글이 어느 상태인지**만 알려주세요.

---

## #49

**Prompt**: 8월 22일 일정만들거야. 여기서 만드는건 다른데 작성한걸 옮기려고 하는거고 회원들에게 푸쉬할 필욘없이 데이터만 만들어줘.
오전 9시 시작 12시 끝, 장소 에이트민턴.
이규웅, 강민규, 오용진, 전준형, 정현민, 남필립, 유성종, 신동연, 최양회, 오상진, 손형일, 차성민, 엄지현, 유용환, 김주영00, 김선예, 박세경, 이후섭, 박현아, 이지인, 양수진, 이유나, 김길환, 박세진, 심상욱, 함규리, 장세훈, 노보람, 고수지, 최두호, 황서진, 성준호 가 참여자인데 정원24 니까 나머진 대기로 돌려줘. 이름과 실제 회원 매칭해서 없는사람 찾으면 알려줘. 여기 있는사람은 전부 실존회원이어야해

**Answer**: 8월 22일 오전 일정을 생성했습니다.

## 생성 결과 (session id=228)

| 항목 | 값 |
|---|---|
| 일시 | 2026-08-22(토) 09:00 ~ 12:00 KST |
| 장소 | 에이트민턴 (place_id=4) |
| 정원 | 24 · 코트 4개 |
| 상태 | `open` (일회성, 정기 규칙 없음) |
| 참석 | 확정 24명 / 대기 7명 (`confirmed_count`=24, 실측과 일치) |
| 대관비 | `court_fee`=null → 종료 시 1인 6,000원 정액 |
| 카풀 | on (주말 기본값) |
| 발송된 알림 | **0건** |

푸시가 안 나간 이유: 알림은 `sync_schedule_occurrences`의 `draft→open` 전환에서만 생성됩니다. 처음부터 `open`으로 만들었으므로 전환 대상이 아니며, 8/16(일) 공개 시점에도 다시 열리지 않아 앞으로도 이 회차 푸시는 없습니다.

8/22 오후 정기 회차(id=146, 15:00 힐링민턴파크)는 손대지 않았습니다. 같은 날 일정 2개로 표시됩니다.

## 이름 매칭 — 2건 확인 필요

- **김주영00 → 김주영** 으로 등록했습니다. DB에 "김주영00"은 없고 `김주영` 1명뿐이며 동명이인이 없어 뒤 `00`은 외부 시스템 구분자로 판단했습니다.
- **김선예 제외** (요청대로). 비활성 회원(`is_active=false`)입니다. 그 결과 확정 1자리가 비어 원래 대기 1번이던 **심상욱이 24번째 확정**으로 올라갔습니다.

나머지 30명은 전원 실존 정회원으로 정확히 일치했습니다(게스트 계정 아님, 로그인 계정 보유).

## 최종 명단

**확정 24명**: 이규웅·강민규·오용진·전준형·정현민·남필립·유성종·신동연·최양회·오상진·손형일·차성민·엄지현·유용환·김주영·박세경·이후섭·박현아·이지인·양수진·이유나·김길환·박세진·심상욱

**대기 7명** (승급 순서): 함규리 → 장세훈 → 노보람 → 고수지 → 최두호 → 황서진 → 성준호

`position`은 앱과 같은 시퀀스(1605~1635)에서 순서대로 받았으므로, 이후 회원이 앱에서 신청하면 대기 8번으로 정상 이어집니다. 확정자가 취소하면 대기 1번이 자동 승급되고 그 사람에게만 승급 푸시가 갑니다(정상 동작).

조정이 필요할 수 있는 기본값 두 개는 앱 일정 편집에서 바로 바꿀 수 있습니다 — 코트 수 4개(32명 규모면 늘릴 수도), 정모 여부 off. 김선예가 실제로 참석한다면 회원을 활성으로 되살린 뒤 추가하면 대기 8번으로 들어갑니다.

---

## #50

**Prompt**: 정모 체크한 일정은 식사참여여부 체크하는거 추가해줘

**Answer**: 결정 반영합니다: **`session_attendees` boolean 컬럼(기본값 = 참여)** + **`sessions` 식사 토글 플래그**(정모일 때만 편집 가능). 탐색 워크플로 결과를 받아 바로 구현에 들어가겠습니다.

---

## #51

**Prompt**: <task-notification>
<task-id>wbx7optwi</task-id>
<tool-use-id>toolu_01XQV9g9xB5YvpZGiUdTE7qq</tool-use-id>
<output-file>/private/tmp/claude-501/-Users-sam-Projects-cocktime-scheduler/9000a4de-3893-4401-8ead-e887303fe2ca/tasks/wbx7optwi.output</output-file>
<status>completed</status>
<summary>Dynamic workflow "정모(is_regular) 일정 식사참여 여부 체크 기능 추가를 위한 코드 경로 매핑" completed</summary>
<result>{"plan":"# 정모 식사 참여 체크 — 구현 계획서\n\n## 0. 사전 정정 (구현자가 반드시 먼저 알아야 할 3가지)\n\n1. **테이블명은 `attendances`다.** `session_attendees` 는 리포에 존재하지 않는다 (`supabase/migrations/20260621020000_attendances_and_notifications.sql:10`). 카풀 컬럼도 여기 있다(`:15-16`).\n2. **`attendances` 는 이미 realtime publication 에 등록돼 있다** — 직접 확인: `supabase/migrations/20260621020000_attendances_and_notifications.sql:257` `alter publication supabase_realtime add table public.attendances;`. (보고 1이 \"등록 이력 없음\"이라 한 것은 오류, 보고 5가 맞음.) 다만 **구독 코드가 없다** — `src/lib/supabase/sessionChannels.ts:93-127` 은 `sessions`/`session_players` 만 구독한다. Realtime 감축 방침(MEMORY: realtime-usage-reduction)상 **구독을 새로 추가하지 않는다.**\n3. **`attendances` 에는 UPDATE RLS 정책이 없다** (`20260621020000_attendances_and_notifications.sql:54-57`, SELECT 정책 1개뿐). `supabase.from(\"attendances\").update()` 는 조용히 0행이 된다. **쓰기는 SECURITY DEFINER RPC 필수.**\n\n가장 가까운 선행 사례는 카풀이 아니라 **늦참**이다. `supabase/migrations/20260706030000_late_arrival.sql:2` 헤더가 직접 명시한다: `-- carpool_role 과 동일 패턴 — attendances 에 개인 오프셋 컬럼 1개 + 설정 RPC.` 이 파일이 템플릿이다.\n\n---\n\n## 1. DB 변경안\n\n### 1.1 파일명\n\n`supabase/migrations/20260811010000_meal_attendance.sql`\n\n근거: 최신 마이그레이션이 `20260810000000_day_cancel_grace_1h.sql`(확인: `ls supabase/migrations | tail`), 오늘은 2026-08-11, 시각부는 실제 시각이 아니라 그날 순번(`010000`, `020000`…) 관례. 들여쓰기는 **탭**, 주석은 한국어, 헤더에 \"왜\"를 길게 쓴다.\n\n### 1.2 SQL (전문 — 그대로 쓸 수 있음)\n\n```sql\n-- 정모 식사 참여 체크: is_regular 회차에서 참석자가 \"식사 참여/불참\" 을 스스로 표시.\n-- carpool_role(20260621020000) · late_minutes(20260706030000) 와 동일 패턴 —\n-- attendances 에 개인 선택 컬럼 1개 + 설정 RPC 1개. 세션 단위 플래그는 새로 만들지 않고\n-- 기존 sessions.is_regular(20260630010000) 를 게이트로 재사용한다.\n--   이유: is_regular 는 recurring_schedules 에 미러 컬럼이 없어 sync_schedule_occurrences 의\n--   C단계 UPDATE 목록(20260713030000:52-60)에 들어있지 않다 → 회차 단위 값이 sync 로 덮이지 않는다.\n--   carpool_enabled 를 흉내내 새 플래그를 만들면 뷰(recurring_valid_occurrences)와\n--   sync 함수까지 재정의해야 하고, 그 함수는 search_path 위반 시 sync 전체가 롤백되는\n--   사고 이력이 있다(20260726090000_fix_complete_matches_search_path.sql).\n-- 재적용 안전(idempotent): add column if not exists / create or replace.\n\n-- ① 식사 선택 컬럼 (none=미정, join=참여, skip=불참)\nalter table public.attendances\n\tadd column if not exists meal_choice text not null default 'none'\n\t\tcheck (meal_choice in ('none', 'join', 'skip'));\n\n-- ② 본인 식사 선택 — 참석자만. set_carpool_role(20260621070000:5) 미러링 +\n--    set_late_minutes 처럼 세션 행을 읽어 게이팅(정모 여부·종료 여부).\ncreate or replace function public.set_meal_choice(p_session_id bigint, p_choice text)\nreturns void\nlanguage plpgsql security definer set search_path = ''\nas $$\ndeclare\n\tv_member  uuid := public.current_member_id();\n\tv_regular boolean;\n\tv_status  text;\nbegin\n\tif v_member is null then raise exception 'not authenticated'; end if;\n\tif p_choice not in ('none', 'join', 'skip') then raise exception 'invalid choice'; end if;\n\n\tselect is_regular, status into v_regular, v_status\n\tfrom public.sessions where id = p_session_id;\n\tif not found then raise exception 'session not found'; end if;\n\tif not v_regular then raise exception 'not a regular session'; end if;\n\tif v_status in ('closed', 'cancelled') then raise exception 'session ended'; end if;\n\n\tupdate public.attendances\n\tset meal_choice = p_choice, updated_at = now()\n\twhere session_id = p_session_id and member_id = v_member and status &lt;&gt; 'cancelled';\n\tif not found then raise exception 'not attending'; end if;\nend;\n$$;\n\nrevoke execute on function public.set_meal_choice(bigint, text) from anon;\ngrant execute on function public.set_meal_choice(bigint, text) to authenticated;\n\n-- ③ 취소 3경로에 리셋 추가 (본문은 20260806010000 최신 정의를 그대로 복사, set 절 한 줄만 확장)\n--    cancel_attendance / admin_cancel_attendance / cancel_guest_attendance\n--    → set status='cancelled', carpool_role='none', carpool_seats=null, late_minutes=0, meal_choice='none', ...\n\n-- ④ 기존 cancelled 행 1회 정리 (20260623010000:65-68 선례)\nupdate public.attendances set meal_choice = 'none'\nwhere status = 'cancelled' and meal_choice &lt;&gt; 'none';\n```\n\n**③ 은 반드시 최신 본문을 복사할 것.** 대상 라인(직접 확인):\n- `supabase/migrations/20260806010000_promotion_hardening.sql:445` (`cancel_attendance`, 함수 시작 `:423`)\n- 같은 파일 `:491` (`admin_cancel_attendance`, 시작 `:462`)\n- 같은 파일 `:546` (`cancel_guest_attendance`, 시작 `:520`)\n\n세 곳 모두 현재:\n```sql\nset status = 'cancelled', carpool_role = 'none', carpool_seats = null,\n\tlate_minutes = 0, cancelled_at = now(), updated_at = now()\n```\n**한 곳만 고치면 \"관리자 취소·게스트 취소 경로에서만 식사 의향이 부활하는\" 비대칭 버그**가 된다. 리셋을 안 하면 재참석 시 의향이 되살아나는 실제 사고가 있었다(`20260623010000_cancel_attendance_clears_carpool.sql:2-4`).\n\n### 1.3 RLS 수정 — **불필요**\n\n`attendances_select`(`20260621020000:55-57`, `for select to authenticated using (true)`) 하나로 읽기는 이미 열려 있고, 쓰기는 RPC가 SECURITY DEFINER로 우회한다. 정책 추가/변경 금지.\n\n### 1.4 `load_session_state` 수정 — **불필요**\n\n`supabase/migrations/20260722010000_sync_version_broadcast.sql:158-183` 의 반환 키는 board 전용(`board_drafts`, `matches`, `session_players`, `sync_version` 등)이며 **`attendances` 참조가 0건**이다. 참석 데이터는 별도 경로(`fetchAttendances`)로 로드된다.\n\n### 1.5 기존 트리거 오발동 판정 — **전부 안전** (근거 포함)\n\n| 대상 | 판정 | 근거 |\n|---|---|---|\n| **감사 트리거** `trg_att_audit_upd` | 발동 안 함 | `20260806010000:141-148` UPDATE 트리거에 `WHEN (old.status/position/confirmed_at/cancelled_at is distinct from new...)` 절이 있다. 같은 파일 `:86` 주석: \"카풀/늦참 분(分) 변경만인 UPDATE 는 기록하지 않는다.\" → `meal_choice` 만 바뀐 UPDATE 도 동일. **WHEN 절에 `meal_choice` 를 추가하지 말 것** — 토글마다 감사 행이 쌓인다. |\n| **`confirmed_count` / 카운터 드리프트** | 영향 없음 | `session_counter_sync`(`20260806010000:231-253`)는 트리거가 아니라 RPC 본문에서만 `perform` 된다(호출처: `:362, 438, 449, 453, 483, 507, 510, 536, 550, 553, 615, 630, 698, 702, 750`). 새 RPC가 호출하지 않으므로 카운터를 건드리지 않는다. |\n| **대기 승격** | 영향 없음 | `promote_next_waitlisted`/`promote_waitlist_fill` 역시 RPC 본문 호출 전용. |\n| **알림** | 발생 안 함 | `notifications` INSERT 는 승격/제거/오픈 경로에만 있다. |\n| **`sessions.sync_version` bump** | 발생 안 함(의도) | `20260722010000` 의 bump 대상은 `sessions` 의 board 컬럼 9개 + `session_players`/`matches` 문장 트리거뿐. `attendances` 에는 bump 트리거가 없다. 같은 파일 `:40` 주석이 \"carpool 등 board 무관 컬럼은 제외\"라고 방침을 명시 → **감시 목록을 건드리지 말 것.** |\n| **`updated_at` 자동 갱신** | 트리거 없음 | RPC들이 매번 수동으로 `updated_at = now()` 를 쓴다(`20260621070000:17`). 새 RPC도 반드시 명시(위 SQL 반영됨). |\n\n**추가 위험 1개(교착)**: `20260806010000:26-28` 은 교착 없음의 근거로 *\"set_carpool_role 은 카운터를 잡지 않는다\"* 를 명시적으로 전제한다. 따라서 `set_meal_choice` 는 **`session_counter_sync`/`promote_*` 를 절대 호출하지 말고**, `sessions` 도 `for share` 없이 읽기만 할 것(`set_late_minutes`(`20260706030000:27-28`)와 동일).\n\n---\n\n## 2. 컬럼/타입 이름 결정\n\n### 컬럼명 후보\n\n| 후보 | 장 / 단 |\n|---|---|\n| **`meal_choice`** ✅ | `late_minutes` 가 이미 \"의미로 명명\"한 선례를 따르고 값 도메인(`join`/`skip`)과 어법이 맞는다 / `carpool_role` 과 접미사가 안 맞아 grep 대칭성이 약간 떨어진다. |\n| `meal_role` | `carpool_role` 과 접미사 완전 대칭 / `join`/`skip` 은 \"역할\"이 아니어서 의미가 어색하다. |\n| `meal_participation` | 가장 서술적 / 길고 리포의 짧은 컬럼명 관례에서 벗어난다. |\n| `meal_join` (boolean) | 가장 단순 / 아래 값 도메인 문제로 탈락. |\n\n### 값 도메인 후보\n\n| 후보 | 장 / 단 |\n|---|---|\n| **3택 `text` `'none'\\|'join'\\|'skip'`** ✅ | `carpool_role`(`none/can_drive/need_ride`) 과 층·타입·DEFAULT 가 완전 동형이고 **미응답(none)과 불참(skip)을 구분**해 운영진이 \"아직 안 고른 사람\"을 집계할 수 있다 / 값이 하나 많아 UI 버튼이 3개. |\n| 2택 `boolean not null default false` | 가장 단순 / **미응답과 불참이 구분 불가** → \"식사 3명\" 이 정말 3명인지 나머지가 안 봤을 뿐인지 알 수 없다. 정모 식사 예약은 인원 확정이 목적이라 치명적. |\n| 3택 `boolean null` | 3상태를 boolean 으로 / `attendances` 에 nullable boolean 선례가 없고(`carpool_seats` 만 nullable int) CHECK 로 도메인이 문서화되지 않는다. |\n| `enum` / `domain` 타입 | 타입 안전 / **리포 관례 위반** — 참석 관련 도메인은 예외 없이 `text + CHECK 인라인`. |\n\n### 추천 (확정)\n\n- DB 컬럼: `attendances.meal_choice text not null default 'none' check (meal_choice in ('none','join','skip'))`\n- RPC: `public.set_meal_choice(p_session_id bigint, p_choice text) returns void`\n- TS 타입: `export type MealChoice = \"none\" | \"join\" | \"skip\";`\n- 데이터 레이어: `setMealChoice(sessionId, choice)`\n- 스토어 액션: `setMeal(sessionId, choice)`\n- 게이트: **새 세션 플래그 없음. `sessions.is_regular` 재사용** (목표 정의가 그렇고, sync/뷰/규칙 편집기 4곳 변경이 전부 불필요해진다).\n\n---
... (truncated 14770 chars, full result in /private/tmp/claude-501/-Users-sam-Projects-cocktime-scheduler/9000a4de-3893-4401-8ead-e887303fe2ca/tasks/wbx7optwi.output)</result>
<diagnostics>Per-agent results: /Users/sam/.claude/projects/-Users-sam-Projects-cocktime-scheduler/3c9a98f0-beb8-455f-9394-b9cf9716d7c1/subagents/workflows/wf_141a199c-839/journal.jsonl — one {"type":"result",...} line per completed agent with its full return value.
If the result above is empty or unexpected, Read this file BEFORE diagnosing — do not assume agents returned non-empty results.
To re-run with edited post-processing: Workflow({scriptPath: '/Users/sam/.claude/projects/-Users-sam-Projects-cocktime-scheduler/3c9a98f0-beb8-455f-9394-b9cf9716d7c1/workflows/scripts/meal-attendance-explore-wf_141a199c-839.js', resumeFromRunId: 'wf_141a199c-839'}) — agents whose (prompt, opts) are unchanged replay from cache.</diagnostics>
<usage><agent_count>6</agent_count><agents_done>6</agents_done><agents_error>0</agents_error><agents_skipped>0</agents_skipped><agents_empty_result>0</agents_empty_result><subagent_tokens>564385</subagent_tokens><tool_uses>203</tool_uses><duration_ms>745628</duration_ms></usage>
</task-notification>

**Answer**: 구현·검증 완료입니다. 배포(DB push)만 남았습니다.

## 동작

정모 회차 편집기에 **식사 참여 체크** 스위치를 새로 넣었고(`OccurrenceEditor.tsx:235`), 이걸 켠 회차에서만 참석자에게 식사 컨트롤이 뜹니다.

- **회원**: 일정 카드에 `식사 [ 참여 | 안 먹음 ]` 세그먼트 — 카풀 아래, 늦참 슬라이더 위. **기본값 참여**라서 안 먹는 사람만 바꾸면 됩니다.
- **게스트**: 계정이 없어 스스로 못 고르므로, 데려온 회원이 게스트 줄의 `🍚 식사` 칩으로 대신 토글합니다(`GuestSection.tsx`).
- **집계**: 카드 요약 `확정 12/16명 · 🍚 9`, 참여자 모달 헤더 `🍚 식사 9명`, 명단에는 **불참자만** `🍽️ 식사 안 함` 표식. 집계 기준은 확정 + 정원 외 늦참 중 참여(대기자는 승격돼야 오므로 숫자에서 제외하되, 선택 UI는 대기자에게도 노출).

## DB (`20260811010000_meal_attendance.sql`)

- `sessions.meal_enabled`(기본 false) + `attendances.meal_joining`(기본 **true**)
- `set_meal_joining(session, joining, member_id?)` — 본인 또는 내가 데려온 게스트. `attendances`에 UPDATE RLS 정책이 없어(SELECT 정책 단독) 직접 update는 조용히 0행이 되므로 RPC 필수였습니다.
- 취소 시 기본값 복원은 **BEFORE UPDATE 트리거 한 개**로 처리했습니다. 취소 경로가 `cancel_attendance`/`admin_cancel_attendance`/`cancel_guest_attendance` 3개로 갈려 UPDATE 술어가 복제돼 있고(실제로 게스트 경로엔 이미 `late_minutes` 리셋이 빠져 있습니다), 함수마다 한 줄씩 넣으면 한 곳을 빠뜨리는 비대칭 버그가 반복되기 때문입니다. 카운터·승격·알림은 건드리지 않아 정원/대기 로직과 완전히 분리됩니다.

## 검증

`pnpm run build`(tsc 포함) 통과, `pnpm test` 292개 통과, 변경 파일 lint 클린(리포에 남아 있는 7개 오류는 모두 제가 손대지 않은 기존 파일). Docker가 꺼져 있어 로컬 DB에서의 SQL 실행 검증은 못 했습니다.

## 배포 시 주의

1. **DB 먼저** `supabase db push` → 그다음 `git push`. 순서를 뒤집으면 새 프론트가 없는 RPC를 호출합니다.
2. `db push`는 미적용 마이그레이션을 **전부** 적용합니다. 지금 `20260810000000_day_cancel_grace_1h.sql`도 미적용 상태로 남아 있어 함께 올라갑니다 — 의도한 것인지 확인해 주세요.

## 알아두실 두 가지

- 기본값이 참여이므로 **카드를 아직 안 본 사람도 참여로 집계**됩니다. 실제 예약 인원보다 많게 나올 수 있는데, 반대(밥 못 먹는 사람 발생)보다 안전한 쪽이라 요청하신 모델대로 뒀습니다.
- 남의 식사 체크는 즉시 반영되지 않습니다(새로고침·포그라운드 복귀 때 갱신). Realtime 사용량 감축 방침에 따라 `attendances` 구독을 새로 추가하지 않았고, 카풀도 현재 같은 동작입니다.
- 대진표·안내 페이지(`RegularNoticePage`)에는 식사 인원을 넣지 않았습니다. 그 페이지가 참석 데이터를 조회하지 않아 별도 fetch가 필요해서, 원하시면 따로 붙이겠습니다.

---

## #52

**Prompt**: db push 해

**Answer**: 적용·검증 완료했습니다.

**프로덕션 확인 결과** (서비스키 읽기 조회):

| 대상 | 결과 |
|---|---|
| `sessions.meal_enabled` | 존재, 기존 회차 전부 `false` ✓ |
| `attendances.meal_joining` | 존재, 기존 행 전부 `true`(기본 참여) ✓ |
| `set_meal_joining` RPC | 존재 — service_role 호출이라 첫 가드(`not authenticated`)에서 막힘 = 함수·게이트 정상 ✓ |

취소 리셋 트리거는 마이그레이션이 한 트랜잭션으로 성공했고 `drop trigger if exists` NOTICE 뒤에 `create trigger`가 이어졌으니 함께 생성됐습니다. 동작 검증은 실제 참석 행을 취소해봐야 하는데 프로덕션 실데이터라 건드리지 않았습니다.

**정정**: 앞서 `20260810000000_day_cancel_grace_1h.sql`도 함께 올라갈 수 있다고 했는데, dry-run 결과 그건 이미 원격에 적용된 상태였고 이번에 push된 건 식사 마이그레이션 하나뿐입니다.

**남은 단계** — 프론트가 아직 안 나갔습니다. 지금은 DB만 앞서 있어(새 컬럼은 있고 UI는 없음) 기존 화면에 아무 영향이 없는 안전한 상태입니다. 커밋 후 `git push`하면 GitHub Pages로 배포됩니다. `/commit`으로 커밋할까요?

---

## #53

**Prompt**: 커밋후배포

**Answer**: 배포까지 완료했습니다.

## 결과

| 단계 | 상태 |
|---|---|
| DB 마이그레이션 | `20260811010000_meal_attendance.sql` 프로덕션 적용 + 컬럼·RPC 조회로 확인 |
| 커밋 | `65b6fee`, `a525dfb` |
| 배포 | GitHub Pages Deploy **success** (56s) — ckti.me 반영 |

커밋을 두 개로 나눴습니다. 워크스페이스에 이번 작업과 무관한 미커밋 변경이 남아 있었는데, 확인해보니 **당일취소 대관비 1시간 유예** 작업(마이그레이션 165줄 + 회계 스펙 문구)이었습니다. 이미 프로덕션 DB에는 적용된 상태로 커밋만 안 돼 있어서, 코드와 DB가 어긋난 채 남지 않도록 `65b6fee`로 먼저 분리해 커밋했습니다. 식사 기능은 `a525dfb`입니다.

`TODO.md`는 커밋하지 않고 그대로 뒀습니다. 리포에 넣을 파일인지 판단이 제 몫이 아니라서요 — 참고로 그 안의 첫 항목(미납자 진입 시 회비·계좌 알림)은 8/8 커밋으로 이미 구현돼 있습니다. 리포에 포함하길 원하시면 커밋하고, 아니면 `.gitignore`에 넣어 `git status`에서 안 뜨게 하겠습니다.

## 이제 확인해보실 것

운영진 계정으로 일정 편집 → **정모** 켜기 → 그 아래 새로 생긴 **식사 참여 체크** 켜고 저장하면, 회원 카드에 `식사 [ 참여 | 안 먹음 ]`이 뜹니다. 기존 정모 회차들은 `meal_enabled=false`로 들어갔으니 회차별로 직접 켜주셔야 합니다.

---

## #54

**Prompt**: 설정에서 식사 온오프할때 가게위치 넣을수있게 해주고 대진표 안넣으면 대진표보기 버튼 안보이게 해줘

**Answer**: 둘 다 배포 완료했습니다. DB(`20260811020000_meal_place.sql`) 적용 → 컬럼 조회 확인 → 커밋 `accf2a4` → Pages Deploy **success**.

## 1. 회식 가게 위치

식사 참여 체크를 켜면 그 아래에 입력 두 개가 열립니다:

- **회식 가게** — 가게명 (예: `산들애 곱창 상무점`)
- **가게 지도 링크 (선택)** — 카카오/네이버 지도 공유 링크

링크는 비워도 됩니다. 기존 모임 장소와 같은 지도 로직(`buildPlaceMapTarget`)을 재사용해서, 링크가 없으면 **가게 이름으로 카카오맵 검색**으로 폴백하고, 링크가 있으면 그 링크를 정확히 엽니다. 모바일에서는 카카오맵 앱이 먼저 뜨고 미설치면 웹으로 넘어갑니다.

표시는 두 곳 — 일정 카드의 `가게  🍚 …` 줄(식사 세그먼트 바로 아래)과 정모 안내 페이지 헤더입니다. **참석 여부와 무관하게 보이게** 했습니다. 어디서 먹는지 모르면 참여를 정할 수 없으니까요.

`places` 테이블에 음식점을 추가하는 방식은 택하지 않았습니다. `places`는 대관장소 마스터라서(`charges_court_fee` 게이트 + 일정 장소 드롭다운의 원본) 음식점이 섞이면 장소 선택 목록이 오염되고 대관비 부과 판정과 얽힙니다. 회식 가게는 회차마다 바뀌는 1회성 정보라 세션 행에 직접 뒀습니다.

## 2. 대진표 버튼

`notice_md`가 비어 있으면 `🏸 대진표 · 안내 보기` 버튼을 아예 렌더하지 않습니다. 편집기 안내 문구도 "비워두면 회원에겐 '준비 중'으로 보여요" → "비워두면 버튼이 아예 뜨지 않아요"로 고쳤습니다.

페이지 자체의 "준비 중" 안내는 남겨뒀습니다 — 버튼이 사라져도 이전에 받은 링크나 북마크로 직접 들어오는 경로가 있어서, 그때 빈 화면 대신 안내가 나오는 게 낫다고 봤습니다.

## 확인해보실 것

이미 정모+식사 체크를 켜두신 회차(세션 228)가 있는데 `meal_place`가 아직 비어 있습니다. 그 회차 편집기를 다시 열면 새 입력란이 보이니 가게를 넣어보시면 됩니다. 대진표도 아직 안 넣으셨다면 지금은 버튼이 안 보이는 상태입니다.

---

## #55

**Prompt**: 기존 시스템 활용한다고 했는데 지도검색 넣어줘

**Answer**: 배포 완료했습니다. DB 적용 → 스키마 교체 확인 → 커밋 `8cdd72e` → Deploy **success**.

## 바뀐 점

URL 붙여넣기 입력을 없애고, **장소 등록·거주지 입력에 쓰는 그 검색 컴포넌트**(`common/KakaoLocationSearch`)를 그대로 붙였습니다. 식사 체크를 켜면 회식 가게 자리에:

- 가게 이름을 타이핑하면 **300ms 디바운스로 자동완성** 목록(최대 7개, 이름+주소)
- 결과를 고르면 **지도 미리보기에 핀**이 찍히고 이름·좌표가 함께 저장
- 저장된 좌표가 있으면 회원이 가게를 탭할 때 이름 검색이 아니라 **정확한 핀**으로 열립니다 (웹 `link/map`, 모바일 `kakaomap://look`)
- 지도 키가 없거나 검색에 안 나오는 가게는 **이름만 타이핑해도 저장**됩니다(그때는 이름 검색으로 폴백) — 이 폴백은 컴포넌트에 원래 있던 동작입니다

편집기 아래에 상태 문구를 뒀습니다: 좌표가 잡히면 `✓ 위치 지정됨`, 아니면 이름만 적어도 된다는 안내.

**이름을 직접 고쳐 쓰면 좌표를 버립니다.** 예를 들어 검색으로 A가게를 고른 뒤 이름만 B로 바꿔 쓰면, 남은 A좌표는 B와 무관한 엉뚱한 핀이 됩니다. 그럴 땐 좌표를 버리고 이름 검색으로 폴백하는 쪽이 안전합니다. 가게명을 비우면 좌표도 같이 비웁니다.

## 어제 만든 컬럼 하나를 지웠습니다

`meal_place_url`(링크 수동 붙여넣기)은 **drop**했습니다. 검색이 들어오면 운영진이 지도 앱에서 링크를 찾아 붙여넣을 이유가 없고, 안 쓰는 컬럼을 남기면 나중에 "링크는 어디서 넣나" 하는 혼선만 생깁니다. 지우기 전에 전 회차에서 값이 0건임을 조회로 확인했고(입력 UI가 하루도 안 떴습니다), 지운 뒤 REST가 그 컬럼에 400을 주는 것까지 확인했습니다. 데이터 손실은 없습니다.

정모+식사를 켜두신 세션 228의 편집기를 다시 열면 새 검색창이 보입니다.

---

## #56

**Prompt**: 주소검색할때 자동완성되는 영역이 popover 로 나오게 해줘. 엘리먼트 밀지말고

**Answer**: 배포 완료 (`3da8dc4`, Deploy success). DB 변경은 없었습니다.

## 1. 자동완성 → popover

목록이 문서 흐름에서 빠져 지도 미리보기와 아래 요소를 더 이상 밀지 않습니다. 입력칸 좌표를 계산해 바로 아래에 붙이고, 아래 공간이 좁으면 위로 뒤집습니다. 시트 스크롤·리사이즈·iOS 키보드로 뷰포트가 바뀌면 따라 움직입니다.

`absolute`나 `fixed`가 아니라 **top layer**를 쓴 이유가 있습니다. 이 컴포넌트는 `ModalSheet` 안에서 쓰이고 시트는 `overflow-y: auto` + `backdrop-filter`입니다. `absolute`는 시트 경계에서 잘리고, `backdrop-filter`가 fixed의 containing block을 만들기 때문에 `position: fixed`조차 시트에 갇힙니다. top layer는 조상의 overflow·filter·z-index를 전부 무시해서 이 두 함정을 한 번에 피합니다.

곁들여 처리한 것:
- **`display` 직접 토글** — popover 미지원 브라우저(iOS 16 이하)에는 `[popover]:not(:popover-open){display:none}` UA 규칙이 없어서, 그냥 두면 빈 목록이 **항상 화면에 떠 있게** 됩니다. 좌표 확정 전에도 숨겨서 (0,0) 깜빡임도 막았습니다.
- "검색 결과가 없어요" 안내문도 목록 안으로 옮겼습니다. 그것도 한 줄만큼 밀어냈으니까요.
- `manual` popover는 light-dismiss가 없어서 바깥 클릭 시 닫기를 직접 넣었습니다(입력칸 클릭은 예외 — 이어 타이핑하는 흐름을 끊지 않게).

공용 컴포넌트라 **거주지 입력(프로필)도 같이 개선**됐습니다.

## 2. 식사·가게 한 줄

[코드 블록 생략]

가게가 함께 있으면 세그먼트를 자연폭으로 줄이고(원래는 `flex:1` 풀폭) 가게를 우측에 붙였습니다. 가게명이 길면 잘립니다. 참석 전인 회원에게는 선택 버튼 없이 가게만, 가게를 안 넣은 회차에는 세그먼트가 예전처럼 풀폭으로 나옵니다.

## 확인 부탁

popover 위치·뒤집힘·키보드 올라온 상태는 실제 기기에서 봐야 확실합니다. 로그인과 운영진 권한이 필요해 제가 브라우저로 띄워보진 못했습니다. 정모 회차 편집기에서 가게를 검색해보시고, 목록이 입력칸에 잘 붙는지·시트를 스크롤할 때 따라오는지 봐주세요. 어긋나면 좌표 계산을 조정하겠습니다.

---

## #57

**Prompt**: [Image #2] 세그먼트 높이좀 위랑 통일해줘

**Answer**: _(응답 대기 중…)_

---

## #58

**Prompt**: 높이맞춘건 좋은데 좌우도 좀 fill 해줘

**Answer**: 배포 완료 (`67c69d3`, Deploy success).

가게를 트랙에서 꺼내 원래 알약 디자인(둥근 회색 배경 + 화살표)으로 되돌리고, **폭만** 격자에 맞췄습니다:

[코드 블록 생략]

세그먼트가 2칸분을 갖고 내부 두 버튼이 각각 1칸씩, 가게 알약이 남은 1칸을 차지합니다. 세로 padding을 세그먼트 버튼과 같은 6px로 맞춰서 줄 높이도 카풀·늦참과 동일합니다.

가게를 안 넣은 회차에서는 세그먼트가 예전처럼 풀폭(`flex:1`)으로 돌아가고, 참석 전인 회원에게는 알약이 내용 폭으로만 표시됩니다.

앞선 커밋에서 놓친 점을 짚어주셔서 고쳤습니다 — "3등분해줘"를 트랙 안에 칸을 하나 더 만드는 것으로 받아들여 디자인까지 바꿔버렸는데, 크기만 맞추라는 뜻이었습니다.

트랙 gap(2px)과 줄 gap(10px)이 달라서 가게 칸이 카풀 칸보다 몇 px 좁습니다. 눈에 걸리면 정확히 계산해 맞추겠습니다.

---

## #59

**Prompt**: 알약은 최초 디자인 그대로 해주고, 3등분 크기 맞게 해주고 알약 크기가 넘어가면 ... 으로 하게해.

**Answer**: 배포 완료 (`6801b6b`, Deploy success).

세 가지 반영했습니다:

1. **알약 여백 원복** — `padding: 3px 10px`, `fontSize: 12`, 화살표 12px로 최초 디자인 그대로입니다. 직전 커밋에서 세그먼트 버튼 높이에 맞추려고 6px으로 키웠던 걸 되돌렸습니다. 줄이 `align-items: center`라 알약이 작아도 세로 중앙에 놓여서 줄 높이는 그대로입니다.

2. **폭은 3등분 격자 한 칸** — `flex: 1` 유지 (세그먼트가 2칸분, 알약이 1칸분).

3. **넘치면 `…`** — 여기에 실제 버그가 있었습니다. `truncate`만으로는 `…`이 나오지 않습니다. flex 자식의 기본 `min-width: auto`는 `nowrap` 텍스트의 min-content(=텍스트 전체 폭) 아래로 줄어들지 않기 때문에, 긴 가게명은 잘리는 대신 칸을 넘쳐 흘렀습니다. 텍스트에 `min-w-0`을 넣어 이제 칸 폭에서 `🍚 청산유수가…` 처럼 잘립니다.

좌표 없이 이름만 저장된 경우의 폴백 표시에도 같이 적용했습니다.

---

## #60

**Prompt**: 아니 3등분된 간격에서 1/2 영역은 참여/불참이 차지하고 남은 한칸의 우측정렬로 알약이 들어가면 돼.

**Answer**: 배포 완료 (`fc5ae34`, Deploy success).

[코드 블록 생략]

알약에 `flex:1`을 직접 주면 배경이 칸 전체로 늘어나 최초 디자인과 달라지므로, **폭 확보는 래퍼가 맡고**(`flex:1` + `justify-end`) 알약은 `w-fit`으로 내용 폭만 차지한 뒤 칸 오른쪽에 붙습니다. 세그먼트는 그대로 2칸분이라 참여/안 먹음이 각각 카풀 한 칸과 같은 폭입니다.

이름이 칸보다 길면 알약이 줄어들며 `🍚 청산유수가…` 로 잘립니다(래퍼·알약·텍스트 모두 `min-w-0`이라 축소가 전달됩니다).

---

## #61

**Prompt**: 보니까 식사 라인이 gap 때문에 3등분해도 뱃지와 떨어지는거같은데 이걸 수정해

**Answer**: _(응답 대기 중…)_

---

## #62

**Prompt**: 보니까 식사 라인이 gap 때문에 3등분해도 크기가 미묘하게 다른거같은데 이거 수정하고 커밋하고 푸쉬해

**Answer**: 커밋·푸시·배포 완료 (`ef4989e`, Deploy success).

## 어긋난 이유

`flex: 2` / `flex: 1` 비율로는 정확히 3등분이 안 됐습니다. 카풀은 트랙 하나가 줄 폭 `W`를 전부 쓰고 그 안에서 나뉘므로

[코드 블록 생략]

인데, 식사 줄에는 세그먼트와 알약 사이에 **`ctl-row`의 10px gap이 하나 더** 끼고 트랙 내부 gap도 2개가 아니라 1개뿐이었습니다:

[코드 블록 생략]

## 수정

세그먼트와 알약을 **트랙 내부와 같은 gap 2px** 래퍼로 묶고, 세그먼트 basis를 계산값으로 고정했습니다:

[코드 블록 생략]

알약은 `flex: 1`로 남은 폭을 받는데, 그 값이 `W - 2 - A` = 정확히 `C`가 됩니다. 이제 참여·안 먹음·알약 세 칸이 카풀 세 칸과 픽셀 단위로 같습니다. `100%`(래퍼 폭)만 쓰기 때문에 라벨 폭이나 화면 크기가 달라져도 유지됩니다.

가게를 안 넣은 회차는 세그먼트가 그대로 `flex:1` 풀폭이라 카풀과 같은 모습입니다.

---

## #63

**Prompt**: 식사 참여체크여부는 사용자가 어떻게 확인함?

**Answer**: 커밋·배포 완료했습니다.

[코드 블록 생략]

히스토리는 훅이 이미 `#67~#69`로 기록해둔 상태라 중복 기록하지 않고 그대로 커밋에 포함했습니다.

## 배포 검증

GitHub Pages 워크플로가 `b1caa82`로 **success**. 로컬 빌드 해시(`C5A4fs30`)와 서버 번들(`DnRPVPpv`)이 달라서 — CI 빌드 환경 차이입니다 — 해시 대조 대신 배포된 번들 내용을 직접 확인했습니다:

- 신규 문자열 전부 존재: `정산 대조` · `전체 명단` · `인원 대조` · `부과 누락` · `1시간 내 철회` · `부과삭제`
- 폐기된 것 전부 부재: `명에게 미납 안내 보내기` · `미납 알림 발송` · `dues_notify_selected`

DB 마이그레이션과 Edge Function 변경은 없어서(`supabase/` 무변경) `supabase db push`·`functions deploy`는 실행하지 않았습니다. 프론트 전용이라 push로 배포가 끝났습니다.

## 커밋에서 제외한 것

`TODO.md` — 이전부터 untracked였던 사용자 메모(내용은 이미 구현된 UnpaidDuesAlert 건)라 제 작업과 무관해 그대로 뒀습니다. 커밋하려면 말씀해 주세요.

## 아직 남은 판단 (코드로는 못 고침)

`#106` 심상욱 6,000원(8/8 사전취소·완납), `#107` 김영주 6,000원(확정 후 4.9초 철회·완납) — 실제로 더 받은 12,000원입니다. 자동정리가 `amount_paid = 0`만 지우므로 남아 있고, 이제 두 세션의 `⚠ 확인 1`로 화면에 뜹니다. 환불이냐 다음 세션 이월이냐만 정해주시면 처리하겠습니다.

---

## #64

**Prompt**: go on

**Answer**: 배포 완료 (`058178e`, Deploy success).

## 확인 경로 (3곳)

**1. 본인이 뭘 골랐는지** — 일정 카드 `식사 [ 참여 | 안 먹음 ]`에서 선택한 쪽이 색으로 칠해집니다. 기본값이 참여라서, 아무것도 안 만진 사람은 `참여`가 초록으로 켜져 있습니다.

**2. 몇 명 먹는지** — 카드 요약 줄: `확정 24/24명 · 대기 8 · 식사 24`. 확정 + 정원 외 늦참 중 참여자 수입니다(대기자는 승격돼야 오므로 제외).

**3. 누가 안 먹는지** — 아바타 줄을 탭해 참여자 명단을 열면, 헤더에 `· 식사 24명`, 각 줄 우측에 **불참자만** `식사 안 함`이 붙습니다. 기본이 참여라서 불참이 정보량이 큰 쪽이고, 24명 전원에 `식사` 배지를 붙이면 늦참 시각·대기 순번과 우측이 뒤엉킵니다.

**게스트**는 초대한 회원이 게스트 줄의 `식사 참여`/`식사 안 함` 칩으로 대신 고릅니다.

## 확인하는 김에 고친 것

스크린샷에 `· ⚪ 24`로 보였던 회색 원이 실제 버그였습니다. 파일 바이트는 U+1F35A(🍚)로 정상인데, 전역 `font-family`가 `sans-serif`로 끝나서 이모지 폰트가 폴백 목록에 아예 없었습니다. font-family 폴백은 글리프 단위로 동작하고 `sans-serif`는 항상 매치되므로, 그 **앞에** `Apple Color Emoji`/`Segoe UI Emoji`/`Noto Color Emoji`를 넣었습니다. 🚗는 우연히 잡히고 🍚는 못 잡히던 이유가 이것이고, 카풀·게스트·늦참 등 기존 이모지 표기도 함께 안정됩니다.

표기도 정리했습니다 — 요약 줄은 `대기 8 · 늦참 2`처럼 텍스트 라벨이 관례인데 식사만 이모지였습니다. 이제 `식사 24`로 통일했고, 이모지가 깨지는 환경에서도 뜻이 전달됩니다.

## 아직 없는 것

운영진이 **식당에 예약할 때 쓸 "먹는 사람 이름 목록"** 을 한 번에 보거나 복사하는 기능은 없습니다. 지금은 명단에서 `식사 안 함`이 붙지 않은 사람을 눈으로 세야 합니다. 카풀 공지 빌더처럼 `식사 명단 복사` 버튼을 붙이는 자리가 이미 있으니, 필요하시면 만들겠습니다.

---

## #65

**Prompt**: 회계 현황탭보면 정보가 좀 부족한데 실제 부과가 발급된 명단과 실제 참여자인데 부과가 발급되지 않은 사람, 코트 지출 및 납입한 금액 총합 이것들을 한번에 보여줄 방법이 있을까 지금 헷갈리는게 당일불참자가 있어서 돈을 더 받았는데 참여자인원이랑 6천원 곱하면 돈이 안맞아서 한번 더 생각하게 되고 그럴때가 있어서

**Answer**: 완료했습니다. 실제 `#106`(8.9 에이트민턴) 데이터로 [정산 대조] 시트가 이렇게 나옵니다:

[코드 블록 생략]

**"돈이 안 맞는다"의 답이 화면에 나옵니다**: `참석 23 × 6,000 = 138,000`인데 낼 돈은 `156,000`. 차이 +18,000은 운영진 −1명, 당일취소 +3명, 사전취소 잔재 +1건입니다.

## 만든 것

- **`sessionSettle.ts`** — 서버 `dues_generate_session_court`의 클라 미러(엔빵/정액 분기, `dues_is_day_cancel_chargeable`, 10원 버림). 순수 함수라 테스트로 서버와 대조합니다. 이게 갈리면 "부과 누락" 판정이 틀리므로 파일 상단에 불변식을 명시했습니다.
- **`SessionSettleSheet.tsx`** — 카드 [정산 대조] → 시트. **열람 전용**입니다. 부과삭제·미납안내는 기존 카드 펼침에 그대로 뒀습니다(같은 액션이 두 곳에 생기면 동기화 책임이 갈립니다).
- **카드 ⚠ 배지** — 참석↔부과 불일치는 마감 판정(지출연결+미납0)에 안 걸려서 `마감 ✓` 세션에도 숨습니다. 그래서 따로 세웁니다.
- **쿼리 확장 왕복 0회** — `recurring_schedules(court_fee)`(엔빵 총액 fallback)와 `attendances(status, confirmed_at, cancelled_at)`를 기존 세션 select에 얹었습니다.

## 실측 검증 (프로덕션 7~8월 8세션)

두 항등식이 전부 닫힙니다 — ①`참석 − 운영진 + 당일취소 = 부과 대상` ②`부과대상 − 누락 − 부과삭제 + 대상아닌부과 = 실제 부과`. 엔빵 세션(`#182` SM, 총액 90,000 ÷ 12명 = 7,500)도 정상입니다.

검증 중 두 가지를 고쳤습니다:
- `#200`(7.25): grace 잔재 2건이 **이미 void 처리**돼 있었습니다 → ⚠에서 제외(늑대소년 방지)
- `#166`(7.5): 참석 기록 없는 초기 세션의 부과 14건 → 규칙 위반이 아니라 **대조 근거 없음**이라 별도 정보 라인으로 분리

결과적으로 8세션 중 ⚠가 뜨는 건 `#106`·`#107` 둘뿐입니다.

## 남은 판단 (제 권한 밖)

`#106` 심상욱 6,000원(8/8 사전취소·완납), `#107` 김영주 6,000원(확정 후 4.9초 철회·완납) — **실제로 더 받은 12,000원**입니다. 자동정리는 `amount_paid = 0`만 지우므로 코드로는 못 건드립니다. 환불할지 다음 세션 대관비로 이월할지는 결정해 주시면 처리하겠습니다.

검증: `pnpm tsc`·`eslint` 무오류, 테스트 317개(신규 25개 포함) 통과, 빌드 성공. `docs/ACCOUNTING_SPEC.md` §3.1.1·§11 갱신. 변경 파일은 staging만 했고 커밋은 안 했습니다.

---

## #66

**Prompt**: 이제 앱 들어오면 부과에따라 팝업이 뜨기때문에 사용자에게 푸쉬보내는 기능이 필요없어졌어. 그래서 대관비 수납 우측의 펼침목록대신, 모달을 띄우는 버튼만 남겨줘

**Answer**: 완료했습니다. `SessionsHome.tsx`가 366줄 중 대부분 삭제로 줄었습니다.

## 세션 카드 (펼침 → 버튼)

[코드 블록 생략]

`대관비 수납` 행의 `▼` 펼침을 `[정산 대조 ›]` 버튼으로 바꿨습니다. 진행률·미납 수는 그 자리에 남겨서 카드만 봐도 상태는 보입니다.

## 옮긴 것 / 지운 것

**지움 — 푸시 발송 경로 전체**
- 세션 카드 펼침(체크박스 취사선택 + `N명에게 미납 안내 보내기` + 납부완료 명단)
- 회비 카드의 발송 버튼
- `duesNotifySelected` 클라 래퍼, 발송 확인 다이얼로그, `excluded`/`notifyReq`/`toggleSel`/`SendButton`/`MemberToggleList`
- RPC `dues_notify_selected`는 **DB에 그대로 뒀습니다** — 마이그레이션을 건드리지 않았으니 필요하면 래퍼만 되살리면 됩니다.

**옮김 — 당일취소 [부과삭제]/[되돌리기]**

펼침을 없애면 이 조작이 갈 곳이 없어집니다(푸시와 달리 여전히 필요한 기능). 그래서 모달의 `부과 명단`으로 옮겼습니다 — `당일취소` 딱지가 붙은 행 끝에 버튼이 붙고, void된 행은 취소선 + `삭제함 · 운영진명` + [되돌리기]입니다. 안내 문구("당일취소는 자리값이라 정액이 기본 부과돼요…")도 함께 옮겼습니다. 확인 다이얼로그는 `zIndex 70`으로 모달 위에 겹치고, 처리 후 모달은 **닫히지 않고 갱신**됩니다(`settleId` 유지).

**남김 — 회비 미납 펼침**

`미납 3명 ▾`을 누르면 명단이 열리고 각 행에 [이월]만 있습니다. 이월은 푸시와 무관하게 필요한 기능이라 유지했습니다. 발송 관련 UI(체크박스·발송 버튼)만 빠졌습니다.

## 부수 효과 하나

이전에는 **전원 완납일 때만** 납부자 명단이 보였는데, 이제 모달의 `부과 명단`이 상시 전원(완납·미납·당일취소·부과삭제)을 보여줍니다. 미납이 남은 세션에서도 누가 냈는지 확인 가능합니다.

검증: `tsc` 무오류, 변경 파일 `eslint` clean, 테스트 317개 통과, 빌드 성공. `ACCOUNTING_SPEC.md` §3.1·§3.1.1·§9·§12 갱신(폐기 사유와 RPC 잔존 사실 명시). staging만 했고 커밋은 안 했습니다.

`src/` 전체 린트에는 오류 6건이 있는데 전부 제가 건드리지 않은 파일(`ModalSheet.tsx`, `PlayerCard.tsx`, `useSetupPlayers.ts` 등의 `react-hooks/set-state-in-effect`)로 기존 상태입니다.

---

## #67

**Prompt**: 정산대조 옆에 > 있으니까 얜 누가봐도 버튼임을 알아서 파란배경 지우고 텍스트톤을 다른 글자에 맞춰.
그리고 부과명단에 전체명단을 표시하고 우측에 사유를 적는 식으로 해줘, 그러니까 지금 확인필요, 부과없음도 그 목록에 같이 노출해달란거야

**Answer**: 둘 다 반영했습니다.

## 1. `정산 대조 ›` 톤

배경(`rgba(11,132,255,0.1)`)·파란 글자·`fontWeight 700`을 지우고, 같은 행의 `20/22 · 미납 2`와 동일한 `text-muted` / `11.5px`로 맞췄습니다.

[코드 블록 생략]

## 2. 전체 명단 하나로

`부과 명단` / `⚠ 확인 필요` / `부과 없음 · 정상` 세 섹션을 없애고 한 목록으로 합쳤습니다. 우측에 사유가 붙습니다.

[코드 블록 생략]

정렬은 **확인할 것부터**입니다: 누락 → 잔재 → 정상부과(완납→미납→무효) → 참석기록없음 → 정상면제. 부과 없는 행은 금액·상태칩 자리가 비고 사유만 놓입니다.

사유 문구는 **부과 유무로 갈립니다**. 같은 `grace`라도 부과가 없으면 `확정 후 1시간 내 철회 · 미부과`(회색), 부과가 있으면 `1시간 내 철회인데 부과됨`(빨강) — 후자가 실제로 돈이 더 들어온 케이스라 색으로 구분됩니다.

## 구현

명단 병합은 `sessionSettle.ts`의 파생값 `roster`로 뺐습니다(컴포넌트에서 세 배열을 합치지 않게). `RosterKind` 5종 + `KIND_RANK` 정렬이 단일 소스이고, 테스트 4개를 추가했습니다 — 누구도 빠지지 않는지(`roster.length === charged + missing + exempt`), 정렬 순서, 부과 없는 행의 `charge=null`/`reason`, void된 당일취소가 `stale`이 아니라 `charged`로 남는지.

검증: `tsc` 무오류, 변경 파일 `eslint` clean, 테스트 321개 통과(신규 4개), 빌드 성공. `ACCOUNTING_SPEC.md` §3.1·§3.1.1 갱신. staging만 했습니다.

---

## #68

**Prompt**: 명단 가나다 이름순으로 정렬. 그리고 정산대조 우측의 > 가 세로가운데정렬되게

**Answer**: 세 가지 다 반영했습니다.

**1. 이름 가나다순** — `localeCompare(…, "ko")`. `RosterKind` 순위는 동명이인 tie-break로만 남겼습니다.

**2. `›` 세로 가운데** — `›` 글리프는 x-height 기준이라 한글과 나란히 두면 아래로 처집니다. 별도 span에 `lineHeight: 1`을 줘 자기 박스를 만들고 `flex items-center`로 맞췄습니다.

**3. 헤더 상태별 카운트**

[코드 블록 생략]

`완납/미납/무효/부과없음`은 **명단의 분할**이라 합이 명단 수와 일치합니다(테스트로 강제). `⚠ 확인`은 그 분할을 가로지르는 플래그라 맨 끝에 따로 붙였습니다 — 예컨대 `#106` 심상욱은 `완납`에도 들어가고 `⚠ 확인`에도 들어갑니다. 0은 생략, 좁은 화면에선 줄바꿈합니다.

## 이름순으로 놓으니 드러난 버그 두 개

이름순 정렬이 아니었으면 계속 못 봤을 문제라 함께 고쳤습니다.

**한 사람이 두 줄로 나옴** — `exempt`가 부과 보유자를 걸러내지 않아서, grace 철회인데 `void` 부과가 남은 사람이 `확정 후 1시간 내 철회 · 미부과`와 `무효 부과` 두 줄로 떴습니다. 기존 정렬에선 두 줄이 목록 양 끝에 흩어져 안 보였고, 이름순으로 붙자 드러났습니다. `#200`(차성민·김재완)이 실제 해당 케이스입니다.

**오지도 않은 운영진이 "면제"로 뜸** — 판정에서 운영진 체크가 참석 체크보다 앞에 있어서, 사전취소·대기한 운영진까지 `운영진 · 대관비 면제`로 명단에 올라왔습니다. `#106`은 참석 운영진이 1명인데 3명으로 떴습니다. 순서를 `자리를 잡았는지 → 운영진`으로 바꿨습니다.

## 실측 재검증 (7~8월 8세션)

항등식 ①② 전부 OK, 중복 0. 명단에 뜨는 면제가 실제 참석 운영진 수와 일치합니다:

| 세션 | 전체 명단 | 면제 | ⚠ 확인 |
|---|---|---|---|
| 8.9 #106 | 28명 | 운영진 1 · grace 1 | 1 (심상욱) |
| 8.2 #107 | 25명 | 운영진 3 | 1 (김영주) |
| 7.26 #108 | 26명 | 운영진 3 | 0 |
| 7.25 #200 | 20명 | 운영진 2 | 0 (grace 2건 void 처리됨) |
| 7.19 #109 | 36명 | 운영진 6 | 0 |
| 7.17 #182 엔빵 | 13명 | 엔빵-당일취소 1 | 0 |
| 7.12 #104 | 26명 | 운영진 4 | 0 |
| 7.5 #166 | 15명 | — | 0 (참석기록없음 14는 조용히) |

검증: `tsc` 무오류, 변경 파일 `eslint` clean, 테스트 324개 통과(신규 3개: 가나다 정렬 / 중복 없음 / `rosterCounts` 분할 합), 빌드 성공. staging만 했습니다.

---

## #69

**Prompt**: 확인카운트가 완납카운트에 포함되어있으면 헷갈리는데 빼야하는거 아냐?

**Answer**: 맞는 지적이었습니다. 배타적인 5칸으로 바꿨습니다.

**전:** `완납 26 · 부과없음 2 · ⚠ 확인 1` — 합 29인데 명단은 28명 (심상욱이 완납·확인에 이중 계상)
**후:** `완납 25 · 부과없음 2 · ⚠ 확인 1` — 합 28 = 명단 28명

확인이 필요하다는 게 그 사람에 대한 더 중요한 사실이라, 납부 상태 대신 `⚠확인`으로만 셉니다. 잔재는 `완납`에서, 누락은 `부과없음`에서 빠집니다. 불변식 `완납+미납+무효+부과없음+확인 = 명단 수`를 테스트로 고정했습니다.

한 가지 판단이 필요했던 것: **참석기록없음(고아) 부과는 `⚠확인`에 넣지 않고 정상 납부 상태로 셉니다.** 대조할 근거가 없을 뿐 규칙 위반이 아니라서입니다(#166의 14건). 이건 이전 결정과 일관됩니다 — 카드 ⚠배지도 고아는 세지 않습니다.

부수적으로 `flaggedCount`를 파생값으로 올려 **카드 배지와 시트 헤더가 같은 값을 공유**하게 했습니다. 전에는 두 컴포넌트가 각각 `missing.length + staleCharges.length`를 더하고 있어서 한쪽만 바뀔 여지가 있었습니다.

## 실측 재검증 (7~8월 8세션)

| 세션 | 명단 | 헤더 | 분할 |
|---|---|---|---|
| 8.9 #106 | 28 | 완납 25 · 부과없음 2 · ⚠확인 1 | OK |
| 8.2 #107 | 25 | 완납 21 · 부과없음 3 · ⚠확인 1 | OK |
| 7.26 #108 | 26 | 완납 23 · 부과없음 3 | OK |
| 7.25 #200 | 20 | 완납 16 · 무효 2 · 부과없음 2 | OK |
| 7.19 #109 | 36 | 완납 30 · 부과없음 6 | OK |
| 7.17 #182 엔빵 | 13 | 완납 12 · 부과없음 1 | OK |
| 7.12 #104 | 26 | 완납 22 · 부과없음 4 | OK |
| 7.5 #166 | 15 | 완납 15 | OK |

검증: `tsc` 무오류, 변경 파일 `eslint` clean, 테스트 325개 통과(분할 불변식·단일 소스 일치 테스트 추가), 빌드 성공. `ACCOUNTING_SPEC.md` §3.1.1에 이중 계상 금지 이유와 실측 예시를 남겼습니다. staging만 했습니다.

---

## #70

**Prompt**: 클로드에서 입력한 문장 지우는법이 두개있는데 Ctrl+C 와 Esc 야. 근데 에이전트가 작업중일떄 중지도 똑같아. 이러면 난 문장만 지우고싶은데 에이전트가 중지한단 말야? Esc는 문장지우게, Ctrl+C가 작업중지일떄 이렇게 분리하고싶은데 가능할까.

**Answer**: 가능합니다. `~/.claude/keybindings.json`을 만들었습니다.

[코드 블록 생략]

**적용: Claude Code 재시작 필요** (설정은 시작 시 로드).

## 왜 이렇게 되는가

설치된 번들(`~/.local/share/claude/versions/2.1.228`)의 기본 바인딩을 직접 확인했습니다.

- Chat 컨텍스트 기본값이 `escape: "chat:cancel"`이고, **작업 중지의 정체가 이 `chat:cancel`**입니다. 실행 중인 요청/태스크가 있을 때만 활성화됩니다. 그래서 문장 지우려고 Esc를 누르면 중지가 걸립니다.
- `ctrl+c`는 `app:interrupt`(Global)로 **이미 작업 중지**입니다. Ctrl+C·Ctrl+D는 하드코딩이라 재바인딩 자체가 불가하지만, 원하는 동작이 이미 기본값이라 손댈 필요가 없습니다.
- 사용자 바인딩은 기본값 뒤에 붙고 **같은 키는 마지막 것이 이깁니다**(리졸버가 매칭 목록을 끝까지 훑어 마지막 항목을 채택). 그래서 `escape: null` 없이 한 줄로 덮어써집니다.

## `chat:clearInput`은 쓰면 안 됩니다

이름 때문에 이걸 고르기 쉬운데, 실제 구현은 **터미널 화면 강제 리드로 + "Press ctrl+l again to /clear" 힌트 → 2초 안에 다시 누르면 `/clear` 실행(대화 컨텍스트 삭제)** 입니다. Esc에 붙이면 Esc 두 번에 대화가 날아갑니다.

입력 텍스트를 실제로 비우는 건 `chat:stash`입니다. 내용을 저장소에 담아두고 입력줄을 비웁니다.

## 알아둘 점

- **입력이 빈 상태에서 Esc를 다시 누르면 방금 지운 문장이 복원됩니다** (stash는 토글). 실수로 지웠을 때 되살릴 수 있는 셈이지만, "지웠는데 다시 나타남"으로 느껴질 수 있습니다.
- 기본 동작이던 `Esc` → "Esc again to clear" → `Esc` (2번 눌러 지우기)는 이제 **한 번**으로 대체됩니다.
- Esc로 걸던 작업 중지는 없어집니다(의도한 바). 중지는 Ctrl+C로.
- 자동완성 메뉴·확인 다이얼로그·트랜스크립트 등 다른 컨텍스트의 Esc는 각 핸들러가 자기 컨텍스트 기준으로 따로 해석하므로 유지될 것으로 보입니다. 만약 자동완성 메뉴에서 Esc가 이상하게 동작하면 Chat 블록 **뒤에** `{ "context": "Autocomplete", "bindings": { "escape": "autocomplete:dismiss" } }`를 추가하면 됩니다.
- 에이전트가 **실행 중일 때** Esc가 입력을 지워주는지는 `chat:stash` 핸들러의 활성 조건에 달려 있어 코드만으로는 확정하지 못했습니다. 최소한 중지는 걸리지 않습니다. 실행 중에 한 번 눌러 확인해 보세요.

검증하려면 `claude --debug`에서 `[keybindings] Loaded 1 user bindings`를 확인하면 됩니다. `Duplicate binding "escape" in Chat context` 경고는 기본값을 덮어썼다는 정상 신호입니다(마지막 것이 적용됨).

---

## #71

**Prompt**: stash 된 메세지는 꺼내는 방법이 있어?

**Answer**: 꺼내는 방법 두 가지가 있습니다. 번들 코드로 확인한 동작입니다.

**1) 같은 키를 입력줄이 빈 상태에서 한 번 더**

`chat:stash`는 토글입니다. 입력에 내용이 있으면 저장 후 비우고, **입력이 비어 있으면 저장된 걸 되돌립니다.** 기본 키는 `ctrl+s`, 지금 설정으로는 Esc입니다. 텍스트뿐 아니라 **커서 위치와 붙여넣은 첨부(이미지 등)까지** 복원됩니다. 복원되면 저장 슬롯은 비워집니다.

**2) 다른 메시지를 전송하면 자동 복원**

프롬프트를 하나 보내고 나서 입력줄이 비어 있으면, 저장된 초안이 **자동으로 입력줄에 되돌아오고** `Draft restored` 알림이 뜹니다. 원래 이 기능의 설계 의도가 "쓰던 문장 잠깐 치워두고 급한 것 먼저 보내면 돌아온다"입니다.

## 한계

- **슬롯이 하나뿐**입니다. 내용이 있는 상태에서 다시 stash하면 이전 초안을 덮어쓰고, 덮인 건 복구 불가입니다.
- **세션 메모리**(`useState`)라서 Claude Code를 종료하면 사라집니다.
- **프롬프트 히스토리에 들어가지 않습니다.** ↑ 화살표로는 못 꺼냅니다.

## Esc 설정과 엮이는 부분

2번 때문에, Esc로 문장을 치운 뒤 다른 걸 보내면 **치웠던 문장이 입력줄에 다시 나타납니다**. "Esc는 지우기"라는 감각으로 쓰면 이게 걸릴 수 있습니다.

완전히 지우는 쪽이 낫다면 `"escape": "chat:stash"` 대신 `"escape": null`(Chat 컨텍스트에서 언바인드)로 두는 방법이 있습니다. 그러면 Esc가 `chat:cancel`을 타지 않으니 중지는 안 걸리고, 입력창 자체의 기본 동작인 **Esc 두 번 → 지우기**("Esc again to clear")로 돌아갑니다. 이쪽은 지운 내용이 프롬프트 히스토리에 저장돼서 ↑로 되살릴 수 있습니다. 대신 두 번 눌러야 하고, 언바인드된 키가 입력창까지 전달되는지는 코드만으로 확정하지 못해 실제로 눌러 확인이 필요합니다.

참고로 `Tip: esc stash` 같은 힌트가 한 번 뜰 수 있는데, 힌트가 액션 기준으로 키를 표시하므로 재바인딩한 Esc로 정확히 나옵니다.

---

## #72

**Prompt**: 디비보고 엄지현이 최근 한달내에 참여한 날짜를 달력형태의 그리드로 표현해줘

**Answer**: DB 조회 결과입니다. **엄지현** (`8a1bb449…`, 정회원, F)

## 2026년 7월

| 일 | 월 | 화 | 수 | 목 | 금 | 토 |
|---|---|---|---|---|---|---|
| | | | 1 | 2 | 3 | 4 |
| 5 | 6 | 7 | 8 | 9 | 10 | 11 |
| 12 | **13 ●1** | 14 ○ | 15 | **16 ●6** | 17 ○ | 18 ○ |
| **19 ●7** | 20 | 21 ○ | 22 | **23 ●7** | 24 ○ | 25 |
| 26 ○ | **27 ●7** | 28 | **29 ●7** | **30 ●6** | **31 ●6** | |

## 2026년 8월

| 일 | 월 | 화 | 수 | 목 | 금 | 토 |
|---|---|---|---|---|---|---|
| | | | | | | 1 |
| 2 | **3 ●7** | 4 ○ | 5 ○ | 6 ○ | **7 ●8** | 8 |
| 9 | 10 | 11 | 12 ○ | 13 ○ ←오늘 | 14 ○ | 15 |
| 16 | 17 | 18 | 19 | 20 | 21 | 22 ☆ |
| 23 | 24 | 25 | 26 | 27 | 28 | 29 |
| 30 | 31 | | | | | |

`●n` = 실제 참여(코트 입장, n = 게임 수) · `○` = 참석 신청 후 취소 · `☆` = 참석 확정된 미래 일정

## 요약 (7/13 ~ 8/13, 최근 한 달)

**참여 10일 / 총 62게임**

| 날짜 | 장소 | 게임 |
|---|---|---|
| 7/13 (월) | 성남실내체육관 | 1 |
| 7/16 (목) | 성남실내체육관 | 6 |
| 7/19 (일) | 에이트민턴 | 7 |
| 7/23 (목) | 성남실내체육관 | 7 |
| 7/27 (월) | 성남실내체육관 | 7 |
| 7/29 (수) | 성남실내체육관 | 7 |
| 7/30 (목) | 성남실내체육관 | 6 |
| 7/31 (금) | 성남실내체육관 | 6 |
| 8/3 (월) | 산성실내배드민턴장 | 7 |
| 8/7 (금) | 성남실내체육관 | 8 |

**패턴**: 7월 하순(7/27~7/31)에 주 4회로 집중, 8월 들어 8/3·8/7 두 번 뒤로는 8/12·8/13 연속 취소로 공백입니다. 혼복(`mixed_count`)은 전 기간 0.

참고로 몇 가지:
- 7/13 1게임은 18:13 입장 기록으로, 늦게 합류해 한 게임만 뛴 것으로 보입니다.
- 7/18(토) 힐링민턴파크는 본인 취소 이후 **일정 자체가 취소**된 건이라 다른 취소와 성격이 다릅니다.
- 8/22(토) 에이트민턴은 참석 확정 상태의 미래 일정입니다.
- 판정 기준은 `session_players` 행 존재(=보드 입장)이며, 단순 `attendances.status='confirmed'`가 아닙니다. 확정만 하고 안 온 날은 참여로 세지 않았습니다.

---

## #73

**Prompt**: 달력모양의 그리드로 해줘

**Answer**: **0.18에서도 세 곳 모두 그대로입니다.** 업데이트로 고쳐지지 않았고, 라인 번호만 밀렸습니다.

| 파일 | 0.9 | 0.18 | 상태 |
|---|---|---|---|
| `credential_manager.py` 로컬→서버 업로드 | 472 | **506** | `sender_email` 없음 |
| `credential_manager.py` `cm use N` | 941 | **975** | `sender_email` 없음 |
| `api_client.py` `_handle_error` | 192 | **192** | detail이 403 전용 |

한 가지 더 눈에 걸립니다 — 설치 로그의 이 경고가 이번 사건과 같은 뿌리입니다:

> ⚠️ macOS Keychain에 Claude Code 자격증명 발견. claude-manager는 `~/.claude/.credentials.json`만 읽으므로 stale 위험.

Claude Code 본체는 Keychain을 쓰고 `cm`은 파일만 봅니다. 그래서 활성 토큰이 실제로 쓰이는 계정과 어긋나기 쉽고, 지금 확인된 상태(`~/.claude/.credentials.json` = teddy 토큰인데 #2로 sync 시도)가 정확히 그 증상입니다. 서버의 400은 그 어긋남을 잡아낸 결과입니다.

패치는 앞서 제시한 3줄 그대로이고, 대상 라인만 506 / 975 / 192로 바뀝니다. 적용할까요?

- `credential_manager.py:506` → `sender_email=local_email or None` (바로 위 496행에 `local_email` 있음)
- `credential_manager.py:975` → `sender_email=get_profile_email(target_data) or None` (`target_data`는 981행에서 이미 사용 중)
- `api_client.py:192` → `detail` 출력을 403 전용에서 `HTTPStatusError` 전반으로 확대

앞으로 `cm update`를 하면 세 파일이 다시 덮어써지므로, 이건 로컬 임시 패치가 됩니다. claude-manager 원본 저장소가 손에 있으면 거기에 반영하는 쪽이 맞습니다 — 위치를 알려주시면 그쪽으로 고치겠습니다.

---

## #74

**Prompt**: [api_client] POST http://10.10.2.171:9876/profiles/2/sync 실패: Client error '400 Bad Request' for url 'http://10.10.2.171:9876/profiles/2/sync'
내부서버인데 뭐가문제일까

**Answer**: ## 결론: 네트워크 문제가 아닙니다

`400 Bad Request`는 **서버가 정상적으로 응답한 것**입니다. 지난번 `Errno 65 No route to host`(로컬 네트워크 권한)와는 완전히 다른 사건이에요. 서버는 지금 멀쩡합니다 — `GET /profiles` 200으로 확인했습니다.

### 서버가 거부한 진짜 이유

`/profiles/{id}/sync`는 **이메일 소유권 검증**을 합니다. 무변경 요청(프로필 2의 서버 저장값을 그대로 되돌려 보냄)으로 실제 detail을 뽑아냈습니다:

| `sender_email` | 결과 |
|---|---|
| `teddy@dooub.com` | **400** — `토큰 소유권 불일치: sender_email('teddy@dooub.com')이 프로필 #2 이메일('sam@dooub.com')과 다릅니다` |
| `sam@dooub.com` | **200** (정상) |
| 없음 | **400** — `sender_email 이 필요합니다: 프로필 #2 는 소유자 이메일이 지정되어 있어...` |

그리고 현재 머신 상태가 딱 이 상황입니다. `~/.claude/.credentials.json`의 활성 accessToken이 **profile_1(teddy@dooub.com)과 완전 일치**합니다. 즉 teddy 토큰이 활성인 채로 #2(sam)에 업로드를 시도한 것이고, 서버는 교차 오염으로 판단해 막은 겁니다. **서버 동작은 옳습니다.**

### 왜 이유가 안 보였나 (이게 진짜 고칠 곳)

`~/.claude/api_client.py:172` `_handle_error()`가 서버 `detail`을 **403에서만** 출력합니다. 400은 `exc` 문자열만 찍혀서 "왜 거부됐는지"가 통째로 삭제됩니다.

### 항상 400 나는 호출부 2곳

`credential_manager.py`의 두 호출은 `sender_email`을 **아예 안 보냅니다** → 소유자 이메일이 지정된 프로필이면 100% 400입니다:

[코드 블록 생략]

(`credential_common.py`의 3곳은 보내지만, per-instance `CLAUDE_CONFIG_DIR`의 `.claude.json`에 `oauthAccount`가 비면 빈 문자열 → `None`이 되어 같은 400에 걸립니다.)

### 패치 (3줄)

[코드 블록 생략]

적용할까요? `~/.claude` 아래 인증 도구라 모든 세션에 영향이 가서 확인받고 진행하겠습니다.

참고로 진단 중 프로필 2에 **서버 저장값과 동일한 값**을 한 번 POST했습니다(sender=sam, 200). 토큰이 그대로라 실질 변경은 없고 갱신 타임스탬프만 움직였을 수 있습니다.

---

## #75

**Prompt**: 너가 정리한 내용을 개발자에게 전달하기 위해 복붙가능한 내용으로 써주고, patch 파일도 만들어줘

**Answer**: 두 파일 만들었습니다.

| 파일 | 경로 |
|---|---|
| 버그 리포트 | `…/scratchpad/BUGREPORT-sync-sender-email.md` |
| 패치 | `…/scratchpad/claude-manager-sync-sender-email.patch` |

전체 경로는 `/private/tmp/claude-501/-Users-sam-Projects-cocktime-scheduler/ea30cdf6-6a55-48d7-942f-3d2b3d231759/scratchpad/` 입니다. 세션 임시 디렉토리라 오래 두려면 `~/Desktop` 같은 곳으로 옮겨야 합니다 — 원하시면 옮겨드리겠습니다.

패치는 0.18 원본 트리에서 `git apply -p1 --check` 통과, `py_compile` 통과까지 확인했습니다. 적용은 `git apply -p1 claude-manager-sync-sender-email.patch` (저장소 루트에서).

검증 과정에서 확인한 사실 하나를 리포트에 반영했습니다 — `credential_manager.py:975`는 `except Exception: pass`로 감싸여 있어서 sync 실패가 조용히 삼켜지고, `cm use N`은 그대로 `✅ 프로필 #N 활성화`를 출력합니다. **서버 토큰이 갱신되지 않았는데 성공처럼 보입니다.** 이게 실질 피해가 가장 큰 지점입니다.

---

아래가 복붙용 리포트 전문입니다.

[코드 블록 생략]
[api_client] POST http://10.10.2.171:9876/profiles/2/sync 실패: Client error '400 Bad Request' for url '...'
[코드 블록 생략]
credential_common.py:574   sync_profile(profile_id,   credentials, sender_email=sender_email or None)   ✅
credential_common.py:898   sync_profile(profile_idx,  active_cred, sender_email=sender_email or None)   ✅
credential_common.py:970   sync_profile(current_idx,  active_cred, sender_email=active_email or None)   ✅
credential_manager.py:506  sync_profile(srv_idx,      ldata.get("credentials", {}))                     ❌ 인자 없음
credential_manager.py:975  sync_profile(target_idx,   cred)                                             ❌ 인자 없음
[코드 블록 생략]

`credentials` 가 서버 저장값과 동일하므로 200이 나더라도 데이터가 변하지 않는다.

## 5. 영향

- **`cm use N` 이후 서버 토큰이 갱신되지 않는다** (조용히 실패). 다른 머신/인스턴스가 서버에서 토큰을 받아 갈 때 만료된 값을 받는다.
- 로컬이 최신일 때의 서버 승격(`:506`)도 동작하지 않는다.
- 모든 sync 실패가 이유 없는 400 한 줄로 보여 네트워크 장애로 오진된다.

## 6. 패치

첨부: `claude-manager-sync-sender-email.patch` (0.18 기준, `git apply -p1 --check` 통과, `py_compile` 통과)

[코드 블록 생략]

## 7. 덤으로 — 설치 로그의 Keychain 경고가 같은 뿌리

[코드 블록 생략]

Claude Code 본체는 Keychain을, `cm` 은 파일만 본다. 그래서 활성 토큰이 실제 사용 계정과 어긋나기 쉽다. 이 머신에서 확인된 상태:

| | accessToken 소유 |
|---|---|
| `~/.claude/.credentials.json` (활성) | `profile_1` = **teddy@dooub.com** 과 완전 일치 |
| sync 시도 대상 | 프로필 **#2 = sam@dooub.com** |

서버가 말한 "다른 인스턴스의 토큰이 교차 오염" 이 실제로 성립하는 상태였다. 버그 A를 고쳐 `sender_email` 을 붙이면 이런 경우는 **의도대로 400으로 차단**되고, 정상 케이스만 통과한다 — 즉 패치는 검증을 우회하지 않고 오히려 제대로 작동시킨다. Keychain/파일 이원화 자체는 별도 이슈로 다룰 값어치가 있다.
````

리포트에 사내 서버 주소와 팀원 이메일이 들어 있습니다(토큰은 없음). 사내 개발자용이면 그대로, 외부로 나갈 거면 마스킹해드리겠습니다.

---

## #76

**Prompt**: 야 이것도 읽기쉽게 md 로 만들어줘

**Answer**: _(응답 대기 중…)_

---

## #77

**Prompt**: https://git.co.dooub.com/util/claude-manager
니가 말한 내용 여기에 mr 형태로 올릴수있나?

**Answer**: MR 올렸습니다. **병합 충돌 없음(`can_be_merged`)**, assignee `sam`.

🔗 https://git.co.dooub.com/util/claude-manager/-/merge_requests/10

### 커밋 3개 (저장소 관행대로 분리)

| | 커밋 |
|---|---|
| `93207b8` | `fix(sync): credential_manager 의 sender_email 누락 — /sync 가 항상 400 (B2 클라 미반영)` |
| `0b0beb4` | `fix(api_client): 4xx/5xx 서버 detail 노출 — 400 원인 은폐 해소` |
| `7ce63eb` | `chore(release): VERSION 0.18 → 0.19 — sync sender_email 누락 fix 전파` |

### 조사 중 새로 밝혀진 것

**회귀 원인을 특정했습니다.** 서버 커밋 `a64264c`(2026-07-27, Teddy Park)가 `sender_email`을 필수로 만들면서 `server/routers/profiles.py`와 `tests/test_server.py` **둘만** 고쳤습니다. 클라이언트 호출부는 그대로 남았습니다.

**`cm use N`이 조용히 거짓 성공합니다.** `:975`가 `except Exception: pass`로 감싸여 400이 삼켜지고 그대로 `✅ 프로필 #N 활성화`를 출력합니다. 서버 토큰은 갱신되지 않았는데 성공처럼 보입니다 — 이게 실질 피해가 가장 큰 지점이라 MR 본문에 별도 섹션으로 넣었습니다.

**서버 docstring으로 `sender_email`의 의미를 확정했습니다.** "업로드하는 토큰의 소유자 이메일"이지 클라이언트 로그인 계정이 아닙니다(`/sync`는 B1 소유권을 의도적으로 강제하지 않음). 두 패치 모두 이 해석과 일치합니다. 해석 확인은 `@teddy`에게 리뷰 포인트로 남겼습니다.

### 검증

[코드 블록 생략]

실패 13개는 **main과 동일한 목록**(사전 존재). 처음 14개였는데 늘어난 하나는 `test_cmd_ls_syncs_newer_local_token`의 낡은 단정문이었고, 실제 호출값이 프로필 이메일과 정확히 일치해 동작은 옳았으므로 단정문을 갱신했습니다.

새 가드 테스트는 AST로 모든 `sync_profile()` 호출부를 훑습니다. 수정 전 코드로 되돌려 돌리면 `credential_manager.py:[975, 506]`을 정확히 짚어내며 실패하는 것까지 확인했습니다.

### 스킬 규칙에서 벗어난 부분 (승인받은 대로)

- 설명은 `.agent-history` 대신 버그리포트 기반 — 그 관행이 없는 저장소입니다
- `--label` 생략 — 프로젝트 라벨 0개, `eddie`·`owen`은 멤버 아님

### 범위 외로 남긴 것 (MR 본문에 기록)

`tests/test_credential_sync.py` 4개가 실제 `~/.claude/.credentials.json`을 읽어 호스트 상태에 오염됩니다(실패 메시지에 개발 머신 실제 토큰 `expiresAt`이 노출). main에서도 실패하므로 별도 이슈로 두는 게 맞다고 판단해 고치지 않았습니다.

---

## #78

**Prompt**: [api_client] POST http://10.10.2.171:9876/profiles/2/sync 실패: Client error '400 Bad Request' for url 'http://10.10.2.171:9876/profiles/2/sync'
For more information check: https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/400
또 발생하는데 원인을 찾을수있을까? 코드주면 찾기쉬워?

**Answer**: _(응답 대기 중…)_

---

## #79

**Prompt**: [api_client] POST http://10.10.2.171:9876/profiles/2/sync 실패: Client error '400 Bad Request' for url 'http://10.10.2.171:9876/profiles/2/sync'
For more information check: https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/400
또 발생하는데 원인을 찾을수있을까? 코드주면 찾기쉬워? 아 아니구나 패치를 적용안했구나 패치해줘

**Answer**: 패치 적용하고 실서버로 검증까지 끝냈습니다.

## 재발 원인 확정 — `cm use 2`

추측이 아니라 파일 증거로 특정했습니다.

| 증거 | 값 |
|---|---|
| `credentials/.state` | `2` — **21:59** 기록 |
| `credentials/.pinned.cbae5cbd` | `2` — **21:59** 기록 |
| 활성 `.credentials.json` | 이제 `profile_2`(sam) 토큰과 일치 |

`.state`와 `.pinned`를 **같은 시각에 같은 값으로** 쓰는 코드는 `cmd_use` 하나뿐입니다. 즉 21:59에 `cm use 2`를 실행하셨고, 그게 `credential_manager.py:975` — `sender_email` 없이 sync를 던지는 바로 그 지점입니다. 제가 진단한 것과 같은 버그입니다. (조사 과정에서 다른 sync 진입점 5곳도 전수 확인했는데, 나머지는 모두 `sender_email`을 제대로 넘깁니다.)

## 적용 결과

[코드 블록 생략]

- 원본은 `~/.claude/.pre-sync-patch-backup/`에 백업
- `credential_manager.py`의 실행 비트 보존 확인
- **`VERSION`은 0.18로 남겨뒀습니다** — 정식 0.19가 나오면 `cm update`가 이 임시 패치를 정상적으로 덮어씁니다

## 실서버 검증 (무변경 페이로드)

| 보낸 값 | 결과 |
|---|---|
| 소유자 이메일 동반 (= 패치된 `cm use` 동작) | **200 OK** |
| 불일치 이메일 | 400 + detail 노출 |
| 없음 (= 패치 전 동작) | 400 + detail 노출 |

그리고 이제 로그가 이렇게 나옵니다 — 원인이 한 줄에 다 찍힙니다.

[코드 블록 생략]

실행 중인 프로세스는 이전 코드를 유지하니, 다음 `cm`/`cl` 호출부터 적용됩니다. 이 세션의 훅도 다음 턴부터 새 코드를 씁니다.

MR #10은 그대로 열려 있습니다 — 머지 후 0.19가 배포되면 다른 머신들에도 반영됩니다.

---

## #80

**Prompt**: 에러메세진 없어졌는데 로그인하라는 에러는 계쏙뜨네

**Answer**: _(응답 대기 중…)_

---

## #81

**Prompt**: go on

**Answer**: `cm`이 다시 살아났습니다(`0.18`). 로그인 에러는 sync 400과 **완전히 다른 문제**였고, 원인 사슬을 끝까지 추적했습니다.

## 근본 원인 — `cm update`가 alias를 임시 디렉토리로 오염시켰다

[코드 블록 생략]

이 디렉토리는 **이미 삭제됐습니다**(macOS가 `$TMPDIR`을 정리). `~/.zshrc` mtime이 `16:37:20` — 이 대화에서 `cm update`를 돌린 그 시각입니다. `installer.py:634-636`이 `claude_dir`로 alias를 만들고 매번 덮어쓰는데, 그 실행에서 `claude_dir`이 임시 추출 경로였습니다.

그래서 연쇄가 일어났습니다.

| 단계 | 확인된 사실 |
|---|---|
| ① `cl`이 죽었다 | alias 대상 디렉토리 부재 |
| ② 맨 `claude`로 실행 | 살아있는 4개 인스턴스 전부 부모가 `-/bin/zsh -l`, `CLAUDE_CONFIG_DIR` **없음** |
| ③ 격리 소실 | `cl`은 `run_claude.py:2061`에서 인스턴스별 `CLAUDE_CONFIG_DIR`을 세팅하는데, 이 경로를 안 탔다 |
| ④ 신원 충돌 | 4개가 `~/.claude.json` 하나 + Keychain 항목 하나(`Claude Code-credentials`/`sam`)를 공유 |
| ⑤ 어긋남 | 활성 토큰 = **victor(#3)**, `oauthAccount` = **teddy** |

마지막 증거가 결정적입니다.

[코드 블록 생략]

cm이 마지막 기록자가 아닙니다. 격리 안 된 다른 인스턴스가 자기 신원을 되써서 cm의 갱신을 무효화했고, 결과는 **teddy 신원 + victor 토큰** — Claude Code가 로그인을 요구하는 상태입니다.

## 배제한 가설 (전부 반증)

- **서버 `needs_relogin`**: 4개 프로필 모두 `False`
- **refresh token 만료**: 만료일 08-24 ~ 09-07, 전부 유효
- **usage `auth_expired`**: 4개 모두 `error=None` (5h 0~69%, 7d 50~96%)
- **Keychain vs 파일 불일치**: 지금은 둘 다 `h5wMxwAA`로 **일치** — 어긋난 건 토큰이 아니라 `oauthAccount`
- **`.selector-stderr.log`의 재로그인 로그**: 8/10 네트워크 사건의 오래된 기록

## 지금 해둔 것

`~/.zshrc` alias 3개를 `/Users/sam/.claude`로 교정했습니다(백업: `~/.zshrc.bak-alias-*`). `cm --version` → `0.18` 정상.

## 남은 조치 — 두 개, 직접 하셔야 합니다

**1) 새 셸에서 `source ~/.zshrc`** 후, 앞으로 세션은 맨 `claude` 대신 **`cl`로** 띄우세요. 그래야 인스턴스마다 `CLAUDE_CONFIG_DIR`이 생겨 신원 충돌이 구조적으로 사라집니다.

**2) 지금 살아있는 4개 인스턴스는 여전히 격리가 없습니다.** 신원 하나만 이길 수 있으니 재시작 전까지는 어긋남이 남습니다. 즉시 정합을 맞추려면 활성 토큰을 현재 신원(teddy)에 맞추는 `cm use 1`이 맞습니다 — 다만 이 세션도 영향을 받으니 실행 여부는 판단해 주세요. 원하시면 제가 돌립니다.

## 별도로 보고할 설치 버그

`install.sh:27`이 **첫 positional 인자를 무조건 `CLAUDE_DIR`로** 받고, `credential_manager.py:1850`이 `str(target_dir)`를 positional로 넘깁니다. `target_dir`이 한 번이라도 임시 경로가 되면 alias가 삭제 예정 디렉토리로 박히고, 이후 `cm update`는 alias를 매번 덮어쓰므로 **스스로 회복하지 못합니다**. 16:37 실행에서 `claude_dir`이 왜 임시 경로였는지는 로그가 없어(`.cm-update.log`는 Windows 경로 전용) 확정하지 못했습니다 — 그 부분만 미해결로 남깁니다.

MR #10에 넣을까요, 아니면 별도 MR로 올릴까요? 성격이 다른 버그라 저는 별도 MR을 권합니다.

---

## #82

**Prompt**: 별도 mr 로 올려줘

**Answer**: 별도 MR 올렸습니다. 둘 다 `can_be_merged`이고, 서로 자동 병합됩니다.

🔗 **!11** https://git.co.dooub.com/util/claude-manager/-/merge_requests/11
🔗 !10 (sync 400) — 그대로 열려 있음

## 커밋 2개

| | |
|---|---|
| `a68bef1` | `fix(installer): alias 대상 검증 — 죽은 경로/추출 디렉토리 포이즈닝 차단` |
| `ebf1b8c` | `fix(install.sh): 명시적 --claude-dir — positional 설치대상 오인 차단` |

## 고친 것

**`alias_target_problem()` — 쓰기 시점 게이트.** 진입점 파일이 없는 디렉토리, 그리고 `claude_dir == project_root`(배포 아카이브 추출 위치)를 거부합니다. 부적합하면 **rc 파일을 전혀 건드리지 않습니다** — 기존 등록 로직은 alias 라인을 먼저 지우고 새로 쓰기 때문에, 게이트가 없으면 잘못된 실행 한 번이 포이즈닝과 기존값 파괴를 동시에 일으킵니다. 설치는 계속 진행하고 alias만 스킵합니다.

**`install.sh --claude-dir`.** positional은 하위호환으로 남기고, 값 누락 시 조용히 기본값으로 떨어지지 않고 실패합니다. 업데이터도 명시적 플래그로 바꿨습니다.

## 검증

[코드 블록 생략]

실패 13개는 main과 동일한 목록. 수정 전 코드로 되돌려 신규 테스트를 돌리면 **8개가 실패**하는 것까지 확인했습니다.

## MR 본문에 명시한 두 가지

**확정하지 못한 부분을 그대로 적었습니다.** `~/.zshrc` mtime(16:37:20)이 `cm update` 시각과 일치하고 `register_alias_or_path`가 매번 덮어쓰므로 그 실행의 `claude_dir`이 임시 경로였던 건 확정입니다. 그런데 같은 실행의 파일 복사 로그는 `→ /Users/sam/.claude`였습니다. **둘을 동시에 성립시키는 호출 경로는 재현하지 못했습니다**(`.cm-update.log`는 Windows 전용이라 기록 없음). 그래서 특정 호출을 고치는 대신 잘못된 경로가 alias로 박히는 것 자체를 막는 방향으로 갔습니다.

**`VERSION`은 건드리지 않았습니다.** !10이 0.18 → 0.19 범프를 갖고 있어 양쪽이 같은 줄을 고치면 확정적으로 충돌합니다. 나중에 병합되는 쪽에서 올리는 게 깔끔합니다.

## 남은 것 — 이미 alias가 박힌 사용자

이 MR은 **자동 복구를 하지 않습니다.** 정상 `cm update`를 한 번 거쳐야 alias가 교정됩니다. 사장님 머신은 제가 이미 직접 고쳐뒀지만(`~/.zshrc.bak-alias-*` 백업), 팀의 다른 머신도 같은 상태일 수 있습니다 — 확인 한 줄입니다.

[코드 블록 생략]

`/private/var/folders/...`나 `/tmp/...`가 보이면 같은 증상입니다. 후속 후보로 "`cm`이 자기 실행 경로가 임시 디렉토리인지 감지해 경고하는 자기진단"을 MR 본문에 적어뒀습니다.

그리고 로그인 에러 자체는, alias 복구만으로는 이번에 뜬 4개 인스턴스가 낫지 않습니다 — 새 셸에서 `source ~/.zshrc` 후 **`cl`로 다시 띄우셔야** 격리가 생깁니다.

---

## #83

**Prompt**: cm use 로 했을때 수동으로 로그인해서 위의 문제가 회피될 수 있을까

**Answer**: _(응답 대기 중…)_

---

## #84

**Prompt**: hi

**Answer**: _(응답 대기 중…)_

---

## #85

**Prompt**: 보드를 제외한 화면에서 이름표기할때 년생도 같이 나와야할듯 동명이인이많아

**Answer**: 보드를 제외한 화면 전반에 이름 옆 년생 두 자리(회색) 표기를 넣었습니다.

## 공용 규약
- `src/lib/birthYear.ts` — `birthYearShort()`(1985→"85", 범위 밖·미입력은 null), `nameWithBirthYear()`(문자열 자리용)
- `src/components/shared/BirthYearTag.tsx` — 이름 뒤 회색 태그. 년생 없으면 아무것도 렌더하지 않음

## 데이터 레이어
년생은 `members`에만 있어서 각 조회 경로에 실어 날랐습니다. 세 쿼리 모두 실제 DB로 문법·응답을 검증했습니다.
- `Player.birthYear` 추가 → `fetchMembers` (세션 셋업·실력비교)
- `attendances`의 `member`/`inviter` 임베드에 `birth_year` (일정 참석자·카풀)
- `session_players`는 스냅샷이라 년생이 없어 `member:member_id(birth_year)` 조인으로 보강 (매치 로그·참가자 요약)

## 적용 화면
일정 참가자 목록, 카풀(운전자·동승자 칩·지도 마커), 세션 셋업(선수 선택·혼복싱글·편집 모달·설정충돌), 매치 로그(팀 배지·참가자 요약), 회비(정산 대조·이월/미납·명예회원·입금 매칭), 실력 비교. 운영진 확인 다이얼로그(운영진 승급/비활성화/명예회원 해제/부과삭제) 문구에도 넣어 동명이인 오조작을 막았습니다.

곁들여 고친 것: 매치 로그 참가자 요약이 `key={p.name}`이라 동명이인일 때 React key가 충돌했습니다 — `session_players.id`로 바꿨습니다.

## 확인된 사실
- 활성 회원 98명 **전원 년생 입력 완료** — 표기가 비는 회원 없음
- 실제 동명이인: 김지훈(96·02), 이지은(99·95) 두 쌍
- 게스트는 년생이 없어 이름만 나옵니다(의도된 동작)

빼놓은 것 두 가지입니다. 카풀/정모 공지 텍스트는 요청대로 이름만 유지했고, 회원관리 목록은 이미 이름 아래 줄에 "1985년생"이 있어 중복이라 그대로 뒀습니다.

검증: 타입체크·테스트 325건·빌드 통과, lint 오류 7건은 변경 전과 동일한 기존 이슈입니다. 변경 파일은 staging 했고 커밋은 하지 않았습니다.

---

## #86

**Prompt**: 회원관리 목록도 이름 옆에 년생 넣어줘

**Answer**: 마이그레이션이 프로덕션에 적용됐습니다.

이제 다음 `sync_schedule_occurrences()` 호출(운영진이 앱을 열거나 일정 추가 시점)부터 적용됩니다.

- 앞으로 달력에서 추가하는 일회성 일정 → 등록 즉시 open + 홈 노출
- 지금 `draft`로 대기 중이던 미래 일회성 회차가 있다면 첫 sync에서 한꺼번에 열리며 푸시가 나갑니다 — 앱 열기 전에 마음의 준비를 하시거나, 달력에서 '예정' 상태 일회성 회차가 있는지 먼저 확인해보셔도 됩니다.

프론트 변경은 주석·문서뿐이라 `git push`는 급하지 않지만, 스테이징은 되어 있으니 `/commit`으로 정리하시면 됩니다.

---

## #87

**Prompt**: 푸쉬

**Answer**: 푸시 완료, GitHub Pages 배포도 성공했습니다 (`ed68007`, 1분 1초).

**푸시 전에 하나 처리한 것이 있습니다.** 히스토리 파일에 `#86 "회원관리 목록도 이름 옆에 년생 넣어줘"`가 응답 대기 상태로 남아 있었습니다. 제 대화 컨텍스트에는 도달하지 않았던 요청인데, 순서상 이 작업 뒤 "푸쉬"를 하신 것으로 보여 함께 반영하고 배포했습니다:

- 회원관리 행의 이름 옆에 년생 두 자리 추가
- 아래 서브라인의 `1985년생`은 중복이라 제거 → 서브라인은 `남 · 강남구` 형태

전체 년도(`1985`)가 두 자리(`85`)로 바뀐 셈이라, 회원관리 화면만은 전체 년도를 유지하는 편이 낫다면 말씀해 주세요.

DB 마이그레이션이나 Edge Function 변경은 없어서 `git push`만으로 배포가 끝났습니다. `TODO.md`(회비 미납 alert 아이디어 메모)는 이번 작업과 무관해 커밋에서 제외했습니다.

---

## #88

**Prompt**: 수동으로 추가한 일정은 일요일 6시에 노출되는 구조가 아닌 등록하자마자 항시노출로 해

**Answer**: 수동 추가한 일회성 일정은 공개 창(일요일 18:00)을 건너뛰고 등록 즉시 노출되도록 바꿨습니다.

## 변경 핵심

노출(`draft`→`open`)은 `sync_schedule_occurrences()` E단계가 단일 관리하므로, 거기 조건만 출처별로 갈랐습니다.

`supabase/migrations/20260815000000_oneoff_reveal_immediately.sql`
[코드 블록 생략]

- 클라 쪽은 손댈 게 없습니다. `addOneOff`가 insert 직후 `syncOccurrences()`를 이미 호출하므로 **등록 버튼을 누른 순간 open + 홈 노출**됩니다.
- 참여 가능 판정은 이미 `status='open'` 단일 기준(마이그레이션 `20260703040000`)이라, 몇 달 뒤 일정이어도 참석·게스트 신청이 바로 열립니다. (예전 `+7d` 시간 가드가 남아 있었다면 "보이는데 신청만 막히는" 회귀가 났을 지점입니다.)
- 과거 회차(A단계 `closed`)와 즉석 세션(`scheduled_at is null`)은 종전대로 대상 아님.

주석·문서도 함께 갱신: `recurring.ts`·`adminScheduleStore.ts`·`schedule.ts`·`scheduleStore.ts`·`dues.ts` 주석, `docs/EXPANSION_SPEC.md` E단계 항목.

## 배포 전 알아두실 점 두 가지

1. **푸시가 나갑니다.** 즉시 open 되면 기존 알림 경로를 그대로 타서 전 회원에게 `session_open`(1건) 푸시가 갑니다. "등록하자마자 노출"의 의도에 맞다고 보고 유지했는데, 조용히 추가하고 싶으시면 일회성은 알림 제외로 바꿀 수 있습니다.
2. **적체분 일괄 공개.** 지금 DB에 공개 창 밖이라 `draft`로 대기 중인 일회성 회차가 있다면, 배포 후 첫 sync에서 한꺼번에 열리며 `sessions_opened`(N건) 푸시 1건이 나갑니다. 미리 달력에서 확인해보시는 걸 권합니다.

배포는 프론트(`git push`)와 별개로 `supabase db push`를 직접 실행해야 반영됩니다. 로컬에 psql/도커가 없어 SQL 실행 검증은 못 했고, 기존 배포본 함수 본문에 조건 한 줄만 추가한 형태입니다. lint는 통과(기존 오류 8건은 이번 변경과 무관한 파일).

---

## #89

**Prompt**: 끝나면 프론트배포

**Answer**: 프론트 배포 완료했습니다.

- 커밋 `60c87f3` → `main` 푸시 → GitHub Actions Deploy 성공 (https://ckti.me)
- DB 마이그레이션은 앞서 `supabase db push`로 이미 적용 완료 — 프론트/DB 양쪽 다 반영된 상태입니다.

로컬 빌드도 미리 돌려 통과 확인했고, 이번 프론트 변경은 주석·문서뿐이라 동작 변화는 전부 DB 함수 쪽입니다.

한 가지: `TODO.md`(회비 미납 alert 아이디어 메모)는 커밋에서 제외했습니다. 개인 메모로 보여 저장소에 올리지 않았는데, 함께 관리하실 거면 말씀해 주세요.

---

## #90

**Prompt**: supabase 에 warning 이 너무 많은데

**Answer**: _(응답 대기 중…)_

---

## #91

**Prompt**: TODO 읽고 처리하고 완료된건 지워

**Answer**: TODO 3건 모두 처리했습니다. 추측 대신 프로덕션 `edge_logs`를 직접 조회해 원인부터 확정했습니다.

## 2번 — 호출 폭주 (402의 실제 원인)

402는 결과였고, 24시간 실측으로 원인 3개가 나왔습니다.

| 원인 | 실측 | 처방 |
|---|---|---|
| **Storage 사진 404 루프** (전체 4xx의 100%) | 5,359건/24h | `members.photo_updated_at` 추가(null=사진없음) + 클라 사진 인덱스 |
| **authStore 중복 `loadMember`** | POST members 1,487 / GET 2,409 / `is_admin` 1,798회 (회원은 149명) | `getSession()` 제거 + user.id 1회 가드 |
| **`sync_schedule_occurrences` 남발** | 1,560회/24h | 읽기 경로 10분 스로틀, 운영진 경로는 `force:true` |

사진 건이 가장 컸습니다. 사진 없는 활성 회원 73명에게도 `<img>`를 걸어 매번 `NoSuchKey`가 떨어졌고, **오류 응답은 브라우저가 캐시하지 않아** 렌더마다 재요청됐습니다. 같은 컬럼이 `?v=` 캐시 버전도 겸하므로, 올린 본인만 새 사진을 보던 문제도 함께 해결됩니다.

`getSession()` 제거는 supabase-js 문서로 확인했습니다 — `onAuthStateChange`가 구독 즉시 `INITIAL_SESSION`을 쏘므로 중복이었고, 로그에 1ms 간격 POST 쌍으로 남아 있었습니다.

## 3번 — 회원 비활성화 시 회계 풀림

`SessionsHome.tsx`의 회비 진행 계산이 **활성·비운영진·비게스트·비명예 회원 명단을 훑어** 부과를 찾는 구조였습니다. 비활성화하는 순간 그 사람의 그 달 회비가 납부분까지 집계에서 사라져 "다 걷힌" 것처럼 보였습니다(부과 행은 DB에 그대로).

명단이 아니라 **부과 행을 훑도록** 바꿨습니다. 부과 자격 판정은 이미 서버 `dues_generate_monthly`가 하므로 화면에서 다시 거를 이유가 없고, 중도 탈퇴자도 그 달 회비는 내야 합니다. `docs/ACCOUNTING_SPEC.md` §3.1도 갱신했습니다.

## 1번 — Supabase 워닝

마이그레이션 4건 적용 완료(`db push`) + 유출 비밀번호 보호 활성화.

- **SECURITY 154 → 50**: anon EXECUTE 70건 → 0, `function_search_path_mutable` 7건 → 0, 유출 비밀번호 1건 → 0
- **PERFORMANCE 37 → 25**: `multiple_permissive_policies` 10건 → 0, `auth_rls_initplan` 2건 → 0

위험 구간은 프로덕션에 반영 전 `begin; ... rollback;`으로 실증했습니다.
- 트리거 함수 EXECUTE 회수 → 트리거는 그래도 발화함을 확인
- **RLS 정책 안의 함수는 호출자 권한으로 평가돼, 회수하면 정책이 깨짐**을 확인 → `is_admin()`·`current_member_id()`는 `authenticated` 유지
- `search_path=''` 함수 7개를 합성 세션에 실제로 전부 호출 (과거 사고 지점이라 반드시 확인)
- RLS 재작성 후 일반 회원/운영진 롤로 전환해 권한 집합 불변 확인 (본인만 수정 1, 남 수정 0, 운영진 전부 가능)

적용 후 라이브 확인도 통과했습니다: 클라 RPC는 실행되고 `board_assert_editor`·`is_operator`는 `permission denied`.

남은 50건은 의도적입니다 — 49건은 클라이언트가 실제로 부르는 RPC라 `authenticated` EXECUTE가 필요하고, pg_net은 웹푸시 의존성 때문에 보류(선택하신 대로)입니다. INFO 25건도 최대 테이블이 1,981행인 규모라 FK 인덱스 21개는 쓰기 비용만 늘어 남겼고, 근거를 TODO.md에 적었습니다.

## 확인·상태

- `tsc -b` 통과, 테스트 325건 통과. 린트 8건은 전부 기존 문제(stash로 대조 확인)
- 프로젝트 규칙대로 **스테이징만** 했습니다 — 커밋은 안 했습니다
- **프론트는 아직 미배포**입니다. 2·3번 개선은 `git push`(GitHub Pages) 후에 실제로 효과가 납니다. TODO.md에 이 한 줄만 남겨뒀습니다

---

## #92

**Prompt**: pg_net 관련해선 다시 설명해줘.

**Answer**: pg_net 건은 제가 앞서 요약한 것보다 사정이 조금 다릅니다. 정확히 다시 정리하겠습니다.

## 워닝이 말하는 것 vs 실제 상태

`extension_in_public` = "pg_net 확장이 public 스키마에 설치돼 있다. 다른 스키마로 옮기세요."

그런데 실제로 조회해 보면:

| 항목 | 값 |
|---|---|
| 확장 **등록** 스키마 | `public` ← 워닝의 근거 |
| 확장이 소유한 **함수**가 있는 스키마 | `net` (12개) |
| 확장이 소유한 **테이블/시퀀스** | `net._http_response`, `net.http_request_queue`, `net.http_request_queue_id_seq` |
| **public에 실제로 들어앉은 pg_net 객체** | **0개** |

pg_net은 자기 객체를 전부 `net` 스키마에 만듭니다. `public`에 남아 있는 건 `pg_extension` 카탈로그의 등록 레코드 한 줄뿐입니다. 즉 **워닝이 경고하려는 실질적 위험(공용 스키마에 확장 함수가 노출돼 이름 충돌·권한 문제를 일으킴)은 이 프로젝트에 이미 없습니다.** 장부상 주소만 틀린 상태입니다.

## 그런데도 제가 손대지 말자고 한 이유

소비자가 정확히 하나입니다 — `public.notify_push_send`(웹푸시 발송 트리거). 이 함수는:

[코드 블록 생략]

`search_path=''`로 잠겨 있어서 **`net.` 접두사에 전적으로 의존**합니다. 스키마 이름이 어긋나는 순간 함수 해석이 실패하고, 그러면 푸시가 조용히 멈춥니다.

`alter extension pg_net set schema extensions`가 옮기려는 대상은 `net` 스키마의 객체들인데, pg_net은 자체 스키마를 갖는 확장이라 이 명령이 어떻게 동작할지(혹은 거부될지)가 버전 의존적입니다. 여기 깔린 건 0.19.5입니다.

## 다시 판단하면

앞선 답에서 제가 "이동 실패 시 푸시가 멈춘다"고만 쓴 건 근거를 덜 밝힌 요약이었습니다. 실제 상황은 이렇게 말하는 게 맞습니다:

- **위험 실체 없음** — public에 pg_net 객체가 0개라 워닝은 사실상 오탐에 가깝습니다
- **얻는 것** — 워닝 1건
- **잃을 수 있는 것** — 웹푸시

다만 `begin; alter extension ...; select net.http_post 존재 확인; rollback;`으로 **프로덕션에 흔적 없이 실제로 되는지 확인은 가능합니다**(이번에 트리거·RLS·search_path 검증에 쓴 방법과 같습니다). 결과가 깔끔하면 안전하게 처리하고, 조금이라도 이상하면 롤백하고 그대로 두는 식으로요.

지금 그 실증을 해볼까요, 아니면 워닝 1건으로 남겨둘까요? 저는 이득이 워닝 하나뿐이라 남겨두는 쪽이지만, 실증 자체는 무해하니 원하시면 바로 확인해 드리겠습니다.

---

## #93

**Prompt**: 일단 배포만

**Answer**: 배포 완료했습니다.

**커밋·푸시·배포**
- `c6c7979` → `origin/main` 푸시
- GitHub Actions Deploy 성공 (build 후 Pages 배포)
- `https://ckti.me` 새 번들(`index-6FiQFHLC.js`)에 세 수정 모두 포함 확인 — `cocktime:photoIndex`, `photo_updated_at`, `cocktime:lastOccurrenceSync`

이제 DB(마이그레이션 4건)와 프론트가 모두 반영된 상태라, 호출 폭주 3건과 회비 집계 누락이 실제로 적용됐습니다.

**pg_net은 손대지 않았습니다** — 요청대로 배포만 했습니다. 워닝 1건으로 남아 있고, 원하실 때 `begin;...rollback;` 실증부터 하면 됩니다.

**남은 확인 한 가지**: 호출 감소는 회원들이 앱을 실제로 열어야 로그에 나타납니다. 하루쯤 지난 뒤 `edge_logs`를 다시 조회하면 사진 404가 5,359건에서 얼마나 떨어졌는지, `POST /rest/v1/members`가 1,487회에서 줄었는지 수치로 확인할 수 있습니다. 필요하시면 그때 말씀해 주세요.

한 가지 짚어둘 점은, 사진 인덱스는 브라우저별 localStorage 캐시라 **각 회원의 첫 접속 1회는 여전히 404가 납니다**(73건 규모). 그 이후부터 0이 되는 구조입니다. 조사 중에 별건으로 발견한 것도 있는데, `공태호` 회원이 90초 간격으로 2행 생성돼 있었습니다(2026-08-16). 카카오/구글 등 다른 auth 계정으로 중복 가입한 것으로 보이며, 이번 작업 범위가 아니라 손대지 않았습니다.

---

## #94

**Prompt**: 공태호가 누구야 멤버중에 없는데

**Answer**: 제가 앞서 "중복 가입"이라고 한 건 틀렸습니다. 회원이 아니라 **게스트**입니다.

두 행 모두 `is_guest = true`, auth 계정 없음 — 회원이 데려오는 RSVP 게스트입니다. 회원관리 목록은 게스트를 제외하고 조회하니(`fetchMembersForAdmin(false)`) 안 보이는 게 정상입니다.

| | 1행 | 2행 |
|---|---|---|
| 생성 | 08-16 09:00:18 | 08-16 09:01:46 |
| 신청한 회원 | 함규리 | 고수지 |
| 참석 상태 | **cancelled** | **confirmed** |
| position | 1711 | 1740 |

둘 다 **같은 세션**(114번, 8/18 성남실내체육관, 아직 open)입니다. 88초 간격이고, 앞 건은 취소되고 뒤 건이 확정으로 남아 있습니다.

정황상 **함규리가 잘못 신청했다가 취소하고, 고수지가 다시 신청한 것**으로 읽힙니다(같은 사람을 누가 데려오는지 정리한 흐름). 취소된 행이 남는 건 정상 설계고, 부과(`charges` 0)나 보드 편입(`on_board` 0)도 없어서 **데이터상 문제는 없습니다.** 지금 유효한 확정 게스트는 고수지가 데려온 1명뿐입니다.

한 가지만 확인해 보시면 좋겠습니다 — 같은 사람인지, 아니면 동명이인 두 명을 각각 데려온 건지는 데이터로 판별이 안 됩니다(둘 다 남성, 출생년도 없음). 후자라면 8/18에 공태호가 2명 와야 하는데 현재 확정은 1명입니다. 함규리 쪽에 물어보시는 게 확실합니다.

앞선 답에서 "카카오/구글 중복 가입"이라고 한 부분은 근거 없이 추측한 것이었습니다. `auth_user_id`를 확인하지 않고 `members` 테이블에 같은 이름 2행이 있는 것만 보고 넘겨짚었습니다.

---

## #95

**Prompt**: 아 일단 이건 패스, 중요한건 지금 부과된 세션 수정해야해. 8월 17일 경기 실제 대관비는 13000*3*3 원인데, 늦게 입력해서 부과가 이상하게 나왔어 이거수정좀.

**Answer**: _(응답 대기 중…)_

---

## #96

**Prompt**: 한명이 당일불참한 건은 엔빵때도 포함시켜야함. 그리고 그러면 가격이 좀 이상하게 나오는데 10원단위는 절상하고, 200원 미만은 6천원으로.

**Answer**: 부과 정정 완료했습니다. **DB는 이미 반영돼서 회원들이 보는 미납 금액은 지금 맞습니다.**

## 세션 237 (8/17 에이트민턴) 정정 결과

| | 이전 | 현재 |
|---|---|---|
| 총액 | 78,000원 (2시간분) | **117,000원** (13,000×3코트×3시간) |
| 분모 | 18명 | **19명** (참석 18 + 당일취소 우창형) |
| 1인당 | 4,330 / 6,000 두 종류 | **6,000원 전원** |
| 부과 합계 | 86,290원 | **114,000원** |

산식: 117,000 ÷ 19 = 6,157.9 → 10원 절상 6,160 → 정액 +200원 미만이라 **6,000원**.

**선납 5명은 손대지 않았습니다.** 이미 6,000원을 냈고 새 산식도 6,000원이라 자동으로 완납 처리됩니다 — 아까 논의했던 "6,500으로 올려 500원씩 더 받기"가 불필요해졌습니다. 지금 미납은 14명 × 6,000 = 84,000원입니다.

실지출 117,000원과 부과 114,000원의 **차액 3,000원은 통장이 흡수**합니다. 스냅 규칙을 넣으신 의도가 그거라고 이해했습니다.

## 규칙 변경 (앞으로 모든 엔빵 세션)

`dues_generate_session_court`를 고쳤습니다.
1. **당일취소도 엔빵 분모·부과에 포함** — 안 그러면 코트를 비운 사람이 한 푼도 안 내고 나온 사람들이 더 나눠 갖는 역진이 됩니다. grace 1시간(확정 직후 철회)은 그대로 미부과입니다.
2. **10원 절상** (기존 버림)
3. **정액 이상 ~ +200원 미만은 6,000원으로 스냅**, 한방향

클라이언트 미러(`sessionSettle.ts`)도 같이 고쳤습니다. 이게 어긋나면 정산 대조 시트가 우창형을 "부과 없어야 하는데 부과됨"으로 오탐합니다. `docs/ACCOUNTING_SPEC.md` §1.1·§3.1.1·§7도 갱신했습니다.

과거 세션 182(7/17)는 요청대로 **건드리지 않았습니다** — 7,500원 × 12명 전원 납부 완료 상태 그대로입니다.

## 검증·상태

- 적용 전 롤백 트랜잭션으로 최종 명단까지 확인 후 적용
- 타입체크 통과, 테스트 **327건 통과**(새 규칙 검증 3건 추가 — 절상·스냅 양방향·당일취소 분모 포함). 린트 8건은 기존 문제 그대로
- 마이그레이션 2건은 프로덕션 적용 완료(`db push`)
- **프론트는 스테이징만 했습니다.** 커밋·푸시할까요? 배포 전까지는 운영진 정산 대조 시트에서 우창형이 ⚠확인으로 잘못 뜹니다(회원 화면 금액은 정상).

한 가지 확인해 두실 것은, 117,000원 **실지출 거래가 통장에 아직 안 들어와 있습니다**. 들어오면 세션 237에 연결해야 회계 원장의 코트 지출이 맞습니다.

---

## #97

**Prompt**: 당일불참 뱃지와 이유가 같이 나올필욘 없을거같은데 뱃지만 냄겨줘. 끝나면 푸쉬하고

**Answer**: 배포 완료했습니다.

## 딱지만 남긴 부분

당일취소 행에서 중복이던 문구들을 정리했습니다.

- **명단 행**: `splitDayCancel` 사유("엔빵 당일취소인데 부과됨", 빨강)를 제거했습니다. 이제 우창형 행은 **`당일취소` 딱지만** 붙고 사유 문구는 안 뜹니다. 이 사유는 새 규칙에선 발생 자체가 불가능해서 타입에서 지웠습니다.
- **인원 대조**: `+ 당일취소 1명` 옆 설명("자리·약속 비용이라 …")을 뺐습니다.
- 겸사겸사 어긋나 있던 표기 두 곳도 고쳤습니다 — `부과 대상` 행의 산식이 `÷ 참석수 · 10원 버림`으로 나오던 것을 `÷ 대상수`로, 일정 에디터에서 총액 입력할 때 뜨는 안내도 `참석 인원으로 나눠 부과(10원 버림)` → `참석·당일취소 인원으로 나눠 부과(10원 절상)`으로 바꿨습니다.

## 배포

- `8c3b8bc` 산식 변경 + 237 정정 + 미러 동기화
- `701bee1` 일정 에디터 안내 문구
- Actions Deploy 2회 모두 성공, 최종 번들(`index-Bmh9-cU7.js`)에서 `splitDayCancel`·`10원 버림` 제거 및 `10원 절상` 반영 확인
- 타입체크 통과, 테스트 327건 통과

DB는 앞서 이미 적용돼 있어서 세션 237은 **19명 전원 6,000원**(완납 5 / 미납 14 = 84,000원) 상태입니다.

첫 배포 검증에서 `10원 버림`이 남아 있는 걸 잡아 한 번 더 배포했습니다. `SessionSettleSheet`만 보고 `lib/schedule/courtFee.ts`의 안내 문구를 놓쳤던 건데, 번들을 grep한 덕에 걸렸습니다.

남은 건 하나입니다 — **117,000원 실지출 거래가 통장에 아직 안 들어와 있어서** 세션 237의 `코트지출 연결`이 비어 있습니다. 입금 내역이 수집되면 세션에 연결해 주세요.

---

## #98

**Prompt**: 정지된 회원 아직 회비부가 남았더라? 그리고 정산함에 손형일이 0817 참가했는데 부과가 없어

**Answer**: _(응답 대기 중…)_

---

## #99

**Prompt**: 수동으로 넣은거긴 한데, 이런 경우에도 부과해줘.

**Answer**: _(응답 대기 중…)_

---

## #100

**Prompt**: 수동으로 넣은거긴 한데, 이런 경우에도 부과해줘. 근데 수동으로 뺄 때도 있으니까, 기본적으로 참여케이스를 보고, 만약 누군갈 "추가"했다면 그 추가한 인원도 부과대상으로 넣어줘.

**Answer**: 두 건 다 처리했고 **DB는 반영 완료**, 다만 **프론트 배포는 GitHub 장애로 막혔습니다.**

## 1. 손형일 (세션 237)

원인은 승격 버그가 아니었습니다. 우창형이 12:29 취소한 자리는 12:31 이재원의 신규 신청이 채웠고, 손형일은 14:25 신청이라 만석(18)에서 정상 대기였습니다. 그런데 **현장에서 보드에 넣어 9경기를 뛰었고**, 부과 대상 판정이 참석 명단만 봐서 빠졌습니다.

요청대로 **부과 대상 = 참석 명단 ∪ 보드 수동 추가분**으로 바꿨습니다. 합집합이라 보드에서 **뺀** 사람은 명단 기준으로 계속 부과되고, **추가**한 사람만 더해집니다.

- 손형일 **6,000원** 부과 → 237은 20건 전원 6,000원 (완납 14 / 미납 6), 부과합 120,000원
- 결정대로 5,850으로 재계산하지 않았습니다(14명 초과납 방지)
- 당일취소로 잡힌 사람이 보드에도 있으면 참여자로 봅니다 — 딱지 없이 '보드 추가'로 계상

부수적으로, 대상 술어가 분모·INSERT·정리 DELETE 세 곳에 복제돼 있던 걸 `dues_court_targets` 하나로 묶었습니다. 분모를 같은 함수에서 세니 인당×인원이 총액과 어긋날 수 없습니다.

## 2. 정지 회원 회비

`members.is_active` true→false 트리거로 미납 회비를 자동 면제합니다. 기존 11건(55,000원)도 정리했습니다 — 현재 정지 회원 회비는 `waived 11 / paid 6`, 미납 0.

납부·부분납과 **대관비는 건드리지 않습니다**(실제로 코트를 쓴 대가). 삭제가 아니라 `waived`라 감사 로그로 추적됩니다. 정지 경로가 `members` 직접 UPDATE라 RPC 대신 트리거로 뒀습니다.

적용 전 롤백 트랜잭션에서 트리거 실동작까지 확인했습니다(김지훈을 정지시켜 미납이 즉시 면제되는지).

## 배포 — GitHub 장애로 실패

`00c2359` 푸시됐고 **빌드는 성공**했지만, `actions/deploy-pages`가 **HTTP 503**으로 실패했습니다. 재실행도 같은 503이고 githubstatus.com이 **Partial System Outage**입니다. 4회 재시도했으나 계속 막혔습니다.

- **DB 변경은 이미 라이브** → 손형일 부과·회비 면제는 지금 반영된 상태입니다
- **프론트는 이전 번들**(`index-Bmh9-cU7.js`)이라, 운영진 정산 대조 시트에서 손형일이 `참석·당일취소인데 부과 없음`으로 잘못 뜹니다(실제 부과는 정상)

장애가 풀리면 재배포하면 됩니다 — `gh run rerun 32051957747 --failed`. 원하시면 제가 잠시 후 다시 시도하겠습니다.

---

## #101

**Prompt**: 커밋하고 추쉬했어?

**Answer**: 배포까지 완료됐습니다.

- 커밋 `00c2359` → `origin/main` 푸시 (로컬·원격 동일, 미커밋 변경 없음)
- Deploy 워크플로 **success** (재실행 17초)
- 라이브 번들 `index-CpmxsOsy.js`에 보드 합집합(`session_players`)과 `+ 보드 추가` UI 반영 확인

아까 실패는 GitHub Pages API 503이었고, 재실행이 통과했습니다. GitHub는 여전히 Partial System Outage로 표시되지만 Pages 배포는 정상 처리됐습니다.

이제 DB와 프론트가 모두 반영된 상태입니다 — 정산 대조 시트에서 손형일이 `+ 보드 추가 1명`으로 잡히고 6,000원 부과로 정상 표시됩니다.

---

## #102

**Prompt**: 다시리런해봐

**Answer**: 리런 완료했습니다.

- Deploy 워크플로 `32051957747` **전체 재실행 → success** (deploy 8초)
- 라이브 번들 `index-CpmxsOsy.js` (같은 커밋 `00c2359`이라 해시 동일)
- 보드 합집합 · `+ 보드 추가` UI · `10원 절상` 모두 반영 확인

과정에서 `rerun`과 `workflow_dispatch` 모두 503으로 두 번 튕겼고, 100초쯤 기다린 뒤 통과했습니다. GitHub는 여전히 Partial System Outage 표시지만 Actions·Pages는 정상 동작합니다.

---

## #103

**Prompt**: 17일 경기기록 분석해봐 사용자들이 같은사람하고 경기하는 케이스가 많다고 하는데 이게 “경향”이 생기는거같음

**Answer**: 8/17 = 세션 237(19명 M15/F4, 3코트, 완료 44경기)입니다. **유저 직관이 맞았습니다 — 다만 "경향"이 생기는 곳은 8/17 하루가 아니라 세션을 가로지르는 축이었습니다.**

## 1. 체감은 사실이다 (그리고 기존 지표는 그걸 못 잡았다)

| 지표 | 실측 | 조건부 무작위 | 완전자동 시뮬 |
|---|---|---|---|
| overlap2+ | 88.4% | 89.5~90.7% | 88.4% |
| overlap3+ | 23.3% | 32.6% | 3.5% |
| 3회+ 동반쌍 | 17.5% | 20.1% | 10.5% |
| **개인 최다동반** | **4.32회 (판수의 47%)** | 비율 p50 0.44 | 3.18회 |
| **b2b(직전 멤버가 또)** | **0.51** | — | 0.33 |

**19명 중 11명이 자기 경기의 45% 이상을 특정 한 사람과 뛰었습니다.** 그런데 `overlap2+ 88.4%`는 실측·무작위·완전자동이 전부 같아서 설명력이 0입니다 — 지금까지 이 지표로 봤으면 못 잡았을 민원입니다.

또 반복은 전부 **네트 건너편**입니다. 최다 동반 쌍의 파트너/상대 분해가 1/5, 0/5, 0/5 — 같은 편 반복은 최대 3회로 무작위보다 오히려 낫습니다.

## 2. 8/17 하루만 보면 알고리즘 탓이 아니다

편성 시점 가용 인원이 44회 중 36회가 **11명**(3코트가 12명을 묶어둠). C(11,4)=330 조합을 44번 뽑으면 겹칩니다. 여성은 더 극단이라 혼복 18경기 중 **8경기(44%)는 가용 여성이 정확히 2명 = 선택권 0**이었고, F-F 쌍 평균 3.0회는 `혼복 18건 ÷ 6쌍`이라는 **나눗셈 결과**입니다(4000시드 SD=0.000).

제가 세운 W_SKILL_EXP 가설은 **기각**됐습니다 — 실력항이 원인이면 등급 꼬리가 피해자여야 하는데(서명 +1.77), 실측은 정반대(−1.80, z=−5.8)입니다. 송유현(g9)의 고유상대 18명이 로스터 최다였습니다.

## 3. 진짜 "경향"은 7주 누적에서 나온다

`fetchSessionSnapshot`이 완료 경기를 `.eq("session_id", sessionId)`로만 조회합니다 (`src/lib/supabase/session.ts:30`) — **재결성 회피 기억이 매주 리셋**됩니다. 7/1~8/17 35세션 1,069경기를 회원 단위로 통합해, 세션별 코트 점유·성별 구성·활동구간을 보존한 귀무로 검정했습니다.

**자유도가 충분한 22명+ 세션 12개(560경기)만 봐도:**

| 지표 | 실측 | 귀무 | z |
|---|---|---|---|
| 등급거리 ↔ 동반횟수 상관 | −0.259 | −0.115 | **−6.32** |
| 최다 동반 쌍 | 25회 | 15.5회 | **+5.59** |

이수민(F)은 77판 중 **41판(53%)**을 표슬아(F)와 뛰었습니다(무작위 기대 23%). 세션 131은 7판 전부, **여성이 11명이나 있던 세션 76도 9판 중 8판**입니다.

**핵심 역설:** 세션 하나만 보면 실측(2.42)이 무작위(2.62)와 설계치(2.29) 사이에서 무작위 쪽인데, 7주를 누적하면 설계치 쪽에 붙습니다. **약한 등급 매칭 편향이 세션 간 기억 없이 35번 반복되며 쌓입니다.** 자동편성을 더 쓰면 세션 내 반복은 줄지만 이 축은 오히려 강해집니다 — 같은 다이얼로 못 잡습니다.

## 4. 8/17에 실제로 나빴던 것: 즉시 재투입

선수별 직전 종료 → 다음 시작 간격이 **<2분이 31.2%**. 방금 뛴 사람은 gameCount +1에 대기 보너스 0이라 점수상 **항상 꼴찌권**이고, 리플레이하면 실제 4인이 랭킹 꼴찌 전원인 편성이 나옵니다 — 자동편성이 만들 수 없는 편성입니다. 자동편성 완전일치율은 앵커 없이 4.5%, 앵커 1명에 20%였습니다.

**몫 분해(4.32회 기준): 구조 ≥2.76회(64%) / 자동편성 미채택 1.14회(개선 가능분의 73%) / 가중치 여지 0.42회(27%).**

## 5. 발견된 코드 결함

1. **ghost 실효 페널티가 명목 30이 아니라 +9.4(≈1판)** — `complete_match`가 완료 때만 gc+1(−10) + `assign_match`가 `wait_since` 미갱신으로 경기 중에도 대기 보너스 누적(−10.6) + W_PLAYING(+30). 프로덕션 점수함수 직접 호출로 재현.
2. **`W_GROUP4 > 최대 확장 벌점` 불변식이 이미 깨져 있음** — 주석/테스트가 k=6(54)을 최대로 가정하나 `SkillGrade`는 1~10이라 k=8 → 96 > 60. 237 로스터(등급 1~9)에서 실현 가능 = **재결성이 밴드 확장보다 쌉니다.** → 125 필요.
3. `commitTeammates`에 팀당 ghost≤1 캡 없음(`maxPlaying`은 `autoFillTarget`에만 전달).
4. 완료 undo 부재 → 4분 미만 완료 5건, reunion4 3건 중 2건이 여기(0.1분·2.9분 경기 직후 같은 4명 재편성).
5. `lastGameType`이 `resyncFromServer` patch에 없음 — rotate 항 영향폭 중앙값 20.0 > group 16.0.
6. `pairPlayers.bestMixedPairing`이 혼복 여성 2명을 **반드시 반대 팀**에 배치 → 여성끼리는 늘 맞대결.
7. **`matches.assign_source` 부재** — 자동/수동이 DB에서 원리적으로 구별 불가. 이게 없으면 다음 감사도 같은 벽입니다.

부수: 오상진 `game_count`=9인데 실제 5경기(드리프트). 편성 영향은 ≈0이나 출전 통계가 틀립니다.

## 6. 처방

**즉시(거의 무료):** `W_GROUP4` 60→**125** (회귀 테스트 6개 assertion 전부 통과 확인) · `lastGameType` resync 추가 · 완료 확인/undo · `assign_source` 컬럼 · `commitTeammates` ghost 캡 · `set_player_resting` 멱등 가드

**가중치:** `(W_GROUP2,3,4)=(8,40,120)`이 유일하게 파레토 우월(overlap3 0.023→0.000, 비용 스프레드 +0.4%)하지만 **체감 이득은 0**입니다. `W_GROUP2≥10` 안들은 `recommendTeammates.test.ts:287`을 깨고 여1남3 편성이 폭증합니다. → 회계 지표용으로만.

**최대 레버는 운영입니다:** 앵커 1~2명만 놓고 나머지 자동편성 (4.32→3.18회). 코트는 늘리지 마세요(19명·4코트는 악화). 혼복 비율도 건드리지 마세요(2F/N=42.1%가 성별 균등 참여의 유일해).

**세션 간 축(§4d, 미측정):** `groupHistory`에 최근 N세션을 감쇠 가중으로 싣거나, 저비용 대안으로 자석에 "최근 4주 최다 동반 상대" 배지.

## 한계

- `assign_source`가 없어 **"알고리즘이 반복을 만들었나"는 이 로그로 답이 안 나옵니다.** 자동편성 미채택 몫 1.14회는 추정치가 아니라 **상한**입니다.
- 8/17은 1회 실현치입니다. 완전자동 대비 열위는 z가 아니라 "1,000시드 중 0시드"로 읽어야 합니다.
- 회원 108명 중 11명이 키가 갈려(게스트 재등록 등) 교차세션 이력이 쪼개집니다 — §4d 수치는 그만큼 보수적입니다.
- 시뮬은 휴식·이탈·수동 교체를 모델에 넣지 못했고, 전부 실측을 위로 미는 방향입니다.

런북 절차대로 `docs/MATCH_LOG_ANALYSIS.md`에 §4c(세션 237)·§4d(세션 간 축, 함정 8~10 추가)를 남기고 스테이징했습니다. 분석 스크립트는 스크래치패드에 있습니다.

---

## #104

**Prompt**: 8월 16일 참석/불참 누른거 로그뽑아줘

**Answer**: `ops_audit`(kind=attendance) 감사 로그를 프로덕션에서 직접 뽑았습니다. "8월 16일"이 두 가지로 읽혀서 둘 다 정리했습니다.

## ① 8/16 일정(세션 #111)의 참석/불참 로그 — 37건

세션 #111 · 2026-08-16 15:00~18:00 · 에이트민턴 · 정원 18(초기 24) · closed

| 시각(KST) | 회원 | 변화 | 경로 | cnt/실제/정원 |
|---|---|---|---|---|
| 08-09 18:00:15 | 채진 | – → 참석 | join_session | 1/1/24 |
| 08-09 18:00:17 | 황서진 | – → 참석 | join_session | 2/2/24 |
| 08-09 18:00:19 | 유성종 | – → 참석 | join_session | 3/3/24 |
| 08-09 18:00:28 | 남필립 | – → 참석 | join_session | 4/4/24 |
| 08-09 18:00:35 | 이규웅 | – → 참석 | join_session | 5/5/24 |
| 08-09 18:00:36 | 송유현 | – → 참석 | join_session | 6/6/24 |
| 08-09 18:00:37 | 최두호 | – → 참석 | join_session | 7/7/24 |
| 08-09 18:00:50 | 차성민 | – → 참석 | join_session | 8/8/24 |
| 08-09 18:01:12 | 신동연 | – → 참석 | join_session | 9/9/24 |
| 08-09 18:01:33 | **이규웅** | 참석 → 취소 | cancel_attendance | 9/8/24 |
| 08-09 18:02:24 | 오용진 | – → 참석 | join_session | 9/9/24 |
| 08-09 18:02:42 | 박세경 | – → 참석 | join_session | 10/10/24 |
| 08-09 18:03:00 | 진명현 | – → 참석 | join_session | 11/11/24 |
| 08-09 18:03:56 | 박현아 | – → 참석 | join_session | 12/12/24 |
| 08-09 18:04:02 | **박현아** | 참석 → 취소 | cancel_attendance | 12/11/24 |
| 08-09 18:13:49 | 이재원 | – → 참석 | join_session | 12/12/24 |
| 08-09 18:14:52 | 김길환 | – → 참석 | join_session | 13/13/24 |
| 08-09 18:17:13 | 손형일 | – → 참석 | join_session | 14/14/24 |
| 08-09 18:19:16 | 김태혁 | – → 참석 | join_session | 15/15/24 |
| 08-09 22:12:17 | 이유나 | – → 참석 | join_session | 16/16/24 |
| 08-10 01:12:25 | 김철중 | – → 참석 | join_session | 17/17/24 |
| 08-10 14:21:41 | **차성민** | 참석 → 취소 | cancel_attendance | 17/16/24 |
| 08-10 21:28:38 | **이유나** | 참석 → 취소 | cancel_attendance | 16/15/24 |
| 08-11 07:57:13 | 김석준 | – → 참석 | join_session | 16/16/24 |
| 08-11 15:07:09 | **채진** | 참석 → 취소 | cancel_attendance | 16/15/24 |
| 08-12 15:34:21 | **이재원** | 참석 → 취소 | cancel_attendance | 15/14/24 |
| 08-12 17:20:41 | **김길환** | 참석 → 취소 | cancel_attendance | 14/13/24 |
| 08-13 12:13:01 | 오상진 | – → 참석 | join_session | 14/14/24 |
| 08-13 23:06:14 | **오상진** | 참석 → 취소 | cancel_attendance | 14/13/24 |
| 08-14 00:48:04 | **신동연** | 참석 → 취소 | cancel_attendance | 13/12/24 |
| 08-14 06:28:46 | **진명현** | 참석 → 취소 | cancel_attendance | 12/11/24 |
| 08-14 09:36:48 | **김태혁** | 참석 → 취소 | cancel_attendance | 11/10/24 |
| 08-15 16:35:22 | **박세경** | 참석 → 취소 | cancel_attendance | 10/9/24 |
| 08-15 16:37:38 | **송유현** | 참석 → 취소 | cancel_attendance | 9/8/24 |
| 08-16 13:12:03 | **오용진** | 참석 → 취소 | cancel_attendance | 8/7/**18** |
| 08-16 13:33:56 | 오용진 | 취소 → 참석 | join_session | 8/8/18 |
| 08-16 14:33:36 | 이정완 | – → 참석 | join_session | 9/9/18 |

**최종 상태**: 확정 9명 (황서진·유성종·남필립·최두호·손형일·김철중·김석준·오용진·이정완), 취소 13명, 대기 0명. `session_counters` = 9 로 실제와 일치(드리프트 없음).

특징: 전부 본인이 직접 누른 기록이고(행위자 = 회원 본인), 운영진 대리취소·게스트 초대는 0건입니다. 8/15 16:37~8/16 13:12 사이에 정원이 24 → 18로 바뀐 흔적이 감사 로그의 `capacity` 필드에 남아 있습니다.

## ② 8/16 하루 동안(KST) 눌린 모든 참석/불참 — 145건, 전 세션

8/16은 일요일 18:00 주간 오픈일이라 그 시각에 폭발적으로 몰렸습니다.

- **18:00~18:01 1분간 60건** — 8/18 #114, 8/19 #133, 8/20 #138, 8/21 #140 신규 오픈 물량
- 8/16 세션(#111) 관련은 위 표의 마지막 3건뿐
- 나머지는 다음 날 8/17 #237(28건), 8/18 #114, 8/19~8/21 예약분
- 대리 조작 3건: `add_guest_attendance` 김선예(초대 김길환)·공태호(초대 함규리→취소→고수지 재등록), `cancel_guest_attendance` 황혜림(초대 김영주)
- 자동 승격 1건: 02:55:44 양수진 취소 → 이도현 대기→참석 (8/22 #228, 같은 트랜잭션)
- 오탈자성 즉시 취소가 잦음 — 강민규·유용환·박현아·심유진·최대현 등이 참석 누른 뒤 2~20초 안에 취소

전체 원문은 여기 저장했습니다:
- `…/scratchpad/att_20260816_session111.txt` (세션 #111, 37건)
- `…/scratchpad/att_20260816_allday.txt` (8/16 하루, 145건)

재조회용 스크립트도 같은 디렉터리에 `att_log.py`로 남겨뒀습니다 (`python3 att_log.py session <id>` / `day <YYYY-MM-DD>`).

> 참고: Supabase Management API 토큰(`~/.supabase/access-token`)은 403이 나서 REST + 서비스키로 우회했습니다. 토큰이 만료된 것 같으니 `supabase login`을 다시 하시면 앞으로 임의 SQL 진단이 편해집니다.

---

## #105

**Prompt**: 우리 모임에 회비입금 및 정산등을 편하게 하고 싶은데 현재 토스 모임통장에서 긁어오는걸 하고있는데 너무 불편해. 자동으로 통장내역을 가져오지 못해서 그런데, 외부서비스중에 입금내역을 쉽게 가져올수 있는 수단같은게 있나? 사업자등록 안하고.

**Answer**: 현재 구조를 정확히 파악했습니다. 리서치가 도는 동안 정리해두면 — **이미 자동화는 90% 되어 있고, 남은 수동 단계는 딱 하나**입니다.

[코드 블록 생략]

즉 문제는 "파싱/적재"가 아니라 **토스가 거래내역을 스스로 밀어주지 않는다**는 것 하나입니다. 그래서 찾아야 할 건 "회계 시스템"이 아니라 **자동으로 거래를 push 해주거나 pull 할 수 있는 소스**고, 기존 Gmail 수신 파이프라인에 그대로 꽂히면 이상적입니다.

이 관점으로 6개 경로(오픈뱅킹 제도 / 은행 개인 개발자 API / 스크래핑 API / 모임통장 기능 / SMS·푸시 우회 / 기성 서비스)를 병렬 조사 중이고, "사업자 없이 가능"이라는 핵심 주장은 별도 검증 단계로 반박 시도까지 돌리고 있습니다. 결과 나오는 대로 정리해서 드리겠습니다.

---

## #106

**Prompt**: <task-notification>
<task-id>wty7fhdgk</task-id>
<tool-use-id>toolu_013SZUUxwvtJ9i47Z96xN5KL</tool-use-id>
<output-file>/private/tmp/claude-501/-Users-sam-Projects-cocktime-scheduler/8a1f0b7f-0317-43f3-88e2-f9108e4a0c7f/tasks/wty7fhdgk.output</output-file>
<status>completed</status>
<summary>Dynamic workflow "사업자등록 없이 동호회 통장 입금내역을 자동 수집할 수 있는 국내 수단 조사 및 검증" completed</summary>
<result>{"options":[{"name":"금융결제원 오픈뱅킹 이용기관 등록 (운영계, openapi.kftc.or.kr)","category":"제도권 오픈API - 오픈뱅킹 운영","howItWorks":"이용기관(핀테크사업자)이 금융결제원과 이용계약 체결 → 사용자가 이용기관 서비스에서 본인 계좌를 '오픈뱅킹 계좌등록' → 이용기관이 fintech_use_num(핀테크이용번호) + Access Token으로 GET https://openapi.openbanking.or.kr/v2.0/account/transaction_list/fin_num 호출. 응답 필드는 tran_date(거래일자), tran_time(거래시간), inout_type('입금'/'출금'), tran_type(현금/대체/급여/타행환 등), print_content(통장인자내용, 20자 = 실질적으로 입금자명), tran_amt(거래금액), after_balance_amt. 한 페이지 최대 25건, 페이지 단위 반복 호출. 즉 '입금자명/금액/일시'라는 요구사항 자체는 이 API가 정확히 충족함. 문제는 여기에 도달할 자격.","businessRegRequired":"yes","evidence":"결정적 증거는 2026-08-18 현재 라이브인 회원가입 폼 자체다. https://openapi.kftc.or.kr/join/joinForm?termsVer=1 의 페이지 제목이 '이용기관 정보입력'이고, 필드 구성이 다음과 같다. (1) '기관구분' 라디오 = 「법인」(value=C) / 「개인사업자」(value=P) 두 개뿐 — '개인'/'비사업자' 선택지가 아예 없음. (2) '사업자등록번호' input(name=bman_regi_num)에 HTML 속성 data-valid=\"required\" 가 걸려 있고 중복확인 버튼 존재. (3) '사업자등록증 첨부' 업로드 박스의 CSS 클래스가 upload_form type_essential (필수 첨부). (4) 그 외 '사업장 소재지', '대표자명', '대표 전화번호', 업무/개발/운영 담당자 정보가 필수. 즉 사업자등록번호 없이는 가입 폼 제출 자체가 불가능하다. 규정 측면 근거도 일치한다. FAQ '오픈뱅킹 이용자격은 무엇인가요?'(https://openapi.kftc.or.kr/support/faqList, 오픈뱅킹 카테고리) 원문: \"오픈뱅킹 참가 금융회사, 금융위원회의 「핀테크산업 분류업종 기업」에 해당하는 핀테크 기업, 전자금융업자 또는 전자금융보조업자가 이용하실 수 있습니다.\" 열거된 3개 주체 모두 '기업/사업자'다. 서비스 소개 페이지(https://openapi.kftc.or.kr/service/openBanking)의 '이용대상' 아코디언도 동일하게 \"핀테크 사업자 + 은행 등 금융기관 / 핀테크산업 분류업종 기업 / 전자금융업자, 전자금융보조업자 / 오픈뱅킹 운영기관 인정기업\"만 열거. 또 같은 페이지의 '이용기관' 정의는 \"금융결제원과 오픈뱅킹 이용계약을 체결하고 이용승인을 받은 핀테크사업자 및 참가기관\".","sources":["https://openapi.kftc.or.kr/join/joinForm?termsVer=1","https://openapi.kftc.or.kr/join/joinTermsAgreeForm","https://openapi.kftc.or.kr/service/openBanking","https://openapi.kftc.or.kr/support/faqList","https://developers.kftc.or.kr/dev/openapi/open-banking/transaction","https://openapi.kftc.or.kr/main"],"cost":"공개된 단가표 없음(확인 실패). FAQ '오픈뱅킹 이용 수수료는 어떻게 책정되나요?' 원문: \"오픈뱅킹 이용 수수료는 오픈뱅킹 서비스 이용의 대가로 이용기관이 은행에 지불하는 수수료입니다. 이는 이용기관이 주거래기관(은행) 한 곳과 협의하신 후 결정됩니다(수수료는 처리대행비용과 주거래은행수수료로 이뤄지며 주거래은행수수료는 은행과 협의하여 자율적으로 정해집니다). 수수료는 이용하시는 API 서비스별(잔액조회 등 19개)로 상이하며, 이용 건별로 책정됩니다.\" 즉 은행과 개별 협상이라 사전에 알 수 없다. 여기에 별도로 보안전문기관 보안취약점 점검 비용이 붙는다(금액 미공개). 참고로 한 개인 개발자 블로그는 \"API 사용료가 너무 비싸다.. 보안점검 관련 비용도 플러스되어 기본 천만원…?\"이라고 적었는데 이는 개인 추정치이지 공식 수치는 아니다. 월 수십 건 규모 동호회 기준으로는 건당 수수료 자체는 미미하겠지만, 진입 고정비(보안점검+계약)가 압도적으로 큼.","effort":"극히 높음. FAQ '오픈뱅킹을 이용하려면 어떤 절차가 필요한가요?' 원문 6단계: \"① 통합API 포털에 회원가입 후 오픈뱅킹 이용을 신청 ② 오픈뱅킹 센터는 이용기관이 제출한 서비스 계획서와 관련 증빙서류를 토대로 이용적합성을 심사 ③ 이용기관은 개발자사이트에서 서비스 개발 및 테스트 ④ 오픈뱅킹 센터는 개발이 완료된 이용기관 서비스의 기능을 테스트 ⑤ 보안전문기관에서 핀테크 서비스의 보안 취약점을 점검 ⑥ 이용기관은 주거래기관(은행)과 수수료를 협의하신 후, 계약에 필요한 관련 서류를 제출하시면 오픈뱅킹 센터와 이용계약을 체결한 후 서비스를 운영합니다.\" 이용적합성 심사만 약 15영업일. 인증수단은 공동인증서/금융인증서가 아니라 OAuth 2.0 기반 사용자인증(계좌등록 시 ARS 또는 전자서명 동의 필수) + client_id/client_secret. 별도 FAQ: \"핀테크기업의 서비스를 통해 은행에 있는 고객의 금융거래정보가 제공될 경우 금융실명법상 전자서명, ARS 등을 통한 고객의 정보제공 동의가 필요합니다.\" 개발 난이도 자체는 평범한 REST/OAuth 수준이라 낮지만, 자격·심사·보안점검·은행 계약이 전부 사업자 전제.","risks":"① 자격 미달이 명백 — 비사업자 개인은 가입 단계에서 차단. ② 이용적합성 심사에서 '동호회 내부 회비 관리'라는 자기사용(self-serving) 모델이 '핀테크 서비스'로 인정될지 매우 불확실. ③ 제외서비스 조항 주의: 이용약관 제12조 관련 FAQ에 \"납부서비스 : 수납하려는 주체가 고객에게 제공하는 재화나 용역의 대가로서 일정금액을 정기적·반복적으로 추심(예약)하는 경우\"가 오픈뱅킹업무 대상에서 제외된다고 명시 — 회비 자동수납 모델로 확장하면 정면 충돌 가능(조회만 하면 직접 저촉은 아닐 수 있으나 심사 리스크). ④ 이용약관 전문(제11조 이용자격/제12조 제외서비스 원문)은 로그인 후에만 다운로드 가능해 직접 확인 실패 — FAQ 요약본으로만 확인함. ⑤ 2026-06-30 시행 이용약관 개정 공지가 올라와 있으나(2026-05-29 게시) 개정 내용은 로그인 게이팅으로 확인 실패.","verdict":"이 동호회 케이스에서 사실상 불가능. 필요한 데이터 형태는 정확히 맞지만, 사업자등록번호+사업자등록증이 회원가입 폼의 필수 입력값이라 개인 자격으로는 첫 단추부터 막힌다.","lane":"openbanking"},{"name":"오픈뱅킹 개발자사이트 테스트베드 (developers.kftc.or.kr)","category":"제도권 오픈API - 테스트베드","howItWorks":"이메일+비밀번호만으로 개발자 계정 생성 → MY PAGE에서 서비스 신청 → API Key(client_id/client_secret) 발급 및 Callback URL 등록 → '테스트 정보 관리'에서 개발자가 API 응답 데이터를 직접 등록 → Swagger UI 기반 REST 테스트 도구로 호출. 즉 응답값을 내가 미리 입력해두고 그걸 그대로 돌려받는 구조라, 실제 은행 계좌와는 연결이 전혀 없다.","businessRegRequired":"no","evidence":"https://developers.kftc.or.kr/dev/user/register 페이지 상단 원문: \"금융결제원의 오픈API 개발자 사이트는 핀테크기업 뿐만 아니라 금융 오픈 API에 관심있는 누구나 간단한 정보등록 만으로 회원가입을 할 수 있습니다. 개발자사이트에서 자신만의 멋진 핀테크 앱을 개발해 보신 후, 추후에 이용 신청을 통하여 사업화를 진행하실 수 있습니다.\" 수집 항목도 \"회원ID(이메일주소), 비밀번호, 성명 또는 기업명\"뿐이고 폼 필드는 ID(이메일)/비밀번호/비밀번호확인 수준. 사업자 정보 입력란 없음. 반면 운영계 포털(openapi.kftc.or.kr) 가입 폼은 사업자등록증 필수 — 이것이 질문에서 지적한 '테스트베드는 개인도 되지만 운영은 안 되는 함정'의 실체이며, 실제로 두 사이트가 별도 계정 체계로 분리되어 있다. 테스트 전용임은 https://developers.kftc.or.kr/dev/starter/starter 원문 \"오픈API를 테스트하기 전에 개발자가 사전에 API 요청에 대한 응답 데이터를 등록하고 등록한 데이터를 활용하여 테스트를 수행할 수 있습니다\"로 확인. 한 개인 개발자 블로그도 \"하지만 테스트만 가능하며 실제 데이터로 개발하기에는 현재로서는 불가능한 것을 확인했다\", \"실제 은행 정보를 가져오려면 테스트베드가 아닌 실제 오픈뱅킹 서비스를 사용해야 하는데 이것은 개인이 사용할 수가 없다고 한다. (적어도 개인사업자는 있어야 한다.)\"라고 기록.","sources":["https://developers.kftc.or.kr/dev/user/register","https://developers.kftc.or.kr/dev/starter/starter","https://developers.kftc.or.kr/dev","https://seoyh1104.github.io/open%20api/open-api/"],"cost":"무료","effort":"낮음(OAuth+REST). 다만 얻는 게 mock 데이터라 실사용 가치 0.","risks":"없음(테스트 전용). 다만 '개인도 가입되네?'라고 착각해 여기에 시간을 쏟는 것이 가장 흔한 함정.","verdict":"쓸 수 없음. 학습·PoC 전용이며 실제 토스뱅크 모임통장 입금내역은 단 한 건도 못 가져온다.","lane":"openbanking"},{"name":"개인사업자 등록 후 오픈뱅킹 이용기관 신청 (우회 경로)","category":"제도권 오픈API - 우회","howItWorks":"홈택스에서 개인사업자 등록(업종을 '컴퓨터 프로그래밍 서비스업' 등 핀테크산업 분류업종에 맞춰 등록) → 사업자등록증으로 openapi.kftc.or.kr 이용기관 가입(기관구분 '개인사업자' 선택) → 서비스 계획서 제출 → 이용적합성 심사 → 개발/기능테스트 → 보안전문기관 보안점검 → 주거래은행 수수료 협의 → 이용계약.","businessRegRequired":"yes","evidence":"가입 폼의 '기관구분'에 「개인사업자」(value=P) 옵션이 실제로 존재하므로, 개인사업자라면 경로 자체는 열려 있다(https://openapi.kftc.or.kr/join/joinForm?termsVer=1). 업종 요건은 FAQ '오픈뱅킹 이용자격' 원문에 열거된 &lt;핀테크산업 분류업종&gt;으로 확인 가능: \"시스템 소프트웨어 개발 및 공급업 / 응용소프트웨어 개발 및 공급업 / 컴퓨터 프로그래밍 서비스업 / 컴퓨터시스템 통합 자문 및 구축 서비스업 / 기타 정보기술 및 컴퓨터운영 관련 서비스업 / 자료 처리업 / 포털 및 기타 인터넷 정보 매개 서비스업 / 데이터베이스 및 온라인정보 제공업 / 그 외 기타 금융지원 서비스업\". 이 중 '컴퓨터 프로그래밍 서비스업'은 1인 개인사업자로 흔히 등록하는 업종이다. 보안점검 비용은 중소기업이면 국고 지원 대상: 한국핀테크지원센터 원문 \"핀테크 기업 보안점검 및 핀테크 서비스 취약점 점검 비용의 70% 지원\", 지원대상 \"금융 테스트베드 참여 기업, 오픈뱅킹 이용신청 기업 및 온투업 등록(예정) 기업, 마이데이터 참여기업\" 중 중소기업기본법상 중소기업. 즉 개인사업자도 지원 대상에 들어갈 여지가 있다. 다만 '개인사업자 자격으로 오픈뱅킹 이용기관 승인을 실제로 받은' 구체적 사례는 검색으로 확인 실패.","sources":["https://openapi.kftc.or.kr/join/joinForm?termsVer=1","https://openapi.kftc.or.kr/support/faqList","https://fintech.or.kr/web/security/securityContentsView.do","https://www.asiae.co.kr/article/2025022409222968760"],"cost":"사업자등록 자체는 무료. 그러나 보안취약점 점검(70% 지원받아도 자부담 발생, 실비 미공개), 은행 협의 수수료, 그리고 사업자가 됨으로써 발생하는 부가세 신고·종합소득세 등 지속 관리비용. 월 몇 만원 이하 예산과는 자릿수가 다름.","effort":"매우 높음. 사업자등록 → 서비스 계획서 작성 → 이용적합성 심사 15영업일 → 오픈뱅킹센터 기능테스트 → 보안전문기관 점검(기술적·관리적·물리적 보안 대책 + 모바일앱/웹 취약점) → 주거래은행 수수료 협상 → 계약. 취미 프로젝트 대비 완전히 비대칭.","risks":"① 이용적합성 심사 통과 여부가 최대 리스크. 조회 API의 정의 자체가 \"이용기관이 제공하는 서비스를 통해 고객 본인 계좌에 대한 잔액 및 거래내역을 실시간으로 조회\"인데, 동호회 운영진 1명이 자기 모임통장을 보려는 구조는 '고객에게 제공하는 핀테크 서비스'라는 전제와 어긋나 반려될 가능성이 크다. FAQ에 \"ㅇㅇㅇ 사업 모델에 오픈뱅킹 API를 활용할 수 있나요?\" → \"오픈뱅킹공동업무 이용약관 제11조(이용자격) 및 제12조(제외서비스)를 통하여 기본적인 이용 대상에 관해 확인이 가능합니다\"라고만 되어 있고 사전 확답을 안 준다. ② 사업자 등록은 되돌리기 부담이 있는 신분 변경(건강보험료·세무 의무). ③ 이용계약 후에도 서비스 미운영/사업모델 변경 시 계약 해지 사유.","verdict":"이론상 유일하게 '제도권으로 뚫리는' 길이지만, 동호회 회비 장부 자동화라는 목적 대비 투입이 압도적으로 과하고 심사 통과도 불투명. 권하지 않음.","lane":"openbanking"},{"name":"금융 마이데이터 사업자 직접 되기 (본인신용정보관리업 허가)","category":"제도권 오픈API - 마이데이터","howItWorks":"본인신용정보관리회사로 금융위 허가를 받으면, 정보제공자(은행)로부터 마이데이터 표준 API로 고객의 계좌 거래내역을 정기 전송받을 수 있다. 개인은 정보주체로서 전송요구만 하고, API 호출 주체는 어디까지나 허가받은 회사.","businessRegRequired":"yes","evidence":"허가제이며 개인은 신청 주체가 될 수 없다. 금융위 보도자료(https://www.fsc.go.kr/no010101/77665)에서 확인한 요건: \"최소자본금 5억원\", \"금융회사 출자요건(50% 이상) 미적용\", \"클라우드 전산설비 이용 허용\", 분기말(4/22, 6/24, 9/30, 12/30) 일괄 접수, 외부전문가 평가·대주주 적격성·임원자격 심사. 자본금·대주주·임원자격 요건 자체가 법인(주식회사) 전제다. 기술 규격 측면에서도 개인 호출 경로가 없음을 확인: 마이데이터 개발자포털 '지원 API(종합포털 제공)' 페이지의 이용주체 표기는 전부 '마이데이터사업자 / 정보제공자 / 통합인증기관 / 종합포털'이며 정보주체(개인)가 직접 호출하는 API는 하나도 없다. 표준 API 기본규격 문서도 참여주체를 \"정보 제공자, 마이데이터사업자, 종합포털, 통합인증기관\"으로만 열거하고, \"정보주체의 개입 없이 마이데이터사업자가 정기적 전송을 위해 호출한 API인지 여부를 구분\"이라는 표현에서 보듯 호출 주체는 기관뿐이다. 또 신용정보법 제22조의9에 따라 마이데이터사업자는 스크래핑 금지·API 방식만 허용.","sources":["https://www.fsc.go.kr/no010101/77665","https://developers.mydatakorea.org
... (truncated 125772 chars, full result in /private/tmp/claude-501/-Users-sam-Projects-cocktime-scheduler/8a1f0b7f-0317-43f3-88e2-f9108e4a0c7f/tasks/wty7fhdgk.output)</result>
<diagnostics>Per-agent results: /Users/sam/.claude/projects/-Users-sam-Projects-cocktime-scheduler/3771f92f-cb7d-4b1c-b935-64cecc4ed22c/subagents/workflows/wf_0787efd1-478/journal.jsonl — one {"type":"result",...} line per completed agent with its full return value.
If the result above is empty or unexpected, Read this file BEFORE diagnosing — do not assume agents returned non-empty results.
To re-run with edited post-processing: Workflow({scriptPath: '/Users/sam/.claude/projects/-Users-sam-Projects-cocktime-scheduler/3771f92f-cb7d-4b1c-b935-64cecc4ed22c/workflows/scripts/korea-bank-tx-ingest-research-wf_0787efd1-478.js', resumeFromRunId: 'wf_0787efd1-478'}) — agents whose (prompt, opts) are unchanged replay from cache.</diagnostics>
<failures>[research:saas] failed: API Error: Connection lost mid-response. The response above may be incomplete.</failures>
<usage><agent_count>14</agent_count><agents_done>13</agents_done><agents_error>1</agents_error><agents_skipped>0</agents_skipped><agents_empty_result>0</agents_empty_result><subagent_tokens>1558385</subagent_tokens><tool_uses>794</tool_uses><duration_ms>3878331</duration_ms></usage>
</task-notification>

**Answer**: ## 결론

**"은행에서 거래내역을 꺼내오는" 방향은 사업자 없이는 전부 막혀 있습니다.** 그런데 방향을 뒤집어서 **"돈이 내 시스템을 거쳐 들어오게" 하면**, 사업자등록 없이 오늘 시작할 수 있는 정식 경로가 있습니다. 여기가 답입니다.

30여 개 후보를 조사하고 "사업자 없이 가능"이라는 주장은 반박 시도까지 돌렸습니다. 확인은 전부 2026-08-18 기준 라이브 페이지 원문입니다.

---

## 1. 확인 사살된 것들 (다시 찾아볼 필요 없음)

| 경로 | 결과 |
|---|---|
| **오픈뱅킹 이용기관** | 가입 폼의 기관구분이 「법인 / 개인사업자」 **2택뿐**이고 사업자등록증이 필수 첨부(`type_essential`). 자연인은 폼 제출 자체가 불가 |
| 오픈뱅킹 테스트베드 | 개인 가입은 되지만 **내가 등록해둔 mock 응답을 내가 돌려받는 구조**. 실계좌 연결 0. 여기서 시간 날리는 게 가장 흔한 함정 |
| **은행 개인 개발자 API** | 8개 은행 전수 확인, 예외 없음. **NH 개발자센터는 2025-12-31 종료**(현재 접속 불가, 구글엔 색인만 남음). IBK·케이뱅크·신한은 개인 가입 버튼이 있지만 문서에 *"운영전환은 기업회원만"* 명시 |
| **스크래핑 API** (CODEF·뱅크다·팝빌·바로빌) | **토스뱅크·카카오뱅크를 단 한 곳도 지원하지 않음.** 구조적 이유 — 이들은 전부 은행 레거시 '빠른조회'에 계좌를 사전등록해 긁는 방식인데, 인터넷전문은행엔 그 창구가 아예 없음 |
| 마이데이터 / 전송요구권 | 개인이 받는 결과물이 **PDF 수동 다운로드**. 개인 수신 API가 규격에 아예 없음. 개인정보보호법 전분야 확대도 은행은 2027-02-20부터 |
| **은행 이메일 거래통지** | 채널 자체가 없음(SMS·앱푸시·알림톡·팩스만). 서버사이드 100% 무인화가 안 되는 근본 원인이 여기 |
| 토스뱅크 특수사정 | PC 인터넷뱅킹이 없어 **긁을 화면 자체가 없고**, 엑셀/CSV 없이 PDF만 |
| 카카오페이·토스 송금내역 | API 없고, 사람이 보는 화면조차 이름이 마스킹됨 |

한 줄 요약: **막힌 건 기술이 아니라 자격**입니다. 오픈뱅킹 거래내역조회 API 응답의 `print_content`(통장인자내용)가 사실상 입금자명이라 스펙은 요구사항에 정확히 맞는데, 호출자 자리에 반드시 심사 통과한 기관이 있어야 하는 3-legged 구조라 우회가 없습니다.

---

## 2. 열려 있는 길 3가지

### ① PayApp 가상계좌 — 가장 균형 잡힌 답 (권장)

수집을 포기하고 **수납 채널을 바꿉니다.**

- **비사업자 개인 요금표가 공식 게시**되어 있습니다. 비용안내 페이지가 '사업자'와 '**비사업자 개인**' 두 열로 나뉘어 있고, 구비서류 구분에 '개인판매자'가 따로 있으며 그 목록에 **사업자등록증이 없습니다**(계약서·신분증·통장사본만).
- `openpaytype=vbank`로 고정하면 청구건마다 **전용 가상계좌**가 발급됩니다. 회원은 지금과 똑같이 "계좌이체"를 하는데, **그 계좌에 돈이 들어오는 순간 누구의 어느 청구인지 100% 확정**됩니다.
- 웹훅(`feedbackurl`) 페이로드에 `var1`(회원ID) · `var2`(세션ID) · `mul_no`(멱등키) · `price` · `pay_date` · `depositor`가 실려 옵니다. → **입금자명 파싱·동명이인·닉네임 문제가 설계 단계에서 소멸합니다.**
- **건당 220원 정액**, 유지비 0원. 월 40건이면 8,800원. 금액에 비례하지 않아 대관비처럼 금액 큰 건에서 압도적으로 유리합니다.
- 인증수단 불필요(공동인증서·계좌비밀번호·주민번호 전부 없음). 은행도 안 바꾸고 회원 습관도 안 바꿉니다. 이미 쓰는 Supabase Edge Function에 수신 엔드포인트 하나면 붙습니다.

**미확인 리스크 — 도입 전 반드시 전화 확인**: PG는 재화·용역 제공을 전제로 설계돼 있는데 '동호회 회비'가 업종심사를 어떻게 통과할지 확인 못 했습니다("불가업종의 경우 결제가 취소될 수 있습니다"라는 문구가 있음). 그 외 정산이 D+5라 즉시 입금이 아니고, 비사업자 개인 명의로 연 수백만원 매출이 잡히면 사업소득 오인 소지가 있습니다 → ③번과 묶으면 해결됩니다.

### ② 안드로이드 알림 리스너 → 웹훅 — 월 0원, 은행 안 바꿈

예비폰에 토스 로그인 → `NotificationListenerService`가 입금 푸시를 잡아 Edge Function으로 POST. 본인 기기에서 본인 알림을 읽는 것이라 스크래핑도 아니고 약관 리스크가 사실상 없습니다. 직접 짜도 100~200줄이고, `pppscn/SmsForwarder`(★27.5k) 같은 오픈소스 APK로 대체 가능합니다.

**단, 검증되지 않은 전제가 하나 있습니다 — 토스 입금 푸시 본문에 입금자명이 실제로 들어가는지.** 토스 FAQ가 전부 JS 렌더링이라 공식 확인에 실패했습니다. 간접 근거는 상용 서비스 RTPay가 토스뱅크를 지원 은행으로 명시하고 입금자명 기반 매칭을 한다는 것뿐입니다. 그 외 약점: 상시 켜둘 폰 필요, 앱 업데이트로 문구 포맷이 바뀌면 정규식이 **조용히** 깨짐, 동명이인+동일금액 구분 불가.

### ③ 고유번호증 발급 — 무료, 자동화와 무관하게 이득

사업자등록이 **아닙니다**. 세무서에서 회칙·대표자 선임 증빙으로 신청하면 발급되고, 수익사업이 없는 한 부가세·소득세 의무가 생기지 않습니다.

- 단체 명의 통장이 가능해져 **공금이 총무 개인 명의에서 분리**됩니다(압류·사망·인수인계 리스크 제거).
- 금융결제원 CMS 이용안내 PDF가 이용대상에 *"(고유번호증을 득한)임의단체"*를 명시하고, 첨부서류도 *"사업자등록증(고유번호증) 사본"*입니다. 즉 사업자등록 없이 제도권 자동이체(회원 계좌에서 직접 출금 → 출금 결과 파일이 곧 '누가 냈나' 데이터)가 열립니다. 다만 **월 4만원 고정비 + 현장실사 + 회원 전원 출금동의**라 지금 규모엔 과합니다. 회원 100명 넘어가면 1순위로 꺼낼 카드.
- **주의: 고유번호증으로도 오픈뱅킹은 안 열립니다.** 법인도 개인사업자도 아니라서요.

---

## 3. 지금 뭘 하면 되는지

**1순위 (오늘, 30분)** — MacroDroid 설치해서 토스 입금 푸시 본문을 실측하세요. 트리거 '알림 수신'(앱: 토스) → 동작 'HTTP Request'로 아무 엔드포인트에나 쏴보면 입금자명이 들어오는지 즉시 압니다. ②번의 성립 여부가 여기 하나에 달려 있고, 30분이면 끝납니다.

**2순위 (이번 주)** — PayApp(1800-3772)에 "비사업자 개인 / 동호회 회비 수납 / 가상계좌"로 가입 및 업종심사 가능 여부를 물어보세요. 무료고, 이 답변 하나로 ①번이 확정되거나 탈락합니다.

**3순위 (병행)** — 고유번호증. 자동화 결과와 무관하게 해두는 게 이득입니다.

**어느 쪽을 고르든 먼저 해두면 좋은 것**: 입금자명 규칙화(`홍길동07`처럼 회원번호 2자리 붙이기). 어떤 수집 기술을 쓰든 마지막에 남는 병목은 '식별'인데, 이건 기술이 아니라 규칙으로 푸는 게 맞습니다. ①번을 도입하면 필요 없어지지만, ②번으로 갈 경우 최대 약점(동명이인·금액중복)을 공짜로 메워줍니다.

---

## 4. 기존 배관과의 관계

지금 만들어둔 `Gmail → Apps Script → ingest-bank-email → bank_transactions` 파이프라인은 **어느 경로를 골라도 버리지 않습니다.** `bank_transactions` 멱등 적재와 `dedup_key` 설계가 그대로 재사용되고, 바뀌는 건 `toss.ts` 자리에 어댑터를 하나 더 붙이는 정도입니다. PayApp이면 `mul_no`가 `dedup_key`가 되고 `var1`이 `paid_by`로 바로 꽂힙니다.

참고로 **카카오뱅크로 옮기는 안**도 검토했는데(암호걸린 xlsx를 이메일로 발송해줘서 현재 Gmail 배관에 그대로 꽂힘), 정기·예약 발송 옵션이 없어서 **여전히 매번 사람이 앱에서 버튼을 눌러야 합니다.** 지금과 본질적으로 같아서, 통장을 옮기는 비용 대비 얻는 게 없습니다.

---

조사 6개 레인 중 '기성 SaaS' 레인은 에이전트가 API 오류로 죽었지만, 완결성 검토 단계에서 네이버 밴드·스포츠 동호회 SaaS·스마트스토어·PG를 다시 훑어 대부분 커버됐습니다(그 과정에서 PayApp이 나왔습니다). 미확인으로 남긴 항목은 위에 전부 표시했고, 추측으로 메우지 않았습니다.

---

## #107

**Prompt**: payapp 은 수수료 나가잖아 공짜는 없지?

**Answer**: 네, 공짜 아닙니다. 그리고 **제가 앞서 든 비용 예시가 실제와 5배 어긋났습니다.** 실측값으로 다시 계산합니다.

## 실제 규모 (프로덕션 조회)

[코드 블록 생략]

회원 149명, **월 입금 150~216건**, 건당 평균 6,600~8,500원. 부과 단가는 회비 5,000원 · 대관비 약 6,000원.

제가 "월 40건 → 8,800원"이라고 쓴 건 리서치 에이전트가 잡은 가정치였고, 실제는 그 5배입니다.

## 실제 수수료

| 방식 | 계산 | 월 비용 | 연간 | 실효율 |
|---|---|---|---|---|
| 가상계좌 220원 정액 | 216건 × 220원 | **47,520원** | 약 57만원 | 2.6% |
| 계좌이체 2.3% | 183만원 × 2.3% | **42,114원** | 약 50만원 | 2.3% |
| 카드·간편결제 4.0% | 183만원 × 4.0% | 73,241원 | 약 88만원 | 4.0% |

여기에 초기등록비 12만원(현재 무료이벤트, 예고 없이 종료 가능)과 정산 D+5(돈이 5영업일 묶임)가 붙습니다.

**그리고 제가 "220원 정액이 압도적으로 싸다"고 한 근거가 이 모임에선 거꾸로 뒤집힙니다.** 정액 수수료는 건당 금액이 클 때 이기는 구조인데, 여기는 회비 5,000원 · 대관비 6,000원짜리를 216번 걷습니다. 5,000원에 220원이면 **4.4%** — 비율제 계좌이체(115원)보다 두 배 비쌉니다.

## 진짜 0원은 ②번뿐인데, 그것도 공짜는 아닙니다

안드로이드 알림 리스너는 현금 지출이 진짜 0원입니다. 대신 비용이 **다른 형태로** 나갑니다 — 상시 켜둘 폰, 토스가 알림 문구를 바꾸면 조용히 깨지는 파서, 그리고 월 216건 중 동명이인·동일금액 건의 수작업 확인. 월 4만원을 아끼는 대가로 "언제 깨질지 모르는 배관"을 떠안는 거래입니다.

## 그런데 진짜 지렛대는 수수료율이 아니라 건수입니다

**월 216건이라는 숫자 자체가 비용의 원인입니다.** 세션마다 대관비를 따로 걷는 구조 때문인데, 이걸 분기 예치금 충전으로 바꾸면(자체 앱에서 세션마다 차감) 그림이 통째로 바뀝니다.

| | 지금 (건당 부과) | 예치금 전환 (분기 3만원 충전) |
|---|---|---|
| 월 입금 건수 | 216건 | 약 30건 |
| 건당 금액 | 5,000~6,000원 | 30,000원 |
| PayApp 가상계좌 | 47,520원/월 (4.4%) | **6,600원/월 (0.7%)** |

즉 **예치금 전환과 가상계좌 정액 수수료는 서로를 강화합니다.** 지금 구조 그대로 PayApp을 붙이면 최악의 조합이고, 건수를 줄이면 같은 서비스가 최선의 조합이 됩니다. 게다가 건수가 1/10로 떨어지면 자동화가 실패했을 때의 대가도 작아져서, 최악의 경우 손입력으로도 버틸 수 있습니다.

## 정리하면

- 순수 비용만 보면 **②번(알림 리스너)이 유일한 0원**입니다. 앞서 말한 대로 토스 푸시에 입금자명이 들어가는지 30분 실측이 선행 조건이고, 이게 확인되면 월 4만원을 아낍니다.
- PayApp은 **지금 구조로는 권하기 어렵습니다.** 연 50~57만원은 이 모임 연 예산(약 1,600만원)의 3%대이고, 매칭 문제 해결값으로는 비쌉니다.
- **먼저 볼 것은 예치금 전환입니다.** 비용 0원이고, 어떤 자동화를 고르든 그 위에서 전부 유리해집니다. 대신 "돈을 미리 맡기는" 신뢰 문제와 중도 탈퇴 환불 규칙을 만들어야 하는데, 그건 기술이 아니라 회칙 문제라 운영진 합의가 필요합니다.

앞 답변에서 PayApp을 1순위로 올린 근거(건당 220원이 싸다)는 실제 거래 규모에서 성립하지 않습니다. 실측 기준 우선순위는 **예치금 전환 → 알림 리스너 실측 → (건수 줄인 뒤에) PayApp 재검토** 순입니다.

---

## #108

**Prompt**: 내폰이 안드면 하겠는데 아이폰이라

**Answer**: 웹 검색 예산이 소진(200/200)돼서 토스 SMS 여부는 확인하지 못했습니다. 토스 FAQ는 JS 렌더링이라 직접 페치도 빈 응답입니다. 다만 이건 **본인이 2분이면 확인 가능**합니다 — 토스 앱 → 전체 → 알림 설정에 '문자' 옵션이 있는지. 그 답에 따라 아래 B안이 성립하거나 탈락합니다.

## 아이폰 제약이 실제로 막는 것

`NotificationListenerService`에 대응하는 API가 iOS에 없습니다. 단축어로 읽을 수 있는 건 **문자(SMS)뿐**이고, 앱 푸시는 원천 불가입니다. 그래서 아이폰을 유지하면 선택지가 이렇게 갈립니다.

## A. 중고 안드로이드 공기계 — 권장

**아이폰 제약이 이 안을 막지 못합니다.** 오히려 원래 이게 더 나은 구조입니다.

- 개통 불필요, WiFi만 되면 됩니다. 당근에서 3~5만원.
- **PayApp 수수료 한 달치(4.7만원)면 삽니다.** 일회성 3만원 vs 매월 4.7만원 — 비교가 안 됩니다.
- 본인 아이폰은 그대로 둡니다. 범용 자동화 앱에 알림 접근 권한을 주면 그 폰의 **모든 앱 알림**을 그 앱이 보게 되는데, 전용 공기계면 이 문제가 사라집니다. 개인폰에 넣는 것보다 안전합니다.
- 24시간 상시 가동이라 신뢰성도 iOS 단축어보다 명확히 위입니다.

**이 안의 유일한 실제 리스크는 토스 동시 로그인입니다.** 공기계에 토스를 로그인했을 때 메인 아이폰이 밀려나면 곤란해집니다. 커뮤니티에 '토스뱅크 최대 2대'라는 답변이 있으나 공식 확인은 실패했습니다. **공기계 구하면 로그인 한 번으로 즉시 알 수 있습니다** — 이게 사기 전에 알 수 없는 유일한 변수라, 집이나 지인 중 노는 안드로이드 폰이 있으면 그걸로 먼저 시험해보는 게 좋습니다.

(참고: 안 쓰는 **아이폰**이 있어도 소용없습니다. 반드시 안드로이드여야 합니다.)

## B. 아이폰만으로 = SMS 경로

- iOS 단축어 → 자동화 → 개인용 → '메시지' 트리거(발신번호 + 포함 문구 지정) → 'URL의 콘텐츠 가져오기'로 Edge Function에 POST. **코딩 0줄.**
- 성립 조건이 은행이 SMS를 보내주는 것인데, 토스는 미확인이고 **카카오뱅크는 공식 문서로 확인됩니다** — 앱푸시·알림톡 무료, SMS 월 900원 정액. 토스에 문자 옵션이 없으면 통장 이전이 전제가 됩니다.

**다만 월 216건 규모에는 권하기 어렵습니다.** 'Run Immediately'를 켜면 Apple이 실행 알림을 강제해서 입금마다 배너가 뜹니다 — 월 216번입니다. 그리고 잠금·저전력 모드·재부팅 직후 자동화가 건너뛰는 사례가 보고돼 있는데, **몇 건이 조용히 새도 감지할 방법이 없다는 게 진짜 문제**입니다. 216건 중 3건 누락을 월말에 발견하면 그걸 찾는 게 더 큰 일입니다.

## C. 아이폰 제약 때문에 오히려 올라오는 선택지

앞서 말한 예치금 전환이 여기서 상대적으로 더 매력적입니다. 월 216건 → 30건이 되면:

- iOS 단축어가 몇 건 새도 **눈으로 잡힙니다** (하루 1건 수준)
- PayApp 가상계좌도 6,600원/월로 떨어집니다
- 최악의 경우 손입력으로도 버팁니다

즉 아이폰이라 자동화 신뢰성이 떨어진다면, **자동화를 정교하게 만드는 대신 자동화가 감당할 문제 크기를 줄이는** 쪽이 합리적입니다.

## 순서

1. **(2분)** 토스 앱 알림 설정에 '문자' 있는지 확인 → B안 성립 여부 판정
2. **(무료)** 집·지인 중 안 쓰는 안드로이드 폰 수소문. 있으면 거기에 토스 로그인해서 **아이폰이 밀려나는지** 확인 — A안의 유일한 변수
3. **(30분)** 그 폰에 MacroDroid 깔고 입금 푸시 본문에 **입금자명이 실제로 들어오는지** 실측
4. 3번이 확인되면 A안 확정(공기계 3~5만원). 안 되면 C안(예치금 전환)으로 문제 크기부터 줄이기

3번이 안 되면 A·B 둘 다 무너지므로, 공기계를 사기 전에 반드시 먼저 확인하세요.

---

## #109

**Prompt**: [api_client] GET http://10.10.2.171:9876/health 실패: [Errno 65] No route to host
이거 회사만 오면 안되네. "회사"일때만 안되는 이유가 있을까.

**Answer**: 네, 이유가 있습니다. **회사에서만 그 IP가 "로컬 네트워크"로 분류되기 때문**입니다.

## 왜 회사에서만인가

macOS의 **로컬 네트워크 권한 게이트는 "목적지가 지금 붙어 있는 서브넷 안일 때만"** 작동합니다.

| | 맥의 위치 | `10.10.2.171`의 성격 | 게이트 |
|---|---|---|---|
| **회사** | `10.10.0.44/16` (en0, GW 10.10.0.1) | **같은 서브넷** — traceroute 1홉 | **발동 → 차단** |
| **집/외부** | 다른 대역 | Tailscale이 광고하는 `10.10/16`(utun5)로 가는 **원격** 주소 | 미적용 → 정상 |

즉 네트워크가 나빠진 게 아니라, 회사에 오는 순간 같은 주소가 "원격"에서 "로컬"로 성격이 바뀌면서 OS 권한 검사 구간에 들어갑니다.

## 실측 증거 (같은 셸, 같은 초)

[코드 블록 생략]
커널 라우팅은 프로세스마다 다를 수 없으므로 이 동시 불일치가 결정적입니다. 게다가 같은 python3으로:

- 게이트웨이 `10.10.0.1:9999` → **errno 61을 1.01초 걸려** 반환 (패킷이 실제로 왕복 — 라우터는 면제 대상)
- 다른 온링크 피어(`10.10.0.171`, `10.10.0.19`) → **전부 errno 65 즉시**
- Tailscale `100.64.0.4:22` OK, 인터넷 `8.8.8.8:53` OK

"라우터만 통과, 나머지 같은 서브넷 피어는 전부 즉시 실패" — macOS 로컬 네트워크 게이트의 정확한 지문입니다. 소스를 utun5로 바꿔 붙여도 똑같이 실패하니 **Tailscale로 우회도 안 됩니다**(판정 기준이 인터페이스가 아니라 목적지 주소라서).

배제한 것: 프록시(시스템·셸·env 전부 없음), Little Snitch류 필터(미설치), Tailscale 라우트 충돌(양쪽 경로 다 200), 서버 다운(`{"status":"ok","profile_count":4}` 응답 중).

## 처방

**시스템 설정 → 개인정보 보호 및 보안 → 로컬 네트워크 → `Orca` 켜기** (이번 문제 앱은 Orca.app입니다. `NSLocalNetworkUsageDescription`이 선언돼 있어 목록에 뜹니다. 예전엔 Ghostty/VS Code였고, 앱 업데이트 후 권한이 풀려 재발합니다.) 켠 뒤 **⌘Q로 완전 종료 후 재실행**.

확인은 이 한 줄로 — 조용히 끝나면 성공:
[코드 블록 생략]

⚠️ **ping은 이제 판별에 쓰지 마세요.** 예전 메모의 "ping은 되는데 curl만 실패" 기준이 깨졌습니다 — 지금 그 호스트가 ICMP echo를 막고 있어 회사에서 ping은 100% loss인데 TCP/UDP는 정상입니다(traceroute는 1홉 도달).

**영구 회피책**: `api_url`을 그 호스트의 Tailscale 주소(100.64.x.x 또는 MagicDNS 이름)로 바꾸면 목적지가 로컬 서브넷이 아니게 되어 회사·집 어디서든 게이트를 안 탑니다. 다만 `10.10.2.171`이 어느 노드인지는 특정 못 했습니다 — dtserver2(`100.64.0.4:9876`)는 refused라 아니고, MAC이 랜덤(프라이빗 Wi-Fi 주소)이라 노트북 계열로 보입니다. 어느 기기인지 알려주시면 그 주소로 바꿔드리겠습니다.

메모리(`cm-api-server-unreachable.md`)는 "회사에서만" 메커니즘과 새 판별법으로 갱신해 뒀습니다.

---

## #110

**Prompt**: TODO 보고 처리하고 해결되면 푸쉬배포해

**Answer**: TODO 두 건 처리하고 배포까지 끝냈습니다.

## ② 비활성 회원 부과 — 원인이 두 갈래였습니다

**"이한비"는 비활성 회원이 아니라 회원 행이 삭제된 사람이었습니다.** `members`에 이름이 없고, `session_players` 4개 세션(7/10·7/13·7/26 등)에 `player_id`(옛 uuid)만 남고 `member_id`가 null — 같은 세션 다른 사람은 전원 채워져 있으니 FK `on delete set null` 흔적입니다. 하드삭제가 `dues_charges`·`dues_allocations`를 CASCADE로 지우고 `bank_transactions.paid_by`를 SET NULL 해서, **말씀하신 7월 두 건**(id 2 = 7/12 `7월회비 이한비` 5,000 / id 8958 = 7/26 `0726이한비` 6,000)이 붙을 부과 없이 미분류로 남아 있었습니다.

조치:
- **하드삭제 봉인** — `delete_my_account`를 소프트 탈퇴로(회원 행·이름·부과 보존, 로그인·개인정보·푸시만 정리, 예정 세션 참석은 정식 취소 경로로). RLS `members_delete` 정책과 DELETE 권한도 회수 — RPC는 막혀 있었는데 정책이 열려 클라이언트 직접 DELETE가 나갔습니다.
- **이한비 님 복구** — 옛 uuid로 회원 행(비활성) + 보드 이력 재연결 + 2026-07 회비 5,000 / 세션 108 대관비 6,000 재생성(세션 108은 정액 모드라 다른 사람 금액 불변). **정산함 2026-07에서 그 입금 2건 납부자만 지정하면 7월이 닫힙니다.**
- **자동 면제 트리거 폐지 + 11건 원복** — 8/18 트리거의 전제("정지된 달 참석 없음")가 거짓이었습니다(홍예린 7/20 실제 참석). 홍예린 7월 + 8월 10건 모두 미납으로 되살렸습니다.
- **말씀대로 `dues_generate_monthly`에서 `is_active` 제거** — 비활성 회원도 부과 대상입니다. 대신 자동으로 돈을 지우는 경로를 없앴으니, 회비 현황 미납 명단에 **[면제]**, 면제된 건에 **[되돌리기]**를 넣었습니다(부분납 행은 면제 불가 — 대사취소 시 잔액이 조용히 사라지는 구멍이 있어 막았습니다).

⚠️ **9월 월진입부터 비활성 14~15명에게도 회비 5,000원이 생깁니다.** 걷지 않을 분은 [면제] 한 번이면 되지만 매달 손이 많이 가면 종료월(`membership_ended_at`)로 좁히면 됩니다 — 룰 WHERE 한 줄입니다.

## ① 게스트 정리 — 코드 3종

실측: 게스트 47행 = 실인원 30명(잉여 17). **미납 대관비는 0원**이라 돈 문제가 아니라 정산함 납부자 후보 오염이었고, 회원관리는 게스트를 아예 안 보여줘 손댈 방법이 없었습니다.

- `add_guest_attendance`가 이름(NFC+공백제거)+성별 같은 기존 행을 **재사용** → 증가 정지. 같은 세션 중복은 차단하되, 다른 회원이 먼저 신청한 경우는 예외를 갈라 "동명이인이면 이름을 구분해 주세요"로 안내(막다른 길 방지). 재사용 시 grade는 최신 입력이 이깁니다.
- 정산함 후보 위생 — 동명 그룹은 실제 회원 우선·게스트 대표 1행, 미납 보유자와 예정 세션 참석자는 접지 않음(선납 오배분 방지).
- 회원관리 **'게스트 N명 보기'** 칩 + 게스트 배지, 회원 전용 액션 숨김.

기존 47행 병합은 안 했습니다 — 같은 세션 중복이 `attendances` PK와 충돌하고 공개회계 귀속이 움직여서, TODO.md에 판단 필요 항목으로 남겼습니다.

## 검증·배포

마이그레이션 4건은 프로덕션에서 `begin; … rollback;`으로 먼저 실증한 뒤 적용했습니다. tsc 클린 · 테스트 342개 통과 · eslint는 변경 전과 동일(기존 8건). `git push` → GitHub Pages 배포 성공(live 번들에 새 문구 확인), `supabase db push` 4건 적용 후 프로덕션 상태 확인 완료.

---

## #111

**Prompt**: 비활성 유저는 회비부과생성을 안해야하는데 이게 전의 명령이랑 상충하는구나. 기본적으로 회비부과생성을 안하는거고, 이미 정산처리된게 취소되는게 문제인걸로 다시 파악해봐

**Answer**: 맞습니다 — 제가 민원을 **부과 생성 룰** 문제로 잘못 읽었습니다. 정정해서 배포했습니다.

## 감사 로그가 확정해 준 실제 원인

`dues_audit_log`를 보니 이한비 님 건은 **이미 정산처리가 끝났던 기록**이었습니다:

| 시각 | 액션 | 내용 |
|---|---|---|
| 7/13 10:20 | `confirm_new_monthly` | 2026-07 회비 부과 생성 (charge 119) |
| 7/13 13:16 | `confirm_match` | 입금 5,000(bank_tx 2) **배분 완료** |
| 7/26 11:07 | `confirm_reconcile` | 대관비 6,000(bank_tx 8958) **배분 완료** (charge 1022) |

그 뒤 members 행이 하드삭제되면서 charge 119·1022와 배분이 CASCADE로 사라지고 `paid_by`가 SET NULL → **두 입금이 미분류로 되돌아간 것**이 "7월 정산이 풀림"의 정체였습니다. 홍예린 님 건도 같은 부류입니다 — 이미 마감한 7월의 미납 명단·진행률을 자동 면제가 사후에 바꿨습니다.

즉 **부과 자격과는 무관한 사고**였고, 그 두 원인(하드삭제 경로 봉인 · 자동 면제 트리거 폐지)은 어제 배포에서 이미 제거된 상태입니다. 과잉이었던 생성 룰 변경만 되돌렸습니다.

## 확정된 정책 3줄

- **명단 기반 자동 생성은 활성 회원만** — `dues_generate_monthly`에 `is_active` 복원. 나간 사람에게 영구 미납이 쌓이지 않습니다. (프로덕션 dry-run: 9월 진입 시 81건 생성, 비활성 0건)
- **이미 생긴 부과는 자동으로 지우지 않는다** — 트리거·CASCADE 둘 다 봉인 유지. 걷지 않을 건은 [면제]로 사람이 판단.
- **돈이 들어오면 붙일 자리는 만든다** — `dues_confirm_reconcile`은 명단 자격을 안 봅니다(그대로 유지). 비활성 회원이 뒤늦게 낼 때 정산할 길이 여기뿐입니다.

## 지금 상태

- 오늘 아침 이한비 님 입금 2건 다시 배분하신 것 확인했습니다 — charge 1472/1473 모두 `paid`, 입금 2건 `matched`. **7월 닫혔습니다.**
- 어제 되살린 미납 11건(홍예린 7월 1 + 8월 10)은 **그대로 뒀습니다.** 되살린 기록을 다시 조용히 지우는 건 위 두 번째 원칙에 어긋나서요. 홍예린 님은 7/20 실제 참석자라 낼 돈이 맞고, 8월 10명은 정지된 달에 참석 이력이 없으니 걷지 않기로 하시면 [면제] 버튼으로 정리하시면 됩니다. 원하시면 10건 한 번에 면제하는 마이그레이션으로 처리해 드리겠습니다.
- 문서: ACCOUNTING_SPEC §1.1·§4에 "생성 제외 ≠ 사후 삭제" 구분을 명시했고, EXPANSION_SPEC의 `members.is_active` 절과 TODO 3번도 맞췄습니다.

배포: `git push` → Pages 성공, `supabase db push` 적용 후 프로덕션 함수 정의 확인 완료.

---

## #112

**Prompt**: 되살린 미납건들은 규칙대로 처리해야지

**Answer**: 규칙대로 정리했습니다.

## 규칙을 반만 적용한 게 문제였습니다

"비활성 회원은 회비 부과 대상이 아니다"를 **생성에만** 적용하고 이미 생성된 미납은 남겨 뒀는데, 그러면 미납 현황에 영구히 쌓입니다(운영진이 매번 손으로 지우던 그 상태). 선례도 회비 안에 있었습니다 — **명예회원 지정(`dues_set_honorary`)도 자격이 사라지는 순간 이미 생성된 미납을 정리**합니다. 정지도 자격 상실이니 같은 취급이 맞습니다.

그래서 트리거를 복원했습니다. 어제 폐지 근거로 든 "홍예린 님이 7/20 실제 참석했는데 면제됐다"는 반례가 못 됩니다 — **회비는 참석 대가가 아니라 월 회원비**입니다(참석 대가는 대관비). 7월 정산이 풀린 진짜 원인은 하드삭제 CASCADE였고 그건 어제 별도로 봉인했습니다.

## 처리 결과 (프로덕션 확인)

| 항목 | 결과 |
|---|---|
| 비활성 회원 미납 회비 | **0건** — 잔재 11건(2026-07 홍예린 1 + 2026-08 10명) 면제 처리 |
| 활성 회원 미납 | **그대로 유지** — 강하진 2026-06 · 박병훈 2026-07 · 김지훈 2026-08(이월중) |
| 이한비 님 납부분 | 무영향 (회비·대관비 둘 다 `paid`) |
| 트리거 | 복원·활성 |
| 감사 로그 | `waive_dues_inactive_members_sweep` 11건 (charge id·period_ym 포함) |

## 8/18 버전보다 고친 두 가지

- **`deferred_to` 가드** — 이월 중인 건이 `waived`가 되면 이월 목록에서 "정산 완료"처럼 보이는 오표기가 생깁니다(8/18 버전에 있던 구멍). 김지훈 님 8월분이 실제로 이월 중이어서 이번 정리에서 제외됐습니다.
- **감사 로그에 charge id·period_ym 기록** — 8/18 버전은 member와 건수만 남겨서 정확히 되돌릴 수 없었습니다(어제 원복할 때 백필 로그 items에 의존해야 했습니다).

그리고 이 규칙을 다시 켤 수 있게 된 전제는 **어제 넣은 [면제 N명] 목록 + [되돌리기]** 입니다. 자동 면제의 유일한 실제 위험은 "돈이 조용히 사라져 화면 어디에도 안 남는 것"이었고, 이제 그 목록이 감시 창 역할을 합니다 — 오면제가 보이면 거기서 되돌리시면 됩니다.

배포: `git push` → Pages 성공, `supabase db push` 적용 후 프로덕션 검증 완료. 문서(ACCOUNTING_SPEC §1.1·§3.1·§4, EXPANSION_SPEC, TODO)도 최종 정책으로 맞췄습니다.

---

## #113

**Prompt**: 면제리스트 나오는거 언제부터야? 이거 필요없어. 그고 면제가 아니고 회원 비활성으로 인한 미부과잖아

**Answer**: 면제 리스트는 **어제(8/19) 배포부터 하루 있었던 것**이고, 제거했습니다.

## 용어 지적이 정책을 바로잡았습니다

`waived`(면제)는 "낼 의무는 있는데 걷지 않기로 함"입니다. 그렇게 부르면 행을 남겨야 하고, 남긴 걸 보여주려고 [면제 N명] 목록과 [면제] 버튼까지 딸려옵니다 — 어제 제가 그 경로로 갔습니다. 정지된 회원은 부과 룰(`is_active`)상 **애초에 대상이 아니니** 걷지 않는 게 아니라 부과가 없는 것이고, 그러면 남길 행도 보여줄 목록도 없습니다.

이 저장소에 이미 그 기준이 있었습니다 — **명예회원 지정(`dues_set_honorary`)은 미납을 `delete`** 합니다. 그 마이그레이션이 delete/waived를 가른 기준이 바로 "애초에 낼 의무가 없음 vs 의무는 있는데 안 걷음"이었습니다. 정지는 앞쪽입니다.

## 바꾼 것

- **트리거 교체**: `trg_members_waive_dues_on_deactivate` → **`trg_members_uncharge_dues_on_deactivate`**. 미납 회비 행을 **삭제**합니다(가드 동일: `unpaid` + `amount_paid=0` + 이월 아님 → 납부·부분납·대관비·이월 중인 건·수동 처리분은 무영향).
- **어제 waived로 남긴 11건 삭제** — 대상은 어제 sweep 감사 로그의 charge id로만 특정해서, 수동 면제나 이월정산 waived는 건드리지 않았습니다.
- **회비 카드를 8/19 이전 모양으로 복귀** — 미납 명단 + [이월]만. 면제 칩·목록·버튼·확인 다이얼로그 전부 제거(live 번들에서 제거 확인).
- **감사 로그가 유일한 흔적**이라 charge id·period_ym·금액을 다 남깁니다(`uncharge_dues_on_deactivate`). 회비는 재생성 경로가 없어서 삭제가 안정적입니다 — 생성이 `is_active`를 보고, 월진입 ensure는 그 달 행이 하나라도 있으면 no-op입니다(대관비는 self-heal이 다시 만들어 `void` 봉인이 필요한 게 차이점).

## 프로덕션 확인

| 항목 | 결과 |
|---|---|
| 회비 `waived` 행 | **0건** |
| 비활성 회원 미납 회비 | **0건** (11건 삭제) |
| 활성 회원 미납 | 강하진 2026-06 · 박병훈 2026-07 · 김지훈 2026-08(이월중) — 그대로 |
| 7월 납부 | 69건 유지 (이한비 님 포함) |
| 트리거 | 신규 활성 / 옛 waive 트리거 제거 |

배포: Pages 성공, `supabase db push` 적용 완료. 문서(ACCOUNTING_SPEC §1.1·§3.1·§4, EXPANSION_SPEC, TODO)도 "미부과" 기준으로 맞췄고, 판단이 뒤집힌 경위도 기록으로 남겼습니다.

---

## #114

**Prompt**: 최근 경기 보고 팀 생성 밸런스가 어떻게 되는지 체크좀. 여기서 말하는 밸런스는 실력균형보단 특정 유저가 다른 사람을 아예 못만나고 만나는 사람만 만나는 경향이 있는지 체크하는거

**Answer**: 최근 4주(2026-07-23~08-19) 실경기 로그 **23세션 / 774경기**를 확보했고, 다각 감사를 백그라운드로 돌렸습니다.

먼저 데이터에서 바로 보이는 것 (실측, 세션 내부 기준):

| 날짜 | 인원 | 경기 | 평균 판수 | 고유 상대 | 못 만난 사람 | 최다동반 비율 |
|---|---|---|---|---|---|---|
| 08-19 | 15명 | 26 | 6.9 | 11.2 | 2.8명 | **0.61** |
| 08-18 | 27명 | 48 | 7.1 | 13.6 | 12.4명 | 0.49 |
| 08-17 | 19명 | 44 | 9.3 | 15.1 | 2.9명 | 0.47 |
| 08-11 | 25명 | 49 | 7.8 | 14.9 | 9.1명 | 0.49 |
| 08-04 | 24명 | 50 | 8.3 | 14.2 | 8.8명 | 0.49 |

"최다동반 비율"이 0.47~0.61 — **자기가 뛴 판의 절반 안팎을 특정 한 사람과 함께 뛰고 있다**는 뜻입니다. 이건 지난 세션 237 민원 감사 때 나온 0.47과 같은 수준이고, 그때 완전자동 시뮬은 3.18회(≈0.34)였습니다.

지금 돌아가는 감사(에이전트 11개):
- **A1** 세션 내 개인별 편중(판수 통제 후 편중 상위 인물 식별)
- **A2** 조건부 무작위 귀무모형 1000시드 — "무작위여도 이 정도 나오는가"
- **A3** 프로덕션 함수 그대로 쓰는 완전자동 시뮬 — 알고리즘 상한선
- **A4** 4주 누적 만남 그래프 — 공동참석했는데 한 번도 못 만난 쌍, 파벌 탐지
- **A5** 코드 감사 — 쌍(pair) 반복 억제 항이 실제로 존재하는지

각 결과는 적대적 검증자가 독립 재계산으로 반증 시도한 뒤 종합됩니다. 완료되면 보고하겠습니다.

---

## #115

**Prompt**: <task-notification>
<task-id>wlurdhjzv</task-id>
<tool-use-id>toolu_01TL7nV8oBgr6drB7DqY9Ct7</tool-use-id>
<output-file>/private/tmp/claude-501/-Users-sam-Projects-cocktime-scheduler/3f55537b-2550-4837-b3ff-af3d3ab4a607/tasks/wlurdhjzv.output</output-file>
<status>completed</status>
<summary>Dynamic workflow "최근 4주 실경기 로그로 "만나는 사람만 만나는" 편중(사회적 밸런스) 감사" completed</summary>
<result>{"synth":"모든 수치를 `data.json`에서 직접 재계산해 확정했습니다(스크립트: `/private/tmp/claude-501/-Users-sam-Projects-cocktime-scheduler/fb17b865-9b02-4f23-8b26-6ca7eccd463f/scratchpad/f_core.py`, `f_actual.py`, `f_null.py`, `f_null2.py`, `f_analyze.py`, `f_break.py`, `f_pairfix.py`, `f_cum.py`, `f_hz2.py`, `f_three.py`, `f_heavy.py`, `f_heavy.py`). 아래가 보고서 전문입니다.\n\n---\n\n# 팀 편성 \"만남 편중\" 감사 보고서\n**대상**: 2026-07-23 ~ 2026-08-19, 23개 세션 · 774경기 · 429 person-session · 95명\n**질문**: \"특정 유저가 어떤 사람은 아예 못 만나고, 만나는 사람만 계속 만나는가?\"\n\n---\n\n## 0. 한 줄 답\n\n&gt; **\"만나는 사람만 계속 만난다\"는 맞습니다. 단 크기는 작고(무작위 대비 +3.5%), 진짜 크기는 \"누적 편중\"이 아니라 \"방금 같이 뛴 사람과 바로 다음 판에 또\"에서 나옵니다.**\n&gt; **\"어떤 사람은 아예 못 만난다\"는 대부분 사실이 아닙니다.** 세션당 못 만나는 인원 수는 무작위 재배치와 통계적으로 동일합니다(6.28명 vs 6.37명). 다만 **4주 내내 만날 기회가 4~5판 있었는데 0회인 쌍이 3쌍** 실재하며, 이건 우연으로 설명되지 않습니다(우연 기대 0.43쌍).\n&gt; **그리고 가장 중요한 사실: 현재 편성은 \"무작위보다 나쁜\" 수준이 아니라, \"이미 있는 자동편성 알고리즘이 낼 수 있는 성적을 안 쓰고 있는\" 수준입니다.**\n\n---\n\n## 1. 먼저: 5개 분석의 수치 충돌 정리 (직접 재계산으로 확정)\n\n에이전트마다 다른 값을 낸 지표는 **전부 정의·집계단위·분모 차이**였습니다. 데이터가 틀린 건 없었습니다.\n\n| 지표 | 보고된 값들 | **확정값(직접 재계산)** | 불일치 원인 |\n|---|---|---|---|\n| 개인별 최다동반 **비율** | A1 0.528 / A2 0.546 / A4 0.310 | **0.5276**(person-session 풀링) · **0.5436**(세션평균) · **0.310**(4주 누적, 사람당) | 집계 단위가 다름. 셋 다 맞음 |\n| 개인별 최다동반 **횟수** | A1 3.66 / A2 3.66 | **3.662회** (본인 평균 7.2판 중) | — |\n| **b2b**(직전 경기 동반자 재등장) | A1 0.598 / A2 0.593 / A3 0.516 | **0.5976**(런북 §4c 정의, 풀링) · 세션평균 0.6203 · 세션237 **0.5086** | A2는 \"같은 코트 연속 잔류\"라는 **다른 지표**를 b2b라 부름. 런북 0.51은 세션237의 개인 정의값(내 계산 0.5086) |\n| 세션 내 미조우 인원 | A1 6.28 / A2 5.64 / A5 5.91 | **6.280명**(풀링) · **5.604명**(세션평균) | 집계 단위 |\n| 3회+ 동반쌍 | A1 17.3% / A2 14.4% / 런북 17.5% | **만난쌍 분모 17.3%** · **전체가능쌍 분모 11.5%** (세션237: 21.0% / **17.5%**) | 분모. **A1의 \"런북 17.5% 재현\"은 우연의 일치이며 오류** |\n| 4주 누적 미조우 쌍 | A2 561/2195 / A4 494/2076 | **494 / 2076 (23.8%)** — 동일인 이름 병합 기준 | 동일인이 키 2개로 분열(9명). 병합 안 하면 533/2152 |\n| 4주 누적 지니 | A2 0.565 / A4 0.565 | **0.5568**(병합) / 0.5616(미병합) | 위와 동일 |\n| 최다 누적 동반 쌍 | A4·A5 \"22회 남필립-손형일\" | **22회 동점 2쌍**: 엄지현-이지인, 남필립-손형일 | 동점 누락 |\n| 세션 내 최다동반 상대 vs 파트너 | A1 \"상대만 초과\" | **최다상대 0.4368 vs 기대 0.4068(+0.030) / 최다파트너 0.2477 vs 0.2526(tie)** — 방향은 맞으나 절반은 \"4인 그룹 반복\"이 흘러든 것 | — |\n\n**데이터 위생(직접 확인)**: 대상 23세션에서 `ended_at` 결측 0건, 팀 슬롯 결측 18건은 전부 \"1명만 비어 있음\"이라 복구가 결정적, 한 경기 안에 동명이인 0건 → 이름 기준 병합이 안전. **모든 에이전트의 실측 원천은 동일하고 신뢰 가능합니다.**\n\n---\n\n## 2. 확정 실측표 — 실측 vs 조건부 무작위\n\n**귀무모형(내가 독립 구현)**: 경기별 슬롯 성별·각 사람의 정확한 판수·출석 구간·동시 진행 경기 비중복을 전부 고정하고 **사람만 재배치**하는 제약보존 스왑 MCMC(세션당 200표본, burn-in 600×슬롯, 추출 간 120×슬롯). 혼합 8배 늘려도 값이 변하지 않음(수렴 확인). 등급은 고정하지 않음(실력 밴딩 자체가 원인 후보이므로).\n\n| 지표 (429 person-session 풀링) | 실측 | 조건부 무작위 | 차이 | t | 판정 |\n|---|---|---|---|---|---|\n| 최다동반 **비율** | **0.5276** | 0.5093 | **+0.0183** | +3.29 | 초과(작음) |\n| 최다동반 **횟수** | **3.662회** | 3.543회 | +0.119회 | — | 초과(작음) |\n| **b2b**(직전 동반자 재등장) | **0.5976** | 0.5466 | **+0.0510** | **+5.19** | **초과(최대)** |\n| 최다**상대**(상대팀) 비율 | 0.4368 | 0.4068 | +0.030 | ~5σ | 초과 |\n| 최다**파트너**(같은팀) 비율 | 0.2477 | 0.2526 | −0.005 | −1σ | **tie** |\n| 고유 동반자 수 | 12.578명 | 12.486명 | +0.09 | +1.59 | **tie** |\n| **미조우 인원** | **6.280명** | 6.372명 | −0.09 | — | **tie(실측이 근소 우위)** |\n| 동반 분포 HHI | 0.1075 | 0.1064 | +0.001 | 약함 | tie~미세초과 |\n| 상위3인 집중도 | 0.4215 | 0.4189 | +0.003 | 약함 | tie~미세초과 |\n| 3회+ 동반쌍(전체가능쌍) | 0.1499 | 0.1531 | −0.003 | — | **tie(실측 우수)** |\n| \"판수 절반 이상을 한 사람과\"(5판+ 392명) | **57.1%** | 51.2% ±2.9 | +5.9%p | +2.0 | 경계 |\n\n**세션 단위**: 최다동반 비율 실측 0.5436 vs 귀무 0.5250, 페어드 t=+2.22, **16/23 세션 초과, z≥2는 5세션**(07-25, 07-27, 08-03, 08-11, 08-19). b2b는 페어드 t=+3.22, **z≥2가 6세션**.\n\n**런북 대조(세션237)**: 최다동반 4.316회 / 비율 0.4670 / 고유상대 15.05명 / b2b 0.5086 / 3회+동반쌍 17.5% — **런북 기재치(4.32, 47%, 15.1, 0.51, 17.5%)와 완전 일치.** 방법론에 모순 없음.\n\n---\n\n## 3. 질문에 대한 직접 답\n\n### (A) \"만나는 사람만 계속 만나는가\" → **예. 단 체감의 정체가 다릅니다.**\n\n- 평균적인 참가자는 한 세션에서 **7.2판 중 3.66판을 같은 한 사람과** 뜁니다(판수의 52.8%).\n- 같은 조건(성별·판수·출석시간)에서 **사람을 완전히 무작위로 재배치해도 3.54판(50.9%)**입니다. **초과는 0.12판, 판수의 +1.8%p**.\n- 즉 \"저 사람이랑만 계속 뛰네\"는 **대부분 인원·코트·출석 구조가 만드는 산수**입니다. 7판 뛰면 21개 동반 슬롯인데 로스터는 19명 → 누군가와는 3~4번 겹칠 수밖에 없습니다.\n- **그런데 진짜 체감을 만드는 축은 따로 있습니다.** 본인의 연속 두 경기에 같은 사람이 1명 이상 남는 비율이 **59.8%(무작위 54.7%, t=+5.19)** — 전 지표 중 초과폭이 가장 크고 유일하게 강하게 유의합니다. 사람은 \"이번 세션 누적 4회\"를 세지 않습니다. **\"방금 같이 뛴 사람이 다음 판에 또 있네\"**를 셉니다.\n- 분포의 *모양*은 정상입니다(HHI·상위3인 집중도 tie, 3회+동반쌍은 오히려 무작위보다 낮음). **소수에게 전면적으로 몰리는 게 아니라, 꼭짓점(최다 1명)과 직후 재조우만 튑니다.**\n\n### (B) \"어떤 사람은 아예 못 만나는가\" → **총량으로는 아니오. 특정 쌍으로는 예.**\n\n- 세션당 \"같은 날 뛰었는데 한 번도 같은 코트에 안 선 사람\" = **6.28명**. 무작위 재배치는 **6.37명** → **알고리즘·운영이 만든 게 아닙니다.**\n- 미조우 쌍의 **97.4%는 출석 시간대가 겹쳐 만날 수 있었는데** 못 만났습니다. 그래도 무작위와 같다는 건, 이게 **선택의 결과가 아니라 슬롯 수 부족**이라는 뜻입니다.\n- 4주 누적으로도 마찬가지: 공동참석 2,076쌍 중 494쌍(23.8%)이 미조우이고, 이 총량은 조건부 무작위와 구분되지 않습니다(A4·A2 두 팀이 독립적으로 z=+0.36 / +0.83 확인).\n- **단, 예외가 3쌍 있습니다.** 4주 동안 \"조건부 기대 4회 이상\"인데 실측 0회:\n\n| 쌍 | 공동 세션 | 조건부 기대 | 실측 | 전부 0회일 확률 |\n|---|---|---|---|---|\n| 김주영–이규웅 | 4세션 | 4.69회 | **0회** | 0.4% |\n| 남필립–이규웅 | 4세션 | 4.56회 | **0회** | 0.7% |\n| 김지훈–손형일 | 3세션 | 4.31회 | **0회** | 0.8% |\n| (기대 3회+ 로 넓히면) 김길환–유성종 | 4세션 | 3.96회 | **0회** | 1.4% |\n\n&gt; 이런 쌍의 **귀무 기대 개수는 0.43쌍인데 실측 3쌍**입니다(Poisson p≈0.009). **\"아예 못 만나는 사람이 있다\"는 민원은 총량으로는 틀렸지만, 소수의 구체적 쌍에 대해서는 사실입니다.**\n&gt; 다만 이규웅이 낀 2쌍은 그의 6세션이 **전부 2026-07-23~07-28**로, 알고리즘 개편(07-27 팀매칭 개편, 07-29 skillDiff 제곱화) 이전/직후 구간입니다. 현행 알고리즘의 증거로 쓰기엔 부적절합니다.\n\n---\n\n## 4. 인물 사례 (판수·성별·출석시간 통제 후에도 살아남은 것만)\n\n세션 내 검정에서 **양쪽 판수 8판 이상**인 1,330쌍 중 p≤0.01이 **13건**(경험적 오탐 기대 5.2건, 2.5배). 전체 3,984쌍 기준으로는 **33건 vs 12.4건(2.7배)**. 4주 누적으로는 179쌍을 검정해 **BH(q=0.05) 생존 2쌍**.\n\n| # | 사례 | 실측 | 조건부 기대 | 배수/p | 성격 |\n|---|---|---|---|---|---|\n| 1 | **송유현 × 최두호** (누적 3세션) | 14회 | 5.7회 | **2.46배, p&lt;0.0001** (BH 생존) | 4주 통틀어 가장 강한 고착 |\n| 2 | **이수민 × 표슬아** (누적 4세션) | 19회 | 11.8회 | **1.61배, p=0.0005** (BH 생존). 08-03에는 **각자 9판 중 8판을 같은 코트, 그중 7판이 서로 상대팀**(p=0.005) | 세션·누적 모두 유의 |\n| 3 | **김주영 × 정성균** (08-12 sid56) | 6회 | 2.56회 | **p&lt;0.005**, 각자 10판, **6회 전부 상대팀** | 단일 세션 최강 신호 |\n| 4 | **이규웅** | 김주영(4세션 동석, 기대 4.69)·남필립(기대 4.56)과 **각각 0회**. 반대로 같은 07-27 세션에서 이지인과 5회(기대 1.55, p=0.005) | — | \"못 만남\"과 \"몰림\"을 동시에 가진 유일 사례 |\n| 5 | **고수지 / 최양회** (반대편) | 최다동반 비율 실측 0.492 / 0.451, 기대 0.557 / 0.497 | t = −2.67 / −2.76 | 같은 알고리즘 아래서도 **다양성이 오히려 좋은 사람**이 존재 |\n\n**개인 단위로는 아무도 \"확정\"되지 않습니다.** 5세션+·누적 35판+ 후보 36명 중 |t|≥2가 5명(유용환 +2.88, 이규웅 +2.53, 장세훈 +2.27 / 고수지 −2.67, 최양회 −2.76)인데, **다중검정(BH q=0.05) 생존자는 0명**입니다. A1의 \"유용환만 유의\"와 A2의 \"7명 편중, 반대편 0명\"은 둘 다 지지되지 않습니다(고수지의 |t|가 유용환보다 큽니다).\n\n**반증된 유명 사례** — 보고서에서 빼야 할 것:\n\n| 사례 | 원 주장 | 재계산 결과 |\n|---|---|---|\n| 남필립 × 손형일 22회 | \"10배 차이가 교정 안 됨\"(A5) | 조건부 기대 18.2회, **1.21배** — 사실상 기대치 |\n| 엄지현 × 이지인 22회 | (동점인데 누락됨) | 기대 21.1회, **1.04배** — 완전히 기대치 |\n| 박현아 × 김선예 \"6회 전부 상대팀\" | 극단 편중(A1) | 08-02 기대 **6.95회, p=1.00**. 여성 소수 로스터에서 **혼복은 팀당 1남1녀라 여성 둘은 구조적으로 같은 팀이 될 수 없음** → \"전부 상대팀\"은 정보량 0 |\n\n---\n\n## 5. 원인 분해 — 구조 / 알고리즘 / 운영\n\n프로덕션 함수를 그대로 호출한 완전자동 하네스(A3, 1000시드; 검증팀이 재실행해 재현 확인)가 있는 3개 세션에서, **네 지점을 한 축에 놓으면** 분해가 됩니다.\n\n**개인별 최다동반 횟수 (낮을수록 다양)**\n\n| 세션 | 이론 하한 | 완전자동 | 조건부 무작위 | 실측 |\n|---|---|---|---|---|\n| 08-17 (19명·3코트·44경기) | 1.54 | **3.30** | 4.09 | **4.32** |\n| 08-18 (27명·4코트·48경기) | 0.82 | **2.42** | 3.10 | **3.22** |\n| 08-19 (15명·2코트·26경기) | 1.49 | **3.16** | 3.65 | **4.27** |\n\n**기여 분해 (실측 − 하한 = 100%)**\n\n| 구간 | 의미 | 08-17 | 08-18 | 08-19 | **평균** |\n|---|---|---|---|---|---|\n| 하한 → 완전자동 | **구조적 제약**(인원 대비 코트 수·성별 구성·출석 시간대) | 63% | 67% | 60% | **≈63%** |\n| 완전자동 → 무작위 | **알고리즘을 안 쓴 몫**(추천 순위를 따르지 않아 못 얻은 다양성) | 28% | 29% | 18% | **≈25%** |\n| 무작위 → 실측 | **무작위보다 나쁜 몫**(수동 개입·휴식·즉흥 배치의 합) | 8% | 5% | 22% | **≈12%** |\n\n**해석**\n\n1. **구조가 압도적(≈63%)입니다.** 7판 × 3명 = 21개 동반 슬롯으로 18~26명을 덮을 수 없습니다. 어떤 알고리즘도 못 고칩니다. 여성 편중도 여기 속합니다 — 여성 실측 최다동반 비율 0.567 vs 남성 0.511이지만, **무작위 대비 초과분은 +0.0185 vs +0.0183으로 동일**합니다. 즉 여성이 느끼는 편중은 인원 풀이 작은 결과이지 알고리즘의 성별 편향이 아닙니다(W_GENDER 50 귀속은 근거 없음).\n2. **두 번째로 큰 몫(≈25%)은 \"알고리즘이 나빠서\"가 아니라 \"알고리즘을 안 써서\"입니다.** 완전자동은 무작위보다 최다동반을 0.49~0.79회 낮추고, **동시에 판수 형평(std 1.33→0.57)과 실력 
... (truncated 20007 chars, full result in /private/tmp/claude-501/-Users-sam-Projects-cocktime-scheduler/3f55537b-2550-4837-b3ff-af3d3ab4a607/tasks/wlurdhjzv.output)</result>
<diagnostics>Per-agent results: /Users/sam/.claude/projects/-Users-sam-Projects-cocktime-scheduler/fb17b865-9b02-4f23-8b26-6ca7eccd463f/subagents/workflows/wf_c67578c1-878/journal.jsonl — one {"type":"result",...} line per completed agent with its full return value.
If the result above is empty or unexpected, Read this file BEFORE diagnosing — do not assume agents returned non-empty results.
To re-run with edited post-processing: Workflow({scriptPath: '/Users/sam/.claude/projects/-Users-sam-Projects-cocktime-scheduler/fb17b865-9b02-4f23-8b26-6ca7eccd463f/workflows/scripts/encounter-balance-audit-wf_c67578c1-878.js', resumeFromRunId: 'wf_c67578c1-878'}) — agents whose (prompt, opts) are unchanged replay from cache.</diagnostics>
<usage><agent_count>11</agent_count><agents_done>11</agents_done><agents_error>0</agents_error><agents_skipped>0</agents_skipped><agents_empty_result>0</agents_empty_result><subagent_tokens>1540110</subagent_tokens><tool_uses>418</tool_uses><duration_ms>5446637</duration_ms></usage>
</task-notification>

**Answer**: **보고서:** https://claude.ai/code/artifact/56280a73-4f3e-4cc9-9b0c-1c4fe1fb2f86

## 결론부터

**"만나는 사람만 만난다" — 맞습니다. 단 크기가 작고, 체감의 정체가 다릅니다.**

평균 참가자는 한 세션에서 **7.2판 중 3.66판을 같은 한 사람과** 뜁니다(52.8%). 그런데 성별 구성·판수·출석 시간대·동시 경기 제약을 전부 실측 그대로 고정하고 **사람만 완전 랜덤으로 재배치해도 50.9%**가 나옵니다. 초과분은 +1.8%p뿐입니다.

즉 "쟤랑만 계속 뛰네"의 대부분은 **산수**입니다. 7판이면 동반 슬롯이 21개인데 로스터는 19~27명이라 누군가와는 3~4번 겹칠 수밖에 없습니다.

**진짜 초과는 딱 한 군데입니다** — 본인의 연속 두 경기에 같은 사람이 남는 비율(b2b)이 **59.8% vs 무작위 54.7% (t=+5.2)**. 전 지표 중 유일하게 크게 유의합니다. 사람은 "이 세션 누적 4회"를 세지 않고 **"방금 같이 뛴 사람이 다음 판에 또 있네"**를 셉니다. 현재 `groupHistory`는 30분 전 경기와 3분 전 경기를 **같은 무게**로 봅니다.

## "아예 못 만나는 사람"은?

**총량으로는 아닙니다.** 세션당 못 만난 인원 6.28명 vs 무작위 6.37명 — 알고리즘이 만든 게 아닙니다. 고유 동반자 수, HHI, 3회+ 동반쌍도 전부 무작위와 같거나 오히려 낫습니다.

**단 꼬리에 실재합니다.** 4주간 조건부 기대 4회 이상인데 0회인 쌍이 3쌍(우연 기대 0.43쌍, p≈0.009):

| 쌍 | 공동세션 | 기대 | 실측 | |
|---|---|---|---|---|
| 김지훈 × 손형일 | 3 | 4.31 | **0** | 현행 알고리즘 구간 |
| 김길환 × 유성종 | 4 | 3.96 | **0** | 현행 알고리즘 구간 |
| 김주영/남필립 × 이규웅 | 4 | 4.6~4.7 | **0** | 7/27 개편 이전 |

반대편 고착은 **송유현×최두호 14회(기대 5.7, 2.46배)**, **이수민×표슬아 19회(기대 11.8)** — 다중검정 후에도 살아남은 2쌍입니다.

한편 눈에 띄는 "남필립×손형일 22회"는 **기대 18.2회의 1.21배**로 사실상 기대치이고, "엄지현×이지인 22회"는 1.04배입니다. 출석이 많아서 생긴 숫자지 편중이 아닙니다.

## 원인 (완전자동 시뮬 대비 분해)

**구조 63% / 자동편성 안 쓴 몫 25% / 나머지 12%**

가장 실용적인 발견은 두 번째입니다 — **"알고리즘이 나빠서"가 아니라 "알고리즘을 안 써서"**입니다. 프로덕션 함수를 그대로 돌린 완전자동은 최다동반을 0.49~0.79회 낮추면서 **동시에** 판수 std를 1.33→0.57, 스프레드를 4.43→3.79로 개선합니다. 다양성·형평·실력이 상충하지 않습니다.

코드에서 확인된 것: `W_GAME 10.0` > `W_GROUP2 8.0` — **"둘이 나머지만 바꿔 또 뛰기"의 벌점이 판수 1판보다 쌉니다.** `pairPlayers`는 이력을 전혀 안 보고(→ 편중이 파트너가 아니라 **상대팀** 쪽에 몰림), `groupHistory`는 세션 한정이라 세션 간 기억이 0입니다.

기각된 가설: 실력 밴딩(1.5k²) 탓 아님(등급까지 고정해도 초과분 15%만 감소), 성별 가중치 탓 아님(무작위 대비 초과분이 남녀 동일 +0.0185 vs +0.0183 — 여성 체감은 인원 풀이 작은 결과).

## 검증 메모

- 귀무모형을 두 번 독립 구현했고 초과분은 **최다동반 +0.4~1.8%p, b2b +2.3~5.1%p** 범위로 나왔습니다. 순차 샘플러 쪽이 귀무 자체의 집중도를 높여 초과를 과소추정하므로 MCMC(+1.8/+5.1)가 더 정확합니다. **방향과 순위는 두 구현에서 동일**합니다.
- `assigned_by`는 774경기 전부 사람 실명이고 auto 플래그가 없어 **"12%가 수동 개입 탓"인지 분리 불가**입니다. 다음 감사의 전제는 편성 출처 컬럼(auto/auto-edited/manual) 추가입니다.
- 개인 단위 지목은 다중검정 후 **유의자 0명**입니다. 이름은 패턴 예시로만 쓰세요.

이 감사 결과를 `docs/MATCH_LOG_ANALYSIS.md`에 §4d로 기록해둘까요? (기존 §4b·§4c와 같은 형식) 그리고 처방 1번(직전 경기 시간감쇠)은 판수 형평과 충돌할 수 있어 구현 전 A/B가 필요한데, 원하시면 설계안부터 잡겠습니다.

---

## #116

**Prompt**: 실제 사용해보고 나온 경험이긴 한데, 그룹을 충분히 구성할 수 있는 인원이 있어도 자동생성하면 경기중인 사람이 포함됨. 수동으로 경기중인 사람을 뺀다면, 경기중이 아닌 다음 순위의 사람을 넣는것도 좋을것같아. 그리고 랜덤보정치를 넣는다던지.
그리고 자동생성시, 경기중인 사람이 한명만 들어오는데 두명, 세명 될 수도 있는거아냐? 한명으로 강제한건가? 아니면 알고리즘상 한명만 나오는건가.

**Answer**: 세 질문 모두 코드에서 답이 나왔고, 그중 하나는 **명백한 계측 버그**입니다.

## 3) 경기중 1명 — 알고리즘 결과가 아니라 하드 강제입니다

`membershipSlice.ts:361-363`
[코드 블록 생략]
`recommendTeammates.ts:182-186`에서 상한에 도달하면 경기중 후보를 순위에서 **건너뜁니다**. 팀 단위 상한 1명이고, 이미 있는 ghost 예약이나 수동으로 고른 경기중 선수(`extraIds`)를 차감하므로 자동편성을 여러 번 눌러도 2명이 되지 않습니다.

이유는 코드 주석에 있습니다 — 상한 없이 열면 **같은 진행중 경기의 2명을 함께 뽑아, 방금 같이 뛴 둘이 곧바로 또 뭉칩니다.** 그리고 그 우려는 어제 감사에서 실증됐습니다: b2b(직전 동반자와 곧바로 재조우)가 **유일하게 크게 유의한 초과 지표**(+5.1%p, t=+5.2)였습니다. 상한을 2~3으로 열면 이 지표를 직접 악화시킵니다.

구조적으로 2~3명이 불가능한 건 아닙니다. 실측 774경기 중 **3건**은 배정 시점에 2~3명이 다른 코트에서 경기중이었습니다 — 수동 배치나 선수 교체로는 뚫립니다. 자동편성 경로로는 안 뚫립니다.

## 1) 대기자가 충분한데 경기중 사람이 들어오는 이유

`W_PLAYING = 30`은 **제외가 아니라 벌점**입니다. 대기 후보 전원이 30점 이상 나빠야 경기중 선수가 이깁니다. 그런데 **경기중 선수 쪽에 유리하게 새는 구멍이 두 개** 있습니다.

**① 진행 중인 경기가 판수에 안 잡힘** — `game_count`는 `complete_match`에서만 +1 됩니다(`20260624020000_match_ops_editor_lease.sql:160`). `assign_match`는 `status='playing'`만 바꿉니다. 지금 뛰고 있는 판이 부하로 계산되지 않으니 **−10점(=1판) 이득**입니다.

**② 뛴 시간이 기다린 시간으로 계산됨** — `assign_match`(`:82-85`)가 `wait_since`를 리셋하지 않아, 코트에 서 있는 내내 `waitMinutes`가 계속 자랍니다. `W_WAIT = 1.0/분`이고 실측 경기 중앙값이 **11.3분**이니, 한 판 도는 동안 **11점어치 대기 보너스**가 쌓입니다.

둘을 합치면 방금 경기를 마친 대기자와 비교할 때 실효 페널티가 30에서 **10점 안팎까지 깎입니다.** 판수 1판 차이면 뒤집힙니다. "대기자가 충분한데도"의 정체가 이겁니다.

정상 동작인 경우도 있습니다 — `W_GENDER = 50`(혼복 2남2녀에서 성별 초과). 대기자가 전부 남자인데 팀이 2남1녀면 대기 남자 전원 +50이라 경기중 여자(+30)가 이깁니다. 이건 안 그러면 경기 자체가 성립 안 되니 고칠 게 아닙니다.

그리고 풀이 보이는 것보다 작습니다. `recommendPool.ts:98-118`이 자석 없음·휴식·콕 미확인·타 팀 묶임을 계단식으로 걷어내서, 화면에 사람이 많아 보여도 후보에서 빠져 있을 수 있습니다.

실측으로도 보입니다: 774경기 중 **134건(17.3%)**이 멤버 한 명의 직전 경기 종료 30초 이내에 시작됐고, **그 시점 유휴 인원 중앙값은 7명**이었습니다.

## 2) 두 제안 — 둘 다 타당합니다

**"ghost를 빼면 다음 순위 대기자를 넣자"** — 필요합니다. 지금은 ghost 예약을 취소하면 슬롯만 비고 자동 보충이 없는데, 다시 자동편성을 누르면 **같은 사람이 또 뽑힙니다.** `rankCandidates`/`recommendTeammates`/`autoFillTeammates`에 `Math.random`이 없어 완전 결정론적이기 때문입니다(랜덤은 `pairPlayers.ts:104,130`의 2v2 가르기에만 있습니다).

`autoFillTeammates`가 이미 `maxPlaying`을 파라미터로 받으므로 코어는 손댈 필요 없습니다. `autoFillTarget`에 `{ maxPlaying?, exclude?: string[] }`만 뚫고, ghost 칩에 "대기자로 교체" 액션을 붙여 `maxPlaying: 0, exclude: [해당선수]`로 재호출하면 됩니다.

**랜덤 보정치** — 필요하되 **전역 노이즈는 위험**합니다. 가중치가 서열 불변식으로 설계돼 있어서(`W_GROUP4 60 > W_PLAYING 30 > W_GROUP3 24 > W_GAME 10 > W_GROUP2 8`) 노이즈가 서열을 넘으면 판수 형평이 깨집니다. 권장은 **밴드 제한 지터**: 점수에 `−U(0, ε)`를 더하고 argmin, `ε = 4~6`(판수 1판 10보다 확실히 작게). 동점·근사동점에서만 순서를 흔들고 서열은 안 건드립니다. `rng` 파라미터로 주입 가능하게 만들면 시뮬 하네스에서 재현도 됩니다.

다만 지터는 "같은 사람이 반복 선택"만 깹니다. b2b 초과의 근본은 `groupHistory`가 30분 전 경기와 3분 전 경기를 같은 무게로 본다는 것이라, 그건 별개 처방입니다.

---

**순서 제안:** ①②(계측 버그) → ghost 교체 액션 → 지터. ①②는 가중치를 하나도 안 건드리고 "의도한 30점"을 복원하는 것이라 부작용이 가장 작고, 아마 체감 문제의 상당 부분이 여기서 해결됩니다. ①②는 순수 함수(`computeScore`) 쪽에서 `playingIds`를 보고 `gameCount + 1`, `wait = 0`으로 처리하는 게 DB 리셋보다 안전합니다 — 대기 큐 정렬 UI가 `wait_since`를 같이 쓰기 때문입니다.

어디까지 진행할까요? 참고로 이 파일들을 고치면 프로젝트 규칙상 `docs/TEAM_GENERATION_RULES.md`도 같이 갱신해야 합니다.

---

## #117

**Prompt**: 계산할때 뛴 시간, 기다린 시간같이 시간 베이스로 점수계산하는거 오차가 너무 많아. 팀 짜놓고 경기시작 늦게누르는 케이스가 너무 많아서 이거 빼고 다시 고민해봐

**Answer**: 맞는 지적입니다. 시간 항을 빼면 어제 제가 드린 처방 중 하나(②)는 그대로 무효가 되고, 나머지가 재배치됩니다.

## 지적하신 문제가 코드에서 실제로 이렇게 생깁니다

`W_WAIT = 1.0`은 **분당 1점**입니다. 팀을 짜두고 시작 버튼을 5분 늦게 누르면, 그 5분 동안 그 팀 4명의 `wait_since`는 이전 완료 시각 그대로라 **각자 5점씩 우선순위가 계속 올라갑니다.** 판수 1판이 10점이니 8분 지연 = 판수 1판 가까운 왜곡입니다. 시작 버튼을 언제 누르느냐가 다음 편성의 순위를 바꿉니다.

게다가 어제 말씀드린 "경기중 선수가 뽑히는" 문제도 결국 같은 뿌리였습니다 — 시간 항이 **뛴 시간을 기다린 시간으로 세는** 것이었으니까요. 시간 항을 없애면 그 버그는 고칠 게 아니라 **사라집니다.**

## 대신 쓸 축이 이미 DB에 있습니다

`sessions.match_assign_count` — `assign_match`에서 증가하는 순번 카운터입니다. 프로덕션 실측값이 완료경기 수와 정확히 일치합니다(114→48, 237→44, 72→50…). **살아 있고 정확합니다.**

핵심은 이겁니다: **시작 버튼을 늦게 눌러도 순서는 안 바뀝니다.** 지연은 *길이*를 오염시키지 실행 *순서*를 뒤집지 않습니다. 그래서 "몇 분 기다렸나" 대신 **"내가 마지막으로 코트에 들어간 뒤 몇 경기가 지나갔나"**를 쓰면 오차가 원리적으로 사라집니다.

정규화까지 하면 코트 수에도 안 흔들립니다 — `laps = roundsWaited / courtCount`("몇 바퀴 쉬었나"). 4코트든 2코트든 같은 의미가 됩니다.

한 가지 걸리는 게 있습니다. `session_players.joined_at_match`는 프로덕션에서 **전원 0**이고 `rest_since_match`는 전원 NULL입니다 — 구 deficit 모델 잔재라 늦참·휴식 복귀 처리에는 못 씁니다. 그래서 순번 축을 쓰려면 컬럼을 새로 두거나(`last_assigned_match`), 완료매치 배열에서 파생해야 하는데, 후자는 **`session.ts:47-52`의 완료매치 쿼리에 `.order()`가 없어서** 배열 순서가 보장되지 않는 문제를 먼저 고쳐야 합니다. 지금은 순서를 안 쓰니 무해하지만, 순번이든 "최근 경기 가중"이든 순서를 쓰는 설계의 **숨은 선행조건**입니다.

## 지금 돌리는 검증

설계를 확신하기 전에 어제 만든 시뮬 하네스(프로덕션 함수를 그대로 import하는)로 네 변형을 붙여봅니다:

- **A** 현행 / **B** 그냥 제거 / **C** 순번 대체 / **D** C + 경기중 보정

가장 중요한 질문은 **B**입니다 — 그냥 빼도 안 나빠지면 C의 복잡도(신규 컬럼·마이그레이션)가 통째로 불필요합니다. W_WAIT가 원래 막으려던 건 "누군 두 번 연속 쉬는" 편차인데, 판수 항(W_GAME)이 이미 그걸 상당 부분 잡고 있을 가능성이 있습니다.

그리고 별도로 **시계 노이즈 민감도**를 봅니다 — 시작 지연을 0/3/8분 주입했을 때 A가 실제로 무너지는지. 시뮬의 가상 클록은 완벽해서 A가 실제보다 잘 나오게 되어 있으니, 그 격차를 측정해야 "빼자"는 근거가 데이터로 섭니다. 혹시 A가 노이즈에도 안 무너진다면 그것도 그대로 보고하겠습니다.

한편 **밴드 제한 지터는 오히려 더 중요해집니다.** 시간 항이 유일한 연속값이었어서, 빼고 나면 점수가 훨씬 이산적이 되고 **정확한 동점이 늘어납니다** → 결정론이 더 아프게 작동해서 같은 사람이 반복해 뽑힙니다. 어제 말씀하신 "다음 순위 사람 넣기"와 세트로 가야 합니다.

결과 나오면 구현 계획까지 정리해 드리겠습니다.

---

## #118

**Prompt**: <task-notification>
<task-id>wiw01xy0u</task-id>
<tool-use-id>toolu_01TgESyGDf6ErK9rneyKNRw2</tool-use-id>
<output-file>/private/tmp/claude-501/-Users-sam-Projects-cocktime-scheduler/3f55537b-2550-4837-b3ff-af3d3ab4a607/tasks/wiw01xy0u.output</output-file>
<status>completed</status>
<summary>Dynamic workflow "점수에서 시간(wallclock) 항을 빼고 경기 순번 기반으로 대체하는 설계 검증" completed</summary>
<result>{"synth":"# W_WAIT 재설계 — 최종 설계안\n\n**작성 근거**: B1(변형 비교) · B2(시계 노이즈) · B3(영향 범위) 3개 검증 + 각각의 적대적 반증 + 본 종합에서 직접 재계산한 프로덕션 실측치\n**전제**: 프로덕션 코드는 이 문서 작성 과정에서 한 줄도 수정하지 않았다.\n\n---\n\n## 0. 결론 — (c) 유지\n\n**W_WAIT(시계 기반 대기 항)를 제거하지도, 순번 항으로 대체하지도 않는다. 유지하되, 이 항을 망가뜨리고 있는 한 줄짜리 결함을 고친다.**\n\n핵심 사실 하나로 요약하면 이렇다.\n\n&gt; `assign_match`는 선수를 `status='playing'`으로만 바꾸고 **`wait_since`를 건드리지 않는다**. 그래서 코트에 서 있는 선수의 \"대기 시계\"가 경기 내내 계속 돌아간다. 문서(`docs/TEAM_GENERATION_RULES.md:258`)는 \"waitSince는 … 계속 못 들어간 사람만 값이 커진다\"고 적고 있는데, **그 문장이 코드에서 거짓이다.**\n\n이 결함 하나가 만드는 결과:\n\n| 지표 | 현행(A) | 근거 |\n|---|---|---|\n| 자동편성 팀 중 경기중 선수 포함 비율 | **28%** | 시뮬 2종 독립 재현 (0.283 / 0.280, 8세션) |\n| 첫 픽에서 경기중 후보가 최상위를 차지 | **21.3%** | 실편성시점 결정론 리플레이 n=371 |\n| 세션당 코트 유휴 | **70분** (시뮬) / 실측 105분 | 시뮬 A 70.8 / 69.4 |\n| 같은 경기 수의 세션 wallclock | **196분** | 시뮬 A 195.6 / 195.6 |\n| 실효 ghost 페널티 | 공칭 30 → **약 20, 그것도 변동** | head-to-head 중앙값 n=371 |\n\n처방은 **SQL 한 토큰 + 같은 결함이 있는 함수 하나 더**다.\n\n```sql\n-- assign_match, set_match_roster 두 곳\nSET status = 'playing'\n→ SET status = 'playing', wait_since = now()\n```\n\n**세 선택지 판정**\n\n| 선택지 | 판정 | 결정적 근거 |\n|---|---|---|\n| **(a) 그냥 제거** | **기각** | 굶주림 꼬리가 무너진다. 최장 미출전 streak +3.18경기(8/8 세션 유의, 두 하네스 독립 재현 +3.18 / +3.185), 개인간 고착 sd **3.2배**. \"동점 tie-break 인공물\" 대립가설은 3종 대조군(프로덕션 정렬 재현·무작위 지터 ε≤1·ε≤5)으로 전부 기각 — 페널티의 7%만 줄었다. 진짜 후퇴다. |\n| **(b) 순번(lap) 대체** | **기각(조건부 보류)** | 고유 이득은 시계 오염 면역 하나인데 그 값어치가 **gcStd 0.03(≈6%)**이다(당초 주장 0.21/+41%는 반증됨 — 모델 I의 Σδ 누적 구성 산물). 대가는 신규 컬럼 + RPC 5개 경로 + 클라 5파일 + 백필 + 음수 laps 클램프. 게다가 **파라미터가 미해결**: 등가 W_LAP은 코트 정의에 따라 7.9~10.3(프로덕션이 쓸 수 있는 선언 코트 기준 ≈10)인데 b2b 안전 상한은 6~8 — **두 밴드가 겹치지 않는다.** 값을 못 정하는 안은 배포하지 않는다. |\n| **(c) 유지 + 결함 수정** | **채택** | 리셋만 넣어도 ghost 0.280→**0.094**, 유휴 69.4→**29.5분**, wallclock →**181.6분**, gcStd 0.567→**0.555**, 그리고 **굶주림 꼬리는 전 변형 중 최良**(gapMax 8.64 / gapP95 6.97 — 순번안 C8의 9.15 / 7.25보다 좋다). 마이그레이션 스키마 변경 0, 롤백 즉시. |\n\n---\n\n## 1. 운영자 전제의 재검토\n\n운영자의 문제 제기: *\"뛴 시간·기다린 시간 같은 시간 베이스 점수는 오차가 너무 크다. 팀 짜놓고 경기 시작 버튼을 늦게 누르는 케이스가 너무 많다.\"*\n\n**증상 관찰은 정확했다.** 실측(10세션, n=399 코트 유휴 간격):\n\n- p50 0.81분 / p90 **7.33분** / p95 **12.79분** / max 86.8분\n- 5분 초과 14.3%, 10분 초과 8.0% — 55%가 1분 미만인 명확한 이봉 분포 = \"대체로 즉시, 가끔 크게 늦음\"\n- **5분 초과 케이스(n=56)의 100%에서 가용(비경기중) 인원이 4명 이상이었다** → 인원 부족이 아니라 순수 운영 지연\n\n**그러나 원인 지목은 틀렸다.** 두 가지 이유로.\n\n**① 시작 버튼 지연은 대기 시계를 오염시키지 못한다.** `wait_since`를 쓰는 SQL은 `complete_match` · `set_player_resting` · `set_cock_checked` · `set_match_roster`(제거 선수) · 세션 오픈 insert뿐이고, **`assign_match`는 아예 손대지 않는다.** 늦게 눌러도 그 시각이 점수에 기록되는 경로가 없다.\n\n**② 지연 자체의 점수 비용은 작고, 어떤 처방으로도 못 막는다.** 물리적으로 충실한 모델(지연 동안 선수가 실제로 묶임)에서 A의 판수 std 열화는 **+5.7%**. 같은 두꺼운 꼬리 분포를 1회성으로 주입한 모델에서도 **+6.2%**. 그리고 이 열화는 A·B·C·D **전 변형에 똑같이 걸린다**(연속 미출전 p95 +5~8%) — 스케줄이 실제로 교란되기 때문이지 점수식 탓이 아니다.\n\n**빼야 할 것은 시계가 아니라 \"리셋되지 않는 시계\"다.** 실제로 리셋을 넣으면 지연에 **면역이 아니라 오히려 유리**해진다(d=6분 지연 시 리셋안 ghost 0.094→0.065, gapMax 8.64→**7.97**) — 리셋이 \"늦게 누른 바로 그 시점\"에 걸려 지연 구간이 점수에서 사라지기 때문이다. 같은 조건에서 현행 A는 ghost 0.280→**0.377**로 악화한다.\n\n### 결함의 메커니즘 — 왜 ghost가 폭증하는가\n\n경기중 후보와 대기 후보를 비교할 때 점수차는:\n\n```\n실효 ghost 페널티 = W_PLAYING(30)\n                  − (경기중 후보 wait − 대기 후보 wait) × W_WAIT(1.0/분)\n                  − W_GAME(10)          ← 진행 중인 판이 game_count에 아직 안 잡힘\n```\n\n프로덕션 실측(10세션, 실제 편성시점 후보 n=7,187): **경기중 후보 wait p50 11.78분 vs 대기 후보 2.54분 → Δ +9.2점.** 10세션 중 9세션 동일 부호.\n\n즉 반사실 기준으로 30 − 9.2 − 10 ≈ **11**, 실제 1·2위 head-to-head 중앙값으로 **20**(n=371). 두 값이 다른 것은 비교 기준이 달라서다(전자는 동일인 반사실, 후자는 서로 다른 두 후보의 실제 점수차). **어느 쪽이든 의도값 30에 못 미치고 `W_GROUP3`(24) 이하다.**\n\n더 나쁜 건 이 값이 **상수가 아니라 경기 경과 시간의 함수**라는 것이다. `W_WAIT=1.0/분`이므로 경기가 20분 진행되면 실효 페널티가 20점 깎인다 — **오래 진행된 경기의 선수일수록 대기자보다 싸진다.** 프로덕션 경기 길이 중앙값은 약 11분(n=2,099 전량 기준 10.96분, 4~25분 절단 시 11.49분 n=1,451)이고 p90은 24.5분이다. 시뮬 A의 ghost 28%는 이 저측 꼬리에서 나온다.\n\n리셋을 넣으면 실효값이 **20에 고정**된다(진행 중 판 미계상분 −10만 남는다). 평균은 오늘과 비슷한데 **변동이 사라진다** — 그래서 ghost가 28%→9.4%로 떨어진다.\n\n---\n\n## 2. 수치 정합성 — 충돌 확정표\n\n에이전트 간 값이 어긋난 항목을 직접 재계산해 확정했다. 재계산 스크립트: `/private/tmp/claude-501/-Users-sam-Projects-cocktime-scheduler/fb17b865-9b02-4f23-8b26-6ca7eccd463f/scratchpad/c1_recalc.py`, `c2_ties.py`\n\n| 항목 | 충돌 | **확정값(본 종합 재계산)** | 채택 이유 |\n|---|---|---|---|\n| 경기 길이 중앙값 | 브리핑 11.3 / B2 11.4 / B3adv 10.7 | **10.96분** (n=2,099 전량) / 11.49분 (4~25분 절단, n=1,451) | 직접 계산. 어느 값을 써도 결론 불변이라 **\"약 11분\"**으로 인용 |\n| 코트 유휴 간격 | — | p50 0.81 / p90 **7.33** / p95 **12.79** / max 86.8 (n=399) | B2·본 종합 완전 일치 |\n| ≤30초 재투입 | B2 \"ghost 외부검증 6.45%\" vs B2adv \"1.37%\" | 총 **99/1,536 = 6.45%**, 그중 **같은 코트 잔류 78건** / **타코트 21건 = 1.37%** / strict(타코트+코트 2분↑ 공백) **8건 = 0.52%** | B2adv 정정 채택. 같은 코트 잔류는 \"그 코트가 마침 비었다\"이지 ghost가 아니다. **ghost 관측 baseline은 1.37%(loose) / 0.52%(strict)** |\n| A의 ghost 비율 | B1 0.283 / B1adv 0.280 / B2 0.256 / B3adv 0.213 | **팀 기준 0.26~0.28** (시뮬 2종), **첫 픽 선발률 21.3%** (결정론 리플레이) | 정의가 다른 지표. 둘 다 병기 |\n| 실효 ghost 페널티 | B3 \"8.7\" / B3adv \"7.2 또는 20/30/40\" | **head-to-head 중앙값 A 20.0 / B 30.0 / D 40.0** (n=371). 반사실 분해로는 ≈11 | B3의 8.7은 \"대기 후보 wait=0\" 가정 오류. 운영 의미가 있는 head-to-head 채택 |\n| 시계 잡음이 A에 물리는 비용 | B2 \"+41%(모델 I)\" vs B2adv \"+6%\" | **약 +6%** (모델 P +5.7% / 모델 J +6.2%) | +41%는 선수별 Σδ **누적** 구성 산물. 꼬리를 그대로 두고 누적만 제거하니 피해가 1/6로 붕괴 → **41%는 인용 금지** |\n| 등가 W_LAP | B2 \"8\" / B2adv \"7.9~10.3\" | **정의 미확정 — 이것이 (b) 기각 사유** | 유효코트 기준 7.87, 선언코트 기준 10.30, 실사용 court_id 기준 10.11. 프로덕션은 선언코트만 쥘 수 있다 |\n| 현행 동점률 | B3 \"제거하면 44%\" (현행 미측정) | **현행 A도 22%**(10세션 n=384) / 25%(3세션 n=102). 제거 시 40%/45% → **증분 +18%p** | 기준선이 없던 B3 주장을 B3adv가 보완. 본 종합에서 원인까지 확인(아래) |\n| wait_since 동일값 | B3adv 93% | **203명 중 188명 = 93%**, 클러스터 크기 **4·8·12·16** | 직접 재계산 일치 |\n| teamSelection 테스트 수 | B3 \"27건\" | **31건** (recommendTeammates 25 + skillScore 6) | 직접 카운트 |\n| wait_since 리셋 경로 | B2adv \"swap_match_player\" | **그 함수는 2026-06-16에 DROP됨**(`20260616000000_db_cleanup.sql:15`). 현행 경로는 **`set_match_roster`** | 직접 확인. 세 에이전트 모두 틀렸던 항목 |\n| §8 오타 위치 | B3 \":299\" / B3adv \":297\" | **:297** (\"W_GROUP4 40\" → 실제 60) | 직접 확인 |\n\n### 재계산에서 새로 확정한 것 — 동점의 정체\n\n현행 A에서도 첫 픽의 22%가 **정확 동점**이고, 그 동점의 **81%가 \"직전 같은 경기에서 함께 끝난 4인\"**이다. 원인은 `complete_match`의 단일 문장:\n\n```sql\nUPDATE public.session_players\nSET status='waiting', wait_since = v_now, game_count = game_count + 1, ...\nWHERE id IN (p_team_a_p1, p_team_a_p2, p_team_b_p1, p_team_b_p2);\n```\n\n같이 끝난 4명은 `wait_since`가 **비트 단위로 동일**하다. 프로덕션 덤프에서도 203명 중 188명(93%)이 다른 선수와 정확히 같은 값이고, 클러스터 크기가 4·8·12·16(=코트 단위 배수)로 찍힌다.\n\n**즉 W_WAIT은 가장 갈라야 할 그룹 — 직전 동반자 4인, 곧 b2b 위험군 — 에서만 골라서 무력하다.** 그리고 `Array.sort`가 안정정렬이므로 동점은 풀 배열 순서로 깨지는데, resync 이후 풀 순서는 `ORDER BY sp.id`(고정 순열)다. **같은 사람이 항상 이긴다.** 이것은 어제 감사에서 유일하게 초과로 나온 지표(b2b +5.1%p)의 직접적 기여 후보다.\n\n**이 결함은 W_WAIT 제거/유지와 무관한 독립 결함이다.** 최종안에 별도 항목으로 포함한다.\n\n---\n\n## 3. 최종안\n\n### 3.1 Phase 1 — 필수 (측정 근거 있음)\n\n**① `wait_since` 배정 리셋** (DB)\n\n`assign_match`와 `set_match_roster`(투입 선수 경로) 두 곳에서 `status='playing'`으로 바꿀 때 `wait_since = now()`를 함께 세팅한다.\n\n- 근거: 독립 시뮬 8세션×200시드 — ghost 0.280→**0.094**, 유휴 69.4→**29.5분**, wallclock 195.6→**181.6분**, gcStd 0.567→**0.555**, gapMax 8.78→**8.64**(전 변형 중 최良), gapP95 7.15→**6.97**(최良), 고착 sd 0.244→0.251(A 수준 유지)\n- 비용: b2b 0.342→0.372(+3.0%p) — 아래 3.4에서 별도로 다룬다\n- 스키마 변경 0, 신규 컬럼 0, 클라이언트 변경 0\n\n**② 정확 동점 무작위화** (프론트)\n\n`recommendTeammates`의 최종 정렬에서 점수차가 부동소수 오차 이내(`|Δ| &lt; 1e-9`)일 때만 2차 키로 순서를 섞는다.\n\n- **연속 ε 지터를 쓰지 않는다.** 실측 격자 간격(1~2위 점수차 분포): 첫 픽(confirmed=0)에서는 `{0(40%), 2, 4, 8, 10(21%), 12, 14, 20, 22, 30}`으로 **2 미만 간격이 아예 없고**, 전 라운드로 넓히면 0.5(3%)·1.5(4%)가 실재한다. 따라서 \"진짜 차이를 절대 뒤집지 않는다\"는 기준을 세우면 안전 상한은 **ε &lt; 0.5**이고, 그 구간에서 연속 지터는 정확 동점 무작위화와 사실상 동일하다. **ε = 0(정확 동점만)으로 확정한다.** (B3의 \"ε&lt;1.5\" 권고는 본인이 제시한 근거 '0.5 간격 존재'와 모순 — 채택하지 않음)\n- **`Math.random`이 아니라 결정론적 해시 키를 쓴다.** 2차 키 = `hash(playerId, sessionId, matchAssignCount)`.\n  - 리렌더마다 재추첨되지 않으므로 **추천 다이얼로그에도 안전하게 적용할 수 있다**(자동편성 전용으로 제한할 필요가 없다). 이게 중요한 이유: 실운영의 25%는 운영자가 다이얼로그 최상단을 그대로 고르는 수동 픽 경로이고, `Math.random` 기반이면 그 경로를 못 덮는다.\n  - `matchAssignCount`가 올라갈 때마다 순열이 바뀌므로 **\"같은 사람이 항상 이긴다\"가 깨진다.**\n  - 
... (truncated 27318 chars, full result in /private/tmp/claude-501/-Users-sam-Projects-cocktime-scheduler/3f55537b-2550-4837-b3ff-af3d3ab4a607/tasks/wiw01xy0u.output)</result>
<diagnostics>Per-agent results: /Users/sam/.claude/projects/-Users-sam-Projects-cocktime-scheduler/fb17b865-9b02-4f23-8b26-6ca7eccd463f/subagents/workflows/wf_f85856d1-0ea/journal.jsonl — one {"type":"result",...} line per completed agent with its full return value.
If the result above is empty or unexpected, Read this file BEFORE diagnosing — do not assume agents returned non-empty results.
To re-run with edited post-processing: Workflow({scriptPath: '/Users/sam/.claude/projects/-Users-sam-Projects-cocktime-scheduler/fb17b865-9b02-4f23-8b26-6ca7eccd463f/workflows/scripts/drop-clock-scoring-wf_f85856d1-0ea.js', resumeFromRunId: 'wf_f85856d1-0ea'}) — agents whose (prompt, opts) are unchanged replay from cache.</diagnostics>
<usage><agent_count>7</agent_count><agents_done>7</agents_done><agents_error>0</agents_error><agents_skipped>0</agents_skipped><agents_empty_result>0</agents_empty_result><subagent_tokens>1089998</subagent_tokens><tool_uses>319</tool_uses><duration_ms>4601972</duration_ms></usage>
</task-notification>

**Answer**: ## 먼저 정정

지난 답에서 제가 "시작 버튼을 5분 늦게 누르면 그 팀 4명이 5점씩 올라간다"고 했는데 **틀렸습니다.** `assign_match`는 `wait_since`를 아예 건드리지 않고, 편성 중인 4명은 이미 다른 팀 후보 풀에서 빠져 있습니다(`recommendPool.ts`의 `mag.teamId !== teamId` 제외). 지연되는 동안 나머지 대기자는 다 같이 쌓이므로 상대 순위도 안 바뀝니다. **늦게 누른 시각이 점수에 들어가는 경로가 없습니다.**

지연 자체는 실재합니다 — 코트 유휴 p90 **7.33분**, 5분 초과 14.3%, 그 케이스의 **100%가 가용 인원 4명 이상**이었습니다. 다만 이건 점수식이 아니라 보드 UI 문제입니다.

## 그런데 시간 항의 진짜 결함은 실재합니다 (직접 검증)

경기중인 선수의 대기 시계가 코트 위에서 계속 돕니다. 실측(편성 시점 후보 12,184건):

| | p25 | **p50** | p75 |
|---|---|---|---|
| 경기중 후보 대기 | 8.4분 | **12.7분** | 16.9분 |
| 대기 후보 대기 | 0.9분 | **3.5분** | 9.4분 |

**격차 +9.3점.** 여기에 진행 중인 판이 `game_count`에 안 잡히는 −10을 더하면 **실효 ghost 페널티 = 30 − 9.3 − 10 ≈ 11.** `W_GROUP2`(8) 수준입니다. 게다가 상수가 아니라 **경기가 길수록 싸집니다**(분당 1점씩). "대기자 있는데 경기중 사람이 뽑힌다"의 정체입니다.

## "빼자"에 대한 답: 빼면 안 됩니다

시뮬로 A(현행)/B(제거)/C(순번)/D를 붙여봤고, 결과가 제 예상과 달랐습니다.

**제거(B) 기각** — 굶주림 꼬리가 무너집니다. 최장 미출전 **+3.18경기**(8/8 세션, 서로 다른 두 하네스가 +3.18 / +3.185로 독립 재현). 그리고 피해가 무작위가 아니라 **특정인에게 고착**합니다(개인 간 편차 3.2배), 등급이 세션 중앙에서 벗어난 사람과 남성에 편중됩니다. "동점 정렬 인공물 아니냐"는 대립가설은 대조군 3종으로 검정했고 페널티의 7%만 설명했습니다.

**순번 대체(C) 기각** — 고유 이득이 판수 std 0.03(약 6%)뿐인데, **파라미터를 정할 수가 없습니다.** 등가 `W_LAP`이 코트 정의에 따라 7.9~10.3인데 b2b 안전 상한은 6~8이라 **두 밴드가 안 겹칩니다.** 값을 못 정하는 안은 배포 못 합니다. 대가는 신규 컬럼 + RPC 5경로 + 백필 + 클라 5파일입니다.

그리고 시계 노이즈가 현행에 물리는 비용은 처음 나온 +41%가 아니라 **+6%**였습니다(그 41%는 선수별 누적 방식이 만든 산물이라 폐기). 그마저 A·B·C·D **전 변형에 똑같이 걸립니다** — 지연은 점수식이 아니라 스케줄 자체를 교란하니까요.

## 대신 고칠 것 — SQL 한 줄

[코드 블록 생략]

| | 현행 | 리셋 후 |
|---|---|---|
| 자동편성에 경기중 선수 포함 | 28% | **9.4%** |
| 세션당 코트 유휴(시뮬) | 69.4분 | **29.5분** |
| 같은 경기 수 wallclock | 195.6분 | **181.6분** |
| 최장 미출전 p95 / max | 7.15 / 8.78 | **6.97 / 8.64** (전 변형 최良) |

실효 페널티가 **20에 고정**됩니다(변동이 사라지는 게 핵심). 그리고 시작 지연에 오히려 **유리해집니다** — 리셋이 "늦게 누른 그 시점"에 걸려 지연 구간이 점수에서 사라집니다. 현행은 같은 조건에서 ghost가 28%→37.7%로 악화합니다.

## 새로 나온 결함 — 동점 (독립 검증함)

`complete_match`가 4명의 `wait_since`를 **동일 타임스탬프**로 세팅합니다. 프로덕션 실측: **398명 중 362명(91%)이 다른 선수와 값이 정확히 같고**, 클러스터 크기가 4(41건)·8(6)·12(3)·16(2) — 코트 단위 배수입니다.

즉 **W_WAIT은 가장 갈라야 할 그룹, 직전에 같이 끝난 4인에서만 골라서 무력합니다.** 첫 픽의 22%가 정확 동점이고 그중 **81%가 직전 동반 4인**입니다. `Array.sort`는 안정정렬이고 풀 순서는 고정이라 — **같은 사람이 항상 이깁니다.** 어제 감사에서 유일하게 초과로 나온 b2b(+5.1%p)의 직접 기여 후보입니다.

처방은 말씀하신 랜덤 보정치인데, **연속 지터(ε)는 아닙니다.** 실측 점수 격자에 0.5 간격이 실재해서 안전 상한이 ε<0.5인데, 그 구간이면 정확 동점 무작위화와 사실상 같습니다. 그리고 `Math.random` 대신 **결정론적 해시(playerId, matchAssignCount)**를 쓰면 리렌더마다 재추첨되지 않아서, 자동편성뿐 아니라 **추천 다이얼로그까지 덮을 수 있습니다** — 실운영의 25%가 다이얼로그 최상단을 그대로 고르는 수동 픽이라 이게 중요합니다.

## 정직하게 밝힐 트레이드오프

**어떤 처방을 써도 b2b가 약 +3%p 악화합니다.** 지금의 낮은 b2b는 W_WAIT의 공로가 아니라 **ghost가 큐를 섞어주던 부수효과**입니다. 교환비를 그대로 적으면 — 세션당 코트 40~50분과 wallclock 14분을 주고 재조우 확률 3%p를 사는 거래입니다.

그리고 알고리즘과 무관하게, 유휴 5분 초과의 100%가 인원이 있는 상태였으니 **"N번 코트 비어 있음 · M분째" 배지**가 세션당 수십 분을 되찾는 가장 값싼 수단입니다.

---

제안 순서는 **① DB 한 줄 → 1~2세션 관측 → ② 동점 무작위화 → (조건부) 판수 계상 + W_PLAYING 22** 입니다. ①은 스키마 변경이 없어 롤백이 분 단위이고 세션 중에도 안전합니다.

진행할까요? ①은 마이그레이션 파일 하나인데, `search_path=''`와 `public.` 한정을 반드시 지켜야 하는 함수라(2026-07-26 sync 롤백 사고 건) 배포 전 프로덕션 현재 정의부터 대조하겠습니다.

---

## #119

**Prompt**: 근데 실제로 시간값이 신뢰가 되지 않는 값인데 어떻할까

**Answer**: ## 맞습니다. 그리고 재보니 생각보다 심합니다

23세션 774경기에서:

- **서로 다른 코트가 5초 이내에 동시 완료된 묶음 70건**(크기 2~5). 그중 세션 종료 직전은 18건뿐이니 **52건은 세션 중간에 몰아서 누른 겁니다.** 물리적으로 불가능한 동시성입니다.
- 기록상 **경기 길이 4분 미만이 11.5%**(89건, p05는 0.1분 = 6초), 25분 초과 5.4%, 최대 164분.
- `wait_since`가 다른 사람과 정확히 같은 값인 선수가 **398명 중 362명(91%)**, 클러스터 크기 4·8·12·16.

기록된 시각은 물리적 시각이 아니라 **버튼 누른 시각**이고, 그게 자주 뭉쳐 있습니다.

## 그런데 재보니 결정적인 게 하나 나왔습니다

같은 편성 시점의 대기 후보 **13,468쌍**에서, "시간 기준 누가 더 오래 기다렸나"와 "완료 순번 기준 누가 더 오래 기다렸나"의 **불일치가 0쌍이었습니다.**

우연이 아니라 항등입니다. 두 값 모두 *"내 마지막 완료가 완료 순서에서 몇 번째냐"*의 단조 변환이라 순위가 같을 수밖에 없습니다.

**이게 답의 실마리입니다. W_WAIT이 시계에서 실제로 가져오는 건 순위가 아니라 눈금뿐입니다.**

| | 시계에서 오는가 | 오염됐는가 |
|---|---|---|
| **순위** — 누가 더 오래 기다렸나 | 아니오 (완료 *순서*만) | **아니오** |
| **눈금** — 그 대기가 언제 다른 항을 이기나 | 예 (10분에 W_GAME, 24분에 W_GROUP3) | **예** |

지금 오염이 실제로 하는 일은 이겁니다: 완료를 몰아서 누르면 그 선수들의 대기 시계가 **늦게 시작**돼 대기가 과소평가되고, 반대로 코트 위에 있는 선수는 시계가 계속 돌아 과대평가됩니다(실측 12.7분 vs 3.5분). **누가 앞인지는 안 흔들리고, 얼마나 앞인지가 흔들립니다.**

## 그래서 방향은 "빼기"가 아니라 "눈금 갈아끼우기"입니다

`waitMinutes`를 **완료 순번**으로 바꿉니다 — `laps = (내 마지막 출전 이후 완료된 경기 수) / 코트 수`, 즉 "몇 바퀴 쉬었나".

이게 좋은 이유는 순위가 **정의상 현행과 동일**하다는 겁니다. 그래서 지난 검증에서 확인된 "빼면 특정인이 굶는다"(최장 미출전 +3.18경기)는 구조적으로 안 생깁니다. 오염된 크기만 사라집니다.

지난번에 순번 대체를 기각했던 건 **폴루션된 W_WAIT의 평균 거동을 재현하려 해서**였습니다(등가 W_LAP 7.9~10.3 vs b2b 안전 상한 6~8, 밴드 불일치). 순위가 어차피 같다면 재현할 이유가 없고, 눈금은 설계 의도로 정하면 됩니다. 제 실수였습니다.

그리고 두 가지가 딸려옵니다:

- **문턱형**으로 두면 밴드 충돌 자체가 사라집니다 — 1.5바퀴 이하면 항이 0(정상 구간에서 아무 일도 안 함 → b2b·편중에 부작용 0), 그 위로만 강하게. 굶주림 구제는 원래 꼬리용 안전밸브지 상시 항이 아닙니다.
- **경기중 선수는 `laps = 0`으로 두면 ghost 결함이 같이 고쳐집니다.** 순수 프론트 코드라 **DB 마이그레이션이 통째로 불필요**해질 수 있습니다 — 지난번에 제안한 SQL 리셋보다 나은 경로입니다.

데이터도 이미 다 내려옵니다. `COMPLETED_MATCH_TEAM_COLUMNS`에 `ended_at`이 포함돼 있어서(`types.ts:234`) 클라이언트가 정렬만 하면 됩니다. 다만 `session.ts:47-52` 쿼리에 `.order()`가 없어 그 한 줄은 반드시 먼저 고쳐야 합니다.

## 지금 검증 중

- **E1**: A(현행) / B(제거) / A+R(SQL) / E-linear 5종 / E-knee 6종을 같은 시드로 붙여서, E가 굶주림 보호를 지키는지 · 문턱형이 정말 무해한지 · **playingIds 가드만으로 마이그레이션 없이 ghost가 잡히는지**
- **E2**: E의 전제인 "순서는 살아 있다"를 깨보는 검증. 동시 완료 70건 묶음 안에서는 순서가 사실상 무작위인데, 그게 전체의 몇 %를 불확정하게 만드는지. 그리고 순서를 5/10/20% 교란했을 때 E와 A가 각각 얼마나 무너지는지 — **A가 더 크게 무너져야 E의 논거가 섭니다. 아니면 E 우위 주장을 접겠습니다.**

결과 나오면 파라미터 확정값까지 정리해 드리겠습니다.

---

## #120

**Prompt**: <task-notification>
<task-id>wheup4fqk</task-id>
<tool-use-id>toolu_01HQmKUBivRLD4i8BsUZZ9YM</tool-use-id>
<output-file>/private/tmp/claude-501/-Users-sam-Projects-cocktime-scheduler/3f55537b-2550-4837-b3ff-af3d3ab4a607/tasks/wheup4fqk.output</output-file>
<status>completed</status>
<summary>Dynamic workflow "대기 항의 순위는 그대로 두고 눈금만 시계에서 경기 순번으로 바꾸는 안(E) 검증" completed</summary>
<result>{"synth":"# 시간값을 못 믿겠다 — 최종 권고\n\n작성 기준: E1·E2 두 검증과 각각의 적대적 반증, 그리고 이 종합 단계에서 **내가 직접 재계산·재실행한 결과**(200시드 × 10세션 × 9변형, 신규 지표 추가). 프로덕션 코드는 수정하지 않았다.\n\n---\n\n## 0. 한 문장 답\n\n**시간값(대기 시계)을 쓰는 것 자체가 문제가 아니라, 시계가 \"경기중인 사람에게도 계속 돌아간다\"는 것이 문제의 90%다. 그러니 (1) 지금 당장 경기중 가드부터 넣고 — DB 수정 없음, 상수 변경 없음 —, (2) 그 다음 릴리스에서 눈금을 `배정 카운터` 기반으로 바꿔라(W_LAP = 8). 완료 시각(`ended_at`) 순번으로 바꾸는 안(E-comp)은 채택하지 않는다 — 그건 `wait_since`와 문자 그대로 같은 값이라 오염원이 동일하다.**\n\n---\n\n## 1. 채택 / 기각 판정 (파라미터 확정값 포함)\n\n| 안 | 판정 | 확정 파라미터 | DB |\n|---|---|---|---|\n| **경기중 가드** (`playingIds.has(p)` → 대기 항 = 0) | **채택 — 즉시** | 없음 (W_WAIT **1.0 유지**) | 불필요 |\n| **E-assign** (눈금 = 배정 카운터, 코트 수 정규화) | **채택 — 다음 릴리스** | **W_LAP = 8**, `laps = (match_assign_count − last_assigned_at_match) / 코트수` | 컬럼 1개 |\n| A+R (`assign_match`에서 `wait_since` 리셋) | **기각** | — | **불필요 판정** |\n| E-comp (눈금 = 완료 순번 `ended_at`) | **기각** | — | — |\n| E-knee (문턱형, θ·W_STEEP) | **기각** (6조합 전부 지배당함) | — | — |\n| B (W_WAIT 제거) | **기각 유지** | — | — |\n| E+G (진행중 판수 계상 `gameCount+1`) | **보류** (효과 있으나 지금은 b2b가 제약) | — | — |\n\n### A+R(SQL 마이그레이션)이 불필요한 이유 — 측정이 아니라 증명\n\n`wait_since`에 쓰이는 값은 두 군데뿐이다.\n\n- `complete_match`: `wait_since = v_now` (완료 시)\n- (A+R 제안) `assign_match`: `wait_since = now()` (배정 시)\n\nA+R이 쓴 값은 **선수가 `playing`인 동안에만 읽힌다** — 완료되는 순간 `complete_match`가 덮어쓰기 때문이다. 그런데 가드는 `playing`인 후보의 대기 항을 정확히 0으로 만든다. 따라서\n\n&gt; **가드가 있으면 A+R이 쓴 값은 점수에 단 한 번도 도달하지 못한다. `A+R+가드 ≡ 가드`가 항등식이다.**\n\nE1 적대 검증이 관측한 \"ARG와 AG가 **비트 동일**\"은 우연이 아니라 이 항등식의 확인이다. **대기 시각 리셋을 위한 DB 마이그레이션은 하지 마라.** (단 A+R은 풀 정렬 `.order(\"wait_since\")`과 화면의 \"대기 N분\" 표시는 바꾼다 — 점수에는 영향 0.)\n\n---\n\n## 2. 왜 이렇게 갈리는가 — 귀인 정리\n\n원 보고서 E1의 헤드라인(\"안 E가 ghost를 82% 줄인다 → 마이그레이션 불필요\")은 **수치는 맞지만 공로 배분이 틀렸다.** 적대 검증이 빠진 통제군 `AG`(= 현행 시계 눈금 그대로 + 가드만)를 넣자 분해가 이렇게 나왔고, 나도 독립 재현했다.\n\n| 단계 | ghost 팀/세션 | 코트 유휴(분) | wallclock(분) |\n|---|---|---|---|\n| A (현행) | **13.73** | 78.7 | 192.4 |\n| A+R (SQL 리셋) | 약 5 (E1 적대 측정: ghostPick 0.077→0.028) | 약 35 | 약 178 |\n| **AG (가드만, DB 무수정)** | **2.50** | **28.5** | **176.5** |\n| Easgn8 (가드 + 배정 눈금) | 1.87 | 24.8 | 175.5 |\n\n**ghost·유휴 개선의 사실상 전부가 가드의 몫이다. 눈금 교체의 몫은 그 위에 붙는 얇은 층(ghost 2.50 → 1.87)이다.** 이건 이미 저장소 런북이 진단해 둔 것과 정확히 일치한다 — `docs/MATCH_LOG_ANALYSIS.md` §4c 코드 결함 #1: \"ghost 실효 페널티가 명목 30이 아니라 +9.4 … `assign_match`가 `wait_since`를 안 건드려 경기 중에도 대기 보너스 누적(−10.6)\". 가드는 그 −10.6을 정확히 제거한다(실효 페널티 30 → 20).\n\n---\n\n## 3. 수치 정합성 — 에이전트 간 충돌 해소\n\n두 검증은 **단위와 하네스가 달랐다.** 내가 직접 재계산해 확정한다.\n\n| 쟁점 | E1 원보고 | E2 원보고 | **확정** |\n|---|---|---|---|\n| 단위 | `gapMax` = 완료 경기 수 (A 기준선 9.02) | `lapMax` = 바퀴 (A 기준선 2.91) | **둘 다 맞다.** 유효 코트 평균 3.2 → 2.91 laps × 3.2 ≈ 9.3경기. 환산만 하면 일치 |\n| ghost | rate 0.077 / team 0.308 | 13.72 팀/세션 | **같은 값.** 13.73/44경기 = 0.312 |\n| ghost 공로 | 안 E | 가드 | **가드** (§2, 항등식 증명 + 재현) |\n| A+R 필요성 | 불필요 | (미판정) | **불필요, 증명 있음** |\n| 최적 W_LAP | 10 (완료 눈금) | 8 (배정 눈금) | **모순 아님.** 강도 사다리 `AG(W_WAIT 1.0) ≈ Ecomp12 ≈ Easgn8`. E1의 EL10은 완료 눈금에서 A와 같은 강도를 겨냥한 점 |\n| \"A→B 굶주림 +3.18경기\" | +3.004 gapMax | +0.954 laps | **일치** (0.954 × 3.2 ≈ 3.05경기) |\n| E-knee | 기각 | 미검증 | **기각 확정** (아래 §4) |\n| `.order()` 부재 | \"이론적 위험\" | \"이미 발현 중인 결함\" | **둘 다 부분적.** 순서가 실제로 비시간순인 건 사실(12/24 세션, 8.1% 쌍). 그러나 **현재 그 순서를 읽는 소비자가 없다** — 그룹 재결성 벌점은 `for (const g of groupHistory)` 전수 순회(순서 무관), `lastGameType`은 `transformers.ts:129`에서 이미 `ended_at` 명시 정렬. **결함은 잠복이고 피해는 아직 0이다.** E-comp을 채택할 때만 하중을 받는다 |\n\n### 내가 다시 돌린 표 (200시드 × 10세션, paired, SE는 세션 SE의 RMS/k)\n\n절대값 — 무교란:\n\n| 변형 | lapMax(바퀴) | b2b | 개인 최다동반 | gcStd | ghost팀/세션 | 실제 최장 휴식(분) | 코트유휴(분) | wallclock(분) |\n|---|---|---|---|---|---|---|---|---|\n| **A (현행)** | 2.908 | **0.326** | **2.823** | 0.573 | 13.73 | 31.39 | 78.67 | 192.40 |\n| B (W_WAIT 제거) | 3.867 | 0.323 | 2.787 | 0.604 | 3.50 | 40.26 | 33.73 | 177.93 |\n| **AG (가드만)** | 2.764 | 0.378 | 2.894 | 0.555 | 2.50 | 26.03 | 28.54 | 176.49 |\n| Ecomp6 | 2.986 | 0.335 | 2.820 | 0.560 | 2.85 | 29.46 | 30.32 | 176.97 |\n| Ecomp8 | 2.891 | 0.347 | 2.837 | 0.550 | 2.73 | 28.19 | 29.37 | 176.70 |\n| Ecomp12 | 2.750 | 0.374 | 2.891 | 0.551 | 2.58 | 26.41 | 28.64 | 176.53 |\n| Easgn6 | 2.880 | 0.351 | 2.848 | 0.554 | 2.10 | 29.46 | 26.04 | 175.84 |\n| **Easgn8 (권고)** | **2.755** | **0.366** | **2.869** | **0.540** | **1.87** | **28.17** | **24.77** | **175.50** |\n| Easgn12 | 2.570 | 0.399 | 2.935 | 0.540 | 1.49 | 26.37 | 22.61 | 174.91 |\n\n**등강도 비교 — 이것이 눈금 선택의 결정적 근거다.** 굶주림 강도를 맞춘 세 점(lapMax 2.75~2.76):\n\n| | lapMax | b2b | 개인 최다동반 | gcStd | ghost | 코트유휴 |\n|---|---|---|---|---|---|---|\n| AG (시계) | 2.764 | 0.3783 | 2.894 | 0.555 | 2.50 | 28.54 |\n| Ecomp12 (완료 순번) | 2.750 | 0.3743 | 2.891 | 0.551 | 2.58 | 28.64 |\n| **Easgn8 (배정 순번)** | **2.755** | **0.3658** | **2.869** | **0.540** | **1.87** | **24.77** |\n\n**같은 굶주림 보호 수준에서 배정 눈금이 나머지 전 축을 이긴다.** Easgn8 − AG paired: b2b **−0.0125±0.0014**(8/10 세션), 최다동반 **−0.0245±0.0046**(8/10), gcStd **−0.0153±0.0026**(10/10), ghost **−0.63±0.035**(9/10), 유휴 **−3.77±0.29분**(9/10), lapMax −0.0095±0.0066(유의하지 않음). **약한 파레토 우위**다.\n\n---\n\n## 4. 기각안의 근거\n\n**E-comp (완료 순번) 기각** — 근거 셋.\n\n1. `complete_match`가 `v_now TIMESTAMPTZ := NOW()` **하나**를 선언해 `matches.ended_at = v_now`와 `session_players.wait_since = v_now`에 동시에 쓴다(`supabase/migrations/20260817020000_advisor_function_search_path.sql:214/223/242`). 완료 순번은 대기 시각의 단조 변환이고 **오염원이 문자 그대로 동일**하다. \"시간값이 못 믿을 값\"이라는 문제 제기에 대한 답으로 성립하지 않는다.\n2. 오차가 유한해질 뿐 사라지지 않는다. 완료 클릭 이연 교란에서 물리 공통성분(B) 보정 후 열화 비율(AG=1.00): **Ecomp8 0.56 → 0.77**(이연 1→4단계). **Easgn8은 0.25 → 0.36으로 평평하다.**\n3. 배열 순서 의존을 새로 만든다. `.order()` 필수화 + 배치 완료 시 배치 내부 순서가 임의 → 그 선수들의 `rounds`가 ±(배치크기−1) 흔들린다. 배정 눈금은 애초에 배열이 필요 없다(스칼라 두 개).\n\n**E-knee (문턱형) 기각** — 설계 의도가 데이터로 무너진다. `laps` 실측 분포(대기 후보 121,327 관측): p50 **0.333**, p75 0.75, p90 **1.50**, p95 **2.00**, max 4.0. laps &gt; 2.0은 **2.1%**뿐이다. θ=2.0이면 후보의 98%에서 항이 정확히 0이 되어 점수가 판수 동점으로 붕괴 → 사실상 기각안 B로 퇴화한다. 실측: `Kc25t20` lapMax **3.241** (A 2.910·AG 2.762보다 나쁨), `Kc25t15` **3.043**. 유일하게 lapMax가 좋은 `Ka25t10`(2.445)은 b2b **0.4445**로 전 변형 최악 — 공짜가 아니라 같은 곡선 위의 다른 점이다. \"정상 구간 부작용 0\"은 존재하지 않는다.\n\n**B(W_WAIT 제거) 기각 유지** — lapMax +0.958±0.011(A 대비), 실제 최장 휴식 **+8.87분**, gcStd +0.031. 재확인됨.\n\n---\n\n## 5. 이 선택의 실제 비용 — 숨기지 않고 적는다\n\n가드를 넣으면 **b2b(직전 경기 동반자 잔류)가 0.326 → 0.378로 오른다.** b2b는 2026-08 민원 감사(§4c)가 채택한 체감 지표다. 이걸 그냥 넘기면 안 된다.\n\n기전: 경기중 후보를 안 뽑게 되면 후보 풀이 \"대기 코호트\"로 좁아지고, 그 코호트가 4인 단위로 동조 순환한다. (같은 눈금으로 가드만 끄면 b2b는 A보다 낮아진다 — 즉 눈금 탓이 아니다.)\n\n그런데 **체감 지표로 환산하면 인지 불가 대역이다.**\n\n| 변형 | b2b Δ | 개인 최다동반 Δ | 런북 §4c 판정 기준 |\n|---|---|---|---|\n| AG | +0.052 | **+0.071±0.005** | 가중치 튜닝 실현 이득 0.02~0.08회 = **인지 불가** |\n| Easgn6 | +0.025 | +0.025 | 인지 불가 |\n| **Easgn8** | +0.040 | **+0.046** | 인지 불가 |\n| Easgn12 | +0.073 | **+0.113** | **인지 가능 영역 진입 → 채택 불가** |\n\n이것이 W_LAP 상한을 8로 묶는 이유다. 그리고 되받는 것이 크다 — **실제로 쉰 시간의 최댓값이 31.4분 → 28.2분으로 줄고**(전 가드 변형에서 개선), 세션이 **16.9분 짧아지며**, 코트 유휴가 **78.7 → 24.8분**으로 준다. 즉 완료 순번 축에서 재는 굶주림과 시계 축에서 재는 굶주림이 **둘 다** 좋아진다.\n\n**세션별 이질성 경고**: b2b·최다동반 비용은 **4코트 세션에 집중**된다(106·107·108·159에서 b2b +0.06~+0.13). 2코트 세션(56·72·133)에서는 0이거나 음수다. 런북 §4c의 \"코트를 늘리면 악화(μ = 6M/C(N,2))\"와 같은 축이다. 인원 대비 코트가 많은 날에 관측을 집중하라.\n\n---\n\n## 6. 구현 계획\n\n### 단계 1 — 경기중 가드 (즉시, DB 무수정)\n\n| 파일 | 변경 |\n|---|---|\n| `src/lib/teamSelection/rankCandidates.ts` | `RankContext`에 `playingIds?: ReadonlySet&lt;string&gt;` 추가. `computeScore`의 **대기 항 두 곳**(L143·L196 — `confirmed.length === 0` 조기반환 경로와 일반 경로)에서 `context.playingIds?.has(candidate.id)`면 `waitMinutes = 0`. 헬퍼 하나로 합칠 것 |\n| `src/lib/teamSelection/recommendTeammates.ts` | 변경 없음 (`RecommendContext extends RankContext`이고 이미 `playingIds`를 갖는다) |\n| `src/lib/board/recommendPool.ts` | 변경 없음 (`ctx`에 이미 `playingIds` 주입) |\n| `src/lib/teamSelection/recommendTeammates.test.ts` | L258 \"오래 기다린 후보 우선\" 테스트에 **경기중 후보는 대기 항이 0**이라는 케이스 추가. L141·L344 기존 테스트는 그대로 통과해야 함(회귀 가드) |\n\nDB 마이그레이션: **없음.** Edge Function: 없음. 배포: `git push`(GitHub Pages)만.\n\n### 단계 2 — 배정 눈금 (다음 릴리스, 마이그레이션 1건)\n\n**DB**\n- `session_players.last_assigned_at_match INT` 추가. 기본값/백필 = `jo
... (truncated 14322 chars, full result in /private/tmp/claude-501/-Users-sam-Projects-cocktime-scheduler/3f55537b-2550-4837-b3ff-af3d3ab4a607/tasks/wheup4fqk.output)</result>
<diagnostics>Per-agent results: /Users/sam/.claude/projects/-Users-sam-Projects-cocktime-scheduler/fb17b865-9b02-4f23-8b26-6ca7eccd463f/subagents/workflows/wf_d118c022-7c9/journal.jsonl — one {"type":"result",...} line per completed agent with its full return value.
If the result above is empty or unexpected, Read this file BEFORE diagnosing — do not assume agents returned non-empty results.
To re-run with edited post-processing: Workflow({scriptPath: '/Users/sam/.claude/projects/-Users-sam-Projects-cocktime-scheduler/fb17b865-9b02-4f23-8b26-6ca7eccd463f/workflows/scripts/ordinal-wait-scale-wf_d118c022-7c9.js', resumeFromRunId: 'wf_d118c022-7c9'}) — agents whose (prompt, opts) are unchanged replay from cache.</diagnostics>
<usage><agent_count>5</agent_count><agents_done>5</agents_done><agents_error>0</agents_error><agents_skipped>0</agents_skipped><agents_empty_result>0</agents_empty_result><subagent_tokens>823584</subagent_tokens><tool_uses>254</tool_uses><duration_ms>6707645</duration_ms></usage>
</task-notification>

**Answer**: _(응답 대기 중…)_

---

## #121

**Prompt**: Your claude.ai usage limit has reset. Continue the task you were working on when the limit was reached; do not repeat work that is already complete.

**Answer**: ## 정정 — 제 직전 제안의 전제가 틀렸습니다

완료 순번으로 눈금을 바꾸면 오염이 빠진다고 했는데, 아닙니다. `complete_match`가 `v_now := NOW()`를 **한 번 선언해서 `matches.ended_at`과 `session_players.wait_since`에 동시에 씁니다**(`20260817020000_advisor_function_search_path.sql:214/223/242`). 완료 순번과 대기 시각은 **문자 그대로 같은 값**입니다. 오염원이 동일하니 눈금만 완료 순번으로 바꾸면 아무것도 안 바뀝니다. 몰아서 누른 70건 묶음 안에서는 순서 자체가 임의라 오히려 새 노이즈가 붙습니다.

## 대신 훨씬 싼 답이 나왔습니다

시간값이 못 믿을 값인 건 맞는데, **지금 실제로 아픈 건 눈금이 아니라 "경기중인 사람에게도 시계가 돈다"는 쪽입니다.** 그리고 그건 시계를 안 건드리고 고칠 수 있습니다.

가드 한 줄 — `ctx.playingIds.has(후보)`면 대기 항 0:

| | 현행 | 가드만 | 가드+배정눈금 |
|---|---|---|---|
| ghost 팀/세션 | 13.73 | **2.50** | 1.87 |
| 코트 유휴 | 78.7분 | **28.5분** | 24.8분 |
| 세션 wallclock | 192.4분 | **176.5분** | 175.5분 |
| 실제 최장 휴식 | 31.4분 | **26.0분** | 28.2분 |
| 판수 std | 0.573 | 0.555 | 0.540 |

**DB 수정 0, 상수 변경 0.** `rankCandidates.ts`의 대기 항 두 곳(L143·L196)에 가드를 넣는 게 전부입니다.

그리고 **지난번에 제가 권한 SQL 마이그레이션은 불필요합니다 — 측정이 아니라 증명으로.** `assign_match`가 쓴 `wait_since`는 선수가 playing인 동안에만 읽히고 완료 시 `complete_match`가 덮어씁니다. 가드는 정확히 그 구간의 대기 항을 0으로 만듭니다. 따라서 `A+R+가드 ≡ 가드`가 항등식이고, 시뮬에서도 비트 단위로 같게 나왔습니다.

## 눈금 교체는 여전히 가치 있습니다 — 단 배정 카운터로

`sessions.match_assign_count` 기반(`laps = (match_assign_count − last_assigned_at_match) / 코트수`, **W_LAP = 8**). 완료 눈금과 달리 이건 시각이 아니라 **카운터 증가**라 완료 버튼 이연에 평평합니다(교란 4단계에서 열화 비율 Easgn8 0.36 vs Ecomp8 0.77).

굶주림 강도를 맞춘 등강도 비교에서 시계 눈금 대비 **약한 파레토 우위**입니다 — b2b −0.0125, 최다동반 −0.0245, 판수 std −0.0153, ghost −0.63, 유휴 −3.8분(전부 8~10/10 세션에서 같은 방향). W_LAP은 8이 상한입니다. 12로 올리면 최다동반이 +0.113으로 **체감 가능 영역**에 들어가 못 씁니다.

문턱형은 기각됐습니다. `laps` 실측 분포가 p90 1.50 / p95 2.00이라 θ=2면 후보의 98%에서 항이 0이 되어 사실상 "제거"로 퇴화합니다.

## 덤으로, 지금 불변식이 깨져 있습니다

현행 `waitMinutes`에는 상한이 없습니다. 프로덕션에서 직접 재봤습니다(편성 시점 대기 후보 4,849건):

| 대기 보너스가 단독으로 넘는 항 | 비율 |
|---|---|
| W_GROUP2 8 (2인 겹침) | 22.0% |
| **W_GAME 10 (판수 1판)** | **16.5%** |
| W_GROUP3 24 (3인 겹침) | 1.38% |
| W_PLAYING 30 | 0.89% |
| **W_GROUP4 60 (완전 재결성 금지)** | **0.06% (3건)**, max 63분 |

**"오래 기다렸다"가 "같은 4명 다시 뭉치지 마라"를 이기는 상태가 실제로 존재합니다.** 순번 눈금은 이산이라 구조적으로 상한이 생깁니다(W_LAP 8 기준, 후보 간 산포 p90−p50 ≈ 1.2 laps ≈ 9.6점 — 딱 1판까지만 뒤집고 재결성·성별은 못 넘습니다).

## 비용

가드를 넣으면 **b2b가 0.326 → 0.378**로 오릅니다. 경기중 후보를 안 뽑으면 풀이 대기 코호트로 좁아져 4인 단위로 동조 순환하기 때문입니다. 개인 최다동반으로 환산하면 +0.071회인데, 런북 §4c 기준으로 **인지 불가 대역**입니다(가중치 튜닝 실현 이득이 통상 0.02~0.08회). 배정 눈금까지 가면 +0.046으로 줄어듭니다. 비용은 **4코트 세션에 집중**되니 관측을 거기 맞추면 됩니다.

---

**제안**: 단계 1(가드)만 먼저 넣고 1~2세션 보고, 그 다음에 단계 2(배정 눈금)를 별도 릴리스로. 섞으면 b2b 변동의 원인 귀속이 불가능해집니다. 지난번 얘기한 동점 무작위화(첫 픽의 22%가 정확 동점, 그중 81%가 직전 동반 4인)는 별개 결함이라 단계 1과 같이 가도 됩니다.

단계 1 구현할까요? `rankCandidates.ts` 대기 항 두 곳 + `RankContext`에 `playingIds` 추가 + 테스트, 프론트만이라 `git push`로 끝나고 롤백은 한 줄입니다. 규칙대로 `docs/TEAM_GENERATION_RULES.md`도 같이 갱신하겠습니다.

---

## #122

**Prompt**: <task-notification>
<task-type>artifact-watch-lifecycle</task-type>
<summary>Stopped watching Artifact: "만나는 사람만 만나는가" (could not reconnect)</summary>
<event>Watch on https://claude.ai/code/artifact/56280a73-4f3e-4cc9-9b0c-1c4fe1fb2f86 ended — no such artifact for this account (it was deleted, or it has not been shared with the user). This session will no longer hear when it is republished; watch it again if you still need that.</event>
</task-notification>

**Answer**: 앞서 드린 감사 보고서 아티팩트(`만나는 사람만 만나는가`) 링크가 더 이상 조회되지 않는다는 알림이 왔습니다 — 삭제됐거나 계정에서 접근이 안 되는 상태입니다. 원본 HTML은 스크래치패드에 그대로 있으니 필요하시면 다시 게시해 새 링크를 드리겠습니다.

작업 자체는 그대로 대기 중입니다: **단계 1(경기중 가드)** 구현할지만 알려주시면 됩니다.

---

## #123

**Prompt**: 다시 게시하고 링크주고 구현해

**Answer**: **아티팩트 재게시:** https://claude.ai/code/artifact/e7cb7601-8081-41de-8b29-49336746549d

기존 URL은 삭제돼 업데이트가 거부돼서 새 주소로 발급했습니다. 내용은 동일합니다.

## 단계 1 구현 완료

**`src/lib/teamSelection/rankCandidates.ts`**
- `RankContext`에 `playingIds?: ReadonlySet<string>` 추가 (선택 필드 — 미지정이면 구 동작, 순수 함수 테스트 편의)
- `waitMinutesOf()` / `waitCostOf()` 헬퍼 추출 → 대기 항 계산이 두 군데 중복돼 있던 걸 한 곳으로 모으고, 경기중 후보면 0
- 두 경로 모두 적용: `confirmed.length === 0` 조기반환 경로와 일반 경로

**`src/lib/teamSelection/recommendTeammates.ts`**
- `W_WAIT` 주석에서 거짓이던 문장("계속 못 들어간 사람만 값이 커진다")을 걷어내고 가드와 상한 없음 한계를 근거 수치와 함께 기재
- 배선은 변경 없음 — `RecommendContext extends RankContext`가 이미 `playingIds`를 필수로 갖고 있어서 그대로 흘러갑니다

**테스트 3건 추가** (전체 345개 통과, lint·typecheck 클린)
- 경기중 후보의 `breakdown.wait === 0`이고, 대기 조건이 같을 때 실효 페널티가 `W_PLAYING`으로 고정됨
- `confirmed` 0명 경로에서도 작동 — 대기 30분인 경기중 후보가 대기 10분인 대기 후보를 못 앞지름
- **`W_PLAYING: 0`으로 재계산하는 다이얼로그 경로에서도 가드 유지** — 대기 보정은 페널티가 아니라 사실 보정이라 그 경로에서 살아 있어야 합니다(`useTeammateRecommendations.ts:87`)

**`docs/TEAM_GENERATION_RULES.md`** (프로젝트 규칙상 동시 갱신)
- `waitMinutes` 정의·`wait_since` RPC 설명·`W_WAIT` 가중치 행·`playingIds` 용도에 가드 반영
- §7-4의 거짓 서술 교체 + **알려진 한계 두 개**를 근거 수치와 함께 신설: ① 대기 항에 상한이 없어 16.5%가 판수 1판을, 3건은 `W_GROUP4`(60)까지 단독으로 넘음 ② `complete_match`가 4명의 `wait_since`를 동일값으로 세팅해 **직전에 함께 뛴 4인을 서로 가르지 못함**
- §8에 공칭 30 vs **실효 20** 구분 추가, `W_GROUP4 40` 오타를 60으로 수정

구현 중 하나 발견한 게 있습니다. 대기 0이면 `wait`가 `-0`으로 나오고 있었습니다(`-waitMinutes * W_WAIT`). 값은 같지만 디버그 분해표에 `-0`이 찍히니 `waitCostOf`에서 0으로 정규화했습니다.

DB 마이그레이션·Edge Function 변경 없으니 배포는 `git push`(GitHub Pages)만 하면 됩니다. **커밋은 안 했고 스테이징만** 해뒀습니다 — `/commit`으로 마무리하시거나, 제가 이어서 할까요?

배포 후 1~2세션은 **코트 유휴 p90(현행 7.33분)**과 **타코트 30초 내 재투입(현행 1.37%)** 두 개만 보시면 효과가 바로 보입니다. b2b는 3%p 정도 오르는 게 예상 범위이고, +9%p를 넘으면 롤백 신호입니다.

---

## #124

**Prompt**: 커밋하고 배포해

**Answer**: 배포 완료했습니다.

**커밋** `5e7d490` — `자동편성: 경기중 후보의 대기 항 차단 — 실효 ghost 페널티 고정` (5 files, +586/−18)

**배포** GitHub Actions `Deploy` 성공 → https://ckti.me 반영됨 ([run](https://github.com/Yria/cocktime-scheduler/actions/runs/32383911986))

DB 마이그레이션·Edge Function 변경이 없어서 `supabase db push`나 `functions deploy`는 필요 없습니다. 프론트만 나갔습니다.

히스토리는 훅이 `.agent-history/main.md`에 `#124`로 기록 중이라 이번 커밋에는 자리표시자 상태로 들어갔습니다(다음 커밋에 채워진 본문이 따라옵니다).

## 다음 세션에 볼 것

배포 직후 첫 세션부터 방향이 보입니다:

| 지표 | 현행 baseline | 성공 기준 |
|---|---|---|
| 코트 유휴 p90 | 7.33분 | ≤ 6.0분 |
| 유휴 5분 초과 비율 | 14.3% | ≤ 11% |
| 타코트 30초 내 재투입 | 1.37% | ≤ 0.6% |
| b2b | 감사 기준 널 대비 +5.1%p | **+9%p 넘으면 롤백 신호** |

재투입 지표를 볼 때 **같은 코트 잔류(78건)는 반드시 빼고** 세야 합니다 — 그건 "그 코트가 마침 비었다"이지 ghost가 아니라서, 안 빼면 baseline이 6.45%로 잡혀 개선이 안 보입니다. 세션 끝나면 제가 스크래치패드 스크립트로 계산해 드릴 수 있습니다.

롤백은 `git revert 5e7d490` + push로 분 단위입니다.

남은 두 건은 아직 안 건드렸습니다 — **동점 무작위화**(첫 픽의 22%가 정확 동점, 그중 81%가 직전 동반 4인이라 같은 사람이 항상 이기는 문제)와 **배정 순번 눈금**(W_LAP 8, 컬럼 1개 + RPC 수정). 이번 변경 효과를 1~2세션 확인한 뒤에 하시는 게 원인 귀속이 깨끗합니다.

---

## #125

**Prompt**: <task-notification>
<task-type>artifact-watch-lifecycle</task-type>
<summary>Stopped watching Artifact: "만나는 사람만 만나는가" (could not reconnect)</summary>
<event>Watch on https://claude.ai/code/artifact/e7cb7601-8081-41de-8b29-49336746549d ended — no such artifact for this account (it was deleted, or it has not been shared with the user). This session will no longer hear when it is republished; watch it again if you still need that.</event>
</task-notification>

**Answer**: 두 번째 아티팩트(`e7cb7601…`)도 게시 직후 같은 이유로 감시가 끊겼습니다. 두 번 연속 같은 패턴이라 계정 쪽에서 아티팩트가 유지되지 않는 것으로 보입니다 — 링크가 열리지 않을 수 있습니다.

원본은 `scratchpad/meeting-balance-audit.html`에 그대로 있으니, 링크가 안 열리면 파일을 프로젝트 안(예: `docs/`)으로 옮겨 두거나 감사 내용을 마크다운으로 `docs/MATCH_LOG_ANALYSIS.md`에 §4d로 붙여드리는 편이 확실합니다. 어느 쪽으로 할까요?

커밋·배포는 정상 완료된 상태라 이 건과는 무관합니다.

---

## #126

**Prompt**: Cached egress (Bandwidth): 8.78 GB of 5.5 GB 이거땜에 슈파베이스 결제했는데 뭐가 문제일까

**Answer**: _(응답 대기 중…)_

---

## #127

**Prompt**: Cached egress (Bandwidth): 8.78 GB of 5.5 GBCached egress (Bandwidth): 8.78 GB of 5.5 GB 이거땸에 슈파베이스 결제햤는데 뭐가문제일까

**Answer**: 조사를 백그라운드로 6개 렌즈 병렬 실행했습니다. 진행 중에 지금까지 확인된 것만 먼저 정리하면:

**측정된 사실**
- Storage 버킷은 `player-photos` 하나뿐 — 객체 216개, **총 4.5 MB**, 평균 21 kB
- 즉 8.78 GB는 그 버킷 전체를 **약 1,970번** 다시 내보낸 양

**가장 유력한 용의자 (검증 중)**
- `src/lib/playerPhotoUpload.ts:89` — 업로드 시 `cacheControl: "600"`, 즉 **max-age 10분**. 이미 `?v={photo_updated_at}` 캐시버스팅이 있어서 캐시를 1년 immutable로 잡아도 안전한데, 10분마다 브라우저·CDN이 사진 전량을 다시 받아갑니다. 명단 화면 한 번 열 때 수십 장 × 21 kB가 10분 주기로 반복되면 수 GB는 쉽게 쌓입니다.

지금 돌고 있는 조사에서 확인하는 것:
1. edge 로그 24시간치로 **경로별 실제 바이트 랭킹** (Storage vs REST vs Realtime 비중)
2. 화면별 동시 `<img>` 개수 정량화 + 같은 사진이 서로 다른 URL로 중복 요청되는지
3. 실제 응답 헤더 실측 (`cf-cache-status`, ETag 304 동작, 쿼리스트링이 CDN 캐시키에 포함되는지)
4. 트래픽 주체 — 사람 사용량으로 8.78 GB가 산식이 맞는지, 아니면 폭주 루프인지
5. 처방별 절감량 (immutable 캐시 / WebP·해상도 축소 / 서비스워커 캐시 / Storage 우회)

각 발견은 별도 에이전트가 **반증을 시도**해서 살아남은 것만 보고합니다. 완료되면 수치 근거가 붙은 진단서를 드리겠습니다.

---

## #128

**Prompt**: <task-notification>
<task-id>wsrkyi47k</task-id>
<tool-use-id>toolu_01SfWgeZXRSKpsQE3aem5jKM</tool-use-id>
<output-file>/private/tmp/claude-501/-Users-sam-Projects-cocktime-scheduler/0ebf05b6-201a-43b2-88f5-f7ca1b802293/tasks/wsrkyi47k.output</output-file>
<status>completed</status>
<summary>Dynamic workflow "Supabase Cached egress 8.78GB 초과 원인 규명 (프로덕션 로그 + 코드 감사 + 검증)" completed</summary>
<result>{"report":"# Supabase Cached egress 8.78 GB 진단서\n\n## 1. 결론\n\n**확실한 것**: 8.78 GB는 사실상 전부 `player-photos` 버킷의 아바타 사진이다. 최근 24시간(진단용 curl 제외) 실측으로 사진 객체가 **9,595건의 전체본문 200 응답 = 331.4 MB/일**을 냈고, 30일 환산 **9.94 GB**로 대시보드 수치와 같은 자릿수다. 그리고 이 사진 응답은 `cf_cache_status: HIT`인데 REST·Auth·Realtime은 **전량 DYNAMIC**(CDN 캐시 대상 자체가 아님)이므로, \"Cached egress\"라는 지표에 들어올 수 있는 것은 구조적으로 사진뿐이다. 그 안에서도 **20 kB 이상 객체 24개가 316.2 MB/일 = 95.4%**를 만든다. 원인은 두 개가 곱해진 것이다 — ① 28~96 px로 그리는 아바타를 512×512 / q0.85(평균 64 kB, 최대 152 kB)로 저장하고, ② 최대 소비자인 iOS가 본문을 보관하지 않아(200 5,975건 vs 304 936건 = 86.5%가 전체본문) 매번 그 바이트를 다시 받는다.\n\n**추정인 것**: 월 환산은 전부 이 하루(평일)의 ×30 외삽이다(무료 플랜 로그 보존 1일). 청구주기 시작일을 확인할 수 없어(`/v1/projects/{ref}/usage`·`/v1/organizations/{slug}/usage` 모두 404) 8.78 GB가 며칠 누적인지 모른다 — 달력월(8/1~8/21, 20.5일)로 보면 사진이 77%, 가입기념일 기준 26.5일 누적으로 보면 100%다. REST 바이트는 로그로 측정 불가(chunked+gzip)해서 실제 URL 재생 실측(약 19.4 MB/일)에 요청수를 곱한 추정이며, 이건 Cached egress가 아니라 별도 쿼터다. Realtime WebSocket 페이로드는 어떤 로그에도 바이트가 남지 않아 **측정 불가**다(단 DYNAMIC이므로 이 청구서와 무관).\n\n---\n\n## 2. egress 수지 표\n\n기준: 최근 24h edge_logs, `user_agent not like 'curl%'`(진단 자기오염 제거).\n\n| 원천 | 실측 요청/일 | 바이트/일 | GB/30일 | Cached egress 기여 | 근거 |\n|---|---|---|---|---|---|\n| **player-photos 객체 200 (CDN HIT)** | 9,595 | **331.4 MB** | **9.94** | 100% | `sum(content_length)` = 331,382,742 B |\n| ├ ≥20 kB 객체 24개 | 5,043 | 316.2 MB | 9.49 | 95.4% | content_length 밴드 분해 |\n| └ &lt;20 kB 객체 23개 | 4,552 | 15.2 MB | 0.46 | 4.6% | 같은 쿼리 |\n| player-photos 304 | 6,011 | 0 B | 0 | 0 | 본문 없음 |\n| player-photos 400 | 7 | 616 B | ~0 | ~0 | 존재하지 않는 키 |\n| `/rest/v1/*` | 17,296 (200) + 651 (204) + 518 (201) | ~19.4 MB *(추정)* | 0.58 *(추정)* | **0** — 전량 DYNAMIC | content_length 없음(chunked+gzip). 서비스키로 실제 URL 재생한 gzip 실측 기반 |\n| `/auth/v1/*` | 468 | 243 B | ~0 | 0 | 실측 |\n| `/realtime/v1/websocket` | 790 (101 업그레이드) | **측정 불가** | 미상 | 0 (DYNAMIC) | WS 프레임 바이트가 edge_logs·realtime_logs 어디에도 없음 |\n| Edge Functions | 0 | 0 | 0 | 0 | 24h 내 호출 0건 |\n| `/storage/v1/render/*` | 0 (실사용자) | 0 | 0 | 0 | `grep -rn \"render/image\" src/` = 0건. 앱은 이 경로를 쓰지 않음 |\n| **Cached egress 합계** | | **331.4 MB** | **9.94** | | |\n\n**8.78 GB와의 대조**\n\n- 청구주기 = 달력월 가정(8/1~8/21 = 20.5일): 필요 속도 0.428 GB/일 vs 사진 실측 0.331 GB/일 → 사진 **77.4%**, **미설명 0.097 GB/일 (누적 약 2.0 GB)**.\n- 청구주기 = 가입기념일 가정: 8.78 ÷ 0.331 = **26.5일** → 주기 시작이 7/26 전후라면 사진 단독으로 **100%** 설명.\n- **미설명분의 후보는 다른 서비스가 아니다.** REST/Auth/Realtime은 전량 `cf_cache_status=DYNAMIC`이라 이 지표에 들어올 수 없다. 남는 설명은 (a) 청구주기 시작일이 8/1이 아니다, (b) 월초 트래픽이 이 하루보다 높았다 — 둘 다 로그 보존 1일 때문에 **검증 불가**.\n\n---\n\n## 3. 근본 원인 (기여도 순)\n\n### 원인 1 — 업로드 인코딩이 표시 크기의 수십 배 (바이트의 95.4%)\n\n`src/lib/playerPhotoUpload.ts:19-20`\n```\nexport async function processImageToSquareJpeg(file: File, size = 512, quality = 0.85)\n```\n유일한 호출부 `src/components/ProfileSetup.tsx:72`가 `processImageToSquareJpeg(file)` — 인자를 넘기지 않으므로 **항상 512×512 / q0.85**가 적용된다.\n\n수치 근거:\n- 앱 업로드분 65개: 합 4,165,246 B, **평균 64,081 B, 최대 155,192 B**\n- 실제 서빙되는 live 집합 69개 중 ≥20 kB **30개가 2,049,838 B = live 바이트의 93.7%** (평균 68,328 B)\n- 트래픽 기준: ≥20 kB **24개 객체가 5,043회 전체본문 200 = 316.2 MB/일 = 사진 egress의 95.4%**\n- 표시 크기: `PlayerAvatar` 기본 32 px, 호출부 28/34/44/88/96, 보드 자석 `src/lib/board/constants.ts:2` `MAGNET_SIZE = 64`. 512 px가 필요한 자리는 `src/components/admin/MemberPhotoModal.tsx:36-46`(전체폭 `&lt;img&gt;`, 약 348 CSS px) 단 하나이며 이건 운영진 전용 저트래픽 경로다.\n- 대조군(같은 앱·같은 24시간): 레거시 128 px/q60 산출물 23개는 4,552회 요청에 15.2 MB뿐. **요청 수는 거의 같은데 바이트가 21배 차이** — 크기가 원인이라는 통제된 증거다.\n\n### 원인 2 — 최대 소비자가 본문을 보관하지 않는다 (승수)\n\n실측 상태코드 분해(24h, 사진 객체):\n\n| 클라이언트 | 200 (전체본문) | 304 (0 B) | 전체본문 비율 |\n|---|---|---|---|\n| iPhone | **5,975** | 936 | **86.5%** |\n| Android | 3,417 | 4,598 | 42.6% |\n\nAndroid는 캐시가 정상 동작해 대부분 0바이트 304를 받는다. iOS는 거의 매번 전체본문을 받는다 — 엔티티가 남아 있지 않다는 뜻이고, 그래서 원인 1의 바이트가 그대로 반복 곱해진다. 백스톱도 없다: `public/sw.js:14`의 fetch 핸들러는 `event.request.mode === \"navigate\"`만 가로채고 이미지는 통과시키며, 파일 첫 줄이 스스로 \"웹푸시 전용 (오프라인 캐싱 없음)\"이라 명시한다(`caches.*` 사용 0건).\n\n### 원인 3 — 캐시 헤더가 10분 (3순위, 바이트 기여는 작다)\n\n`src/lib/playerPhotoUpload.ts:73` `cacheControl: \"600\"`. `src/lib/playerPhoto.ts:88-94` `buildUrl()`이 이미 `?v={photo_updated_at}`로 content-addressed URL을 만드는데도 TTL이 10분이다.\n\n**단, 이걸 1년으로 올려도 바이트는 거의 안 준다.** 오늘 실측 GET 헤더는 정상적으로 `public, max-age=600`을 반환하고 있고(§5 함정 1 참조), 그 상태에서 Android는 이미 4,598건을 0바이트 304로 처리하고 있다. 즉 TTL 연장으로 사라지는 것은 **0바이트짜리 304 왕복**이지 바이트가 아니다. 그리고 iOS는 만료 여부와 무관하게 본문을 잃는다.\n\n부수적으로 레거시 경로가 만든 `no-cache` 151개(합 503,913 B, 평균 3,337 B)는 매 표시마다 왕복을 강제하지만 **바이트 기여는 4.6%**이고, 그 중 110개는 md5 파일명이라 현재 앱이 요청조차 하지 않는다.\n\n### 원인 4 — 구조적 곱셈 (병리 아님)\n\n47개 객체가 9,595회 전체본문으로 나갔다 = **객체당 204회/일**. 158개 IP(모바일 IP 로테이션이라 기기 수 아님). 시간대 곡선이 저녁 피크의 사람 활동 형태이고 크롤러 UA는 0건이므로 루프·봇·모니터링이 아니다. \"명단 전원의 사진을 한 화면에 그리는 화면 × 하루 여러 번 열람\"이라는 정상 사용의 곱셈이며, 따라서 손댈 레버는 요청 수가 아니라 **응답당 바이트**다.\n\n---\n\n## 4. 처방\n\n### 즉시 조치 (둘 중 하나 — 이것만으로 한도 아래로 내려간다)\n\n**A. `render/image` 변환 경로로 표시 크기만 받기** — 마이그레이션 불필요\n\n`src/lib/playerPhoto.ts:93`의 base URL을 `/storage/v1/object/public/...` → `/storage/v1/render/image/public/...?width=128&amp;height=128&amp;resize=cover&amp;quality=70`으로 바꾼다. 관리자 모달만 큰 width로 별도 요청.\n\n오늘 실측(원본 148,926 B, 최대 객체):\n\n| width | JPEG | WebP(Accept 자동협상) |\n|---|---|---|\n| 96 | 2,415 B | **1,766 B** |\n| 128 | 3,575 B | **2,772 B** |\n| 192 | 6,688 B | 5,754 B |\n| 256 | 13,416 B | 13,396 B |\n\n- **예상 절감: 331 MB/일 → 약 33 MB/일 = 월 9.94 GB → 약 1.0 GB (-90%)**\n- 난이도: **하** (코드 한 줄, 기존 216개 객체 그대로)\n- 리스크: **Image Transformations는 통상 유료 기능이다.** 이 프로젝트에서 `selected_addons: []`인데도 200이 떨어지고 `features.imageTransformation.enabled: true`인 것까지만 확인했다 — 무료 플랜에서 어떻게 미터링/과금되는지는 **확인 불가**. 적용 후 대시보드의 Image transformations 사용량을 반드시 확인할 것. 부수 리스크: 이미 128 px인 작은 41개는 변환하면 오히려 커진다(실측 5,014 → 5,242 B), 크기 임계로 분기하거나 +3 MB/일을 감수.\n\n**B. 업로드 기본값 축소 + 기존 30개 백필** — 과금 불확실성 없음\n\n`src/lib/playerPhotoUpload.ts:19-20`을 `size = 256`(또는 384) / `quality = 0.8`로 낮추고, **동시에** 서비스키 스크립트로 live 대용량 30개를 재인코딩해 `upsert` 재업로드 + `photo_updated_at` 갱신.\n\n- 실측 재인코딩 배율: live 대용량 31개를 256/q80 JPEG로 → 2,058,580 → 709,577 B (×0.345). **월 9.94 → 약 3.9 GB.** 256 WebP면 약 2.3 GB.\n- 난이도: **중** (브라우저 canvas 파이프라인을 못 쓰므로 별도 스크립트, 512 JPEG를 소스로 하니 세대 손실 1회)\n- 리스크: **코드만 고치고 백필을 빼먹으면 절감 0**(기존 객체가 바이트의 95.4%). `size=256`은 `MemberPhotoModal`(전체폭 약 348 CSS px)에서 눈에 보이게 흐려진다 — 그 화면 화질을 지키려면 384, 또는 A와 병행.\n\n### 단기\n\n**C. `cacheControl: \"600\"` → `\"31536000\"`** — `src/lib/playerPhotoUpload.ts:73`\n- 예상 절감: **바이트 0.03~0.17 GB/월** (제거되는 것은 0바이트인 304 왕복 4,598건/일). 실질 이득은 **요청 수** 감소(무료 플랜 호출 폭주 완화).\n- 난이도 중(기존 65개 재업로드 백필 필요 — 소급 적용 안 됨), **리스크 상**.\n- `immutable`을 붙이려면 선행 수정 2개 필수: (i) `playerPhotoUpload.ts:86-88`의 `stampError` 시 `return true` — 파일은 올라갔는데 `photo_updated_at`이 안 찍히면 `?v=`가 그대로여서 옛 사진이 1년 고착된다(현재 600초는 10분 만에 자가치유). (ii) `playerPhoto.ts:92-94`가 인덱스 미수신 시 내보내는 `?v=` 없는 맨 URL도 1년 고착 대상이 된다.\n\n**D. `public/sw.js`에 사진 cache-first 추가** — iOS 본문 미보관을 우회하는 유일한 수단\n- A를 먼저 적용하면 남는 총량이 월 1 GB뿐이라 우선순위 낮음. A 없이 단독 적용 시 상한은 iOS 몫(사진 바이트의 약 60%).\n- 함정 4개: (i) `getInstallState()`(`src/lib/push/platform.ts:53-61`)가 standalone만 `supported`로 판정 → **설치형 PWA에만 SW가 등록된다**, (ii) KakaoTalk 인앱 웹뷰(사진 바이트의 약 1/3)는 대상 밖, (iii) `&lt;img&gt;`가 `crossOrigin` 없이 로드되어 응답이 opaque → `cache.put()`이 조용히 실패한다. SW 안에서 `mode:'cors'`로 재요청해야 하고 그건 `access-control-allow-origin: *`가 확인돼 성립한다, (iv) `?v=` 없는 맨 URL은 cache-first에서 제외.\n\n### 구조 개선\n\n**E. 업로드 시 파생본 2개 저장** (`{id}_s.webp` 아바타용 + 원본) → render 과금 의존 제거. `contentType: \"image/jpeg\"` 하드코딩(`playerPhotoUpload.ts:69`)과 `.jpg` 파일명(`playerPhoto.ts:16-18`)도 함께 손봐야 함. **백필을 URL 전환보다 반드시 먼저** — 부분 백필은 404 반복 폭주를 재현한다(과거 사고 이력).\n\n**F. 고아 객체 147개(2,480,805 B) 정리** — 24h 로그에서 요청 0건. **egress 절감 0, 스토리지 용량만.** 우선순위 최하.\n\n**G. REST 페이로드(추정 0.58 GB/월) 다이어트** — `sessions`/`attendances`의 `select(\"*\")` 좁히기. **Cached egress와 무관한 별도 쿼터**이므로 이번 과금과 분리해서 다룰 것.\n\n---\n\n## 5. 함정\n\n1. **`curl -I`(HEAD)로 진단하면 오판한다.** 오늘 같은 객체에 대해 GET은 `public, max-age=600` + `cf-cache-status: HIT`, HEAD는 `no-cache` + `MISS`를 반환했다. HEAD만 보면 \"헤더 설정이 이미 무력하다\"는 잘못된 결론
... (truncated 3126 chars, full result in /private/tmp/claude-501/-Users-sam-Projects-cocktime-scheduler/0ebf05b6-201a-43b2-88f5-f7ca1b802293/tasks/wsrkyi47k.output)</result>
<diagnostics>Per-agent results: /Users/sam/.claude/projects/-Users-sam-Projects-cocktime-scheduler/0ebf05b6-201a-43b2-88f5-f7ca1b802293/subagents/workflows/wf_5057dabf-4fd/journal.jsonl — one {"type":"result",...} line per completed agent with its full return value.
If the result above is empty or unexpected, Read this file BEFORE diagnosing — do not assume agents returned non-empty results.
To re-run with edited post-processing: Workflow({scriptPath: '/Users/sam/.claude/projects/-Users-sam-Projects-cocktime-scheduler/0ebf05b6-201a-43b2-88f5-f7ca1b802293/workflows/scripts/supabase-egress-forensics-wf_5057dabf-4fd.js', resumeFromRunId: 'wf_5057dabf-4fd'}) — agents whose (prompt, opts) are unchanged replay from cache.</diagnostics>
<failures>[verify:fix-plan] failed: API Error: Connection lost mid-response. The response above may be incomplete.</failures>
<usage><agent_count>31</agent_count><agents_done>30</agents_done><agents_error>1</agents_error><agents_skipped>0</agents_skipped><agents_empty_result>0</agents_empty_result><subagent_tokens>2521586</subagent_tokens><tool_uses>1137</tool_uses><duration_ms>5705467</duration_ms></usage>
</task-notification>

**Answer**: # 진단 결과: 아바타 사진이 전부입니다

먼저 제 초기 추측 하나를 정정합니다. `cacheControl: "600"`을 주범으로 지목했는데, **바이트 기준으로는 아닙니다.** 실측으로 반증됐습니다.

## 무엇이 나갔나 (24h edge 로그 실측, 진단용 curl 제외)

| 원천 | 요청/일 | 바이트/일 | 30일 환산 | Cached egress 기여 |
|---|---|---|---|---|
| **player-photos 200 (전체본문)** | 9,595 | **331.4 MB** | **9.94 GB** | **100%** |
| ├ 20 kB↑ 객체 **24개** | 5,043 | 316.2 MB | 9.49 GB | 95.4% |
| └ 20 kB↓ 객체 23개 | 4,552 | 15.2 MB | 0.46 GB | 4.6% |
| player-photos 304 | 6,011 | 0 B | 0 | 0 |
| `/rest/v1/*` | 18,465 | ~19.4 MB (추정) | 0.58 GB | **0** — 전량 DYNAMIC |
| Realtime / Auth / Functions | 790 / 468 / 0 | — | — | **0** — DYNAMIC |

**REST·Realtime·Auth는 전량 `cf_cache_status=DYNAMIC`** 이라 "Cached egress"라는 지표에 구조적으로 들어올 수 없습니다. 이 계량기는 사실상 Storage 전용입니다. 그리고 사진 응답은 99.7%가 HIT인데 **Supabase는 HIT도 과금**합니다 — 캐시 히트율은 이미 정상이고 개선 여지가 없습니다.

9.94 GB ≈ 8.78 GB, 자릿수가 맞습니다.

## 근본 원인 — 요청 수가 아니라 **응답당 바이트**

**1. 28~96 px로 그리는 아바타를 512×512 / q0.85로 저장 (바이트의 95.4%)**

`src/lib/playerPhotoUpload.ts:19` 기본값이 `size = 512, quality = 0.85`인데, 유일한 호출부 `src/components/ProfileSetup.tsx:72`가 인자를 안 넘기므로 항상 그 값이 적용됩니다. 앱 업로드분 65개 **평균 64 kB, 최대 155 kB**. 그런데 실제 표시 크기는 `PlayerAvatar` 기본 32 px, 호출부 28/34/44/88/96, 보드 자석 64 px. 512 px이 필요한 자리는 `MemberPhotoModal`(약 348 px) 하나뿐이고 운영진 전용입니다.

통제된 증거: 같은 24시간, 레거시 128 px 객체 23개는 요청 수가 거의 같은데(4,552 vs 5,043) **바이트는 1/21**입니다.

**2. iOS가 본문을 보관하지 않는다 (승수)**

| | 200 (전체본문) | 304 (0 B) | 전체본문 비율 |
|---|---|---|---|
| iPhone | **5,975** | 936 | **86.5%** |
| Android | 3,417 | 4,598 | 42.6% |

Android는 캐시가 정상 작동해 대부분 0바이트 304를 받습니다. iOS는 만료와 무관하게 거의 매번 본문을 다시 받아갑니다. `public/sw.js`는 `caches.*` 사용이 0건이라 백스톱도 없습니다.

**3. `cacheControl: "600"` — 3순위, 바이트 기여는 거의 없음**

1년으로 올려서 사라지는 것은 **이미 0바이트인 304 왕복**입니다(절감 상한 0.03~0.17 GB/월). iOS는 만료와 무관하게 본문을 잃습니다. 실질 이득은 대역폭이 아니라 **요청 수** 감소입니다.

## 처방 — 둘 중 하나로 한도 아래로 내려갑니다

**A. `render/image` 변환 경로 (권장, 마이그레이션 불필요)**

`src/lib/playerPhoto.ts:93`의 base URL 한 줄:
`/storage/v1/object/public/...` → `/storage/v1/render/image/public/...?width=128&quality=70`

실측(원본 148,926 B): width 128 → JPEG 3,575 B / **WebP 2,772 B** (Accept 자동협상). 96 px면 1,766 B.
→ **월 9.94 GB → 약 1.0 GB (-90%)**, 난이도 하.

리스크: Image Transformations가 통상 유료 기능입니다. `selected_addons: []`인데도 200이 떨어지고 `features.imageTransformation.enabled: true`인 것까지만 확인했습니다 — 무료 플랜 과금 방식은 확인 불가. **적용 직후 대시보드의 Image transformations 사용량을 확인**하고, B를 백업안으로 남겨두세요. 이미 128 px인 41개는 변환하면 오히려 커지니(5,014 → 5,242 B) 크기로 분기해야 합니다.

**B. 업로드 기본값 축소 + 기존 30개 백필 (과금 불확실성 없음)**

`playerPhotoUpload.ts:19`를 `size = 256`(모달 화질 지키려면 384) / `quality = 0.8`로 낮추고, **동시에** 서비스키 스크립트로 live 대용량 30개를 재인코딩해 upsert. 실측 배율 ×0.345 → **월 약 3.9 GB** (256 WebP면 2.3). 코드만 고치고 백필을 빼면 절감 0입니다 — 기존 객체가 바이트의 95.4%니까요.

## 반드시 알아야 할 함정 3개

1. **`curl -I`(HEAD)는 거짓말합니다.** 같은 객체가 GET은 `max-age=600` + HIT, HEAD는 `no-cache` + MISS를 반환합니다. 브라우저 이미지 로드는 GET이므로 GET이 진실입니다.
2. **`?v=` 범프로 CDN을 우회할 수 없습니다.** Smart CDN이 캐시 키에서 쿼리스트링을 제거합니다 — 한 번도 쓰지 않은 `?probe=난수`가 첫 요청부터 HIT였습니다. 백필은 반드시 **실제 upsert 재업로드**여야 합니다.
3. **`cacheControl`은 업로드 시점에 객체 메타데이터로 굳습니다.** 코드 수정은 신규 업로드에만 적용됩니다(한 버킷에 `max-age=600` 65개 + `no-cache` 151개 공존이 증거). `render/image` 응답도 원본 헤더를 계승하니 A는 바이트만 고치고 10분 만료는 남깁니다.

부수적으로, `immutable`을 붙이려면 `uploadPlayerPhoto`의 `stampError → return true`(도장 실패를 삼킴)를 먼저 고쳐야 합니다. 안 그러면 옛 사진이 1년 고착됩니다 — 지금의 600초가 그걸 10분 만에 자가치유하고 있습니다.

## 여기 시간 쓰지 마세요 (반증됨)

봇·크롤러(158 IP 전부 한국 모바일 ISP, 크롤러 UA 0건) · REST/Realtime/Functions · `no-cache` 151개(바이트 4.6%, 그중 110개는 앱이 요청조차 안 함) · `?v=` 없는 맨 URL 이중페치(0.115%) · Konva CORS 이중 다운로드(실브라우저 검증 결과 요청 1건) · SW 캐시(코드 자체가 없음) · 고아 객체 147개 삭제(요청 0건 → 절감 0) · CDN 히트율.

**측정 한계**: 무료 플랜 로그 보존이 1일이라 월 수치는 평일 하루 ×30 외삽입니다. 청구주기 시작일은 usage API가 404여서 확인 불가 — 달력월(8/1~) 기준이면 사진이 77%, 주기 시작이 7/26 전후면 100%입니다. 미설명분의 후보는 다른 서비스가 아니라 "주기 시작일" 또는 "월초 트래픽이 더 높았다" 둘 중 하나입니다.

전문은 `scratchpad/egress-report.md`에 저장했습니다. A를 적용해볼까요?

---

## #129

**Prompt**: 요지는 이미지 용량을 줄이면 해결되는데, api 로 줄이면 그거 요금을 내야하니까 도찐개찐이란거지?

**Answer**: _(응답 대기 중…)_

---

## #130

**Prompt**: 요지는 이미지 용량을 줄이면 해결되는데, api 로 줄이면 그거 요금을 내야하니까 도찐개찐이란거지?

**Answer**: 아니요, 도찐개찐 아닙니다. 두 가지가 뒤집힙니다.

## 1. 지금 이미 Pro로 결제된 상태라 변환은 **공짜**입니다

방금 확인했습니다 — 조직 플랜이 `"plan": "pro"`입니다. 그리고 Supabase 가격표:

| 항목 | Free | **Pro (현재)** |
|---|---|---|
| Cached egress | 5 GB | **250 GB** 포함, 초과 $0.03/GB |
| Image Transformations | **사용 불가** | **origin image 100개 무료 포함**, 이후 $5/1,000개 |
| Storage | 1 GB | 100 GB |

실제 서빙되는 원본 이미지는 **69개**(사진 있는 회원 69명 / 전체 154명, 합 2.1 MB)입니다. 무료 포함분 100개 안입니다 → **변환 요금 $0**.

그리고 애초에 Pro는 egress가 250 GB 포함이라 월 9.94 GB는 **4%**입니다. 대역폭 초과 자체가 이미 사라졌습니다. 결제해서 문제가 해결된 상태고, 변환 API를 켜도 추가 요금은 0원입니다.

## 2. 요금이 나가는 경로는 "서버 변환" 하나뿐입니다 — 클라이언트 변환은 원래 무료

여기가 핵심인데, 이미지 축소는 두 곳에서 할 수 있습니다:

- **서버 변환** (`render/image`): 요청마다 Supabase가 변환. 무료 플랜에선 아예 못 쓰고, Pro에선 100개까지 무료.
- **클라이언트 변환** (업로드 시 1회): `processImageToSquareJpeg`에서 브라우저 canvas로 리사이즈. **이미 구현돼 있고 영원히 무료**입니다.

`playerPhotoUpload.ts:19`의 `size = 512`를 `256`으로 바꾸는 것 — 이게 요금과 아무 관계 없는 무료 처방입니다. 제가 A를 먼저 권한 건 성능이나 비용 때문이 아니라, **기존 파일 30개를 재업로드하는 수고를 안 해도 되기 때문**이었습니다. 그 수고도 로컬 스크립트로 한 번 돌리면 끝이고, 역시 무료입니다.

## 그래서 실제 판단은 "요금" 문제가 아니라 "무료 플랜으로 돌아갈 거냐"입니다

**Pro 유지할 거면** → 아무것도 안 해도 됩니다. 250 GB 중 9.94 GB. 굳이 손대는 이유는 요금이 아니라 로딩 속도(64 kB 아바타 → 3 kB)입니다.

**무료 플랜(5 GB)으로 내려갈 거면** → 서버 변환은 선택지에서 빠집니다(무료 플랜 미지원). 클라이언트 변환 + 백필만 남고, 이게 유일하게 무료 플랜에서 통하는 길입니다:

| 처방 | 월 egress | 5 GB 한도 |
|---|---|---|
| 현재 (512px JPEG) | 9.94 GB | 초과 |
| 256px JPEG q0.8 | 약 3.9 GB | 통과 (여유 적음) |
| **256px WebP** | 약 2.3 GB | 통과 (여유 충분) |

WebP로 가려면 `.jpg` 파일명(`playerPhoto.ts:16-18`)과 `contentType: "image/jpeg"` 하드코딩(`playerPhotoUpload.ts:69`)도 같이 손봐야 합니다.

어느 쪽으로 가실지 알려주시면 그대로 구현하겠습니다. Pro 유지라면 손대지 않는 것도 정당한 선택입니다.

---

## #131

**Prompt**: ㄴㄴ 프로결제 해제하고싶은데 이거 API 요청할때만 하는거지, 캐싱을바꾸는거아니잖아

**Answer**: _(응답 대기 중…)_

---

## #132

**Prompt**: 아니다 방향을 바꿔서 프로필 이미지를 로컬스토리지에 캐싱할수있나?

**Answer**: 완료했습니다. 배포는 아직 안 했습니다(아래 확인 필요).

## 한 일

**마이그레이션** `supabase/migrations/20260821000000_dues_join_cutoff_day.sql`
- `dues_settings.join_cutoff_day` (기본 21, 1~31)
- `members.rejoined_at` + BEFORE 트리거 `trg_members_stamp_rejoined_on_activate` — `is_active` false→true 시 시각 스탬프
- `dues_generate_monthly` 에 **합류월 하한** 한 줄 추가:
  `실제 합류일 = max(계정 생성일, 마지막 재활성화일)@KST` 이 컷오프 이상이면 **그 달만** 미부과
- 조민서 님 `membership_started_at = 2026-07-01`

**프론트** — 회비 설정 모달에 [합류 컷오프 (일)] 입력칸(1~31 검증), `dues.ts` 매핑. **문서** — `ACCOUNTING_SPEC.md` §1.4·§4·§12·§13.

## 검증 (프로덕션 `begin;…rollback;` 드라이런)

| | 옛 룰 | 새 룰 |
|---|---|---|
| 2026-09 대상 | 84명 | **84명** (변화 없음) |
| 2026-08 대상 | 79명 | 77명 (조민서 + 테스트 재활성화 1명) |

조민서 님 최종: 7월 가입 → 시작월 8월 → 컷오프가 8월을 걷어냄 → **첫 부과 2026-09**. 신규 가입자 부과 변화 0건. 테스트 345개·타입체크·빌드 통과.

## 두 가지 보고할 것

**1. 박병훈 님 2026-07 회비 5,000원(미납)** — 7/27 계정 생성인데 6월 보정을 받아 7월이 붙은 건입니다. 새 룰이었으면 미부과였습니다. 이미 생긴 부과는 지우지 않는 게 원칙이라 **그대로 뒀습니다**. 소급 적용하시려면 [면제] 처리하시면 됩니다. (같은 케이스인 전창우·김영주 님은 이미 납부 완료라 손대지 않는 게 맞습니다.)

**2. 제가 처음 쓴 근거가 틀려서 고쳤습니다** — 검증에서 잡혔습니다. "같은 달에 비활성→재활성 하면 그 달 회비가 사라지는 건 운영진만 가능"이라고 적었는데, 사실이 아닙니다. `members_update` RLS 가 `is_admin() OR auth_user_id = auth.uid()` 라서 **로그인한 회원이면 누구나 API 로 자기 `is_active` 를 두 번 토글해 자기 미납 회비를 지울 수 있습니다**(앱 UI엔 없는 경로). 회비를 지우는 구멍 자체는 8/20 변경이 낸 것이고 이번 건이 더한 건 "그 달 재생성 복구가 막힌다"는 점입니다. 문구를 사실대로 고치고 복구 절차와 함께 §13 열린 구멍으로 남겼습니다. **차단은 안 했습니다** — 본인 탈퇴·게스트 행 재사용 두 경로를 같이 통과시켜야 해서 별도 판단이 필요합니다. 원하시면 바로 막겠습니다.

## 배포

아직 프로덕션에 반영되지 않았습니다. 진행할까요?
- `supabase db push` — 미적용 마이그레이션은 이것 하나뿐인 걸 확인했습니다 (159/159 적용됨)
- `git push` — 프론트(설정 UI)

---

## #133

**Prompt**: 조민서라고 새로 가입했는데 기존회원이라 회원가입월을 6월로 바꾸고, 근데 21일부터 재가입한 유저는 당월 회비 부과 없게하려고 하는데 기능추가해줘

**Answer**: 조사를 4개 렌즈로 병렬 실행했습니다. 결론이 나오기 전에 지금 확실한 것만:

**되긴 됩니다. 다만 localStorage는 세 후보 중 가장 나쁜 그릇입니다.**

- 사진 69장 = **2,137 kB**. localStorage는 문자열만 담으니 base64로 넣어야 하고 **약 +33% → 2.85 MB**. 한도가 보통 origin당 5 MB이고 이미 `cocktime:photoIndex`가 쓰고 있어서, 회원이 늘면 그대로 벽에 부딪힙니다.
- 게다가 localStorage는 **동기 API**입니다. 부팅마다 2.85 MB를 `JSON.parse` 하면 메인스레드가 그만큼 멈춥니다.
- `Cache Storage`나 IndexedDB는 **Blob을 그대로** 저장해서 팽창이 0이고, 비동기이며 할당량이 훨씬 큽니다.

**그리고 이 방향 자체는 옳습니다** — 이유가 두 가지입니다:
1. iOS가 HTTP 캐시 본문을 버리는 것(전체본문 86.5%)을 우회하는 **유일한** 수단입니다. `max-age`를 1년으로 올려도 iOS에는 안 통했습니다.
2. 플랜과 무관하게 공짜입니다. 서버 변환 API처럼 과금 조건을 따질 필요가 없습니다.
3. 화질을 안 깎습니다. 256px 축소와 **배타적이지 않아서** 둘 다 하면 곱해집니다.

지금 확인 중인 것:
- localStorage / Cache Storage / IndexedDB **6축 비교** + iOS 7일 삭제 정책과 **KakaoTalk 인앱 웹뷰**(사진 트래픽의 1/3)에서 각각 살아남는지
- 실제 활성 기기 수를 삼각측량해서 **정상상태 절감량**(무료 플랜 5 GB 복귀 가능한지)
- 통합 지점 전수 — 특히 **Konva 경로**(`PlayerMagnet`)가 `use-image`로 URL만 받는데 Blob을 먹일 수 있는지, 가상화 리스트에서 `objectURL` 누수 관리
- SW 가로채기 대신 **앱 레이어 캐시**가 나은 이유(현재 SW는 설치형 PWA에만 등록돼서 카톡 웹뷰·비설치 iOS를 못 덮습니다)

완료되면 파일 단위 구현 계획까지 붙여 드리겠습니다.

---

## #134

**Prompt**: <task-notification>
<task-id>wgu33afuj</task-id>
<tool-use-id>toolu_014D8DLzyCoDyvAbXQCBJhi3</tool-use-id>
<output-file>/private/tmp/claude-501/-Users-sam-Projects-cocktime-scheduler/8b55a3a9-e5dc-4187-b457-3fb3e11107c7/tasks/wgu33afuj.output</output-file>
<status>completed</status>
<summary>Dynamic workflow "프로필 사진 클라이언트 영속 캐싱 설계 — 저장매체 비교·절감량 실측·통합지점 전수·구현안" completed</summary>
<result>{"report":"조사 완료. 아래가 최종 산출물이다.\n\n---\n\n# 프로필 이미지 로컬 캐싱 — 최종 판정\n\n&gt; 측정 창: 2026-08-21 기준 24h edge_logs(`user_agent not like 'curl%'`), Management API SQL, Storage 실요청.\n&gt; 조직 plan = **pro** (실측: `GET /v1/organizations/ezzrmfcvshyqcoxqcegf` → `\"plan\":\"pro\"`).\n&gt; ⚠️ 브리핑의 \"8.78GB / 5.5GB 초과\"는 Pro 포함 egress(문서상 250GB)와 불일치 — 대시보드 수치 재확인 필요. **측정 불가**. 아래 계산은 보수적으로 **5 GB 기준**으로 판정한다.\n\n## 0. 기준선 재측정\n\n| 항목 | 값 |\n|---|---|\n| 사진 200 응답 | 11,177건 / **381,185,245 B = 381.2 MB/일 → 11.44 GB/30일** |\n| 4xx | **5건(전부 400)**, 404 = 0건 → 과거 404 루프는 현재 잠잠 |\n| live 객체 | 69개 / 2,188,354 B / avg 31,715 / max 148,926 |\n| 회원 | 154명, 사진 보유 **69명** |\n| 기기-객체 dedupe(하루) | 3,927 pair / 180 IP / **137,235,335 B = 137.2 MB/일** → 기기당 21.8객체·762 kB |\n\n플랫폼별 (200 : 304, 전체본문율, 200 바이트):\n\n| 플랫폼 | 200 | 304 | 전체본문 | 바이트/일 | 비중 |\n|---|---|---|---|---|---|\n| **iOS 브라우저(비카톡)** | 6,726 | 68 | **99.0%** | 231.5 MB | **60.7%** |\n| **KakaoTalk Android** | 3,467 | 148 | **95.9%** | 118.4 MB | **31.1%** |\n| other/데스크톱 | 800 | 580 | 58.0% | 25.1 MB | 6.6% |\n| Android 브라우저 | 127 | 4,947 | 2.5% | 4.5 MB | 1.2% |\n| KakaoTalk iOS | 57 | 1,039 | 5.2% | 1.7 MB | 0.5% |\n\n→ 두 통(iOS 탭 + 카톡 Android)이 **91.8%**. 카톡 iOS·Android 브라우저는 이미 304로 정상 작동 중이며 처방 대상이 아니다.\n\n---\n\n## 1. 직답 — localStorage 로 되나\n\n**된다. 단 \"512px 원본을 담는 1차 저장소\"로는 안 된다. 그리고 안 되는 방식은 조용하지 않고, 사진이 아니라 로그인이 먼저 죽는다.**\n\n**(a) 오늘은 들어간다 (실측)**\n- Chrome 상한 실측 **5,242,880자**(UTF-16 코드유닛 단위, ASCII/한글 과금 동일 — ratio 1.000)\n- WebKit(iOS Safari·모든 WKWebView): `LocalStorageManager.cpp:40` `5 * MB` + `WTFString.h:121 sizeInBytes()` = ASCII 1B/char → base64는 8bit → **5,242,880 ASCII자**. (소스 근거, iOS 실기기 측정 불가)\n- 69장 512px = base64 2,917,892자, JSON 래핑 2,922,378자 = **쿼터의 55.7%**. 실브라우저에서 **69/69 저장 성공**.\n\n**(b) 벽은 123장이고, 154명은 2.7배 초과**\n- fleet 평균 31,715 B 기준 한계선 **123장** = 사진 보급률 79.9%\n- 앱 업로드 품질(512px q0.85, 30장 avg 68,328 B) 기준 오늘부터 **+26장**에서 QuotaExceededError\n- 154명 전원 512px = **14,039,410자 = 쿼터의 268%** → 하드 실패\n\n**(c) 진짜 탈락 사유 — 벽에 닿는 순간 죽는 건 사진이 아니다 (실증)**\n\n쿼터 만충 상태에서 측정한 결과:\n1. `cocktime:photoIndex`(154명이면 ~8.2 kB) write → **QuotaExceededError**\n2. `sb-sfxbrheavypjsjgbzjom-auth-token`(2,963자) write → **QuotaExceededError**\n\n그리고 `src/lib/playerPhoto.ts:44-50` `writeCache()`는 이 예외를 **빈 catch로 삼킨다**:\n```\n} catch {\n    /* 저장 실패는 무시(프라이빗 모드·용량 초과) */\n}\n```\n사슬: 인덱스 미저장 → 다음 콜드부트 `readCache()` = null → `buildUrl()`(:88-95)의 `if (index &amp;&amp; v == null) return \"\"` 가드가 건너뛰어짐 → **154명 전원에게 URL 발급 → 사진 없는 85명이 페이지 열 때마다 404**. 같은 파일 주석 `:20-29`이 기록한 **24시간 5,359건** 사고의 정확한 재현 경로다. 게다가 auth 토큰 write 실패는 `_saveSession`에 try/catch가 없어 **세션 유실**로 이어진다.\n즉 사진 blob이 인덱스·인증토큰과 5 MiB 오리진 예산을 다투는 구조 자체가 결격 사유다. IDB/Cache Storage는 별도 6 GB급 풀이라 이 굶김이 **구조적으로 불가능**하다.\n\n**(d) 그런데 담을 바이트가 8.9배 작아지면 localStorage도 성립한다 (신규 실측)**\n\nPro 플랜이라 Storage 변환 엔드포인트가 살아 있다. 69장 전량 변환 실측:\n\n| 대상 | 154명 전원 base64 | 쿼터 점유 |\n|---|---|---|\n| 512px 원본 | 14,039,410자 | **267.8% 실패** |\n| render w=192 (avg 5,155 B) | 1,058,591자 | 20.2% |\n| render w=128 (avg 3,796 B) | 779,525자 | **14.9% (6.7배 여유)** |\n\n**결론:** 사용자가 지목한 localStorage는 *매체로서 틀린 게 아니라 담으려던 바이트가 틀렸다*. 다만 썸네일로 줄여도 IDB가 여전히 우월하다(base64 33.3% 세금 0, 인증토큰과 예산 무경합, 비동기). **localStorage는 지금 하는 일(`cocktime:photoIndex`, 154명 ~8 kB)을 계속 맡고, 사진 바이트는 IDB로.**\n\n---\n\n## 2. 매체 비교표 (6축)\n\n| 축 | localStorage | Cache Storage | **IndexedDB** |\n|---|---|---|---|\n| **용량** | 실측 5,242,880자. 512px 69장=55.7%, 123장이 벽, 154명 268% 초과 | 실측 quota 5.37~10.24 GB (프로필별) | 동일 풀 5.37~10.24 GB = LS의 **1,000배 이상** |\n| **팽창** | base64 **+33.34%**(2,188,354 B → 2,917,892자) | Blob 원본 그대로 **0%** (SHA-256 왕복 일치) | Blob/ArrayBuffer **0%** (왕복 2,188,354 B 정확) |\n| **동기성** | 동기. cold first-touch 3.9 ms + getItem 0.2 + parse 1.2 = **5.3 ms**(데스크톱) — 성능은 탈락 사유가 아님 | 비동기. 69 put 45.7~51 ms / match 35.7~49 ms | 비동기. 69 put **1.9~18 ms** / getAll **0.5~13 ms** ← 최속 |\n| **iOS 생존성** | ITP 7일 삭제 대상 | **동일 대상** | **동일 대상** (webkit.org/blog/10218: \"Indexed DB, LocalStorage, … Service Worker registrations and cache\" 한 문장) |\n| **카톡 웹뷰** | 영속 실증(REST 5,114건 401=0, `/auth/v1/callback` 0건 → 재OAuth 없이 세션 복원) | iOS WKWebView는 3매체가 단일 WKWebsiteDataStore 공유 → 동일. Android WebView는 Chromium 기본 on **(추정)** | 동일 |\n| **인증토큰 경합** | **치명. 같은 5 MiB 통** — 만충 시 photoIndex·auth 토큰 write 실패 실증 | 없음 | 없음 |\n| **SW 필요** | 불필요 | **불필요**(실측: `swRegs=0`에서 open/put/match 성공) | 불필요 |\n| **함정** | 조용한 QuotaExceededError → 404 루프 회귀 | opaque(no-cors) 응답 패딩: 실데이터 2.19 MB가 `usageDetails.caches` 11.17 MB로 계상. 반드시 `mode:'cors'` | objectURL 수명 관리 |\n\n**1순위 = IndexedDB.** 근거:\n1. 모든 성능 축에서 Cache Storage와 동률 이상(write 1.9 vs 45.7 ms, read-all 0.5 vs 35.7 ms)\n2. opaque 패딩 함정 자체가 없음\n3. `{v, mime, buf, bytes, lastUsedAt}` 레코드에 `photo_updated_at` 스탬프를 바이트와 같은 행에 넣어 **기존 `?v=` 무효화 규약을 그대로 캐시 무효화 규약으로** 쓸 수 있음\n4. localStorage 5 MiB 예산에서 사진을 완전히 빼내 §1(c) 사슬을 구조적으로 차단\n\n**2순위 = Cache Storage** (SW 없이 동작 확인). 유일한 실익이었던 \"URL 그대로 두고 앱 무수정 투명 캐싱\"은 **도달 불가** — SW가 `src/store/pushStore.ts:33` `if (installState !== \"supported\") return;` + `src/lib/push/platform.ts:53-61`(standalone만 supported)로 설치형 PWA에만 등록되는데, 낭비 바이트의 91.8%가 SW 없는 iOS 탭·카톡 Android에서 나온다. 실측: ckti.me에서 `swRegs=0, controller=null`.\n\n**탈락 = localStorage (1차 저장소로서). 유지 = photoIndex 담당.**\n\n---\n\n## 3. 절감량\n\n### 3-1. 신규 실측: 서버 변환 엔드포인트 (`/render/image/public/...`)\n\nPro 플랜에서 **실제로 동작함**. 69장 전량 실측 + 24h 요청수로 재가중:\n\n| 변형 | 객체합 (69장) | 객체비 | **요청가중 비율** | **30일 GB** |\n|---|---|---|---|---|\n| 원본 (현행) | 2,188,354 B | 1.000 | 1.000 | **11.44** |\n| render w=128 jpg q75 | 261,951 B | 0.120 | 0.1116 | **1.28** |\n| render w=192 jpg q75 | 355,728 B | 0.163 | 0.1606 | **1.84** |\n| render w=256 jpg q75 | 481,585 B | 0.220 | 0.2270 | **2.60** |\n| render w=128 + Accept:webp | 203,178 B | 0.093 | 0.0863 | **0.99** |\n| min(원본, w=128) — 역증가 가드 | 246,776 B | 0.113 | 0.1065 | **1.22** |\n\n응답 헤더 실측: `content-type: image/jpeg`, `cache-control: public, max-age=600`, `access-control-allow-origin: *`, `cf-cache-status: HIT`, `etag` 존재. 지연: **콜드 577 ms(변형별 1회) / 웜 55~61 ms** (원본은 66~88 ms).\n\n**중요 — 레거시 38장은 축소하면 커진다(실측):** 128×128 레거시 38장 129,774 B → w=128 재인코딩 143,760 B = **+10.8% 역증가**. 앱 업로드 30장은 2,049,838 → 117,002 B = **5.7%**로 폭락. 따라서 `min(target, natural)` 가드 필수.\n\n**과금(문서 근거, Context7 → supabase/supabase):** Pro 플랜 Image Transformations 쿼터 = **origin image 100개/월**, 초과분 $5/1,000. origin image는 변형 개수와 무관하게 이미지당 1회 계수, 매 청구 주기 리셋. **오늘 69장 → 무료.** 사진 보유가 100명을 넘으면 1패키지 = **$5/월**(1,000장까지). 실사용량 API는 노출되지 않아 **실측 불가**.\n\n### 3-2. 클라이언트 캐시 단독 3안\n\n파라미터(실측): 콜드필 = **762 kB/파티션**(기기-일 dedupe 137.2 MB ÷ 180 IP), 무효화 = 0.20건/일 × 143 주간활성 파티션 × 31,715 B = **0.91 MB/일**(사진 변경률은 전 세션 실측: 7/20 일괄 62건 이후 32일간 유기적 7건).\n\n| 시나리오 | 콜드 파티션/일 | MB/일 | **30일 GB** | 5 GB 대비 |\n|---|---|---|---|---|\n| 낙관 | 2.0 | 2.43 | **0.073** | 68배 여유 |\n| 중립 | 5.0 | 4.72 | **0.142** | 35배 |\n| 비관 (143개가 7일마다 전멸) | 20.4 | 16.45 | **0.494** | 10배 |\n| **최악 하한** (캐시가 하루만 산다 = 매일 전 기기 콜드) | 180 | 137.2 | **4.12** | **여유 18%** |\n\n최악 하한 4.12 GB는 IP 180개 기준 상한이며(실기기는 73~120으로 추정), **그것조차 5 GB를 통과한다.** 다만 여유 18%로 회원 증가(69→154명, 2.2배)를 흡수하지 못한다.\n\n### 3-3. 단독 vs 조합 비교표 (30일 GB)\n\n| 처방 | 낙관 | 중립 | 비관 | 최악 하한 | 커버리지 | 5 GB |\n|---|---|---|---|---|---|---|\n| **현행** | 11.44 | 11.44 | 11.44 | 11.44 | — | ❌ 229% |\n| 클라 캐시(IDB) 단독 | 0.073 | 0.142 | 0.494 | **4.12** | 저장소 영속 기기만 | ⚠️ 통과, 최악 여유 18% |\n| **render w=192 단독** | **1.84** | **1.84** | **1.84** | **1.84** | **100% (서버측)** | ✅ 여유 63% |\n| render w=128 단독 | 1.28 | 1.28 | 1.28 | 1.28 | 100% | ✅ 여유 74% |\n| render w=128 webp 단독 | 0.99 | 0.99 | 0.99 | 0.99 | 100% | ✅ 여유 80% |\n| **캐시 + render w=192** | **0.012** | **0.023** | **0.079** | **0.66** | 100% | ✅ 여유 87~99.8% |\n| 캐시 + render w=128 | 0.008 | 0.016 | 0.055 | 0.46 | 100% | ✅ |\n| 업로드 256px 축소(클라 q0.85) 단독 | 4.69 | 4.69 | 4.69 | 4.69 | 100% | ⚠️ 여유 6% |\n| 업로드 320px 축소(클라 q0.85) 단독 | 6.20 | 6.20 | 6.20 | 6.20 | 100% | ❌ |\n\n**\"256px 축소\"의 함정:** 같은 256px인데 서버 render q75는 요청가중 0.227(2.60 GB), 클라 재인코딩
... (truncated 11658 chars, full result in /private/tmp/claude-501/-Users-sam-Projects-cocktime-scheduler/8b55a3a9-e5dc-4187-b457-3fb3e11107c7/tasks/wgu33afuj.output)</result>
<diagnostics>Per-agent results: /Users/sam/.claude/projects/-Users-sam-Projects-cocktime-scheduler/0ebf05b6-201a-43b2-88f5-f7ca1b802293/subagents/workflows/wf_7ccc487c-c7d/journal.jsonl — one {"type":"result",...} line per completed agent with its full return value.
If the result above is empty or unexpected, Read this file BEFORE diagnosing — do not assume agents returned non-empty results.
To re-run with edited post-processing: Workflow({scriptPath: '/Users/sam/.claude/projects/-Users-sam-Projects-cocktime-scheduler/0ebf05b6-201a-43b2-88f5-f7ca1b802293/workflows/scripts/photo-client-cache-design-wf_7ccc487c-c7d.js', resumeFromRunId: 'wf_7ccc487c-c7d'}) — agents whose (prompt, opts) are unchanged replay from cache.</diagnostics>
<usage><agent_count>13</agent_count><agents_done>13</agents_done><agents_error>0</agents_error><agents_skipped>0</agents_skipped><agents_empty_result>0</agents_empty_result><subagent_tokens>1182143</subagent_tokens><tool_uses>497</tool_uses><duration_ms>2830758</duration_ms></usage>
</task-notification>

**Answer**: 조사 끝났습니다. 답은 **"된다, 그런데 그 그릇에 담으면 안 된다"** — 그리고 뜻밖에 **캐싱이 1순위가 아니라는** 결론이 나왔습니다.

## 1. 직답 — localStorage에 들어가나

**오늘은 들어갑니다.** 실브라우저에서 69/69 저장 성공했습니다.

- localStorage 상한 실측: **5,242,880자** (WebKit도 소스상 동일 — `LocalStorageManager.cpp:40` `5 * MB`)
- 69장 base64 + JSON 래핑 = **2,922,378자 = 쿼터의 55.7%**

**그런데 벽이 123장입니다.** 사진 보급률 79.9%(현재 69/154 = 44.8%)에서 `QuotaExceededError`. 앱 업로드 품질(512px q0.85, 평균 68 kB) 기준으로는 **오늘부터 +26장**이면 터집니다. 154명 전원은 **쿼터의 268%**.

**그리고 진짜 탈락 사유는 용량이 아닙니다.** 앞서 제가 "동기 파싱이 메인스레드를 막는다"고 했는데 그건 **반증됐습니다** — 콜드 5.3 ms로 충분히 쌉니다. 실제 문제는 이겁니다. 쿼터 만충 상태에서 실측한 결과:

1. `cocktime:photoIndex` write → **QuotaExceededError**
2. `sb-...-auth-token` write → **QuotaExceededError**

그리고 `src/lib/playerPhoto.ts:44-50`의 `writeCache()`가 이 예외를 **빈 catch로 삼킵니다**:
[코드 블록 생략]

사슬: 인덱스 미저장 → 다음 콜드부트 `readCache()` = null → `buildUrl()`의 `if (index && v == null) return ""` 가드가 건너뛰어짐 → **154명 전원에게 URL 발급 → 사진 없는 85명이 페이지 열 때마다 404**. 같은 파일 주석 `:20-29`에 기록된 **24시간 5,359건** 사고의 정확한 재현 경로입니다. 게다가 auth 토큰 write 실패는 `_saveSession`에 try/catch가 없어 **세션 유실**로 이어집니다.

**사진 바이트가 인증토큰과 5 MiB 오리진 예산을 다투는 구조 자체가 결격**입니다. IndexedDB는 별도 풀(실측 5.37~10.24 GB)이라 이 굶김이 구조적으로 불가능합니다.

## 2. 매체 비교

| 축 | localStorage | Cache Storage | **IndexedDB** |
|---|---|---|---|
| 용량 | 5,242,880자 — 123장이 벽 | 5.37~10.24 GB | 동일 = **LS의 1,000배** |
| 팽창 | base64 **+33.3%** | Blob 그대로 0% | **0%** |
| 69장 write / read-all | 5.3 ms (동기) | 45.7 / 35.7 ms | **1.9 / 0.5 ms** ← 최속 |
| iOS ITP 7일 | 대상 | 대상 | 대상 (셋 다 동일) |
| 인증토큰 경합 | **치명** | 없음 | 없음 |
| SW 필요 | 불필요 | 불필요(실측) | 불필요 |
| 함정 | 조용한 quota 실패 → 404 회귀 | opaque 패딩(2.19 MB가 11.17 MB로 계상) | objectURL 수명 |

**1순위 IndexedDB.** Cache Storage는 SW 없이도 되지만, 그러면 `<img src>`가 자동으로 캐시를 타지 않아 `match→blob→objectURL`을 손으로 만들어야 합니다 = IDB와 구현 난이도가 같아지고 성능만 열위입니다. localStorage는 **지금 하는 일(`photoIndex`, ~8 kB)만 계속** 맡기면 됩니다.

## 3. 반전 — 캐싱보다 서버 변환이 먼저입니다

새 기준선 실측: **381.2 MB/일 = 11.44 GB/30일**. 플랫폼별 분해가 결정적이었습니다:

| 플랫폼 | 전체본문율 | 바이트/일 | 비중 |
|---|---|---|---|
| **iOS 브라우저(비카톡)** | **99.0%** | 231.5 MB | **60.7%** |
| **KakaoTalk Android** | **95.9%** | 118.4 MB | **31.1%** |
| Android 브라우저 | 2.5% | 4.5 MB | 1.2% |
| KakaoTalk iOS | 5.2% | 1.7 MB | 0.5% |

**낭비의 91.8%가 iOS 탭 + 카톡 Android**입니다. 그런데 바로 이 두 통이 저장소 영속성을 보장할 수 없는 곳입니다 — iOS ITP 7일 삭제, 카톡 WKWebView 영속성 미검증. 즉 **캐시가 가장 필요한 곳에서 캐시가 가장 불확실합니다.**

반면 서버 변환은 기기에 아무것도 요구하지 않습니다. Pro 플랜에서 실제로 동작하는 걸 확인하고 69장 전량 실측했습니다:

| 처방 | 30일 GB | 커버리지 | 5 GB |
|---|---|---|---|
| 현행 | **11.44** | — | ❌ 229% |
| IDB 캐시 단독 | 0.07~0.49 (최악 하한 **4.12**) | 영속 기기만 | ⚠️ 최악 여유 18% |
| **render w=192 q75** | **1.84** | **100%** | ✅ 여유 63% |
| render w=128 q75 | 1.28 | 100% | ✅ |
| **캐시 + w=192** | **0.012~0.079** (최악 0.66) | 100% | ✅ |
| 업로드 256px 축소(클라) | 4.69 | 100% | ⚠️ 여유 6% |

한 줄 판정: **w=192 변환만으로 −84%, 코드 한 줄, 기기 의존 0.** 그리고 변환하면 캐시에 담길 바이트도 8.9배 작아져서 154명 전원이 IDB에 **794 kB**로 들어가고 — localStorage조차 20.2%로 성립하게 됩니다. 순서가 뒤집히는 게 아니라 **변환이 캐싱을 쉽게 만듭니다.**

## 4. 그런데 지금 당장 타는 돈은 없습니다

조직 플랜이 `pro`이고 Pro는 egress **250 GB 포함**입니다. 11.44 GB = **4.6%**. 대시보드에 보이는 "5.5 GB 한도"는 업그레이드 이전 스냅샷일 가능성이 큽니다 — 한 번 다시 봐주세요. 변환도 origin image 100개까지 무료 포함이라 69장은 $0입니다(100명 넘으면 $5/월).

## 5. 구현할 때의 함정 (실측)

- **objectURL을 마운트마다 만들면 8.8배 퇴행합니다.** 같은 사진 30마운트: 고정 objectURL 재사용 25.4 ms vs 매번 새로 생성 **224.3 ms**. 브라우저 디코드 캐시가 URL 문자열에 걸려 있어 매번 전체 재디코드가 납니다. → `(memberId, v)`당 1개를 모듈 스코프 Map에 만들고 앱 수명 동안 유지.
- **언마운트 revoke는 넣으면 버그입니다.** 같은 사진이 보드(`PlayerMagnet:117`) + 그 위 모달(`RecommendTeammateDialog:151`, `MatchEditModal:37`)에 동시에 붙습니다. 한쪽 언마운트가 다른 쪽을 깨고, 그 `onError`가 `PlayerAvatar:51`의 `useEffect(..., [photoId])`(url 미포함) 때문에 `imgFailed`를 **영구 래치** → 가상화 리스트에서 조용히 사진이 사라집니다.
- **Konva는 변경 불필요** (taint 매트릭스 실측): `blob:` + `crossOrigin="anonymous"` → **tainted false**. `PlayerMagnet:118`을 그대로 두면 ghost 그레이스케일 필터가 살고, 오히려 ACAO 헤더 의존이 사라져 CORS 회귀에 강해집니다.
- **레거시 38장은 축소하면 커집니다**(129,774 → 143,760 B, +10.8%). `min(target, natural)` 가드 필수.
- **`photo_updated_at` 일괄 갱신 금지.** 7/20처럼 62건을 한꺼번에 바꾸면 콜드필 × 활성 파티션 = 수백 MB 일회성 폭발.

## 6. 별건 — 조사 중 발견한 실제 버그

`src/components/board/RecommendTeammateDialog.tsx:151,166`이 `photoId={p.id}`를 넘깁니다. `p`는 `SessionPlayer`이고 `id`는 **`session_players.id`**, 사진 키는 **`members.id`**여야 합니다(`src/types/index.ts:28-29`). 다른 보드 호출부는 전부 `memberId`를 씁니다(`MatchEditModal:37`, `PlayerPickerList:315`). 결과: 추천 대화상자의 현재 팀 사진이 안 나옵니다(첫 부팅 시엔 404). 캐싱과 무관하게 고칠 값입니다.

---

전문은 `scratchpad/photo-cache-design.md`에 있습니다.

**권고**: ① `RecommendTeammateDialog` 버그 수정 → ② `buildUrl`을 `render/image?width=192&quality=75`로 (한 줄, −84%) → ③ 그 다음에 IndexedDB 캐시를 얹기. 어디까지 진행할까요?

---

## #135

**Prompt**: pro 요금제 끄면 이미지 사이즈 변경을 못하잖아.

**Answer**: 배포 완료했습니다.

## DB (프로덕션)
`supabase db push` → `20260821000000_dues_join_cutoff_day.sql` 적용, 반영 확인:

| 확인 항목 | 값 |
|---|---|
| `dues_settings.join_cutoff_day` | **21** |
| 조민서 님 `membership_started_at` | **2026-07-01** (첫 부과 2026-09) |
| `members` 트리거 | `trg_members_stamp_rejoined_on_activate` 등록됨 |
| 감사 로그 | `membership_started_at_fix` 1건 기록 |

## 프론트
커밋 `42e921c` → push → GitHub Pages **Deploy 성공**. 회비 설정 모달에 [합류 컷오프 (일)] 입력칸이 올라갔습니다.

## 지금부터 동작
- 21일 이후 **재활성화 재가입** → 그 달 회비 미부과, 다음 달부터 정상 부과
- 21일 이후 **새 계정 + 가입월 소급 보정** → 그 달 미부과 (조민서 님이 이 케이스)
- 신규 가입자·기존 회원 부과는 그대로 (드라이런에서 9월 대상 84→84 확인)
- 컷오프는 회비 설정에서 언제든 조정 가능 (1~31)

## 남겨둔 두 가지
1. **박병훈 님 2026-07 회비 5,000원 미납** — 7/27 계정 생성이라 새 룰이었으면 미부과였을 건입니다. 이미 생긴 부과는 지우지 않는 원칙대로 뒀으니, 소급해주시려면 회비 현황에서 [면제] 처리하시면 됩니다.
2. **회원이 자기 `is_active`를 API로 토글해 자기 미납 회비를 지울 수 있는 구멍** — 앱 UI엔 없는 경로지만 차단은 안 돼 있습니다. `ACCOUNTING_SPEC.md` §13에 원인·영향·차단 방법을 적어뒀습니다. 막으려면 본인 탈퇴(`delete_my_account`)와 게스트 행 재사용 경로를 같이 통과시켜야 해서 별도 작업으로 남겼습니다 — 진행하시겠다면 말씀해 주세요.

---

## #136

**Prompt**: 전부 배포해

**Answer**: 맞습니다 — 제 ②단계는 Pro 전용이라 무효입니다. 다시 계산 중입니다.

**무료 플랜에서 남는 수단은 하나뿐입니다: 요청할 때 줄이는 대신 저장할 때 줄이기.** 서버가 매 요청마다 변환해주는 걸 못 쓰니, 객체 자체를 작게 다시 저장(at-rest 백필)해야 합니다. 효과는 같고 — 오히려 요청 시 변환 지연도 없고 과금 절벽도 없습니다. 대가는 코드 한 줄이 아니라 **기존 30장 재업로드 + 업로드 경로 수정**이라는 실제 공수입니다.

지금 확인 중인 것:

1. **재인코딩 실측** — live 69장을 실제로 내려받아 160~320px × JPEG/WebP q70~80으로 재인코딩하고, **24시간 객체별 요청수로 가중**해서 실제 월 GB를 계산합니다(단순 객체합은 실제 egress와 다릅니다). 앞선 서버 변환 실측으로 보면 192px WebP가 1.4 GB 근방일 것으로 **추정**되는데, 이걸 로컬 인코더로 확증합니다.

2. **egress 말고 다른 한도** — 이게 더 중요할 수 있습니다. 무료 플랜은 Realtime 메시지 한도가 따로 있고, 이 프로젝트는 **과거에 Realtime 초과 이력**이 있습니다(감축 미완 항목 4개 남아 있음). 사진만 고쳐놓고 Realtime에 걸리면 헛수고니, DB 크기·MAU·Edge Function·프로젝트 일시정지 조건까지 전 계량기를 현재 사용량과 대조합니다.

3. **백필 무중단 순서** — 두 개가 까다롭습니다. `photo_updated_at`을 69장 일괄 갱신하면 `?v=`가 다 바뀌어 전 클라이언트가 한 번 더 받는 **일회성 스파이크**가 생깁니다(활성 파티션 143 × 762 kB 규모). 그리고 WebP로 가면 `.jpg` 확장자 규약이 깨지는데, 부분 전환 상태에서 404가 나는 창이 생기면 과거 5,359건 사고가 재현됩니다.

4. **성장 여력과 손익** — 무료 5 GB로 버틸 수 있는 최대 회원 수, 그리고 정직한 비교: **Pro $25/월 유지(코드 한 줄) vs 무료 복귀(공수 N시간)**. 지금 69장은 변환 무료 포함분(100개) 안이라 Pro를 유지하면 실제로 한 줄로 끝나긴 합니다. 어느 쪽이 나은지는 수치로 제시하겠습니다.

완료되면 순서 있는 체크리스트로 드리겠습니다.

---

## #137

**Prompt**: 해당 API 를 운영진만 호출하게 가드할수 없나?

**Answer**: _(응답 대기 중…)_

---

## #138

**Prompt**: <task-notification>
<task-id>wrivii3mv</task-id>
<tool-use-id>toolu_01JjJs9rb1BHm2BxVz4wWR86</tool-use-id>
<output-file>/private/tmp/claude-501/-Users-sam-Projects-cocktime-scheduler/8b55a3a9-e5dc-4187-b457-3fb3e11107c7/tasks/wrivii3mv.output</output-file>
<status>completed</status>
<summary>Dynamic workflow "무료 플랜 복귀 가능성 판정 — at-rest 재인코딩 실측·전체 쿼터 대조·백필 설계·최종 수지" completed</summary>
<result>{"report":null,"survivedCount":0,"killedCount":0}</result>
<diagnostics>Per-agent results: /Users/sam/.claude/projects/-Users-sam-Projects-cocktime-scheduler/0ebf05b6-201a-43b2-88f5-f7ca1b802293/subagents/workflows/wf_dc4abe3d-50e/journal.jsonl — one {"type":"result",...} line per completed agent with its full return value.
If the result above is empty or unexpected, Read this file BEFORE diagnosing — do not assume agents returned non-empty results.
To re-run with edited post-processing: Workflow({scriptPath: '/Users/sam/.claude/projects/-Users-sam-Projects-cocktime-scheduler/0ebf05b6-201a-43b2-88f5-f7ca1b802293/workflows/scripts/free-plan-return-plan-wf_dc4abe3d-50e.js', resumeFromRunId: 'wf_dc4abe3d-50e'}) — agents whose (prompt, opts) are unchanged replay from cache.</diagnostics>
<failures>[find:free-quotas] failed: You've hit your session limit · resets 6pm (Asia/Seoul)
[find:reencode] failed: You've hit your session limit · resets 6pm (Asia/Seoul)
[find:backfill] failed: You've hit your session limit · resets 6pm (Asia/Seoul)
[find:combined-budget] failed: You've hit your session limit · resets 6pm (Asia/Seoul)
[synthesize] failed: You've hit your session limit · resets 6pm (Asia/Seoul)</failures>
<usage><agent_count>5</agent_count><agents_done>0</agents_done><agents_error>5</agents_error><agents_skipped>0</agents_skipped><agents_empty_result>0</agents_empty_result><subagent_tokens>366194</subagent_tokens><tool_uses>135</tool_uses><duration_ms>634849</duration_ms></usage>
</task-notification>

**Answer**: _(응답 대기 중…)_

---

## #139

**Prompt**: go on

**Answer**: _(응답 대기 중…)_

---

## #140

**Prompt**: 일반 브라유저와 카톡브라유저를 사용하는 사욜자의 접근을 차단하고 앱설치로 강제로 유도하면 내가 원하는 캐싱이 가능할까?

**Answer**: 로그 엔드포인트가 지금 간헐적으로 실패해서 플랫폼 분해는 앞선 측정창(검증 완료분) 수치를 씁니다. 재인코딩 실측은 방금 직접 끝냈습니다.

## 결론부터: 차단으로 "가능해지는" 건 없습니다

IndexedDB와 Cache Storage는 **일반 브라우저와 카톡 웹뷰에서도 그대로 동작합니다.** 설치가 바꾸는 것은 캐싱의 *가용성*이 아니라 *영속성 확률*뿐입니다. 즉 원하시는 캐싱은 차단 없이 지금 바로 구현 가능하고, 차단은 그걸 가능하게 만들어주지 않습니다.

## 그리고 차단 대상이 반대로 짚혔습니다

| 플랫폼 | 200 | 304 | 전체본문율 | MB/일 | 비중 |
|---|---|---|---|---|---|
| iOS 브라우저(비카톡) | 6,726 | 68 | **99.0%** | 231.5 | **60.7%** |
| **카톡 Android** | 3,467 | 148 | **95.9%** | 118.4 | **31.1%** |
| other/데스크톱 | 800 | 580 | 58.0% | 25.1 | 6.6% |
| **Android 브라우저** | 127 | **4,947** | **2.5%** | 4.5 | **1.2%** |
| **카톡 iOS** | 57 | **1,039** | **5.2%** | 1.7 | **0.5%** |

**일반 Android 브라우저는 이미 모범생입니다** — 304가 4,947건, 하루 4.5 MB. 카톡 iOS도 1.7 MB. 이 둘을 막으면 **낭비의 1.7%를 위해 사용자를 차단**하는 셈입니다.

그리고 정작 문제인 **카톡 Android는 차단해도 설치로 갈 길이 없습니다.** 카톡 인앱 웹뷰에서는 홈화면 추가가 불가능합니다. 차단하면 사용자가 "외부 브라우저로 열기 → 공유 → 홈화면에 추가"를 손으로 해야 합니다. 그런데 이 클럽은 카톡방 링크로 유입되는 구조입니다(사진 바이트의 31%). **주 유입 경로를 막는 것**입니다.

## iOS 설치형이 7일 삭제를 피하는 건 맞지만, 보장은 아닙니다

- Apple의 7일 script-writable storage 삭제는 **Safari에만** 적용되고, 홈화면 웹앱은 별도 사용일 카운터를 가집니다 — 설치가 유리한 건 사실입니다.
- 그런데 홈화면 PWA도 자주 안 쓰면 IndexedDB가 지워진다는 보고가 계속 있고, PWA 저장 한도가 ~50 MB 수준이라는 관측도 있습니다. `navigator.storage.persist()`는 iOS에서 신뢰할 수 없습니다.
- 즉 "설치 강제 = 캐시 영속 보장"이 아니라 **"확률이 올라간다"**입니다. 주 1~2회 방문 클럽이면 7일 경계에 계속 걸칩니다.

## 결정적으로, 그 대가를 치를 이유가 사라졌습니다

방금 실측을 끝냈습니다. 요청된 객체 **138개 전량을 내려받아 재인코딩**하고 **24시간 객체별 요청수로 가중**한 결과입니다(단순 객체합이 아니라 실제 egress):

기준선 **11.79 GB/30일**. 원본 해상도는 두 종류뿐 — 128×128 76장, 512×512 62장.

| 크기 | JPEG q75 | WebP q75 |
|---|---|---|
| 160 | 1.48 GB | 1.08 GB |
| **192** | **1.80 GB** | 1.31 GB |
| 256 | 2.56 GB | 1.86 GB |
| 320 | 3.47 GB | 2.49 GB |

**전 조합이 무료 5 GB를 통과합니다.** 320px JPEG q80(3.86 GB)조차 통과합니다. Pro 변환 없이, 로컬 Pillow로 백필만 하면 됩니다.

그리고 **JPEG 경로를 쓰면 `.jpg` 확장자가 유지**되므로 파일명·`contentType` 변경이 없고, 부분 전환 중 404 창도 생기지 않습니다(과거 5,359건 사고 경로 회피). WebP가 25% 더 좋지만 여유가 이미 64%라 굳이 규약을 깰 이유가 없습니다.

**192px JPEG q75 백필: 11.79 → 1.80 GB (−85%). 사용자 차단 0명, Pro 불필요, 코드 규약 변경 없음.**

## 캐싱을 원하시면 — 차단 없이 그냥 하시면 됩니다

IndexedDB 캐시는 일반 브라우저·카톡 웹뷰에서도 동작하고, 안 되는 기기에선 네트워크로 폴백합니다. 축소와 곱해져 0.02~0.5 GB급이 됩니다. 차단은 여기에 아무것도 더하지 않습니다.

설치를 **유도**할 정당한 이유는 따로 있습니다 — 웹푸시가 standalone에서만 되니까요(`platform.ts:53-61`). 하지만 그건 유도할 이유고, **차단할 이유는 아닙니다.** egress 레버로서는 차단이 가장 비싸고 가장 효과 없는 선택입니다.

---

192px JPEG q75 백필 스크립트를 작성할까요? 기존 62장(512px)만 대상이고, 128px 76장은 `min(target, natural)` 가드로 원본 유지입니다. `photo_updated_at` 일괄 갱신 여부(일회성 스파이크 대 옛 캐시 잔존)는 실측해서 결정하겠습니다.

**출처:** [Apple Developer Forums — Safari iOS PWA Data Persistence Beyond 7 Days](https://developer.apple.com/forums/thread/710157) · [PWA iOS Limitations and Safari Support](https://www.magicbell.com/blog/pwa-ios-limitations-safari-support-complete-guide) · [Navigating Safari/iOS PWA Limitations](https://vinova.sg/navigating-safari-ios-pwa-limitations/) · [Apple cops flak for deleting local browser storage after 7 days](https://www.itnews.com.au/news/apple-cops-flak-for-deleting-local-browser-storage-after-7-days-539833)

---

## #141

**Prompt**: 해줘 그리고 자주 바뀌는 이미지가 아니라 캐싱도 오래 들고가고싶어

**Answer**: 완료했습니다. 요청 두 가지 다 반영됐습니다 — **축소**와 **긴 캐싱**.

## 프로덕션 적용 결과 (검증 완료)

| | 이전 | 이후 |
|---|---|---|
| live 객체 69개 총합 | 2,188,354 B | **366,657 B** (−83.2%) |
| 객체 평균 | 31,715 B | **5,314 B** |
| `cache-control` | `no-cache` 38개 + `max-age=600` 31개 | **`public, max-age=31536000`** 69개 전부 |
| 요청가중 월 egress | 11.79 GB | **1.96 GB** |

wire 실측으로 확인: `192×192`, `6,113 B`, `cache-control: public, max-age=31536000`.

축소 31장 / 헤더만 교정 38장 / 객체없음 0 / 디코드실패 0. 원본 31장(2,010 kB)은 `_originals/`에 백업했고 `--restore`로 원복됩니다.

## 코드 변경

`src/lib/playerPhotoUpload.ts`
- `size 512 → 192`, `quality 0.85 → 0.8` — 앞으로 올라오는 사진도 같은 규약
- `cacheControl "600" → "31536000"`
- **`stampError`가 `return true` → `false`** — 이게 1년 캐시의 전제조건입니다. 파일은 올라갔는데 `photo_updated_at`이 안 찍히면 `?v=`가 그대로여서 1년간 옛 사진에 갇힙니다. 600초일 때는 10분 만에 자가치유했지만 이제는 안 됩니다. `upsert`라 재시도가 멱등이고 `ProfileSetup:138`이 이미 false를 받아 안내·중단합니다.

`src/components/board/RecommendTeammateDialog.tsx:151,166` — 별건 버그. `photoId={p.id}`(session_players.id)를 `p.memberId ?? undefined`로. 추천 대화상자에서 현재 팀 사진이 안 나오던 원인입니다.

`scripts/backfill_photo_sizes.py` (신규) — dry-run 기본, `--apply` / `--restore` / `--target` / `--quality`. **멱등**이라 다시 돌려도 이미 192px인 것은 헤더만 재확인합니다.

타입체크 통과, 테스트 345/345 통과. 스테이징까지 해뒀습니다(커밋은 안 함).

## 백필 중 새로 밝혀낸 것 세 가지

1. **재업로드는 Smart CDN이 자동 무효화합니다.** `max-age=31536000` 상태에서 upsert한 직후 `MISS` → 새 바이트가 나왔습니다. 그래서 `photo_updated_at`을 **건드리지 않았습니다** — 범프하면 `?v=`가 바뀌어 전 클라이언트가 한 번 더 받는 스파이크만 생깁니다. 브라우저에 남은 옛 사본은 현재 헤더(`max-age=600`/`no-cache`)라 10분 안에 만료돼 새 작은 파일로 재검증됩니다.

2. **없는 객체에 Storage가 HTTP 400 + 본문 `"code":"NoSuchKey"`를 돌려줍니다** (404가 아님). 상태코드만 보면 진짜 오류와 구분이 안 돼서, 첫 dry-run이 여기서 터졌습니다.

3. **storage RLS 정책이 `bucket_id`만 검사하고 `owner`에 의존하지 않습니다.** 서비스키 재업로드가 향후 사용자 업로드를 깨뜨리지 않는다는 확인이었습니다(기존 216개 중 177개가 이미 owner null).

## 알아두실 것

- **회원관리 사진 모달**(`MemberPhotoModal`)은 전체화면급으로 표시하는데 이제 192px 원본이라 부드러워 보입니다. 운영진 전용·저트래픽이라 192로 갔습니다. 신경쓰이면 `--target 256`으로 다시 돌리면 됩니다(2.56 GB, 여전히 무료 한도의 절반). 다만 **원본은 `_originals/`에만 있고 live 객체는 이미 192px**이므로, 256으로 올리려면 `--restore` 후 `--target 256 --apply` 순서로 하셔야 합니다.
- **지금 Pro 플랜입니다**(250 GB 포함). 1.96 GB면 무료 5 GB 기준으로도 여유 61%라 언제든 내려가실 수 있습니다. 다만 내려가기 전에 **Realtime 메시지 한도**를 확인하셔야 합니다 — 과거 초과 이력이 있고 감축 미완 항목이 남아 있어서, 사진만 고쳐놓고 거기 걸릴 수 있습니다. 이건 아직 측정 못 했습니다.
- 남은 고아 객체 147개는 요청 0건이라 egress 0입니다. 방치해도 무해합니다.

다음으로 무료 플랜 다른 한도(특히 Realtime)를 점검할까요, 아니면 IndexedDB 캐시를 얹을까요?

---

## #142

**Prompt**: 일단 여기까지

**Answer**: 네, 여기까지 하겠습니다.

**적용 완료 (프로덕션)**
- 사진 69장 백필 — 2,188,354 → 366,657 B, 전부 `max-age=31536000`. 월 egress 11.79 → 1.96 GB
- 원본 31장은 `_originals/`에 백업, `--restore`로 원복 가능

**스테이징만 됨 (커밋 안 함)**
- `src/lib/playerPhotoUpload.ts` — 192px/q0.8, 캐시 1년, `stampError` → false
- `src/components/board/RecommendTeammateDialog.tsx` — `photoId` 버그
- `scripts/backfill_photo_sizes.py` — 신규

커밋은 `/commit`으로 하시면 됩니다. `supabase/migrations/20260821010000_guard_member_is_active.sql`은 제 작업이 아니라 손대지 않고 그대로 뒀습니다.

**열어둔 것**
- 무료 플랜 복귀 전 Realtime 메시지 한도 점검 (미측정 — 여기 걸릴 수 있습니다)
- IndexedDB 캐시 (선택, 이미 한도 아래라 급하지 않음)
- 회원관리 사진 모달이 부드러워 보이면 `--restore` → `--target 256 --apply`

조사 전문은 `scratchpad/`의 `egress-report.md`·`photo-cache-design.md`에, 결론과 CDN 함정 5개는 메모리에 남겼습니다.

---

## #143

**Prompt**: 커밋하고 전부배포

**Answer**: 전부 배포 완료했습니다.

## 커밋 2건 (main, 푸시됨)

- `29466d1` 사진 egress −83%: 업로드 192px·캐시 1년 + 기존 69장 백필
- `2501da0` members.is_active 변경을 운영진·서버 경로로 제한

성격이 다른 작업이라 하나로 묶지 않고 나눴습니다. 워킹트리 클린.

## 배포 3경로

| 경로 | 상태 |
|---|---|
| **프론트 (GitHub Actions)** | ✅ `completed success` 58s — `ckti.me` 200, 새 번들 `index-DSsJkMpe.js` |
| **DB 마이그레이션** | ✅ `20260821010000` 적용 — **미적용 잔여 0건** |
| **Edge Function** | 변경 없음 — 이번 커밋들이 `supabase/functions/`를 건드리지 않았고, 마지막 함수 변경(`cc33999`)은 이미 배포된 것이라 재배포 불필요 |

## 검증

- 프로덕션 트리거 확인: `trg_members_guard_is_active`, `security_definer: false`(= SECURITY INVOKER — 마이그레이션 주석이 경고한 대로 definer면 `current_user` 판별이 죽습니다), `search_path=""`
- 적용 전 `begin; … rollback;`으로 실증했습니다: DDL 유효, 서버 경로가 `is_active` 토글 통과, 트리거가 `stamp` 트리거보다 앞 순서
- `db push`가 딱 그 1개만 적용하는 것을 사전에 확인했습니다(메모리의 "미적용 전부 적용" 경고 대응)
- 적용 시 나온 `NOTICE: trigger ... does not exist, skipping`은 `drop trigger if exists`의 정상 출력입니다

## 남은 상태

사진 백필은 이 커밋 전에 이미 프로덕션에 적용돼 있었습니다 — live 69장 366,657 B, 전부 `max-age=31536000`, 원본 31장은 `_originals/`에 백업(`--restore`로 원복).

열어둔 것은 그대로입니다: 무료 플랜 복귀 전 **Realtime 한도 점검**(미측정), IndexedDB 캐시(선택), 사진 모달 화질이 신경쓰이면 `--restore` → `--target 256 --apply`.

---

## #144

**Prompt**: go on

**Answer**: 답을 정리하면 — **네, 막았습니다.** 그리고 그 과정에서 별개 버그 하나가 드러났습니다.

## 가드 (이미 프로덕션 적용됨)

`trg_members_guard_is_active` — BEFORE UPDATE 트리거. **판별자는 `current_user`** 입니다(프로덕션 실측):

| 경로 | `current_user` | 결과 |
|---|---|---|
| 회원이 PostgREST로 직접 PATCH | `authenticated` | `is_admin()` 아니면 **42501 거부** |
| 운영진 UI `setMemberActive` | `authenticated` + is_admin | 통과 |
| 본인 탈퇴 `delete_my_account` (secdef) | `postgres` | 통과 |
| 게스트 행 재사용 `add_guest_attendance` (secdef) | `postgres` | 통과 |
| 서비스키·마이그레이션 | `service_role`/`postgres` | 통과 |

RLS로는 불가능합니다 — `WITH CHECK`는 OLD를 못 봐서 "값을 바꾸지 마라"를 표현할 수 없고, `is_active`를 강제하면 비활성 회원이 자기 프로필도 못 고칩니다. 컬럼 권한도 안 됩니다(테이블 UPDATE 권한이 있으면 컬럼 REVOKE는 무효, 통째로 회수하면 운영진 UI까지 끊김). **이 트리거 함수는 SECURITY INVOKER여야 합니다** — DEFINER로 바꾸면 `current_user`가 항상 `postgres`가 되어 게이트가 무력화됩니다(주석·문서에 박아뒀습니다).

7개 케이스 전부 프로덕션 롤백 트랜잭션에서 실증했습니다(T1 거부, T2 프로필 저장 통과, T3 secdef 통과, T4·T5 운영진 통과+스탬프, T6 마이그레이션 롤 통과, E 공존).

## 그 과정에서 발견 — 회원 탈퇴가 8/19부터 죽어 있습니다

`20260819010000`이 `ops_audit`에 `kind='member_self_soft_delete'`를 직접 INSERT하면서 CHECK 제약(`attendance|counter|session`)을 확장하지 않았습니다. `23514` → **트랜잭션 전체 롤백** → 회원은 "탈퇴 처리에 실패했어요"만 봅니다. 데이터 손상은 없고(전부-또는-전무) 기능만 죽었습니다. 지문: `ops_audit`에 member 계열 행 0건.

**두 달 가까이 안 보인 이유**가 핵심입니다 — 다른 감사 호출부는 전부 `ops_audit_write()`를 거치고 그 함수는 `exception when others then null`로 **모든 실패를 삼킵니다**. 그 래퍼를 안 쓴 유일한 곳이 `delete_my_account`였고, 그래서 유일하게 죽었습니다.

수정안을 작성해 검증까지 마쳤습니다(**아직 `supabase/migrations/`에 넣지 않았습니다** — 이유는 아래):
- ① CHECK에 도메인 값 `'member'` 추가, 행위는 `detail.action='self_soft_delete'`로
- ② 그 INSERT를 자체 예외 블록으로 감싸 **감사 로그 실패가 탈퇴를 죽이지 못하게** (근본 원인은 kind 오타가 아니라 구조입니다)

첫 시안은 `ops_audit_write`를 그대로 쓰는 것이었는데, 드라이런에서 `actor`가 `v_member` → `null`로 떨어지는 걸 확인해(탈퇴가 그 직전에 `auth_user_id`를 끊습니다) 직접 INSERT + 자체 예외로 바꿨습니다. 검증: 탈퇴 성공·`actor` 보존·기존 3종 kind 정상·`'bogus'` 여전히 거부·**CHECK에서 `'member'`를 다시 빼도 탈퇴는 성공**(fail-safe 실증).

## 두 가지 확인 부탁드립니다

**1. 이 리포에 다른 세션이 동시에 작업 중입니다.** 커밋 `29466d1`(사진 egress 192px 백필)을 만든 세션이 `git add -A` + `supabase db push`를 돌리면서, 제가 아직 검증 중이던 가드 마이그레이션 파일까지 함께 커밋(`2501da0`)하고 프로덕션에 적용했습니다. 결과물 자체는 검증을 통과했으니 문제는 없지만, 미검증 파일이 그렇게 나갈 수 있는 상태입니다. 그래서 `ops_audit` 수정안은 스크래치패드에 두고 있습니다.

**2. `ops_audit` 수정을 배포할까요?** 하라고 하시면 마이그레이션 디렉토리로 옮겨 `db push` + 커밋·푸시하겠습니다. 문서(`ACCOUNTING_SPEC.md` §4·§13)는 이미 갱신해뒀습니다 — 틀렸던 "운영진만 가능" 서술을 정정하고, 막은 경로와 남은 잔여 위험(본인 탈퇴는 여전히 그 달 미납을 지움)을 적었습니다.

---

## #145

**Prompt**: 탈퇴기능대신 비활성기능 사용하는거라 안고쳐도 될듯?

**Answer**: 알겠습니다. 안 고치는 쪽으로 정리했습니다.

## 정리 결과

**프로덕션 DB는 건드리지 않았습니다** — `ops_audit_kind_check`는 `('attendance','counter','session')` 그대로입니다(드라이런 8케이스 전부 롤백 확인). 작성해둔 수정 마이그레이션 초안은 폐기했습니다.

**문서를 실제 상태로 정정**했습니다(커밋 `c25e3c3`). 제가 앞서 "`20260821020000`에서 수선"으로 써둔 게 거짓이 되므로:
- `ACCOUNTING_SPEC` §4 — "2026-08-19 ~ , **의도적으로 안 고침**"으로 바꾸고 판단 근거(운영진 비활성으로 처리)를 명시
- **왜 두 달 가까이 안 보였는지**를 남겼습니다 — 다른 감사 호출부는 전부 `ops_audit_write()`를 거치고 그 함수가 모든 실패를 삼킵니다. 그 래퍼를 안 쓴 유일한 곳이라 유일하게 죽었습니다. 앞으로 감사 로그를 새로 심을 때 이 래퍼를 쓰거나 자체 예외 블록으로 감싸라는 교훈으로 적었습니다
- **되살릴 때의 처방**을 검증된 형태로 남겼습니다(`'member'` 도메인 값 + `detail.action`, 자체 예외 블록, `ops_audit_write`를 그대로 쓰면 `actor`가 null로 떨어짐)

**한 가지 부수효과**를 문서에 명시했습니다: 제가 §13에 "본인 탈퇴로 월말 회비 회피" 잔여 위험을 적었는데, **탈퇴가 깨져 있어 지금은 성립하지 않습니다**. 나중에 탈퇴를 되살리면 그 구멍이 함께 열린다는 걸 적어뒀습니다 — 모르고 열리는 것과 알고 두는 것은 다르니까요.

**남은 정리 항목 하나**: 회원 화면 [회원 탈퇴] 버튼(`ProfileSetup.tsx:392`)이 여전히 실패합니다. 기능을 안 고치기로 했으면 버튼을 숨기는 게 짝인데, 이건 별도 판단이라 문서에만 올려두고 손대지 않았습니다. 원하실 때 말씀하시면 숨기겠습니다.

메모리에도 남겼습니다 — 이탈 처리는 운영진 비활성이라는 운영 방식, 탈퇴를 의도적으로 방치한 결정, 그리고 **다른 세션의 `git add -A` + `db push`가 검증 중인 마이그레이션까지 쓸어간다**는 위험(오늘 실제로 발생)을 배포 절차 메모에 추가했습니다.

---

## #146

**Prompt**: 아 그거 누르면 탈퇴아니고 내부적으론 비활성로직이 돌아가게해

**Answer**: 구현·검증 완료했습니다. 배포 전 확인 하나만 부탁드립니다.

## 바뀐 것

[회원 탈퇴]를 누르면 **계정 삭제 대신 `deactivate_my_account()`** 가 돌아갑니다 — 운영진 [비활성]과 같은 `is_active=false` UPDATE라 기존 트리거가 그대로 돕니다. 추가로 **미종료 세션 참석 취소**(나간 사람이 정원을 잡고 있으면 안 됨)와 **푸시 구독 삭제**를 합니다. 회원 행·계정·개인정보·부과 이력은 남으니 **돌아오면 [재활성화] 하나로 끝**입니다 — 조민서 님 같은 중복 행이 안 생깁니다.

**함께 넣은 것 — `join_session`에 `is_active` 게이트.** 이게 없으면 위 변경이 무의미합니다: 계정을 남기니 나간 사람이 다시 로그인해 그대로 신청되고, `fetchMembers`는 비활성을 걸러내니 **명단·편성엔 없는데 attendances엔 있는 유령 행**이 됩니다. **이건 운영진이 정지시킨 회원에게도 같이 적용됩니다** — 원래 그래야 했던 동작입니다(게스트는 `add_guest_attendance`를 쓰고 그쪽은 이미 `is_active`를 봅니다).

구 `delete_my_account`는 **고치지 않고 봉인**했습니다(`authenticated` EXECUTE 회수 + deprecated 코멘트). 감사 로그를 위해 `ops_audit.kind`에 도메인 값 `'member'`만 추가했고, 행위는 `detail.action='self_deactivate'`로 뺐습니다.

## 검증 (프로덕션 롤백 트랜잭션, 8케이스)

| | 결과 |
|---|---|
| 활성 회원 신청 | 통과 |
| 본인 비활성 실행 | `is_active=false` · **계정·프로필 보존**(`auth.users` 1행 그대로) · 푸시구독 0 · 미종료 참석 0 · 감사로그 `kind=member/actor=본인` |
| 비활성 후 재로그인해 신청 | **`member inactive` 거부** |
| `delete_my_account` 호출 | **권한거부(봉인 확인)** |
| 운영진 재활성화 | 통과 + `rejoined_at` 스탬프 (어제 가드와 공존) |
| 게스트 초대(활성 회원) | 통과 |

프론트: 확인 다이얼로그 문구를 실제 동작대로 고쳤습니다(기존 "계정과 회원 정보가 삭제되며 되돌릴 수 없습니다"는 이제 거짓) → "신청한 일정에서 빠지고 알림이 끊깁니다. 기록은 남아 있어, 다시 나오실 땐 운영진에게 말씀하시면 복구됩니다." `member inactive` 에러도 사용자 문구로 매핑했습니다. 테스트 345개·타입체크·빌드 통과.

## 확인 부탁 — 돈 구멍 하나가 **새로 도달 가능해집니다**

비활성 트리거는 경로를 구분하지 않으므로, 회원이 [회원 탈퇴]를 누르면 **그 달 미납 회비가 지워집니다**. 전에는 탈퇴가 깨져 있어 닫혀 있었고, 그 전에는 계정을 잃는 값비싼 회피였습니다. **이제 계정이 남아서 값이 쌉니다** — 월말에 누르고 운영진에게 재활성화를 요청하면 그 달 5,000원이 빠지고, 재활성화가 21일 이후면 어제 넣은 합류월 하한까지 겹쳐 재생성으로도 안 붙습니다.

탐지는 됩니다(`ops_audit` + `dues_audit_log` 양쪽에 actor=본인으로 남고, 재활성화가 운영진 손을 거칩니다). 100명 규모에서 실제로 이럴 사람이 있을지는 별개고요.

막으려면 "**비활성 회원은 부과 대상이 아니다**"(8/20 확정, 이틀 헤매서 정한 것)와 부딪히므로 제 판단으로 건드리지 않았습니다. 세 갈래입니다:

1. **그대로 둔다** — 운영진 비활성과 완전히 같은 동작. 일관성 유지 (현재 구현)
2. **본인 탈퇴만 미납을 남긴다** — "본인 의사로 월중 이탈은 그 달 회비 의무가 남는다". 운영진 비활성과 비대칭이 생김
3. **미납이 있으면 탈퇴를 막는다** — "정산 후 탈퇴"

**1번으로 배포할까요, 아니면 2·3번으로 바꿀까요?** 정하시면 마이그레이션을 디렉토리로 옮겨 `db push` + 커밋·푸시하겠습니다(동시 세션이 쓸어가지 않게 아직 스크래치패드에 두고 있습니다).

---

## #147

**Prompt**: 1번으로

**Answer**: 배포 완료했습니다.

## 프로덕션 반영 확인

| 확인 항목 | 상태 |
|---|---|
| `ops_audit_kind_check` | `attendance \| counter \| session \| **member**` |
| `deactivate_my_account` EXECUTE | `authenticated`, `service_role` |
| `delete_my_account` EXECUTE | **`service_role` 만** (봉인됨) |
| `join_session` is_active 게이트 | 라이브 |
| 프론트 | 커밋 `b4d998e` → Pages Deploy 성공 |

## 지금부터 동작

회원이 [회원 탈퇴]를 누르면 — 확인 문구가 "신청한 일정에서 빠지고 알림이 끊깁니다. 기록은 남아 있어, 다시 나오실 땐 운영진에게 말씀하시면 복구됩니다"로 바뀌었고 — 내부적으로는:

- `is_active=false` (운영진 [비활성]과 완전히 같은 UPDATE → 기존 트리거 그대로)
- 미종료 세션 참석 취소 (정원·카운터·대기 승격까지 정식 경로로 정리)
- 푸시 구독 삭제
- 계정·개인정보·회원 행·부과 이력은 **그대로 보존** → 돌아오면 회원관리에서 [재활성화] 하나로 끝이고, 어제 넣은 `rejoined_at` 스탬프와 합류월 하한이 자동으로 걸립니다

그리고 **비활성 상태에서는 일정 신청이 막힙니다** — 이건 운영진이 정지시킨 회원에게도 적용됩니다. 지금까지는 정지된 사람이 신청하면 명단·편성엔 안 보이는데 참석 행은 남는 유령 행이 됐는데, 그게 닫혔습니다.

## 남겨둔 것 (1번 선택대로)

[회원 탈퇴]를 누르면 그 달 미납 회비가 지워집니다 — 운영진 비활성과 같은 동작을 유지했습니다. `ops_audit`(kind=member, action=self_deactivate, actor=본인)과 `dues_audit_log`(uncharge_dues_on_deactivate, charge id·금액) 양쪽에 남으니, 재활성화 요청이 올 때 그 달 회비가 빠졌는지 확인하실 수 있습니다. 복구는 `rejoined_at`을 NULL로 되돌리고 그 달 재생성하거나 감사 로그 금액으로 부과 행을 직접 넣으면 됩니다 — `ACCOUNTING_SPEC` §13에 적어뒀습니다.

## 이번 세션 전체 (프로덕션 마이그레이션 3개)

- `20260821000000` — 합류 컷오프일 21일 + 조민서 님 가입월 7월 보정 (첫 부과 2026-09)
- `20260821010000` — `members.is_active` 직접 변경을 운영진·서버 경로로 제한
- `20260821020000` — [회원 탈퇴] → 비활성, `join_session` is_active 게이트, `delete_my_account` 봉인

세 개가 한 줄로 이어집니다: 컷오프 하한을 넣으면서 "회원이 자기 `is_active`를 못 건드린다"는 전제가 필요해졌고 → 그 전제가 거짓이라 막았고 → 막으니 나갈 유일한 경로가 죽어 있어서 → 그 경로를 실제 운영 방식(비활성)으로 바꿨습니다.

---

## #148

**Prompt**: 지난날 일정 달력에서 보면 참가자, 카풀신청자, 식사신청자 이런거 안보이는데 메인에서 일정참여자보듯이 만들어줘

**Answer**: _(응답 대기 중…)_

---

## #149

**Prompt**: go on

**Answer**: 일정 관리 달력에서 회차를 탭하면(지난 회차 포함) **메인 일정 카드와 똑같은 참여목록 모달**이 열리도록 만들었습니다.

## 무엇이 달라졌나

`일정 관리 → 달력 → 날짜 선택 → 회차 탭` 시 열리는 시트 맨 위에 참가자 요약 블록이 생겼습니다.

[코드 블록 생략]

탭하면 홈에서 쓰는 `SessionParticipantsModal` 이 시트 위에 겹쳐 뜹니다 — 확정/운영진 정원외/대기/늦참 섹션, 왕관·게스트 배지, 늦참 도착시각, `🚗 운전 가능`·`🙋 탑승 필요`, `식사 안 함` 표식까지 메인과 완전히 동일합니다(같은 컴포넌트를 재사용했으므로 앞으로도 자동으로 같이 갑니다).

## 구현 판단 두 가지

- **참석 행은 시트를 열 때 그 회차만 직접 조회**했습니다. 홈의 `scheduleStore` 는 `open`/`active` 만 담아서 종료(closed) 회차의 참석 행이 아예 없기 때문입니다. 운영진이 시트를 열 때 1회만 나가는 쿼리라 읽기 경로 호출은 늘지 않습니다. RLS(`attendances_select`)는 로그인 사용자 전체 조회 허용이라 종료 회차도 그대로 읽힙니다.
- **달력에서는 읽기 전용**(`allowRemove={false}`)입니다. 종료된 회차의 참석 행은 대관비 엔빵·회비 부과의 근거라 여기서 지우면 정산이 어긋나고, 게다가 제거 액션은 `scheduleStore` 를 갱신하므로 달력 쪽 목록과 어긋납니다. 참석자 제거는 지금처럼 메인 일정 카드에서만 됩니다.

## 곁들여 정리한 것

메인 카드의 아바타 겹침 스택 마크업(약 50줄)을 `src/components/shared/ParticipantStack.tsx` 로 빼서 양쪽이 같은 것을 쓰게 했습니다. 메인 동작·모양은 그대로입니다(대기=그레이스케일, 정원외 늦참=바이올렛 링, `+N` 칩 포함).

검증: `tsc -b` 통과, 변경 파일 eslint 0건(레포 기존 에러 7건은 손대지 않음), `vitest` 345개 전부 통과, `vite build` 성공. 실제 앱 로그인이 필요한 화면 확인은 못 했습니다.

## 하나 남겨둔 선택지

달력 날짜 칸의 점은 지금도 **종료·취소 회차를 숨깁니다**(`ScheduleCalendar.tsx:148`). 그래서 지난 날짜는 점이 없어 빈 날처럼 보이고, 탭해서 날짜 상세를 열어야 종료 회차가 나옵니다. 지난 회차를 자주 들여다볼 거라면 `closed` 만 필터에서 빼서 회색 점(이미 `statusStyle('closed')` 가 회색)을 찍어드릴 수 있는데, 달력이 그만큼 빽빽해지는 트레이드오프라 요청 범위 밖으로 두었습니다. 원하시면 바로 반영하겠습니다.

커밋은 하지 않고 staging 까지만 해뒀습니다.

---

## #150

**Prompt**: 내가 22일에 대관비 설정을 0원으로 했는데 6천원씩 부가됐네? 원인 파악해주고, 정모 식사 엔빵 부과생성을 해야하는데 UI를 어디에 넣으면 좋을까? 식사는 정모 끝나고 하고 가격은 그때 결정되니까 일정에 엮으면 안되고, 어딘가에 수동부과메뉴를 넣되, 필터링 기능을 쌈빡하게 만들어서 거기서 특정 사용자 선택할 수 있게 해야할거같아.

**Answer**: 조사 완료했습니다. 프로덕션 데이터로 원인을 확정했고, 겹쳐 있는 두 번째 문제도 같이 나왔습니다.

# 1. 대관비 0원 → 6,000원 부과된 원인

## 확정된 사실 (프로덕션 조회)

| 항목 | 값 |
|---|---|
| 세션 | **228** · 8/22(토) 09:00~12:00 · TK배드민턴아레나 · 정모 |
| `sessions.court_fee` | **0** |
| 부과 | **18건 × 6,000원 = 108,000원**, 전부 `unpaid`(납부 0원) |
| 부과 생성 시각 | 8/22 13:40 KST — `ended_at` 과 동일 → 세션 종료 트리거 |
| 확정 참석 | 24명 (그중 운영진 6명) → **비운영진 18명** |

부과된 18명 집합이 **확정 참석 − 운영진**과 완전히 일치합니다. 즉 엔빵이 아니라 **정액 모드로 계산된 것이 확정**입니다(엔빵은 운영진을 포함하므로 24명이 나와야 함).

## 원인: `0` 과 `미입력(null)` 이 같은 분기다

`dues_generate_session_court` 의 라이브 정의(`20260818000000_court_targets_include_board_added.sql:107`):

[코드 블록 생략]

`v_total = coalesce(sessions.court_fee, recurring_schedules.court_fee)` 가 **0**이면 `v_split=false` → 정액 6,000원 분기로 떨어집니다. 클라이언트도 같은 의미로 쓰고 있습니다 — `src/lib/schedule/courtFee.ts:2`: *"null/0 = 총액 없음 → 정액"*. 그래서 회차 에디터의 총액 칸에 `0` 을 넣었을 때 아래 힌트는 "총액 미입력 · 정액이 부과돼요"로 떠 있었을 겁니다. 문구는 맞지만 **"0원을 넣었다"는 의도와 정반대로 읽히는** 문구죠.

핵심은 이겁니다: **지금 시스템에는 "이 회차는 대관비를 부과하지 않는다"를 표현할 수단이 없습니다.** 무부과는 장소 단위 게이트(`places.charges_court_fee=false`)뿐이고, 회차 단위로는 정액이냐 엔빵이냐만 고를 수 있습니다.

(참고: 취소 17건 중 14건은 모두 8/11~8/21에 취소해서 당일취소 부과 대상이 0건이었습니다 — 이쪽은 정상 동작입니다.)

## 같이 발견된 두 번째 문제 (이게 더 위험)

회차 에디터의 [코트 총액]은 `sessions` 테이블을 **직접 PATCH** 합니다(`recurring.ts:163`). 부과 재계산 RPC인 `dues_set_session_fee` 는 **클라 코드 어디에서도 호출되지 않습니다**(grep 0건, `dues_audit_log` 에도 `set_session_fee` 기록 없음). 그리고 재계산 트리거는 `after update of status ... when new.status='closed'` 뿐입니다.

→ **이미 종료된 회차의 총액을 지금 올바른 금액으로 고쳐도 부과는 바뀌지 않습니다.** 화면상 총액만 달라지고 청구는 그대로 남습니다.

## 지금 상태와 처방

18명에게 6,000원 미납이 이미 보이고 있습니다(내 회비 / 미납 진입 알림). 그리고 **UI로는 지울 수 없습니다** — [부과삭제] 버튼은 `당일취소` 딱지가 붙은 행에만 뜨는데(`SessionSettleSheet.tsx:188`), 18건 모두 `is_day_cancel=false` 입니다.

제안하는 처방 (요청하시면 바로 작업):

1. **즉시 정정** — 세션 228의 대관비 부과 18건 정리. 전부 `amount_paid=0` 이라 배분·통장 영향 없이 안전합니다. 감사 흔적을 남기려면 삭제 대신 `void` 로.
2. **근본 수정** — `v_total = 0` 일 때 "부과 없음" 분기 추가(미납 정리 후 return). `court_fee=0` 인 세션은 전 기간에 228 하나뿐임을 확인했으므로 소급 영향이 없습니다. 규칙(`recurring_schedules.court_fee`)의 0도 같은 의미로 통일.
3. **UI 문구 3분기** — 미입력=정액 / **0=부과 안 함** / >0=엔빵. 지금은 앞 두 개가 한 문장입니다.
4. **(별건) 종료 후 총액 수정 반영** — 에디터가 `dues_set_session_fee` 를 타게 하거나, `court_fee` UPDATE 트리거를 추가. 지금은 조용히 무시되는 조작이라 다음 사고의 씨앗입니다.

---

# 2. 정모 식사 엔빵 수동 부과 — UI 위치 제안

## 결론: 회비 관리의 **4번째 탭** `/dues/:ym/charge` = **[부과]**

`DuesAdminPage` 는 이미 `[현황] [정산함] [회계]` 3탭 셸이고 `/dues/:ym/:page` 라우트가 열려 있습니다. 탭 하나 추가가 가장 값싸고, 필요한 재료가 그 셸에 이미 다 로드돼 있습니다.

세 가지 이유:

- **일정과 완전히 분리된다** — 말씀하신 조건 그대로. 회차 편집 화면에 금액 칸이 생기지 않고, 세션 종료 트리거와도 무관합니다. 정모 다음날 회계 화면에서 처리.
- **월 컨텍스트를 공짜로 쓴다** — `duesStore.loadMonth(ym)` 가 이미 그 달의 회원 명단·부과·세션을 캐시하고 있어서 필터 재료를 새로 안 가져와도 됩니다.
- **회식 전용이 아니게 만든다** — 유니폼, 셔틀콕, 상품, 뒤풀이 등 "임의 엔빵"이 다 같은 화면으로 들어옵니다. 회식만 위한 화면을 만들면 다음 요구에서 또 화면을 만듭니다.

탈락 후보: **회계 탭**은 통장 장부(현금주의)라 부과 생성과 성격이 다릅니다. **정모 안내 페이지**는 회원도 보는 화면이고 "일정에 엮지 말라"는 요청과 정면 충돌입니다.

## 필터 설계 — 여기가 핵심

이미 앱이 **식사 참여 체크(`attendances.meal_joining`)를 받고 있다**는 게 결정적입니다. 세션 228을 보면 확정 24명 중 **식사 체크 17명 / 안 함 7명**(최두호·김태혁·채진·이도현·이정완·우창형·장성찬). 즉 대상 명단의 90%는 이미 DB에 있고, 운영진은 현장과 어긋난 몇 명만 손으로 고치면 됩니다.

그래서 필터를 3층으로 쌓는 걸 제안합니다.

[코드 블록 생략]

포인트 몇 개:

- **① 시작 목록이 "쌈빡함"의 전부입니다.** 정모 회차를 고르면 `🍽 식사 체크 17` 칩이 뜨고, 탭 한 번에 명단이 채워집니다. 나머지 필터는 보조입니다.
- **절상 단위 선택 + 남는 돈 표시.** 회식비는 1,000원 단위로 걷는 게 실무라, 대관비의 10원 절상 규칙을 그대로 쓰면 26,588원 같은 금액이 나옵니다. 총액과 부과합의 차이(남거나 모자란 돈)를 실시간으로 보여줘야 총무가 안심합니다.
- **게스트는 대관비와 같은 구조**로 — 계정이 없으니 `payer_hint = invited_by` 로 초대 회원이 대납.
- 재사용 가능한 부품이 이미 있습니다: `FilterChip`, `PlayerAvatar`, `matchesQuery`(초성 검색), `ModalSheet`, `ConfirmDialog`.
- 회원 쪽엔 새 화면이 필요 없습니다 — 새 부과가 `dues_charges` 에 떨어지면 `내 회비` 미납과 미납 진입 알림에 자동으로 올라옵니다(부과를 물질화하는 §0-5 원칙 그대로).

## 먼저 풀어야 하는 매듭 3개 (스키마)

UI보다 이쪽이 실제 작업량입니다. `dues_charges` 가 지금 회비/대관비 **두 종류만** 담도록 잠겨 있습니다.

1. `kind text check (kind in ('monthly_fee','court_fee'))` — 세 번째 종류가 못 들어갑니다.
2. `uq_charge_session(member_id, session_id)` — 회원×세션 1행 유니크. **회식 부과를 정모 session_id 에 매달면 그 세션의 대관비 행과 충돌합니다.**
3. `dues_charge_period_xor` — `period_ym` 과 `session_id` 중 정확히 하나만 있어야 함. 회식은 둘 다 아닙니다.

그래서 **"수동 부과 묶음" 테이블을 새로 두는 쪽**을 권합니다:

[코드 블록 생략]

`session_id` 를 **키가 아니라 참조**로만 두는 게 요청과 정합합니다 — 부과는 일정에 매달리지 않지만, 정산 대조와 공개 회계에서 "이 정모의 회식 손익"을 볼 수 있습니다.

규모: 마이그레이션 1장(테이블+제약+RPC 2개: 생성/삭제, `is_admin` 게이트·멱등·감사로그) + 라이브 함수 손질 3~4개(`dues_public_ledger`, 내 미납, 정산함 매칭 후보) + 클라 새 탭 1개 + `"monthly_fee" | "court_fee"` 유니온 타입 3곳과 라벨 함수. **하루 안쪽**으로 봅니다. 새 `kind` 하드코딩이 마이그레이션 25개 파일에 흩어져 있어서, 그중 **현재 라이브인 정의만** 골라 고치는 게 유일한 함정입니다.

---

먼저 뭘 할까요? 제 순서 추천은 **① 세션 228 부과 정정 → ② `0=부과 없음` 근본 수정 → ③ 수동 부과 기능**입니다. ①은 회원들에게 지금 잘못된 미납이 보이고 있어서 급하고, 정정 후 6,000원 부과가 잘못 나갔다는 안내는 별도로 필요합니다(푸시는 자동으로 안 나가므로 수동 공지).

---

## #151

**Prompt**: 부과묶음 테이블을 새로 만든다면, 기존 부과는 어떻게 처리하고 있엇어?

**Answer**: 확인했습니다. 결론부터: **묶음 테이블은 지금까지 없었고, 필요하지도 않았습니다.** 묶음을 "이미 존재하는 실체"로 표현해 왔기 때문입니다.

## 지금의 묶음 = 부모 실체를 가리키는 컬럼 하나

| | 회비 | 대관비 |
|---|---|---|
| 묶음 키 | `period_ym` (`'2026-08'` 문자열) | `session_id` → `sessions` 행 |
| 묶음의 실체 | **없음** — 월은 그냥 값이다 | **sessions 행이 곧 묶음** |
| 멱등 장치 | `uq_charge_month(member_id, period_ym)` | `uq_charge_session(member_id, session_id)` |
| 금액 근거 | `dues_settings.monthly_fee` | `sessions.court_fee` ÷ 대상수, 또는 `court_fee_default` |
| `amount_due` | 위 값의 **스냅샷** | 위 계산의 **스냅샷** |

`dues_charge_period_xor` 제약이 "둘 중 정확히 하나"를 강제합니다. 생성 경로가 6개(월 첫 진입 `dues_ensure_monthly` · 세션 종료 트리거 · 수동 배치 `generate_dues_charges` · 입금확인 즉석 생성 · self-heal · 손보정 마이그레이션)인데, 마이그레이션 전체의 `insert into dues_charges` 40여 지점이 예외 없이 `(kind, member_id, period_ym, …)` 또는 `(kind, member_id, session_id, …)` 두 형태뿐입니다. 별도 묶음 개념이 등장한 적이 없습니다.

## 왜 그걸로 충분했나 — 대상 명단을 다시 계산할 수 있어서

이게 핵심입니다. 두 부과 모두 **"누구를 부과할지"가 언제든 재계산 가능**합니다.

- 회비: 회원 룰 — `is_active and not is_guest and not is_honorary and not is_operator` + 가입월/컷오프 판정
- 대관비: `dues_court_targets(session_id, split)` — 참석 명단 ∪ 보드 수동 추가분

그래서 **"그때 누구를 골랐나"를 저장할 필요가 없었습니다.** 다시 돌리면 같은 답이 나오니까요. 이게 `dues_generate_*` 가 UPSERT뿐 아니라 **대상에서 빠진 행의 DELETE까지** 하면서도 안전한 이유이고(`amount_paid = 0` 게이트), 멱등성의 원천입니다. 부모 실체(월·세션)만 있으면 부과는 언제든 파생됩니다.

## 회식은 여기서 처음으로 깨진다

- **대상 명단이 파생 불가능합니다.** `meal_joining` 체크를 기본 후보로는 쓸 수 있지만 진실이 아닙니다 — 세션 228도 확정 24명 중 17명이 체크했지만, 체크하고 안 간 사람·체크 안 하고 간 사람이 반드시 섞입니다. 운영진이 손으로 고친 명단은 **재실행하면 날아갑니다.**
- **금액 근거가 어디에도 없습니다.** 대관비는 총액이 `sessions.court_fee` 에 적혀 있어 재계산이 되는데, 회식 총액은 적힐 곳이 없습니다.

즉 batch 테이블은 새 개념을 들여오는 게 아니라, **기존에 `sessions`/`period_ym` 이 하던 "부모" 역할을 대신할 실체가 없어서 만드는 것**입니다. 저장할 것도 딱 그 둘입니다: 골라진 명단(=charges의 batch_id)과 총액.

## 그래서 기존 부과는 옮기지 않습니다 — XOR을 3지선다로 넓히기만

기존 두 종류를 batch로 통일하는 쪽이 개념적으로 깔끔해 보이지만, 권하지 않습니다.

1. **부모가 이미 있어서 batch 행이 순수 중복입니다.** 세션 228의 대관비 묶음은 세션 228 그 자체입니다.
2. **`on conflict` 절이 컬럼에 박혀 있습니다.** 대관비 생성기의 세 경로(분모 계산·INSERT·정리 DELETE) + 입금확인 + self-heal 이 전부 `on conflict (member_id, session_id) where session_id is not null` 을 씁니다. 유니크 인덱스를 바꾸면 사고 이력이 가장 두꺼운 코드를 전부 다시 흔들게 됩니다.
3. **읽기 경로가 그 키로 조인·그룹핑합니다** — 공개 회계, 세션 정산 대조, 내 회비.

그리고 반대 방향으로 **회식 부과가 `session_id` 를 재사용하면 조용히 깨지는 경로**가 실제로 있습니다. `uq_charge_session` 에 `kind` 가 없어서 (회원 × 정모세션) 슬롯이 **하나**입니다. 회식 부과가 그 슬롯을 먼저 차지한 상태에서 세션 종료 트리거가 돌면:

[코드 블록 생략]

`kind` 는 업데이트하지 않으므로 — **회식 부과 행이 `kind='meal_fee'` 그대로 남은 채 금액만 대관비로 덮이고**, 그 회원의 대관비 부과는 아예 생성되지 않습니다. 금액 오염과 미납 누락이 한 번에 납니다. 예외도 안 나고 로그도 안 남습니다.

그래서 최종 형태는 이렇습니다:

[코드 블록 생략]

기존 두 부과의 생성 코드는 **한 줄도 건드리지 않습니다.** 손볼 곳은 새 `kind` 가 읽기 경로에 보이게 하는 부분(공개 회계·내 미납·정산함 입금 매칭 후보)뿐입니다.

덧붙이면 이 테이블은 이미 종류별 전용 컬럼을 갖는 선례가 있습니다 — `is_day_cancel` 은 대관비 전용, `payer_hint` 는 사실상 게스트 대납 전용입니다. `batch_id` 추가는 그 패턴을 따르는 것이고, 새 축을 하나 세우는 게 아닙니다.

---

## #152

**Prompt**: 아니 그니까 기존부과와 수동부과를 다른 테이블로 처리한단 얘기지? 오히려 이게 복잡하지않아?

**Answer**: _(응답 대기 중…)_

---

## #153

**Prompt**: go on

**Answer**: 아니요 — 부과 테이블은 **하나(`dues_charges`)** 그대로입니다. 회식 부과도 회비·대관비와 같은 테이블, 같은 `status`, 같은 `dues_allocations` 배분을 씁니다. 새 테이블은 "부과"가 아니라 `sessions` 자리에 대응하는 **부모(묶음)** 행이었습니다. 부과를 두 테이블로 쪼개는 건 제가 피하려던 쪽입니다 — 그러면 공개회계·내 미납·정산함 매칭이 전부 UNION이 되고 `dues_allocations.charge_id` FK가 두 갈래로 갈립니다.

그런데 **지적하신 방향이 맞습니다.** 다시 따져보니 batch 테이블은 지금 필요보다 과합니다. 결정적인 건 이겁니다:

> **부과 행 자체가 이미 명단 스냅샷이다.** `(batch, kind='manual')` 로 뽑히는 17행이 곧 "그때 고른 명단"입니다. 그걸 기억할 부모 행이 따로 필요한 게 아닙니다.

그리고 **기존 부과가 이미 "실체 없는 문자열 키"로 묶음을 표현하는 선례**가 있습니다 — 회비의 `period_ym`. `'2026-08'` 은 테이블 행이 아니라 그냥 값입니다.

## 세 가지 안

| | 안 A: 정모 세션에 매달기 | 안 B: batch 테이블 (지난 제안) | **안 C: 문자열 키** |
|---|---|---|---|
| 새 테이블 | 0 | **1** | 0 |
| 새 컬럼 | 0 | 1 (`batch_id`) | 2 (`batch_key`, `label`) |
| 기존 함수 수정 | **라이브 4개 재작성** | 0줄 | 0줄 |
| 총액·제목 자리 | 없음 (`sessions` 에 컬럼 추가 = 일정에 엮기) | 있음 | label + note로 |
| 세션 없는 부과 | **불가** (XOR) | 가능 | 가능 |
| 한 정모에 두 번 부과 | 불가 (회원×세션 1행) | 가능 | 가능 |

안 A가 테이블 수는 가장 적지만, `on conflict (member_id, session_id)` 유니크에 `kind` 를 끼워야 하고 그러면 이걸 쓰는 **라이브 함수 4개를 전부 `create or replace` 로 다시 써야** 합니다:

[코드 블록 생략]

테이블 하나를 아끼려고 **사고가 실제로 났던 코드(237 세션, 108 세션, 무한 재부과/재삭제)를 전부 재타이핑**하는 거래입니다. 이건 복잡도를 줄이는 게 아니라 위험으로 옮기는 겁니다.

## 추천: 안 C

[코드 블록 생략]

`period_ym` 이 하던 걸 `batch_key` 가 그대로 합니다. 새 개념이 0개고, 기존 생성기 4개는 손대지 않습니다(자기 `on conflict` 절과 무관한 컬럼이니까).

**총액을 안 저장해도 되는 이유**: 부과합은 `amount_due × 인원`으로 언제든 나오고, 원래 총액(442,000)은 "남는 돈" 확인용으로 만들 때 한 번 보는 값입니다. 정말 남기고 싶으면 `label` 에 `'8/22 정모 회식 (총 442,000)'` 로 붙이거나 note 컬럼 하나 더. 나중에 배치 관리(수정·일괄 조정)가 진짜 필요해지면 **`batch_key` → `batch_id` 로 승격**하면 됩니다. 그때는 이미 어떤 조작이 필요한지 알고 만들게 되죠.

**덤으로 좋은 점**: 기존 화면에 새 부과가 섞이지 않습니다. 회비 현황은 `.eq("kind","monthly_fee")`, 대관비는 `.eq("kind","court_fee")` 로 이미 좁혀 조회하고 있어서(`dues.ts:522`, `:569`) 그대로 두면 됩니다. 반대로 **회원 쪽은 자동으로 붙습니다** — 내 미납 조회는 kind 필터가 없어서 `label` 만 읽게 해주면 미납 목록과 진입 알림에 그대로 올라옵니다.

정리하면 실제 작업은 이렇습니다: **마이그레이션 1장(위 DDL + 생성/삭제 RPC 2개) + 새 탭 1개 + `unpaidLabel` 분기 하나 + 타입 유니온 3곳.** 기존 부과 로직은 0줄입니다.

이 방향으로 갈까요? 아니면 대관비 정정(세션 228, 108,000원)을 먼저 처리할까요?

---

## #154

**Prompt**: 일단 하나씩. 대관비 0원으로 했는데 부과된거 체크하려는거지?

**Answer**: ## 1) 대관비 0원 정정 — 완료

### 원인 (확정)

`dues_generate_session_court` 한 줄이었습니다.

[코드 블록 생략]

`court_fee = 0` 을 "총액 없음"으로 읽어 정액 모드로 떨어졌고, 정액은 운영진을 제외하므로 **확정 24명 − 운영진 6명 = 18건 × 6,000 = 108,000원**이 8/22 13:40(세션 종료 트리거)에 생성됐습니다. 부과된 18명 집합이 "확정 − 운영진"과 완전히 일치해 정액 모드임이 확정됐습니다.

### 적용한 것 (`20260823000000`, 프로덕션 반영 완료)

**총액의 의미를 3분기로 갈랐습니다.** NULL(미입력)=정액 6천 / **0 이하=안 걷음** / 0 초과=엔빵. 회차 단위로 "안 걷는다"를 표현할 수단이 이제 생겼습니다(종전엔 장소 게이트로 장소 전체를 끄는 방법뿐).

적용 전 드라이런(`begin … rollback`)으로 프로덕션에서 결과를 먼저 실증하고 넣었습니다:

| | 적용 전 | 적용 후 |
|---|---|---|
| 세션 228 대관비 부과 | 18건 / 108,000원 | **0건 / 0원** |
| 전체 부과 행 | 371 | 353 (−18, 그 외 무변동) |
| 다른 8월 세션(106·107·111·147·237) | 각 6,000원 | **전부 그대로** |

정액 경로(147, 총액 NULL)와 엔빵 경로(237, 117,000)를 롤백 트랜잭션에서 재실행해 값이 안 바뀌는 것도 확인했습니다. 감사 로그(`court_zero_no_charge_fix`)에 지운 18건의 원본을 남겼습니다.

안전 확인: `court_fee ≤ 0` 인 세션은 228 하나뿐이고 반복 규칙 8개는 전부 NULL이라, 다른 시리즈가 조용히 무부과로 바뀌는 일은 없습니다.

### 같이 고쳐야 했던 것 — 클라이언트 미러

문서(`ACCOUNTING_SPEC §3.1.1`)가 경고하고 있었습니다: `sessionSettle.ts` 가 서버 분기를 미러하고 있어서, 서버만 고치면 **정모/현황 시트가 참석자 18명을 "참석·당일취소인데 부과 없음" 빨강으로 오탐**합니다. 그래서 함께 처리했습니다.

- `mode: "split" | "flat"` → `| "none"` 추가, 무부과 회차는 부과 대상 0명·인당 0원
- 새 사유 `noCourtFee`("안 걷는 회차 · 미부과") — 참석자는 정상 면제로, 남은 부과는 잔재(stale)로
- 시트 부제 "안 걷는 회차 · 대관비 미부과", 부과 대상 줄에 "총액 0원 — 이 회차는 회원에게 걷지 않아요"
- 회차/규칙 에디터 힌트 3분기 — 0을 넣으면 이제 "0원 · 이 회차는 회원에게 대관비를 걷지 않아요"로 바뀝니다(종전엔 "총액 미입력 · 정액이 부과돼요"라 의도와 반대로 읽혔습니다)
- 회귀 테스트 7개 추가(총액 0·음수·규칙 0 물려받기·NULL은 정액 유지·잔재 검출) → **352개 전부 통과**, `tsc` 0, lint 0

문서도 §1.1/§4/§3.1.1을 갱신했습니다(그 문서가 대관비 룰 변경 시 갱신을 요구하고 있어서).

### 남은 두 가지

1. **프론트 배포가 필요합니다.** DB는 고쳐졌지만 배포된 화면은 아직 옛 미러라, 지금 정모/현황에서 세션 228을 열면 "부과 누락 18명"으로 빨갛게 보입니다. `git push` 하면 해소됩니다 — 커밋은 안 하고 staging만 해뒀습니다.
2. **회원 안내는 수동입니다.** 부과 생성·삭제에는 푸시가 나가지 않습니다. 하루 동안 18명에게 6,000원 미납으로 보였으니 "8/22 정모 대관비는 안 걷습니다, 잘못 표시된 미납은 정리했습니다" 정도의 공지가 필요합니다.

### 발견했지만 손대지 않은 별건

**종료된 회차의 총액을 나중에 고쳐도 부과는 재계산되지 않습니다.** 회차 에디터가 `sessions` 를 직접 PATCH 하고 `dues_set_session_fee` RPC 를 타지 않으며(클라 호출 0건, 감사로그에도 기록 없음), 재계산 트리거는 `status → closed` 뿐입니다. 이번 건은 0원이 사실이라 문제가 안 됐지만, "총액을 나중에 확정하는" 경우엔 조용히 무시되는 조작입니다. 문서 §1.1에 미해결 갭으로 기록해뒀습니다.

먼저 `git push` 로 프론트 배포부터 할까요? 그다음 식사 엔빵 부과로 넘어가면 되겠습니다.

---

## #155

**Prompt**: 식사 앤빵뿐만아니라 다른 수동부과도 넣을거라 필터를 좀 다양하게 하고 모듈화 해서 나즁에 다른 필터도 넣기 평하게해둬

**Answer**: 수동 부과를 필터 레지스트리 구조로 만들었습니다. 핵심은 **필터를 추가할 때 손댈 곳이 배열 한 곳**이라는 것입니다.

## 필터 모듈 (`src/lib/dues/chargeFilters.ts`)

필터 하나 = 객체 하나. 화면은 배열을 렌더링만 하고 **개별 필터 id를 한 번도 모릅니다**.

[코드 블록 생략]

**추가 방법**: `SOURCES` 또는 `REFINES` 에 정의 하나를 넣는다. 끝입니다. 새 판단 재료가 필요하면 `FilterContext` 에 필드 하나 추가(채우는 건 호출부). 속성 하나로 거르는 refine은 헬퍼로 **한 줄**입니다:

[코드 블록 생략]

### 지금 들어간 필터

**시작 목록 7개** — 🍽 식사 체크 · 참석 · 실제로 뛴 사람(참석 ∪ 보드) · 최근 30일 참석 · 전체 회원 · 직접 고르기(빈 목록) · 지난 명단 재사용

**걸러내기 6개** — 비활성/게스트/운영진/명예회원 제외 · 성별만(남/여) · 지난 명단 제외(중복 부과 방지)

용도별로 이렇게 갈립니다: **회식**은 `🍽 식사 체크`(세션 228 기준 17명이 한 번에), **콕공구**는 `직접 고르기` 또는 `지난 명단 재사용`(반복되니까), **유니폼**은 `전체 회원` + `성별만`.

칩마다 **"켜면 몇 명"** 미리보기가 붙어서 누르기 전에 결과를 알 수 있고, 못 쓰는 필터는 사유를 그대로 보여줍니다("회차를 먼저 고르세요", "이 회차는 식사 체크를 쓰지 않았어요").

### 손 편집이 필터보다 오래 산다

필터 결과에 `added`/`removed`를 **병합하지 않고 따로** 들고 있습니다. 최종 = `필터 결과 ∪ added − removed`. 식사 체크 안 했는데 온 사람, 체크했는데 안 간 사람은 매번 생기는데, 필터를 바꿀 때마다 그 예외가 날아가면 쓸 수 없기 때문입니다.

전부 순수함수라 화면 없이 전 조합을 검사합니다 — **41개 테스트**(`chargeFilters.test.ts`), 레지스트리 규약(id 중복 없음, role 일치, options 없이 불러도 안 터짐)까지 포함.

## 금액도 별도 모듈 (`splitAmount.ts`)

대관비 엔빵과 **엮지 않았습니다**. 회식은 1,000원 단위로 걷는 실무가 흔해서 절상 단위를 운영진이 고르고, 정액 근처 스냅이 없습니다. 한쪽 규칙을 바꿀 때 다른 쪽이 조용히 따라 움직이면 안 되니까요. 총액과 부과합의 **차액을 항상 돌려줘서**("2,000원 더 걷힘") 총무가 총액을 다시 세지 않게 했습니다.

## 스키마 — 새 테이블 없음 (지적하신 방향대로)

`dues_charges` 에 컬럼 3개만 추가했습니다. 회비의 `period_ym` 이 하던 것과 **똑같은 semantic key** 방식입니다.

[코드 블록 생략]

`period_ym` XOR `session_id` XOR `batch_key` 3지선다 + `uq_charge_batch(member, batch_key)`. **기존 회비·대관비 경로는 0줄 변경**입니다.

RPC 2개(`dues_upsert_manual_batch` / `dues_delete_manual_batch`)를 프로덕션에 적용하고, 롤백 트랜잭션에서 전 수명주기를 실증했습니다:

| 단계 | 결과 |
|---|---|
| 생성(3명 26,000) | charged 3 |
| 축소(2명 27,000) — 납부자를 명단에서 뺌 | charged 2, **locked 1** (납부분은 안 지워짐) |
| 삭제 | removed 2, **kept_paid 1** |

납부분 보호가 대관비 생성기와 같은 규칙(`amount_paid = 0` 게이트)으로 동작합니다.

## 크로스 커팅 — 조용히 새는 곳을 다 막았습니다

새 `kind` 는 이미 `dues_charges` 를 읽는 모든 경로로 흘러갑니다. 확인하고 고친 것:

- **`fetchTxAllocations`** — `else` 분기가 모든 비회비를 "대관비"로 라벨링해서 회식이 `"세션 대관비"` 로 뜰 뻔했습니다 → manual 분기 추가
- **`myUnpaid.selectUnpaid`** — `court_fee || monthly_fee` 만 통과시켜 **수동 부과가 내 미납에서 통째로 빠질** 뻔했습니다 → 포함
- **`chargeLabel` / `unpaidLabel`** — 행이 들고 있는 `label` 사용
- **`UnpaidDuesAlert`** 제목 — 종류가 제각각이라 "미납 내역이 있어요" 로 뭉갬(정확한 이름은 아래 목록에)
- **`ReconcileInRow`** — 이미 `role: "other"` fallback 이 있어서 정산함 입금 매칭은 그대로 동작

**공개 회계는 손대지 않았습니다.** `dues_public_ledger` 는 회비/대관비만 명시 조인하고 나머지 입금은 카테고리·미분류로 흘러가서 "항목 순액 합 = 남은 돈" 불변식이 유지됩니다 — 지금 콕공구를 처리하는 방식과 동일합니다.

## 화면

`/dues/:ym/charge` = **[부과]** 탭(4번째). 데이터는 탭 진입 때만 로드(`loadManual`)해서 다른 세 화면을 무겁게 하지 않습니다.

- **목록**: 그 달 배치 — 이름 · 종류 · N명 × 인당 · 낼 돈/받은 돈 · 미납 N / 마감 ✓. 탭하면 명단·금액 수정(같은 키 upsert)이나 삭제
- **시트**: 종류 칩 → 이름(자동 채움) → 발생일 · 참고 회차 → 필터 바 → 대상 목록(초성 검색, 검색하면 대상 아닌 사람도 추가) → 금액(총액 엔빵/인당 직접 + 올림 단위) → 결과 박스(인당 · 부과합 · 차액)

**작업 중 잡은 버그 하나**: 배치 편집을 `전체 회원` 시작 목록으로 열면 저장된 명단 대신 전 회원이 선택됐습니다. `직접 고르기`(빈 목록) source를 추가해 고쳤고, 이건 콕공구처럼 명단을 카톡으로 받아오는 경우에도 필요한 필터였습니다.

## 검증

`tsc` 0 · 변경 파일 eslint 0 · **테스트 396개 전부 통과**(+51) · `vite build` 성공 · 프로덕션 스키마 확인(컬럼 3, 제약 3, 유니크 1, RPC 2, 기존 부과 353건 무변동, manual 0건).

실제 앱에서 클릭해 본 검증은 못 했습니다(운영진 OAuth 로그인 필요). RPC 경로는 프로덕션 롤백 트랜잭션으로 실증했지만, 화면 조작은 배포 후 확인이 필요합니다.

## 남은 것

`git push` 가 아직입니다 — 프론트 변경이 지금 두 건 쌓여 있습니다: ① 세션 228 미러 수정(안 하면 정모/현황이 "부과 누락 18명" 오탐) ② 이번 [부과] 탭. 커밋은 안 하고 staging만 해뒀습니다. 배포할까요?

---

## #156

**Prompt**: 커밋하고배포해

**Answer**: 커밋·배포 완료했습니다.

## 커밋 3개 (논리 단위로 분리)

[코드 블록 생략]

`docs/ACCOUNTING_SPEC.md` 는 두 회계 변경이 한 파일에서 섞여 있어서, 커밋 81efefb 용 중간 버전을 `git hash-object` 로 인덱스에 직접 넣어 3분할했습니다 — 각 커밋이 그 시점의 문서와 정확히 맞습니다.

## 배포 검증

`git push` → GitHub Actions **success**(`e1c867f`), https://ckti.me/ 200. 로컬 번들 해시(`index-BhFekIBC`)와 배포 번들(`index-Cg9Aijqs`)이 다른데, 이건 `.env.local` 값이 번들에 인라인되기 때문입니다(CI는 자체 시크릿) — 스테일 배포가 아닙니다. 그래서 해시 대신 **배포된 번들에서 새 코드 문자열을 직접 확인**했습니다:

[코드 블록 생략]

DB는 두 마이그레이션(`20260823000000`, `20260823010000`) 모두 이미 적용돼 있고, Edge Function 변경은 없습니다.

## 이제 확인해 주실 것

1. **정모/현황 → 8/22 정모 [정산 대조]** — "안 걷는 회차 · 대관비 미부과" 로 뜨고 "부과 누락 18명" 오탐이 사라졌는지
2. **[부과] 탭** — 참고 회차에 8/22 정모를 고르면 `🍽 식사 체크 17` 칩이 뜨는지, 총액 넣었을 때 인당·차액이 맞는지
3. **회원 안내** — 8/22 정모 대관비 6,000원이 하루 동안 미납으로 보였습니다. 부과 삭제에는 푸시가 나가지 않으니 수동 공지가 필요합니다.

실제 화면 클릭 검증은 운영진 OAuth 로그인이 필요해 제가 못 했습니다. [부과] 탭에서 첫 배치를 만들 때 결과(부과 인원·금액)를 한 번 봐주시면, 어긋나는 게 있으면 바로 잡겠습니다.

---

## #157

**Prompt**: 대관비 부과랑 그외랑 중복선택이 안됨

**Answer**: 원인 찾았습니다. 그리고 그 과정에서 **제가 놓친 게 하나 나왔습니다** — 먼저 그것부터 말씀드리는 게 맞겠습니다.

## ⚠ 먼저: 세션 228 대관비 6,000원을 이미 낸 사람이 4명 있습니다

부과를 지울 때 제가 확인한 건 `amount_paid = 0`(배분 0건)이었습니다. 그건 **"아직 배분 안 됨"일 뿐 "돈이 안 들어옴"이 아닙니다.** 부과가 생긴 8/22 13:40 직후부터 입금이 들어왔습니다:

[코드 블록 생략]

감사 로그로 확인한 결과 **4명 모두 제가 지운 18명 명단에 있었습니다.** 지금 네 사람은 미납이 0이라 이 24,000원이 미분류 입금으로 떠 있습니다. 부과를 지우기 전에 "그 부과를 겨냥한 미처리 입금"을 확인해야 했는데 빠뜨렸습니다.

처리 방향은 운영 결정입니다: ① 4명에게 환불 ② 9월 회비 선납으로 돌리기 ③ 8/22 정모는 4명만 냈으니 형평상 대관비를 걷기로 되돌리기. (④ 회식비 충당은 안 됩니다 — 김주영·손형일은 회식비 30,000을 이미 완납했고, 최두호·이정완은 회식 명단에 없습니다.)

---

## 중복선택 — 의도된 배타입니다

`ReconcileInRow.tsx`:

[코드 블록 생략]

막힌 입금이 **엄지현 54,000원**(8/23, 미처리)이죠. 정체를 확인했습니다:

[코드 블록 생략]

## 배타를 그냥 풀면 안 되는 이유

`dues_public_ledger` 에서 **카테고리는 거래 전액을 먹습니다** (`categories[].in` = category_id 지정된 입금 전액). 그래서 부과 배분과 분류를 동시에 걸면:

- 콕공구 항목: **54,000** (회식비 30,000까지 콕공구로 집계)
- 회식비 30,000: 어느 항목에도 안 뜸

총합 불변식은 유지되지만 항목이 틀립니다. 한 거래에 성격이 둘 섞이면 카테고리 방식으로는 **금액을 쪼갤 수 없습니다** — 카테고리가 거래 단위 단일 컬럼(`bank_transactions.category_id`)이라서요.

## 오늘 바로 되는 길 — 코드 변경 없음

**콕공구도 [부과]로 만드세요.** 부과 칩끼리는 이미 다중 선택이 됩니다(`toggle` 은 Set 에 자유롭게 넣고, `doConfirm` 이 `chargeIds` 배열에 다 담습니다). 그러면:

[코드 블록 생략]

`[부과] 탭 → 새 부과 → 종류 '콕 공동구매' → 지난 명단 재사용 또는 직접 고르기 → 인당 24,000`. 이미 콕공구 입금 6건(24,000 × 6)이 카테고리로 태그돼 있는데, 그 사람들 부과를 만들어 배분해도 총합은 어긋나지 않습니다(수동 부과 배분은 `v_fee`·`v_court_alloc` 어디에도 안 들어갑니다).

## 근본 수정 제안 — 공개회계에 수동 부과 항목 추가

지금은 수동 부과에 배분된 입금이 **'미분류 입금'으로 뜹니다.** `uncat_in = (untagged_in − refund) − fee − court_alloc` 에서 manual 배분을 빼지 않기 때문입니다. 그래서 콕공구를 부과로만 처리하면 카테고리 항목은 지출 −600,000만 남고 수입은 미분류로 갑니다.

`v_manual_alloc` 을 계산해 `uncat_in` 에서 빼고 배치 라벨별 항목으로 노출하면, **카테고리를 안 써도 "8월 콕공구 +288,000 / −600,000" 처럼 순액이 맞습니다.** 그게 수동 부과의 제자리이고, 그러면 부과 vs 분류를 헷갈릴 일도 없어집니다(분류는 부과 대상이 아닌 수입 — 이자·외부인 입금 — 전용).

이건 회원에게 보이는 공개회계 숫자를 바꾸는 변경이라 임의로 하지 않았습니다.

---

두 가지 답을 주시면 이어가겠습니다:

1. **24,000원(4명)** — 환불 / 9월 선납 / 대관비 걷기로 되돌리기 중 어느 쪽인가요?
2. **공개회계에 수동 부과 항목 추가** — 진행할까요? (그러면 콕공구를 부과로 관리하는 게 완전히 깔끔해집니다)

---

## #158

**Prompt**: 그럼 3만원 선택하면 남은돈만큼 또 정산할수 있게 아이템이 나오는 형태는 어때

**Answer**: 그 형태가 맞습니다. 그리고 그렇게 하면 지금 막힌 게 풀리는 데다, **공개회계에 있는 다른 문제까지 같이 해결됩니다.**

## 지금 8월 공개회계 상태

[코드 블록 생략]

회식비를 9명이 이미 냈는데(270,000 수납), 그 입금이 **"미분류 입금"으로 뜹니다.** `uncat_in` 이 차감하는 건 회비·대관비 배분뿐이고 수동 부과 배분은 안 빼기 때문입니다. 즉 부과를 만들어 정산해도 공개회계에서는 정체불명 돈으로 보입니다.

## 제안하신 형태 = "거래 = 부과 배분 + 나머지"

이 모델로 가면 UI와 회계가 같은 규칙을 씁니다.

[코드 블록 생략]

- 부과를 고르면 **잔액이 자동 계산**되고, 잔액이 남아 있을 때만 [그 외] 그룹이 뜬다
- 잔액을 분류하면 지금의 빨간 "금액이 안 맞아요" 경고가 사라진다 — 경고 대신 **어디로 보낼지 묻는 흐름**이 된다
- 확인 시 `dues_confirm_reconcile`(배분) + `dues_set_txn_category`(잔액 분류)를 순차 실행

## 이게 성립하려면 공개회계 3줄이 같이 바뀝니다

**핵심 이유**: 지금 카테고리는 **거래 전액**을 먹습니다(`categories[].in` = category_id 지정된 입금 전액). UI만 고치면 엄지현 54,000이 전부 콕공구로 잡히고 회식비 30,000은 어느 항목에도 안 뜹니다. 그래서 회계 쪽 규칙을 UI와 맞춰야 합니다:

| | 지금 | 바꿀 것 |
|---|---|---|
| 카테고리 수입 | 거래 **전액** | 거래 전액 **− 그 거래 배분액** (잔액만 먹는다) |
| 수동 부과 배분 | 항목 없음 → 미분류로 샌다 | **배치 라벨별 항목**으로 노출 + `uncat_in` 에서 차감 |
| `uncat_in` 이 빼는 배분액 | 그 달 **전체** 배분액 | **미분류 거래의** 배분액만 (안 그러면 카테고리 거래에 배분이 붙는 순간 음수로 샌다) |

8월 예상 변화: **미분류 입금 353,000 → 8만원대**, 새 항목 `8. 22. 정모 +270,000`. 총합(남은 돈 512,039)은 그대로 — 항목 합계 = 남은 돈 불변식은 유지됩니다(제가 방금 검산했고, 세 변경 후에도 대수적으로 상쇄됩니다).

**소급 영향 없음**: 카테고리와 배분을 동시에 가진 거래는 현재 **0건**이라, 위 첫·셋째 변경은 과거 달 숫자를 건드리지 않습니다. 둘째 변경만 8월 미분류 → 항목 이동을 일으킵니다(이건 지금이 틀린 거라 고치는 게 맞습니다).

## 한계 하나는 남습니다

카테고리는 거래 단위 단일 컬럼이라 **잔액을 두 카테고리로 쪼개는 건 안 됩니다**(예: 잔액 24,000 = 콕 12,000 + 유니폼 12,000). 그런 건 부과로 만들어야 하고, 이제 [부과] 탭이 있으니 그게 정상 경로입니다. 분류는 "부과 대상이 아닌 수입"(이자·외부인 입금) 전용으로 남깁니다.

---

작업 범위는 `ReconcileInRow` UI + `ReconcileInbox` 핸들러 + `dues_public_ledger` 재정의 + 문서, 반나절 정도입니다. 회원에게 보이는 공개회계 숫자가 바뀌는 변경이라 확인받고 들어가겠습니다 — **이대로 진행할까요?**

그리고 앞서 여쭤본 것 하나가 아직 열려 있습니다: **세션 228 대관비 6,000원을 이미 낸 4명(24,000원)** — 환불 / 9월 선납 / 대관비를 걷기로 되돌리기 중 어느 쪽으로 할까요? 이건 회원 돈이 걸려 있어 먼저 정하는 게 좋겠습니다.

---

## #159

**Prompt**: 그래서 반대로 가격이 정해진 회식비를 먼저 정산하면 남은돈이 남잖아. 네가 말한것처럼 콕공구부터 정산하면 전부 들어가지만.

**Answer**: 정확합니다. 그 비대칭이 이 문제의 전부입니다.

## 지금은 순서가 결과를 바꿉니다

| 무엇을 먼저 고르나 | 결과 |
|---|---|
| **회식비 30,000**(부과 — 금액 고정) | 24,000이 갈 곳 없음. "금액이 안 맞아요" 경고만 뜨고 콕공구는 처리 못 함 |
| **콕공구**(분류 — 금액 없음) | 54,000 **전액**이 콕공구로. 회식비 30,000은 미납으로 그대로 남음 |

부과는 금액이 정해져 있어 **잔액을 만들고**, 분류는 금액이 없어 **전액을 먹습니다.** 둘을 같이 고를 수 없으니 어느 쪽으로 가도 한쪽이 틀립니다.

## 규칙을 한 줄로 못 박으면 순서가 사라집니다

> **분류 수입 = 거래 금액 − 그 거래의 부과 배분액**

이 한 줄이 모든 경우를 덮습니다:

- 부과만 고름 → 잔액은 미분류 입금 (지금과 동일)
- 분류만 고름 → 배분액 0 → 잔액 = 전액 (지금과 동일)
- 둘 다 고름 → 부과는 정해진 금액, 분류는 **나머지**
- **콕공구를 먼저 눌렀다가 회식을 추가해도 결과가 같습니다** — 분류 금액이 54,000에서 24,000으로 저절로 줄어듭니다

화면도 그대로 보여주면 됩니다. 분류 칩에 금액이 붙고 부과 선택에 따라 실시간으로 바뀝니다:

[코드 블록 생략]

## 저장 구조는 안 바뀝니다

`bank_transactions.category_id` 는 지금처럼 **하나만** 저장합니다. "분류 = 잔액"은 저장값이 아니라 **계산**입니다(거래 금액 − 배분액). 그래서 스키마 변경이 없고, 공개회계 산식과 정산함 화면이 **문자 그대로 같은 문장**을 쓰게 됩니다 — 두 곳이 갈릴 여지가 구조적으로 없어집니다.

바꿀 곳은 결국 세 군데뿐입니다:
1. `categories[].in` = 전액 → 전액 − 배분액 *(현재 해당 거래 0건이라 과거 달 숫자 무영향)*
2. 수동 부과 배분을 배치 라벨별 항목으로 노출 + `uncat_in` 에서 차감 *(8월 미분류 353,000 중 회식비 270,000이 제자리로)*
3. `uncat_in` 이 빼는 배분액을 "미분류 거래의 배분액만"으로 한정 *(안 하면 1번 때문에 음수로 샘)*

## 남는 한계 하나

잔액을 **두 분류로 쪼개는 건 여전히 안 됩니다**(예: 잔액 24,000 = 콕 12,000 + 유니폼 12,000). 카테고리가 거래당 하나라서요. 그런 건 [부과]로 만드는 게 정상 경로이고, 이제 그 탭이 있으니 막힌 길은 아닙니다.

---

이 규칙으로 구현하겠습니다. 두 가지만 확인해 주세요:

1. **진행 여부** — 공개회계 숫자가 바뀌는 변경이라(8월 미분류 353,000 → 8만원대, `8. 22. 정모 +270,000` 항목 신설) 마지막 확인입니다
2. **세션 228 대관비 6,000원 낸 4명(24,000원)** — 환불 / 9월 선납 / 대관비 걷기로 되돌리기

2번은 회원 돈이 걸려 있어 계속 열려 있습니다. 1번만 답해주시면 그것부터 시작하고, 2번은 정해지는 대로 처리하겠습니다.

---

## #160

**Prompt**: 아니 지금 뭔가 로직이 꼬이는거 같은데, 기획부터 단순명료하게 정리해봐.

**Answer**: 맞습니다. 제가 증상에 맞춰 기계를 하나 더 붙이려 했고(잔액 분류), 그게 꼬임을 키웠습니다. 원점에서 정리하겠습니다.

## 왜 꼬였나 — 수입을 설명하는 축이 둘이다

|  | **부과**(dues_charges) | **분류**(txn_categories) |
|---|---|---|
| 단위 | 사람 × 무슨 돈 | 통장 거래 |
| 금액 | 미리 정해짐 | 거래 **전액** |
| 미납 추적 | 된다 | 안 된다 |
| 공개회계 항목 | 회비·세션만 뜬다 (**수동 부과는 안 뜸**) | 뜬다 |

콕공구를 **분류**로 하면 누가 안 냈는지 모릅니다. **부과**로 하면 미납은 잡히는데 회계 항목에 안 뜨고 미분류로 샙니다. 그래서 둘을 섞게 되고, 한 입금에 겹치는 순간 "전액이냐 잔액이냐 / 순서가 뭐냐"가 튀어나옵니다. **문제는 겹침이 아니라 축이 둘인 것입니다.**

## 원칙 4줄

1. **회원에게 걷는 돈은 전부 부과다.** 회비·대관비·회식·콕공구·유니폼 — 예외 없음.
2. **분류는 회원에게 걷지 않는 돈에만.** 이자·외부인 입금·잡수입, 그리고 모든 지출.
3. **"무슨 돈인가"(항목)는 부과가 들고 있다.** 공개회계는 그 항목으로 집계한다.
4. **항목 축은 거래 분류 하나로 통일한다.** 단 대관 세션은 세션 축을 유지한다(세션별 손익이 운영 판단 단위라서).

원칙 1·2가 핵심입니다 — **분류는 이제 "부과의 대안"이 아니라 "부과가 아닌 것"**입니다. 역할이 겹치지 않으면 우선순위·순서·잔액 문제가 애초에 생기지 않습니다.

## 그래서 제가 앞서 설계한 것 중 버릴 것

- ❌ 잔액 분류 UI
- ❌ 부과 칩 + [그 외] 동시 선택
- ❌ `categories[].in` = 전액 − 배분액 계산

**전부 불필요해집니다.** 엄지현 54,000은 원칙 1을 지키면 이렇게 끝납니다:

[코드 블록 생략]

한 입금에 부과와 분류가 섞이는 일은 원칙 1·2 아래서는 거의 없습니다(회원이 회비랑 이자를 같이 보낼 일은 없죠). 진짜 그런 케이스가 나오면 그때 만들면 됩니다.

## 그래서 실제로 필요한 것 두 개

**① 수동 부과의 '종류'를 거래 분류와 같은 축으로**

제가 `MANUAL_TYPES`(회식/콕공구/유니폼/물품/기타)를 코드에 하드코딩했는데, 이게 회계 항목(`txn_categories`: 콕공구·정모·기타·이자)과 **다른 축**입니다. 이게 꼬임의 한 원인입니다. 부과를 만들 때 **거래 분류를 고르게** 하면:

- 항목 축이 하나가 되고, 운영진이 [회계] 화면에서 항목을 추가할 수 있습니다(이미 있는 UI)
- **수입과 지출이 한 줄에서 만납니다**: `콕공구 +288,000 −600,000 = −312,000`

`dues_charges.category_id` 컬럼 하나 추가입니다.

**② 공개회계 항목별 수입에 부과 배분을 포함**

> 항목별 수입 = (그 항목 부과에 배분된 금액) + (그 항목으로 태그된 거래 수입)

이 한 줄이면 회식비 270,000이 미분류에서 제자리로 갑니다. 지금 8월 미분류 입금 353,000의 대부분이 그것입니다.

## 케이스 점검

| 케이스 | 처리 |
|---|---|
| 회식비 30,000 × 17명 | 부과(항목=정모 또는 회식) → 항목 수입으로 집계 |
| 콕공구 24,000 × N명 | 부과(항목=콕공구) → 지출 600,000과 같은 줄에서 순액 |
| 대관비 | 부과(세션 축) — 지금 그대로 |
| 회비 | 부과(회비 항목) — 지금 그대로 |
| 이자 39원 | 분류 — 지금 그대로 |
| 외부인 대관비 입금 | 분류/세션 — 지금 그대로 |

## 결정이 필요한 것 하나

8월 콕공구 입금은 **이미 분류로 처리**돼 있습니다(카테고리 수입 470,000, 배분 0건). 원칙 1로 옮기면 그 사람들 부과를 만들고 기존 태그를 떼야 하는 운영 작업이 생깁니다.

- **(a) 8월은 그대로 두고 9월부터 부과로** — 작업 0, 8월 콕공구 항목은 지금처럼 분류로 맞게 나옴 ← 추천
- **(b) 8월도 소급 전환** — 부과 생성 + 태그 제거 + 재배분. 정확하지만 손이 많이 감

---

이 정리가 맞으면 작업은 **컬럼 1개 + 공개회계 산식 한 줄 + [부과] 탭의 종류 칩을 분류 칩으로 교체**입니다. 앞서 제가 벌려놓은 잔액/동시선택 설계는 폐기합니다.

이 기획이 맞습니까? 맞으면 `docs/ACCOUNTING_SPEC.md` 에 §1.1·§3.6 개정으로 반영하고 구현하겠습니다. 그리고 **세션 228 6,000원 4명(24,000원)** 은 여전히 답을 기다리는 중입니다 — 이건 회원 돈이라 먼저 정해주시면 좋겠습니다.

---

## #161

**Prompt**: 그러면 헷갈리지 않게 분류를 제거하자. 근데 지금 제거하면 기존 것들도 꼬이기 시작하니까, 앞으로 분류를 사용하지 않는 방향으로 할테니까, 그걸 고려해서 다시 설계해봐.

**Answer**: 분류를 없애고 나면 항목 축이 비는데, 그걸 이미 있는 개념으로 메울 수 있습니다. 그러면 축이 **하나 줄어듭니다.**

## 한 문장

> **모든 돈은 "묶음"에 속한다. 묶음은 세 가지 — 월(회비) · 세션(대관) · 배치(그 외).**

부과의 묶음 축(`period_ym` / `session_id` / `batch_key`)을 **회계 항목 축으로도 그대로 쓰는 것**입니다. 새 개념이 아니라, 이미 만든 것을 한 번 더 쓰는 것입니다.

## 그래서 분류가 필요 없어집니다

| 분류로 하던 일 | 대체 |
|---|---|
| 콕공구 **수입** 태그 | 배치 "8월 콕공구" 의 부과 배분 |
| 콕공구 **지출** 600,000 태그 | 그 배치에 **출금 연결** (세션에 대관료 붙이는 것과 동일) |
| 대관료 지출 | 지금처럼 세션 연결 |
| 이자·잡수입 | 미분류 (정직하게 그대로 둠) |

세션이 이미 **"부과 묶음 + 지출 연결 = 세션별 손익"** 을 하고 있습니다. 배치가 같은 일을 하면 됩니다. 분류는 그 역할을 어설프게 겹쳐 하던 것이라 빠지는 게 맞습니다.

## 손익 산식 — 세 묶음 모두 같은 문장

[코드 블록 생략]

결과 예시(8월):

[코드 블록 생략]

## 화면 변화

| 화면 | 변화 |
|---|---|
| 정산함 **입금** 행 | **[그 외] 분류 칩 제거.** 부과 칩만 남고 다중 선택 — 순서·잔액·배타 문제가 **구조적으로 사라짐** |
| 정산함 **출금** 행 | [코트대관 · 세션] 옆에 **[부과 배치]** 추가. 분류 칩은 레거시 표시용으로만 |
| [부과] 탭 | 그대로. 배치 `label` 이 곧 회계 항목 이름이 됨 |
| 공개회계 | 배치가 항목으로 등장. 회식비 270,000이 미분류에서 제자리로 |

엄지현 54,000은 이 설계에서 **코드 변경 없이** 끝납니다 — 회식 부과 30,000 + 콕공구 부과 24,000, 둘 다 부과 칩이라 이미 다중 선택됩니다.

## 기존 데이터는 건드리지 않습니다

- 입금·출금에 붙어 있는 기존 `category_id`(콕공구 470,000/600,000, 이자 39)는 **그대로 읽어 계속 표시** → 과거 달 숫자 불변
- 앞으로 **입금에는 category_id 를 새로 붙이지 않습니다**(UI 제거)
- `txn_categories` 테이블·[회계]의 항목 관리 UI는 남겨둡니다(레거시 표시 + 혹시 필요할 때). 지우는 건 나중에 정말 안 쓰게 된 뒤에

## 8월 이행

**8월은 레거시로 그대로 두는 것을 추천합니다.** 콕공구 수입 470,000이 이미 분류로 맞게 잡혀 있고, 지금 배치로 옮기면 태그 제거 + 부과 생성 + 재배분을 19명분 해야 합니다. 9월 콕공구부터 배치로 하면 같은 이름의 항목이 이어져 연속성도 있습니다.

단 **회식비(meal:228)는 8월에 이미 배치로 만들었으니** 공개회계 산식만 고치면 자동으로 제자리에 뜹니다.

## 작업 목록

1. **DB 컬럼 1개** — `bank_transactions.batch_key`(출금·입금을 배치에 연결). `session_id` 와 같은 성격
2. **공개회계 함수 개정** — 배치 항목 추가 + `uncat_in` 이 빼는 배분액을 "미분류 거래의 배분액"으로 한정
3. **입금 행에서 분류 칩·상호배타 로직 제거** — 코드가 **줄어듭니다**(`catSel`·`toggleCategory`·`catMode` 삭제)
4. **출금 행에 배치 연결 추가**
5. 문서 개정 + "입금 분류는 폐지(레거시 읽기만)" 명시

앞선 턴에서 제안한 잔액 분류·동시 선택·`dues_charges.category_id` 는 **전부 폐기**합니다. 이 설계에서는 필요가 없습니다.

## 남는 구멍 하나

이자·잡수입처럼 **회원이 낸 게 아닌 입금**은 미분류로 남습니다. 그리고 정산함에서 치울 방법이 필요한데, `bank_transactions.status` 에 이미 `'ignored'`(레거시 무시 거래)가 있고 정산함이 그걸 건너뜁니다 — 입금 행에 **[회원 입금 아님]** 버튼 하나로 그 상태를 쓰면 정산함을 비울 수 있습니다. 금액이 커지는 잡수입이 생기면 그때 배치로 만들면 되고요.

---

이 설계가 맞습니까? 확정되면 `docs/ACCOUNTING_SPEC.md` 를 이 기준으로 개정하고(§1.1 묶음 세 가지 · §3.2 입금 처리 · §3.3 공개회계 · §3.6 배치) 구현하겠습니다.

그리고 **세션 228 6,000원 4명(24,000원)** 은 계속 열려 있습니다 — 환불 / 9월 선납 / 대관비 걷기 중 하나로 정해주세요.

---

## #162

**Prompt**: 현재 우리구조가 부과수정하기 너무 힘든구조인것 같아. 자동생성떄문일수도있겠는데, 현재 코드말고 기획만보고 부과에 대해 재설계해보자. 부과가 너무 연결되어 있어서 뭐가 취소되면 뭐가 나오고 하는 경우가 많은데 부과는 문자그대로 내야할 돈을 알려주는거고 그걸 내면 냈다고 처리하는거고 그런 부과를 묶어서 이건 대관이고 이건 정산이고 하는 영수증처리에 가까워. 근데 현재는 뭐 수정하면 이미 처리한 부과가 다시 튀어나오고 하는데 이걸 방지하기 위해 기획만 보고 부과를 다시 설계해봐

**Answer**: 좋은 진단입니다. 문제의 뿌리를 한 문장으로 말하면 이렇습니다.

## 진단: 부과가 "사실"이 아니라 "파생값"이다

지금 부과는 **규칙의 계산 결과**입니다. 참석 명단·회원 명단·총액이 바뀌면 다시 계산됩니다. 그래서:

- 손으로 고친 것이 다음 재계산에서 지워집니다 → 막으려고 `void` 가드, `amount_paid=0` 게이트, `status<>'void'` 예외가 붙었습니다
- 그 가드들이 서로 얽혀 **어떤 조작이 무엇을 되살리는지 예측이 안 됩니다**
- 참석 상태가 바뀌면(정원 변경 → 승격/강등) 부과가 따라 흔들립니다

말씀하신 "부과는 내야 할 돈을 알려주는 것, 그걸 묶은 게 영수증"이 맞습니다. **지금은 부과가 문서가 아니라 계산식입니다.**

## 원칙: 부과는 계산되는 값이 아니라 발행되는 문서다

> 규칙은 **초안을 만드는 도구**일 뿐이다. 발행된 뒤에는 규칙이 부과를 건드리지 않는다.

이 한 줄이 "이미 처리한 부과가 다시 튀어나오는" 문제를 **구조적으로** 없앱니다. 재계산이 초안에만 작용하니까요.

## 상태 두 층

[코드 블록 생략]

**부과 상태를 6개(unpaid/partial/paid/overpaid/waived/void)에서 2개로 줄입니다.** 미납·부분납·완납·초과납은 `납부액 vs 부과액` 비교로 나옵니다. 상태로 들고 있으니 동기화 대상이 되고, 그게 꼬임의 절반입니다. `waived`(면제)와 `void`(부과삭제)는 "안 걷는다"는 같은 뜻이라 하나로 합칩니다.

## 자동생성은 없애지 않고 "초안까지만"

| 시점 | 지금 | 재설계 |
|---|---|---|
| 세션 종료 | 부과를 **바로 발행** | 부과 **초안** 생성 |
| 월 첫 진입 | 회비를 **바로 발행** | 회비 **초안** 생성 |
| 수동 부과 | 사람이 만듦 | 초안 → 발행 |

운영 부담은 **세션당 버튼 하나**입니다. 대신 이번 8/22 사고가 발행 화면에서 걸립니다 — "18명 × 6,000 = 108,000원 발행" 을 보면 총액 0원으로 넣은 회차에서 이상함을 바로 알아챘을 겁니다. 지금은 조용히 나갔고 하루 뒤에 발견했습니다.

## 발행 후 허용 조작은 셋뿐

1. **취소** — 안 걷기로 함. 취소선 + 누가/언제. 미납에서 빠짐. 되살리기 가능
2. **금액 정정** — 금액만 교체, 이전 값은 감사에 남김
3. **추가 발행** — 빠진 사람에게 한 줄 더 발행

그리고 **납부된 부과는 취소할 수 없습니다** — 환불이 먼저입니다. 돈이 들어온 사실은 지울 수 없으니까요. (이 규칙 하나가 제가 어제 낸 24,000원 사고를 막아줍니다. "이 부과를 겨냥한 미처리 입금이 4건 있습니다"를 발행 취소 화면이 먼저 보여줍니다.)

이 셋은 서로 얽히지 않습니다. 지금처럼 "정원 바꾸면 강등이 일어나고 부과가 재생성되고 void 가 되살아나는" 연쇄가 없습니다.

## 묶음 = 영수증. 축 3개 → 1개

지금 부과의 묶음이 `period_ym` / `session_id` / `batch_key` 세 축으로 갈려 있고, 이게 XOR 제약·유니크 3개·분기 코드를 낳았습니다. **묶음 하나로 합칩니다.**

[코드 블록 생략]

회비·대관·기타가 **전부 같은 모양**입니다. 그래서 공개회계 항목도 묶음 그대로이고, 앞서 이야기한 분류 제거가 자연히 따라옵니다.

## 지금 얽힌 것들이 어떻게 풀리는지

| 실제로 있었던 문제 | 재설계에서 |
|---|---|
| 총액 0원인데 6,000원 × 18명이 조용히 부과됨 | 발행 화면에서 사람이 보고 막는다 |
| 정원 축소 → 강등 → 부과 삭제·재생성 | 발행분은 참석 변화에 반응하지 않는다 |
| 당일취소 부과삭제(void)가 재부과로 되살아남 | 재계산 대상이 아니라 `status<>'void'` 가드가 필요 없다 |
| 선납 보존용 `amount_paid=0` 게이트 | 발행분은 재계산하지 않으니 게이트 자체가 불필요 |
| 세션 237 보드 추가분 누락(9경기 뛰고 미부과) | 초안에서 빠졌으면 발행 화면에서 [추가 발행] |
| 부과 지웠는데 이미 낸 사람이 있었음(24,000원) | 납부·미처리 입금이 있으면 취소를 막는다 |
| 미납 판정이 6개 상태 + 이월 + 게이트로 갈림 | 납부액 비교 한 줄 |

## 이행 경로 (기존 데이터 안 꼬이게)

1. **기존 부과는 전부 "발행됨"으로 본다** — 이미 회원에게 보였으니 사실이다
2. **묶음을 채운다** — `period_ym`→월 묶음, `session_id`→세션 묶음, `batch_key`→기타 묶음. 기존 컬럼은 남겨두고 묶음 id 를 추가(expand). 컬럼 제거는 한참 뒤(contract)
3. **생성기를 초안 쪽으로 돌린다** — 지금 생성기는 그대로 두고 출력만 초안 테이블로. 발행 버튼을 정산 화면에 추가
4. **자동정리 DELETE 를 전부 없앤다** — 이게 안정화의 대부분이다
5. **상태 6개 → 2개** — 파생 계산으로 대체. 화면은 같은 라벨을 계속 보여준다

각 단계가 독립 배포 가능하고, 3번까지만 해도 "튀어나오는" 문제가 사라집니다.

---

## 한 가지 확인하고 싶은 것

발행 단계를 넣으면 **세션 종료마다 운영진이 버튼을 눌러야** 합니다. 지금은 자동이라 아무것도 안 해도 부과가 나갑니다.

- **(a) 발행 단계를 넣는다** — 사고를 사람이 막는다. 대신 세션당 클릭 1회 ← 추천
- **(b) 자동 발행 + 발행 후 동결** — 클릭은 없지만 잘못 나간 걸 사후에 정정. 지금 사고 유형은 못 막음
- **(c) 조건부 자동 발행** — 초안이 "평소와 같으면"(정액·인원 정상) 자동, 이상하면(총액 0, 인원 급변) 발행 대기

**(c)** 가 실무에 가장 맞을 수도 있습니다. 어느 쪽으로 갈까요? 이거 정해지면 이 기준으로 `docs/ACCOUNTING_SPEC.md` 를 개정하고(부과 §를 통째로 재작성) 1~3단계부터 구현하겠습니다.

그리고 **24,000원 4명**은 아직 답을 못 받았습니다 — 재설계와 별개로 지금 회원 돈이 떠 있는 상태입니다.

---

## #163

**Prompt**: c 로 해줘. 그리고 4명은 환불할거라 일단 돈이 떠 있는 상태로 냅둬. 기존 데이터 수정해야한다면 마이그레이션해줘

**Answer**: 배포까지 완료했습니다. 4명 24,000원은 손대지 않았습니다(환불 예정).

## 무엇이 바뀌었나 — 한 줄

> **`dues_charges` 에 행이 있으면 그건 이미 발행된 사실이다.** 규칙은 초안을 만드는 도구일 뿐, 발행된 뒤에는 금액도 삭제도 건드리지 않는다.

그래서 발행 표식 컬럼조차 필요 없었습니다 — `created_at` 이 곧 발행 시각입니다. 새로 만든 건 "아직 발행 안 된 초안"을 담을 테이블 하나뿐입니다.

## 없어진 것

`dues_generate_session_court` 의 **자동정리 DELETE 3경로**와 **기존 행 UPSERT 갱신**을 제거했습니다. 그 자리를 "발행 안 된 사람만 추가 발행"이 대신합니다. 얽혀 있던 `status<>'void'` 가드와 `amount_paid=0` 게이트가 존재 이유를 잃었습니다.

**재실행의 정의가 바뀌었습니다**: 예전엔 "같은 결과를 다시 만든다"였고, 지금은 **"할 일이 없으면 아무것도 안 한다"** 입니다.

## 조건부 자동 발행 (c)

정상이면 즉시 발행, 이상하면 `dues_charge_drafts` 에 대기 → 정모/현황 상단 **[발행 대기 N건]** 배너 → 검토 시트에서 판정 근거 숫자·명단을 보고 [발행]/[폐기]. **대기 초안은 회원에게 안 보입니다**(별 테이블 + RLS 운영진 전용).

- `amount_out_of_range` — 인당이 정액의 절반 미만/2.5배 초과 (총액 오타를 잡습니다)
- `new_members` — 이미 발행된 회차에 초안에만 있는 사람이 생김 (세션 237 손형일 유형)

**금액 차이는 대기 사유에서 뺐습니다.** 처음엔 넣었는데 드라이런에서 노이즈가 드러났습니다 — 세션 237은 발행 6,000원(8/18 운영 결정)인데 지금 20명으로 재계산하면 5,850원이 나와서, **변화가 없는데도 매번 확인 요청이 떴습니다.** 발행된 금액은 사실이니 규칙이 이의를 제기할 일이 아닙니다.

## 검증 (프로덕션 롤백 트랜잭션 12케이스)

| 시나리오 | 결과 |
|---|---|
| 그대로 재실행 | 무동작 (20건 6,000원 그대로) |
| 1건 **삭제** 후 재실행 | 새 사람 1명만 **대기** — 자동 재발행 안 함 |
| 1건 **void** 후 재실행 | 무동작 — **되살아나지 않음** |
| 총액 오타 100만 | 전원 대기 (인당 50,000 표시) |
| 신규 정상 | 즉시 20건 발행 |
| 대기분 [발행]/[폐기] | 1건 발행 / 1건 폐기, 나머지 불변 |
| 금액 정정 4케이스 | 납부자 1명 보존(locked=1) · NULL→정액 복귀 · 총액 0 무동작 |

적용 후 프로덕션: 기존 부과 무변동, 대기 0건, 테스트 396개 통과, 배포 번들에서 새 문자열 6개 확인.

## 덤으로 닫은 갭

규칙이 금액을 못 바꾸게 했으니 **정정할 곳**이 필요해졌고, 그게 `dues_set_session_fee` 의 원래 자리였습니다. 총액 저장 + 미납 발행분 금액 정정(납부분은 보존하고 몇 건인지 알려줌)으로 다시 정의하고, **회차 에디터의 [코트 총액]을 여기 연결**했습니다. 어제 "종료된 회차 총액을 고쳐도 부과에 반영 안 됨"으로 기록한 갭이 실제로 해소됐습니다.

## 남은 단계

이번은 대관비 경로만입니다. 같은 원칙을 넓히는 후속이 셋 남아 있습니다:

1. **회비 생성기**에 같은 원칙 적용 (지금은 여전히 월 진입마다 UPSERT — DELETE 는 없어서 덜 위험합니다)
2. **묶음 3축 통합** (`period_ym`/`session_id`/`batch_key` → 묶음 하나). 앞서 이야기한 "묶음=영수증"의 완성형
3. **부과 상태 6개 → 2개** (살아있음/취소, 나머지는 납부액에서 파생)

1번은 작고, 2·3번은 소비자가 많아 별도 작업이 맞습니다. 그리고 앞선 턴에서 합의한 **분류 폐지 + 묶음에 지출 연결**도 아직 구현 전입니다 — 어느 것부터 갈까요?

---

## #164

**Prompt**: 1번부터

**Answer**: 1번 완료, 배포했습니다.

## 회비 생성기에서 고친 것

회비는 자동정리 DELETE가 없어서 대관비보다 덜 위험했고, 남아 있던 문제는 UPSERT 한 줄이었습니다:

[코드 블록 생략]

**월 첫 진입마다 이미 발행된 미납 회비의 금액을 다시 써넣고 있었습니다.** 회비가 5,000원 고정이라 사고가 안 보였을 뿐, `dues_settings.monthly_fee` 를 바꾸는 순간 **과거 달 미납까지 새 금액으로 소급 변경**됩니다. 드라이런으로 실증했습니다 — 회비액을 9999로 바꾸고 재실행해도 발행분은 5,000원 그대로입니다.

## 술어를 단일 소스로 뽑았습니다

`dues_monthly_targets(ym)` 를 만들었습니다. 발행 모델에서는 회비 룰을 **네 경로**(대상 인원 세기 · 미발행자 세기 · 대기 초안 만들기 · 발행)가 쓰는데, 종전처럼 INSERT 한 곳에만 있던 술어를 복사하면 갈립니다. 대관비가 `dues_court_targets` 로 이미 겪고 해결한 문제라(무한 재부과/재삭제, `20260818000000`) 같은 모양으로 맞췄습니다.

## 회비의 이상 판정

`head_count_jump` — 이번 달 대상이 **지난달 발행의 ±40% 밖**이면 대기. 대량 비활성화·명단 사고를 사람에게 올립니다.

임계 기준은 실측으로 잡았습니다: 2026-06 **2명** / 07 **70명** / 08 **80명**. 6월(2명)을 기준으로 삼으면 무조건 걸리므로 **지난달 발행이 10명 미만이면 판정하지 않습니다.**

## 검증

프로덕션 롤백 트랜잭션 7케이스 — 재실행 무동작 / 1건 삭제 → 새 사람 1명만 대기(자동 재발행 없음) / void 후 부활 없음 / **회비액 변경에 발행분 불변** / 전체 삭제 → 즉시 77건 / 50명 비활성 → 인원 급감 대기(34 vs 70) / 대기분 발행 시 `label` 안 샘.

그리고 **프로덕션에서 실제로 재실행**해 무동작을 확인했습니다: `ret=0`, 80건 그대로, 대기 0건. 테스트 396개 통과, 배포 번들에 새 문구 4개 확인.

## 실측에서 나온 메모 하나

**2026-08 발행 80명 vs 현재 자격자 77명** — 발행 후 3명이 자격을 잃었습니다(비활성화 등). 새 모델에서 그 3명의 부과는 **사실로 남습니다.** 중도 탈퇴자도 그 달 회비는 낸다는 기존 결정(§3.1)과 정합하고, 안 걷을 거라면 취소(void)가 맞습니다. 지금 미납으로 잡혀 있으니 한 번 확인해 보시면 좋겠습니다.

## 남은 것

- **2. 묶음 3축 통합** (`period_ym`/`session_id`/`batch_key` → 묶음 하나) — "묶음=영수증"의 완성형. 소비자가 많아 expand/contract 두 단계
- **3. 부과 상태 6개 → 2개** (살아있음/취소, 나머지는 납부액 파생)
- **분류 폐지 + 묶음에 지출 연결** (앞서 합의) — 2번 위에 얹는 게 자연스럽습니다

2번을 하면 3번과 분류 폐지가 훨씬 쉬워집니다. 다음은 2번으로 갈까요?

---

## #165

**Prompt**: 2번 진행해줘

**Answer**: _(응답 대기 중…)_

---

## #166

**Prompt**: 2번 진행해줘

**Answer**: 2번 expand 완료, 배포했습니다.

## 무엇을 만들었나

[코드 블록 생략]

묶음 키를 **발행 대기 초안의 `draft_group` 과 같은 이름공간**으로 맞췄습니다. `court:228` 초안이 발행되면 `court:228` 묶음이 되니까, 대기 → 발행 흐름에서 이름이 그대로 이어집니다.

## 호출부를 한 줄도 안 고쳤습니다

**BEFORE INSERT 트리거가 기존 3축에서 묶음 정체를 유도해 `batch_id` 를 채웁니다.** 그래서 부과를 만드는 코드 — 생성기 2개, `dues_confirm_reconcile`, `dues_issue_drafts`, `dues_upsert_manual_batch`, 과거 보정 마이그레이션 — 전부 그대로입니다. 새 부과가 어디서 들어와도 묶음이 붙으니 나중에 "묶음 없는 부과"를 찾아 헤맬 일이 없고, 그 덕에 `batch_id` 를 **NOT NULL** 로 걸 수 있었습니다. 불변식을 DB가 지킵니다.

## expand만 했습니다

`period_ym` / `session_id` / `batch_key` 3축을 **그대로 두고 공존**시켰습니다. 읽기 경로가 하나도 안 바뀌니 **동작 변화 0**입니다. 이건 의도된 것으로, contract(읽기를 `batch_id` 로 전환 → 3축 제거)는 후속입니다.

## 백필

| | |
|---|---|
| 부과 372건 | 월 152 + 세션 203 + 배치 17 |
| 묶음 15개 | 월 3 · 세션 11 · 배치 1 |
| 미연결 | **0** |
| 엣지 | 0건 (`scheduled_at` null 세션 · 고아 `session_id` · 라벨 누락 전부 없음) |

## 검증

프로덕션 롤백 트랜잭션 4케이스 — 백필 결과 / 새 회비 발행(`2026-09` → `monthly:2026-09` "9월 회비" 자동 생성, 84건 전부 연결) / 수동 부과 이름 변경 → 묶음 라벨 동기 / 새 수동 배치 → 묶음 신설.

적용 후 프로덕션: 묶음 15개, 부과 372건, **미연결 0**, `batch_id` NOT NULL, 트리거 2개. `tsc` 0 · 테스트 396개 통과 · CI success.

이번 커밋은 마이그레이션과 문서만이라 프론트 번들은 바뀌지 않았습니다.

## 부수적으로 보인 것

드라이런에서 9월 회비를 미리 계산해봤는데 **84명**이 나옵니다(8월 80명 → +5%). `head_count_jump` 임계(±40%) 안이라 9월 첫 진입 때 자동 발행될 겁니다 — 어제 넣은 안전망이 정상 회차를 막지 않는다는 확인도 됐습니다.

## 남은 것

- **contract** — 읽기 경로를 `batch_id` 기반으로 전환하고 3축 컬럼 제거. 소비자가 많아 화면별로 나눠 하는 게 안전합니다
- **3. 부과 상태 6개 → 2개** (살아있음/취소, 나머지는 납부액에서 파생). 묶음이 생겼으니 이제 하기 쉬워졌습니다
- **분류 폐지 + 묶음에 지출 연결** — `dues_batches` 에 거래를 연결하면 "묶음별 손익"이 세션·회비·배치 전부 같은 모양이 됩니다. 앞서 합의한 그 형태

3번과 분류 폐지 중 어느 쪽이든 바로 갈 수 있습니다. 어느 것부터 할까요?

---

## #167

**Prompt**: 분류 폐지부터 해줘

**Answer**: _(응답 대기 중…)_

---

## #168

**Prompt**: 분류 폐지하는데 공구같은건 사람을 선택하고 부과하는 개념이 아냐. 이에 대한 대비책은 있어?

**Answer**: 지적이 맞습니다. 제가 "콕공구도 부과로 만들면 된다"고 한 건 틀렸습니다. 실측이 그걸 명확히 보여줍니다.

## 콕공구 입금 44건 실측 (2026-06 ~ 08, 1,531,000원)

| 금액 | 건수 | 정체 |
|---|---|---|
| 27,000 / 54,000 | 9 / 7 | 6월 차수 · 1타 / 2타 |
| 26,000 / 52,000 | 7 / 8 | 7월 차수 · 1타 / 2타 |
| 24,000 | 13 | 8월 차수 · 1타 |

**부과 모델이 성립하지 않는 이유가 셋 다 보입니다:**

1. **수량이 제각각** — 1타/2타로 금액이 2배 차이. 제 `splitAmount` 는 균일 인당을 전제합니다
2. **단가가 차수마다 다름** — 27,000 → 26,000 → 24,000
3. **명단을 미리 알 수 없음** — 6/14부터 8/22까지 흩어져 들어옵니다. 각자 카톡으로 신청하고 입금하는 흐름

그리고 가장 나쁜 것: **부과를 만들면 안 산 사람에게 미납 알림이 갑니다.** 공구는 미납이라는 개념 자체가 없습니다 — 신청 안 한 사람은 그냥 안 산 사람입니다.

이건 **부과(charge)가 아니라 모금(collection)** 입니다. 낼 돈을 먼저 정하고 걷는 게 아니라, 들어온 걸 집계하는 흐름입니다.

## 대비책: 묶음의 수입 경로를 둘로

[코드 블록 생략]

`bank_transactions.batch_id` 를 추가해서 **부과 없이 입금을 묶음에 붙입니다.**

**새 개념이 아닙니다** — 세션이 이미 그걸 하고 있습니다. `bank_transactions.session_id` 로 비회원 대관비 입금과 대관료 출금을 세션에 직접 붙이죠. 묶음은 세션 역할을 일반화한 것이니, 같은 걸 갖는 게 당연합니다.

그러면 공구가 자연스럽게 담깁니다: 미납 없음 ✓ 수량·단가 제각각 OK ✓ 그리고 `8월 콕공구` 묶음에서 수입 288,000 − 지출 600,000이 **한 줄에서 만납니다**(종전엔 '콕공구' 카테고리 한 줄에 6·7·8월이 다 섞였습니다 — 차수별로 갈리는 게 오히려 정확합니다).

## 산식 한 줄, 이중계상은 구조적으로 차단

> **묶음 직접 수입 = 연결된 거래의 금액 − 그 거래의 부과 배분액**

"잔액"만 먹으므로 같은 돈이 두 항목에 뜰 수 없습니다. 검산하면 `Σ묶음수입 + 미분류 = Σ배분액 + Σ잔액 = 총수입` 으로 불변식이 유지됩니다.

엄지현 54,000이 이 모델에서 이렇게 갈립니다:

[코드 블록 생략]

## 앞서 폐기한 "잔액" 이 다시 필요합니다 — 정직하게

제가 "원칙 1·2를 지키면 한 입금에 두 성격이 섞이는 일이 거의 없다"며 잔액 처리를 폐기했는데, **공구가 부과가 아니라면 그 전제가 무너집니다.** 회식 부과 + 공구 모금이 한 입금에 섞이는 건 실제로 있는 일(엄지현)이니까요.

다만 이번엔 **개념이 하나**입니다. 종전에 꼬였던 건 "부과냐 분류냐"라는 두 축이 겹쳐서였고, 지금은 둘 다 묶음입니다 — 부과 배분이 먼저 잡히고 나머지가 그 묶음의 직접 수입이 됩니다. 우선순위도 순서도 따질 게 없습니다.

## 화면은 손동작이 그대로입니다

정산함 입금 행의 **[그 외] 카테고리 칩 → 묶음 칩**으로 바뀝니다. 첫 콕공구 입금이 들어오면 `+ 새 묶음` 으로 "8월 콕 공구"를 만들고, 이후 입금은 그 칩을 고릅니다. 지금 카테고리 고르는 것과 같은 동작이고, 다른 건 항목이 고정 목록이 아니라 차수별로 생긴다는 것뿐입니다.

## 남는 구멍 하나

이자(연 몇십 원)처럼 반복되는 잡수입은 차수 개념이 없습니다 → **`기타 수입` 상설 묶음** 하나를 두면 됩니다. 묶음이 있으니 그게 자연스럽고, 앞서 "미분류로 둘까" 고민했던 게 해결됩니다.

## 그래서 분류는 폐지 가능합니다

| 분류가 하던 일 | 대체 |
|---|---|
| 공구 수입 태그 | 묶음 직접 연결 |
| 공구 지출 태그 | 묶음 직접 연결 |
| 대관료 지출 | 세션(= court 묶음) 연결 — 지금 그대로 |
| 이자·잡수입 | `기타 수입` 상설 묶음 |

`txn_categories` 는 기존 태그 표시용으로만 남기고(과거 달 숫자 불변), 새 태그는 안 붙입니다.

---

작업은 `bank_transactions.batch_id` 컬럼 1개 + 공개회계 산식 + 정산함 칩 교체 + 묶음 즉석 생성 RPC입니다. 이 방향으로 진행할까요?

---

## #169

**Prompt**: 해줘

**Answer**: _(응답 대기 중…)_

---

## #170

**Prompt**: 해줘. 그리고 작업할떄 기존 데이터 마이그레이션 가능한지 꼭 체크하고

**Answer**: _(응답 대기 중…)_

---
