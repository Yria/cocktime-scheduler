import { memo } from "react";
import type { SessionPlayer } from "../../types";
import { skillScore } from "../../lib/teamGenerator";

interface WaitingPlayerChipProps {
	player: SessionPlayer;
	isMixedSingle: boolean;
	onToggleResting: (playerId: string) => void;
	onToggleForceMixed: (playerId: string) => void;
	onToggleForceHardGame: (playerId: string) => void;
}

const WaitingPlayerChip = memo(function WaitingPlayerChip({
	player: p,
	isMixedSingle,
	onToggleResting,
	onToggleForceMixed,
	onToggleForceHardGame,
}: WaitingPlayerChipProps) {
	const chipClass = `wl-chip${p.forceMixed ? " force-mixed" : p.forceHardGame ? " force-hard-game" : isMixedSingle ? " mixed-single" : ""}`;

	// 스킬 스코어 기반 그라데이션 오버레이 (force 상태가 아닐 때만)
	let gradientElement = null;
	if (!p.forceMixed && !p.forceHardGame && !isMixedSingle) {
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
			>
				{p.name}
				{p.gameCount > 0 && (
					<span className="wl-game-badge">{p.gameCount}</span>
				)}
			</button>

			{/* 혼복 우선배치 토글 버튼 */}
			<button
				type="button"
				onClick={() => onToggleForceMixed(p.id)}
				title={p.forceMixed ? "혼복 우선배치 해제" : "혼복 우선배치 지정"}
				className="wl-mixed-btn"
				style={{ color: p.forceMixed ? "#ff3b30" : "#c8d0d8" }}
			>
				<svg
					width="17"
					height="17"
					viewBox="0 0 24 24"
					fill={p.forceMixed ? "currentColor" : "none"}
					stroke="currentColor"
					strokeWidth="1.8"
					strokeLinecap="round"
					strokeLinejoin="round"
					aria-hidden="true"
				>
					<circle cx="7" cy="7" r="3" />
					<path d="M3 21v-4a4 4 0 0 1 4-4h0a4 4 0 0 1 4 4v4" />
					<circle cx="17" cy="7" r="3" />
					<path d="M13 21l2-8h4l2 8Z" />
				</svg>
			</button>

			{/* 빡겜 우선배치 토글 버튼 */}
			<button
				type="button"
				onClick={() => onToggleForceHardGame(p.id)}
				title={p.forceHardGame ? "빡겜 우선배치 해제" : "빡겜 우선배치 지정"}
				className="wl-mixed-btn"
				style={{ color: p.forceHardGame ? "#ff9500" : "#c8d0d8" }}
			>
				<svg
					width="16"
					height="16"
					viewBox="0 0 24 24"
					fill={p.forceHardGame ? "currentColor" : "none"}
					stroke="currentColor"
					strokeWidth="1.8"
					strokeLinecap="round"
					strokeLinejoin="round"
					aria-hidden="true"
				>
					<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z" />
				</svg>
			</button>
		</div>
	);
});

export default WaitingPlayerChip;
