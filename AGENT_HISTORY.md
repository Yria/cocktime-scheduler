# Branch: sam/accounting

## #1

**Prompt**: @docs/ACCOUNTING_DESIGN.md 이거 구현할거야

**Answer**: 회계(회비·대관비 자동 대사) 설계서를 기반부터 구현했다. 은행 메일수집(파서·Edge Function·Apps Script)은 사용자 결정에 따라 다음 단계로 분리.

- **이해 단계**: 워크플로우로 설계서 가정을 실제 코드베이스와 6개 차원(코어 엔티티·RLS/RPC·푸시체인·Edge Function·프론트·인증/역할) 대조 검증. 핵심 발견: `attendances.status`는 4값(`late_pool` 존재), `no-show` 상태 없음, `confirmed_at`은 강등 시 NULL, Edge Function 시크릿은 Vault 아닌 `Deno.env`, config.toml에 죽은 `[functions.sheets]`.
- **결정 확정**: late_pool도 대관비 부과(악용 방지), 대관비 세션=`active/closed`만, 가입일=`coalesce(membership_started_at, created_at KST)`(보정 컬럼 신설), 운영진=`role='admin'`(is_operator 헬퍼), `dues_policies` 생략(amount_due 스냅샷이 이력 보존).
- **마이그레이션 3개**: 스키마 9테이블+RLS(관리자 전용 SELECT·본인 열람 예외)+배분 무결성 트리거, `generate_dues_charges`, 대사/현금납부/미납알림 RPC 7종.
- **적대적 SQL 리뷰**: 3개 확정 결함 수정 — FK 캐스케이드 회귀(charge_id/member_id restrict→cascade, 기존 회원 삭제 RPC abort 차단), is_operator PUBLIC 누수(revoke from public), dues_alloc_guard 동시 과다배분(부모행 FOR UPDATE 선잠금).
- **프론트**: `dues.ts` 데이터레이어 + `duesStore`(React Compiler set-state-in-effect 회피) + `/dues`(현황판·현금납부·면제·부과생성·미납알림·설정+장소 대관비) + `/my-dues`(회원) + 라우팅·메뉴. 대사·수지 탭은 은행연동 준비중 안내.
- **알림**: `payment_confirmed`·`dues_unpaid` 타입을 send-push buildBody와 notifications.ts 양쪽 동기화 + `/my-dues` 딥링크 + 미납은 중립 토스트.
- **검증**: tsc·eslint·vite build 통과(로컬 Docker 미가동으로 DB 적용은 사용자 `supabase db push` 필요). 설계서에 구현 상태·확정사항·변경점 반영.

---

## #2

**Prompt**: 회원 실력 수정할때 다른 사람과 비교하는 기능이 있는데 단순히 텍스트만 하지말고 프로필 사진좀 크게 한다던지 해서 그래피컬라이즈할 수 있을까

**Answer**: 실력 편집의 "비교로 추정"(동성 1:1 이진 탐색) UI를 텍스트에서 그래픽 "맞대결" 카드로 재설계했다. 디자인 심사 워크플로우로 3안(맞대결 VS·스포트라이트·실력 저울)을 병렬 생성·채점 후, 맞대결 골격에 수렴 밴드·기준점 멘탈모델을 흡수한 통합안을 채택.

- **핵심 제약 발견**: 이진 탐색 취지상 비교 상대의 등급 숫자는 절대 노출 금지. 상대는 사진·이름·성별만, 노출 숫자는 편집 대상 본인의 추정 구간(lo~hi)뿐.
- **구현**: 편집 대상(등급 "?" 뱃지)과 상대 프로필 아바타를 크게 마주 세우고 사이에 VS 뱃지, 상단에 답변마다 좁혀지는 10칸 수렴 밴드, 방향감 버튼(▲＝▼). 사진은 이름 기반 공용 아바타로 자동 렌더(없으면 큼직한 이니셜).
- **간소화 결정**: 심사안의 새 selfName/selfGender prop 대신 기존 excludeName/gender를 직접 사용 — 세 호출부 모두 편집 대상을 넘기므로 죽은 파라미터·호출부 변경 없이 정확.
- **로직 무변경**: pickAnchor·answer·lo/hi 이진 탐색과 시그니처, 세 호출부(회원편집·세션선수·셋업) 그대로. 최종 return JSX만 교체. tsc 통과, 새 lint 없음(223줄 경고는 기존 이슈).
- **미리보기**: 라이트/다크·여러 상황·실제 이진 탐색을 직접 눌러볼 수 있는 아트팩트 제공.

---

## #3

**Prompt**: 모르겠어요 같은 스킵도 넣어야하고 비교군은 최근 3달동안 참여한 회원만, vs 를 동그라미로 감싸는데 그건 필요없을거같고  그리고 프로필사진 우하단 ? 는 뭘 의미하는건지 설명해.

**Answer**: 실력 비교 카드에 네 가지를 반영했다.

- **"잘 모르겠어요" 스킵**: answer에 `skip` 케이스 추가 — 구간(lo/hi) 유지한 채 현재 표본만 소진하고 다른 사람으로 교체, 질문 번호(asked)는 better/worse에서만 증가. 표본 소진 시 현재 구간 중앙으로 수렴. UI엔 방향 버튼 아래 고스트 스타일 스킵 버튼 추가.
- **최근 3달 참여자만 비교군**: `fetchRecentActiveMemberIds(monthsBack)` 신설 — attendances(confirmed/late_pool) × sessions.scheduled_at 조인으로 최근 참석 회원 id 집합 반환. RLS 확인(attendances_select=authenticated 전체, sessions는 RLS 미적용이라 조인 안전). 회원관리·셋업 두 표본 빌더에 적용, DebugMatchModal은 현재 세션 참가자라 미적용. 참석 이력 없으면 전체로 폴백.
- **VS 원형 제거**: 원형 그라디언트 뱃지 → 담백한 기울임 텍스트, 겹침용 음수 마진 제거로 아바타 사이 여백 확보. 미사용 cmpVsBadge 키프레임 삭제.
- **`?` 뱃지 의미**: 왼쪽(편집 대상 본인)에만 붙는 "등급 미정=추정 중" 표시임을 설명(유지). 상대는 숨겨진 기준 등급이 있고 본인은 그와 견줘 정하는 대상.
- 검증: tsc 통과, 새 lint 없음. 미리보기 아트팩트도 갱신(스킵 동작 포함).

---

## #4

**Prompt**: 우하단 ? 의미가 이상해서 그냥 제거

**Answer**: 편집 대상 아바타 우하단의 "?" 뱃지(등급 미정 표시)를 제거했다. 앵커링용 position:relative 래퍼 div도 함께 걷어내고 PlayerAvatar를 직접 배치. 편집 대상 구분은 왼쪽 사이드 라벨의 `{lo}~{hi}등급`(추정 구간)으로 충분. tsc 통과, 미리보기 아트팩트에서도 뱃지·CSS·설명 노트 제거. 이어서 사용자가 추정 알고리즘의 수학적 타당성(특히 "비슷하다" 처리)을 제기해 방향 논의 진행.

---

## #5

**Prompt**: 스코어 추정 알고리즘이 이미 유의미하게 수학적으로 사용하는 모델이 잇나? 비슷하다 한번하면 바로 점수가 결정되는데, 비슷하다는 완전히 같다가 아니고 비교하면 잘할때도 못할때도 있는 우열을 가리기 힘든 상태야.

**Answer**: 현재 추정기는 수학 모델이 아니라 노이즈 없는 전순서를 가정한 단순 이진 탐색이고, "비슷"을 정확히 동일+즉시 확정으로 처리하는 게 문제임을 설명. 표준 모델(Bradley-Terry+무승부 확장·Thurstone·Elo·Glicko·TrueSkill의 무승부 마진 ε)에서는 "비슷=겹침"이고 증거가 누적된다는 점, 그리고 진짜 rating은 실제 경기 승패 학습이 필요한데 이 앱은 승패를 저장하지 않아(matches에 winner 없음) 그 방향은 별도 선행 작업임을 짚음.

- 사용자 선택(질문): "비슷=±구간+평균" 경량 개선안 채택.
- 구현: `similarAnchors` 상태 추가. `answer` 재작성 — better/worse는 단단한 컷 유지, `similar`는 상대 등급 g의 g±1로 구간 좁히고 앵커로 수집(즉시 확정 폐지), skip은 구간 유지. 종료 조건: 구간이 한 등급 확정/붕괴(nextLo≥nextHi) · "비슷" 2회 또는 좁은 구간 · 표본 소진. `settle`로 비슷앵커 평균을 구간 클램프(없으면 중앙)해 확정.
- 검증: 시뮬레이션으로 수렴(true=6→6 등)·무한루프 없음(질문 2~3회)·전 종료 경로 정상 확인. tsc 통과, 새 lint 없음. 미리보기 라이브 데모·노트도 새 동작으로 갱신.

---

## #6

**Prompt**: 좌우 사용자의 원 크기가 다를 필요가 잇나?

**Answer**: 좌우 아바타 크기를 동일(88px)로 맞췄다. 원래 오른쪽(비교 상대)을 78 vs 98로 키워 "기준점"을 강조했는데, "?" 뱃지도 제거한 마당에 비대칭 크기는 불필요하다고 판단. 상대 구분은 링색 글로우로 충분히 유지. tsc 통과, 미리보기도 단일 s88 크기로 통일.

---

## #7

**Prompt**: 회원목록에서 사용자의 실력점수가 목록에도 노출됐으면 해

**Answer**: 회원 관리 목록 행(MemberAdminRow)의 이름 줄 우측에 실력 등급 뱃지를 추가했다. `skillScoreOf(member.skills)`로 등급 산출(구 6종/null 안전), 0(미설정)은 "–"로 표기. "실력" 편집 버튼과 같은 초록 계열로 통일해 표시=값/버튼=편집 역할을 시각적으로 연결. 이름이 길면 이름이 말줄임되고 뱃지는 우측 유지(name span minWidth:0 + 뱃지 marginLeft:auto·flexShrink:0). 편집 저장 시 reload로 즉시 갱신. tsc·lint 통과.

---

