# Branch: main

## #1

**Prompt**: cocktime-scheduler 프로젝트에서 인라인 SVG를 lucide-react 아이콘으로 교체하세요. `lucide-react`는 이미 node_modules에 설치되어 있습니다. (교체 대상 7곳 + 필터 탭 이모지 교체 + WEIGHT_PROFILES icon 필드 변경)

**Answer**: 7개 파일에서 인라인 SVG를 lucide-react 아이콘 컴포넌트로 교체하고, 필터 탭 이모지를 lucide 아이콘으로 전환했습니다.
- MatchQueue: List 아이콘, TeamCandidatesList: Star + RefreshCw 아이콘, RestingList: PauseCircle 아이콘, WaitingList: Users 아이콘, PlayerRow: Check 아이콘, LogList: ClipboardList 아이콘
- WEIGHT_PROFILES의 icon 필드를 이모지에서 lucide 아이콘 이름 문자열로 변경 (hash, sparkles, shuffle, scale, users, clock)
- TeamCandidatesList에서 reasonIconMap을 REASON_ICONS 컴포넌트 맵으로 교체하고, 필터 버튼 padding을 "4px 8px"로 확대
- TypeScript 타입 체크(npx tsc --noEmit) 통과 확인

---

## #2

**Prompt**: 빌드에러잡아줘

**Answer**: `TeamCandidatesList.tsx`에서 `WEIGHT_PROFILES`가 import만 되고 사용되지 않아 발생한 TS6133 에러를 해당 import 제거로 수정했습니다. 빌드 성공 확인.

---

## #3

**Prompt**: 선수교체, 수동매칭에도 선수검색 넣어줘 당연히 초성도 되게

**Answer**: 두 다이얼로그에 검색바를 항상 표시하도록 수정했습니다. PlayerPickerList에 이미 es-hangul 기반 초성검색이 구현되어 있어 prop만 활성화하면 됨.
- ManualMatchDialog: `showSearch` prop 추가
- PlayerReplaceDialog: `FILTER_SHOW_THRESHOLD`를 5→0으로 변경하여 검색바 항상 노출

---

## #4

**Prompt**: 사람 얼굴을 넣고 싶어. 기획부터 시작해서 사진 소싱(Mac Photos + 소모임), 업로드(Supabase Storage), 시트 기록(=IMAGE), UI 선택까지 전체 파이프라인 설계 및 스크립트 구현.

**Answer**: 선수 얼굴 사진을 자동 수집하고 선택하는 Python CLI 스크립트(`scripts/fetch_photos.py`)를 구현했습니다.
- Mac Photos(osxphotos)에서 인물 태그 기반 얼굴 크롭 + 소모임 프로필 사진 CDN 다운로드 2개 소스
- 소모임 articles API(`/api/articles`, `s_t` 페이징, 카테고리 필터 없이 전체 조회)에서 가입인사 "이름:" 파싱으로 닉네임↔실명 매핑 구축 → 매칭률 79→95/148명으로 개선
- 로컬 웹 UI(http.server + inline HTML)로 플레이어별 후보 사진 선택
- Supabase Storage 업로드 + Google Sheets =IMAGE() 기록 (dry-run 모드 지원)
- 주요 발견: 소모임 API `POST /api/articles` (wql=limit, s_t=cursor, cat=category), 프로필 CDN `d3vo2hyhx9t76k.cloudfront.net/{mid}.png`

---

## #5

**Prompt**: 현재 구현되어있는 컴포넌트를 pen 디자인으로 만들 수 있어?

**Answer**: `/pencil-new.pen` 파일에 프로젝트의 4개 주요 화면(Home, SessionSetup, SessionMain, LogPage)을 모바일 디자인으로 생성했습니다.
- 코드베이스의 iOS liquid glass 디자인 시스템(색상 토큰, 간격, 타이포그래피)을 분석하여 .pen 변수로 변환
- 15개 재사용 컴포넌트 생성: Button(5종), PlayerBadge(남/여), FilterChip(2종), SectionHeader, GlassCard, GameTypeBadge, SkillButton(3종), ToggleButton(2종)
- 각 화면의 실제 UI 구성요소를 충실하게 반영 (코트 현황 바, 대기열 카드, 선수 칩, 매치 기록 카드 등)
- 스크린샷 검증으로 모든 화면의 레이아웃/정렬 확인 완료

