interface SessionControlsProps {
	onGenerate: () => void;
	canGenerate: boolean;
	onReserveClick: () => void;
	canReserve: boolean;
	waitingCount: number;
}

export default function SessionControls({
	onGenerate,
	canGenerate,
	onReserveClick,
	canReserve,
	waitingCount,
}: SessionControlsProps) {
	return (
		<div className="lq-bar p-4 space-y-2">
			<button
				type="button"
				onClick={onGenerate}
				disabled={!canGenerate}
				className="btn-lq-primary w-full py-4 text-lg"
			>
				팀 생성
			</button>
			<button
				type="button"
				onClick={onReserveClick}
				disabled={!canReserve}
				className="btn-lq-secondary w-full py-3 text-sm"
			>
				팀 예약생성
			</button>
			{!canGenerate && waitingCount < 4 && waitingCount > 0 && (
				<p className="text-xs text-center text-gray-400 dark:text-gray-500">
					{4 - waitingCount}명 더 필요
				</p>
			)}
		</div>
	);
}
