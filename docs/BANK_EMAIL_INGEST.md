# 은행 메일 수집 & 자동 정리 — 배포/운영 가이드

토스뱅크 거래내역 메일을 회계로 가져오고, **가져온 뒤 그 메일을 자동으로 휴지통으로 정리**하는 파이프라인의 배포 절차.
"나중에 배포" 시 이 문서만 따라 하면 됨.

---

## 1. 구조 (현재)

```
프론트(운영진 JWT)
  → Edge Function  ingest-bank-email        (is_admin 재검)
    → Apps Script 웹앱 (firea32@gmail.com)   (시크릿 인증, execute-as firea32)
      → Gmail 검색(GmailApp.search) → 토스 거래내역 xlsx(암호화) 원문 반환
    ← 복호화(TOSS_XLSX_PASSWORD) → 토스 파서
    → raw_bank_emails / bank_transactions  멱등 적재(dedup)
    → (신규) 적재 성공한 메일만 Apps Script 2차 호출로 휴지통 이동
```

- **파일**
  - `supabase/functions/ingest-bank-email/index.ts` — 엣지 함수(수집·파싱·적재·정리 지시)
  - `supabase/functions/ingest-bank-email/toss.ts` — 토스 xlsx 파서
  - `supabase/functions/ingest-bank-email/apps-script.gs` — **firea32에 배포하는 Apps Script 코드**(레포는 사본; 실제 실행본은 script.google.com)
  - `supabase/functions/ingest-bank-email/appsscript.json` — Apps Script 매니페스트(스코프)

- **시크릿**
  - 엣지(`supabase secrets set`): `APPS_SCRIPT_URL`, `INGEST_SECRET`, `TOSS_XLSX_PASSWORD` (+ 자동: `SUPABASE_URL`, `SUPABASE_ANON_KEY`)
  - Apps Script 코드 상단 `INGEST_SECRET` — **엣지의 `INGEST_SECRET`과 반드시 동일**

- **안전장치**: 앱이 메일 원문을 `raw_bank_emails`에 보관하고, 휴지통은 30일 복구 가능 → 가져온 메일을 지워도 회계/감사 데이터는 유실되지 않음.

---

## 2. 이번 변경 요약 (자동 정리)

- 가져오기가 끝나면 **에러 없이 정상 적재된 메일만**(중복 skip 포함) 휴지통으로 이동.
- **파싱/적재 실패한 메일은 남김**(성급히 지워 유실 방지). best-effort — 삭제가 실패해도 적재 자체는 정상.
- 응답에 `trashed`(휴지통으로 보낸 개수) 포함.
- 코드 변경점
  - `apps-script.gs`: `doPost`에 `action:'trash'` 분기(`getMessageById(id).moveToTrash()`) 추가.
  - `appsscript.json`: 스코프 `gmail.readonly` → **`gmail.modify`**(휴지통 이동 권한).
  - `index.ts`: 호출부 `callAppsScript()` 일반화, 메시지별 성공(`msgOk`) 추적 → 성공분만 `trashInGmail()` 2차 호출.

---

## 3. 배포 절차 (⚠️ 순서 중요: Apps Script 먼저)

### 3-1. Apps Script (firea32@gmail.com) — **직접 수행 (구글 계정 작업)**

1. `script.google.com` → 기존 **수집 웹앱 프로젝트** 열기 (없이 신규면 `apps-script.gs` 상단 "[배포]" 주석대로 새로 생성).
2. **코드 갱신**: 레포의 `supabase/functions/ingest-bank-email/apps-script.gs` 내용으로 교체(= `action:'trash'` 분기 추가분).
   - ⚠️ `INGEST_SECRET` 값은 **기존 배포와 동일하게 유지**(엣지 시크릿과 일치해야 함). 새로 만든 게 아니면 기존 값 그대로 둘 것.
3. **스코프 상향 반영**: 프로젝트 설정(⚙️) → "`appsscript.json` 매니페스트 파일 표시" 체크 → `oauthScopes`를 `https://www.googleapis.com/auth/gmail.modify` 로 변경.
   - (코드가 `moveToTrash`를 쓰므로 실행 시 자동으로 modify를 요구하기도 하지만, 매니페스트에 명시하는 편이 확실.)
4. **권한 재동의**: 편집기에서 함수 `authorize` 선택 → **실행(Run)** → 동의창에서 **"Gmail 수정(modify)" 권한 허용**.
   - ⚠️ 이 재동의를 **안 하면 삭제(moveToTrash)가 구글 레벨에서 막힘**. 적재는 되지만 정리만 실패.
5. **웹앱 재배포**: 배포 → **배포 관리** → 기존 배포의 ✏️(편집) → 버전 **"새 버전"** 선택 → 배포.
   - 기존 배포를 편집하면 **웹앱 URL이 유지**되므로 엣지의 `APPS_SCRIPT_URL`은 바꿀 필요 없음.
   - (만약 "새 배포"로 새 URL이 나오면 → 3-2 전에 `supabase secrets set APPS_SCRIPT_URL=<새 URL>` 필요.)

### 3-2. Edge Function 배포

```bash
supabase functions deploy ingest-bank-email
```

- 시크릿이 바뀐 게 없으면 추가 작업 없음. (URL이 새로 나왔다면 위에서 `secrets set` 먼저.)
- 3-1을 **먼저** 해야 실제 삭제가 동작함. (3-1 전에 3-2만 하면 삭제 2차 호출이 실패로 로깅될 뿐, 수집·적재는 정상.)

---

## 4. 검증

1. 앱에서 **통장내역 가져오기** 1회 실행.
2. 응답(또는 결과 표시)에서 `trashed` 개수 확인 — 정상 적재된 메일 수와 일치해야 함.
3. Gmail(firea32) **휴지통**에 해당 토스 메일이 들어갔는지 확인. 받은편지함엔 사라짐.
4. 회계 화면에서 거래내역이 정상 적재됐는지 확인(휴지통 이동과 무관하게 `raw_bank_emails`/`bank_transactions`는 그대로).
5. (에러 케이스) 일부 메일이 파싱 실패하면 그 메일은 **받은편지함에 남아 있어야** 정상(응답 `errors`에 사유 표시).

---

## 5. 롤백 / 주의

- **되돌리기**: `index.ts`에서 `trashInGmail(trashIds)` 호출 블록만 제거(또는 주석) 후 `supabase functions deploy` → 삭제 중단, 수집은 유지. (스코프는 그대로 둬도 무해.)
- **재동의 누락 증상**: 수집은 되는데 `trashed=0` + `errors`에 `trash: ...` → 3-1의 4단계(authorize 재동의) 안 된 것.
- **URL 변경 주의**: "새 배포"로 URL이 바뀌면 엣지 `APPS_SCRIPT_URL` 갱신 필수(안 하면 수집 자체가 502).
- **영구 삭제 아님**: 휴지통(30일)으로만 보냄. 영구 삭제가 필요하면 별도 처리(권장 안 함 — 복구 여지 남기는 게 안전).
- `raw_bank_emails`가 원문을 보관하므로 휴지통 이동은 회계 데이터에 영향 없음.

---

## 6. 관련

- 회계 전반: [ACCOUNTING_SPEC.md](./ACCOUNTING_SPEC.md)
- 배포 일반: 프론트=GitHub Pages(git push), DB=`supabase db push`, Edge=`supabase functions deploy`(수동)
