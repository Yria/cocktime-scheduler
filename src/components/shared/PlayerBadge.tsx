import type { Gender } from "../../types";

interface PlayerBadgeProps {
	name: string;
	gender: Gender | string;
	size?: "sm" | "md";
}

export default function PlayerBadge({
	name,
	gender,
	size = "md",
}: PlayerBadgeProps) {
	const isF = gender === "F";
	const dotSize = size === "sm" ? 6 : 7;
	const fontSize = size === "sm" ? 12 : 13;
	const padding = size === "sm" ? "3px 9px" : "4px 10px";

	return (
		<div
			style={{
				display: "inline-flex",
				alignItems: "center",
				gap: 5,
				padding,
				background: isF ? "#fee2e2" : "#e0f2fe",
				borderRadius: 14,
				fontSize,
				color: isF ? "#991b1b" : "#075985",
				fontWeight: 600,
			}}
		>
			<span
				style={{
					width: dotSize,
					height: dotSize,
					borderRadius: "50%",
					background: isF ? "#ff2d55" : "#007aff",
					flexShrink: 0,
					display: "inline-block",
				}}
			/>
			{name}
		</div>
	);
}
