import type { Court } from "../../types";

const GAME_TYPE_BADGE: Record<string, string> = {
	혼복: "badge badge-mixed",
	남복: "badge badge-men",
	여복: "badge badge-women",
	혼합: "badge badge-blend",
};

const GAME_TYPE_COURT: Record<string, string> = {
	혼복: "court-mixed",
	남복: "court-men",
	여복: "court-women",
	혼합: "court-blend",
};

interface CourtListProps {
	courts: Court[];
	onComplete: (courtId: number) => void;
}

export default function CourtList({ courts, onComplete }: CourtListProps) {
	return (
		<>
			{courts.map((court) => (
				<div
					key={court.id}
					className={`glass rounded-2xl overflow-hidden ${
						court.team ? (GAME_TYPE_COURT[court.team.gameType] ?? "") : ""
					}`}
				>
					{court.team ? (
						<div className="p-4">
							<div className="flex items-center justify-between mb-3">
								<span className="font-bold text-gray-800 dark:text-white text-sm">
									코트 {court.id}
								</span>
								<span className={GAME_TYPE_BADGE[court.team.gameType]}>
									{court.team.gameType}
								</span>
							</div>

							<div className="flex gap-3 items-center">
								<div className="flex-1 space-y-1.5">
									{court.team.teamA.map((p) => (
										<div
											key={p.id}
											className="glass-item rounded-xl px-3 py-2 text-sm font-medium text-gray-800 dark:text-gray-100 flex items-center gap-1.5"
										>
											<span>{p.gender === "F" ? "🔴" : "🔵"}</span>
											<span>{p.name}</span>
										</div>
									))}
								</div>

								<div className="flex-shrink-0 flex flex-col items-center">
									<span
										className="text-xs font-black tracking-widest px-2 py-0.5 rounded-md"
										style={{
											color: "var(--text-tertiary)",
											background: "var(--mat-ultra-thin)",
										}}
									>
										VS
									</span>
								</div>

								<div className="flex-1 space-y-1.5">
									{court.team.teamB.map((p) => (
										<div
											key={p.id}
											className="glass-item rounded-xl px-3 py-2 text-sm font-medium text-gray-800 dark:text-gray-100 flex items-center gap-1.5"
										>
											<span>{p.gender === "F" ? "🔴" : "🔵"}</span>
											<span>{p.name}</span>
										</div>
									))}
								</div>
							</div>

							<button
								type="button"
								onClick={() => onComplete(court.id)}
								className="glass-item w-full mt-3 py-2.5 text-gray-600 dark:text-gray-300 rounded-xl text-sm font-semibold"
							>
								경기 완료
							</button>
						</div>
					) : (
						<div className="p-4 flex items-center justify-between opacity-70">
							<span className="font-bold text-gray-700 dark:text-gray-300 text-sm">
								코트 {court.id}
							</span>
							<span className="text-xs text-gray-400 dark:text-gray-500 font-medium">
								비어있음
							</span>
						</div>
					)}
				</div>
			))}
		</>
	);
}
