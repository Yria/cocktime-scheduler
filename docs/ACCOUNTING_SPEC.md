# 회비·대관비 회계 — 기능 기획 (현행 기준)

> 상태: **구현·운영 중** · 최종 정리 2026-07-15
> 이 문서는 **현재 구현된 기능**의 단일 레퍼런스다(옛 설계·감사·구현계획 문서를 현행 기준으로 통합). 코드 위치: `src/lib/supabase/dues.ts`(데이터·RPC 래퍼), `src/store/duesStore.ts`(로드·캐시), `src/components/admin/dues/*`(운영진 화면), `src/components/dues/*`(회원 화면), `supabase/migrations/2026071*`(스키마·RPC), `supabase/functions/ingest-bank-email`(수집).
> 알고리즘(팀 편성)과 무관 — 회비/대관비 룰이 바뀌면 이 문서의 §1·§4를 함께 갱신한다.

---

## 0. 대전제 (원칙)

1. **통장 전용.** 현금 납부 개념 없음 — 모든 수입/지출은 실제 은행 거래(`bank_transactions`)에서 온다. 팬텀 수입을 만들지 않는다.
2. **로그인 필수 열람.** 회원 노출 RPC는 모두 `current_member_id()` 기반이며 `anon` execute는 revoke(비로그인은 아무것도 못 봄).
3. **열린 세션 = 경기기록 기준.** 경기(matches)가 있어야 실제 열린 세션 → 대관비 부과 대상(§1.2).
4. **회계 = 월 통장 기준(현금주의).** "그 달 통장 거래"만으로 분해하며, 항목별 순액의 합이 반드시 "이 달 남은 돈(수입−지출)"과 일치한다(§3.3). 세션 전체 손익(다른 달 지출 포함)은 정모/현황에서 본다(§6).
5. **부과는 물질화한다.** 룰(면제·오프셋·대관여부)을 `dues_charges` 구체 행으로 떨궈, 대사·요약은 이 행만 보면 되게 한다(룰 복잡도 분리, §4).

---

## 1. 도메인 모델

### 1.1 금액
- **회비(monthly_fee)**: 5,000원/월. 회원(활성·비운영진·비게스트·비명예회원) 대상, 월 단위(`period_ym`). **명예회원**(`members.is_honorary`)은 회비 면제(§4).
- **대관비(court_fee)**: 세션 단위(`session_id`). 두 모드로 갈린다(2026-07). **부과 대상이 모드마다 다르다**:
  - **엔빵**: 세션에 대관 **총액**이 있으면 `총액 ÷ 참석 인원`(**10원 버림**). 대상 = **실제 참석(confirmed/late_pool)만**, **운영진 포함**, **당일취소 제외**. (평일: 총액 입력 → 엔빵. "코트를 실제로 쓴 사람끼리 나눔"이라 당일취소자는 분모·부과에서 뺀다.)
  - **정액**: 총액이 없으면 **인당 6,000원**(`dues_settings.court_fee_default`). 대상 = **참석 + 당일 확정취소**, **운영진 제외**. (토·일: 총액 미입력 → 정액. 당일취소도 자리·약속 비용이라 정액을 부과.)
  - 엔빵 총액 = `coalesce(sessions.court_fee, recurring_schedules.court_fee)` — 반복 규칙에 넣은 **기본 총액**(일정 생성 시)을 회차가 물려받고, 회차에서 실제 총액을 넣으면 그게 우선. 부과 시점(세션 종료 트리거)에 규칙을 조인해 읽음.
- `places.charges_court_fee`(boolean) = **대관장소 여부(대관비 부과 대상 게이트)**. false면 그 장소 세션엔 대관비 미부과. (구 `court_fee_per_hour` 를 대체 — 컬럼·전환창 브리지는 drop 완료 20260718010000.)

### 1.2 세션이 "열렸다"의 정의
- **경기(matches)가 있으면 열린 세션.** 없으면 무산 → 대관비 부과 대상 아님.
- **예외(`sessions.dues_include=true`)**: 무산/즉석 세션이지만 정산이 필요한 경우 정산 화면에만 노출.
- 정산상 열린 세션 = `matches 있음 OR dues_include`. 대관 세션 목록 쿼리(`queryCourtSessions`)가 이 기준을 원천에서 강제(대관장소 `charges_court_fee=true` + `matches!inner`).

