# 통장 메일 가져오기

`ingest-bank-email`은 운영진 JWT를 확인하고 Apps Script에서 메일을 읽는다.
각 첨부를 `parse-bank-attachment`의 별도 HTTP 요청으로 복호화·파싱한 뒤,
기존 `dedup_key` 기준으로 거래를 저장한다. 같은 메일의 모든 첨부 저장이
성공한 뒤에만 `parse_status=parsed`로 바꾸고 Gmail 휴지통으로 이동한다.
실패한 첨부가 있으면 메일을 남기며, 재시도에서 이미 저장한 거래는 중복 제외한다.
일부 파일 처리나 Gmail 정리가 실패하면 저장 건수와 오류를 포함한 HTTP 502를
반환한다. 기존 프론트도 `error`를 읽으므로 실패를 완료로 표시하지 않는다.

2026-09-14 수집 요청 3건이 HTTP 546으로 실패했고 런타임에 `CPUTime`
종료가 기록됐다(2,255~2,444ms). 메일 여러 개의 복호화·파싱을 한 실행에서
수행해 CPU 한도를 넘었다. 수집 함수에는 XLSX/복호화 라이브러리를 임포트하지
않고, 첨부별 함수 실행으로 CPU 사용을 분리한다.
[Supabase 실행 제한](https://supabase.com/docs/guides/functions/limits)

## 배포

두 함수 모두 `verify_jwt=true` 및 내부 `is_admin` 검사를 유지한다.
시크릿은 프로젝트 공통 설정을 사용한다: `APPS_SCRIPT_URL`, `INGEST_SECRET`,
`TOSS_XLSX_PASSWORD`. DB 마이그레이션이나 Apps Script 재배포는 필요 없다.
파싱 함수를 먼저 배포한 후 수집 함수를 배포한다.

```sh
supabase functions deploy parse-bank-attachment --use-api
supabase functions deploy ingest-bank-email --use-api
```

프론트 변경은 HTTP 오류의 `message`/상태 코드와 부분 처리 오류를 표시하며,
GitHub Pages의 기존 프론트 배포 절차로 따로 반영한다.

## 검증

```sh
deno test --allow-env --config supabase/functions/parse-bank-attachment/deno.json supabase/functions/parse-bank-attachment/xlsx_test.ts supabase/functions/ingest-bank-email/index_test.ts
pnpm exec vitest run src/lib/supabase/duesSettings.test.ts src/lib/supabase/bankAttachment.test.ts
pnpm exec playwright test e2e/accounting.spec.ts --grep 'bank import shows'
```

실제 운영진 계정으로 가져온 후 HTTP 200, 새 거래 반영, 함수별 CPU 종료 사유를
확인한다. 엑셀 한 개만으로도 한도를 넘는 경우에는 오류를 표시하고 메일을
보존한다. 이 경우 거래내역 조회 기간을 줄여 파일을 다시 받아야 한다.
