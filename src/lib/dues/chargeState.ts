import type { Charge } from "./types";

/** Cancelled payment history that no longer blocks future court issuance. */
export function isReversedPrepayment(charge: Charge) {
	return (
		charge.state === "cancelled" &&
		charge.basis?.prepayment === true &&
		charge.basis?.prepayment_reversed === true
	);
}