### 1.3 회비 이월 (deferred_to)
- `dues_charges.deferred_to`가 set이면 **그 달이 실효 월**(부과 월 대신). 예: 7월 회비를 8월로 이월 → 7월엔 해결된 것처럼 숨김, 8월에 미정산으로 노출.
- 이월은 상태(status)를 바꾸지 않는다(그대로 unpaid/partial). 정모/현황·내 회비 모두 "이월 나간 건 제외, 이월 들어온 건 포함"으로 판정.

### 1.4 핵심 테이블
- **`dues_charges`** — 부과. `kind(monthly_fee|court_fee)`, `member_id`, `period_ym` XOR `session_id`, `amount_due`, `amount_paid`(트리거 캐시), `status(unpaid|partial|paid|overpaid|waived|void)`, `payer_hint`(게스트 대납자), `deferred_to`, **`is_day_cancel`**(정액 당일 확정취소로 부과된 court_fee 표식 — 현황 별도 노출·부과삭제 대상), **`voided_by`/`voided_at`**(부과삭제=void 한 운영진·시각, 감사·표시). 유니크: (member,period_ym) / (member,session_id).
- **`dues_allocations`** — 입금↔부과 배분(**가역 레코드**: 취소/재매칭 안전). `bank_tx_id`, `charge_id`(nullable), `member_id`(납부 주체), `amount`, `kind`. 트리거가 charge.amount_paid·status와 bank_tx.status를 유지. **waived/void엔 배분 금지(가드).**
- **`bank_transactions`** — 은행 거래. `direction(in|out)`, `amount`(양수), `balance_after`, `status(unmatched|proposed|partial|matched)`, `category_id`(수지 분류), `session_id`(대관 지출·비회원 대관 수입 귀속), `refund_of_tx_id`(환불 연결), **`paid_by`(비부과 카테고리 납부의 납부 회원 — 내 납부 이력용)**, `dedup_key`(멱등).
- **`txn_categories`** — 수지 분류(콕공구·이자·정모·기타 등). 관리자 추가/삭제. (코트대관은 카테고리가 아니라 `session_id`.)
- **`dues_settings`** — 싱글톤: 회비액·대관비 기본액·`offset_days`·클럽 계좌(`bank_name`/`bank_account`/`account_holder`).
- **`raw_bank_emails`** — 수신 원문 보관(재파싱·감사). **`dues_audit_log`** — append-only 감사 로그.
- 재사용: `members`(+`membership_started_at`=가입일 보정, +`is_honorary`=명예회원 회비 면제 플래그), `sessions`/`attendances`/`places`, `notifications`→푸시.
- **`member_honorary`** — 명예회원 지정 사유(관리자 메모). `member_id`(PK)·`reason`. members RLS(로그인 전원 조회)와 분리해 **is_admin만 조회**(사유 비공개). 쓰기는 `dues_set_honorary` RPC만.

---

## 2. 라우팅

- **운영진**: `/dues/:ym`(정모·메인) · `/dues/:ym/inbox`(정산함) · `/dues/:ym/ledger`(회계). ym·화면 각각 독립 URL. 뒤로가기=홈. 월 공통 데이터는 셸에서 `loadMonth(ym)` 한 번(캐시, §11).
- **회원**: `/my-dues`(내 회비) · `/my-dues/ledger`(클럽 회계). 상단 탭으로 분리.

---

## 3. 화면별 기능

