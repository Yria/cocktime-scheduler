import ConfirmDialog from "../common/ConfirmDialog";

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
		<ConfirmDialog
			title="로그 클리어"
			message="현재 세션의 모든 매치 기록을 삭제하고 게임 횟수를 초기화합니다. 이 작업은 되돌릴 수 없습니다."
			confirmLabel="클리어"
			tone="danger"
			busy={clearing}
			busyLabel="처리 중…"
			onConfirm={handleClear}
			onCancel={() => setShowClearConfirm(false)}
		/>
	);
}
