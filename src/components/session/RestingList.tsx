import { memo } from "react";
import type { SessionPlayer } from "../../types";

interface RestingListProps {
	resting: SessionPlayer[];
	onToggleResting: (playerId: string) => void;
}

const RestingList = memo(function RestingList({
	resting,
	onToggleResting,
}: RestingListProps) {
	if (resting.length === 0) return null;

	return (
		<div>
			{/* Section header */}
			<div
				style={{
					padding: "24px 16px 12px 16px",
					display: "flex",
					alignItems: "center",
					justifyContent: "space-between",
				}}
			>
				<div style={{ display: "flex", alignItems: "center", gap: 8 }}>
					<div
						style={{
							width: 28,
							height: 28,
							borderRadius: 8,
							background: "rgba(100,116,139,0.1)",
							display: "flex",
							alignItems: "center",
							justifyContent: "center",
							flexShrink: 0,
						}}
					>
						<svg
							width="16"
							height="16"
							viewBox="0 0 20 20"
							fill="none"
							aria-hidden="true"
						>
							<circle
								cx="10"
								cy="10"
								r="7.5"
								stroke="#64748b"
								strokeWidth="1.5"
							/>
							<rect
								x="7.5"
								y="6"
								width="1.8"
								height="8"
								rx="0.9"
								fill="#64748b"
							/>
							<rect
								x="10.7"
								y="6"
								width="1.8"
								height="8"
								rx="0.9"
								fill="#64748b"
							/>
						</svg>
					</div>
					<span style={{ fontSize: 16, fontWeight: 600, color: "#0f1724" }}>
						휴식중
					</span>
				</div>
				<span
					style={{
						fontSize: 12,
						fontWeight: 600,
						color: "#64748b",
						background: "rgba(241,245,249,1)",
						borderRadius: 99,
						padding: "2px 8px",
					}}
				>
					{resting.length}명
				</span>
			</div>

			{/* Player chips */}
			<div
				style={{
					padding: "0 16px 16px",
					display: "flex",
					flexWrap: "wrap",
					gap: 8,
				}}
			>
				{resting.map((p) => (
					<button
						key={p.id}
						type="button"
						onClick={() => onToggleResting(p.id)}
						style={{
							display: "inline-flex",
							alignItems: "center",
							gap: 6,
							background: "rgba(241,245,249,1)",
							border: "1px solid rgba(0,0,0,0.04)",
							borderRadius: 12,
							padding: "8px 12px",
							fontSize: 14,
							fontWeight: 500,
							color: "#98a0ab",
							cursor: "pointer",
						}}
					>
						<span
							style={{
								width: 7,
								height: 7,
								borderRadius: "50%",
								background: p.gender === "F" ? "#ff2d55" : "#007aff",
								flexShrink: 0,
								display: "inline-block",
							}}
						/>
						{p.name}
					</button>
				))}
			</div>
		</div>
	);
});

export default RestingList;