### 3.1 정모/현황 (`/dues/:ym`)
- 목적: **정산 단위(세션)가 잘 마감됐는지** + **누가 무엇을 안 냈는지**.
- **회비 진행**: 원 월(period_ym=ym) 기준 진행률. **분모 = 이번 달 실제 부과된 회비 수(납부+미납)** — roster(활성·비운영진·비게스트·비명예)에 있어도 이번 달 부과가 없는 신규 유예 회원(§4)이나 `waived`/`void` 건은 애초에 낼 회비가 아니므로 분모에서 뺀다(그래서 `납부 65/81`처럼 명단 총원과 어긋나지 않고 `미납 N`과 정합). 이월된 건(§1.3)은 원 월에서 해결로 카운트, 이월 대상 월에 별도 노출([정산]/[취소]).
- **세션별 정산 상태**: 세션별 수입(회원 납부+비회원)·지출(대관료) 순액 + 마감/미완. 대관비는 실제 낼 사람(대납 게스트 포함, `payer_hint ?? member`) 기준 합산(단 `void`/`waived`는 낼 돈이 아니라 수납 집계·미납 명단에서 제외). **수납 진행 행을 펼치면** — 미납자가 남아 있으면 **미납자만**(취사선택·안내 발송, 완납자 숨김), **전원 완납(마감)이면 납부자 명단**(낸 사람·낸 금액 — 누가 냈는지 열람).
- **당일취소 부과(정액)**: 정액 세션에서 **당일 확정취소자**(`is_day_cancel`)는 카드에 별도 블록으로 노출한다(자리·약속 비용이라 기본 부과되나 카풀 불발 등 사정 시 뺄 수 있게). 운영진 **[부과삭제]** → `dues_set_charge_status(id,'void')`: row 삭제가 아니라 `status='void'`로 두어 **취소선 + 누가 삭제했는지(`voided_by`)** 표시(감사 `dues_audit_log`). **[되돌리기]** → `'reset'`(배분 캐시 기준 재산정 + `voided_by/at` 해제). 삭제되면 수납 집계·본인 `/my-dues` 미납에서 함께 빠진다(status 기반).
- **미납 알림 발송**: **분류(회비/세션) 그룹 단위**로만, 그룹 안 대상 취사선택. 전체 일괄 발송 없음. 게스트·미로그인은 푸시 불가(수동 안내).

### 3.2 정산함 (`/dues/:ym/inbox`) — 은행 거래 처리
- **가져오기**: Gmail에서 거래 수집·적재(§7).
- **입금·출금 한 큐**(날짜순 카드): 미처리 / 부분 처리. 필터(전체/입금/출금 + **금액 완전일치**). 확정 거래는 [회계] 원장에서 열람·취소.
- **입금 1건**: ① 납부자 지정(이름 자동 제안+검색, 게스트 포함, 여러 명 대납 가능) → ② 처리 선택(상호배타):
  - **미납 부과 배분**(본인+대납, **월 무관**=크로스먼스) + 필요 시 **신규 회비/세션 즉석 생성**. 신규 세션 칩은 **그 달 열린 세션 중 그 납부자가 참석 확정(confirmed/late_pool)이고 아직 대관비 부과 없는** 것만 노출(미참석·기부과 세션 미노출 — 완납된 세션도 `court`로 감지해 제외, `void`만 재부과. `queryCourtSessions`가 `attendances` 조인해 `attendeeIds` 제공). 신규 회비 칩은 **그 달 회비 부과가 없는 회원만**(완납·부분납·이월 등 이미 부과된 회원 제외 — `void`=무효만 재부과). 금액 자동선택(§5). 한 트랜잭션(`dues_confirm_reconcile`).
  - **참가 예정(open) 세션 선납**: 아직 안 열린 `open` 대관 세션 중 **그 납부자가 확정 참가자(confirmed/late_pool)** 인 것만 "대관비(예정)" 칩으로. now 기준(선택 월 무관, `fetchUpcomingParticipating`). 이미 대관비 부과된(완납 포함) 세션은 제외. 선택 시 위 즉석 생성과 동일 경로로 부과·배분. 세션 취소/무산은 [회계]에서 수동 정리(자동 정리 없음).
  - **카테고리 분류**(콕공구 등) — 납부자 지정 시 그 회원 `paid_by`로 귀속(내 납부 이력에 표시).
  - **비회원(외부) 대관**: 회원 없이 세션 귀속 수입(`dues_confirm_court_external`).
