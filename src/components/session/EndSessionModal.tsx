import ModalSheet from "../common/ModalSheet";

export interface EndSessionModalProps {
	onConfirm: () => void;
	onCancel: () => void;
}

export default function EndSessionModal({
	onConfirm,
	onCancel,
}: EndSessionModalProps) {
	return (
		<ModalSheet position="center" className="p-6">
			<h3 className="font-bold text-gray-800 dark:text-white text-lg mb-1.5">
				세션 종료
			</h3>
			<p className="text-sm text-gray-600 dark:text-gray-300 mb-5">
				모든 큐가 초기화됩니다.
			</p>
			<div className="flex gap-3">
				<button
					type="button"
					onClick={onCancel}
					className="btn-lq-secondary flex-1 py-3 text-sm"
				>
					취소
				</button>
				<button
					type="button"
					onClick={onConfirm}
					className="btn-lq-red flex-1 py-3 text-sm"
				>
					종료
				</button>
			</div>
		</ModalSheet>
	);
}
