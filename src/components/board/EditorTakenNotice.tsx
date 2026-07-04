import { useSessionStore } from "../../store/sessionStore";
import ConfirmDialog from "../common/ConfirmDialog";

/**
 * 편집권 뺏김 알림 — 내가 편집 중이었는데 다른 사람이 "편집 권한 가져오기"로 가져가면
 * (sessionStore.recomputeLock 이 editorTakenBy 세팅) 누구에게 뺏겼는지 다이얼로그로 알린다.
 * 자발적 양도(handoffEditor)는 억제되어 뜨지 않는다. 확인 시 닫고 보기 전용으로 남는다.
 */
export default function EditorTakenNotice() {
	const takenBy = useSessionStore((s) => s.editorTakenBy);
	const dismiss = useSessionStore((s) => s.dismissEditorTakenNotice);
	if (!takenBy) return null;

	return (
		<ConfirmDialog
			title="편집 권한이 넘어갔어요"
			message={
				<>
					<b>{takenBy}</b> 님이 편집 권한을 가져갔어요. 지금은 <b>보기 전용</b>이며, 다시
					편집하려면 하단의 ‘보기 전용’ 버튼으로 권한을 가져오세요.
				</>
			}
			confirmLabel="확인"
			hideCancel
			onConfirm={dismiss}
			onDismiss={dismiss}
		/>
	);
}