## #8

**Prompt**: 등급뱃지 디자인 개구려, 그냥 이름 오른쪽에 나오게 해

**Answer**: 실력 등급을 pill 뱃지(배경·테두리·padding·우측정렬)에서 이름 바로 오른쪽의 담백한 텍스트로 변경. marginLeft:auto 제거해 이름 옆에 붙고, 배경/라운드 없이 작은 초록 숫자(#16a34a, 미설정은 faint "–")만 표기. tsc·lint 통과.

---

## #9

**Prompt**: 숫자 달랑있는데 이게 등급임을 나타내는 뭔가 이모지나 아이콘같은거 넣을 수 있을까

**Answer**: 실력 등급 숫자 앞에 lucide `Gauge`(레벨 미터) 아이콘 추가. 색 튀는 이모지 대신 단색 아이콘이 currentColor로 초록 텍스트에 물들어 "담백"함 유지, "등급/레벨" 의미 전달. inline-flex로 아이콘+숫자 묶음(size 14, strokeWidth 2.25, aria-hidden). lucide-react가 이미 코드베이스 다수에서 쓰여 일관. tsc·lint 통과.

---

## #10

**Prompt**: 정렬이 있으면 좋겠는데 기본정렬은 가나다순, 추가로 년생순, 최근참가순 이 있으면 좋겠고, 년생순과 최근참가순은 구분선을 넣어서 년생은 99년--98년-- 이런식으로, 최근참가는 최근1주일--최근2주일--최근3주일--최근4주일--최근2달--최근3달 이렇게 했음좋겠어

**Answer**: 회원 관리 목록에 정렬(가나다/년생/최근참가) + 그룹 구분선 추가.

- 데이터: `fetchLastParticipationByMember(100)` 신설 — attendances(confirmed/late_pool) × sessions.scheduled_at(지난 100일·이미 지난 것만) 조인해 member_id→최근 참가일 Map 반환. 최근참가 정렬·버킷용.
- 가상화 대응: 회원 행 사이에 헤더를 섞은 평탄 `ListItem[]`(header|member)를 sortMode별로 구성. useVirtualizer를 가변 높이(`estimateSize`: header 34 / row 68)+`getItemKey`로 전환, sortMode 변경 시 `measure()` 재계산.
- 정렬: 가나다=순수 이름 오름차순(기존 운영진 상단 고정 제거), 년생=내림차순(높은 년도 먼저, 미상 뒤) 년도별 구분선, 최근참가=최근일 내림차순 버킷 구분선(1/2/3/4주·2/3달, 그 외 "3달 이전·기록 없음").
- UI: 검색창 아래 btn-toggle 3분할 세그먼트. 헤더는 라벨+하프라인 구분선.
- 검증: 시뮬레이션으로 버킷 경계(7/14/21/28/60/90)·그룹 순서 확인. tsc 통과, 에러 0(기존 useVirtualizer 경고만).

---

## #11

**Prompt**: 각 헤더옆에 카운터있고 헤더는 스티키하게 상단에 달라붙게

**Answer**: 그룹 헤더에 회원 수 카운터 + 스티키(상단 고정) 추가.

- 카운터: listItems 빌드 시 헤더 객체(HeaderItem)에 count 필드를 두고 그룹 회원 수 누적 → 헤더에 "{count}명" 표기(faint).
- 스티키: 가상화 표준 패턴 — `stickyIndexes`(헤더 인덱스들) 계산, `rangeExtractor`(defaultRangeExtractor + activeStickyIndexRef)로 현재 상단 그룹 헤더를 항상 렌더 범위에 포함. 활성 헤더만 `position:sticky; top:0; zIndex:2`(그 외 헤더/행은 absolute+translateY). 스크롤 시 rangeExtractor가 활성 인덱스 갱신 → 재렌더로 반영.
- 헤더에 불투명 배경(bg-[#fafbff] dark:[#0f172a])과 하단 하프라인 추가 — 고정 시 아래 행이 비치지 않게.
- tsc 통과, 에러 0(기존 useVirtualizer 경고만). 실제 스크롤 동작은 앱에서 확인 권장.

---

## #12

**Prompt**: 도메인뿐만아니라 세션쪽 명령은 전부운영진만 해야하는데 누가 세션종료를 누른거같아. 일정으로 연 세션은 세션종료버튼 못누르게 하고 즉석세션시작으로 연 세션만 종료할 수 있게 하고 누를때 확인버튼 누르게해

**Answer**: 보드 세션 종료 버튼을 즉석 세션 전용으로 제한. 세션 종료 버튼은 이미 편집자(운영진 전용 편집권)로 가드되고 확인 다이얼로그도 존재했으므로, 회원이 아니라 일정 세션의 편집자(운영진)가 누른 케이스로 판단.

- 세션 출처 판별자 확정: `SessionRow.scheduled_at != null` ⟺ 일정(스케줄/반복) 세션, 즉석 세션은 null(schedule.ts 주석·startSession insert로 확인).
- `SessionMeta`(appStore)에 `isScheduled` 필드 추가 후, 세 곳의 생성 지점에서 채움: loadSessionAction=`row.scheduled_at != null`, 즉석 startSession 분기=`false`, 세션 업데이트 분기=기존 값 유지.
- BoardToolbar 종료 버튼 렌더 조건을 `isEditor` → `isEditor && !isScheduled`로 변경(일정 세션은 버튼 숨김). 확인 다이얼로그(ConfirmDialog)는 기존 그대로 유지.
- 서버측 dbEndSession은 status='closed'로 만들어 일정 회차를 조기 종료시키므로 이번 버그의 원인. UI 숨김이 요청 범위이며, 필요 시 서버 가드(일정 세션 종료 거부) 추가는 후속 옵션으로 안내.
- 병행: "운영진 전용인데 회원이 누를 수 있는 버튼" 전수 감사 워크플로우가 백그라운드 진행 중(별도 산출 예정).

---

## #13

**Prompt**: 운영진만 눌러야하는 버튼을 회원이 누르는거 같아. 해당 기능을 락해야하는데, 리스트 뽑아줘.

**Answer**: 멀티에이전트 워크플로우(서버가드 지도 → 6도메인 UI감사 → 갭 반증검증 → 종합)로 전수 감사. 확정 갭 4건 전부 `/setup`(SessionSetup) 라우트가 isAdmin 미가드라는 한 뿌리. schedule·members·dues(페이지 내부 리다이렉트)·board(편집권 lease)·carpool은 갭 0.

- HIGH 2건(서버도 뚫림): 세션 시작/업데이트(SessionSetup.tsx:260), 충돌 덮어쓰기(SessionConflictDialog.tsx:252). startSession/updateSession이 sessions·session_players에 직접 write하는데 두 테이블 RLS 전무(직접 grep 검증) → 회원 write 성공. "누가 세션종료를 눌렀나"의 진짜 표면(회원이 /setup에서 새 세션 시작 시 기존 활성세션 강제 closed).
- MED 2건(서버 members RLS가 막아 실피해 없음, 노출/에러만): 선수 성별·실력 편집(EditModal.tsx:82), 선수편집 충돌 덮어쓰기(PlayerConflictDialog.tsx:90).
- 도달 경로: /setup 라우트가 allPlayers>0||sessionMeta만 검사(App.tsx:208), 진입은 URL 직접 또는 보드 '설정' 버튼(BoardToolbar.tsx:103, 미가드). Home '즉석세션 시작'만 isAdmin이나 렌더 조상 아님.
- 권장 락: ①즉시 /setup에 (ready && !isAdmin)→navigate('/') 가드 + 설정버튼 isAdmin 숨김(UI 4건 차단) ②근본 sessions/session_players RLS 활성화 또는 is_admin RPC 전환(마이그레이션 필요). 적용은 사용자 확인 후 진행하기로 하고 이번엔 리스트만 산출.

---

## #14

**Prompt**: 둘다 해 / 그리고 세션설정의 나가기를 세션화면의 좌상단에 < 를 넣어서 나가기역할을 하게 해주고 설정은 우측으로 옮겨줘.

**Answer**: 감사에서 나온 UI 가드 + 서버 RLS + 보드 툴바 재배치를 함께 적용.

- **UI 가드(/setup 운영진 전용)**: SessionSetup에 다른 관리자 페이지와 동일한 useEffect 리다이렉트(ready && memberLoaded && !isAdmin → navigate('/')) 추가 → 확정 UI 갭 4건(세션 시작/업데이트·충돌 덮어쓰기·선수 편집·편집 충돌) 전부 차단.
- **보드 툴바 재배치**: 좌상단 설정 버튼을 `<` 나가기(navigate('/'), 세션 유지·회원 포함 전원)로 교체, 설정 버튼은 우측 클러스터로 이동하며 isAdmin 게이팅(→ /setup 진입 운영진만). 로그·종료는 유지.
- **서버 RLS(근본)**: 조사 결과 sessions/session_players 는 부트스트랩(docs/migration.sql)의 anon_all(FOR ALL USING(true))이 남아 비로그인·비회원 포함 누구나 직접 write 가능했던 게 진짜 구멍. 마이그레이션 20260713140000 신설: anon_all DROP 후 select=authenticated / write=is_admin() 정책(places 관용구). 회원 대면 write는 전부 SECURITY DEFINER RPC 경유라 carve-out 불필요(Explore 에이전트로 전 write 경로 검증). matches/pair_history는 아직 anon_all → 후속 대상으로 문서에 표기.
- 검증: tsc·빌드·테스트 212개 통과. DB 마이그레이션은 supabase db push 수동 적용 필요(프론트 배포와 별개) — 미적용 상태로 파일만 생성.

---

## #15

**Prompt**: < 나가기 디자인을 다른 네비와 통일해

**Answer**: 보드 툴바 나가기 버튼 아이콘만 18×18이던 것을 나머지 네비(설정·로그·종료)와 동일한 16×16으로 맞춤. 네 버튼 모두 iconBtn(color)+16×16 아이콘+텍스트 라벨 구조로 통일(나가기·설정·로그=text-secondary, 종료=ios-red). tsc 통과.

---

## #16

**Prompt**: 두 내비의 뒤로가기가 동일하다고?

**Answer**: 앞서 '통일'을 보드 툴바 형제 버튼 기준으로 잘못 해석. 사용자가 가리킨 '다른 네비'는 AppHeader(회원관리 등)의 뒤로가기였음 — 스크린샷상 AppHeader는 lucide ChevronLeft(size 26·strokeWidth 2.2·text-strong)로 크고 굵은데 보드 나가기는 인라인 SVG 16px·얇은 회색이라 불일치.

- 보드 나가기를 AppHeader와 동일 컴포넌트/규격(ChevronLeft 26/2.2, text-strong, 40×40 탭타깃, marginLeft -6)으로 교체하고 '나가기' 텍스트 제거해 아이콘 전용으로 완전 일치.
- tsc·빌드 통과.

---

## #17

**Prompt**: 지금 수지에 새 카테고리 추가하면 무한히 늘어나는 구조인데 이거 어떻게 해야할까.

**Answer**: 수지 탭 카테고리 블록을 '추가 전용'에서 '관리(추가+삭제)'로 확장. 삭제 RPC(dues_delete_category)는 이미 FK on delete set null이라 삭제 시 그 카테고리 거래는 미분류로 복귀 → 데이터 손실 없이 목록만 정리.

- DuesLedgerTab에 카테고리 칩(× 삭제 버튼) 목록 렌더 + 삭제 확인 ConfirmDialog 추가
- handleDeleteCategory → deleteCategory 후 재로드

---

## #18

**Prompt**: 가격을 보고 어디에 매칭해야할지 제안하는 식으로 해줘. 6천원인데 어딘지 못찾으면 7월에 열린 세션목록이 보인다던지.

**Answer**: 입금액으로 성격을 추정해 매칭 항목이 없을 때 원탭 생성을 제안. 기존 '회비로 처리'(금액=회비액)와 대칭으로, 금액=대관비액인데 미납 대관비 항목이 없으면 그 달 대관 세션 목록을 드롭다운으로 띄워 관리자가 세션을 지목 → 그 세션 대관비 항목을 만들고 배분.

- 신규 RPC dues_confirm_new_court(tx, member, session): (member, session) 대관비 항목 멱등 생성 후 거래 잔여 내 배분 + 감사로그 + 납부확인 알림 (dues_confirm_new_monthly의 대관비 판)
- duesStore.loadReconcile에 courtFee(설정값)·monthSessions(fetchMonthSessions) 추가 로드
- ReconcileRow: canCreateCourt 분기 + 세션 선택 드롭다운(날짜·장소 라벨), 요약에 "N원 = 대관비 · 어느 세션인지 →" 표시
- tsc·eslint·build 통과, 마이그레이션 원격 적용

---

## #19

**Prompt**: 회계 앞으로 꼬일거같아서 수동으로 처리해야할거같은데 0705는 대관해서 비용이 마이너스야 이거 카테고리로 추가하면 이후 매번 0705가 보여서 보기싫을거같아 db 에서 수동처리하고싶은데 가능할까?

**Answer**: 0705 세션(id 105)이 cancelled라 자동 대관비 부과·세션선택 UI 대상에서 빠져 수동 DB 처리가 필요한 케이스. supabase db query --linked로 원격 DB 직접 조작 가능함을 확인. 세션별 카테고리(0705) 신설을 피하고 상설 '코트대관' 하나로 통합하는 방향으로 처리(사용자 선택 Option A). 단일 트랜잭션 실행:

- 대관 지출을 상설 '코트대관'(id 7)으로 통합: 0705 지출(674, 135,000) + 먼저 만들었던 '0712' 카테고리(13) 소속 거래(644·624) 전부 이관 → 카테고리 13 삭제(무한 증식 방지)
- 무시(ignored)됐던 0705 입금 5건(권승현·김길환·유성종·권진희·채진, 6,000씩)을 unmatched로 되돌린 뒤(sync 트리거가 ignored 보존하므로 선행), 세션 105 대관비 부과 5건 생성 + 배분 → 전부 matched/paid
- dues_audit_log에 manual_fix_0705 기록
- 검증: 지출 3건 cat 7, 카테고리13 삭제됨, 입금5건 matched, 부과5건 paid. 코트대관 지출 누적 315,000

---

## #20

**Prompt**: 미납알림 발송할때 특정 미납만 알릴수 있게 선택하게 해줘. 아님 전체다하든. / 한사람이 두명분 돈을 낼 수 있어서 그거 체크하게 해줘. 게스트데려온 사람은 게스트돈까지 같이내니까 세션보고 그것도 확인할수 있게 해줘 / 현황판에 세션별로 입금이 다 됐는지 안됐는지... 카테고리별로 정렬... 미납알림 발송버튼 / 라우터 정리해서 회비관리 페이지에 년/월/현황판/입금확인/수지 전부 독립적인 주소를 / 내 회비 페이지는 어떤구조로... 지금은 내것말고 모두의 것이 나오는것 같아

**Answer**: 회비관리 백로그 5건 처리.

- **내 회비 버그(근본원인)**: fetchMyCharges에 member 필터가 없어 RLS(관리자=전체 열람)를 타는 관리자 계정에서 전 회원 부과가 노출됨. `.or(member_id.eq / payer_hint.eq)` 명시 필터 추가로 본인+대납분만 조회.
- **현황판 재설계**: 회원 나열 → 카테고리(회비 · 세션별 대관비) 그룹으로 전환. 완납 그룹은 기본 숨김(‘완납 표시’ 토글). 대관비는 대납자(payer_hint??member)별로 미납 합산 + ‘게스트분 포함’ 배지 → 게스트 데려온 사람이 게스트돈까지 낸 걸 세션에서 확인.
- **선택 발송**: 각 그룹 헤더에 발송 버튼, 회원별 체크박스로 대상 취사선택. 신규 RPC dues_notify_selected(member 배열+커스텀 문구, 중복방지 없음). 회비는 헤더 종(전체·ym 중복방지)도 유지. 대관비 알림 위해 dues_unpaid 푸시 문구를 payload.msg 우선으로 확장(send-push·notifications.ts 동기화).
- **라우터**: /dues/:ym/:tab 서브라우트 신설, DuesAdminPage를 useParams 기반으로 전환(ym·탭 독립 주소·뒤로가기). /dues는 canonical로 리다이렉트.
- 대납 비게스트(회원이 다른 회원분까지)는 백엔드(dues_confirm_match)는 이미 다중 charge 배분 지원, 입금확인 UI만 단일회원 → 후속 과제로 남김.
- 검증: tsc·eslint·build 통과. 마이그레이션·send-push 원격 배포.

---

## #21

**Prompt**: 게스트가 아니더라도 한사람이 두명꺼 낼 수 있어 / (스크린샷) 6천원이면 세션선택이 나와야하는데 나오지 않아 (고은림(게스트 +6,000)

**Answer**: 입금확인 두 가지 보완.

- **게스트 대관비 입금 세션선택 버그(근본원인)**: fetchMembersForAdmin이 is_guest=false로 게스트를 제외 → "고은림(게스트)"이 대사 회원목록에 없어 후보/검색 불가 → 회원 미선택 → canCreateCourt(회원 필요) false → 세션선택 안 뜸. fetchMembersForAdmin(includeGuests) 옵션 추가하고 loadReconcile에서만 게스트 포함. 이제 게스트가 자동 후보로 잡혀 6천원 세션선택이 노출. AdminMemberRow에 isGuest 추가, 게스트 뱃지 표시, 게스트는 회비 생성(canCreateMonthly) 제외.
- **한 사람이 여러 명 몫**(비게스트 포함): ReconcileRow에 '다른 회원 몫' 추가 기능. 주 납부자(입금자) 외 회원을 검색해 추가하면 그 회원 미납이 기본 체크되어 한 입금으로 여러 명 charge에 배분. 백엔드 dues_confirm_match는 이미 다중 charge 지원(payer=주 납부자로 귀속), UI만 확장. 소유자별로 묶어 표시 + 요약에 'N명 몫'.
- 검증: tsc·eslint·build 통과. 프론트/데이터 레이어만 변경(배포 불필요).

---

## #22

**Prompt**: (스크린샷) 구현한건 좋은데 UI 가 너무 난잡하다. UI 좀 손봐.

**Answer**: 입금확인 ReconcileRow 항목 토글 영역 정리(기능 동일).

- 회원별 세로 나열 → "회원명(정렬 열) | 항목 칩 인라인" 한 줄 레이아웃
- 항목 칩 컴팩트화: 테두리 제거, 선택=초록 연한 채움/미선택=회색 연한 배경, ✓ 표식 제거(색으로 구분)
- 라벨 축약: "2026-07 회비"→"회비"(대관비는 세션 날짜 유지)
- 요약 문구 축약("이 입금 → X 처리" 제거, 버튼이 금액 표시) → 한 줄 유지
- 상단 후보칩·검색·검색결과도 동일 톤(테두리 제거·연한 배경)으로 통일, '+ 다른 회원 몫'은 옅은 텍스트 링크로
- tsc·eslint·build 통과

---

## #23

**Prompt**: 레이아웃 배치와 액션을 좀 더 사용성있게 바꾸라는 얘기야 색만 바꾸는게 아니고

**Answer**: 입금확인 ReconcileRow를 3단 구조 + 액션 위계로 재설계(색 아닌 배치·흐름).

- **① 납부자 / ② 정산 / ③ 액션** 라벨 있는 3단 세로 구조 + 좌측 정렬 거터로 읽는 순서 명확화
- 검색은 텍스트 '🔍 검색' pill → lucide Search 아이콘 버튼으로 축소
- 액션바를 hairline으로 분리 + 상단에 상태 한 줄("이홍희 외 1명 납부 처리" / "세션을 고르세요" 등)
- **주 액션(확인·회비생성·세션선택)을 풀폭 solid 버튼**으로 크게(탭 타깃↑), 금액 포함("확인 · 12,000원")
- **보조 액션 통합**: 분류(카테고리)+무시가 확인과 경쟁하던 걸 단일 '회비 아님…▾' 드롭다운(optgroup 분류 + 무시)으로 합쳐 난잡함 제거
- 부분납부 시 앰버로 '입금 X 중 Y' 경고, 항목/후보 칩 탭 타깃 확대
- tsc·eslint·build 통과(프론트만)

---

## #24

**Prompt**: 영민 옆의 X 를 더 왼쪽으로땡겨서 줄 맞춰줘 / (스크린샷) 이 사람은 완전 외부인이야. 회원이 아냐. 이런 금액도 그냥 세션목록 띄워서 정리해줘.

**Answer**: 정산 행 정렬 + 외부인 대관비 처리.

- **✕ 정렬**: 추가 회원의 ✕가 이름 안에 있어 이름이 우측으로 밀리던 것을 absolute(left:-19)로 왼쪽 거터에 빼서 회원명 좌측 정렬.
- **완전 외부인(비회원·비게스트) 대관비**(근본 판단): dues_charges 만들 회원이 없으므로, 회원 선택 없이 세션에만 귀속하는 경로 신설. bank_transactions.session_id 컬럼 추가 + dues_confirm_court_external(tx, session) RPC — matched 처리(배분 없음) → 미처리에서 빠지고 수지 '대관비 수납'(matched IN)으로 집계.
- 회원 매칭 안 되는 6천원 입금이면(canExternalCourt) 회원 없이도 세션 드롭다운 노출, 선택 시 외부인 처리. 회원 선택 시엔 기존 dues_confirm_new_court.
- dues_cancel_match를 세션 태깅 해제 + 배분 없으면 unmatched 복원까지 하도록 갱신(외부인 처리 취소 대응).
- 검증: tsc·eslint·build 통과. 마이그레이션 원격 적용.

---

## #25

**Prompt**: 세션선택도 대관비 선택하듯이 버튼이 낫지않아?

**Answer**: 대관비 세션 선택을 `<select>` 드롭다운 → 정산 칩과 동일한 칩 버튼으로 변경. 각 세션(날짜·장소)이 초록 칩 버튼이고, 탭하면 바로 처리(회원이면 dues_confirm_new_court, 외부인이면 dues_confirm_court_external). 액션 영역에서 flex-wrap으로 배치, '회비 아님' 드롭다운은 유지. 프론트만 변경, tsc·eslint·build 통과.

---

## #26

**Prompt**: 칩 디자인을 회비의 그것과 통일해줘

**Answer**: 세션 칩 스타일을 정산(회비/대관비) 칩과 동일하게 통일 — 테두리 제거, 초록 채움 rgba(52,199,89,0.18), padding 4px 10px·radius 8·fontSize 12.5로 맞춤. build·eslint 통과.

---

## #27

**Prompt**: 로직도 동일하게 해야지. 확인눌러서 넘어가게

**Answer**: 세션 칩을 탭 즉시 처리 → 정산 칩과 동일하게 '선택 후 확인' 흐름으로 변경.

- selSession 상태 추가, 세션 칩은 토글 선택(선택=초록 ✓ 채움, 미선택=회색)
- 라벨 '세션' 블록을 정산 블록과 동일 레이아웃으로 추가(showSessionPick일 때만; 이때 정산 블록은 숨김)
- 액션바 주 버튼을 '세션 선택 후 확인' → 선택되면 '대관비 확인 · N원'(초록 solid)로 활성화, 클릭 시 회원=dues_confirm_new_court / 외부인=dues_confirm_court_external
- 회원 변경 시 selSession 리셋. tsc·eslint·build 통과(프론트만)

---

## #28

**Prompt**: db에서 수동으로 처리할건데 0705 세션이 열렸다고 가정하고 추가해줘. 정산에만 노출할거고 그래서 라디오에서 선택할 수 있게 할거야. 그리고 대관비입력을 수지에서 하게 되어있는데 이게 언제 날짜의 대관인지도 알 수 있게 해줘. 세션에 매칭해주면 좋아. 앞에 말한것도 수동으로 추가하고. 근데 이거 정산에만 적용하고 실제 세션데이터엔 안넣어도 돼

**Answer**: 정산 전용 세션 노출 + 대관비 지출-세션 매칭.

- **정산 전용 노출 플래그**: sessions.dues_include 컬럼 추가. fetchMonthSessions를 `status in (active,closed) OR dues_include`로 확장 → 무산(cancelled)이어도 정산 목록(입금확인 세션칩·수지 세션매칭)에 노출. 실제 status는 안 건드림.
- 0705(세션 105, cancelled, 에이트민턴 13000/h)를 `update sessions set dues_include=true`로 수동 노출(상태 유지). 이제 세션 라디오에 뜸.
- **대관비 지출↔세션 매칭**: dues_set_txn_session RPC 추가. 수지 지출 목록에서 '코트대관' 카테고리 출금에 세션 선택 드롭다운 노출 → 언제 날짜 대관인지 매칭·표시(bank_transactions.session_id, ✓날짜). loadLedger에 monthSessions 로드 추가, BankTxnRow에 sessionId/sessionDate 추가.
- 검증: tsc·eslint·build 통과. 마이그레이션 원격 적용 + 105 수동 업데이트.

---

## #29

**Prompt**: (스크린샷 12,000원) 이처럼 가격이 기존 정의한 가격이 아닐경우, 모든 선택지가 나와야함.

**Answer**: 미리 정의된 금액(회비 5,000/대관비 6,000 1건)이 아니고 회원 미납도 없을 때 → '직접 구성' 모드로 모든 선택지 노출.

- 신규 RPC dues_confirm_compose(tx, member, ym, session_ids[]): 회비 + 여러 세션 대관비 항목을 멱등 생성 후 거래 잔여 내 순차 배분(new_monthly+new_court 일반화). 예: 12,000=대관비 2세션, 11,000=회비+대관비.
- ReconcileRow에 showCompose 분기: 회원 미납 없음 && 정의된 금액 아님 → '구성' 블록(회비 토글 + 세션 다중선택 칩, 모두 정산칩과 동일 스타일) + 합계 표시 + 확인 버튼(마지막 액션버튼을 정산/조합 겸용으로).
- composeMonthly/composeSessions 상태, 회원 변경 시 리셋. 상태문구에 '선택 합계'/'정의된 금액 아님' 안내.
- 검증: tsc·eslint·build 통과, 마이그레이션 원격 적용. 배분 정확성은 적대적 검증 워크플로로 추가 확인 중.

---

## #30

**Prompt**: (조합 처리 적대적 검증 워크플로 결과 반영)

**Answer**: 워크플로가 확정한 실제 버그 2건 수정.

- **waived/void 부과 배분 방지**: compose/new_monthly/new_court가 상태 확인 없이 owed 계산 → 면제/무효 부과에도 배분되어 입금이 조용히 소모. dues_alloc_guard(BEFORE 트리거)에서 waived/void charge 배분을 차단(모든 배분 경로 커버).
- **부분납이 미처리에서 조용히 빠짐**: partial tx가 확인됨에 완전매칭처럼 표시되던 것을, DuesReconcileTab에서 '부분 처리' 별도 섹션(앰버, 취소·재처리)으로 분리해 완전성 추적.

---

## #31

**Prompt**: 김태혁 게스트비까지 냈어 UI에서 선택하게 / 0705 회비 현황판에 안보여 + 6/29 대관비 지급까지 DB 수동 / 통장 거래 후 잔액 표시 / 카테고리별 순액을 회비·대관비 세션단위로(실제 열린=경기 있는 세션만)

**Answer**: 4건 처리.

- **거래 후 잔액**: balance_after는 이미 적재됨 → 미처리 행·수지 출금 행에 '잔액 X' 표시.
- **0705 수동**: 6/29 대관 지급(tx674, 135,000)을 세션 105에 링크(supabase db query). 현황판에 0705 안 보이는 건 코트 charge 10건이 전부 완납이라 완납 숨김된 것(‘완납 표시’ 토글로 확인).
- **수지 세션단위 순액**: '회비/대관비 수납' 뭉치 → 회비 수납 + 세션별 대관비(수입=회원 charge amount_paid+외부인, 지출=세션 링크된 출금, 순액) + 코트대관 미배정 지출 행. 실제 열린 세션만(활동 있는 세션+monthSessions). loadLedger에 court·monthly 로드 추가.
- **게스트비(조합)**: compose 세션 칩을 인원 순환(탭할수록 본인→2인→…)으로. dues_confirm_compose를 p_sessions jsonb([{id,units}])로 교체, 대관비 부과 amount_due=인원×court로 생성(세션 수입에 게스트분 반영). 김태혁 7/5 12,000=0705 2인.
- 검증: tsc·eslint·build 통과. 마이그레이션 2개 원격 적용 + tx674 수동 링크.

---

## #32

**Prompt**: 입금확인도 카테고리별로 정렬해서 보여줘. 지금 정산에 0711 힐링민턴 잘못 처리된건데 어딘가 입력되어있는데 못찾겠어

**Answer**: 0711 오처리 추적 + 입금확인 처리내역 라벨/정렬.

- **0711 힐링 오처리 규명**: 김태혁 0711 힐링(세션168) 대관비 부과(charge25)가 '김태혁0719' 입금(tx1, 6,000)으로 결제됨 = 7/19 입금이 7/11 대관비에 잘못 매칭(dues_allocations alloc1). 안 보였던 이유는 입금확인이 '무엇으로 처리됐는지'를 안 보여줘서.
- **처리내역 라벨 + 카테고리 정렬**: fetchTxAllocations(배분→charge→kind/session/이름)로 거래별 처리내역 라벨 계산. 확인됨·부분 행에 '→ 7.11 대관비' 식 라벨 표시 + 처리내역 키로 정렬(같은 회비/세션끼리 모임). 이제 '김태혁0719 → 7.11 대관비'가 드러나 오처리 즉시 발견·취소 가능.
- 프론트/데이터 레이어만(마이그레이션 없음). tsc·eslint·build 통과.

---

## #33

**Prompt**: 0705 Tk3코트 대관 이거 저번달건데 이런식으로 넘어가면 이번달 정산에 계산을 못해서, 선택할수 있게해줘

**Answer**: 대관비 지출이 세션과 다른 달에 지급된 경우(전월 선지급 등) 세션 순액에 반영.

- **A(핵심)**: 세션 순액을 발생월 기준 → **세션 기준**으로. fetchSessionTxns(sessionIds)로 이번 달 세션에 링크된 거래를 발생월 무관하게 가져와 세션 수입/지출 집계. 0705(7월 세션)의 6/29 지급(tx674, 135,000)이 7월 0705 순액에 −135,000으로 잡힘(수납 60,000 → 순 −75,000).
- **B**: 지출-세션 링크 드롭다운을 fetchLedgerSessions(ym±1개월)로 넓혀, 전월/익월 세션에도 링크 가능(대관비는 다른 달 지급되므로). queryCourtSessions로 fetchMonthSessions/fetchLedgerSessions 공통화.
- 세션 집계를 당월 txns → sessionTxns로 이전(중복 방지). 상단 수입/지출 총액은 당월 현금흐름 그대로.
- 프론트/데이터 레이어만. tsc·eslint·build 통과.

---

## #34

**Prompt**: 지출에 애초에 저번달게 보이질 않아. 일단 6월거만 임시로 보이게 할 수 없어?

**Answer**: 전월 대관 지출이 이번 달 출금 목록에 안 보여 링크/확인 불가 → 수지에 '전월 대관·미분류 지출' 접이식 섹션 추가.

- loadLedger에 전월 거래(fetchBankTransactions(prevYm)) 로드 → prevTxns.
- prevCourtOuts = 전월 출금 중 코트대관 카테고리 또는 미분류. 접이식(기본 접힘) 섹션에 카테고리·세션 드롭다운 + 매칭 날짜(✓) 표시. 이번 달 총액엔 미포함(세션 연결 전용).
- 여기서 6월 대관 지출을 7월 세션에 링크하면 #33의 세션 기준 순액으로 반영됨. tx674(0705, ✓7.5)도 여기서 확인 가능.
- 프론트/데이터 레이어만. tsc·eslint·build 통과.

---

## #35

**Prompt**: 현황판 사용자 눌러 수납처리 기능 삭제(통장 거래만·현금 없음) / 0711 실제 경기 없는데 DB 값 잘못 들어감 수동 처리 / (추가) 전월 지출 섹션 지워도 됨(6월 가서 세팅하면 됨)

**Answer**: 3건 처리.

- **현황판 수납 모달 삭제**: 통장으로만 거래하고 현금 수납 케이스가 없어 불필요. DuesAdminPage에서 payTarget·buildOutstanding·DuesPaymentModal 렌더/import 제거, GroupCard 행을 탭 불가한 표시용 div로. DuesPaymentModal.tsx 파일 삭제(고아).
- **0711 오입력 수동 처리**: 세션 168/96 경기(matches) 0건 확인(실제 게임 없음). 잘못 생성돼 있던 court charge id25(김태혁, 0711, unpaid·배분없음) 삭제. (지난 오배분은 사용자가 이미 취소함.)
- **#34 전월 지출 섹션 롤백**: #33으로 다른 달(6월) 화면에서 직접 세션 링크 가능하므로 불필요 → DuesLedgerTab 전월 섹션·prevCourtOuts·showPrev·store prevTxns·loadLedger 전월 fetch 제거.
- tsc·eslint·build 통과. 0711 charge 삭제는 DB 수동(서비스 시작 정리, 이후엔 시스템으로).

---

## #36

**Prompt**: 현황판에 7/5 안보임(실제 경기했는데 커스텀일수도, DB확인 후 없으면 가상생성) / 회비관리 nav 뒤로가기는 홈으로(navigate(-1) 아님)

**Answer**: nav 수정 + 0705 조사.

- **0705 조사**: 7/5 세션은 이미 존재(session 105, 에이트민턴, dues_include, 참석2·경기0, court charge 10건 완납). 수지 세션순액에 '7.5 −75,000'으로 이미 잡힘. 현황판에 안 보이는 건 완납이라 숨겨진 것(완납 표시로 확인). 세션이 '없지 않으므로' 가상 생성 안 함(중복 방지).
- **nav 뒤로가기 → 홈**: DuesAdminPage onBack을 navigate(-1) → navigate("/")로. build 통과.

---

## #37

**Prompt**: 아니아니지 미납자를 찾아야하는데 실제 참가자 디비보고 확인해봐

**Answer**: 0705 미납자 규명 + 부과 생성(DB 수동).

- session 105 attendances(실제 참석) = 오상진·지성규 2명(confirmed)인데 둘 다 대관비 charge 없음 = 미납자. (앞서 입금 매칭한 11명은 완납이나 attendances엔 없음 — 커스텀/무산 세션이라 자동부과 누락.)
- 참석했는데 부과 안 된 confirmed 참석자에게 미납 court_fee(6,000) 생성 → 오상진·지성규. 이제 현황판 0705가 미납 2명으로 노출(완납 아님).
- DB 수동(서비스 시작 정리), 코드 변경 없음.

---

## #38

**Prompt**: (0705 실제 참가자 명단 제공) / 송수민 운영진 제외 / 7/5게스트2·우창형 처리 / 우창형 게스트 등록(A)

**Answer**: #37 오판단(attendances 기반 오상진·지성규) 정정 후, 실제 명단 18명 기준 0705 정산 확정(전부 DB 수동, 서비스 초기).

- attendances(오상진·지성규)는 취소/커스텀 세션이라 무의미 → 해당 부과 삭제. 실제 명단 18명과 회원 DB 대조.
- 완납 13: 회원 11명(김태혁 12,000=본인+게스트1) + 게스트 2명(김태혁분 + '7/5게스트2' 입금 external 매칭).
- 미납 부과 생성: 이유나·이재원·최두호(회원). 송수민=운영진이라 부과 삭제(제외). 
- 우창형=회원DB 없음 → 게스트 회원(is_guest)으로 신규 등록 + 0705 미납 court_fee(6,000) 생성. (우창형은 0628·0620/0621·콕공구 미매칭 입금 별도 존재 — 추후.)
- 최종: 완납13 + 미납4(이유나·이재원·최두호·우창형) + 운영진제외1(송수민) = 18. 세션순액 수입 84,000(72,000+게스트6,000+…) 대비 지출 135,000.
- 코드 변경 없음(DB 수동).

---

## #39

**Prompt**: (오입금 환불건 선택 불가) 기본적으로 회비·세션 다 선택 가능하게 + 금액별 자동선택: 1)5천=회비 2)6천=참가세션 자동 3)1.2만=참가세션2 4)1.1만=회비+세션

