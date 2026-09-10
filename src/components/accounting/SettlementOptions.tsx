import type { ReactNode } from "react";
import type { AccountingData } from "../../lib/dues/types";
import { purposeLabel } from "../../lib/dues/types";
import { memberLabel } from "../../lib/dues/summary";
import { won } from "../../lib/dues/duesText";
import type { OperationDraft } from "./OperationDialog";

export default function SettlementOptions({
	id,
	data,
	bankId,
	draft,
	savedExpense,
	history,
	onAction,
}: {
	id: string;
	data: AccountingData;
	bankId: number;
	draft: OperationDraft;
	savedExpense: boolean;
	history?: ReactNode;
	onAction: (draft: OperationDraft) => void;
}) {
	const source = data.positions.find((p) => p.id === draft.positionId);
	const others = data.positions.filter(
		(p) => p.bank_tx_id === bankId && p.id !== source?.id && p.amount > 0,
	);
	return (
		<div id={id} className="ac-quick-options ac-receipt-tools">
			{history}
			<div className="ac-choice-chips" role="group" aria-label="다른 정산 방법">
				{source && (
					<>
						{["unassigned", "member_pending", "carry"].includes(
							source.purpose,
						) && (
							<button
								type="button"
								className="ac-chip"
								onClick={() =>
									onAction({ type: "carry", positionId: source.id })
								}
							>
								이월
							</button>
						)}
						<button
							type="button"
							className="ac-chip"
							onClick={() =>
								onAction({ type: "position", positionId: source.id })
							}
						>
							용도 지정
						</button>
					</>
				)}
				{draft.type === "expense" && !savedExpense && (
					<button
						type="button"
						className="ac-chip"
						onClick={() => onAction({ type: "refund", outTxId: bankId })}
					>
						환불 연결
					</button>
				)}
			</div>
			{source && others.length > 0 && (
				<div
					className="ac-choice-chips"
					role="group"
					aria-label="이 입금의 다른 잔액"
				>
					{others.map((p) => (
						<button
							key={p.id}
							type="button"
							className="ac-chip"
							onClick={() =>
								onAction({
									type: ["unassigned", "member_pending", "carry"].includes(
										p.purpose,
									)
										? "pay"
										: "position",
									positionId: p.id,
								})
							}
						>
							{purposeLabel[p.purpose]} ·{" "}
							{p.owner_id ? `${memberLabel(data, p.owner_id)} · ` : ""}
							{won(p.amount)}
						</button>
					))}
				</div>
			)}
		</div>
	);
}
