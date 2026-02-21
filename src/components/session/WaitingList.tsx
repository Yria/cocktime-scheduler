import { memo } from "react";
import type { SessionPlayer } from "../../types";

interface WaitingListProps {
	waiting: SessionPlayer[];
	singleWomanIds: string[];
	onToggleResting: (playerId: string) => void;
	onToggleForceMixed: (playerId: string) => void;
}

const STYLES = `
.wl-chip {
  display: flex;
  align-items: center;
  background: rgba(255,255,255,0.72);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border: 1px solid rgba(255,255,255,0.55);
  border-radius: 14px;
  box-shadow: 0 2px 8px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04);
  overflow: hidden;
  transition: transform 0.18s cubic-bezier(0.25,1,0.5,1), box-shadow 0.18s ease;
}
.wl-chip:hover {
  transform: translateY(-1px);
  box-shadow: 0 6px 18px rgba(0,0,0,0.1), 0 2px 4px rgba(0,0,0,0.06);
}
.wl-chip.force-mixed {
  background: rgba(255,59,48,0.08);
  border-color: rgba(255,59,48,0.28);
  box-shadow: 0 2px 8px rgba(255,59,48,0.1);
}
.wl-chip.mixed-single {
  background: rgba(255,149,0,0.07);
  border-color: rgba(255,149,0,0.35);
  box-shadow: 0 2px 8px rgba(255,149,0,0.1);
}
.wl-name-btn {
  padding: 7px 4px 7px 10px;
  font-size: 14px;
  font-weight: 500;
  color: #0f1724;
  cursor: pointer;
  background: none;
  border: none;
  display: flex;
  align-items: center;
  gap: 6px;
  letter-spacing: -0.01em;
  transition: opacity 0.1s;
}
.wl-name-btn:active {
  opacity: 0.55;
}
.wl-mixed-btn {
  padding: 7px 9px 7px 2px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  background: none;
  border: none;
  transition: transform 0.15s cubic-bezier(0.25,1,0.5,1), color 0.15s;
}
.wl-mixed-btn:active {
  transform: scale(0.8);
}
.wl-gender-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex-shrink: 0;
}
.wl-game-badge {
  font-size: 10px;
  font-weight: 700;
  padding: 1px 5px;
  border-radius: 99px;
  background: rgba(255,149,0,0.12);
  color: #b06000;
  letter-spacing: 0.01em;
}
`;

const WaitingList = memo(function WaitingList({
	waiting,
	singleWomanIds,
	onToggleResting,
	onToggleForceMixed,
}: WaitingListProps) {
	const countColor =
		waiting.length >= 4
			? { text: "#34c759", bg: "rgba(52,199,89,0.1)" }
			: waiting.length > 0
				? { text: "#ff9500", bg: "rgba(255,149,0,0.1)" }
				: { text: "#8e8e93", bg: "rgba(0,0,0,0.05)" };

	return (
		<div>
			<style>{STYLES}</style>

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
							background: "rgba(0,122,255,0.1)",
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
								cx="7"
								cy="6"
								r="2.5"
								stroke="#007aff"
								strokeWidth="1.6"
							/>
							<circle
								cx="13"
								cy="6"
								r="2.5"
								stroke="#007aff"
								strokeWidth="1.6"
							/>
							<path
								d="M2 17c0-3 2.2-4.5 5-4.5h6c2.8 0 5 1.5 5 4.5"
								stroke="#007aff"
								strokeWidth="1.6"
								strokeLinecap="round"
							/>
						</svg>
					</div>
					<span
						style={{
							fontSize: 16,
							fontWeight: 600,
							color: "#0f1724",
							letterSpacing: "-0.01em",
						}}
					>
						대기 명단
					</span>
				</div>
				<span
					style={{
						fontSize: 12,
						fontWeight: 700,
						color: countColor.text,
						background: countColor.bg,
						borderRadius: 99,
						padding: "3px 9px",
						letterSpacing: "0.01em",
						transition: "color 0.2s, background 0.2s",
					}}
				>
					{waiting.length}명
				</span>
			</div>

			{/* Player chips */}
			{waiting.length === 0 ? (
				<p
					style={{
						padding: "4px 16px 16px",
						fontSize: 13,
						color: "#98a0ab",
						fontStyle: "italic",
					}}
				>
					대기 중인 선수가 없습니다
				</p>
			) : (
				<div
					style={{
						padding: "0 16px 14px",
						display: "flex",
						flexWrap: "wrap",
						gap: 7,
					}}
				>
					{waiting.map((p) => {
						const isMixedSingle =
							p.gender === "F" &&
							(p.allowMixedSingle || singleWomanIds.includes(p.playerId));
						const chipClass = `wl-chip${p.forceMixed ? " force-mixed" : isMixedSingle ? " mixed-single" : ""}`;
						return (
							<div key={p.id} className={chipClass}>
								{/* 이름 + 게임수: 누르면 휴식 전환 */}
								<button
									type="button"
									onClick={() => onToggleResting(p.id)}
									className="wl-name-btn"
								>
									<span
										className="wl-gender-dot"
										style={{
											background: p.gender === "F" ? "#ff2d55" : "#007aff",
										}}
									/>
									{p.name}
									{p.gameCount > 0 && (
										<span className="wl-game-badge">{p.gameCount}</span>
									)}
								</button>

								{/* 혼복 우선배치 토글 버튼 */}
								<button
									type="button"
									onClick={() => onToggleForceMixed(p.id)}
									title={
										p.forceMixed ? "혼복 우선배치 해제" : "혼복 우선배치 지정"
									}
									className="wl-mixed-btn"
									style={{
										color: p.forceMixed ? "#ff3b30" : "#c8d0d8",
									}}
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
										{/* 남자 실루엣 */}
										<circle cx="7" cy="7" r="3" />
										<path d="M3 21v-4a4 4 0 0 1 4-4h0a4 4 0 0 1 4 4v4" />
										{/* 여자 실루엣 (치마 형태) */}
										<circle cx="17" cy="7" r="3" />
										<path d="M13 21l2-8h4l2 8Z" />
									</svg>
								</button>
							</div>
						);
					})}
				</div>
			)}

			{waiting.length > 0 && waiting.length < 4 && (
				<p
					style={{
						margin: "0 16px 12px",
						padding: "6px 11px",
						fontSize: 12,
						fontWeight: 600,
						color: "#ff3b30",
						background: "rgba(255,59,48,0.07)",
						borderRadius: 10,
					}}
				>
					{4 - waiting.length}명 더 필요
				</p>
			)}
		</div>
	);
});

export default WaitingList;
