import type { Player } from "../../types";

interface RestingListProps {
	resting: Player[];
	onToggleResting: (playerId: string) => void;
}

export default function RestingList({
	resting,
	onToggleResting,
}: RestingListProps) {
	if (resting.length === 0) return null;

	return (
		<div className="glass rounded-2xl p-4">
			<p className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide mb-3">
				휴식&nbsp;
				<span className="text-gray-500 dark:text-gray-400">
					{resting.length}
				</span>
				명
			</p>
			<div className="flex flex-wrap gap-1.5">
				{resting.map((p) => (
					<button
						key={p.id}
						type="button"
						onClick={() => onToggleResting(p.id)}
						className="chip opacity-60 hover:opacity-100 transition-opacity"
					>
						{p.gender === "F" ? "🔴" : "🔵"} {p.name}
					</button>
				))}
			</div>
		</div>
	);
}