- **출금 1건**: 카테고리 분류 / 코트대관(세션 지정) / 환불 연결. 코트대관 세션 후보 = 실제 열린 세션(`ledgerSessions`, ±1개월·경기기록) + **참가 예정(open) 세션(now 기준, `(예정)` 라벨)**. 미래 대관비 선지급은 세션이 아직 `open`(경기기록 없음)이라 `ledgerSessions`엔 없으므로 `upcomingSessions`(입금 선납과 동일 소스)를 병합해 노출 — 지정은 상태 검증 없는 `dues_set_txn_session` 재사용(신규 charge 생성 없음).
- **부분 처리**: 입금액 일부만 배분된 건은 구분 표시(남은 금액 추적).
- **환불 연결**: 입금(IN)↔환불 출금(OUT)을 `refund_of_tx_id`로 연결(`dues_link_refund`/`unlink`). 전액/부분 환불 모두. 잔여=입금−배분−환불.

### 3.3 회계 (`/dues/:ym/ledger`) — 월 통장 장부
- 그 달 **수입·지출·남은 돈** + 통장 잔액.
- **항목별 정산 = 월 통장 기준(현금주의).** 그 달 통장 거래를 버킷에 빠짐없이 한 번씩 담아 분해, **합 = 남은 돈**:
  - **걷은 회비**: 그 달 입금이 회비 부과에 배분된 금액(배분 기준).
  - **세션별 대관비**: 세션별 `그 달 세션거래(비회원 입금·대관 지출) + 그 달 입금의 코트 배분분`. **그 달 거래만** — 다른 달 선지급 대관료는 지급된 달 회계에(§6).
  - **카테고리별**(콕공구 등) 순액.
  - **환불**: 연결된 환불(`refund_of_tx_id`)은 **소스 입금과 상쇄** — 정상 전액환불이면 그 입금이 실효 0이 되어 항목별 정산에 안 뜸(±0). 소스 입금이 그 달에 없는(크로스먼스) 환불만 '환불' 잔여 라인으로.
  - **미분류**: 세션·카테고리·회비 어디에도 안 붙은 잔여(미매칭 입금 + 부분배분 잔액 + 미지정 출금). **부분/미스매치 환불의 잔액도 여기**(추적용) — 정상 환불은 상쇄돼 0, 이상하면 미분류로 남는다.
- **거래 원장**: 입출금 타임라인 + 러닝 잔액(통장 대사). 처리 거래 탭 → 처리 내역 + [취소·재처리](정산함 미처리로 되돌림). 필터: 전체/회비/세션별/환불/카테고리.

### 3.4 내 회비 (`/my-dues`, 회원) — 탭 2개
**탭 ① 내 회비 (`/my-dues`)**
- **회비 납부**: 미납 총액 + 항목별(전체 미납 — 이번 달만이 아님) + **입금 계좌 전체번호 + 복사**(`dues_club_account`, 로그인 회원 전용, 공용 `AccountCopyRow`).
- **미납 판정 단일 소스** = `components/dues/myUnpaid.ts` (`selectUnpaid`·`unpaidSum`·`chargeLabel`) — 이 탭과 진입 알림(§3.5)이 공유한다: `unpaid`/`partial`만, **대관비는 월 무관 전부**, **회비는 실효 월**(이월 `deferred_to` 없으면 `period_ym`)**이 이번 달 이하**인 것만(미래로 이월된 건 미노출). `waived`/`void`/완납은 status 필터에서 제외(§3.1 부과삭제와 자동 정합).
- **납부 이력**: **실제 낸 것만**(미납 제외). 입금 단위로 날짜·금액·용도(`7월 회비 · 7.12 대관비`). 소스 = 부과 배분 입금 + `paid_by` 카테고리 납부. RPC `dues_my_payments()`.

**탭 ② 클럽 회계 (`/my-dues/ledger`)**
- **항목별 정산만**(§3.3과 동일 월 통장 기준 → 합=남은 돈). `dues_public_ledger`. 개별 회원 미납·거래 원장은 제외(관리자 전용).
- **항목 행은 운영진 [회계]와 같은 컴포넌트**(`duesUi.LedgerRow`) — 이름 · **들어온/나간 돈 세부** · 순액. 세부는 **수입·지출이 양쪽 다 있는 항목만**(한쪽만이면 순액과 같은 숫자라 중복). 예: `7/12 TK배드민턴 대관비  +138,000 −180,000  −42,000원`.
- **통장 총수입/총지출은 띄우지 않는다.** 환불이 소스 입금과 상쇄되면(위 §3.3 규칙) 항목 +합·−합이 총수입·총지출보다 상쇄액만큼 작아져 합이 안 맞아 보인다. 순액(=남은 돈)만 불변식으로 정확히 일치하므로 카드 하단은 **이 달 남은 돈** 한 줄만 둔다.
- **월 스테퍼**: 지난달부터 뒤로, **`SERVICE_START_YM`(2026-07)까지만**. 서비스 시작 전 달은 통장 데이터가 미정리 상태라 회원에게 열지 않는다(왼쪽 화살표 비활성). **당월은 정산 중이라 비공개**(오른쪽 화살표 비활성, 안내 문구 없음). 하한·상한 계산은 `duesText.publicLedgerMaxYm()`/`SERVICE_START_YM` 단일 소스.

