import type { Dispatch, SetStateAction } from "react";
import type { PaymentTarget } from "../../lib/dues/quickSettlement";
import { amountInputProps } from "../../lib/dues/amountInput";
import { won } from "../../lib/dues/duesText";
import { SettlementAmount } from "./SettlementForm";
import SettlementChoice from "./SettlementChoice";

/** One target selector for payment allocation and carried debt, including partial amounts. */
export default function SettlementTargetPicker({
	targets,
	selected,
	onChange,
	mode,
	available,
	detailed,
	targetName,
}: {
	targets: PaymentTarget[];
	selected: Record<string, string>;
	onChange: Dispatch<SetStateAction<Record<string, string>>>;
	mode: "pay" | "carry";
	available: number;
	detailed: boolean;
	targetName: (target: PaymentTarget) => string;
}) {
	const total = Object.values(selected).reduce(
		(sum, amount) => sum + Number(amount || 0),
		0,
	);
	const rest = Math.max(0, available - total);
	const carry = mode === "carry";
	return (
		<div
			className="ac-quick-dues ac-receipt-dues"
			role="group"
			aria-label={carry ? "이월할 미납 선택" : "납부할 항목 선택"}
		>
			{targets.map((d) => (
				<div
					key={d.id}
					className={`ac-quick-due ${selected[d.id] ? "is-selected" : ""}`}
				>
					<SettlementChoice
						title={targetName(d)}
						detail={
							d.prepayment
								? `예정 대관 · 선납${Number(selected[d.id] || 0) > 0 && Number(selected[d.id]) < d.remaining ? ` · ${won(d.remaining)} 중 일부 납부` : ""}`
								: carry
									? `${Number(d.due_ym.slice(5))}월 납기 · ${won(d.remaining)} 남음`
									: undefined
						}
						amount={won(selected[d.id] ? Number(selected[d.id]) : d.remaining)}
						selected={!!selected[d.id]}
						label={`${targetName(d)}${d.prepayment ? " · 선납" : ""} · ${d.due_ym} 납기 · ${won(selected[d.id] ? Number(selected[d.id]) : d.remaining)}`}
						disabled={!carry && !selected[d.id] && total >= available}
						onSelect={() =>
							onChange((before) => ({
								...before,
								[d.id]: before[d.id]
									? ""
									: String(carry ? d.remaining : Math.min(d.remaining, rest)),
							}))
						}
					/>
					{detailed && !carry && !selected[d.id] && total >= available && (
						<span className="ac-quick-amount">입금 잔액 없음</span>
					)}
					{(detailed || carry) &&
						selected[d.id] !== undefined &&
						selected[d.id] !== "" && (
							<label className="ac-quick-amount">
								{carry ? (
									<>
										<span>이월 금액</span>
										<SettlementAmount
											value={selected[d.id]}
											onChange={(value) =>
												onChange({ ...selected, [d.id]: value })
											}
											label={`${targetName(d)} 선택 금액`}
											max={d.remaining}
										/>
									</>
								) : (
									<>
										<input
											type="number"
											aria-label={`${targetName(d)} 선택 금액`}
											min="1"
											max={d.remaining}
											value={selected[d.id]}
											{...amountInputProps}
											onChange={(e) =>
												onChange({ ...selected, [d.id]: e.target.value })
											}
										/>
										원
									</>
								)}
							</label>
						)}
					{detailed &&
						!carry &&
						!!selected[d.id] &&
						Number(selected[d.id]) < d.remaining &&
						rest > 0 && (
							<button
								type="button"
								className="ac-chip"
								aria-label={`남은 잔액 ${won(rest)} 전부 사용`}
								onClick={() =>
									onChange((before) => ({
										...before,
										[d.id]: String(
											Math.min(d.remaining, Number(before[d.id] || 0) + rest),
										),
									}))
								}
							>
								+{won(rest)}
							</button>
						)}
				</div>
			))}
		</div>
	);
}
