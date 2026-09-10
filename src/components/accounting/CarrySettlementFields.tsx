import type { ReactNode } from "react";
import type { AccountingData } from "../../lib/dues/types";
import { won } from "../../lib/dues/duesText";
import { SettlementAmount, SettlementField } from "./SettlementForm";
import SettlementChoice from "./SettlementChoice";

/** Only carry inputs; the parent owns the receipt, operation draft and confirmation. */
export default function CarrySettlementFields({
	month,
	onMonth,
	owner,
	dues,
	positions,
	bankId,
	money,
	onMoney,
	needsMonthChange,
	changeMonth,
	onChangeMonth,
}: {
	month: string;
	onMonth: (month: string) => void;
	owner: string;
	dues: ReactNode;
	positions: AccountingData["positions"];
	bankId: number;
	money: Record<string, string>;
	onMoney: (money: Record<string, string>) => void;
	needsMonthChange: boolean;
	changeMonth: boolean;
	onChangeMonth: (checked: boolean) => void;
}) {
	return (
		<>
			<SettlementField label="이월할 월" input>
				<input
					className="ac-settlement-month"
					type="month"
					value={month}
					onChange={(e) => onMonth(e.target.value)}
				/>
			</SettlementField>
			{owner && (
				<>
					{dues && (
						<SettlementField label="이월할 미납">{dues}</SettlementField>
					)}
					<SettlementField label="이월할 입금">
						<div
							className="ac-receipt-dues"
							role="group"
							aria-label="이월할 입금 선택"
						>
							{positions.map((p) => (
								<div key={p.id} className="ac-quick-due">
									<SettlementChoice
										title={
											p.bank_tx_id === bankId
												? "이 입금"
												: `입금 #${p.bank_tx_id}`
										}
										amount={won(p.amount)}
										selected={!!money[p.id]}
										label={`${p.bank_tx_id === bankId ? "이 입금" : `입금 #${p.bank_tx_id}`} · ${won(p.amount)}`}
										onSelect={() =>
											onMoney({
												...money,
												[p.id]: money[p.id] ? "" : String(p.amount),
											})
										}
									/>
									{money[p.id] && (
										<label className="ac-quick-amount">
											<span>이월 금액</span>
											<SettlementAmount
												value={money[p.id]}
												onChange={(value) =>
													onMoney({ ...money, [p.id]: value })
												}
												label={`입금 ${p.bank_tx_id} 이월 금액`}
												max={p.amount}
											/>
										</label>
									)}
								</div>
							))}
							{!positions.length && (
								<p className="ac-caption">이월할 입금 잔액이 없습니다.</p>
							)}
						</div>
					</SettlementField>
				</>
			)}
			{needsMonthChange && (
				<label className="ac-check ac-receipt-month-change">
					<input
						type="checkbox"
						checked={changeMonth}
						onChange={(e) => onChangeMonth(e.target.checked)}
					/>
					기존 납기를 앞당기거나 이월 월을 변경함
				</label>
			)}
		</>
	);
}
