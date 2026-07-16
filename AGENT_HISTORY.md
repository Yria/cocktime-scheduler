# Branch: main

## #1

**Prompt**: 디비쿼리를 직접하면 테이블구조를 예측할수 있잖아 이것들 함수로 못바꿈?

**Answer**: `.from()` 직접 쿼리를 `.rpc()` 함수로 바꿔 테이블 구조를 숨기자는 제안을 4개 관점(직접접근·RPC·RLS·위협모델) 병렬 감사 후 기각. security-through-obscurity라 효과가 사실상 0이기 때문:
- 테이블명은 이미 번들에 문자열로 노출(`"members"`,`"sessions"` 등)되고, `.rpc()`로 바꿔도 함수명·인자명이 똑같이 노출됨.
- PostgREST가 `/rest/v1/` OpenAPI 스키마를 role 권한 기준으로 자동 공개 → `.from` vs `.rpc` 무관.
- `enable_signup=true`라 누구나 가입해 `authenticated` role로 introspection 가능.

진짜 보안 경계는 RLS이며 대체로 잘 되어 있으나(읽기 DB레벨 로그인 게이팅, 쓰기 60개 SECURITY DEFINER RPC 내부 is_admin 검사), **진짜 구멍**을 발견: Phase 9에서 sessions/session_players만 잠그고 `matches`·`pair_history`는 부트스트랩 `anon_all(FOR ALL USING(true))` 정책이 남아 비로그인 anon 키만으로 전체 CRUD(스코어 조작·테이블 삭제·추천 오염) 가능한 HIGH 갭.
- `20260713140000`(sessions 잠금)과 동일 패턴 마이그레이션 `20260715090000` 작성: anon_all 제거 + `select to authenticated` / `for all using(is_admin())` 적용.
- `supabase db push`로 배포 완료(미적용 건 이것 하나뿐). 앱 write는 전부 SECURITY DEFINER RPC 경유라 무영향.
- anon 키 REST 직접 호출로 검증: matches/pair_history SELECT→`[]`, matches INSERT→`401 (42501 RLS violation)` 확인. 구멍 폐쇄 확정.

---

## #2

**Prompt**: 회원관리 페이지에 프로필 사진 나오게해줘

**Answer**: 회원관리 리스트 행(`MemberAdminRow`) 맨 앞에 프로필 사진(44px)을 추가. 별도 신규 구현 없이 기존 공용 컴포넌트 `PlayerAvatar`를 재사용:
- 사진 URL은 이름 md5 해시 기반 원격(`player-photos` 버킷), 로드 실패 시 성별색 이니셜로 폴백. 게스트(`isGuest`)는 동명 회원 사진 오매칭 방지를 위해 항상 이니셜만.
- `AdminMemberRow` 타입에 `name`·`gender`·`isGuest`가 이미 있어 데이터 계층(`adminMembers.ts`) 변경 불필요.
- 68px 행에 정보 버튼 앞 sibling으로 삽입(`gap:8`이 간격 처리, `flexShrink:0`).
- 검증: `tsc -b` + `vite build` 통과. 단, 회원관리 화면은 OAuth 로그인+운영진 권한 게이팅이라 헤드리스에서 인증 화면 자동 구동 검증은 불가(컴포넌트 재사용·타입·빌드로 확인).

---

## #3

**Prompt**: 회원관리안에서만 사진누르면 큰 사진으로 볼 수 있게 해줘

**Answer**: 회원관리에서 아바타를 탭하면 큰 프로필 사진을 보는 라이트박스 모달을 추가. "회원관리 안에서만" 요구라 전역 `PlayerAvatar`는 건드리지 않고 클릭 배선을 회원관리 쪽에만 국한:
- 신규 `MemberPhotoModal` 컴포넌트 — 기존 공용 `ModalSheet`(center 배치·백드롭/Escape 닫기·스크롤락 내장) 재사용. 사진은 전체가 보이도록 `objectFit:contain`으로 크게, 로드 실패/게스트/이름없음이면 큰 이니셜 `PlayerAvatar`로 폴백. 딤·사진·이름 어디를 탭해도 닫힘.
- `MemberAdminRow`: 아바타를 `onOpenPhoto(member)` 호출 버튼으로 감쌈(정보 버튼과 분리된 형제라 실력 편집과 충돌 없음).
- `MemberAdminPage`: `photoMember` 상태 추가, 행에 `onOpenPhoto={setPhotoMember}` 전달, 기존 모달들 옆에 `MemberPhotoModal` 렌더.
- 검증: `tsc -b`·`vite build` 통과, eslint 에러 0(경고 1건은 기존 useVirtualizer 무관). OAuth 게이팅으로 인증 화면 자동 검증은 불가.

