import { Check } from "lucide-react";

/** Shared choice surface for payment, carry and refund; native radios keep keyboard navigation. */
export default function SettlementChoice({
	title,
	detail,
	amount,
	label,
	selected,
	disabled = false,
	onSelect,
	radio,
}: {
	title: string;
	detail?: string;
	amount: string;
	label: string;
	selected: boolean;
	disabled?: boolean;
	onSelect: () => void;
	radio?: { name: string; value: string };
}) {
	const content = (
		<>
			<span className="ac-settlement-choice-copy">
				<span>{title}</span>
				{detail && <small>{detail}</small>}
			</span>
			<span className="ac-number">{amount}</span>
			{selected && <Check size={14} aria-hidden="true" />}
		</>
	);
	return radio ? (
		<label className="ac-chip ac-settlement-choice">
			<input
				type="radio"
				name={radio.name}
				value={radio.value}
				aria-label={label}
				checked={selected}
				disabled={disabled}
				onChange={onSelect}
			/>
			{content}
		</label>
	) : (
		<button
			type="button"
			className="ac-chip ac-settlement-choice"
			aria-label={label}
			aria-pressed={selected}
			disabled={disabled}
			onClick={onSelect}
		>
			{content}
		</button>
	);
}
