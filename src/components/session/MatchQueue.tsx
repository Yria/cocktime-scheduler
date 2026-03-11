import { memo, useMemo } from "react";
import type { Court, GeneratedTeam, SessionPlayer } from "../../types";
import PlayerBadge from "../shared/PlayerBadge";
import { skillScore } from "../../lib/teamGenerator";

const GAME_TYPE_COLOR: Record<string, { bg: string; text: string }> = {
	혼복: { bg: "rgba(175,82,222,0.1)", text: "#af52de" },
	남복: { bg: "rgba(0,122,255,0.1)", text: "#007aff" },
	여복: { bg: "rgba(255,45,85,0.1)", text: "#ff2d55" },
	혼합: { bg: "rgba(255,149,0,0.1)", text: "#ff9500" },
};

interface MatchQueueProps {
	queue: GeneratedTeam[];
	courts: Court[];
	onAssignFromQueue: (queueIndex: number) => void;
	onRemoveFromQueue: (queueIndex: number) => void;
}

const MatchQueue = memo(function MatchQueue({
	queue,
	courts,
	onAssignFromQueue,
	onRemoveFromQueue,
}: MatchQueueProps) {
	if (queue.length === 0) return null;

	const hasEmptyCourt = courts.some((c) => !c.match);

	// 경기중 선수 ID 집합
	const playingIds = useMemo(
		() => new Set(
			courts.flatMap((c) => (c.match ? [...c.match.teamA, ...c.match.teamB].map((p) => p.id) : [])),
		),
		[courts],
	);

	return (
		<div>
			{/* Section header */}
			<div
				style={{
					padding: "16px 16px 10px 16px",
					display: "flex",
					alignItems: "center",
					justifyContent: "space-between",
				}}
			>
				<div style={{ display: "flex", alignItems: "center", gap: 8 }}>
					<div
						style={{
							width: 24,
							height: 24,
							borderRadius: 6,
							background: "rgba(255,149,0,0.1)",
							display: "flex",
							alignItems: "center",
							justifyContent: "center",
							flexShrink: 0,
						}}
					>
						<svg
							width="14"
							height="14"
							viewBox="0 0 20 20"
							fill="none"
							aria-hidden="true"
						>
							<path
								d="M4 6h12M4 10h12M4 14h8"
								stroke="#ff9500"
								strokeWidth="1.5"
								strokeLinecap="round"
							/>
						</svg>
					</div>
					<span
						className="text-[#0f1724] dark:text-white"
						style={{ fontSize: 15, fontWeight: 600 }}
					>
						대기열
					</span>
				</div>
				<span
					style={{
						fontSize: 11,
						fontWeight: 600,
						color: "#ff9500",
						background: "rgba(255,149,0,0.1)",
						borderRadius: 99,
						padding: "2px 7px",
					}}
				>
					{queue.length}팀
				</span>
			</div>

			<div
				style={{
					padding: "0 16px",
					display: "flex",
					flexDirection: "column",
					gap: 6,
				}}
			>
				{queue.map((team, index) => {
					const gameTypeStyle = GAME_TYPE_COLOR[team.gameType];
					const allPlayers = [...team.teamA, ...team.teamB];
					const hasPlayingMember = allPlayers.some((p) => playingIds.has(p.id));
					const canAssign = hasEmptyCourt && !hasPlayingMember;

					const renderPlayer = (player: SessionPlayer) => (
						<PlayerBadge
							key={player.id}
							name={player.name}
							gender={player.gender}
							skillScore={skillScore(player)}
							isUnavailable={playingIds.has(player.id)}
						/>
					);

					return (
						<div
							key={index}
							style={{
								borderRadius: 8,
								border: "1px solid rgba(255,149,0,0.3)",
								overflow: "hidden",
							}}
						>
							<div style={{ padding: "8px 12px" }}>
								<div
									style={{
										display: "flex",
										alignItems: "center",
										justifyContent: "space-between",
										marginBottom: 6,
									}}
								>
									<div style={{ display: "flex", alignItems: "center", gap: 6 }}>
										<span
											className="text-[#0f1724] dark:text-white"
											style={{ fontSize: 13, fontWeight: 600 }}
										>
											#{index + 1}
										</span>
										{team.reason && (
											<span
												className="text-[#6b7280] dark:text-[rgba(235,235,245,0.5)]"
												style={{ fontSize: 10, fontWeight: 500 }}
											>
												{team.reason}
											</span>
										)}
									</div>
									<div style={{ display: "flex", alignItems: "center", gap: 4 }}>
										{hasPlayingMember && (
											<span
												style={{
													fontSize: 9,
													fontWeight: 600,
													color: "#8e8e93",
													background: "rgba(142,142,147,0.1)",
													borderRadius: 3,
													padding: "1px 5px",
												}}
											>
												경기 종료 대기
											</span>
										)}
										<span
											style={{
												fontSize: 10,
												fontWeight: 600,
												color: gameTypeStyle.text,
												background: gameTypeStyle.bg,
												borderRadius: 3,
												padding: "1px 6px",
											}}
										>
											{team.gameType}
										</span>
									</div>
								</div>

								<div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
									<div style={{ display: "flex", gap: 3 }}>
										{team.teamA.map(renderPlayer)}
									</div>
									<span
										style={{
											fontSize: 8,
											fontWeight: 700,
											color: "var(--text-secondary)",
											background: "var(--mat-ultra-thin)",
											borderRadius: 99,
											padding: "1px 5px",
											flexShrink: 0,
											margin: "0 6px",
										}}
									>
										VS
									</span>
									<div style={{ display: "flex", gap: 3 }}>
										{team.teamB.map(renderPlayer)}
									</div>
								</div>
							</div>

							{/* Action buttons */}
							<div
								style={{
									padding: "0 12px 8px 12px",
									borderTop: "1px solid rgba(0,0,0,0.06)",
									paddingTop: 8,
									display: "flex",
									gap: 6,
								}}
							>
								{hasEmptyCourt && (
									<button
										type="button"
										onClick={() => canAssign && onAssignFromQueue(index)}
										disabled={!canAssign}
										style={{
											flex: 1,
											padding: "6px 10px",
											borderRadius: 5,
											fontSize: 11,
											fontWeight: 600,
											border: canAssign ? "none" : "1px solid rgba(142,142,147,0.2)",
											cursor: canAssign ? "pointer" : "not-allowed",
											background: canAssign ? "#34c759" : "rgba(142,142,147,0.06)",
											color: canAssign ? "#fff" : "#8e8e93",
										}}
									>
										{hasPlayingMember ? "경기 종료 대기" : "배정"}
									</button>
								)}
								<button
									type="button"
									onClick={() => onRemoveFromQueue(index)}
									style={{
										flex: hasEmptyCourt ? undefined : 1,
										padding: "6px 10px",
										borderRadius: 5,
										fontSize: 11,
										fontWeight: 600,
										border: "1px solid rgba(255,59,48,0.3)",
										cursor: "pointer",
										background: "rgba(255,59,48,0.08)",
										color: "#ff3b30",
									}}
								>
									취소
								</button>
							</div>
						</div>
					);
				})}
			</div>
		</div>
	);
});

export default MatchQueue;
