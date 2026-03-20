# Branch: dev

## #1

**Prompt**: cocktime-scheduler 프로젝트의 리팩토링 결과를 **렌더링 성능, 컴포넌트 구조, 구독 경계** 관점에서 리뷰해줘.

변경된 파일 목록:
- src/components/SessionMain.tsx (경량화 - layout + lifecycle만 담당)
- src/components/session/CompactCourtBar.tsx (props 제거 → store 직접 구독)
- src/components/session/MatchQueue.tsx (props 제거 → store 직접 구독)
- src/components/session/RestingList.tsx (props 제거 → store 직접 구독)
- src/components/session/WaitingList.tsx (props 제거 → store 직접 구독)
- src/components/session/TeamCandidatesList.tsx (15개 props → 2개 props + store 직접 구독 + useTeamCandidates 내부화)
- src/hooks/useTeamCandidates.ts (16개 파라미터 → store 직접 구독)
- src/store/sessionStore.ts (sessionActions 추가)

각 변경된 파일을 읽고 다음을 확인해줘:
1. 불필요한 리렌더링 가능성 (전체 store 구독, 인라인 객체 생성 등)
2. prop drilling이 완전히 제거되었는지
3. 구독 경계가 컴포넌트 경계와 일치하는지
4. memo의 효과가 store 직접 구독으로 인해 변경되었는지 (memo가 불필요해진 곳이 있는지)

문제가 없으면 "이상 없음"으로 응답. 문제 발견 시 구체적 파일과 라인 번호를 포함하여 보고.

**Answer**: 전체 파일을 읽고 렌더링 성능/구독 경계/prop drilling 관점에서 리뷰했습니다. 주요 발견 사항:
- prop drilling은 완전히 제거됨. sessionActions 패턴(컴포넌트 구독 없이 직접 setState 호출)도 올바른 방식
- `MatchQueue.tsx` L16: `courts` 배열 전체를 구독하여 경기 시작/완료 시마다 대기열 카드가 리렌더됨. `hasEmptyCourt`를 selector로 분리하는 것이 의미상 더 명확함
- `TeamCandidatesList.tsx` L89-94: `getEmptyCourt()` 함수를 render마다 실행하고 있어 `useMemo` 또는 selector로 처리 권장
- `CompactCourtBar.tsx`의 `memo`는 부모(`SessionMain`)의 `showEndConfirm` 변경에 의한 불필요 리렌더만 막음. store 구독에 의한 리렌더는 막을 수 없고 막아서도 안 되므로 현재 구조가 맞음

---

## #2

**Prompt**: (팀 태스크) useTeamCandidates.ts에서 visibleCandidates(71-86줄)와 visibleCount(89-99줄) 두 useMemo를 하나로 통합.

**Answer**: `candidateTeams` 배열을 2번 순회하던 두 `useMemo`를 단일 순회로 통합했습니다. 주요 결정:
- `limited`(표시용 목록)와 `count`(표시 가능 수)를 같은 루프에서 동시 계산
- `count`가 TARGET에 도달하면 early break로 불필요한 순회 제거
- 반환 객체 `{ visibleCandidates, visibleCount, originalIndices }`를 즉시 구조분해하여 참조 안정성 유지
- `tsc --noEmit` 통과 확인

---

## #3

**Prompt**: (팀 태스크) CompactCourtBar.tsx의 GAME_TYPE_STYLE 객체(111-116줄)에서 미사용 darkBg/darkColor 필드 제거. 타입도 { bg: string; color: string }으로 단순화.

**Answer**: `GAME_TYPE_STYLE` Record의 타입 정의와 각 항목에서 `darkBg`, `darkColor` 필드를 제거했습니다. 해당 필드는 정의되어 있었으나 렌더 코드 어디에서도 참조되지 않는 dead code였습니다. 변경 후 스테이징 완료.

---

## #4

**Prompt**: (팀 태스크) sessionStore.ts에서 반복되는 `useAppStore.getState().sessionMeta?.sessionId ?? 0` 패턴(5곳)을 `getSessionId()` 헬퍼 함수로 추출.

**Answer**: 스토어 외부에 순수 함수 `getSessionId()`를 정의하고, `handleAssign`, `handleComplete`, `handleAddToQueue`, `handleRemoveFromQueue`, `handleAssignFromQueue`, `handleEndSession` 6곳의 반복 패턴을 교체했습니다. `session_refresh_required` 케이스는 `sessionMeta` null 체크가 별도로 필요한 맥락이므로 그대로 유지. `tsc --noEmit` 통과 확인.

