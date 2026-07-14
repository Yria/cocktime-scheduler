# 회계(회비·대관비) 자동 대사 설계

> ⚠️ **이 문서는 초기 설계 스냅샷(2026-07-13)입니다.** 재정비 이후 현재 기준은 [`ACCOUNTING_SPEC.md`](./ACCOUNTING_SPEC.md)를 따른다. 특히 바뀐 점:
> - **현금 납부 없음**(통장 전용) — `dues_manual_payment`/현금납부확인 경로 제거.
> - **회계 항목별 정산 = 월 통장 기준(현금주의)**, 합 = 그 달 남은 돈(관리자·회원 공개회계 동일). 세션 전체 손익은 정모/현황(세션 기준)에서.
> - **코트대관은 카테고리가 아니라 `session_id`** 로 귀속. 4-화면(정모·정산함·회계·내회비) 라우팅.
> 관련 규칙 문서: [`TEAM_GENERATION_RULES.md`](./TEAM_GENERATION_RULES.md), [`EXPANSION_SPEC.md`](./EXPANSION_SPEC.md)

---

## 구현 상태 (2026-07-13, 브랜치 `sam/accounting`) — 은행 수집까지 구현, 운영 테스트 중

**마이그레이션 (20260713 040000~130000, 원격 적용됨):**
- `040000` 스키마 9테이블 + `places.court_fee_per_hour` + `members.membership_started_at` + RLS + 배분 트리거
- `050000` generate_dues_charges · `060000` 대사/현금납부/무시 RPC · `070000` 거래 무시(`classify_note`)
- `080000` 대관비 모델(코트 시간당요금) · `090000` 세션 지출컬럼(현 미사용) · `100000` 미납 금액 self-heal
- `110000` 무산 세션(경기기록 없음) 대관비 제외+정리 · `120000` 회비로 처리(항목생성+배분) · `130000` 7월 백필

**RPC:** generate_dues_charges · dues_manual_payment · dues_confirm_match · **dues_confirm_new_monthly** ·
  dues_cancel_match · dues_reverse_allocation · dues_set_charge_status · dues_ignore/unignore_transaction ·
  dues_notify_unpaid · dues_club_account.

**은행 수집(구현·배포됨):** Apps Script 웹앱(토스 거래내역 xlsx 첨부 원문 반환, `gmail.readonly`, executeAs=나/access=anyone,
  본문 시크릿) → Edge Function `ingest-bank-email`(admin JWT + is_admin, **자동 부과생성(지난달·이번달)** →
  복호화(`officecrypto-tool`, `TOSS_XLSX_PASSWORD`) → 토스 파서(`toss.ts`) → `bank_transactions` 멱등 적재).
  중복 제거: `raw_bank_emails.message_id` + `bank_transactions.dedup_key`(시각+금액+잔액).

**프론트:** `/dues`(현황판·입금확인·수지) · `/my-dues`.
- **입금확인** = 미처리 은행입금 인라인 처리(모달 없음): 제안 회원 + 미납항목 자동선택(**subset-sum**), 회원/항목 그 자리 변경,
  [확인] / **[N월 회비로 처리]**(항목 없을 때 원탭) / [무시]. 확인됨·무시 목록에서 취소/되돌리기.
- **수지** = 은행 입출금 기반: 수입(입금)−지출(출금)=순, 출금 목록 + 적요 이름 검색(케바케 코트비 찾기).
- 알림 `payment_confirmed`·`dues_unpaid`(문구 2곳 동기화 + `/my-dues` 딥링크 + 미납은 중립 토스트).

**확정 결정 & 설계 대비 변경:**
- **회원 대관비 = 고정 6,000/인**(`dues_settings.court_fee_default`). 장소 `court_fee_per_hour`(구 court_fee_per_head)=
  **코트 시간당 요금**(수지 참고값). 대관비 대상 = `status in ('active','closed')` **＋ 경기기록(`matches`) 있는(=실제 열린)** 세션,
  참석 `confirmed`/`late_pool`(악용방지) ＋ 당일취소자. 무자격(무산·취소·비대관장소) 미납 대관비는 재생성 시 자동 정리.
- **회비 = 5,000/월.** 가입일 = `coalesce(membership_started_at, created_at KST)`. **서비스 2026-07 시작 → 기존회원
  `membership_started_at` 6월 백필**(created_at=앱 등록일이 7월이라 offset 당월면제가 오적용되던 것 차단). 회비 면제는 별도
  플래그 없이 해당 회원 `membership_started_at`을 미래로 두어 부과 제외(DB 직접).
