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