**Answer**: 입금확인 ReconcileRow를 분기 뭉치(canCreateMonthly/showSessionPick/showCompose/charge-toggle/external) → **회원 선택 시 항상 회비+세션 compose(금액 기반 프리셀렉트)** 로 통합 재작성.

- UnpaidCharge에 sessionId 추가(참가 세션 판별용). fetchUnpaidByMember/fetchMemberUnpaidCharges select+매핑 반영.
- 프리셀렉트: afterFee=amount-5000이 6000 배수면 회비+k세션, 아니면 amount가 6000 배수면 k세션. 참가(미납 대관 charge 있는 이 달 세션) 우선 k개 자동선택. 게스트는 회비 제외. (5천→회비, 6천→참가1, 1.2만→참가2, 1.1만→회비+1)
- override??preselect 패턴(회원 바뀌면 override=null 리셋). 회비 토글 + 세션 칩(참가=파란 '참가' 표시, 탭=인원 순환 본인+게스트). 합계≠입금이면 앰버 경고. 확인 → dues_confirm_compose.
- 회원 없을 때만 비회원 대관(외부) 세션 단일선택 유지. onConfirm/NewMonthly/NewCourt 경로·핸들러·prop 제거(compose로 통합).
- build·eslint·32테스트 통과. 배분 정확성 적대적 검증 워크플로 진행 중.

