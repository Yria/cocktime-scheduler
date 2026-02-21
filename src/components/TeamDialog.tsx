import type { Court, GeneratedTeam } from "../types";

interface Props {
	team: GeneratedTeam;
	courts: Court[];
	onAssign: (courtId: number) => void;
	onCancel: () => void;
}

const GAME_TYPE_BADGE: Record<string, string> = {
	혼복: "badge badge-mixed",
	남복: "badge badge-men",
	여복: "badge badge-women",
	혼합: "badge badge-blend",
};

export default function TeamDialog({
	team,
	courts,
	onAssign,
	onCancel,
}: Props) {
	const emptyCourts = courts.filter((c) => c.match === null);

	return (
		<div className="fixed inset-0 lq-overlay flex items-end justify-center z-50 px-4 pb-6">
			<div className="lq-sheet w-full max-w-sm rounded-3xl overflow-hidden">
				{/* Header */}
				<div className="flex items-center justify-between px-5 pt-5 pb-4">
					<h3 className="font-bold text-gray-800 dark:text-white text-lg">
						생성된 팀
					</h3>
					<span className={GAME_TYPE_BADGE[team.gameType]}>
						{team.gameType}
					</span>
				</div>

				{/* Team display */}
				<div className="px-5 pb-4">
					<div className="glass-sub rounded-2xl p-4">
						{/* Team A */}
						<div className="mb-3">
							<p className="text-xs font-semibold text-gray-500 dark:text-gray-300 uppercase tracking-wide mb-2">
								A팀
							</p>
							<div className="flex gap-2">
								{team.teamA.map((p) => (
									<div
										key={p.id}
										className="flex-1 glass-item rounded-xl p-3 text-center"
									>
										<p className="font-bold text-gray-800 dark:text-white text-sm">
											{p.name}
										</p>
										<div className="flex justify-center mt-1.5">
											<span
												style={{
													width: 8,
													height: 8,
													borderRadius: "50%",
													background: p.gender === "F" ? "#ff2d55" : "#007aff",
													display: "inline-block",
												}}
											/>
										</div>
									</div>
								))}
							</div>
						</div>

						{/* VS */}
						<div className="text-center py-0.5">
							<span
								className="text-xs font-black tracking-widest px-3 py-1 rounded-full"
								style={{
									color: "var(--text-secondary)",
									background: "var(--mat-ultra-thin)",
									borderColor: "var(--border-light)",
								}}
							>
								VS
							</span>
						</div>

						{/* Team B */}
						<div className="mt-3">
							<p className="text-xs font-semibold text-gray-500 dark:text-gray-300 uppercase tracking-wide mb-2">
								B팀
							</p>
							<div className="flex gap-2">
								{team.teamB.map((p) => (
									<div
										key={p.id}
										className="flex-1 glass-item rounded-xl p-3 text-center"
									>
										<p className="font-bold text-gray-800 dark:text-white text-sm">
											{p.name}
										</p>
										<div className="flex justify-center mt-1.5">
											<span
												style={{
													width: 8,
													height: 8,
													borderRadius: "50%",
													background: p.gender === "F" ? "#ff2d55" : "#007aff",
													display: "inline-block",
												}}
											/>
										</div>
									</div>
								))}
							</div>
						</div>
					</div>
				</div>

				{/* Court assignment */}
				<div className="px-5 pb-5">
					<p className="text-sm text-gray-500 dark:text-gray-400 mb-3 font-semibold">
						어느 코트에 배정할까요?
					</p>
					<div className="flex gap-2 flex-wrap">
						{emptyCourts.map((court) => (
							<button
								type="button"
								key={court.id}
								onClick={() => onAssign(court.id)}
								className="btn-lq-primary flex-1 min-w-[60px] py-3 text-sm"
							>
								코트 {court.id}
							</button>
						))}
					</div>
					{emptyCourts.length === 0 && (
						<p
							className="text-sm text-center font-medium"
							style={{ color: "#ff3b30" }}
						>
							빈 코트가 없습니다
						</p>
					)}
					<button
						type="button"
						onClick={onCancel}
						className="w-full mt-3 py-3 text-sm text-gray-400 dark:text-gray-500 font-semibold"
					>
						취소
					</button>
				</div>
			</div>
		</div>
	);
}
