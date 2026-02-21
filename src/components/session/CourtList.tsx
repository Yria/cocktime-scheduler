import { memo } from "react";
import type { Court } from "../../types";
import PlayerBadge from "../shared/PlayerBadge";

interface CourtListProps {
	courts: Court[];
	onComplete: (courtId: number) => void;
}

const CourtList = memo(function CourtList({
	courts,
	onComplete,
}: CourtListProps) {
	return (
		<>
			{courts.map((court) => (
				<div
					key={court.id}
					style={{
						background: "#ffffff",
						borderRadius: 8,
						border: "1px solid rgba(0,0,0,0.06)",
						overflow: "hidden",
					}}
				>
					{/* Header row */}
					<div
						style={{
							background: "rgba(241,245,249,1)",
							padding: "12px 16px",
							display: "flex",
							alignItems: "center",
							justifyContent: "space-between",
						}}
					>
						<span style={{ fontSize: 14, fontWeight: 600, color: "#0f1724" }}>
							{court.id}번 코트
						</span>
						{court.match ? (
							<span
								style={{
									fontSize: 12,
									fontWeight: 600,
									color: "#166534",
									background: "rgba(220,252,231,1)",
									borderRadius: 4,
									padding: "2px 8px",
								}}
							>
								진행중
							</span>
						) : (
							<span
								style={{
									fontSize: 12,
									fontWeight: 600,
									color: "#98a0ab",
									background: "rgba(247,249,252,1)",
									borderRadius: 4,
									padding: "2px 8px",
								}}
							>
								비어있음
							</span>
						)}
					</div>

					{court.match ? (
						<>
							{/* Team info */}
							<div style={{ padding: "16px 28px" }}>
								{/* Team A */}
								<div style={{ display: "flex", gap: 12, alignItems: "center" }}>
									<span
										style={{
											fontSize: 14,
											fontWeight: 600,
											color: "#0f1724",
											width: 32,
											flexShrink: 0,
										}}
									>
										팀 A
									</span>
									<div
										style={{
											display: "flex",
											flexWrap: "wrap",
											gap: 6,
											flex: 1,
										}}
									>
										{court.match.teamA.map((player) => (
											<PlayerBadge
												key={player.id}
												name={player.name}
												gender={player.gender}
											/>
										))}
									</div>
								</div>

								{/* VS divider */}
								<div
									style={{
										display: "flex",
										alignItems: "center",
										margin: "12px 0",
									}}
								>
									<div
										style={{
											flex: 1,
											height: 1,
											background: "rgba(0,0,0,0.08)",
										}}
									/>
									<span
										style={{
											fontSize: 12,
											fontWeight: 700,
											color: "#98a0ab",
											padding: "0 8px",
										}}
									>
										VS
									</span>
									<div
										style={{
											flex: 1,
											height: 1,
											background: "rgba(0,0,0,0.08)",
										}}
									/>
								</div>

								{/* Team B */}
								<div style={{ display: "flex", gap: 12, alignItems: "center" }}>
									<span
										style={{
											fontSize: 14,
											fontWeight: 600,
											color: "#0f1724",
											width: 32,
											flexShrink: 0,
										}}
									>
										팀 B
									</span>
									<div
										style={{
											display: "flex",
											flexWrap: "wrap",
											gap: 6,
											flex: 1,
										}}
									>
										{court.match.teamB.map((player) => (
											<PlayerBadge
												key={player.id}
												name={player.name}
												gender={player.gender}
											/>
										))}
									</div>
								</div>
							</div>

							{/* Complete button */}
							<div
								style={{
									borderTop: "1px solid rgba(0,0,0,0.06)",
									padding: "12px 16px",
								}}
							>
								<button
									type="button"
									onClick={() => onComplete(court.id)}
									style={{
										background: "#0b84ff",
										color: "#fff",
										borderRadius: 6,
										padding: "7px 12px",
										fontSize: 13,
										fontWeight: 500,
										border: "none",
										cursor: "pointer",
									}}
								>
									게임 완료
								</button>
							</div>
						</>
					) : (
						<>
							{/* Empty state */}
							<div
								style={{
									padding: "20px",
									display: "flex",
									flexDirection: "column",
									alignItems: "center",
									justifyContent: "center",
									gap: 7,
									minHeight: 102,
								}}
							>
								<svg
									width="32"
									height="32"
									viewBox="0 0 32 32"
									fill="none"
									xmlns="http://www.w3.org/2000/svg"
									aria-hidden="true"
								>
									<rect
										x="4"
										y="4"
										width="24"
										height="24"
										rx="3"
										stroke="#98a0ab"
										strokeWidth="1.5"
										fill="none"
									/>
									<line
										x1="16"
										y1="4"
										x2="16"
										y2="28"
										stroke="#98a0ab"
										strokeWidth="1.5"
									/>
									<line
										x1="4"
										y1="16"
										x2="28"
										y2="16"
										stroke="#98a0ab"
										strokeWidth="1.5"
									/>
								</svg>
								<span style={{ fontSize: 15, color: "#98a0ab" }}>
									대기중인 팀이 없습니다
								</span>
							</div>

							{/* Placeholder button */}
							<div
								style={{
									borderTop: "1px solid rgba(0,0,0,0.06)",
									padding: "12px 16px",
								}}
							>
								<button
									type="button"
									disabled
									style={{
										background: "#fff",
										color: "rgba(16,16,16,0.3)",
										borderRadius: 6,
										padding: "7px 12px",
										fontSize: 13,
										fontWeight: 500,
										border: "1px solid rgba(0,0,0,0.08)",
										cursor: "not-allowed",
									}}
								>
									배정 대기
								</button>
							</div>
						</>
					)}
				</div>
			))}
		</>
	);
});

export default CourtList;