- **운영진(`role='admin'`) 회비·대관비 면제**(`is_operator`, 내부전용 `revoke from public`). **`dues_policies` 생략**(amount_due 스냅샷).
- **부과 생성은 [가져오기]에 자동 흡수**(별도 버튼 없음). 멱등 + 미납 항목 금액 self-heal(정책 변경 시 미납분 현재가로 교정).
- **`dues_allocations` FK ON DELETE CASCADE**(설계 restrict/no-action → 변경, 하드삭제 정합, SQL 리뷰 발견).
- **매칭 금액 분해 = subset-sum**(그리디는 회비+대관비 동시미납 시 오작동 → 회귀 테스트).
- **Edge Function 시크릿 = `Deno.env`**(Vault 아님, §4 정정). `ingest-bank-email` `verify_jwt=true`+내부 is_admin.
- **duesStore 사용**(비가상화 페이지 React Compiler `set-state-in-effect` 회피). number input 스피너 제거. self-guard는 `memberLoaded` 대기.

**남음:** §11 보안(SERVICE_ROLE·INGEST_SECRET 로테이션) · 프론트 배포(git push) · 회비 면제 명단 반영 · (선택) Apps Script 자동 폴링.

---

## 0. 목적 & 범위

은행 통장 거래내역(입금 알림 메일)을 감지·파싱해 DB에 적재하고, **입금액과 입금자명을 회원의 미납 회비·대관비에 대사(reconciliation)**하는 회계 기능.

- **입금(수입) 대사**가 1차 목표: 회비 5,000원 + 대관비 6,000원.
- **출금(지출) 분류**는 부수적으로 포함(주요 지출 = 코트 대관비). `bank_transactions.direction='out'`을 카테고리 태깅해 월별 수지 요약.
- **자동 확정은 하지 않는다.** 시스템은 "제안"까지, 확정은 **관리자 1-click**(§8 참조).

---

## 1. 현실 제약 (설계를 규정하는 두 사실)

1. **`ckti.me`는 현재 메일 수신 불가.** `dig` 실측: Gabia 네임서버, GitHub Pages A레코드만 있고 **MX/SPF 없음**, Cloudflare 미사용. → `accounting@ckti.me` 수신함은 DNS·수신 인프라를 새로 구축해야 하는 별도 프로젝트. **그래서 이미 메일이 도착하는 Gmail을 소스로 삼는다.**
2. **회원 식별 키가 약하다.** `members.name`이 유일한 사람 식별자인데 카카오 프리필 자유 텍스트라 **인증 실명이 아니고**, `UNIQUE` 제약이 없어 **동명이인 허용**, `phone`은 미수집. → **이름만으로 돈을 자동 확정하는 것은 금지**. 항상 제안 + 사람 확정.

---

## 2. 도메인 규칙 (회비·대관비)

### 2.1 회비 — 5,000원 / 월
- **대상**: 활성 회원(`is_active AND NOT is_guest`), **운영진 제외**(운영진은 회비·대관비 모두 면제).
- **면제 규칙**:
  - **당월 가입자 면제** — 가입한 그 달은 회비 없음.
  - **월말 가입 오프셋** — 월말(약 2~3일 이내)에 가입하면 **다음 달도 면제**. 예) 6/30 가입 → 6월·7월 면제, 8월부터 부과.
- **첫 부과 월 공식**: `offset_days`(기본 3)를 설정값으로 두고
  ```
  base            = 가입일 + offset_days
  first_charged_ym = month_of(base) 의 다음 달
  ```
  | 가입일 | base(+3d) | month_of | 첫 부과 | 면제 달 |
  |---|---|---|---|---|
  | 6/15 | 6/18 | 2026-06 | 2026-07 | 6월 |
  | 6/30 | 7/03 | 2026-07 | 2026-08 | 6·7월 |
  | 7/01 | 7/04 | 2026-07 | 2026-08 | 7월 |
- **다월 납부 허용**: 여러 달치를 한 번에 입금 가능(예: 15,000 = 3개월). 대사 시 오래된 미납월부터 충당.

