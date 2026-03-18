import { memo } from "react";
import type { SessionPlayer } from "../../types";
import { skillScore } from "../../lib/teamGenerator";

interface WaitingPlayerChipProps {
	player: SessionPlayer;
	isMixedSingle: boolean;
	onToggleResting: (playerId: string) => void;
}

const WaitingPlayerChip = memo(function WaitingPlayerChip({
	player: p,
	isMixedSingle,
	onToggleResting,
}: WaitingPlayerChipProps) {
	const chipClass = `wl-chip${isMixedSingle ? " mixed-single" : ""}`;

	// 스킬 스코어 기반 그라데이션 오버레이
	let gradientElement = null;
	if (!isMixedSingle) {
		const score = skillScore(p);
		const scorePercent = ((score - 1.0) / 2.0) * 100;

		const lightBg = p.gender === "F" ? "#fef2f2" : "#f0f9ff";
		const lightProgress = p.gender === "F" ? "#ef4444" : "#0ea5e9";
		const darkBg = p.gender === "F" ? "#450a0a" : "#082f49";
		const darkProgress = p.gender === "F" ? "#dc2626" : "#0284c7";

		const lightGradient = `linear-gradient(to right, ${lightProgress} 0%, ${lightProgress} ${scorePercent}%, ${lightBg} ${scorePercent}%, ${lightBg} 100%)`;
		const darkGradient = `linear-gradient(to right, ${darkProgress} 0%, ${darkProgress} ${scorePercent}%, ${darkBg} ${scorePercent}%, ${darkBg} 100%)`;

		gradientElement = (
			<>
				<div className="wl-chip-gradient dark:hidden" style={{ background: lightGradient }} />
				<div className="wl-chip-gradient hidden dark:block" style={{ background: darkGradient }} />
			</>
		);
	}

	const score = skillScore(p);
	const scoreInfo = `스코어: ${score.toFixed(2)} / 3.0`;

	return (
		<div className={chipClass} title={scoreInfo}>
			{gradientElement}
			{/* 이름 + 게임수: 누르면 휴식 전환 */}
			<button
				type="button"
				onClick={() => onToggleResting(p.id)}
				className="wl-name-btn"
				style={{ paddingRight: 10 }}
			>
				{p.name}
				{p.gameCount > 0 && (
					<span className="wl-game-badge">{p.gameCount}</span>
				)}
			</button>
		</div>
	);
});

export default WaitingPlayerChip;
