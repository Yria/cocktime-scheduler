import type { ReactNode } from "react";
import { won } from "../../lib/dues/duesText";

export default function PaymentSettlementFields({
	available,
	selected: debts,
	children,
}: {
	available: number;
	selected: Record<string, string>;
	children: ReactNode;
}) {
	const selectedTotal = Object.values(debts).reduce(
		(sum, amount) => sum + Number(amount || 0),
		0,
	);
	const restAfterSelected = Math.max(0, available - selectedTotal);
	return (
		<div className="ac-payment-targets">
			<div className="ac-allocation-summary" aria-label="입금 배분 요약">
				<div className="ac-allocation-meter" aria-hidden="true">
					{Object.entries(debts)
						.filter(([, n]) => Number(n) > 0)
						.map(([id, n]) => (
							<span
								key={id}
								style={{
									width: `${Math.min(100, (Number(n) / (available || 1)) * 100)}%`,
								}}
							/>
						))}
				</div>
				<p>
					<span>
						{selectedTotal > available
							? "! 입금 잔액 초과"
							: restAfterSelected > 0
								? `입금 잔액 ${won(restAfterSelected)}${selectedTotal ? " 보관" : ""}`
								: "✓ 남는 돈 없음"}
					</span>
					<strong className="ac-number">{won(selectedTotal)}</strong>
				</p>
			</div>
			{children}
		</div>
	);
}