### 2.2 대관비 — 6,000원 / (대관한) 세션·참석자
- **부과 조건**: 해당 세션이 **코트를 대관한 세션일 때만**. 모든 세션에 붙지 않음. → `sessions`에 대관 여부/금액 플래그 신설(§6.3).
- **대상**: 그 세션 **확정 로스터(`attendances.status='confirmed'`) 전원**. **당일 실제 출석 여부와 무관** — 참석자든 불참자(no-show)든 모두 납부(코트는 확정 인원 기준으로 이미 대관됨).
  - **운영진 제외** (운영진 = `user_roles.role='admin'`, §11 확정 필요).
  - **게스트 포함** (`members.is_guest=true`).
  - **`late_pool`(정원 외 늦참) 포함** — 세션 2/3 지점 이후 도착으로 정원에서 빠진 인원도 부과(악용 방지, 2026-07-13 확정). `attendances.status`는 실제로 4값 `('confirmed','waitlisted','cancelled','late_pool')`이며 `late_pool`은 전환 시 `confirmed_at`이 NULL이 되므로 **현재 status로 직접 판정**한다.
  - **당일 취소자도 부과**: `status in ('confirmed','late_pool')`(no-show 포함) **＋** `status='cancelled'`이면서 **확정된 적 있고(`attendances.confirmed_at` 존재) 세션 당일에 취소**(`date(cancelled_at KST) = date(scheduled_at KST)`)한 사람. 대기만 하다 취소(`confirmed_at` 없음)한 사람·사전(전날 이전) 취소자는 **제외**.
  - **세션 상태 필터**: `sessions.status in ('active','closed')`만 부과(draft/open/cancelled 제외 — 미진행·취소 세션 오부과 차단).
  - `confirmed_at`은 취소 시엔 유지되나(`cancel_*` RPC가 지우지 않음) late_pool/대기 강등 시엔 NULL이 됨 → "당일 취소자" 판정에만 사용(강등 후 당일취소 엣지는 누락 감수).
- **게스트 대납**: 게스트 돈은 보통 **데려온 회원이 대납**(항상은 아님). `attendances.invited_by`(데려온 회원)가 이미 있어, 게스트 대관비의 기본 납부 후보로 **초대 회원**을 제안한다. 관리자가 게스트 본인/타인으로 변경 가능.

### 2.3 입금 = 회비·대관비 조합
한 입금은 여러 항목을 한 번에 덮을 수 있다.
```
5,000  = 회비 1달
6,000  = 대관비 1세션
11,000 = 회비 1달 + 대관비 1세션
17,000 = 회비 1달 + 대관비 2세션
12,000 = 대관비 2세션
15,000 = 회비 3달
```
금액을 `5000·a + 6000·b`로 분해하되, **그 회원의 실제 미납 항목**(미납 회비 달 수 + 미납 대관비 세션 수)으로 후보를 좁혀 유일 해에 가깝게 만든다. 입금자명 + 미납 컨텍스트가 분해의 결정 근거.

> **확정 필요 사항**은 §12에 모아둠(운영진 회비 면제 여부, 참석 기준 등).

---

## 3. 전체 아키텍처

```
[은행] ──입금알림 메일──▶ [Gmail 사서함 (라벨 bank/inbox)]      (이미 도착)
                                    │  ① 수집: 관리자가 버튼 클릭 (스케줄러 없음)
                                    ▼
                        [Edge Function: ingest-bank-email]  (is_admin 게이팅)
                                    │  Apps Script 웹앱 호출 (x-ingest-secret, URL은 Vault)
                                    ▼
                        [Apps Script 웹앱 doPost]  ← 시간트리거 없음, 호출 시에만 실행
                                    │  GmailApp.search('label:bank/inbox is:unread') → 원문(raw)만 반환
                                    ▼
        [Edge Function]  ② 은행별 어댑터 파싱 → raw_bank_emails / bank_transactions 멱등 삽입
                          ③ 매칭 스코어러로 '제안'만 생성 (자동확정 X)
                                    │
                                    ▼
       [dues_charges 부과] ◀──배분(dues_allocations)──▶ [bank_transactions]
                                    │  ④ 관리자 1-click 확정 (SECURITY DEFINER RPC + is_admin)
                                    ▼
       [notifications INSERT] ──기존 트리거──▶ [send-push] ──▶ 회원 기기 (입금확인/미납)
```

**설계 대원칙**: **수집(트리거)**과 **파싱·적재(처리)**를 분리한다. 트리거를 나중에 (수동버튼 → Apps Script 자동 폴링 → Gmail API 폴링) 무엇으로 바꿔도 파서·스키마·Edge Function·대사 엔진은 그대로 재사용된다.

---

## 4. 수집(Ingestion) — 수동 버튼 + Apps Script 웹앱

관리자가 `/dues`에서 **[Gmail에서 새 입금 가져오기]** 버튼을 누르면:

