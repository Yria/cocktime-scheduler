import type { ReservedGroup } from "../../types";

interface ReservedListProps {
	reservedGroups: ReservedGroup[];
	courtPlayerMap: Map<string, number>;
	hasEmptyCourt: boolean;
	onDisband: (groupId: string) => void;
	onAssign: (groupId: string) => void;
}

export default function ReservedList({
	reservedGroups,
	courtPlayerMap,
	hasEmptyCourt,
	onDisband,
	onAssign,
}: ReservedListProps) {
	if (reservedGroups.length === 0) return null;

	return (
		<div className="space-y-2">
			<p className="text-xs font-semibold text-gray-400 dark:text-gray-500 px-1 uppercase tracking-wide">
				예약팀 {reservedGroups.length}개
			</p>
			{reservedGroups.map((group) => {
				const isFull = group.players.length === 4;
				const allReady = group.readyIds.length === group.players.length;
				const canAssign = isFull && allReady && hasEmptyCourt;
				const readySet = new Set(group.readyIds);
				return (
					<div
						key={group.id}
						className={`glass rounded-2xl overflow-hidden ${
							allReady && isFull
								? "ring-1 ring-green-400/30 dark:ring-green-500/25"
								: "ring-1 ring-amber-400/30 dark:ring-amber-500/25"
						}`}
					>
						<div className="p-4">
							<div className="flex items-center justify-between mb-2.5">
								<span
									className={`badge ${
										allReady && isFull ? "badge-ready" : "badge-wait"
									}`}
								>
									{allReady && isFull
										? "준비완료"
										: `${group.readyIds.length}/${group.players.length}명 대기중`}
								</span>
								<button
									type="button"
									onClick={() => onDisband(group.id)}
									className="text-xs text-gray-400 dark:text-gray-500 font-semibold"
								>
									해제
								</button>
							</div>
							<div className="flex flex-wrap gap-1.5 mb-3">
								{group.players.map((p) => {
									const isReady = readySet.has(p.id);
									const courtId = courtPlayerMap.get(p.id);
									return (
										<span
											key={p.id}
											className={`chip ${!isReady ? "chip-amber" : ""}`}
										>
											{p.gender === "F" ? "🔴" : "🔵"} {p.name}
											{!isReady && courtId && (
												<span className="badge-inline badge-inline-amber">
													{courtId}번
												</span>
											)}
										</span>
									);
								})}
							</div>
							{isFull && (
								<button
									type="button"
									onClick={() => onAssign(group.id)}
									disabled={!canAssign}
									className="btn-lq-green w-full py-2.5 text-sm"
								>
									{allReady ? "코트 배정" : "경기 완료 후 배정 가능"}
								</button>
							)}
						</div>
					</div>
				);
			})}
		</div>
	);
}