---

## #6

**Prompt**: 이제 UI에 사람얼굴을 넣을거야. 사람얼굴을 넣어야 할 곳을 리스트업하고 현재 디자인에서 자연스럽게 들어가게 해줘. 그리고 사람얼굴이 모든 이름라벨에 반드시 들어갈 필요는 없어. 사람얼굴을 내가 이고생을 하며 넣는 가장 큰 이유는, 사람 이름만 보고 누군지 파악하기 힘들어서야. 즉 이미 경기중인 목록에선 사람얼굴이 노출될 필요가 없지. 팀매칭 후보단계에서 나와야하고, 너무 작게나오면 안보이니까 좀 크게 나왔으면 좋겠어.

**Answer**: 기획 검증 수행. 전체 코드베이스 11개 컴포넌트를 분석하여 사진 노출/미노출 위치를 판정했습니다.
- 노출 O (4곳): TeamCandidateCard(36-40px), ManualMatchDialog(32-36px), PlayerReplaceDialog(32-36px), PlayerRow setup(28-32px, 우선순위 낮음)
- 노출 X (3곳): CompactCourtBar, WaitingPlayerChip, MatchQueue — 의사결정이 끝난 단계이므로 불필요
- 데이터 주입: Player/SessionPlayer 타입 변경 없이 md5(이름)[0:12].jpg 유틸 함수로 URL 생성. Google Sheets/DB 스키마 변경 불필요
- 엣지케이스: 게스트 사진 미등록 fallback, 동명이인 해시 충돌, 이름 변경 시 사진 불일치 식별
- 기존 코드와 모순 없음 확인

---

## #7

**Prompt**: 수동매칭 4명 눌러야 이 화면이 되는데, 한명씩 눌러도 이 화면 나오게 해주고, 남복이란 표현 없어도 될거같고, 선수교체, 수동매칭에 쓰이는 사진사진vs사진사진 같은 컴포넌트같은데 하나로 합쳐

**Answer**: 3가지 변경을 수행했습니다:
- 공통 `MatchPreview` 컴포넌트를 `src/components/shared/MatchPreview.tsx`로 추출. 좌측팀 PlayerCard + VS 뱃지 + 우측팀 PlayerCard 레이아웃을 재사용 가능하게 통합
- ManualMatchDialog, PlayerReplaceDialog, TeamCandidateCard 세 곳에서 중복된 VS 레이아웃 코드를 `MatchPreview` 하나로 교체
- 수동매칭에서 1명 이상 선택 시 바로 프리뷰 표시 (빈 슬롯은 + 플레이스홀더). 4명 선택 시 실제 팀 배치, 그 전에는 선택 순서대로 좌2/우2 배치
- "남{M} 여{F}" 성별 카운터 및 gameType 라벨 제거

---

## #8

**Prompt**: 팀매칭할때 같은 팀원인데 이유가 다양하면 하나만 보이고 이유가 여러개 보여야하지 않을까? 이유별로 필터링해서 볼 수 있게 구현한거 같은데 그거 어디감

**Answer**: 두 가지 문제를 해결했습니다:
- 같은 팀 구성(동일 4명)이 다른 이유로 중복 표시되던 것을 그룹핑. `groupKey`(정렬된 4명 ID)로 묶고 하나의 카드에 여러 이유를 pill 태그로 표시
- 이유 필터 칩이 `reasonTabs.length > 1` 조건으로 숨겨져 있었는데, `> 0`으로 변경하여 이유가 하나라도 있으면 필터 칩 항상 표시
- TeamCandidateCard에 `displayNumber`(화면 표시용 번호)와 `reasons`(이유 배열) props 추가, 원본 index는 콜백용으로 보존

---

## #9

