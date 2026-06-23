/**
 * UUID 생성 — 보안 컨텍스트(HTTPS/localhost) + 최신 브라우저에서만 `crypto.randomUUID`가 존재한다.
 * HTTP 접속이나 구형 iOS Safari(15.4 미만)·일부 WebView/PWA에서는 함수 자체가 없어
 * "crypto.randomUUID is not a function" 오류가 난다. 가용하면 표준 API를, 아니면 RFC4122 v4
 * 형식을 직접 만들어 폴백한다(편집 락 식별자 등 형식 호환이 필요하므로 동일 포맷 유지).
 */
export function randomId(): string {
	if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
		return crypto.randomUUID();
	}
	// 폴백: crypto.getRandomValues가 있으면 그것으로, 없으면 Math.random으로 v4 UUID 생성
	const bytes = new Uint8Array(16);
	if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
		crypto.getRandomValues(bytes);
	} else {
		for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
	}
	bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
	bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant
	const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0"));
	return `${hex[0]}${hex[1]}${hex[2]}${hex[3]}-${hex[4]}${hex[5]}-${hex[6]}${hex[7]}-${hex[8]}${hex[9]}-${hex[10]}${hex[11]}${hex[12]}${hex[13]}${hex[14]}${hex[15]}`;
}