1. 프론트 → Edge Function `ingest-bank-email` 호출 (관리자 JWT).
2. Edge Function이 **Apps Script 웹앱 URL**을 `x-ingest-secret` 헤더로 POST 호출 (URL·시크릿은 Supabase Vault).
3. Apps Script(은행 메일이 오는 Gmail 계정에 배포)가 `label:bank/inbox is:unread` 스레드의 **원문(raw MIME/HTML)만** 반환. **DB 접근/파싱은 하지 않음.**
4. Edge Function이 `service_role`로 파싱 → 멱등 삽입 → 매칭 제안 생성 → `{fetched, inserted, skipped, parse_errors, proposals}` 반환.
5. 처리 성공분은 Apps Script가 `bank/inbox`→`bank/done` 라벨 이동(또는 read 처리)해 **미처리 큐**를 라벨로 정의.

### 왜 이 구조인가
- **DNS 무변경**: 메일은 이미 Gmail에 온다.
- **OAuth refresh token 문제 회피**: Gmail API를 백엔드에서 직접 쓰면 `gmail.readonly`(restricted scope) 토큰이 미게시 앱 기준 7일 만료로 조용히 끊김. Apps Script는 계정 소유자 1회 동의로 끝.
- **선례 존재**: 이 프로젝트는 이미 Apps Script를 운영한 적 있음(`docs/Code.gs`).
- **쓰기 권한을 Google에 두지 않음**: Apps Script엔 공유 시크릿만. `service_role`과 DB write는 Supabase 안에 갇힘(현행 `send-push`의 `x-push-secret` 구조 복제).
- **스케줄러 불필요**: "수동 버튼"이라 `pg_cron` 트리거가 없음.

### 대안(현 시점 미채택, 승격 경로)
- **B. Apps Script 시간트리거 자동 폴링**: 버튼 대신 10분 주기. 파서·스키마 그대로. "가끔 눌러야 함"이 불편해지면 승격.
- **C. Gmail API 폴링(pg_cron→Edge Function)**: 리포 내 완전 버전관리. 단 OAuth 게시·검증 부담 + 토큰 만료 감시 필요.
- **D. `accounting@ckti.me` 인바운드**: Gabia→Cloudflare 이전 + MX + Worker + 은행 등록메일 변경. 되돌리기 부담 큼. 즉시성이 정말 중요할 때만.

---

## 5. 파싱

- **은행별 코드 어댑터(TS 모듈) 레지스트리**: `interface BankAdapter { bankCode; version; detect(email); parse(email): ParsedTxn[] }`. `detect()`는 발신 도메인+제목, `parse()`는 DOM/정규식. 은행 추가 = 모듈 1개 등록.
- **공용 전처리**: MIME 멀티파트 → `text/html` 선택 → transfer-encoding 디코드 → **charset 디코드(국내 은행 메일은 EUC-KR/CP949 다수 → UTF-8 강제 시 한글 깨짐 주의)** → HTML→텍스트.
- **금액은 `bigint` 원 단위 정수**(float 금지, 반올림 오류). **시각은 Asia/Seoul 고정 파싱**(자정 경계 하루 밀림 방지).
- **원문 항상 선(先)저장**: 파싱 성공 여부와 무관하게 `raw_bank_emails`에 먼저 INSERT(감사·재파싱). 미지원 은행/실패는 버리지 않고 `parse_status`로 남기고 관리자에게 푸시(신규 어댑터 작성 유도).
- **LLM 폴백(선택)**: 미지원 건에 한해 초안만 생성. **자동확정 금지**, 금융 PII 외부전송 리스크로 기본 비활성.
- **테스트**: `_fixtures/{bank}/{case}.eml` + `.expected.json` 골든 테스트(Deno). 픽스처는 **PII 스크럽 후** 커밋.

---

## 6. 데이터 모델

금액은 전부 **원(KRW) 정수**. 월 키는 **`ym text 'YYYY-MM'` (KST)**. 신규 테이블은 **처음부터 좁은 RLS**(§11).

### 6.1 재사용(신규 아님)
| 자산 | 용도 |
|---|---|
| `members(id, name, is_guest, is_active, auth_user_id, created_at, gender, birth_year)` | 회원·게스트, 가입일(created_at) |
| `user_roles(member_id, role)` + `is_admin()` | 운영진 판별 |
| `sessions(place_id)`, `attendances(session_id, member_id, status, invited_by)` | 대관비 부과 근거, 게스트 초대자 |
| `places` (+신규 `court_fee_per_head`) | 대관 여부·인당 대관비의 **단일 소스** (§6.3) |
| `notifications` INSERT → `trg_notify_push_send` → `send-push` → `push_subscriptions` | 입금확인·미납 푸시 |
| `group_settings`(싱글톤) + `cock_support_grants(member_id, ym)` | 월단위 멱등 **패턴 원형** |
| `is_admin()` / `current_member_id()` (SECURITY DEFINER) | RLS·RPC 가드 |

