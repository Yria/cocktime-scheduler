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
		message={prompt.alternative
			? "이 팀이 출전하면 운영진이 모두 경기 중이 돼요. 다른 준비된 팀을 먼저 시작하고, 운영진이 돌아오면 원래 순서로 안내할게요."
			: "이 팀이 출전하면 운영진이 모두 경기 중이 돼요. 대신 출전할 준비된 팀이 없어, 교대를 기다리거나 이번 경기를 시작할 수 있어요."}
		confirmLabel={prompt.alternative ? "대기 유지" : "이번 경기 시작"}
		cancelLabel="교대까지 대기" hideCancel={!!prompt.alternative}
		onConfirm={prompt.alternative ? close : prompt.start} onCancel={close} onDismiss={close}>
		<div className="rounded-xl bg-gray-100 p-3 text-sm text-gray-800 dark:bg-gray-800 dark:text-gray-100 break-keep">
			<p className="font-semibold">{prompt.names}</p>
			{prompt.alternative && <p className="mt-2">먼저 출전 가능: {prompt.alternative.label}</p>}
		</div>
	</ConfirmDialog>;
}
