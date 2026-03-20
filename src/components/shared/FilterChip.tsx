interface FilterChipProps {
	label: string;
	active: boolean;
	activeColor?: string;
	onClick: () => void;
	flexShrink?: number;
}

export default function FilterChip({
	label,
	active,
	activeColor = "#0b84ff",
	onClick,
	flexShrink,
}: FilterChipProps) {
	return (
		<button
			type="button"
			onClick={onClick}
			style={{
				fontSize: 11,
				fontWeight: 600,
				padding: "4px 10px",
				borderRadius: 99,
				border: "none",
				cursor: "pointer",
				transition: "all 0.15s",
				background: active ? activeColor : "rgba(0,0,0,0.04)",
				color: active ? "#fff" : "#8e8e93",
				...(flexShrink !== undefined ? { flexShrink } : {}),
			}}
		>
			{label}
		</button>
	);
}
