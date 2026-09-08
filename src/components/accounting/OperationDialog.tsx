import type { AccountingCommand } from "../../lib/dues/v2/types";

/**
 * 회계 처리 한 건의 초안. 정산함은 카드 안에서(QuickSettlement), 부과 탭은 전표로
 * (ChargeVoucher) 같은 초안을 소비한다 — 모달은 더 쓰지 않는다.
 *
 * pay/position/refund/expense 는 정산함 카드가, issue/replace/carry/simple 은 부과
 * 탭 전표가 처리한다.
 */
export interface OperationDraft {
	type:
		| "issue"
		| "replace"
		| "carry"
		| "pay"
		| "position"
		| "refund"
		| "expense"
		| "simple";
	chargeIds?: string[];
	memberId?: string;
	positionId?: string;
	outTxId?: number;
	candidate?: AccountingCommand;
	command?: AccountingCommand;
}