---

## #40

**Prompt**: (회계 재정비) 기획→디자인→기능→정리→쿼리최적화. 디자인 새로, 알림 카테고리단위, 차액환불 연결, 정산함 입출금·버튼·날짜순, 회계 쉬운용어, 내회비 회계열람, 가져오기 정산함. 그리고 구현.

**Answer**: 회계 서브시스템 전면 재정비 — 기획·디자인 확정 후 구현 착수.

- **기획서 신설 `docs/ACCOUNTING_SPEC.md`**(단일 기준): 대전제·도메인·화면 요구(디자인 비의존)·금액 프리셀렉트·크로스먼스·알림(카테고리 단위, 전체 제거)·환불 연결·권한·정리/최적화(감사 결과)·§9 회귀·§10 구현계획. 낡은 ACCOUNTING_DESIGN.md는 이력용.
- **감사 워크플로**: dues.ts 미사용 export 9개·중복 쿼리·loadAdmin 상시실행 등 식별 → §8.
- **compose 검증 워크플로**: 회귀 3건 확정(게스트 몫 고아·크로스먼스 매칭불가·완납 프리셀렉트) → §9.
- **디자인 방향 워크플로 4종** → 사용자 선택: **A(세션중심) 메인 + B(정산함) + 회계 상세 + 내회비**. 와이어프레임(아티팩트)로 확정: 정모 카드(정산상태·마감), 정산함(입출금 날짜순 카드·버튼·가져오기·환불연결), 회계(쉬운용어·거래내역서 취소, CSV/세션상세 없음), 내회비(클럽 회계 항목별 열람).
- **환불 연결 설계**: bank_transactions.refund_of_tx_id + dues_link_refund/unlink, 해결=입금−배분−환불, 회계 wash.
- **구현 착수(백엔드)**: `dues_confirm_reconcile`(기존 미납 배분 + 회비/세션 신규 생성·배분 통합, waived/void·초과 가드) 배포 → §9-A~D 근본 해소. 남은 구현: refund RPC·공개회계 RPC·notify_unpaid 제거·데이터레이어/스토어(라우트별 로드·ym캐시·공유)·UI 4화면 재구축·정리·쿼리최적화·적대적 검증.

