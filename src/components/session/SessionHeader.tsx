export interface SessionHeaderProps {
	onBack: () => void;
	onEndClick: () => void;
}

export default function SessionHeader({
	onBack,
	onEndClick,
}: SessionHeaderProps) {
	return (
		<div className="lq-header h-14 px-4 flex items-center gap-3 flex-shrink-0">
			<button
				type="button"
				onClick={onBack}
				className="w-8 h-8 flex items-center justify-center rounded-full glass-item text-gray-500 dark:text-gray-400"
			>
				‹
			</button>
			<h2 className="font-bold text-gray-800 dark:text-white text-lg tracking-tight flex-1">
				코트 현황
			</h2>
			<button
				type="button"
				onClick={onEndClick}
				className="badge badge-women px-3 py-1.5 text-xs rounded-[10px]"
			>
				종료
			</button>
		</div>
	);
}
