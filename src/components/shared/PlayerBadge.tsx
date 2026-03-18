import type { Gender } from "../../types";

interface PlayerBadgeProps {
	name: string;
	gender: Gender | string;
	size?: "sm" | "md";
	skillScore?: number; // 1.0 ~ 3.0
	isUnavailable?: boolean; // 경기중/대기열 등 현재 배정 불가
}

const PLAYING_STYLE = `
@keyframes badge-glow {
  0%, 100% { box-shadow: inset 0 0 4px rgba(50,50,80,0.1); }
  50% { box-shadow: inset 0 0 40px 8px rgba(50,50,80,0.9); }
}
.badge-playing {
  animation: badge-glow 1.2s ease-in-out infinite;
}
`;

export default function PlayerBadge({
	name,
	gender,
	size = "md",
	skillScore,
	isUnavailable = false,
}: PlayerBadgeProps) {
	const isF = gender === "F";
	const fontSize = size === "sm" ? 12 : 13;
	const padding = size === "sm" ? "3px 9px" : "4px 10px";

	const scorePercent = skillScore ? ((skillScore - 1.0) / 2.0) * 100 : 0;

	const baseColorLight = isF ? "#fee2e2" : "#e0f2fe";
	const baseColorDark = isF ? "#fca5a5" : "#7dd3fc";

	const background = skillScore
		? `linear-gradient(to right, ${baseColorDark} 0%, ${baseColorDark} ${scorePercent}%, ${baseColorLight} ${scorePercent}%, ${baseColorLight} 100%)`
		: (isF ? "#fee2e2" : "#e0f2fe");

	return (
		<>
			{isUnavailable && <style>{PLAYING_STYLE}</style>}
			<div
				className={isUnavailable ? "badge-playing" : undefined}
				style={{
					display: "inline-flex",
					alignItems: "center",
					padding,
					background,
					borderRadius: 14,
					fontSize,
					color: isF ? "#991b1b" : "#075985",
					fontWeight: 600,
					position: "relative",
					overflow: "hidden",
					border: undefined,
				}}
			>
				<span style={{ position: "relative", zIndex: 1 }}>
					{name}
				</span>
			</div>
		</>
	);
}
