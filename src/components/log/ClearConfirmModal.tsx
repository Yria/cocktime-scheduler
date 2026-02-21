interface ClearConfirmModalProps {
	clearing: boolean;
	handleClear: () => void;
	setShowClearConfirm: (show: boolean) => void;
}

export default function ClearConfirmModal({
	clearing,
	handleClear,
	setShowClearConfirm,
}: ClearConfirmModalProps) {
	return (
		<div className="fixed inset-0 lq-overlay flex items-center justify-center z-50 px-6">
			<div className="lq-sheet p-6 w-full max-w-sm rounded-3xl overflow-hidden">
				<h3 className="font-bold text-gray-800 dark:text-white text-lg mb-1.5">
					로그 클리어
				</h3>
				<p className="text-sm text-gray-600 dark:text-gray-300 mb-5 leading-relaxed">
					현재 세션의 모든 매치 기록을 삭제하고 게임 횟수를 초기화합니다. 이
					작업은 되돌릴 수 없습니다.
				</p>
				<div className="flex gap-3">
					<button
						type="button"
						onClick={() => setShowClearConfirm(false)}
						disabled={clearing}
						className="btn-lq-secondary flex-1 py-3 text-sm"
					>
						취소
					</button>
					<button
						type="button"
						onClick={handleClear}
						disabled={clearing}
						className="btn-lq-red flex-1 py-3 text-sm"
					>
						{clearing ? "처리 중…" : "클리어"}
					</button>
				</div>
			</div>
		</div>
	);
}
