import { CashLedgerView } from "cocktime-scheduler";

/** 월 장부 — 수입·지출·순액과 항목별 내역. 항목 행을 누르면 아래 거래 목록이 좁혀진다. */
export const MonthlyLedger = () => (
	<CashLedgerView ym="2026-09" revision={42} onPickGroup={() => {}} />
);

/** 항목 연결이 없는 읽기 전용 모드(회원 공개 회계에서 쓰는 모습). */
export const ReadOnly = () => <CashLedgerView ym="2026-09" revision={42} />;