---

## #41

**Prompt**: go on

**Answer**: 회계 재정비 전체 구현 완료 — 백엔드·데이터레이어·스토어·UI 4화면·정리·쿼리최적화. (쿼리최적화는 #42에서 추가 정밀 감사.)

- **백엔드 마무리**: 환불(refund_of_tx_id + dues_link_refund/unlink + dues_sync_bank_tx)·공개회계(dues_public_ledger, 코트 이중계상 fix) 배포. 사문화 RPC 10종 드롭(notify_unpaid·confirm_match/compose/new_monthly/new_court·manual_payment·set_charge_status·reverse_allocation·set_session_fee) — 호출처 없음 확인 후.
- **데이터레이어(dues.ts)**: 래퍼 duesConfirmReconcile/Link·UnlinkRefund·fetchPublicLedger 추가, BankTxnRow.refundOfTxId·UnpaidCharge.periodYm/sessionDate 보강. 죽은 export 9개 + duesConfirmCompose + suggestChargeLines 제거.
- **스토어**: loadAdmin/Reconcile/Ledger 3분리 폐지 → `loadMonth(ym, force)` 단일 통합 + `loadedYm` 캐시 가드(화면 전환 시 재조회 0). loadMine에 클럽 공개회계 추가. → 탭당 ~10왕복 반복을 월 1회 병렬 wave로.
- **UI 4화면 재구축**(구 3탭·ReconcileRow·Ledger/ReconcileTab 삭제): ①정모(SessionsHome) 세션별 정산상태(코트지출연결·수납완료→마감/미완)+회비진행+정산함진입, 미납알림 분류단위 발송. ②정산함(ReconcileInbox) 상단 가져오기+필터+날짜순 미처리 카드(입금 ReconcileInRow=납부자·기존미납/신규 버튼, 출금 ReconcileOutRow=분류·세션·환불연결)+부분·무시. ③회계(LedgerView) 수입/지출/남은돈+항목별 정산+거래내역(러닝잔액, 탭→취소·재처리). ④내회비 클럽 공개회계 열람. 셀렉트 전부 버튼화, 저뎁스.
- **셸/라우팅**: DuesAdminPage=nav(정모/정산함/회계)·월선택·loadMonth 소유. 라우트 /dues/:ym·/inbox·/ledger.
- **적대적 리뷰서 버그 1건 발견·수정**: 회계에서 코트대관 출금 분류취소 시 session_id 잔존 → 세션 순액 이중계상. 취소 시 세션도 함께 해제.
- 검증: tsc clean, 204 tests pass, build·lint clean, 배포 RPC 시그니처 DB 확인. 문서 §2/§3.1/§3.3 정합화.

---

## #42

**Prompt**: 최종적으로 쿼리최적화 다시체크

**Answer**: 쿼리 패턴 정밀 재감사 → 실질 낭비 2건 발견·개선.

- **fetchTxAllocations 전역 무제한 → 월 거래 id로 스코프**: 지금껏의 모든 배분을 3-조인으로 조회하던 것(시간 경과 시 무한 증가)을, 표시 대상인 이번 달 bankTxns id로 `.in(bank_tx_id, ...)` 제한. 시간 지나도 수십 건으로 바운드(최대 스케일링 이득). loadMonth를 wave2(sessionTxns+txAllocations, 앞 결과 id 필요)로 재구성.
- **뮤테이션마다 전체 10쿼리 재로드 → 가변 슬라이스만 6쿼리(`refreshMonth`)**: triage 중 확인·분류·무시·환불·취소는 정적(회원·세션·카테고리·설정) 재조회 없이 charges·txns·unpaid·allocations·sessionTxns만 갱신. 로딩 플래그 미토글 → 목록 안 깜빡임. 카테고리 추가/삭제·가져오기만 loadMonth(force) 전체.
- 결과 왕복: 화면 전환 0(ym 캐시) · tx 처리 10→6 · 콜드로드 11(2 wave) · 배분조회 무한→월단위. 검증: tsc clean, 204 tests, build·lint clean.

---

## #43

**Prompt**: 그럼 react query얘긴 무시하고 다시 쿼리최적화 고민해봐

**Answer**: React Query 미도입 확인(앱 전체 Zustand 15스토어 관례, react-query 미설치 → 일관성상 유지) 후, Zustand 구조 안에서 심화 감사 → 2건 추가 개선.

- **세션 쿼리 중복 제거**: `fetchMonthSessions`(그 달)와 `fetchLedgerSessions`(±1개월)는 필터 동일·범위만 다른 상위집합 관계임을 확인 → month 쿼리 폐지, `ledgerSessions`에서 `isInYm`으로 메모리 파생. 콜드로드 세션 조회 2→1.
- **tx-only 뮤테이션 경량 갱신 `refreshTxns`(3쿼리)**: 분류·세션지정·무시·환불연결·외부대관은 `dues_charges` 미변경(court_external RPC가 bank_transactions만 update 확인) → monthly/court/unpaid 재조회 제거, bankTxns·sessionTxns·txAllocations만. reconcile·대사취소(charge 되돌림)만 refreshMonth(6) 유지. run()에 touchesCharges 플래그로 분기.
- 최종 왕복: 화면전환 0 · **tx처리(분류/세션/무시/환불/외부) 6→3** · charge처리(입금확인/대사취소) 6 · **콜드로드 11→10** · 배분조회 월단위 바운드. 검증: tsc clean, 204 tests, build·lint clean.

---

## #44

**Prompt**: 메인브랜치에서 계속 작업해 (12개 회비 UI/데이터 개선 요청: 탭이름·탭디자인·발송UI·소제목제거·코트막대·미개최세션숨김·0705미납·세션토글통일·회계타이틀·항목표현·인라인검색·정산취소)

**Answer**: 회비 4화면 12개 항목 일괄 개선. 데이터 원인은 DB 조회로 확인 후 수정.

- **탭(1,2)**: 첫 탭 '정모'→'현황', 세그먼티드 컨트롤 디자인.
- **현황(3,4,5,6)**: 미납 발송 목록 패널화+문구 개선('N명에게 미납 안내 보내기'), '정모·정산 상태' 소제목 제거, 코트 수납을 회비처럼 막대그래프로(공용 Meter), 부과·지출·수입 전무 세션(status none)은 숨김.
- **0705 미납(7)**: 원인=세션105에 완납 11건만 있고 미납 4명(이유나·이재원·최두호·우창형) 부과가 아예 없었음 → 그 4명 대관비 6,000 unpaid 부과 DB 생성. 이제 미납 4 표시.
- **미개최 세션 숨김(6)**: 07-04·07-11은 charge·링크tx 전무 확인 → status none 필터로 숨김. 07-05는 미납 있어 표시 유지.
- **정산함(8,11)**: 세션 선택을 회원도 온/오프 토글로 통일(units *2*3 순환·Map 제거→Set, 불필요코드 정리), 회원검색 인풋을 돋보기 자리 인라인으로(같은 라인).
- **회계(9,10,12)**: 항목별정산/거래내역 타이틀 강조(악센트바+16px), '받은/낸,쓴' 문구 제거→통일된 +초록/−빨강 표기(대관료 낸·소비 쓴 구분 없앰), 정산취소 전부 가능(외부대관 IN=cancel_match로 세션태깅 해제, 무시=unignore)+각 줄에 상시 노출(탭 확장 제거).
- 검증: tsc clean, 204 tests, build·lint clean.

---

## #45

**Prompt**: 1. 거래내역에서 취소되는/안되는 차이? 2. 정산함 하단 '이자' 회계로 이동 안했나 확인

**Answer**: 두 질문 원인 규명 + 정산함 무시 섹션 제거.

- **Q1 답**: 회계 거래내역 취소 버튼은 txInfo상 '이미 처리된' 거래에만(배분·분류·세션귀속·환불·무시) 붙고, 아직 정산함에서 처리 안 한 미처리 입출금은 되돌릴 게 없어 안 붙음. 거래내역엔 통장 대사용으로 다 보이지만 처리 전이라 취소 대상 아님.
- **Q2 원인**: '통장 이자'(id72, +55, 07-01)가 status=ignored라 정산함 '무시 N건' 섹션에 노출. 그런데 #44(12번)에서 무시 조회·되돌리기를 회계 거래내역으로 옮겨(무시=unignore 취소) 정산함 무시 섹션이 중복이 됨.
- **수정**: ReconcileInbox에서 무시 섹션·ignored 그룹·duesUnignoreTransaction import 제거 → 정산함은 미처리+부분처리(처리할 것)만. 무시 거래는 회계 거래내역에서 조회·되돌리기.
- 검증: build·lint clean.

---

## #46

**Prompt**: [스크린샷] 여기 보이는 회비들 전부 미처리란 얘기야? 그게 아닐텐데

**Answer**: 처리내역·취소가 안 보이던 것 = 버그. 근본원인 규명·수정.

- **증상**: 회계 거래내역의 7월 회비 입금들이 처리내역(→7월 회비)·취소 버튼 없이 미처리처럼 보임.
- **DB 확인**: 해당 입금들은 실제 matched + 배분(dues_allocations) 1건씩 있음(정상 처리됨). 미처리 아님.
- **근본원인**: `fetchTxAllocations`의 `members(name)` 임베드가 모호(PGRST201) — `dues_allocations`에 members로 가는 FK가 둘(member_id·matched_by)이라 PostgREST가 300 반환 → catch로 빈 객체 → txAllocations 전멸 → 거래내역 note/취소 안 뜸. curl로 HTTP 300 재현 확인.
- **수정**: 임베드에 납부자 FK 명시(`members!dues_allocations_member_id_fkey(name)`) → HTTP 200. 처리된 회비가 '7월 회비' 라벨 + 취소 버튼 정상 표시.
- 검증: curl 200, build·lint clean.

---

## #47

**Prompt**: 1.거래내역 미정산 딤처리 2.환불 워딩 '연결' 제거+후보기준 설명 3.거래내역 키워드/카테고리 필터+스티키 4.환불→[입금자명]+누르면 하이라이트

**Answer**: 회계 거래내역 4개 개선(LedgerView·ReconcileOutRow).

- **(1) 미정산 딤**: note 없는(정산함 미처리) 거래는 opacity 0.45 + '미정산' 표기 → 처리됨과 시각 구분.
- **(2) 워딩**: 정산함 출금행 '차액·오입금 환불 연결'→'차액·오입금 환불'. 환불 후보 기준=입금(IN) 중 카테고리 미지정 & status unmatched/proposed/partial(=돈 남은 입금: 전액 미처리 or 부분배분 잔액).
- **(3) 필터+스티키**: 거래내역에 키워드(적요·처리내역)+카테고리 칩 필터 추가, 헤더+필터 바를 sticky top calc(52px+safe-area)로 스크롤 시 상단 고정.
- **(4) 환불 표시**: 원장 환불 출금 note를 '환불 → [입금자명]'로(연결된 입금 적요), 클릭 시 해당 입금 행으로 스크롤+2초 하이라이트. 역방향: 전액환불된 오입금 입금은 '미정산'이 아니라 '환불 처리됨'으로 표시하고 원출금으로 점프.
- 검증: tsc clean, 204 tests, build·lint clean.

---

## #48

**Prompt**: 정산함 무시 완전 제거 + 환불도 코트대관처럼 하위버튼형으로 통일. 하위메뉴 나오는 항목은 앞정렬·버튼모양 다르게(한뎁스 더 표시). 하드코딩된 특수동작은 항목에서 빼기. 세션/환불 힌트 제거.

**Answer**: 정산함 출금행 재설계 + 무시 기능 완전 삭제.

- **무시 완전 제거**: ReconcileInRow/OutRow의 무시 버튼, ReconcileInbox의 duesIgnoreTransaction, LedgerView의 unignore/ignored 처리, dues.ts wrapper(ignore/unignore) 전부 삭제. DB RPC(dues_ignore/unignore_transaction)도 드롭(마이그레이션, 호출처 0 확인). 현재 ignored 거래 0건이라 데이터 이관 불필요. 불필요 거래는 '기타/이자' 등 카테고리로 분류하면 됨.
- **출금 정산항목 재설계**: '자동반영형'(콕공구·이자·정모·기타 = 채운 칩, 한 번에 반영)과 '하위메뉴형'(코트대관·환불 = 외곽선+`›`/`▾`, 누르면 아래 세션/입금 선택이 한 뎁스 열림)으로 구분. 하위메뉴형을 앞에 정렬·모양 달리해 '한 단계 더 있음'을 표시. 하위 선택지는 좌측 악센트바로 들여쓰기.
- **하드코딩 정리**: 코트대관을 자동반영 칩 목록에서 빼고 전용 하위메뉴 버튼으로(숨은 특수동작→명시적). 환불은 카테고리가 아니라 refund_of_tx_id 처리라 항목에 하위메뉴형으로만 노출.
- **힌트 제거**: '어느 날 대관인지 고르세요' 등 제거.
- ReconcileInRow '회비 아님' 분류 칩에서 코트대관 제외(입금 수입엔 부적합).
- 검증: tsc clean, 204 tests, build·lint clean, RPC 드롭 배포.

---

## #49

**Prompt**: 개념 혼용 정리 — 코트대관은 카테고리, 환불은 아님인데 정산함(입금엔 안 보이고 출금만)·회계필터에서 취급이 꼬임. 코트대관·환불을 '미리정의된' 항목 취급하고 DB 코트대관 카테고리 제거. 필터에 코트대관·환불 추가. 입금행 텍스트 제거. 출금행을 입금행처럼 상단 버튼→하단변경→확인. (논리검증 후 구현)

**Answer**: 논리검증(환불=출금전용/코트대관=session식별 시 미배정상태 사라짐) 후 사용자 확답(코트대관 완전제거·출금 선택후확인·환불은 출금행 내 하단변경) 받아 개념 통일.

- **개념 통일**: 항목 = 코트대관(session_id) · 환불(refund_of_tx_id) · 카테고리(category_id) · 회비(배분)로 분리. **코트대관 DB 카테고리 완전 제거**(마이그레이션: 쓰던 3건 category_id null화[세션연결분은 세션으로, 미연결 −45,000은 미정산 복귀] 후 삭제). dues_public_ledger에서 court-cat 특수처리 제거(세션 기반만).
- **출금행(ReconcileOutRow) 재작성**: 상단 정산항목 칩(코트대관›·환불›=외곽선/앞정렬, 콕공구·이자·정모·기타=채운칩) 선택 → 하단 내용 변경(세션/입금후보) → **[확인]으로 정산**(입금행과 동일 구조). court=setTxnSession(카테고리 없음)·refund=duesLinkRefund·category=setTxnCategory.
- **회계 필터**: 코트대관(session_id)·환불(refund_of_tx_id) 칩 추가.
- **집계 통일**: LedgerView에서 courtCatId 제거, session_id 있는 거래는 세션순액으로만(카테고리/미분류 이중계상 방지), '세션 안 정한 코트비'(courtUnassignedOut) 개념 제거. txInfo/취소도 session 기반(코트대관 취소=setTxnSession null).
- **입금행**: '회비 아님'·'낼 항목을 골라 처리하세요' 텍스트 제거.
- 검증: tsc clean, 204 tests, build·lint clean, 공개회계 스모크 정상(income 637055/expense 532300), 마이그레이션 배포.

---

## #50

**Prompt**: 출금에서 기타·이자는 선택버튼보다 아래로(전부 위로 올리지 말고), 코트대관 디폴트 선택, 눌렀을때 나오는 버튼 디자인 입금행과 통일.

**Answer**: ReconcileOutRow 레이아웃·기본값·칩 통일.

- **카테고리 아래로**: 상단=코트대관·환불(하위메뉴형 stepChip), 그 아래 하위 선택지(세션/입금), 맨 아래 '그 외' 카테고리(콕공구·이자·정모·기타). 전부 위에 몰던 것 정리.
- **코트대관 기본 선택**: 초기 sel={kind:'court'} → 세션 선택지가 바로 노출(대부분 출금이 대관료).
- **하위버튼 디자인 통일**: 세션·입금·카테고리 선택 칩을 입금행 항목 칩과 동일 스타일(초록틴트 on/회색 off, ✓)로. 코트대관·환불만 외곽선+`›`/`▾`(한 뎁스 표시) 유지.
- 검증: build·lint clean.

---

## #51

**Prompt**: 입금 처리 빠진 기능 2개: 1)한 명이 다른 사람(게스트 포함) 돈까지 낼 때 — 사람을 검색·추가하면 그 사람 미납 칩도 추가(다른 세션일 수 있음), x로 제거 가능. 2)어떤 칩은 앞에 + 있고 어떤 건 없음 — 이유 확인·통일.

