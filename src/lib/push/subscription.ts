import { deleteSubscription, saveSubscription } from "./db";
import { isPushSupported } from "./platform";
import { urlBase64ToUint8Array } from "./vapid";

const VAPID_PUBLIC = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined;

export interface PushStatus {
	supported: boolean;
	permission: NotificationPermission;
	subscribed: boolean;
}

/** SW 등록(멱등). base path 기준 절대경로 + scope. */
export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
	if (!("serviceWorker" in navigator)) return null;
	const base = import.meta.env.BASE_URL; // "/" 또는 "/cocktime-scheduler/"
	return navigator.serviceWorker.register(`${base}sw.js`, { scope: base });
}

/** 현재 상태 조회(부수효과/권한요청 없음). UI 초기 렌더용. */
export async function getStatus(): Promise<PushStatus> {
	if (!isPushSupported()) {
		return { supported: false, permission: "denied", subscribed: false };
	}
	const reg = await navigator.serviceWorker.getRegistration(
		import.meta.env.BASE_URL,
	);
	const sub = reg ? await reg.pushManager.getSubscription() : null;
	return {
		supported: true,
		permission: Notification.permission,
		subscribed: !!sub,
	};
}

/** 구독(켜기). 반드시 버튼 클릭 핸들러에서 호출 — 첫 await가 권한요청이라 iOS 제스처 유지. */
export async function subscribe(memberId: string): Promise<PushStatus> {
	if (!isPushSupported()) throw new Error("unsupported");
	if (!VAPID_PUBLIC) throw new Error("missing-vapid");

	const permission = await Notification.requestPermission();
	if (permission !== "granted") {
		return { supported: true, permission, subscribed: false };
	}

	await registerServiceWorker();
	const reg = await navigator.serviceWorker.ready;

	let sub = await reg.pushManager.getSubscription();
	if (!sub) {
		sub = await reg.pushManager.subscribe({
			userVisibleOnly: true,
			// Uint8Array<ArrayBufferLike>(TS 5.7) → BufferSource 정합 캐스팅
			applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC) as BufferSource,
		});
	}

	const json = sub.toJSON();
	await saveSubscription(memberId, {
		endpoint: json.endpoint as string,
		p256dh: (json.keys as Record<string, string>).p256dh,
		auth: (json.keys as Record<string, string>).auth,
	});

	return { supported: true, permission: "granted", subscribed: true };
}

/** 해지(끄기). 로컬 unsubscribe + DB 삭제. 부분 실패에 견고하게. */
export async function unsubscribe(memberId: string): Promise<PushStatus> {
	const reg = await navigator.serviceWorker.getRegistration(
		import.meta.env.BASE_URL,
	);
	const sub = reg ? await reg.pushManager.getSubscription() : null;
	if (sub) {
		const endpoint = sub.endpoint;
		await sub.unsubscribe().catch(() => {});
		await deleteSubscription(memberId, endpoint).catch(() => {});
	}
	return {
		supported: isPushSupported(),
		permission:
			typeof Notification !== "undefined" ? Notification.permission : "denied",
		subscribed: false,
	};
}
