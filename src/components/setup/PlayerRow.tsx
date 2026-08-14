import { Check } from "lucide-react";
import type { Player } from "../../types";
import GenderDot from "../shared/GenderDot";
import BirthYearTag from "../shared/BirthYearTag";

interface PlayerRowProps {
	player: Player;
	selected: boolean;
	isGuest?: boolean;
	disabled?: boolean;
	onToggle: () => void;
	onEdit: (e: React.MouseEvent) => void;
	onRemove?: () => void;
}

export function PlayerRow({
	player,
	selected,
	isGuest,
	disabled,
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
				disabled={disabled}
				style={{
					display: "flex",
					alignItems: "center",
					gap: 12,
					flex: 1,
					textAlign: "left",
					background: "none",
					border: "none",
					cursor: disabled ? "not-allowed" : "pointer",
					minWidth: 0,
					opacity: disabled ? 0.5 : 1,
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
						<Check size={12} color="white" strokeWidth={2.5} />
					)}
				</span>
				<GenderDot gender={player.gender} size={9} />
				{/* 이름은 잘리더라도 년생은 남도록 한 묶음으로(baseline 정렬) */}
				<span
					style={{
						display: "flex",
						alignItems: "baseline",
						gap: 3,
						minWidth: 0,
					}}
				>
					<span
						className="text-strong"
						style={{
							fontSize: 14,
							fontWeight: 500,
							overflow: "hidden",
							textOverflow: "ellipsis",
							whiteSpace: "nowrap",
						}}
					>
						{player.name}
					</span>
					<BirthYearTag birthYear={player.birthYear} size={11.5} gap={0} />
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