**Answer**: 대납(멀티 인원) + 칩 접두 통일.

- **점2 원인·수정**: itemChip이 off일 때 '＋'(추가) 접두를 붙였는데 납부자·카테고리 칩엔 없어 불일치. '＋' 제거 → "선택 시 ✓, 아니면 없음"으로 통일(출금행 pickChip과 동일).
- **점1 대납 구현**: ReconcileInRow에 extraIds(함께 낼 사람) 추가. 납부자 지정 후 검색하면 '함께 낼 사람'으로 추가되고(첫 선택=납부자, 이후=대납 대상), 그 사람들의 미납 부과가 '{이름} · 라벨 금액' 칩으로 항목에 합류. × 로 제거(선택 해제 포함). 게스트도 추가 가능(members에 게스트 포함). 합계·확인은 선택된 전체 charge_ids로 — dues_confirm_reconcile은 소유자 무관 배분(member_id=납부자)이라 백엔드 변경 불필요.
- 검증: tsc clean, 204 tests, build·lint clean.

---

## #52

**Prompt**: '다른 사람' 텍스트 대신 다른 걸로. 대납 뱃지가 납부자 줄에 계속 붙어 헷갈리니 영역 분리.

**Answer**: 대납 UI 영역 분리 + 문구 교체.

- **영역 분리**: 검색 상태를 searchOpen(bool)→searchFor('payer'|'extra'). 납부자 줄은 납부자 칩+🔍만. 그 아래 별도 점선 박스 '함께 낼 사람' 영역에 대납 뱃지(× 제거)와 '＋ 추가' 버튼·검색을 둠. 납부자/대납 검색이 각 영역에서 독립.
- **문구**: '🔍 다른 사람' 버튼 텍스트 제거 → 영역 라벨 '함께 낼 사람' + '＋ 추가' 버튼으로.
- 검증: build·lint clean.

