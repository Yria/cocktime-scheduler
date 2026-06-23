interface Props {
	checked: boolean;
	onChange: (checked: boolean) => void;
	disabled?: boolean;
	ariaLabel?: string;
}

/** iOS 스타일 on/off 스위치(CockCheckToggle 과 동일 톤, on 색은 카풀 그린). */
export function Switch({ checked, onChange, disabled = false, ariaLabel }: Props) {
	return (
		<button
			type="button"
			role="switch"
			aria-checked={checked}
			aria-label={ariaLabel}
			disabled={disabled}
			onClick={() => onChange(!checked)}
			style={{
				position: "relative",
				width: 48,
				height: 28,
				flexShrink: 0,
				borderRadius: 999,
				border: "none",
				padding: 0,
				cursor: disabled ? "not-allowed" : "pointer",
				opacity: disabled ? 0.5 : 1,
				transition: "background 0.18s",
				background: checked ? "#2c7a57" : "rgba(120,120,128,0.32)",
			}}
		>
			<span
				style={{
					position: "absolute",
					top: 2,
					left: checked ? 22 : 2,
					width: 24,
					height: 24,
					borderRadius: "50%",
					background: "#fff",
					boxShadow: "0 1px 3px rgba(0,0,0,0.3)",
					transition: "left 0.18s",
				}}
			/>
		</button>
	);
}