---

## #4

**Prompt**: 그냥 세션끝날때까지 열되, 2/3 이후 지점에 입장하면 완전늦참 알림, 자리있으면 받고 없으면대기 다이얼로그 띄워줘 확인누르면 참여되게.

**Answer**: "운영진이 '경기 시작'을 누르면(active) 참여 버튼이 사라진다"가 실제 증상임을 코드 추적으로 확정(open→ends_at까지 열림, active→즉시 '모집 마감'). 요구를 반영해 **진행중(active) 세션도 종료(ends_at) 전까지 참여 허용**, 2/3 지점 이후 입장은 확인 다이얼로그로 안내하도록 구현. 접수 규칙은 기존 그대로(정원 여유=확정/초과=대기), 특별 late_pool(정원 외)로는 넣지 않음(사용자 선택).
- 서버 `join_session` 재정의(마이그레이션 `20260715100000`): status 게이트 `open`→`open|active`, active·confirmed 접수 시 members 스냅샷을 `session_players(waiting)`에 insert(브릿지 `start_session_from_schedule`와 동일, grade 5 기본, on-conflict 멱등) → 보드 명단 실시간 반영. 종료 가드·confirmed/waitlist 로직은 불변. add_guest_attendance는 범위 밖.
- `Home`: `joinable`(open|active·종료 전, 서버 가드와 동일 기준) + `lateJoin`(2/3=`latePoolCutoffMs` 이후) 계산해 ScheduleCard에 전달.
- `ScheduleCard`: open/active 통합, 미참석·joinable이면 "참석하기"(종료 전까지), 탭 시 `lateJoin`이면 "완전 늦참으로 참여할까요?"(자리 있으면 참여·없으면 대기) ConfirmDialog→확인 시 onJoin, 아니면 바로 onJoin.
- 근거: 보드는 sessionChannels가 `session_players` INSERT를 "선수 추가"로 실시간 전파하도록 이미 설계돼 있어 active 중 반영이 안전. 검증 tsc/build/eslint 통과, 인증 실화면 자동 구동은 OAuth 게이팅으로 불가.

---

## #5

**Prompt**: 오케이 이해했어. 그럼 새로운 기능을 개발하고싶어. 이번주 열린 일정에 미리 사람들이 대관비를 낸게 있는데 이것도 정산하고싶어. 대관이 물론 취소될 수 있지만 그거까지 고려해서 짜려면 복잡할거같고, 그런상황이 생기면 사용자가 수동으로 정산하고 취소시키던지 할테니까 이번주 열릴 일정도 선택할 칩이 나오게 할 수 있나? 물론 위에 말한것처럼 참가한것만 나와야지

**Answer**: 정산함 입금 처리에서 "참가 예정(open) 세션의 선납 대관비"를 정산하는 기능을 프론트만으로 구현(백엔드 RPC/DB 무변경). 4갈래 병렬 조사로 타당성 먼저 검증 — 핵심은 "미래 세션에 대관비를 미리 만들어도 self-heal DELETE·종료 트리거 UPSERT가 모두 `amount_paid=0` 게이트라 선납분은 보존·무손상"이라는 안전성 확인. 세션 취소는 사용자 수동 정리(합의), 하드 삭제는 입금이 미정산으로 안전 복귀하되 조용하므로 경고 가드만 추가.
- `fetchUpcomingParticipating`: status='open' + 대관장소(court_fee_per_hour) + 참가자(confirmed/late_pool) + 기부과회원(court_fee, 완납 포함) 임베드. now 기준(선택 월 무관).
- `ReconcileInRow.myUpcoming`: 그 납부자가 참가자면서 아직 대관비 미부과인 세션만 "대관비(예정)" 칩으로. 기존 active.sessions Set 재사용해 합계·확정 배선 자동 반영.
- 삭제 가드(`useOccurrenceForm`): 일회성 하드삭제 시 선납 건수 경고, 반복 회차는 cancelled 텀스톤이라 스킵.
- 적대적 코드리뷰로 버그 2건 확정·수정: ①완납 세션 재노출 → chargedMemberIds로 제외 + refreshMonth 갱신, ②삭제 가드 async 창 이중클릭 → useRef 동기 가드. tsc/eslint/테스트(24)/빌드 통과.