---

## #53

**Prompt**: [스크린샷] 칩 앞에 이름 붙이는 방식 말고 애초에 구분을 지어라. 칩에 이상한 조건 넣어 다르게 보이면 헷갈림.

**Answer**: 대납 항목을 이름 접두 대신 사람별 그룹으로 분리.

- extraCharges(이름 접두 방식) → extraGroups(사람별 {id,name,charges}). 항목 영역을 '납부자 그룹 + 대납자별 그룹'으로 렌더: 각 그룹에 이름 헤더(대납 있을 때만) + 그 사람 칩. 칩 라벨엔 이름 안 붙임(그룹 헤더로 구분). chargeChip 헬퍼로 통일. 대납 없으면 기존처럼 헤더 없이 납부자 칩만.
- 검증: tsc clean, build·lint clean.

---

## #54

**Prompt**: 함께 낼 사람 박스 대신, 사람 검색 돋보기가 사람 지정되면 ＋로 바뀌고 누르면 사람 추가. 디자인 안 튀게 기존과 통일.

**Answer**: 별도 박스 제거, 검색 버튼 🔍↔＋ 겸용.

- 대납용 점선 '함께 낼 사람' 박스 삭제. searchFor→searchOpen(단일)로 되돌리고, 납부자 줄의 검색 버튼을 납부자 없으면 🔍(납부자 지정)·있으면 ＋(대납 추가)로. 같은 회색 원형 버튼이라 튀지 않음(lucide Plus).
- 추가된 대납 대상은 항목 영역의 사람별 그룹으로 표시되고, 그룹 이름 헤더의 ×로 제거. 별도 뱃지 UI 없이 통일.
- 검증: tsc clean, 204 tests, build·lint clean.

---

## #55

