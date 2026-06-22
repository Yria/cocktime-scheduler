/**
 * notificationStore
 *
 * 로그인 회원의 인앱 알림 상태. 종모양(NotificationBell) UI가 구독한다.
 * - load: 로그인 시 최신 알림을 1회 조회
 * - pushRealtime: App의 실시간 구독에서 INSERT된 새 알림을 앞에 추가
 * - markAllRead: 패널을 열 때 미읽음을 일괄 읽음 처리(낙관적 갱신)
 * - clear: 로그아웃 시 초기화
 */
import { create } from "zustand";
import {
	fetchNotifications,
	markAllNotificationsRead,
} from "../lib/supabase/notifications";
import type { NotificationRow } from "../lib/supabase/types";

interface NotificationState {
	items: NotificationRow[];
	/** 미읽음(read_at == null) 개수 */
	unreadCount: number;
	loading: boolean;
}

export const useNotificationStore = create<NotificationState>(() => ({
	items: [],
	unreadCount: 0,
	loading: false,
}));

const countUnread = (items: NotificationRow[]) =>
	items.filter((n) => n.read_at == null).length;

export const notificationActions = {
	async load(memberId: string) {
		useNotificationStore.setState({ loading: true });
		try {
			const items = await fetchNotifications(memberId);
			useNotificationStore.setState({
				items,
				unreadCount: countUnread(items),
				loading: false,
			});
		} catch {
			useNotificationStore.setState({ loading: false });
		}
	},

	/** 실시간 INSERT 수신: 중복이 아니면 목록 맨 앞에 추가한다. */
	pushRealtime(n: NotificationRow) {
		const { items } = useNotificationStore.getState();
		if (items.some((x) => x.id === n.id)) return;
		const next = [n, ...items];
		useNotificationStore.setState({
			items: next,
			unreadCount: countUnread(next),
		});
	},

	async markAllRead(memberId: string) {
		const { items, unreadCount } = useNotificationStore.getState();
		if (unreadCount === 0) return;
		const now = new Date().toISOString();
		// 낙관적 갱신: 즉시 읽음 처리, 실패 시 재로드로 복구
		useNotificationStore.setState({
			items: items.map((n) => (n.read_at == null ? { ...n, read_at: now } : n)),
			unreadCount: 0,
		});
		try {
			await markAllNotificationsRead(memberId);
		} catch {
			void notificationActions.load(memberId);
		}
	},

	clear() {
		useNotificationStore.setState({
			items: [],
			unreadCount: 0,
			loading: false,
		});
	},
};
