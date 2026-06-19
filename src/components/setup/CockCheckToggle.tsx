interface Props {
	enabled: boolean;
	onChange: (enabled: boolean) => void;
}

/** 콕 체크 on/off 스위치 — on이면 입장 선수의 콕 제출을 확인해야 매칭 대기 상태가 된다. */
export function CockCheckToggle({ enabled, onChange }: Props) {
	return (
		<div
			className="bg-white dark:bg-[#1c1c1e] border border-[rgba(0,0,0,0.06)] dark:border-[rgba(255,255,255,0.08)]"
			style={{
				borderRadius: 12,
				padding: "10px 16px",
				marginBottom: 12,
				display: "flex",
				alignItems: "center",
				gap: 14,
			}}
		>
			<div style={{ flex: 1, minWidth: 0 }}>
				<p
					className="text-[#0f1724] dark:text-white"
					style={{ fontSize: 14, fontWeight: 700, margin: 0 }}
				>
					콕 체크
				</p>
				<p
					className="text-[#64748b] dark:text-[rgba(235,235,245,0.5)]"
					style={{ fontSize: 11, margin: "2px 0 0", lineHeight: 1.4 }}
				>
					켜면 선수의 콕 제출을 확인해야 매칭 대기 상태가 됩니다
				</p>
			</div>
			<button
				type="button"
				role="switch"
				aria-checked={enabled}
				aria-label="콕 체크"
				onClick={() => onChange(!enabled)}
				style={{
					position: "relative",
					width: 48,
					height: 28,
					flexShrink: 0,
					borderRadius: 999,
					border: "none",
					cursor: "pointer",
					padding: 0,
					transition: "background 0.18s",
					background: enabled ? "var(--ios-green, #34c759)" : "rgba(120,120,128,0.32)",
				}}
			>
				<span
					style={{
						position: "absolute",
						top: 2,
						left: enabled ? 22 : 2,
						width: 24,
						height: 24,
						borderRadius: "50%",
						background: "#fff",
						boxShadow: "0 1px 3px rgba(0,0,0,0.3)",
						transition: "left 0.18s",
					}}
				/>
			</button>
		</div>
	);
}
