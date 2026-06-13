/**
 * toastStore
 *
 * 최소 기능 토스트 — 메시지 큐에 push하면 Toaster 컴포넌트가 자동 dismiss(기본 3초)까지 렌더.
 * window.alert 대체용. 모달 blocking 없이 비동기 로직의 피드백을 전달한다.
 *
 * 사용:
 *   import { toast } from "../store/toastStore";
 *   toast("대기열에 추가됨");
 *   toast("코트를 선점당했어요", { variant: "error" });
 */
import { create } from "zustand";

export type ToastVariant = "info" | "error" | "success";

export interface ToastItem {
	id: string;
	message: string;
	variant: ToastVariant;
	/** 자동 dismiss 지연(ms). 0 이하면 수동 dismiss 전까지 유지. */
	duration: number;
}

interface ToastState {
	items: ToastItem[];
	push: (message: string, opts?: { variant?: ToastVariant; duration?: number }) => string;
	dismiss: (id: string) => void;
	clear: () => void;
}

export const useToastStore = create<ToastState>((set) => ({
	items: [],
	push: (message, opts = {}) => {
		const id =
			typeof crypto !== "undefined" && "randomUUID" in crypto
				? crypto.randomUUID()
				: `toast_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
		const item: ToastItem = {
			id,
			message,
			variant: opts.variant ?? "info",
			duration: opts.duration ?? 3000,
		};
		set((s) => ({ items: [...s.items, item] }));
		return id;
	},
	dismiss: (id) => {
		set((s) => ({ items: s.items.filter((t) => t.id !== id) }));
	},
	clear: () => set({ items: [] }),
}));

/**
 * React 컴포넌트 바깥(훅, 액션 등)에서 쓰는 진입점.
 * 스토어 구독 없이 push만 한다.
 */
export function toast(
	message: string,
	opts?: { variant?: ToastVariant; duration?: number },
): string {
	return useToastStore.getState().push(message, opts);
}