---

## #6

**Prompt**: (팀 태스크) MatchQueue, TeamCandidatesList, WaitingList, RestingList 4개 컴포넌트의 반복되는 섹션 헤더 패턴을 SectionHeader 공통 컴포넌트로 추출.

**Answer**: `src/components/shared/SectionHeader.tsx` 신규 생성. props: `icon(ReactNode)`, `iconBg(string)`, `iconSize(number, default 24)`, `topPadding(number, default 16)`, `title(string)`, `badge(ReactNode?)`, `rightContent(ReactNode?)`. `WaitingList`/`RestingList`는 원래 상단 padding이 24px이었으므로 `topPadding={24}` prop으로 처리. `TeamCandidatesList`는 버튼 2개를 `rightContent`로 전달. 4개 컴포넌트 모두 교체 후 `tsc --noEmit` 통과 확인, 스테이징 완료.

---

## #5

**Prompt**: (팀 태스크) sessionStore.ts의 applyBroadcast switch문을 독립 함수로 추출하고 핸들러 맵으로 교체.

**Answer**: 9개의 브로드캐스트 이벤트 핸들러를 스토어 외부 순수 함수(`handleMatchStarted`, `handleMatchCompleted`, `handlePlayerStatusChanged`, `handlePlayerFlagChanged`, `handlePlayerUpdated`, `handleSessionRefreshRequired`, `handleQueueUpdated`, `handleCandidatesUpdated`)로 추출했습니다. `SetFn`/`GetFn` 타입을 정의하여 주입 방식으로 `set`/`get`을 전달. `applyBroadcast`는 `session_ended` 즉시 처리 후 `Record<string, Handler>` 핸들러 맵으로 디스패치하는 역할만 수행. `player_force_mixed_changed`와 `player_force_hard_game_changed`는 동일 로직이므로 `handlePlayerFlagChanged` 하나로 통합. `tsc --noEmit` 통과 확인.

---

## #7

**Prompt**: 현재 구현된 코드를 리팩토링 할거야. 필요없는 코드 제거하고 팀 에이전트의 의견대로 정리해.

**Answer**: hardwork 팀(OOP + 프론트엔드 에이전트)을 구성하여 설계 회의 → 구현 → 크로스 리뷰 진행. 5가지 리팩토링 수행:
- `useTeamCandidates.ts`: `visibleCandidates`/`visibleCount` 두 useMemo를 단일 순회로 통합, 불필요한 spread 배열 생성 제거
- `sessionStore.ts`: `getSessionId()` 헬퍼 추출로 6곳 반복 패턴 제거
- `sessionStore.ts`: `applyBroadcast` switch문(~150줄)을 9개 외부 순수 함수 + 핸들러 맵으로 분리
- `CompactCourtBar.tsx`: `GAME_TYPE_STYLE`의 미사용 `darkBg`/`darkColor` dead code 제거
- 4개 컴포넌트의 섹션 헤더를 `SectionHeader` 공통 컴포넌트로 추출 (각 30~40줄 중복 제거)
- `strategyFilter` → sessionStore 이동은 브로드캐스트 동기화 대상 오염 우려로 기각, CSS-in-JS→Tailwind 전환은 범위 제외

---

## #8

**Prompt**: 대기열에서도 선수이름 눌러서 선수교체 할 수 있게 해줘.

**Answer**: 대기열(MatchQueue)에서 선수 이름 클릭 시 PlayerReplaceDialog를 열어 선수 교체할 수 있도록 구현했습니다.
- `sessionStore.ts`: `handleReplaceInQueue` 액션 추가 — 큐의 특정 팀에서 선수를 교체하고 DB 저장 + 브로드캐스트
- `MatchQueue.tsx`: PlayerBadge를 클릭 가능하게 래핑, replacingPlayer 상태 관리, PlayerReplaceDialog 연동
- TeamCandidatesList의 교체 패턴(getAvailablePlayers, getPlayerTeams, handleReplace)을 동일하게 적용

---

## #9

**Prompt**: (팀 태스크) playingPlayers selector/유틸 추출 — courts에서 경기중 선수 목록을 계산하는 로직이 3곳(useTeamCandidates L32-35, MatchQueue L28-31, sessionStore 내부 2곳)에서 중복. `getPlayingPlayers(courts)` 순수함수를 `src/lib/sessionUtils.ts`에 추출하고 모든 호출처를 교체.

