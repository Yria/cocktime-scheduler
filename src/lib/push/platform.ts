// 웹푸시 가능 여부 / iOS 설치 상태 감지.
// iOS는 16.4+ 그리고 "홈 화면에 추가된 standalone PWA"에서만 푸시가 동작한다
// (Safari 탭에서는 Notification/PushManager가 막힘).

export function isIOS(): boolean {
	const ua = navigator.userAgent;
	// iPadOS 13+는 UA를 Mac으로 보고 → 터치 포인트로 보정
	return (
		/iPad|iPhone|iPod/.test(ua) ||
		(navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
	);
}

export function isAndroid(): boolean {
	return /Android/i.test(navigator.userAgent);
}

export function isStandalone(): boolean {
	return (
		("standalone" in navigator &&
			(navigator as { standalone?: boolean }).standalone === true) ||
		window.matchMedia("(display-mode: standalone)").matches
	);
}

/** 푸시 API가 기술적으로 존재하는가 */
export function isPushSupported(): boolean {
	return (
		"serviceWorker" in navigator &&
		"PushManager" in window &&
		"Notification" in window
	);
}

export type InstallState =
	| "supported" // 바로 켤 수 있음(Android/데스크톱, 또는 iOS standalone)
	| "ios-needs-install" // iOS Safari 탭 → 홈 화면 추가 안내 필요
	| "unsupported"; // 지원 불가

export function getInstallState(): InstallState {
	if (isIOS() && !isStandalone()) return "ios-needs-install";
	if (!isPushSupported()) return "unsupported";
	return "supported";
}
