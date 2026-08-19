# TODO

## 남은 것

1. **게스트 잔재 47행 → 실인원 30명 병합** — 2026-08-19 배포로 **증가는 멈췄다**(`add_guest_attendance` 가
   이름+성별 같은 기존 게스트 행을 재사용). 이미 쌓인 잉여 17행은 그대로 남아 정산함 납부자 후보에
   섞인다(후보 위생 규칙이 동명 그룹을 대표 1행으로 접어 화면상 오염은 가려진 상태).
   병합을 하려면 결정이 필요하다:
   - 같은 세션에 잔재 두 행이 모두 참석해 있는 사례(session 103 김지훈×2, 114 공태호×2) → `attendances`
     PK `(session_id, member_id)` 충돌. 어느 행을 버릴지는 회계를 봐야 정해진다.
   - `dues_charges`·`dues_allocations` 가 member_id 에 매달려 있어 병합은 **과거 월 공개회계 귀속**을
     움직인다(누가 얼마 냈나). 조용히 할 일이 아님.
   - 하드삭제는 금지(CASCADE 로 회계 유실) → 병합 또는 비활성만.

2. **`dues_confirm_reconcile` 의 무검사 회비 생성** — 입금 확인 경로가 `is_honorary`·`is_operator` 를
   보지 않고 `monthly_fee` 를 만든다(`20260716020000_reconcile_proxy_sessions.sql:65-67`). 클라가
   게스트만 막는다(`ReconcileInRow.tsx:109`). 명예회원·운영진에게 "N월 회비" 칩이 뜨고 확정하면
   부과가 생긴다 → 회비 룰이 두 갈래. 실제 발생 건 조회 후 게이트 추가할지 결정.

3. **비활성 회원 회비 무한 부과 여부 관찰** — 2026-08-19 부터 `dues_generate_monthly` 가 `is_active` 를
   보지 않으므로 다음 월진입부터 비활성 회원(현재 15명 상당)에게도 회비가 생긴다. 걷지 않을 사람은
   회비 현황 → 미납 → [면제]. 매달 손이 너무 많이 가면 `membership_ended_at`(종료월)을 넣어
   "정지한 달까지만 부과"로 좁힌다.

4. **의도적으로 남긴 Supabase 워닝** — 더 줄이려면 설계를 바꿔야 하는 것들.
   - `authenticated_security_definer_function_executable` 49건: 클라이언트가 실제로 부르는 RPC 라
     authenticated 에 EXECUTE 를 줘야 한다. 각 함수가 내부에서 `is_admin()` 으로 게이팅하는 현재 구조에서는 불가피.
   - `extension_in_public`(pg_net) 1건: 웹푸시(`notify_push_send`)가 의존한다. 스키마 이동 실패 시
     푸시가 멈추므로 보류하기로 결정(2026-08-17).
   - INFO 25건: `unindexed_foreign_keys` 21 · `unused_index` 3 · `auth_db_connections_absolute` 1.
     최대 테이블이 2천 행(matches 1,981)인 규모라 FK 인덱스 21개를 더하면 읽기 이득 없이 쓰기 비용만 든다.
     `unused_index` 3개도 감사(ops_audit) 조회용이라 정작 필요할 때 없으면 곤란해 남긴다.
     테이블이 10만 행대로 커지면 다시 볼 것.

## 배포 후 수작업 (2026-08-19)

- 정산함 **2026-07** 에서 이한비 님 입금 2건의 납부자를 지정해 배분하면 7월이 닫힌다
  (bank_transactions id 2 = 07-12 `7월회비 이한비` 5,000 / id 8958 = 07-26 `0726이한비` 6,000).
  부과는 마이그레이션이 복구해 뒀다(2026-07 회비 5,000 + 세션 108 대관비 6,000).
- 6월 입금 3건(6/7·6/21·6/29 각 6,000)은 서비스 시작월(2026-07) 이전이라 미분류로 둔다.
