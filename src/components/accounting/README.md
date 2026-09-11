# 정산 컴포넌트

정산함과 회계 상세는 같은 `TransactionCard` → `QuickSettlement` 경로를 사용한다.
작업 종류나 진입 탭에 따라 카드 크기와 머리글을 다시 정의하지 않는다.

| 컴포넌트 | 책임 |
| --- | --- |
| `TransactionCard` | 거래의 대기/완료 상태, 처리 내역, 작업 진입과 완료 후 목록 갱신. 편집 중에는 자체 머리글을 그리지 않는다. |
| `QuickSettlement` | 선택 상태, 작업 전환, 명령 생성과 검증. 보조 작업을 닫아도 납부·지출 초안을 유지한다. |
| `SettlementForm` | 공통 머리글, 편집 패널, 라벨/입력 행, 금액 입력, 메모. 저장 로직을 갖지 않는다. |
| `SettlementConfirmation` | 모든 작업의 확인 버튼, 검증 메시지, 처리 중 상태와 재확인 UI. |
| `SettlementChoice` | 납부·이월·환불에서 공유하는 항목 선택 컨트롤. 제목·보조 정보·금액과 선택 색상을 통일하며 환불에서는 네이티브 라디오 동작을 유지한다. |
| `SettlementOptions` | 추가 작업과 같은 거래의 다른 잔액 선택. |
| `PaymentSettlementFields` / `CarrySettlementFields` / `PositionSettlementFields` | 각 작업의 입력과 선택값 표시. 카드 머리글·메모·확인 버튼을 중복 생성하지 않는다. |
| `SettlementTargetPicker` | 납부 항목과 이월할 미납의 공통 선택 및 부분 금액 입력. |
| `SettlementGroupPicker` | 지출과 직접 수입에서 재사용하는 항목 검색. |
| `RefundPicker` | 환불받을 사람과 원입금 선택. 회원에게 귀속된 잔액과 이름이 일치하는 미정산 입금을 함께 제안하고, 미확인 입금은 실제 납부자 확인 후 환불한다. 거래 머리글은 부모가 제공하며 부과 전표에서도 재사용한다. |
| `MemberPicker` | 회원 검색과 식별. 환불에서는 미납자 필터를 사용하지 않는다. |
| `useInlineAccounting` | 서버 미리보기·확정, revision 검증, 응답 유실 시 같은 요청으로 재확인. |

새 정산 작업은 공통 `SettlementEditor` 안에 입력만 추가한다. 글자·간격·컨트롤 크기는
`accounting-layout.css`의 공통 receipt/editor 규칙을 사용한다. 운영진 화면(`/dues`)에는
그 위에 `accounting-home.css`(홈 톤 스킨)가 색·표면·컨트롤·활자만 덮어쓴다 —
기하는 건드리지 않으므로 새 입력을 만들 때 참조할 크기 기준은 여전히 layout 쪽이다.
스킨 규칙은 전부 `.accounting-screen.ac-layout-v2` 스코프라 회원 화면에는 닿지 않는다
(`docs/ACCOUNTING_SPEC.md` §3.7). 거래 데이터 변경은
`QuickSettlement`와 `useInlineAccounting` 경로를 거친다.

## 회원 화면

| 컴포넌트 | 책임 |
| --- | --- |
| `MyDuesPage` (`components/dues/`) | 로그인·회계 모드 게이트. 준비되지 않았으면 아무것도 그리지 않는다. |
| `AccountingMember` | 회원 화면 전부 — 달 선택(탭별로 따로), 두 탭, 달 카드·알림·납부 내역 배치. 기본 export 와 파일 경로는 `.design-sync/config.json` 이 고정하므로 옮기지 않는다. 같은 파일의 `AccountingEntryAlert`(진입 알림)도 `UnpaidDuesAlert` 가 이름으로 가져간다. |
| `AccountCard` (`components/dues/`) | 입금 계좌 카드와 복사. 계좌 값은 받아서 그리기만 한다. |
| `CashLedgerView` | 클럽 통장 요약과 항목별 수지. 운영진 회계 탭과 **공유**하므로 회원 전용 문구·행을 이 안에 넣지 않는다(회원 전용 안내는 `AccountingMember` 가 시트 밖에 붙인다). 운영진은 `buckets={false}` 로 통장 카드만 받고 항목은 `TransactionLedger` 의 필터 칩이 그린다 — 같은 조회를 두 번 하지 않도록 항목 줄은 `onLines` 로 올려 준다. |
| `src/lib/dues/myDues.ts` | 회원 화면의 달 단위 집계(부과 달 기준). 화면은 계산하지 않고 이 결과만 그린다. `memberSummary`(오늘 기준 낼 돈)와 역할이 다르다 — 달을 넘는 미납·이월은 그쪽이 말한다. |

회원 화면도 운영진과 같은 세 파일(`accounting.css` → `accounting-layout.css` →
`accounting-home.css`)을 같은 순서로 읽고 `.ac-layout-v2` 를 달아 **홈 톤**으로 그린다
(2026-09-11). 회원 고유 기하는 `accounting.css` §11(`.ac-mine-*`)에만 두고, 운영진 전용
래퍼 `.ac-ledger-page` 는 빌려 쓰지 않는다(회원은 `.ac-mine-ledger`).
자세한 계약은 `docs/ACCOUNTING_SPEC.md` §3.4·§3.7.

정식 원장 API는 `src/lib/supabase/dues.ts`, 공유 상태는 `src/store/duesStore.ts`를 사용한다.
계산·선택·참석 규칙은 `src/lib/dues/`, 설정·계좌·입금 수집은 `src/lib/supabase/duesSettings.ts`에 둔다.
`DuesSettingsModal`과 `HonoraryMembersSection`은 이 화면군의 공통 설정이며 이전 금융 store를 참조하지 않는다.
