import { useState } from "react";
import type { Gender } from "../../types";
import { getPlayerPhotoUrl } from "../../lib/playerPhoto";

interface PlayerCardProps {
	name: string;
	gender: Gender | string;
	skillScore?: number; // 1.0 ~ 3.0
	size?: "sm" | "md" | "lg";
	selected?: boolean;
	disabled?: boolean;
	onClick?: (e: React.MouseEvent) => void;
}

const SIZES = {
	sm: { photo: 56, width: 68, fontSize: 10, barHeight: 6 },
	md: { photo: 72, width: 84, fontSize: 11, barHeight: 6 },
	lg: { photo: 88, width: 100, fontSize: 12, barHeight: 7 },
} as const;

export default function PlayerCard({
	name,
	gender,
	skillScore,
	size = "md",
	selected = false,
	disabled = false,
	onClick,
}: PlayerCardProps) {
	const [imgFailed, setImgFailed] = useState(false);
	const url = getPlayerPhotoUrl(name);
	const isF = gender === "F";
	const s = SIZES[size];

	const genderColor = isF ? "#ff2d55" : "#007aff";
	const genderBgLight = isF ? "#fca5a5" : "#7dd3fc";
	const genderTextColor = isF ? "#991b1b" : "#075985";

	// Skill bar percentage (1.0~3.0 → 0%~100%)
	const skillPercent = skillScore ? ((skillScore - 1.0) / 2.0) * 100 : 0;

	const card = (
		<div
			style={{
				width: s.width,
				display: "flex",
				flexDirection: "column",
				alignItems: "center",
				gap: 4,
				opacity: disabled ? 0.4 : 1,
				cursor: onClick ? "pointer" : "default",
				transition: "transform 0.1s, opacity 0.15s",
			}}
		>
			{/* Photo container */}
			<div
				style={{
					position: "relative",
					width: s.photo,
					height: s.photo,
					borderRadius: 12,
					overflow: "hidden",
					border: selected
						? `2.5px solid ${genderColor}`
						: "2px solid rgba(128,128,128,0.15)",
					boxShadow: selected
						? `0 0 0 2px ${genderColor}33`
						: "0 2px 8px rgba(0,0,0,0.08)",
					transition: "border-color 0.15s, box-shadow 0.15s",
					flexShrink: 0,
				}}
			>
				{/* Photo or fallback */}
				{imgFailed ? (
					<div
						style={{
							width: "100%",
							height: "100%",
							background: genderBgLight,
							display: "flex",
							alignItems: "center",
							justifyContent: "center",
							color: genderTextColor,
							fontSize: s.photo * 0.38,
							fontWeight: 700,
						}}
					>
						{name.charAt(0)}
					</div>
				) : (
					<img
						src={url}
						alt={name}
						onError={() => setImgFailed(true)}
						loading="lazy"
						style={{
							width: "100%",
							height: "100%",
							objectFit: "cover",
							display: "block",
						}}
					/>
				)}

				{/* Skill bar overlay at bottom */}
				{skillScore != null && (
					<div
						style={{
							position: "absolute",
							bottom: 0,
							left: 0,
							right: 0,
							height: s.barHeight,
							background: "rgba(0,0,0,0.2)",
						}}
					>
						<div
							style={{
								height: "100%",
								width: `${skillPercent}%`,
								background: genderColor,
								borderRadius: `0 ${s.barHeight}px ${s.barHeight}px 0`,
								transition: "width 0.3s",
							}}
						/>
					</div>
				)}
			</div>

			{/* Name */}
			{name && (
				<span
					className="text-[#1a1a1a] dark:text-[#e5e5e5]"
					style={{
						fontSize: s.fontSize,
						fontWeight: 600,
						lineHeight: 1.2,
						textAlign: "center",
						maxWidth: s.width,
						overflow: "hidden",
						textOverflow: "ellipsis",
						whiteSpace: "nowrap",
					}}
				>
					{name}
				</span>
			)}
		</div>
	);

	if (onClick) {
		return (
			<button
				type="button"
				onClick={onClick}
				disabled={disabled}
				style={{
					border: "none",
					background: "transparent",
					padding: 0,
					cursor: disabled ? "default" : "pointer",
				}}
			>
				{card}
			</button>
		);
	}

	return card;
}
