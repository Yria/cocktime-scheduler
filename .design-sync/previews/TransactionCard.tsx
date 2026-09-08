import { TransactionCard, duesFixture } from "cocktime-scheduler";

const noop = () => {};
const done = async () => {};
const tx = (id: number) => duesFixture.bank.find((t) => t.id === id)!;

/** 적요가 회원 한 명과만 맞고 미납 금액도 같은 입금 — 확인 한 번으로 끝나는 건. */
export const SuggestedMatch = () => (
	<TransactionCard
		data={duesFixture}
		transaction={tx(90)}
		disabled={false}
		onDone={done}
		onPendingChange={noop}
		onMonth={noop}
	/>
);

/** 미납보다 큰 입금 — 남은 잔액을 어디에 얹을지 판단이 필요한 건. */
export const SurplusDeposit = () => (
	<TransactionCard
		data={duesFixture}
		transaction={tx(91)}
		disabled={false}
		onDone={done}
		onPendingChange={noop}
		onMonth={noop}
	/>
);

/** 대관료 출금 — 지출 항목에 귀속하는 건. */
export const OutgoingExpense = () => (
	<TransactionCard
		data={duesFixture}
		transaction={tx(95)}
		disabled={false}
		onDone={done}
		onPendingChange={noop}
		onMonth={noop}
	/>
);

/** 이미 납부로 연결된 입금 — 되돌리기만 남은 건(회계 탭에서 펼쳤을 때의 모습). */
export const SettledDeposit = () => (
	<TransactionCard
		data={duesFixture}
		transaction={tx(87)}
		disabled={false}
		origin="회계"
		onDone={done}
		onPendingChange={noop}
		onMonth={noop}
	/>
);
