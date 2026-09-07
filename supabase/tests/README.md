# SQL 검증

## 회원 파티

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

## 늦참 평균 판수 보정

```sh
node --test supabase/tests/late_join_game_count.test.mjs
```

프로젝트 개발 의존성의 PGlite를 사용한다. 최소 스키마에
`20260907040000_late_join_game_count.sql`을 두 번 적용하고 실제 보정 RPC·INSERT 트리거·설정 전환 트리거를 실행한다.
기존 휴식 복귀 RPC와 자식 변경의 `sync_version` 갱신 함수도 함께 실행한다.

검증 범위: 최초 참가 0판, 대기/경기 중 평균, 휴식·미확인·다른 세션 제외,
반올림, 진행 중 판수 미가산, 등록과 확인 시점 구분, 콕 체크 OFF 추가,
여러 명 일괄 추가, 기존 높은 판수 보존, 재확인 멱등성, 기존 행 upsert/중복 추가 보존,
ON → OFF 전환과 동기화, 휴식 복귀, 내부 함수와 RPC 실행 권한.
단일 로컬 DB 연결 검사이며 실제 Supabase RLS·네트워크 전달·서로 다른 연결의 잠금 경합은 검증하지 않는다.

수학적 성질은 `pnpm exec vitest run src/lib/teamSelection/lateJoinFairness.test.ts --reporter=verbose`로 별도 확인한다.
5,004개 판수 조합에 실제 SQL을 적용하고, 반복 합류의 오차·분산 경계 및 경기 종료 시점·그룹 이력 반례를 검사한다.
일반 증명과 검증 범위는 [늦참 평균 판수 수학 검증](../../docs/TEAM_MATCHING_MATH.md)에 기록했다.
