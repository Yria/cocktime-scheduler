# TODO

## 남은 것

1. **프론트 배포 대기** — 호출 폭주 수정(사진 404 루프 · authStore 중복 loadMember · 일정 sync 스로틀)과
   회비 현황 수정은 코드에만 반영돼 있다. GitHub Pages 는 `git push` 로만 나가므로 커밋+푸시해야 실제로 줄어든다.
   (DB 마이그레이션 4건은 2026-08-17 `supabase db push` 로 이미 적용됨.)

2. **의도적으로 남긴 Supabase 워닝** — 더 줄이려면 설계를 바꿔야 하는 것들.
   - `authenticated_security_definer_function_executable` 49건: 클라이언트가 실제로 부르는 RPC 라
     authenticated 에 EXECUTE 를 줘야 한다. 각 함수가 내부에서 `is_admin()` 으로 게이팅하는 현재 구조에서는 불가피.
   - `extension_in_public`(pg_net) 1건: 웹푸시(`notify_push_send`)가 의존한다. 스키마 이동 실패 시
     푸시가 멈추므로 보류하기로 결정(2026-08-17).
   - INFO 25건: `unindexed_foreign_keys` 21 · `unused_index` 3 · `auth_db_connections_absolute` 1.
     최대 테이블이 2천 행(matches 1,981)인 규모라 FK 인덱스 21개를 더하면 읽기 이득 없이 쓰기 비용만 든다.
     `unused_index` 3개도 감사(ops_audit) 조회용이라 정작 필요할 때 없으면 곤란해 남긴다.
     테이블이 10만 행대로 커지면 다시 볼 것.
