import { won } from "./duesText";
import type { AccountingCommand, AccountingData, BillingGroup, Charge } from "./types";

/**
 * 부과 탭 [부과 변경] → 행의 [금액 변경]: 한 사람의 부과 금액만 바꾸는 규칙.
 * 서버 `replace` 를 그대로 쓴다 — 원부과는 취소로 남고, 이미 낸 돈은 같은 회원의 새 부과에 다시 연결된다.
 */

/** 이 부과에 실제로 들어온 돈(되돌린 배분 제외). */
export function chargePaid(data: AccountingData, chargeId: string) {
	return data.allocations
		.filter((a) => a.charge_id === chargeId)
		.reduce((sum, a) => sum + a.amount - a.reversed, 0);
}

/**
 * 간단 변경이 가능한 부과인지 — 납기가 여러 달로 나뉜(분납) 부과는 납기별 금액을
 * 정해야 하므로 전체 전표로 보낸다.
 */
export function simpleAmountEditable(data: AccountingData, chargeId: string) {
	const months = new Set(
		data.due.filter((d) => d.charge_id === chargeId).map((d) => d.due_ym),
	);
	return months.size <= 1;
}

/** 새 금액을 저장했을 때의 결과 — 남는 미납, 넘치는 돈(회원 잔액으로). */
export function amountEditOutcome(paid: number, amount: number) {
	return {
		remaining: Math.max(0, amount - paid),
		overflow: Math.max(0, paid - amount),
	};
}

export function chargeAmountCommand(
	data: AccountingData,
	group: BillingGroup,
	charge: Charge,
	memberName: string,
	amount: number,
	fallbackYm: string,
): AccountingCommand {
	const dueYm =
		data.due
			.filter((d) => d.charge_id === charge.id)
			.map((d) => d.due_ym)
			.sort()[0] ?? fallbackYm;
	return {
		action: "replace",
		reason: `${group.label} · ${memberName} 금액 변경 ${won(charge.amount)} → ${won(amount)}`,
		charge_ids: [charge.id],
		lines: [
			{
				member_id: charge.member_id,
				amount,
				due_ym: dueYm,
				previous_id: charge.id,
				payer_hint: charge.payer_hint,
			},
		],
		basis: { amount_edit: true },
	};
}
