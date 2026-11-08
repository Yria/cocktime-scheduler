import { useEffect, useRef, useState } from "react";
import {
	amountEditOutcome,
	chargeAmountCommand,
	chargePaid,
} from "../../lib/dues/chargeAmountEdit";
import { won } from "../../lib/dues/duesText";
import { memberLabel } from "../../lib/dues/summary";
import type { AccountingData, BillingGroup, Charge } from "../../lib/dues/types";
import { accountingError } from "../../lib/supabase/dues";
import { randomId } from "../../lib/randomId";
import { duesActions } from "../../store/duesStore";
import AccountingDetailModal from "./AccountingDetailModal";

/**
 * 한 사람의 부과 금액만 바꾼다(부과 변경 → 행의 [금액 변경]).
 * 새 금액 하나만 받고, 이미 낸 돈이 어떻게 되는지 바로 보여 준 뒤 저장한다.
 */
export default function ChargeAmountEdit({
	data,
	group,
	charge,
	onClose,
}: {
	data: AccountingData;
	group: BillingGroup;
	charge: Charge;
	onClose: () => void;
}) {
	const name = memberLabel(data, charge.member_id);
	const paid = chargePaid(data, charge.id);
	const [value, setValue] = useState(String(charge.amount));
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	const input = useRef<HTMLInputElement>(null);
	// 모달이 닫기 버튼에 먼저 초점을 주므로 다음 프레임에 금액 칸으로 옮긴다.
	useEffect(() => {
		const id = requestAnimationFrame(() => {
			input.current?.focus({ preventScroll: true });
			input.current?.select();
		});
		return () => cancelAnimationFrame(id);
	}, []);

	const amount = Number(value);
	const valid = value !== "" && Number.isSafeInteger(amount) && amount > 0;
	const changed = valid && amount !== charge.amount;
	const outcome = valid ? amountEditOutcome(paid, amount) : null;

	const save = async () => {
		if (!changed || busy) return;
		setBusy(true);
		setError("");
		try {
			await duesActions.commit(
				chargeAmountCommand(
					data,
					group,
					charge,
					name.split(" · ")[0],
					amount,
					group.occurred_on.slice(0, 7),
				),
				randomId(),
				data.mode.revision,
			);
			onClose();
		} catch (e) {
			setError(accountingError(e));
			setBusy(false);
		}
	};

	return (
		<AccountingDetailModal
			title="금액 변경"
			subtitle={`${group.label} · ${name}`}
			onClose={() => !busy && onClose()}
		>
			<form
				className="ac-amount-edit"
				onSubmit={(e) => {
					e.preventDefault();
					void save();
				}}
			>
				<dl className="ac-amount-edit-facts">
					<div>
						<dt>현재 금액</dt>
						<dd className="ac-number">{won(charge.amount)}</dd>
					</div>
					<div>
						<dt>낸 돈</dt>
						<dd className="ac-number">{won(paid)}</dd>
					</div>
				</dl>
				<label className="ac-amount-edit-field">
					새 금액
					<span className="ac-amount-edit-input">
						<input
							ref={input}
							className="ac-field ac-number"
							type="number"
							inputMode="numeric"
							min="1"
							step="1"
							aria-label={`${name} 새 금액`}
							value={value}
							onChange={(e) => setValue(e.target.value)}
						/>
						<span aria-hidden="true">원</span>
					</span>
				</label>
				<p className="ac-caption" aria-live="polite">
					{!valid
						? "1원 이상의 금액을 입력하세요."
						: !changed
							? "지금과 같은 금액입니다."
							: outcome!.overflow > 0
								? `낸 돈 중 ${won(amount)}을 새 금액에 쓰고, 남는 ${won(outcome!.overflow)}은 회원 잔액으로 돌려놓습니다.`
								: paid > 0
									? `낸 ${won(paid)}은 그대로 인정되고 ${won(outcome!.remaining)}이 남습니다.`
									: `${won(amount)}이 미납으로 남습니다.`}
				</p>
				{error && (
					<p className="ac-add-error" role="alert">
						{error}
					</p>
				)}
				<div className="ac-add-confirm-actions">
					<button
						type="button"
						className="btn-lq-secondary"
						disabled={busy}
						onClick={onClose}
					>
						닫기
					</button>
					<button
						type="submit"
						className="btn-lq-primary"
						disabled={!changed || busy}
					>
						{busy ? "변경 중…" : "변경하기"}
					</button>
				</div>
			</form>
		</AccountingDetailModal>
	);
}