### 6.2 신규 테이블
```
raw_bank_emails         수신 원문 불변 보관 (message_id UNIQUE = 이메일 멱등)
bank_transactions       정규화 거래 (dedup_key UNIQUE = 거래 멱등, direction in/out)
dues_settings           싱글톤: 회비액(5000)·대관비 기본액(6000)·offset_days·클럽 계좌(민감)
dues_policies           회비/대관비 정책 (kind, amount, effective_from/to)  ※금액 이력 관리
dues_charges            부과: (member_id, ym)  또는  (member_id, session_id)  XOR
dues_allocations        입금↔부과 배분 라인 (가역 레코드; 부분/과납/선납/다회원 분할)
member_name_aliases     입금자명↔회원 학습 (배우자/타인 명의·닉네임)
dues_match_queue        미매칭/보류 큐 (사유 + 후보)
dues_audit_log          append-only 감사 로그
expense_categories      지출 분류 (코트대관 등)  ※출금 태깅용
```

**`dues_charges`** (부과의 물질화 — 회비 룰이 아무리 복잡해도 결국 여기에 구체 행으로 떨어진다):
```sql
create table public.dues_charges (
  id          bigserial primary key,
  kind        text not null check (kind in ('monthly_fee','court_fee')),
  member_id   uuid not null references public.members(id) on delete cascade,
  period_ym   text,                          -- kind='monthly_fee'
  session_id  bigint references public.sessions(id) on delete cascade, -- kind='court_fee'
  amount_due  integer not null,              -- 5000 / 6000 (정책 스냅샷)
  amount_paid integer not null default 0,    -- 배분 합계 캐시(트리거 유지)
  status      text not null default 'unpaid' -- unpaid|partial|paid|overpaid|waived|void
              check (status in ('unpaid','partial','paid','overpaid','waived','void')),
  payer_hint  uuid references public.members(id) on delete set null, -- 게스트→invited_by
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint dues_charge_period_xor
    check ((period_ym is not null)::int + (session_id is not null)::int = 1)
);
create unique index uq_charge_month   on public.dues_charges(member_id, period_ym)  where period_ym is not null;
create unique index uq_charge_session on public.dues_charges(member_id, session_id) where session_id is not null;
```

**`dues_allocations`** (핵심: 카운터가 아니라 **가역 레코드** — 취소/재매칭 안전, 메모리 *"커밋된 취소는 자동롤백 불가"* 교훈 차단):
```sql
create table public.dues_allocations (
  id          bigserial primary key,
  bank_tx_id  bigint references public.bank_transactions(id) on delete cascade, -- 현금납부는 NULL
  charge_id   bigint references public.dues_charges(id) on delete cascade,      -- 선납 크레딧은 NULL. ※구현: restrict→cascade(회원/세션 하드삭제 캐스케이드와 정합)
  member_id   uuid not null references public.members(id) on delete cascade,  -- 실제 납부 주체. ※구현: cascade(delete_my_account/delete_member FK abort 회귀 차단)
  amount      integer not null check (amount > 0),
  kind        text not null default 'payment' check (kind in ('payment','credit','refund')),
  matched_by  uuid references public.members(id) on delete set null,
  note        text,
  created_at  timestamptz not null default now()
);
```
불변식(트리거 강제): ①한 거래 배분 합 ≤ 거래 금액, ②`charge.amount_paid = Σ alloc.amount` 재계산 후 status 재도출, ③`bank_transactions.status` 갱신.

### 6.3 대관비 플래그는 `places`(장소)에 둔다 (신규 컬럼)
대관 여부는 **장소가 결정**한다(대관하는 코트 vs 무료/공용 체육관). 세션은 `place_id`로 값을 상속.
```sql
alter table public.places
  add column if not exists court_fee_per_hour integer;  -- 코트 1개 시간당 요금(예 13000). NULL = 대관비 없는 장소.
```
> ※ **구현 반영(2026-07-13)**: 이 필드의 의미는 "인당 대관비"가 아니라 **"코트 1개 시간당 요금"**(수지 지출 계산 참고값).
> **회원이 내는 대관비 = 고정 `dues_settings.court_fee_default`(6,000/인)**이며, 장소에 요금이 설정된(=대관하는) 세션의
> 참석자에게 부과. 실제 지출(할인 반영)은 은행 출금으로 수지에서 파악(§10). (구 이름 `court_fee_per_head` → `court_fee_per_hour`)
- **설정(회비 설정 모달)의 "장소별 코트 시간당 요금"에서 지정**. `NULL`이면 그 장소 세션엔 대관비 charge 미생성.
- 세션의 대관비 부과 여부 = `sessions.place_id → places.court_fee_per_hour`가 NULL이 아닐 때. 금액은 항상 `court_fee_default` 고정.