**Prompt**: 대기열에 8명이나 있는데 팀이 없다는게 말이돼?

**Answer**: 자동 보충 로직의 조건 버그를 수정했습니다. `useTeamCandidates.ts`의 자동 보충 effect에서 `needSupplement && poolChanged` 조건 때문에, 풀 구성이 바뀌지 않으면 visibleCount가 0이어도 재생성이 트리거되지 않았습니다.
- 수정: `visibleCount === 0`이면 풀 변경 여부와 무관하게 재생성 시도
- 무한루프 방지: `emptyGenAttemptRef`로 같은 풀에서 0개 결과 시 1회만 시도하도록 가드 추가

---

## #10

**Prompt**: 네 말엔 문제가 없다는건데, 이 상황으로 팀 새로고침을 해도 변하는게 없어

**Answer**: 실제 앱을 브라우저에서 테스트하여 문제를 확인했습니다. `generateCandidateTeams`가 완전히 결정론적이어서 같은 풀+히스토리에서 항상 동일한 팀을 생성하는 것이 근본 원인이었습니다.
- 프로필 순서 셔플: `Object.keys(WEIGHT_PROFILES)` 대신 `shuffle(profileKeys)` 사용하여 매 호출마다 다른 프로필 우선순위
- 2단계 pickIndices를 고정값([1,0,0,0] 등) 대신 `randomPickIndices()`로 변경 (상위 2~3명 중 랜덤 선택)
- 3단계 셔플 코드를 `shuffle()` 헬퍼로 리팩터링
- 실제 테스트: 새로고침 전후 팀 구성이 달라지는 것 확인 (5팀 → 8팀, 다른 이유 조합)

---

## #11

**Prompt**: 강민규가 경기중인데 모든 전략에서 1순위. DB 불일치가 더 큰 문제 아냐?

**Answer**: DB 불일치의 근본 원인을 수정했습니다.
- 원인: `dbAssignMatch`가 matches INSERT와 session_players UPDATE를 별개 호출로 실행. 1번 성공 + 2번 실패 시 match는 존재하는데 player status는 "waiting" 상태로 남음
- 해결: PostgreSQL 함수 `assign_match`를 생성하여 두 작업을 단일 트랜잭션으로 묶음. `supabase db push`로 마이그레이션 적용 완료
- `dbAssignMatch`를 `supabase.rpc("assign_match", ...)` 호출로 변경
- 방어 로직도 추가: `rebuildDerivedIds`와 `snapshotToClientState`에서 코트 매치 데이터를 교차 검증하여, DB status가 불일치해도 경기중 선수를 대기자에서 제외
- 강민규의 현재 DB status를 "playing"으로 수정

---

## #12

**Prompt**: 다른 로직에서도 같은 문제 발생 가능한지 전체 점검. 원인파악 전에 방지코드부터 짜는 버릇 고쳐. RPC로 구현해줘.

**Answer**: 전체 DB 작업을 점검하여 동일 패턴(비원자적 다중 테이블 호출) 3건을 추가 발견하고 RPC로 수정했습니다.
- `complete_match` RPC: matches UPDATE + pair_history UPSERT(ON CONFLICT) + session_players UPDATE를 단일 트랜잭션으로 묶음. 기존 7번의 순차 DB 호출이 1번으로 줄어듦
- `save_team_candidates` RPC: 기존 후보 DELETE + 새 후보 INSERT를 JSONB 파라미터로 한 번에 처리
- `save_match_queue` RPC: 기존 큐 DELETE + 새 큐 INSERT를 동일하게 처리
- 피드백 반영: "원인파악 전에 방지코드부터 짜지 말 것" 메모리에 기록

---

## #13

**Prompt**: 처음 제기한 문제 전부 해결됐는지 체크 + 방어코드 제거

**Answer**: 8개 문제 전부 해결 확인 완료. rebuildDerivedIds/snapshotToClientState에 추가했던 courts 교차검증 방어코드를 제거하고 원래 로직으로 원복. RPC 트랜잭션이 근본 원인을 해결했으므로 방어코드 불필요.

---