### 3.5 미납 진입 알림 (앱 전역 모달, `UnpaidDuesAlert`)

미납자가 앱을 열면 **낼 금액·항목·입금 계좌**를 모달로 먼저 보여준다(2026-08-08).

- **노출 조건**(전부 AND): 로그인 회원 · **프로필 완성**(미완성이면 Home 의 `ProfileSetup` 모달이 먼저 → 겹침 방지) · 미납 잔액 > 0(§3.4 판정 공유) · 이번 앱 실행에서 안 닫음 · 보드(`/session`) 아님(경기 운영 화면을 가리지 않음).
- **`/my-dues` 에선 안 뜨고 "봤음" 처리**(자동 dismiss) — 그 화면이 같은 내용을 이미 전면에 보여주므로 모달이 정보를 더하지 않고, 미납 푸시(`dues_unpaid`)·입금확인 푸시가 이 경로로 딥링크돼 미납자가 바로 착지하는 게 대표 경로다. 보고 나온 뒤 홈에서 다시 튀어나오지도 않는다.
- **내용**: 총 미납액 + 항목별(`8월 회비 5,000원` / `7. 12. 대관비 7,500원` — 라벨은 `chargeLabel`=클라 `fmtMD` 포맷, 게스트 대납분 포함) + 은행·계좌번호·예금주 + [복사] + [내 회비 보기](`/my-dues`) / [닫기]. 부분납은 **남은 금액**만.
- **해제 = 부과 상태뿐.** 정산(배분)되어 미납이 0이 되면 조건이 깨져 자연히 안 뜬다 — 별도 확인/해제 플래그 없음(팬텀 상태 금지, §0.5와 같은 원칙). 통장 대사는 운영진 수동이라 모달에 **"운영진이 통장 내역을 확인하면 사라진다"**를 명시(입금 직후 재노출을 오류로 오인하지 않게).
- **닫기는 이번 앱 실행에만 유효**(localStorage 미사용) → 미납이 남아있는 한 **앱을 열 때마다** 다시 뜬다. 앱 실행 중 화면 이동·백그라운드 복귀로는 재노출하지 않는다(포그라운드 복귀 재조회 없음).
- **조회**: `duesActions.checkUnpaidAlert(memberId)` — memberId 확정 시 1회(`unpaidAlertCheckedFor` 가드), `fetchMyCharges` + `fetchClubAccount` 병렬. `/my-dues`(`loadMine`)와 **별도 스토어 슬라이스**(`unpaidAlert*`)라 두 화면의 로드가 서로를 덮지 않는다. 로그아웃/계정 전환 시 `resetUnpaidAlert`로 스냅샷 폐기.

---

## 4. 부과 생성 (charge generation)

부과는 **발생 시점 이벤트**에서 자동 생성된다(전부 멱등 — 중복·유실 없음, 단일 규칙 재사용). 부과 생성은 **은행 내역 가져오기와 분리**돼 있다(통장 적재와 무관).
- **회비**: **월 첫 진입** 시 `dues_ensure_monthly(ym)` — 운영진이 이번 달 `/dues` 열면 생성(이미 있으면 no-op).
- **대관비**: **세션 종료(closed)** 시 트리거 `trg_session_court_on_close` → 그 세션 대관비(참석·당일취소 확정 후라 정확).
- **즉석**: 입금 확인 시 `dues_confirm_reconcile`가 낸 사람의 부과를 필요 시 신규 생성·배분. 아직 안 열린 `open` 세션 선납도 여기(세션 id만 넘기면 자격 게이팅 없이 생성). self-heal DELETE·종료 트리거 UPSERT 모두 `amount_paid=0` 게이트라 선납(배분됨)은 보존·무손상.
- **수동 배치**: `generate_dues_charges(ym)`(is_admin) — 과거 달 보정 등 fallback.

