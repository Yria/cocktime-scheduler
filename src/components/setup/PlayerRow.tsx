import type { Player } from "../../types";

interface PlayerRowProps {
	player: Player;
	selected: boolean;
	isGuest?: boolean;
	onToggle: () => void;
	onEdit: (e: React.MouseEvent) => void;
	onRemove?: () => void;
}

export function PlayerRow({
	player,
	selected,
	isGuest,
	onToggle,
	onEdit,
	onRemove,
}: PlayerRowProps) {
	return (
		<div
			style={{
				display: "flex",
				alignItems: "center",
				padding: "12px 16px",
				gap: 12,
				borderBottom: "1px solid rgba(0,0,0,0.04)",
				...(isGuest ? { background: "rgba(255,149,0,0.03)" } : {}),
			}}
		>
			<button
				type="button"
				onClick={onToggle}
				style={{
					display: "flex",
					alignItems: "center",
					gap: 12,
					flex: 1,
					textAlign: "left",
					background: "none",
					border: "none",
					cursor: "pointer",
					minWidth: 0,
				}}
			>
				<span
					style={{
						width: 22,
						height: 22,
						borderRadius: "50%",
						border: selected ? "none" : "1.5px solid #c8d0dc",
						background: selected ? "#0b84ff" : "transparent",
						flexShrink: 0,
						display: "flex",
						alignItems: "center",
						justifyContent: "center",
						transition: "all 0.15s",
					}}
				>
					{selected && (
						<svg
							width="12"
							height="10"
							viewBox="0 0 12 10"
							fill="none"
							aria-hidden="true"
						>
							<path
								d="M1 5L4.5 8.5L11 1"
								stroke="white"
								strokeWidth="2"
								strokeLinecap="round"
								strokeLinejoin="round"
							/>
						</svg>
					)}
				</span>
				<span style={{ fontSize: 16, flexShrink: 0 }}>
					{player.gender === "F" ? "🔴" : "🔵"}
				</span>
				<span
					style={{
						fontSize: 14,
						fontWeight: 500,
						color: "#0f1724",
						overflow: "hidden",
						textOverflow: "ellipsis",
						whiteSpace: "nowrap",
					}}
				>
					{player.name}
				</span>
				{isGuest && (
					<span
						style={{
							fontSize: 11,
							fontWeight: 600,
							color: "#ff9500",
							background: "rgba(255,149,0,0.1)",
							borderRadius: 4,
							padding: "2px 6px",
							flexShrink: 0,
						}}
					>
						게스트
					</span>
				)}
			</button>
			<button
				type="button"
				onClick={onEdit}
				style={{
					color: "#c8d0dc",
					background: "none",
					border: "none",
					cursor: "pointer",
					padding: "4px",
					fontSize: 16,
					flexShrink: 0,
				}}
			>
				✎
			</button>
			{isGuest && onRemove && (
				<button
					type="button"
					onClick={onRemove}
					style={{
						color: "#fca5a5",
						background: "none",
						border: "none",
						cursor: "pointer",
						padding: "4px",
						fontSize: 14,
						flexShrink: 0,
					}}
				>
					✕
				</button>
			)}
		</div>
	);
}