---

## #6

**Prompt**: 항목별 정산에 환불은 나와도 의미가 없음 쁠마0이 되어야하는데 마이너스만 나와서 이상, 환불된건은 미분류로 나와서 더 이상. 정상적으로 환불이 되면 0이라 좋고 이상하면 미분류로 남으니까 트래킹하면됨.

정산함 필터에 전체 입금 출금 외에 가격필터도 추가. equal만 보이면됨

**Answer**: 두 가지 구현. ①항목별 정산에서 연결된 환불(refund_of_tx_id)을 소스 입금과 상쇄 — 정상 전액환불이면 그 입금이 실효 0이 되어 어디에도 안 뜨고(±0), 부분/미스매치 잔액만 미분류에 남아 추적 가능. 소스가 이 달에 없는(크로스먼스) 환불만 '환불' 잔여 라인. ②정산함에 금액 완전일치(equal) 필터 추가.
- 관리자 `LedgerBreakdown`(클라 계산): refundByIn 맵으로 입금별 연결환불 합산 후 eff=입금−환불로 버킷팅, 환불 출금은 스킵. 과다환불로 미분류가 음수 될 수 있어 조건 `!==0`+NetAmount로 표시. 현금주의 불변식(버킷 합=남은 돈) 유지 검증.
- 회원 `dues_public_ledger`(마이그레이션): 이 달 미분류 입금 대상 환불을 v_refund_net으로 상쇄, uncat_in에서 차감·refund에서 차감(양쪽 상쇄로 불변식 보존).
- `ReconcileInbox`: 금액 완전일치 필터(number input + 지우기), filteredPending에 `t.amount===n` 결합.
- 적대적 리뷰로 버그 2건 확정·수정: ①(HIGH) 회원 `MyLedgerTab`도 미분류 조건 `>0`→`!==0`로(음수 uncat_in 누락=불변식 붕괴 방지), empty 판정도 동반 수정. ②(LOW) 금액 파싱 자릿수추출→`Number()` 직접(6000.5→60005 오매칭 방지). ACCOUNTING_SPEC §3.2·3.3 갱신. tsc/eslint/테스트/빌드 통과.

---

## #7

**Prompt**: 한사람이 두명분 내는 상황에서 토글배지가 안나와. 저거 배지필터하는 로직이 분산되어있으면 최대한 하나로 통일해 (+ 세션109 대관비 라벨을 날짜·장소로, 현황에도 반영하되 예정 세션은 진행률 대신 몇 명 냈는지로 / 다 끝나면 커밋·배포)

**Answer**: 정산함 대납 대상이 미납만 보이고 예정/신규 세션 칩이 안 뜨던 문제를 해결. 분산돼 있던 배지 필터(납부자=existing+newSession+myUpcoming, 대납=미납만)를 `people` 배열 한 로직으로 통일해 납부자·대납 대상 모두 동일하게 기존미납+신규세션+참가예정 칩 노출. 회비는 개인 귀속이라 납부자 전용 유지.
- RPC `dues_confirm_reconcile` §③: `p_sessions[].member` 추가(미지정=납부자, 시그니처 불변=하위호환). 대상 회원 앞으로 court_fee 생성(payer_hint=대상 게스트면 invited_by), 배분 member_id는 납부자. 배포는 DB 먼저(구 프론트 안전).
- `ReconcileInRow`: `Sel.sessions`를 `Set<'memberId:sessionId'>`로, toggle/doConfirm/removeExtra 회원 인식. preselect는 납부자 미납 기준 유지.
- `LedgerBreakdown`: 라벨 소스에 upcomingSessions 병합 → 선납된 미개장 세션이 "세션 #109" 대신 "7.19 …"로.
- `SessionsHome`: 예정(선납) 세션 카드 추가 — 부과 미생성이라 진행률 대신 "N명 선납" 표시.
- 검증 tsc/eslint/테스트/빌드 통과. 적대적 리뷰 워크플로우는 세션 한도로 미실행 → 핵심(RPC 하위호환·키 파싱·dedup·prune·합계·라벨 병합) 수동 검토. 불참·환불 시 부과 처리는 별도 안내(환불연결 가드+취소 순서).

