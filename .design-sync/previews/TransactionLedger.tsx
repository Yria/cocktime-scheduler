import { TransactionLedger, duesFixture } from "cocktime-scheduler";

const done = async () => {};
const noop = () => {};

/** 통장 대사 목록 — 금액·잔액이 고정 폭 레일에 떨어져 자릿수가 세로로 겹친다. */
export const AllTransactions = () => (
	<TransactionLedger
		data={duesFixture}
		ym="2026-09"
		disabled={false}
		settling={false}
		filter="all"
		onFilter={noop}
		onDone={done}
		onPendingChange={noop}
		onMonth={noop}
	/>
);

/** 미정산만 남긴 상태 — 필터 칩이 잉크 반전으로 선택을 말한다. */
export const PendingOnly = () => (
	<TransactionLedger
		data={duesFixture}
		ym="2026-09"
		disabled={false}
		settling={false}
		filter="pending"
		onFilter={noop}
		onDone={done}
		onPendingChange={noop}
		onMonth={noop}
	/>
);
