import { QuickSettlement, duesFixture } from "cocktime-scheduler";

const done = async () => {};
const noop = () => {};
const unassigned = duesFixture.positions[0].id;
const memberBalance = duesFixture.positions[1].id;

/** 입금을 미납에 연결하는 기본 흐름 — 납부자·항목·금액·사유가 한 카드에서 끝난다. */
export const PayLink = () => (
	<QuickSettlement
		data={duesFixture}
		draft={{ type: "pay", positionId: unassigned }}
		bankId={90}
		disabled={false}
		onDone={done}
		onClose={noop}
		onPendingChange={noop}
	/>
);

/** 미납·입금을 다음 달로 넘기는 흐름. */
export const CarryForward = () => (
	<QuickSettlement
		data={duesFixture}
		draft={{ type: "carry", positionId: memberBalance }}
		bankId={91}
		disabled={false}
		onDone={done}
		onClose={noop}
		onPendingChange={noop}
	/>
);

/** 입금 잔액의 용도를 바꾸는 흐름(회원 잔액·환불 대기·직접 수입·미귀속). */
export const AssignPurpose = () => (
	<QuickSettlement
		data={duesFixture}
		draft={{ type: "position", positionId: memberBalance }}
		bankId={91}
		disabled={false}
		onDone={done}
		onClose={noop}
		onPendingChange={noop}
	/>
);