---

## 7. 부과 생성층 (charge generation) — 복잡한 룰이 사는 곳

`generate_dues_charges(p_ym text)` RPC(SECURITY DEFINER, `is_admin()` 가드). **멱등**(유니크 인덱스 + `on conflict do nothing`). 관리자 "이번 달 부과 생성" 버튼 또는 추후 `pg_cron`.

### 7.1 회비 charge 생성
```
for m in members where is_active and not is_guest and not is_operator(m.id):   -- 운영진 면제
    first_ym = month_after( month_of( m.created_at + offset_days ) )   -- offset = dues_settings.offset_days
    if p_ym >= first_ym:
        insert dues_charges(kind='monthly_fee', member_id=m.id,
                            period_ym=p_ym, amount_due=회비액)
        on conflict (member_id, period_ym) do nothing
```
- `m.created_at`을 가입일로 사용. **정확한 가입일이 필요하면** `members.membership_started_at date` 신설 + 관리자 보정(§12).

### 7.2 대관비 charge 생성
```
v_court = dues_settings.court_fee_default   -- 회원 대관비 = 고정 인당액(6000). 장소 요금과 무관.
for s in sessions join places p on s.place_id = p.id
        where p.court_fee_per_hour is not null                 -- 장소가 대관(요금 설정) 장소일 때만
        and s.status in ('active','closed')                    -- 진행/종료 세션만(draft·open·cancelled 제외)
        and exists(select 1 from matches where session_id=s.id) -- 경기기록 있는(실제 열린) 세션만. 무산 제외
        and date_trunc('month', s.scheduled_at KST) = p_ym:
    for a in attendances where a.session_id = s.id
            and ( a.status in ('confirmed','late_pool')        -- 확정(당일 no-show 포함) + 정원외 늦참(악용 방지)
                  or ( a.status = 'cancelled'                  -- 당일 취소자
                       and a.confirmed_at is not null          --   확정된 적 있음(대기만 하다 취소 제외)
                       and date(a.cancelled_at at time zone 'Asia/Seoul')
                         = date(s.scheduled_at at time zone 'Asia/Seoul') ) ):
        if is_operator(a.member_id):  continue                 -- 운영진 제외
        insert dues_charges(kind='court_fee', member_id=a.member_id,
                            session_id=s.id, amount_due=v_court,   -- 고정 인당액
                            payer_hint = case when member(a.member_id).is_guest
                                              then a.invited_by else null end)
        on conflict (member_id, session_id) do update set amount_due=v_court where amount_paid=0  -- 미납 금액 self-heal
-- ※ 재생성 시 무자격(무산·취소·비대관장소) 세션의 미납 대관비 항목은 별도 delete 로 정리.
```
- `is_operator()` = `user_roles.role='admin'` (§11·§12 확정).
- 게스트는 `payer_hint = invited_by`(데려온 회원)로 채워, 대사 시 대납 후보로 제시.

> **왜 물질화하나**: 룰(오프셋·면제·대관여부·운영진 제외)을 charge 생성 시점에 한 번 계산해 **구체 행**으로 떨군다. 대사·매칭·요약은 이 행들만 보면 되므로 룰 복잡도와 분리된다. 룰이 바뀌면 이 함수와 §2만 고친다.

---

## 8. 대사·매칭·배분 (제안 only, 관리자 확정)

### 8.1 파이프라인 (거래 1건)
```
S1 노이즈 필터: direction='out'(출금)·이자·소액 등 → status='ignored'(지출은 §10로)
S2 이름 정규화: norm(raw_name) = NFC+공백제거+은행부가문자('님','(카카오페이)'…) 제거
S3 후보 회원: aliases 정확일치(최강) > members.name 정확일치 > 퍼지(jaro/초성, 캡)
S4 미납 수집: 후보 M의 unpaid dues_charges (회비 ym + 대관비 세션)
            + payer_hint=M 인 게스트 charge(대납 후보)
S5 금액 분해: 입금액을 미납 charge들의 부분집합 합으로 매칭
            (5000·a + 6000·b; 오래된 미납월/세션 우선). 초과분 → credit, 부족 → partial
S6 제안 생성: {회원, 배분 라인들, 신뢰도}. 자동확정 안 함 → dues_match_queue 또는 제안목록
```
### 8.2 신뢰도 = 랭킹용 (확정 게이트 아님)
```
conf = 0.45·이름 + 0.25·금액정합 + 0.20·적요힌트 + 0.10·컨텍스트 − 패널티
패널티: 동명이인 0.30 / 금액 미정합 0.15 / 완납 항목 0.25
```
높은 순으로 제안 정렬만. **확정은 항상 관리자 1-click.**

