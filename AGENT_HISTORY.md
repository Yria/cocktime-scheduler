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
