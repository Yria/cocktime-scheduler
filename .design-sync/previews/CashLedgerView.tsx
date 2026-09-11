import { CashLedgerView } from "cocktime-scheduler";

/** 월 장부 — 수입·지출·순액과 항목별 내역(회원 공개 회계에서 쓰는 모습). */
export const MonthlyLedger = () => (
	<CashLedgerView ym="2026-09" revision={42} />
);

/** 운영진 회계 탭 — 항목은 거래 내역 안의 필터 칩이 맡으므로 통장 카드만 그린다. */
export const SummaryOnly = () => (
	<CashLedgerView ym="2026-09" revision={42} buckets={false} />
);