---

## #8

**Prompt**: a가자 (불참·환불 후 남는 유령 미납 부과 자동 정리 = 옵션 A)

**Answer**: 세션 종료 시 자동부과(`dues_generate_session_court`)가 자격 세션에서도 **참석 자격 없는(불참·사전취소·운영진) 회원의 미납 대관비를 정리**하도록 추가. 기존엔 무산 세션 분기에서만 미납을 지워서, 선납 후 참가 취소·환불(취소·재처리로 미납 복귀)한 사람의 유령 미납 부과가 세션이 열려도 계속 남았음.
- INSERT의 자격 조건(confirmed/late_pool/당일취소·비운영진)과 동일한 `not exists(attendances)` 판정으로 비대상 회원을 가려 `amount_paid=0`만 삭제. 선납(완납, `amount_paid>0`)은 보존(환불 절차로 처리).
- 마이그레이션 create-or-replace(시그니처·grant 불변). ACCOUNTING_SPEC §4 대관비 룰 갱신.

---

## #9

**Prompt**: 리뷰해

**Answer**: 대납 통합·RPC 2건·라벨·현황 변경(29d276b..HEAD)을 적대적 리뷰(3축→검증). 확정 1건(LOW) 수정.
- **SessionsHome 예정 카드 오분류**: 선납됐는데 세션이 취소·무산(경기기록 없음)이면 monthSessions·upcomingSessions 어디에도 없어 "예정 · 종료 후 부과 생성"으로 오표기(실제론 선납금 묶여 환불 필요). `upcoming = !!upcomingById.get(sid)`로 open 세션만 진짜 '예정', 나머지는 **"확인 필요 · 세션 미개장·취소 — 환불 확인"**(주황)으로 → 오해 대신 환불 대상 노출.
- RPC·통합 로직·라벨 병합은 리뷰 반박(문제 없음) 확인. tsc/eslint/빌드 통과.

---

## #10

**Prompt**: 1. 유령부과있는지 확인 2. 정산함 검색강화(키워드로 입금자명·금액 둘다, 초성까지) 3. 납부자 검색 초성 4. 정산 확인 후 목록 새로고침 지나치게 오래걸림 원인분석

**Answer**: 4가지 처리. 서비스키로 프로덕션 진단 쿼리를 돌려 원인을 실측·확인.
- **①유령부과**: 진짜 유령(사전취소 후 남은 부과) = **0건**. 초기 판정("참석기록 없으면 유령")은 오탐이었음 — 세션#166은 attendances 0건인데 court_fee 15건(수동정산)인 정상 세션. **이 과정에서 옵션-A(20260716030000)의 잠재 버그 발견**: '참석 자격 없음=삭제'가 attendances 없는 세션의 정상 미납(이유나 #799)을 재생성 시 오삭제. → 조건을 **'사전취소(당일취소 아님) attendance가 있는 회원만'**으로 좁힌 마이그레이션(20260716040000) 배포.
- **②정산함 검색**: 금액 필터 → 입금자명(부분·초성)+금액(완전일치) 통합 검색. `matching.ts`에 `chosungOf`·`nameMatches`(초성) 추가.
- **③납부자 검색**: `searchResults`를 nameMatches로 → 초성 검색.
- **④새로고침 지연**: 실측 결과 쿼리 전부 빠름(25~98ms), 푸시 pg_net 비동기, is_admin STABLE(행당 아님) → 서버 병목 아님. 원인 = 확정 RPC + refreshMonth 2웨이브 왕복 동안 확정 행이 목록에 남아 모바일 체감 지연. → **낙관적 숨김**(RPC 성공 즉시 그 행 hide, refreshMonth는 백그라운드)로 체감 제거.
- 초성 테스트 6건 추가(총 30 통과). tsc/eslint/빌드 통과.

