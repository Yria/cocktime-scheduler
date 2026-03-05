import type { Gender } from "../../types";

interface PlayerBadgeProps {
	name: string;
	gender: Gender | string;
	size?: "sm" | "md";
	skillScore?: number; // 1.0 ~ 3.0
}

export default function PlayerBadge({
	name,
	gender,
	size = "md",
	skillScore,
}: PlayerBadgeProps) {
	const isF = gender === "F";
	const fontSize = size === "sm" ? 12 : 13;
	const padding = size === "sm" ? "3px 9px" : "4px 10px";

	// 스킬 스코어를 퍼센트로 변환 (1.0 ~ 3.0 → 0% ~ 100%)
	const scorePercent = skillScore ? ((skillScore - 1.0) / 2.0) * 100 : 0;

	// 배경색 설정 (그라데이션)
	const baseColorLight = isF ? "#fee2e2" : "#e0f2fe";
	const baseColorDark = isF ? "#fca5a5" : "#7dd3fc";

	const background = skillScore
		? `linear-gradient(to right, ${baseColorDark} 0%, ${baseColorDark} ${scorePercent}%, ${baseColorLight} ${scorePercent}%, ${baseColorLight} 100%)`
		: (isF ? "#fee2e2" : "#e0f2fe");

	return (
		<div
			style={{
				display: "inline-flex",
				alignItems: "center",
				gap: 5,
				padding,
				background,
				borderRadius: 14,
				fontSize,
				color: isF ? "#991b1b" : "#075985",
				fontWeight: 600,
				position: "relative",
				overflow: "hidden",
			}}
		>
			<span style={{ position: "relative", zIndex: 1 }}>
				{name}
			</span>
		</div>
	);
}