**Prompt**: 1)환불 전체/일부 구분 — 일부환불이면 둘다 정산처리 말고 금액 마이너스 처리하고 입금은 미정산으로. 2)회계 거래내역 필터: 코트대관→세션, 회비 필터 추가, 환불 필터는 환불+링크된 입금도.

**Answer**: 부분 환불 처리 + 회계 필터 개편.

- **부분 환불(요청1)**: dues_sync_bank_tx 규칙 변경 — 배분+환불 ≥ 입금이면 matched, 배분 있으면 partial, 없으면 unmatched. 즉 부분환불(배분 없음)이면 입금은 미정산 유지. dues_confirm_reconcile의 거래잔여 txrem에서 환불분 차감(환불된 만큼 배분 못 함). 프론트: ReconcileInbox가 입금별 환불합(refundedByIn) 계산→ReconcileInRow에 refunded 전달, 실효금액=입금−환불로 프리셀렉트·불일치·비회원대관·확인 라벨 계산, 헤더에 '환불 −X · 대상 Y' 표기. 마이그레이션 배포.
- **회계 필터(요청2)**: 코트대관→세션(session_id), 회비 필터 추가(배분 라벨 key 'a-회비'), 환불 필터는 환불 출금 + 그 환불이 링크된 입금(refundOutByIn) 둘 다. 원장 txInfo: 부분환불(unmatched) 입금은 '환불 처리됨' 아니라 미정산으로(전액환불 matched일 때만 표기).
- 검증: tsc clean, 204 tests, build·lint clean, 마이그레이션 배포.

---

## #56

**Prompt**: 1)회계 필터를 '세션' 단일 대신 세션별(7.12 TK…)로. 2)입/출금 카드 디자인 통일, 구분선 있는 게 좋음. (3)회비 이월은 후속.

**Answer**: 회계 세션별 필터 + 출금 카드 구분선.

- **세션별 필터(1)**: catFilter를 문자열 키(null/fee/refund/cat:{id}/sess:{id})로 리팩터. 그 달 세션마다 '7.12 TK…' 필터 칩 추가(session_id 일치), 단일 '세션' 칩 제거.
- **구분선 통일(2)**: 출금 카드(ReconcileOutRow) 확인 버튼 위에 입금 카드와 동일한 구분선(borderTop) 추가.
- 검증: build·lint clean.

---

## #57

**Prompt**: (요청3) 회비 이월 기능 — 7월 회비 이월하면 7월엔 안 보이고 낸것처럼, 8월엔 미정산 노출. 8월에서 수동 정산=미납 해제만(금액 기록X), 이월 취소 가능.

**Answer**: 회비 이월(carry-over) 구현.

- **스키마/RPC**: dues_charges.deferred_to(YYYY-MM) 추가. dues_defer_charge(다음 달로 이월), dues_undefer_charge(취소→unpaid 원복), dues_settle_deferred(수동 정산=status waived, 금액 기록X → phantom 수입 없음). 마이그레이션 배포.
- **데이터**: MonthlyChargeRow에 periodYm·deferredTo. fetchMonthlyCharges(ym)=원 월(period_ym=ym)+이월돼 온 것(deferred_to=ym). wrapper 3종.
- **현황(SessionsHome)**: 회비 진행에서 원 월 기준, deferred는 '낸 것처럼' 해결 카운트. 미납 회원 각 행에 '이월' 버튼. 그 아래 '이월된 회비' 섹션(지난달→이번달 미정산)에 [정산][취소]. MemberToggleList 행을 div로 재구성(중첩버튼 방지)+onDefer.
- 검증: tsc clean, 204 tests, build·lint clean, 컬럼·RPC 배포 확인. (MyDuesPage 이월 표시는 후속.)

---

## #58

**Prompt**: 거래내역 min-height, 필터 순서 전체/회비/세션/환불/[항목], 세션은 열린 경기만(공통로직), 세션 필터가 출금만 잡히는데 입금도 잡히게.

**Answer**: 회계 거래내역 필터 4개 개선.

- **입금도 세션 필터에**: fetchTxAllocations가 배분된 대관 부과의 session_id를 모아 TxAllocation.sessionIds로 반환. 세션 필터 predicate=`t.sessionId===sid || txAllocations[t.id].sessionIds.includes(sid)` → 대관 지출(출금)+비회원 수입(입금)+회원 대관비 납부(입금) 모두 잡힘.
- **열린 세션만(공통 헬퍼)**: duesText.activeSessionIds(txns, txAllocations)=활동(직접 링크+배분) 있는 세션 id 집합. 세션 필터 칩을 이걸로 필터(활동 없는 07-04·07-11 제외). 공통 로직으로 분리.
- **필터 순서**: 전체 / 회비 / [열린 세션들] / 환불 / [카테고리].
- **min-height**: 거래내역 리스트 래퍼 minHeight 360(필터 시 높이 흔들림 방지).
- 검증: tsc clean, 204 tests, build·lint clean.

---

## #59

**Prompt**: [스크린샷] 정산함 입금 카드 세션 후보에 아직 07-04·07-11이 보임 — '열린 경기만' 여기도 적용.

**Answer**: '열린 세션' 정의를 부과 기반으로 바꿔 정산함·회계 공통 적용.

- 원인: '열린 경기' 필터가 회계에만 적용됐고, 정산함 ReconcileInRow의 세션 후보(monthSessions)엔 미적용. 또 07-04·07-11은 status=closed지만 대관 부과 0이라 status로는 못 거름.
- 공통 헬퍼 activeSessionIds(당월 거래 기반)→ heldSessionIds(court, sessionTxns): 대관 부과가 있거나 은행 거래가 링크된 세션 = 열린 경기(status 무관, cancelled+dues_include여도 부과 있으면 포함).
- ReconcileInbox가 heldSessionIds로 monthSessions 필터→ReconcileInRow에 전달(07-04·07-11 제외). LedgerView도 동일 헬퍼로 통일.
- 검증: 7월 실데이터 held={105(07-05),104(07-12)}, 후보 4개 중 2개만 노출. tsc clean, 204 tests, build·lint clean.

---

## #60

**Prompt**: 환불 메뉴 선택 시 가격 똑같은 입금 후보 있으면 자동 선택되게.

**Answer**: ReconcileOutRow 환불 칩 클릭 시 refundTargets 중 amount===출금액인 후보를 refundSel로 기본 선택(없으면 null). 전액 환불 케이스 원탭.

---

## #61

**Prompt**: 지금 일정시간 지났는데 세션열려있네 이유확인해봐 / 정시 종료 말고 한시간 유예두자

**Answer**: 예정 시간이 지났는데 세션이 열려있던 원인을 진단하고 근본 수정. 원인 분석:
- 자동 종료(sync A단계)는 status in ('draft','open')만 대상이라 active(진행중)는 절대 닫지 않음. active→closed 전환은 관리자 수동 종료 또는 다음 세션 시작(단일-active 불변식) 때만 발생.
- 홈 목록(visibleSchedules)도 active는 ends_at 지나도 유지 → 종료된 세션이 "진행중"으로 영구 노출.
- 실제 범인은 세션 77(7/14 정모): 18:24 수동 시작 후 21:00 종료 예정이 지나고 날짜까지 바뀌었는데 active로 잔존.

조치:
- 세션 77을 DB에서 즉시 종료(closed/is_active=false, ended_at=예정 종료시각).
- cron 상향(주1회→매시간) 방식 마이그레이션을 작성했다가, 사용자 요청으로 폐기하고 프론트 방식으로 전환.
- scheduleActions.load()에 closeEndedActiveIfAdmin 추가: 운영진(isAdmin) 진입 시 ends_at + 1시간 유예가 지난 active 세션을 서버에 종료 요청(dbEndSession)하고 로컬 목록에서 제거. 일반 회원 접속으로는 안 닫힘.
- 정시 종료 대신 1시간 유예(ACTIVE_CLOSE_GRACE_MS)를 둬 예정 종료를 조금 넘겨 진행하는 세션의 조기 종료 방지.

---

## #61

**Prompt**: [스크린샷] 출금 카드에 또 안 열린 세션 칩이 보임 — 근본 문제를 찾아.

**Answer**: 세션 목록 원천 쿼리를 '경기기록 있음' 기준으로 통일(근본 수정).

- 근본원인: queryCourtSessions가 status(active/closed)만 보고 matches(경기기록) 유무를 안 봐서, 경기 0건 무산 세션(6/27·6/28·7/4·7/11 등, 데이터로 확인)이 monthSessions·ledgerSessions에 섞여 IN/OUT 카드·필터·현황 곳곳에 노출. generate는 has-matches를 실제 세션 기준으로 쓰는데 UI 쿼리만 안 맞췄음. dues_include 세션은 0개라 그 조건도 불필요.
- 수정: queryCourtSessions에 matches!inner(id) + status in(active,closed) → 경기기록 있는 대관 세션만 반환(REST 200 검증). 이 단일 원천을 monthSessions·ledgerSessions가 공유하므로 모든 목록 일괄 정합.
- 정리: 흩어진 heldSessionIds(court·sessionTxns) 헬퍼·ReconcileInbox 필터·LedgerView activeSess 제거(원천이 이미 깨끗).
- 검증: tsc clean, 204 tests, build·lint clean.

---

## #62

**Prompt**: [스크린샷] 회비 이월기능인 것 같은데 UX적으로 더 납득되는 방향 고민해.

**Answer**: ↩ 표식은 이월이 아니라 '크로스먼스'였음 — 혼동 제거.

- 규명: 입금 카드의 '2026-07 회비 5,000 ↩'에서 ↩는 이월(carry-over)이 아니라 '부과 월 ≠ 입금 월' 표식. 아이콘이 되돌리기/이월처럼 보여 혼동 + 라벨 형식 불일치('2026-07 회비' vs '6월 회비').
- 수정: unpaidLabel 회비를 'N월 회비'로 통일(거래내역·신규회비 칩과 동일). ReconcileInRow chargeChip의 크립틱한 ↩ 제거 — 입금 날짜는 카드 상단에 있고 월은 라벨로 자명하니 별도 표식 불필요.
- (진짜 이월 기능은 현황 탭 [이월] 버튼으로 별개 유지.)
- 검증: tsc/build/lint clean, 204 tests.

---