### 8.3 학습
관리자가 확정할 때 `norm(raw_name) ≠ norm(member.name)`이고 별칭이 없으면 `member_name_aliases`에 `source='learned'` 자동 등록 → 다음번 **제안** 정확도 상승(확정은 여전히 사람). 재매칭 시 자동학습분만 회수(`created_by_txn` 기준), 수동 별칭은 보존.

### 8.4 확정/취소 RPC (SECURITY DEFINER, is_admin 가드, 감사로그 원자적)
- `dues_confirm_match(tx_id, lines jsonb)` — 배분 라인 생성 + charge 캐시 갱신 + (비게스트면) `payment_confirmed` 알림 INSERT.
- `dues_cancel_match(tx_id)` — 배분 삭제 + charge 되돌림. ⚠️ **이미 나간 입금확인 푸시는 회수 불가** → 확인 다이얼로그에 "회원에게 직접 안내" 경고(메모리 원칙).
- `dues_manual_payment(member_id, lines)` — 현금 납부(은행 미기록): `bank_tx_id=NULL` 배분.
- 게스트 대관비: 라인의 `member_id`(납부자)를 입금자, `charge_id`를 게스트 charge로 → 대납 표현.

---

## 9. UI / 운영 플로우

신규 라우트 `/dues`(관리자 self-guard, `/members`=`MemberAdminPage` 패턴). 모바일 우선, 공용 `ModalSheet`/`ConfirmDialog`/색 토큰 재사용.

```
/dues (관리자)
├─ AppHeader "회비 관리"  [Gmail 가져오기] [이번 달 부과 생성] [설정]
├─ 월 선택기 (◀ 2026-07 ▶ · 마감/진행 뱃지)
├─ Tabs
│   ├─ [대사]  제안 목록(확정/수정/무시) · 보류 큐(동명이인/금액상이 사유칩) · 확정목록(취소)
│   ├─ [현황판] 회원별 회비·대관비 납부/미납 (필터·검색, gender·birth_year로 동명 구분)
│   │           선택 → [미납자에게 알림] · [현금 납부확인]
│   └─ [수지]  수입(회비+대관비 수납) vs 지출(코트대관 등) 월별 요약  ← §10
├─ DuesImportResultModal (가져오기 결과: 신규 n건·파싱실패 m건·제안 k건)
├─ DuesMatchPickerModal (동명이인/대납 지목: 회원 검색 + gender·birth_year)
└─ DuesSettingsModal (회비액·대관비 기본액·offset_days·클럽 계좌[민감])
```
```
/my-dues (로그인 회원 전체)
├─ 이번 달 상태(회비/대관비 납부·미납 + 마스킹된 클럽 계좌 안내)
└─ 납부 내역(ym·항목·금액·확정일)  ← dues_charges/allocations 본인 스코프(RLS)
```

**운영 사이클**: ① 장소 추가/편집 시 대관비(인당액) 설정 → ② 월중/월말 "이번 달 부과 생성" → ③ "Gmail 가져오기"로 입금 적재 → ④ 제안 검토·확정, 보류 큐 수동 처리 → ⑤ 현황판에서 미납자 확인·알림 → ⑥ 수지 탭에서 월 마감 대사.

---

## 10. 지출(출금) — 부수 기능

`bank_transactions.direction='out'` 거래를 `expense_categories`(코트대관/셔틀콕/기타)로 태깅. **수지 탭**에서 월별 `수입(회비+대관비 수납) − 지출` 요약. 주요 지출인 코트 대관비는 세션과 느슨히 연결(선택). 자동 대사 대상 아님(수동 분류).

---

## 11. RLS / 보안

