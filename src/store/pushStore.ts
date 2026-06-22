/**
 * pushStore
 *
 * 웹푸시(잠금화면 알림) 구독 상태. 헤더 메뉴 항목과 PushSettingsSheet가 공유한다.
 * - init: App 마운트 시 SW 멱등 등록 + 현재 권한/구독 상태 동기화(권한요청 없음)
 * - enable/disable: 버튼 클릭에서 구독/해지 (enable 내부 첫 await가 권한요청 → iOS 제스처 유지)
 */
import { create } from "zustand";
import { getInstallState, type InstallState } from "../lib/push/platform";
import * as push from "../lib/push/subscription";

interface PushState {
	installState: InstallState;
	permission: NotificationPermission;
	subscribed: boolean;
	busy: boolean;
}

const initialPermission: NotificationPermission =
	typeof Notification !== "undefined" ? Notification.permission : "default";

export const usePushStore = create<PushState>(() => ({
	installState: getInstallState(),
	permission: initialPermission,
	subscribed: false,
	busy: false,
}));

export const pushActions = {
	async init() {
		const installState = getInstallState();
		usePushStore.setState({ installState });
		if (installState !== "supported") return;
		await push.registerServiceWorker().catch(() => {});
		try {
			const st = await push.getStatus();
			usePushStore.setState({
				permission: st.permission,
				subscribed: st.subscribed,
			});
		} catch {
			// 무시: 상태 조회 실패는 UI 기본값 유지
		}
	},

	async enable(memberId: string): Promise<push.PushStatus> {
		usePushStore.setState({ busy: true });
		try {
			const st = await push.subscribe(memberId);
			usePushStore.setState({
				permission: st.permission,
				subscribed: st.subscribed,
			});
			return st;
		} finally {
			usePushStore.setState({ busy: false });
		}
	},

	async disable(memberId: string) {
		usePushStore.setState({ busy: true });
		try {
			const st = await push.unsubscribe(memberId);
			usePushStore.setState({
				permission: st.permission,
				subscribed: st.subscribed,
			});
		} finally {
			usePushStore.setState({ busy: false });
		}
	},
};
