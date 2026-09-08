import { RefundPicker, duesFixture } from "cocktime-scheduler";

const empty = {
	memberId: "",
	bankId: "",
	confirmedOwner: false,
	external: false,
};
/** 오입금을 돌려주는 출금 — 적요가 회원 이름이라 후보가 바로 좁혀진다. */
const REFUND_OUT = 97;

/** 1단계: 돌려받는 납부자 고르기(적요로 후보가 좁혀진 상태). */
export const PickPayer = () => (
	<RefundPicker
		compact
		data={duesFixture}
		outTxId={REFUND_OUT}
		value={empty}
		onChange={() => {}}
	/>
);

/** 2단계: 납부자를 고른 뒤 — 그 사람의 원입금 중 환불 가능한 건만 후보로 남는다. */
export const PickSourceDeposit = () => (
	<RefundPicker
		compact
		data={duesFixture}
		outTxId={REFUND_OUT}
		value={{ ...empty, memberId: duesFixture.members[1].id }}
		onChange={() => {}}
	/>
);