**Answer**: `src/lib/sessionUtils.ts`를 신규 생성하고 `getPlayingPlayers(courts: Court[]): SessionPlayer[]` 순수함수를 정의했습니다. 이후 4곳의 호출처를 교체했습니다.
- `useTeamCandidates.ts`: import 추가 후 useMemo 내부 교체
- `MatchQueue.tsx`: import 추가 후 useMemo 내부 교체
- `sessionStore.ts`: `handleRemoveFromQueue`, `handleAssignFromQueue` 내 인라인 `courts.flatMap` 2곳 교체
- tsc --noEmit로 타입 오류 없음 확인. `appStore.ts`, `usePlayerEditor.ts`, `useSetupPlayers.ts`에도 동일 패턴이 존재하나 이번 태스크 범위 밖으로 별도 처리 필요.

---

## #10

**Prompt**: (팀 태스크) FilterChip 공통 컴포넌트 추출 — ManualMatchDialog의 chipStyle 패턴과 TeamCandidatesList의 전략 필터 칩을 `src/components/shared/FilterChip.tsx`로 추출.

**Answer**: `src/components/shared/FilterChip.tsx`를 신규 생성하고 두 곳의 칩 버튼 패턴을 교체했습니다.
- `FilterChip` props: `label`, `active`, `activeColor`(기본 #0b84ff), `onClick`, `flexShrink`(선택)
- `TeamCandidatesList`: import 추가, 전략 필터 칩 7개의 인라인 button → FilterChip 교체
- `ManualMatchDialog`: `CHIP_STYLE_BASE` + `chipStyle()` 헬퍼 함수 삭제, 필터 영역 9개 button → FilterChip 교체. import도 추가.
- tsc --noEmit 타입 오류 없음 확인.

---

## #10

**Prompt**: (팀 태스크) unavailableIds 계산 유틸 추출 — 경기중+대기열 선수 ID 집합 계산이 useTeamCandidates(L65-68)와 MatchQueue(L44-47)에서 중복. `getUnavailableIds(playingPlayers, queuedPlayers)` 유틸 함수를 추출.

**Answer**: `src/lib/sessionUtils.ts`에 `getUnavailableIds(playingPlayers, queuedPlayers): Set<string>` 함수를 추가했습니다.
- `useTeamCandidates.ts`: import 추가 후 useMemo 내부 교체 (기존 queuedPlayers 변수 그대로 활용)
- `MatchQueue.tsx`: `queuePlayerIds`(Set<string>) 계산을 `queuedPlayers`(SessionPlayer[])로 변경하여 함수 시그니처에 맞게 통일. `queuePlayerIds` useMemo 제거
- tsc --noEmit 통과, 타입 오류 없음

---

## #11

**Prompt**: (팀 태스크) PlayerListRow 공통 컴포넌트 추출 — PlayerReplaceDialog와 ManualMatchDialog에서 중복되는 선수 행 레이아웃을 `src/components/shared/PlayerListRow.tsx`로 추출.

**Answer**: `src/components/shared/PlayerListRow.tsx`를 신규 생성하고 두 다이얼로그의 선수 목록 행을 교체했습니다.
- `PlayerListRow` props: `player`, `isPlaying`, `onClick`, `leading`(선택 순서 원 등), `afterBadge`(PlayerBadge 직후 슬롯), `beforeTrailing`, `buttonStyle`, `disabled`
- 상태 뱃지("경기중"/#34c759, "대기"/#0b84ff) 스타일을 컴포넌트 내부 상수로 관리
- `PlayerReplaceDialog`: 선수 목록 button → `<PlayerListRow />` 교체
- `ManualMatchDialog`: 선택 순서 원을 `leading`, 스킬 스코어를 `afterBadge`, 선택 상태 스타일을 `buttonStyle`로 전달. `PlayerBadge` import는 previewTeam 영역에서 여전히 직접 사용 중이라 유지.
- tsc --noEmit 타입 오류 없음 확인.

---

## #12

**Prompt**: (팀 태스크) ClickablePlayerBadge 공통 컴포넌트 추출 — PlayerBadge + 클릭 래퍼가 4곳에서 다르게 구현된 것을 `src/components/shared/ClickablePlayerBadge.tsx`로 추출.

**Answer**: `src/components/shared/ClickablePlayerBadge.tsx`를 신규 생성하고 3곳을 교체했습니다 (ManualMatchDialog는 클릭 래퍼 패턴이 없어 제외).
- props: `player`, `onClick`, `isUnavailable`, `overlay`(ReactNode), `caption`(ReactNode), `className`
- 접근성 통일: `button` 요소 + `onKeyDown`(Enter/Space) + `tabIndex={0}`
- `TeamCandidateCard`: div+role/tabIndex/키보드핸들러 → ClickablePlayerBadge. PlayerBadge/skillScore import 제거.
- `MatchQueue`: div+onClick 래퍼 → ClickablePlayerBadge. PlayerBadge/skillScore import 제거.
- `PlayerGenderGroup`: button+overlay+caption → overlay/caption 슬롯으로 전달. PlayerBadge/skillScore import 제거.
- tsc --noEmit 타입 오류 없음 확인.

---

## #13

**Prompt**: (팀 태스크) usePlayerReplace 훅 추출 — getAvailablePlayers, getPlayerTeams, handlePlayerClick, handleReplace, replacingPlayer 상태를 하나의 훅으로 캡슐화.

**Answer**: `usePlayerReplace` 훅은 이전 세션에서 이미 `src/hooks/usePlayerReplace.ts`에 완전히 구현되어 있었고 TeamCandidatesList는 이미 `replaceDialogProps` 패턴을 사용 중이었습니다. MatchQueue.tsx에만 구버전 IIFE 패턴(replacingPlayer + getPlayerTeams/getAvailablePlayers 직접 호출)이 L252-269에 남아있어 `{replaceDialogProps && <PlayerReplaceDialog {...replaceDialogProps} />}` 한 줄로 교체했습니다.
- tsc --noEmit 타입 오류 없음 확인.

---

## #11

**Prompt**: (팀 태스크) usePlayerReplace 훅 추출 — TeamCandidatesList와 MatchQueue에서 중복되는 교체 관련 로직을 `src/hooks/usePlayerReplace.ts`로 추출.

**Answer**: `src/hooks/usePlayerReplace.ts`를 신규 생성하여 `replacingPlayer` state, `handlePlayerClick`, `handleReplace`, `cancelReplace`, `getAvailablePlayers`, `getPlayerTeams`, `replaceDialogProps` 계산을 캡슐화했습니다.
- `TeamCandidatesList.tsx`: 중복 state/함수 4개 제거, hook 적용, `SessionPlayer` 미사용 import 제거. dialog 렌더링을 `{replaceDialogProps && <PlayerReplaceDialog {...replaceDialogProps} />}`로 단순화
- `MatchQueue.tsx`: 동일하게 중복 코드 제거 및 hook 적용. `useState` import 제거
- tsc --noEmit 통과

---

## #14

**Prompt**: (팀 태스크) rankReplaceCandidates 순수함수 추출 + PlayerReplaceDialog 필터/정렬 UI — useMemo를 rank/filter 두 단계로 분리, 이름 검색·성별 필터·정렬 UI 추가 (FilterChip 사용).

**Answer**: `src/lib/sessionUtils.ts`에 두 순수함수를 추가했습니다.
- `rankReplaceCandidates(availablePlayers, selectedPlayer, currentTeam, opponentTeam, pairHistory, unavailableIds)`: 기존 PlayerReplaceDialog의 useMemo 로직 추출. fitness 점수 계산(밸런스*10 + 파트너페어*5 + 상대페어*2 + 경기수*1 + 경기중*3) + 정렬.
- `filterReplaceCandidates(ranked, query, genderFilter)`: 이름 검색 + 성별 필터.
- `PlayerReplaceDialog.tsx`: 두 useMemo로 분리(rank/filter 독립). `query`(string), `genderFilter`(Gender|null) 상태 추가. 이름 검색 input + 성별 FilterChip 3개(전체/남성/여성) 필터 UI 추가. 검색 결과 없을 때 빈 상태 메시지 구분("교체 가능한 선수 없음" vs "검색 결과 없음").
- tsc --noEmit 타입 오류 없음 확인.

---

## #12

**Prompt**: (팀 태스크) rankReplaceCandidates 순수함수 추출 + PlayerReplaceDialog 필터/정렬 UI

**Answer**: rankReplaceCandidates, filterReplaceCandidates는 이미 sessionUtils.ts에 구현되어 있었음. 누락된 부분(sortReplaceCandidates 함수, 정렬 옵션 UI, 5명 미만 필터 숨김)을 추가 구현했습니다.
- `sessionUtils.ts`: `sortReplaceCandidates(filtered, sortBy: 'fitness'|'waitTime'|'gameCount')` 추가. waitTime은 waitSince 기준 오래 기다린 순
- `PlayerReplaceDialog.tsx`: sortBy state 추가, useMemo를 rank→filter→sort 3단계 파이프라인으로 변경, SORT_OPTIONS 상수 추가, 필터 영역에 정렬 칩 추가, rankedPlayers.length < 5이면 필터 영역 전체 숨김
- tsc --noEmit 통과

---

## #15

**Prompt**: (크로스 리뷰 후속) PlayerReplaceDialog.tsx의 GENDER_OPTIONS 버그 수정 — `"male"`/`"female"` 값이 Gender 타입 `"M"/"F"`와 불일치하여 성별 필터가 런타임에 동작하지 않는 버그.

**Answer**: `GENDER_OPTIONS`의 value를 `"M"`, `"F"`로 수정했습니다. 레이블은 공간 절약을 위해 `"남"`, `"여"`로 단축 변경. `tsc --noEmit` 타입 오류 없음 확인.

---

## #16

**Prompt**: 선수교체기능이 전반적으로 여기저기서 쓰이는데 현재 구조가 적절한지 파악해. 그리고 선수교체기능에서 중요한건 "필요한 선수" 를 사용자가 얼마나 빨리 찾아서 누르느냐가 중요하기 때문에 단순히 선수의 나열보다, 필터링, 오더링같은걸 어떻게 해줘야할지도 중요해. 팀 매칭의 상단에 있는 필터링이 선수교체기능에도 들어가도 나쁘지 않을거같아. 이런 고민들을 팀원들이랑 같이 고민해서 결론내려봐

**Answer**: hardwork 팀(OOP + 프론트엔드)으로 설계 회의 → 구현 → 크로스 리뷰를 진행했습니다. 주요 결정사항과 구현 결과:

**설계 결정:**
- 전략 필터(gameCountBalanced 등)는 교체 다이얼로그에 부적합 — fitness 점수가 이미 밸런스·페어히스토리·경기수를 종합하므로 전략 이식은 UX 혼란
- 대신 이름 검색 + 성별 필터 + 정렬 옵션(적합도/대기시간/경기수)이 "원하는 선수를 빨리 찾는" 목적에 직접 부합
- rank → filter → sort 파이프라인 순서 고정, useMemo 2단계 분리로 검색 입력 시 rank 재계산 없이 filter만 실행

**구현 결과 (7개 태스크):**
- `getPlayingPlayers`, `getUnavailableIds` 유틸 추출 → 3곳, 2곳 중복 제거
- `usePlayerReplace` 훅 → TeamCandidatesList/MatchQueue 교체 로직 통합
- `rankReplaceCandidates`, `filterReplaceCandidates`, `sortReplaceCandidates` 순수함수 추출
- PlayerReplaceDialog에 이름 검색 + 성별 필터 + 정렬 UI + 5명 미만 필터 숨김
- `FilterChip` 공통 컴포넌트 → 3곳 적용
- `PlayerListRow` 공통 컴포넌트 → 2곳 적용 (상태 뱃지 통일)
- `ClickablePlayerBadge` 공통 컴포넌트 → 3곳 적용 (접근성 통일)

**크로스 리뷰에서 발견/수정한 이슈:**
- GENDER_OPTIONS 값 "male"/"female" → "M"/"F" 런타임 버그 수정
- replaceDialogProps IIFE → useMemo 교체
- ClickablePlayerBadge 키보드 이벤트 타입 캐스팅 제거

---

## #17

**Prompt**: 이름검색에 초성도 가능하게해줘

**Answer**: `filterReplaceCandidates`에 초성 검색을 추가했습니다. 기존 `useSetupPlayers.ts`에서 사용 중인 `es-hangul` 라이브러리의 `disassemble`/`getChoseong` 패턴을 그대로 적용. 입력이 모두 자음(ㄱ-ㅎ)인 경우 초성 매칭으로 전환됩니다.

---

## #18

**Prompt**: 선수교체 들어갔을때 선택한 선수의 모습이 이상하게 표현되는데 디자인 다듬어줘.

**Answer**: 교체 대상 선수의 표시 방식을 개선했습니다. 기존에는 PlayerBadge를 opacity 0.4로 흐리게 하고 위에 빨간 "교체대상" 텍스트를 absolute로 겹쳐서 다크모드에서 특히 지저분했습니다. 변경 후: 교체 대상은 빨간 점선 테두리 + 연한 빨간 배경 + ↻ 아이콘 + 취소선으로 표시. 같은 팀 다른 선수는 기존 PlayerBadge 그대로 유지.

---

## #22

**Prompt**: (team-lead으로부터 태스크 할당) PlayerReplaceDialog를 PlayerPickerList로 교체. showSearch=true, searchThreshold=5, showGenderFilter=true, showStatusFilter=false, sortOptions: 적합도/대기시간/경기수, maxHeight="35vh", 기존 rankedPlayers useMemo는 그대로 유지, filterReplaceCandidates/sortReplaceCandidates 호출을 PlayerPickerList 내부로 이동.

**Answer**: PlayerReplaceDialog의 필터 영역, 선수 목록, 빈 상태 메시지를 PlayerPickerList로 교체했습니다. 주요 변경사항:
- `query`, `genderFilter`, `sortBy` 3개 useState 및 `filteredPlayers` useMemo 제거 — PlayerPickerList 내부로 위임
- `rankedPlayers` useMemo를 `pickerPlayers` useMemo로 변경: `rank`(fitness 인덱스)와 `waitSince` 필드를 `PlayerPickerItem`으로 매핑
- `PlayerPickerList`에 `waitTime` sort 지원 추가 (`waitSince` 필드 및 sort 처리)
- `PlayerPickerItem`에 `skillRank` 필드 분리(linter가 추가), `waitSince?: string` 필드 추가
- `FilterChip`, `PlayerListRow` import 제거 및 불필요한 상수(`GENDER_OPTIONS`) 제거

---

## #23

**Prompt**: 선수교체, 수동매칭 하단의 선수 목록은 똑같이 "현재 경기가능한 최적의 팀매칭"을 위해 선수를 찾는거라 같은 컴포넌트라고 볼 수 있어. 그렇다면 이런 컴포넌트가 더 있는지 찾고 전부 공통컴포넌트로 묶어줘. 데이터 구조변경이 필요하면 같이 해.

**Answer**: hardwork 팀으로 분석 → 구현을 진행했습니다. WaitingList/RestingList/PlayerGenderGroup은 "칩형" 패턴으로 별도 계열이므로 제외하고, PlayerReplaceDialog와 ManualMatchDialog의 "행(row)형 선수 목록 + 필터" 패턴을 통합했습니다.
- `PlayerPickerList` 공통 컴포넌트 신규 생성: 검색(초성 포함) + 성별/상태 필터 + 정렬 + 스크롤 목록 + 빈 상태 처리를 내부에서 관리. fitness 계산은 외부화(Data-UI 분리).
- PlayerReplaceDialog: 필터/목록 영역을 PlayerPickerList로 교체. query/genderFilter/sortBy state 및 filteredPlayers useMemo 제거.
- ManualMatchDialog: 필터/목록 영역을 PlayerPickerList로 교체. genderFilter/statusFilter/sortMode state 제거. renderLeading(선택 순서 원)/renderAfterBadge(스킬점수)/getButtonStyle/isDisabled 슬롯으로 커스텀.
- PlayerPickerItem에 waitSince, skillRank 필드 추가하여 waitTime/skill 정렬 지원.

---

## #24

**Prompt**: 총 참가자 카운트를 대기명단에 넣어줘.

**Answer**: WaitingList의 SectionHeader 뱃지 옆에 "총 N명" 표시를 추가했습니다. 세션 참가자 전체 목록을 가진 별도 스토어 필드는 없으며, useSetupPlayers와 동일하게 `waiting + courts(playing) + resting` 합산으로 계산합니다. courts/resting 구독을 추가하고, playingCount + waiting.length + resting.length로 totalCount를 산출.

---

## #25

**Prompt**: 당신은 OOP 아키텍트입니다. cocktime-scheduler 프로젝트의 세션 선수 상태 관리를 근본적으로 재설계해야 합니다. (세션 참가자가 3개 분리 배열로 관리되는 문제 해결, sessionPlayers Map 단일 진실 출처 설계안 요청)

**Answer**: 코드 분석 후 설계안 제시. 핵심 결정사항:
- `SessionPlayer` 타입은 이미 `status` 필드를 보유 — 타입 변경 불필요
- `waiting/resting` 배열 제거, `sessionPlayers: Map<string, SessionPlayer>` 단일 진실 출처로 교체
- `ActiveMatch.teamA/B`를 `[SessionPlayer, SessionPlayer]`에서 `[string, string]` (ID 참조)로 변경
- selector 함수(`selectWaiting`, `selectResting`)로 파생 상태 대체 — DB의 View 패턴
- `handlePlayerUpdated`가 3곳 순회 → Map 1줄 upsert로 단순화
- DB 스키마 변경 불필요 (session_players 테이블은 이미 단일 status 컬럼 보유)
- 2단계 마이그레이션 권장: 1단계(sessionPlayers Map 도입), 2단계(GeneratedTeam ID 참조화)

---

## #26

**Prompt**: (팀 태스크) sessionStore.ts, transformers.ts, actions.ts 크로스 리뷰 — 4가지 관점: (1) 단일 set() 배치 처리 여부, (2) rebuildDerivedIds 호출 누락 여부, (3) Map에 없는 ID를 courts가 참조할 가능성, (4) handleMatchCompleted 순서 안전성

**Answer**: 4가지 관점 모두 이상 없음을 확인했습니다.
- 모든 핸들러(handleMatchStarted/Completed/PlayerStatusChanged/QueueUpdated)는 Map upsert + courts 업데이트 + rebuildDerivedIds를 단일 set() 콜백 내에서 처리
- rebuildDerivedIds 미호출 2건(handlePlayerFlagChanged, handlePlayerUpdated)은 status 변경 없는 이벤트이므로 의도적 생략
- courts가 ID를 저장하는 시점에 Map에 반드시 선수가 존재함(handleMatchStarted: upsert 후 ID 저장, transformers: DB ID 직접 사용)
- handleMatchCompleted 순서는 newMap upsert → rebuildDerivedIds → return 내 courts 변경으로 단일 set() 배치, 렌더 불일치 없음
- handleComplete의 filter(Boolean) 타입 캐스팅은 minor한 스타일 이슈, 런타임 문제 아님

---

## #27

**Prompt**: 세션 참가자를 스토어 한곳에서 관리하도록 근본 재설계. Supabase 동기화 고려. 고칠 범위가 많아도 잘게 쪼개서 전부 진행.

**Answer**: hardwork 팀(OOP+프론트엔드)으로 Supabase 동기화를 고려한 세션 상태 근본 재설계를 진행했습니다.

**핵심 변경:**
- `waiting[]`/`resting[]` 분산 배열 제거 → `sessionPlayers: Map<string, SessionPlayer>` 단일 소스 도입
- `waitingIds[]`/`restingIds[]` 파생 상태를 스토어에 보관, `rebuildDerivedIds()` 유틸로 모든 set()에서 동기 갱신
- `ActiveMatch.teamA/B`를 `[SessionPlayer, SessionPlayer]` → `[string, string]` ID 참조로 변경
- 브로드캐스트 페이로드 형식은 유지, 수신 측에서 `upsertPlayers()`로 Map에 업데이트 후 courts에 ID만 저장
- `handlePlayerUpdated`가 3개 배열 순회 → `Map.set()` 1회로 단순화
- `totalCount = sessionPlayers.size` (계산 대신 직접 참조)

**변경 파일 12개:** types/index.ts, supabase/types.ts, supabase/transformers.ts, supabase/actions.ts, sessionStore.ts, sessionUtils.ts, useTeamCandidates.ts, useSetupPlayers.ts, WaitingList.tsx, RestingList.tsx, CompactCourtBar.tsx, MatchQueue.tsx

**크로스 리뷰 이슈 수정:** WaitingList의 courts 전체 구독 제거 → sessionPlayers.size로 교체

---

## #28

**Prompt**: (팀 태스크) GeneratedTeam 타입 ID 참조화 + teamGenerator 출력 변경 — teamA/B를 [SessionPlayer, SessionPlayer]에서 [string, string]으로 변경, 알고리즘 내부는 SessionPlayer 객체 유지, 최종 반환 시 .id 추출

**Answer**: `GeneratedTeam.teamA/B`를 ID 참조 방식으로 변경했습니다. 주요 결정사항:
- `src/types/index.ts`: `GeneratedTeam.teamA/B` → `[string, string]` (session_players.id 참조)
- `src/lib/teamGenerator.ts`: `buildTeamFromFour` 반환 직전 `[teamA[0].id, teamA[1].id]`로 추출. 내부 계산(pairingScore, bestPairing, buildMixedTeams)은 SessionPlayer 객체 그대로 유지
- `updateLastCoPlayers`: `allPlayers.map(p => p.id)` 패턴 → `allIds` 직접 순회로 변경
- `recordHistory`: `[aId, bId]` 기반으로 변경
- `generateBulkTeamCandidates`: `trackUsage`와 `seenGroups` 초기화에서 `.id` 추출 제거 (이미 string)
- `docs/TEAM_GENERATION_RULES.md`: 데이터 참조 방식 섹션 추가
- `tsc --noEmit` 에러 없음

---

## #29

**Prompt**: (팀 태스크) sessionStore 핸들러 — GeneratedTeam ID 기반 처리

**Answer**: sessionStore.ts의 모든 핸들러에서 `GeneratedTeam.teamA/B`를 `[string, string]` ID 기반으로 처리하도록 수정했습니다. 주요 결정사항:
- `handleMatchStarted`: `matchQueue`/`candidateTeams` 필터링에서 `.map(p => p.id)` 제거, `pairHistory` 업데이트에 `teamAIds/teamBIds` 직접 전달
- `handleMatchCompleted`, `handlePlayerStatusChanged`, `handleQueueUpdated`, `initialize`: `flatMap`에서 `.map(p => p.id)` 제거 → 직접 spread
- `handleRemoveFromQueue`: `team.teamA/B`가 ID이므로 `sessionPlayers` Map에서 lookup하여 `restoredPlayers` 구성
- `handleReplaceInQueue`: `replaceIn` 함수를 `[string, string]` 기반으로 변경
- `handleAssignFromQueue`: `allAvailable` 체크를 ID 직접 비교로 변경, 브로드캐스트 `match_started` 페이로드에는 SessionPlayer 객체 형식 유지(Map에서 lookup)
- `handleAssign`: 동일하게 브로드캐스트 페이로드 생성 시 `toPlayerPair` 헬퍼로 Map lookup
- `tsc --noEmit` 에러 없음

---

## #30

**Prompt**: (팀 태스크) transformers + API — GeneratedTeam ID 기반 변환

**Answer**: transformers.ts/actions.ts/api.ts에서 GeneratedTeam.teamA/B를 ID 기반으로 처리하도록 수정했습니다. 주요 결정사항:
- `transformers.ts`: `buildTeamCandidates`에서 `playerMap` 파라미터와 lookup 로직 완전 제거. DB row의 `team_a_p1/p2`, `team_b_p1/p2`를 `[string, string]`으로 직접 매핑
- `snapshotToClientState`: `playerMap` 변수 제거, `buildTeamCandidates` 호출 시 인수 제거, `queuedPlayerIds` 계산에서 `.map(p => p.id)` 제거
- `actions.ts` (`dbAssignMatch`): `team.teamA[0].id` → `team.teamA[0]`, `allIds` 계산도 직접 spread
- `api.ts` (`dbSaveTeamCandidates`, `dbSaveMatchQueue`): `team.teamA[0].id` → `team.teamA[0]` (4개 필드 각각)
- `dbCompleteMatch`: `match.teamA/B`는 `ActiveMatch` 타입으로 이미 `[string, string]` — 변경 불필요
- `tsc --noEmit` 에러 없음

---

## #31

**Prompt**: (이전 대화에서 이어진 Task #6) tsc 전체 통과 + 스냅샷 잔재 전수 검사

**Answer**: Task #6 완료. `npx tsc -p tsconfig.app.json --noEmit` 에러 0개 달성.
- `sessionStore.ts`: `handleMatchStarted`의 `get` 미사용 파라미터 → `_get` 변경; `BroadcastPayloadData`에서 구조분해된 `matchId/courtId/gameType`이 `unknown` 타입 → `safeMatchId/safeCourtId/safeGameType`으로 명시적 캐스팅; `handleCandidatesUpdated`의 `payload.candidates` → `as GeneratedTeam[]` 캐스팅
- `teamGenerator.test.ts`: `makePlayerMap` 미사용 에러 해소, 모든 `team!.teamA/B` 접근을 ID 기반으로 변환 (`.map(p => p.name)` → `.map(id => pm.get(id)!.name)` 등)
- `teamGenerator.integration.test.ts`: 전체 재작성 — `testGroupMap` 추가, `match.teamA/B` ID 직접 처리, `.map(p => p.id)` 제거, `lastCoPlayers` 업데이트 단순화
- 스냅샷 잔재 전수 검사: `MatchCard.tsx`의 `log.teamA`는 `MatchLogEntry` 타입(별도 구조)으로 `GeneratedTeam`과 무관 — 수정 불필요

---
