import { memo } from "react";
import type { ReservedGroup } from "../../types";
import PlayerBadge from "../shared/PlayerBadge";

interface ReservedListProps {
	reservedGroups: ReservedGroup[];
	courtPlayerMap: Map<string, number>;
	hasEmptyCourt: boolean;
	waitingCount: number;
	onDisband: (groupId: string) => void;
	onAssign: (groupId: string) => void;
}

const ReservedList = memo(function ReservedList({
	reservedGroups,
	courtPlayerMap,
	hasEmptyCourt,
	waitingCount,
	onDisband,
	onAssign,
}: ReservedListProps) {
	if (reservedGroups.length === 0) return null;

	return (
		<div>
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
							background: "rgba(88,86,214,0.1)",
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
							<rect
								x="3"
								y="4"
								width="14"
								height="13"
								rx="2"
								stroke="#5856d6"
								strokeWidth="1.5"
								fill="none"
							/>
							<line
								x1="3"
								y1="8"
								x2="17"
								y2="8"
								stroke="#5856d6"
								strokeWidth="1.5"
							/>
							<line
								x1="7"
								y1="2"
								x2="7"
								y2="6"
								stroke="#5856d6"
								strokeWidth="1.5"
								strokeLinecap="round"
							/>
							<line
								x1="13"
								y1="2"
								x2="13"
								y2="6"
								stroke="#5856d6"
								strokeWidth="1.5"
								strokeLinecap="round"
							/>
						</svg>
					</div>
					<span className="text-[#0f1724] dark:text-white" style={{ fontSize: 16, fontWeight: 600 }}>
						예약팀
					</span>
				</div>
				<span
					style={{
						fontSize: 12,
						fontWeight: 600,
						color: "#5856d6",
						background: "rgba(88,86,214,0.1)",
						borderRadius: 99,
						padding: "2px 8px",
					}}
				>
					{reservedGroups.length}팀
				</span>
			</div>

			<div
				style={{
					padding: "0 16px",
					display: "flex",
					flexDirection: "column",
					gap: 8,
				}}
			>
				{reservedGroups.map((group) => {
					const allReady = group.readyIds.length === group.memberIds.length;
					const needMore = 4 - group.memberIds.length;
					const canAssign =
						allReady && hasEmptyCourt && waitingCount >= needMore;
					const readySet = new Set(group.readyIds);

					return (
						<div
							key={group.id}
							style={{
								// dark mode handled via className
								borderRadius: 8,
								border:
									allReady && waitingCount >= needMore
										? "1px solid rgba(52,199,89,0.3)"
										: "1px solid rgba(255,149,0,0.25)",
								overflow: "hidden",
							}}
						>
							<div style={{ padding: "12px 16px" }}>
								<div
									style={{
										display: "flex",
										alignItems: "center",
										justifyContent: "space-between",
										marginBottom: 10,
									}}
								>
									<span
										style={{
											fontSize: 12,
											fontWeight: 600,
											color: canAssign ? "#166534" : "#9a3412",
											background: canAssign
												? "rgba(220,252,231,1)"
												: "rgba(255,247,237,1)",
											borderRadius: 4,
											padding: "2px 8px",
										}}
									>
										{allReady
											? canAssign
												? "준비완료"
												: `대기 인원 부족 (${waitingCount}/${needMore}명)`
											: `${group.readyIds.length}/${group.memberIds.length}명 대기중`}
									</span>
									<button
										type="button"
										onClick={() => onDisband(group.id)}
										style={{
											fontSize: 12,
											fontWeight: 600,
											color: "#98a0ab",
											background: "none",
											border: "none",
											cursor: "pointer",
											padding: "2px 4px",
										}}
									>
										해제
									</button>
								</div>

								<div
									style={{
										display: "flex",
										flexWrap: "wrap",
										gap: 6,
										marginBottom: 10,
									}}
								>
									{group.players.map((p) => {
										const isReady = readySet.has(p.id);
										const courtId = courtPlayerMap.get(p.id);
										return (
											<div
												key={p.id}
												style={{
													display: "inline-flex",
													alignItems: "center",
													gap: 4,
													opacity: isReady ? 1 : 0.65,
												}}
											>
												<PlayerBadge
													name={p.name}
													gender={p.gender}
													size="sm"
												/>
												{!isReady && courtId && (
													<span
														style={{
															fontSize: 10,
															fontWeight: 700,
															color: "#ff9500",
														}}
													>
														{courtId}번
													</span>
												)}
											</div>
										);
									})}
								</div>

								<button
									type="button"
									onClick={() => onAssign(group.id)}
									disabled={!canAssign}
									style={{
										width: "100%",
										padding: "10px",
										borderRadius: 6,
										fontSize: 13,
										fontWeight: 600,
										border: "none",
										cursor: canAssign ? "pointer" : "not-allowed",
										background: canAssign ? "#34c759" : "rgba(52,199,89,0.3)",
										color: "#fff",
									}}
								>
									{allReady
										? canAssign
											? "코트 배정"
											: "대기 인원 대기중"
										: "경기 완료 후 배정 가능"}
								</button>
							</div>
						</div>
					);
				})}
			</div>
		</div>
	);
});

export default ReservedList;
