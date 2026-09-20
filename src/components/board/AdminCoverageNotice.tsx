import { useEffect } from "react";
import { useAdminCoverageStore } from "../../store/adminCoverageStore";
import { useSessionStore } from "../../store/sessionStore";
import { useAppStore } from "../../store/appStore";
import ConfirmDialog from "../common/ConfirmDialog";

export default function AdminCoverageNotice({ sync = true }: { sync?: boolean }) {
	const prompt = useAdminCoverageStore(s => s.prompt);
	const isEditor = useSessionStore(s => s.isEditor);
	const sessionId = useAppStore(s => s.sessionMeta?.sessionId);
	useEffect(() => {
		if (!sync || !sessionId) return;
		useAdminCoverageStore.setState({ prompt: null });
		const refresh = () => { if (!document.hidden) void useAdminCoverageStore.getState().refresh(); };
		refresh();
		const timer = window.setInterval(refresh, 30000);
		window.addEventListener("online", refresh);
		document.addEventListener("visibilitychange", refresh);
		return () => {
			window.clearInterval(timer); window.removeEventListener("online", refresh);
			document.removeEventListener("visibilitychange", refresh);
			useAdminCoverageStore.setState({ prompt: null });
		};
	}, [sessionId, sync]);
	useEffect(() => {
		if (!isEditor) useAdminCoverageStore.setState({ prompt: null });
	}, [isEditor]);
	if (!prompt || !isEditor) return null;
	const close = () => useAdminCoverageStore.setState({ prompt: null });
	return <ConfirmDialog title="운영진 교대 대기" maxWidth="sm"
		message="운영진이 최소 한 명은 경기 밖에 남아 있어야 해요. 교대할 운영진이 돌아올 때까지 이 팀은 시작할 수 없어요."
		confirmLabel={prompt.alternative ? "대기 유지" : "교대까지 대기"}
		hideCancel onConfirm={close} onCancel={close} onDismiss={close}>
		<div className="rounded-xl bg-gray-100 p-3 text-sm text-gray-800 dark:bg-gray-800 dark:text-gray-100 break-keep">
			<p className="font-semibold">{prompt.names}</p>
			{prompt.alternative && <p className="mt-2">먼저 출전 가능: {prompt.alternative.label}</p>}
		</div>
	</ConfirmDialog>;
}
