import type { ReactNode } from "react";
import { Check } from "lucide-react";
import type { FundPurpose } from "../../lib/dues/types";
import { SettlementAmount, SettlementField } from "./SettlementForm";

const purposes = [
	["member_pending", "회원 잔액"],
	["refund_pending", "환불 대기"],
	["club", "직접 수입"],
	["unassigned", "미귀속"],
] as const;

export default function PositionSettlementFields({
	purpose,
	onPurpose,
	amount,
	onAmount,
	max,
	groups,
}: {
	purpose: FundPurpose;
	onPurpose: (purpose: FundPurpose) => void;
	amount: string;
	onAmount: (amount: string) => void;
	max?: number;
	groups: ReactNode;
}) {
	return (
		<>
			<SettlementField label="용도">
				<div
					className="ac-choice-chips ac-receipt-purpose-options"
					role="group"
					aria-label="입금 용도 선택"
				>
					{purposes.map(([id, label]) => (
						<button
							key={id}
							type="button"
							className="ac-chip"
							aria-pressed={purpose === id}
							onClick={() => onPurpose(id)}
						>
							<span>{label}</span>
							{purpose === id && <Check size={14} aria-hidden="true" />}
						</button>
					))}
				</div>
			</SettlementField>
			{purpose === "club" && (
				<SettlementField label="수입 항목">{groups}</SettlementField>
			)}
			<SettlementField label="변경할 금액" input>
				<SettlementAmount
					value={amount}
					onChange={onAmount}
					label="변경할 금액"
					max={max}
				/>
			</SettlementField>
		</>
	);
}