규칙 단일 소스(빌딩블록): `dues_generate_monthly(ym)`(회비) · `dues_generate_session_court(sid)`(세션 대관비). 트리거·ensure·수동배치가 모두 이 둘을 재사용.
- **회비 룰**: `is_active AND not is_guest AND not is_honorary AND not 운영진`, 가입월(`membership_started_at ?? created_at` + `offset_days`) 다음 달부터 `amount_due=회비액`.
  - **명예회원**(`members.is_honorary`, 회비 관리 설정에서 지정): 회비 면제. 지정/해제는 `dues_set_honorary(member,honorary,reason)`(is_admin). 플래그는 `members.is_honorary`(공개), 사유는 `member_honorary`(관리자 전용) 분리 저장. 회비엔 court 같은 자동 self-heal DELETE가 없으므로, **지정 시 이미 생성된 미납(`status=unpaid`) 회비를 이 RPC가 period_ym 무관 전월 정리**한다(납부·부분납·수동 waived/void는 보존, 현금주의 원장 무영향). **해제 시 삭제분은 복구되지 않는다**: 이후 '아직 부과가 없는 새 달'만 월진입 ensure가 자동 부과하고, 이미 부과가 있는 현월·과거월은 no-op이라 그 달만 `generate_dues_charges(ym)` 수동 배치로 재생성해야 한다.
- **대관비 룰**: 대관장소(`charges_court_fee`) + `status in (active,closed)` + **경기기록 있음**(무산 제외) 세션에 부과. **금액·대상 모두 총액 유무로 갈림**(§1.1):
  - **엔빵**(총액 `coalesce(세션,규칙) > 0`): `amount_due = 총액 ÷ 참석인원`(10원 버림). 대상 = **confirmed/late_pool 만**(당일취소 제외), **운영진 포함**. 분모(v_head)도 동일 집합.
  - **정액**(총액 없음): `amount_due = 6,000`. 대상 = **confirmed/late_pool + 당일 확정취소**, **운영진 제외**(현행).
  - 게스트는 `payer_hint=invited_by`. `amount_paid>0` 보존(선납). `dues_set_session_fee`(실제 총액 입력)는 저장 후 대관비를 재생성해 엔빵을 즉시 반영.
  - **당일취소 표식**: INSERT 시 `is_day_cancel = (attendances.status='cancelled')`로 세팅(정액 당일취소 분기로만 cancelled가 통과하므로 정확). 재실행(ON CONFLICT DO UPDATE)에도 `amount_due`와 함께 갱신되어 재확정 시 false로 복원.
  - self-heal 정리: **①무자격 세션의 미납분 전삭제** + **②자격 세션에서 '이번 부과 대상 술어(위 모드별)에 속하지 않는 회원'의 미납분** — 사전취소 유령 + 엔빵→정액 전환 운영진 고아 + **엔빵의 당일취소 제외분**까지 일괄. `amount_paid>0`(선납)은 보존. **①②(및 엔빵 head=0 삭제) 세 경로 모두 `status<>'void'` 가드** — 운영진이 부과삭제(void)한 건은 감사·면제 보존을 위해 어떤 자동정리에서도 지우지 않는다(세션 무자격 전이 후 재자격 시 재부과되어 면제가 사라지는 것 방지, 20260727130000).

---

## 5. 입금확인 금액 자동선택 규칙

