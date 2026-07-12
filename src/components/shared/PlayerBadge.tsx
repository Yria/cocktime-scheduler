import type { Gender } from "../../types";

interface PlayerBadgeProps {
	name: string;
	gender: Gender | string;
	size?: "sm" | "md";
	skillScore?: number; // 실력 등급 1 ~ 10
	isUnavailable?: boolean; // 경기중/대기열 등 현재 배정 불가
	/** 이름 뒤 게임 수 필(pill) — MatchSummary 계열(성별별 서브 색·radius 8). 미지정 시 기존 렌더와 동일 */
	count?: number;
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
	count,
}: PlayerBadgeProps) {
	const isF = gender === "F";
	const fontSize = size === "sm" ? 12 : 13;
	const padding = size === "sm" ? "3px 9px" : "4px 10px";

	const scorePercent = skillScore ? ((skillScore - 1) / 9) * 100 : 0;

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
					// count 필 렌더 시에만 내부 gap 추가(MatchSummary 와 동일 간격) — 미지정 시 기존과 동일
					gap: count != null ? 5 : undefined,
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
				{count != null && (
					<span
						style={{
							marginLeft: 2,
							fontSize: 11,
							fontWeight: 700,
							color: isF ? "#be123c" : "#0369a1",
							background: isF
								? "rgba(190,18,60,0.1)"
								: "rgba(3,105,161,0.1)",
							borderRadius: 8,
							padding: "1px 5px",
							position: "relative",
							zIndex: 1,
						}}
					>
						{count}
					</span>
				)}
			</div>
		</>
	);
}
