// VAPID 공개키(base64url, @negrel/webpush exportApplicationServerKey 출력) →
// pushManager.subscribe의 applicationServerKey(Uint8Array)로 변환.
export function urlBase64ToUint8Array(base64Url: string): Uint8Array {
	const padding = "=".repeat((4 - (base64Url.length % 4)) % 4);
	const base64 = (base64Url + padding).replace(/-/g, "+").replace(/_/g, "/");
	const raw = atob(base64);
	const out = new Uint8Array(raw.length);
	for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
	return out;
}