납부자 지정 시 입금액으로 기본 선택 제안(관리자 조정 가능). **실제 부과 금액**으로 입금액에 정확히 떨어지는 부분집합을 찾는다(`matchExactSubset`, `reconcileMatch.ts` + 테스트):
- 후보 = (납부자·입금월) 회비 + 대관 풀(전원 기존미납 court + 참가확정 예정). 우선순위: 이번달기존0·다른달기존1·예정2, 회비 맨 앞.
- include-우선 완전탐색 → 고우선(이번달 기존미납·회비) 항목을 최대한 포함하는 정확 조합. 예: 7,500(엔빵) → 그 세션 대관비 1건 / 12,500 → 회비+엔빵 7,500 / 11,000 → 회비+정액대관 6,000 / 6,000 → 정액대관 1건.
- **정확히 안 떨어지면 아무것도 자동선택 안 함**(오선택 방지 → 관리자 수동). 완납/면제·게스트 회비 제외.
- (구) '정액 6,000 배수(`amount÷6000`)' 휴리스틱은 폐기 — 엔빵 대관비(6,000 비배수, 예 7,500)가 자동선택 안 되던 원인이었음(2026-07-19 수정).

---

## 6. 크로스먼스 (대관비 선/후지급)

- 대관비는 세션과 **다른 달에 지급**될 수 있다(예: 6/29 지급 → 7/5 세션). 출금 세션 매칭 후보 = **±1개월** 실제 열린 세션 + **참가 예정(open) 세션(now 기준)** — 선지급 시점엔 대상 세션이 아직 `open`(경기기록 0)이라 후자가 없으면 지정 자체가 불가했다(2026-07-20 출금 예정세션 노출 추가).
- **정모/현황(§3.1) = 세션 기준(발생주의)**: 세션 링크 지출은 발생월 무관 그 세션 순액에 포함 → "이 세션이 대관비를 회수했나".
- **회계(§3.3)·공개 회계(§3.4) = 월 통장 기준(현금주의)**: 6/29 지급분은 6월 회계에, 7월엔 7월 대관 수입만 → 월 항목별 합 = 그 달 남은 돈.

---

## 7. 은행내역 수집·파싱

- **수집**: 관리자 [가져오기] → Edge Function `ingest-bank-email` → **Apps Script 웹앱**(은행 메일 Gmail에 배포, `x-ingest-secret`)이 라벨 스레드 원문만 반환 → Edge Function이 `service_role`로 파싱·멱등 삽입. DNS 무변경·OAuth 만료 회피·수동 버튼(크론 없음).
- **파싱**: 금액=`bigint` 원 정수(float 금지), 시각=Asia/Seoul 고정, EUC-KR/CP949 디코드 주의. 원문 선저장(`raw_bank_emails`). `dedup_key`로 거래 멱등.
- **현재 범위**: **토스 단일 파서**(`ingest-bank-email/toss.ts`). 다은행 어댑터 레지스트리·LLM 폴백·골든 테스트는 미구현(§13).

---

## 8. 정산·배분 (직접 확인 방식)

- **관리자 직접 확인**이 원칙 — 자동 제안/신뢰도 스코어링/보류 큐/학습 별칭은 **없음**(옛 설계에서 폐기, §13). 이름 매칭은 클라이언트 fuzzy 제안(`matching.ts suggestMembers`: 정확일치>부분>초성)으로 후보만 띄우고, 배분·확정은 사람이 한다.
- 배분은 **가역 레코드**(`dues_allocations`) — 취소·재처리 안전(카운터 롤백 문제 차단). 트리거 불변식: ①거래 배분 합 ≤ 거래액 ②`charge.amount_paid=Σalloc` 재계산→status ③`bank_tx.status` 갱신.
- **취소 경고**: 이미 나간 입금확인 푸시는 회수 불가 → 확인 다이얼로그에서 "회원에게 직접 안내" 안내.

---

## 9. 알림

- `payment_confirmed` — 입금 처리 시 해당 회원(비게스트)에게.
- `dues_unpaid` — 미납 알림. **카테고리 그룹 단위 선택 발송만**(`dues_notify_selected`, 대상 배열 + 커스텀 문구). 전체 일괄 발송 없음.
- (참고) 일정 open 시 전 회원 푸시 등은 스케줄 도메인.

---

## 10. 권한/보안

