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