---

## #11

**Prompt**: 정산칩 선택하고 확인 누른 시점 쿼리도 오래걸리는것같아

**Answer**: 확인 RPC 자체를 실측(서비스키). 결과: 서버는 빠름 — forbidden fast-fail ~40ms, dues_public_ledger RPC ~50-70ms, 단순 select ~37ms(제 PC 기준). 확인 RPC가 쓰는 테이블 트리거(alloc-sync 집계·notification trim 범위삭제·push는 Vault 2읽기+pg_net 비동기, BEGIN/EXCEPTION 격리)도 전부 가벼움 → **서버 병목 아님, 모바일 네트워크 왕복이 원인**.
- 직전(#10)엔 낙관적 숨김을 RPC 응답 '후'에 해서 RPC 왕복 동안 행이 남아 느리게 체감. → 낙관적 숨김을 **버튼 누른 즉시(RPC 전)**로 이동, 실패 시 행 복원. 네트워크 대기 체감 제거.
- 프론트만 변경. tsc/eslint/빌드 통과.

---

## #12

**Prompt**: 칩 목록 가져오고 디폴트 선택하는 로직을 하나만 쓰게 해서 전부 공용으로. 어쩔땐 칩이 안보이고 어쩔땐 디폴트가 안되고… 확인해봐

**Answer**: 근본원인 = 칩 표시(people: 각자 existing/newSessions/upcoming)와 디폴트 선택(preselect: 납부자 existing court/monthly만 별도 파생)이 **완전히 분리**돼 불일치(예정/신규 칩 보여도 디폴트 안 잡힘). → **단일 `ChipItem` 모델**로 통합.
- people가 각 사람 items:ChipItem[](기존미납·신규회비·신규세션·예정)을 한 번에 생성. 선택상태 = override:Set<string>|null, selected = override ?? defaultKeys. 키: charge:{id}/monthly/session:{member}:{sid}. itemByKey로 합계·확정 분해.
- defaultKeys를 **같은 items에서 파생**: 금액=회비+k대관 매칭, 대관 풀에 기존미납+참가확정 예정 포함(poolRank 0/1/2) → 선납(예정)도 디폴트 잡힘. 신규 월세션은 자동선택 제외(참석필터 없음, 수동).
- 토글/제거/확정/합계 전부 키 기반 단일 경로. chargeChip·toggleCharge/Monthly/Session 제거.
- 적대적 리뷰 확정 1건 수정(medium): 디폴트 회비가 이전 달 미납을 잘못 선택 → charge item에 ym 실어 `role==='monthly' && ym===depositYm`로 입금월 스코프(원래 동작 복원). doConfirm은 chargeId 분기 우선이라 안전.
- tsc/eslint/테스트(30)/빌드 통과.

---

## #13

**Prompt**: 영민은 디폴트 되는데 홍희는 안되는데? (사람 인풋→칩목록·디폴트 아웃풋 함수로 동일하게 한 것 아니냐) + 여러명 낼 때 영민 오른쪽에 홍희 버블(x 여기에) 있게

**Answer**: 통합했다지만 디폴트가 여전히 납부자(payer.items)만 봐서 대납 대상(홍희)은 자동선택 안 됐음. 두 가지 수정.
- **디폴트 대관 풀을 전원(납부자+대납)으로 확장**: `courtPool = people.flatMap(items).filter(court && autoDefault)`. 12,000 입금(k=2)이면 영민 7.19 + 홍희 7.19 둘 다 자동선택 → 대상 일치. 회비는 개인 귀속이라 납부자+입금월 스코프 유지. 적대적 리뷰 클린(확정 0).
- **대납 버블 UI**: 납부자 행에 대납 대상을 초록 버블(× 포함)로 납부자 옆에 표시, 제거 ×를 여기로 이동. 아래 그룹 헤더의 ×는 제거(이름만). 후보 칩은 대납과 중복 제거(filter).
- tsc/eslint/빌드 통과.

---
