# 회원 파티 SQL 검증

`member_party.test.mjs`는 실제 PostgreSQL 엔진인 PGlite에 최소 스키마와 인증 역할을 만들고
`20260907010000_member_party.sql`, `20260907020000_member_party_realtime.sql`을 각각 두 번 적용한 뒤 RPC를 실행한다. 원격 DB에는 연결하지 않는다.

```sh
npm install --prefix /tmp/cocktime-party-sql-check --no-audit --no-fund @electric-sql/pglite
PGLITE_MODULE=/tmp/cocktime-party-sql-check/node_modules/@electric-sql/pglite/dist/index.js node supabase/tests/member_party.test.mjs
```

검증 범위: 별도 설정 없이 자동 활성화, 세션 참가 운영진 범위, 본인 회원 연결, 사용 불가 상태,
여러 기기의 회원 중복 방지/개별 해제, lease 만료, 5초 마감, 4인 선발 검증,
보드 버전 충돌, 중복 확정 재시도, 기존 팀/예약 보존, 새 팀 확정/동기화 버전,
이전 라운드의 지연 하트비트 차단, 인원 부족/운영진 복귀/세션 종료 취소,
역할별 RPC/내부 테이블 접근 권한.
편집 기기의 참가/확정 차단, 만료 시각과 무관한 편집권 판정, 도중 편집권 획득 시 후보 제외,
같은 회원의 다른 읽기 기기 유지, 누름과 확정 기기의 일치도 검사한다.
로컬 `realtime.send` 기록을 사용해 시작·참여·해제·완료·취소 알림, 공개 페이로드의 개인정보 제외,
유효 lease 갱신 알림 생략, 롤백 시 알림 취소, 전송 오류 시 RPC 보존, 기능 지원 표시와 권한 유지도 검사한다.

단일 DB 연결의 실행 검증이므로 별도 연결 간 잠금 경합이나 Supabase Realtime 전달은 검증하지 않는다.

RPC 계약은 `src/lib/supabase/memberParty.ts`에 정의한다. 최초 누름은 `roundId=null`,
이후 하트비트는 받은 `roundId`를 전송해야 한다. 서버 lease는 3초, 하트비트 주기는 1초다.
참가와 확정에는 보드의 `boardClientId`도 필수다. 누름의 `clientId`는 마운트별 해제 토큰이며,
`boardClientId`는 기존 `sessions.editor_client_id`와 비교하는 보드 식별자다.
해제는 `boardClientId` 없이도 가능하다.
마감 후 신규 참가를 받지 않으며 10초가 지나도 확정하지 못한 라운드는 취소한다.
확정/취소 시 모든 누름을 삭제하고 최근 결과를 보관해 새 라운드는 새 누름으로만 시작한다.