- 모든 쓰기는 `SECURITY DEFINER` RPC + `is_admin()` 가드. 조회는 RLS.
- 회원 노출 RPC(`dues_my_payments`·`dues_public_ledger`·`dues_club_account`)는 `current_member_id()` 기반 + **`anon` execute revoke**(로그인 열람 불변식). 비로그인은 빈 결과/차단.
- `dues_charges`/`dues_allocations`는 관리자 or 본인(payer_hint 포함) 열람. **본인 화면 쿼리엔 본인 필터 필수**(관리자 계정 오노출 방지).
- `member_honorary`(명예회원 사유)는 **is_admin RLS로 조회 제한**(사유=운영진 메모 비공개). `members.is_honorary` 플래그 자체는 명단 모델상 로그인 회원 조회 허용. 쓰기는 `dues_set_honorary` RPC만.
- 게스트는 `auth_user_id` 없어 푸시 대상 제외. 클럽 계좌 전체번호는 로그인 회원에게만.

---

## 11. 쿼리 전략 (성능)

- **월 공통 1회 로드 + ym 캐시**: `duesStore.loadMonth(ym)`가 정모·정산함·회계 공통 데이터를 병렬 로드하고 `loadedYm`로 캐시 — 화면 전환 재조회 없음. wave1(병렬 8) + wave2(세션 id 필요분 병렬 2, 배분은 그 달 거래로 스코프).
- **부분 갱신**: charge 바꾸는 뮤테이션→`refreshMonth`, tx만 바꾸는 뮤테이션→`refreshTxns`(정적 데이터 재조회 안 함, 깜빡임 없음).
- **집계는 서버 RPC**: 회원 공개 회계는 `dues_public_ledger`(현금주의 분해). 관리자 회계 항목별은 로드한 `bankTxns+txAllocations`를 클라에서 분해(각 Ledger 하위 컴포넌트가 필요한 스토어 슬라이스만 구독 → 리렌더 격리).
- **loadMonth 단일 스냅샷 RPC는 채택 안 함**: `refresh*`와 fetch 로직 이중 유지 부담 + 병렬이라 왕복 이득 작음. 병렬 fetch 유지.

---

## 12. 핵심 RPC (현재 live)

- **확정/취소**: `dues_confirm_reconcile`(미납 배분+신규 생성 통합), `dues_confirm_court_external`(비회원 대관), `dues_cancel_match`.
- **분류/지정**: `dues_set_txn_category`(+`p_paid_by`), `dues_set_txn_session`, `dues_link_refund`/`dues_unlink_refund`.
- **이월**: `dues_defer_charge`/`dues_undefer_charge`/`dues_settle_deferred`.
- **부과 조정**: `dues_set_charge_status`(`void`=부과삭제·취소선 + `voided_by/at` 기록 / `reset`=되돌리기·재산정 / `waived`=면제).
- **부과**: `dues_ensure_monthly`(월진입 회비), `generate_dues_charges`(수동 배치 fallback), 빌딩블록 `dues_generate_monthly`·`dues_generate_session_court`(내부), 트리거 `trg_session_court_on_close`(세션 종료 대관). **명예회원**: `dues_set_honorary`(지정/해제 + 미납 회비 정리). **알림**: `dues_notify_selected`.
- **카테고리**: `dues_add_category`/`dues_delete_category`.
- **회원 노출**: `dues_my_payments`, `dues_public_ledger`, `dues_club_account`.
- **트리거/내부**: `dues_alloc_guard`·`dues_alloc_sync`(dues_allocations 트리거), `dues_sync_bank_tx`(status 동기 헬퍼).

---

## 13. 알려진 갭 / 정리 대상

**미구현(계획엔 있었으나 안 만듦)**
- **다은행 파서 어댑터 레지스트리 / LLM 폴백 / 골든 테스트**(§7) — 현재 토스 단일 파서.
- **`dues_policies`(금액 정책 이력)** — 미생성. 금액은 `dues_settings` 단일값 + charge 스냅샷.

**죽은 자산** — 모두 정리됨(2026-07-15): `dues_match_queue`(행 0), `member_name_aliases`(휴면 33행, `dues_cancel_match`에서 참조 제거 후 drop) 삭제 완료.

**의도적 폐기(과거 설계 → 현행 대체, 재도입 아님)**
- 자동 제안+신뢰도 매칭·보류 큐·학습 별칭 → **직접 확인**(§8).
- 현금 납부(`dues_manual_payment`) → **통장 전용**(§0).
- `dues_confirm_match`/`new_*`/`compose` → `dues_confirm_reconcile` 통합. `expense_categories` → `txn_categories`. 구 3탭 UI → 4화면.