- **신규 테이블 전부 `enable row level security` + anon 차단**(`to authenticated`만).
- **관리자 전용**(`bank_transactions`, `raw_bank_emails`, `dues_policies`, `dues_allocations`, `dues_match_queue`, `dues_audit_log`, `dues_settings`, `expense_categories`): SELECT·ALL 모두 `is_admin()`.
- **회원 본인 열람 예외**(`dues_charges`): `using (is_admin() or member_id = current_member_id())`. 남의 금액 비노출.
- **쓰기는 SECURITY DEFINER RPC 경유**(attendances/notifications 패턴). `dues_audit_log`는 **append-only**(UPDATE/DELETE 정책 미부여).
- **클럽 계좌 원문**은 `dues_settings` 관리자 컬럼만. 회원에겐 마스킹본(`○○은행 123-**-**89`)만.
- **푸시 payload에 금액·입금자명·계좌 금지**(딥링크·건수만). 잠금화면 노출 방지.
- ⚠️ **`SERVICE_ROLE_KEY` 평문 노출**: `.env.local`·`.claude/settings.local.json`에 하드코딩됨. RLS 우회 키라 회비(민감 금융정보) 전 테이블 유출 통로. **회비 도입 전 키 로테이션/점검 권장.**
- **notifications 문구 2곳 동기화 필수**: 새 type(`payment_confirmed`, `dues_unpaid`) 추가 시 `send-push/index.ts`의 `buildBody`와 `src/lib/supabase/notifications.ts`의 `notificationMessage` **양쪽**에 case 추가(안 하면 기본 문구로 폴백).
- **게스트(`auth_user_id NULL`)는 푸시 수신 불가** → 게스트 미납은 수동/대납 회원에게 안내.

---

## 12. 확정 필요 사항 (구현 전 결정)

1. ✅ **운영진 회비 면제** — 운영진은 **회비·대관비 둘 다 면제** (확정).
2. **"운영진"의 정의** — `user_roles.role='admin'`과 동일한가? 별도 역할 필요?
3. ✅ **대관비 부과 = 확정 로스터(`confirmed`, no-show 포함) ＋ 당일 취소자(`confirmed_at` 존재 & `cancelled_at` 날짜=세션 날짜)** (확정). 대기만 하다 취소·사전 취소는 제외.
4. **가입일 소스** — `members.created_at`으로 충분한가, 관리자가 보정하는 `membership_started_at` 신설이 필요한가?
5. **offset_days 정확값** — 2일? 3일? (설정값, 기본 3)
6. **금액 이력** — 회비/대관비가 5,000/6,000에서 바뀔 때 과거 부과는 옛 금액 유지(정책 effective-date)로 가는가?
7. **다월 회비 충당 순서** — 오래된 미납월부터(권장) 확정.
8. **은행/계정** — 어느 은행이 어느 Gmail로 입금 알림을 보내는가? (파서 어댑터 우선순위 결정)

---

## 13. 구현 순서 (제안)

1. **마이그레이션 1** — `dues_settings`·`dues_policies`·`dues_charges`·`dues_allocations`·`member_name_aliases`·`dues_match_queue`·`dues_audit_log`·`expense_categories` + `places.court_fee_per_head` + RLS + 트리거.
2. **부과 생성 RPC** — `generate_dues_charges(ym)` (§7). 단위 테스트(오프셋·운영진 제외·대관세션).
3. **파서** — 대상 은행 어댑터 + 공용 전처리 + 골든 테스트.
4. **Edge Function `ingest-bank-email`** + **Apps Script 웹앱**(원문 반환) + Vault 시크릿. (`send-push` 배포 절차 동일: `supabase functions deploy`)
5. **대사 RPC** — `dues_confirm_match`·`dues_cancel_match`·`dues_manual_payment` + 감사로그 + 알림 type 2종(문구 2곳 동기화).
6. **프론트** — `src/lib/supabase/dues.ts` · `src/store/duesStore.ts` · `/dues`(관리자) · `/my-dues`(회원).
7. **알림 문구** — `buildBody`/`notificationMessage` case 추가.

> 배포: DB는 `supabase db push`, Edge Function은 `supabase functions deploy ingest-bank-email`(수동), Apps Script는 대상 Gmail에 웹앱 배포. 프론트는 `git push`→GitHub Pages 자동.

---

## 14. 재사용 자산 & 주의점 요약

| 재사용 | 위치 |
|---|---|
| 푸시 체인 | `notifications` INSERT → `trg_notify_push_send` → `send-push` |
| 부분집합 발송 | `insert ... select ... where not exists(납부)` (=`notify_admins_new_member` 패턴) |
| 월단위 멱등 | `cock_support_grants(member_id, ym)` |
| 관리자 페이지 | `MemberAdminPage`(self-guard, 가상화 목록) |
| Edge Function 인증 | `x-push-secret` 헤더 + Vault |
| 게스트 초대자 | `attendances.invited_by` |

**반복되는 함정**: ① 알림 문구 2곳 동기화 ② 게스트 푸시 불가 ③ 확정 취소 후 푸시 회수 불가 ④ `SERVICE_ROLE_KEY` 평문 노출 ⑤ `config.toml`의 stale `[functions.sheets]` 정리 ⑥ 금액 `bigint` 정수·시각 KST.
