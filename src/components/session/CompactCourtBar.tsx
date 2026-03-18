import { memo } from "react";
import type { Court } from "../../types";

interface CompactCourtBarProps {
	courts: Court[];
	onComplete: (courtId: number) => void;
}

const STYLES = `
.court-bar {
  display: flex;
  flex-direction: column;
  gap: 1px;
  background: rgba(0,0,0,0.04);
}
.dark .court-bar {
  background: rgba(255,255,255,0.06);
}
.court-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  background: #fff;
  min-height: 40px;
}
.dark .court-row {
  background: #1c1c1e;
}
.court-num {
  font-size: 12px;
  font-weight: 700;
  width: 20px;
  flex-shrink: 0;
  text-align: center;
  color: #64748b;
}
.dark .court-num {
  color: rgba(235,235,245,0.5);
}
.court-players {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  flex-wrap: wrap;
}
.court-player {
  font-size: 13px;
  font-weight: 600;
  padding: 2px 7px;
  border-radius: 10px;
  white-space: nowrap;
  line-height: 1.3;
}
.court-player.male {
  background: #e0f2fe;
  color: #075985;
}
.dark .court-player.male {
  background: rgba(14,165,233,0.18);
  color: #7dd3fc;
}
.court-player.female {
  background: #fee2e2;
  color: #991b1b;
}
.dark .court-player.female {
  background: rgba(239,68,68,0.18);
  color: #fca5a5;
}
.court-vs {
  font-size: 9px;
  font-weight: 800;
  color: #b0b8c1;
  flex-shrink: 0;
  letter-spacing: 0.03em;
}
.dark .court-vs {
  color: rgba(235,235,245,0.3);
}
.court-complete-btn {
  flex-shrink: 0;
  padding: 4px 10px;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 600;
  border: none;
  cursor: pointer;
  background: #0b84ff;
  color: #fff;
  transition: opacity 0.15s;
}
.court-complete-btn:active {
  opacity: 0.7;
}
.court-empty {
  font-size: 12px;
  color: #b0b8c1;
  font-weight: 500;
  flex: 1;
}
.dark .court-empty {
  color: rgba(235,235,245,0.3);
}
.court-type-badge {
  font-size: 10px;
  font-weight: 600;
  padding: 1px 6px;
  border-radius: 4px;
  flex-shrink: 0;
}
`;

const GAME_TYPE_STYLE: Record<string, { bg: string; color: string; darkBg: string; darkColor: string }> = {
	혼복: { bg: "rgba(175,82,222,0.12)", color: "#af52de", darkBg: "rgba(175,82,222,0.2)", darkColor: "#bf7ce0" },
	남복: { bg: "rgba(0,122,255,0.1)", color: "#007aff", darkBg: "rgba(0,122,255,0.2)", darkColor: "#4da3ff" },
	여복: { bg: "rgba(255,45,85,0.1)", color: "#ff2d55", darkBg: "rgba(255,45,85,0.2)", darkColor: "#ff6b8a" },
	혼합: { bg: "rgba(255,149,0,0.1)", color: "#ff9500", darkBg: "rgba(255,149,0,0.2)", darkColor: "#ffb340" },
};

const CompactCourtBar = memo(function CompactCourtBar({
	courts,
	onComplete,
}: CompactCourtBarProps) {
	return (
		<div>
			<style>{STYLES}</style>
			<div className="court-bar">
				{courts.map((court) => {
					const m = court.match;
					const typeStyle = m ? GAME_TYPE_STYLE[m.gameType] : null;

					return (
						<div key={court.id} className="court-row">
							<span className="court-num">{court.id}</span>

							{m ? (
								<>
									<div className="court-players">
										<span className={`court-player ${m.teamA[0].gender === "F" ? "female" : "male"}`}>
											{m.teamA[0].name}
										</span>
										<span className={`court-player ${m.teamA[1].gender === "F" ? "female" : "male"}`}>
											{m.teamA[1].name}
										</span>
										<span className="court-vs">VS</span>
										<span className={`court-player ${m.teamB[0].gender === "F" ? "female" : "male"}`}>
											{m.teamB[0].name}
										</span>
										<span className={`court-player ${m.teamB[1].gender === "F" ? "female" : "male"}`}>
											{m.teamB[1].name}
										</span>
									</div>
									{typeStyle && (
										<span
											className="court-type-badge"
											style={{
												background: typeStyle.bg,
												color: typeStyle.color,
											}}
										>
											{m.gameType}
										</span>
									)}
									<button
										type="button"
										className="court-complete-btn"
										onClick={() => onComplete(court.id)}
									>
										완료
									</button>
								</>
							) : (
								<span className="court-empty">비어있음</span>
							)}
						</div>
					);
				})}
			</div>
		</div>
	);
});

export default CompactCourtBar;
