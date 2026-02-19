import type { GameCountHistory, Player } from "../../types";

interface WaitingListProps {
	waiting: Player[];
	gameCountHistory: GameCountHistory;
	onToggleResting: (playerId: string) => void;
}

export default function WaitingList({
	waiting,
	gameCountHistory,
	onToggleResting,
}: WaitingListProps) {
	return (
		<div className="glass rounded-2xl p-4">
			<p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">
				대기&nbsp;
				<span className="text-ios-blue">{waiting.length}</span>명
			</p>
			{waiting.length === 0 ? (
				<p className="text-sm text-gray-400 dark:text-gray-500">
					대기 중인 선수가 없습니다
				</p>
			) : (
				<div className="flex flex-wrap gap-1.5">
					{waiting.map((p) => (
						<button
							key={p.id}
							type="button"
							onClick={() => onToggleResting(p.id)}
							className="chip hover:bg-gray-100 dark:hover:bg-gray-700 transition"
						>
							{p.gender === "F" ? "🔴" : "🔵"} {p.name}
							<span className="text-xs opacity-40 ml-0.5">
								{gameCountHistory[p.id] ?? 0}
							</span>
						</button>
					))}
				</div>
			)}
			{waiting.length > 0 && waiting.length < 4 && (
				<p className="text-xs mt-2.5 font-medium text-ios-red">
					{4 - waiting.length}명 더 필요
				</p>
			)}
		</div>
	);
}
