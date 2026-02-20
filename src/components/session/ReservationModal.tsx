import type { Player } from "../../types";

interface ReservationModalProps {
	modalPlayers: Player[];
	reservingSelected: Set<string>;
	courtPlayerMap: Map<string, number>;
	onTogglePlayer: (playerId: string) => void;
	onCreate: () => void;
	onCancel: () => void;
}

export default function ReservationModal({
	modalPlayers,
	reservingSelected,
	courtPlayerMap,
	onTogglePlayer,
	onCreate,
	onCancel,
}: ReservationModalProps) {
	return (
		<div className="fixed inset-0 lq-overlay flex items-end justify-center z-50 px-4 pb-6">
			<div className="lq-sheet w-full max-w-sm rounded-3xl overflow-hidden">
				<div className="flex items-center justify-between px-5 pt-5 pb-2">
					<h3 className="font-bold text-gray-800 dark:text-white text-lg">
						팀 예약생성
					</h3>
					<span
						className={`badge ${
							reservingSelected.size >= 2 ? "badge-men" : ""
						} px-2.5 py-1`}
						style={
							reservingSelected.size < 2
								? {
										background: "var(--glass-sub)",
										color: "#6b7280",
										border: "1px solid var(--glass-sub-border)",
									}
								: undefined
						}
					>
						{reservingSelected.size}/4
					</span>
				</div>
				<p className="px-5 pb-4 text-sm text-gray-600 dark:text-gray-300">
					함께 플레이할 2~4명을 선택하세요
				</p>

				<div className="px-5 pb-4 max-h-56 overflow-y-auto no-sb">
					{modalPlayers.length === 0 ? (
						<p className="text-sm text-gray-500 dark:text-gray-300 text-center py-4">
							선택 가능한 선수가 없습니다
						</p>
					) : (
						<div className="flex flex-wrap gap-2">
							{modalPlayers.map((p) => {
								const isSelected = reservingSelected.has(p.id);
								const isDisabled = !isSelected && reservingSelected.size >= 4;
								const courtId = courtPlayerMap.get(p.id);
								return (
									<button
										type="button"
										key={p.id}
										onClick={() => onTogglePlayer(p.id)}
										disabled={isDisabled}
										className={`chip ${
											isSelected
												? "chip-on"
												: isDisabled
													? "opacity-35"
													: courtId
														? "chip-amber"
														: ""
										}`}
									>
										{p.gender === "F" ? "🔴" : "🔵"} {p.name}
										{courtId && !isSelected && (
											<span className="badge-inline badge-inline-amber">
												{courtId}번
											</span>
										)}
									</button>
								);
							})}
						</div>
					)}
				</div>

				<div className="px-5 pb-5 space-y-2">
					<button
						type="button"
						onClick={onCreate}
						disabled={reservingSelected.size < 2}
						className="btn-lq-primary w-full py-3.5 text-sm"
					>
						예약 생성 ({reservingSelected.size}명)
					</button>
					<button
						type="button"
						onClick={onCancel}
						className="w-full py-3 text-sm text-gray-500 dark:text-gray-300 font-semibold"
					>
						취소
					</button>
				</div>
			</div>
		</div>
	);
}
