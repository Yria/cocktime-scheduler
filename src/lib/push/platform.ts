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
	// iOS 설치형: navigator.standalone === true
	if (
		"standalone" in navigator &&
		(navigator as { standalone?: boolean }).standalone === true
	) {
		return true;
	}
	// 설치형 PWA는 브라우저/매니페스트에 따라 standalone 외에 fullscreen·minimal-ui·
	// window-controls-overlay 로도 실행된다(예: Samsung Internet 의 홈 화면 추가 → minimal-ui).
	// display-mode 미디어쿼리는 '현재 표시 모드'에만 매치하므로, 이들을 모두 '설치됨'으로 인정해야
	// 실제 설치한 사용자가 needs-install 로 오탐 락아웃되지 않는다.
	return window.matchMedia(
		"(display-mode: standalone), (display-mode: fullscreen), (display-mode: minimal-ui), (display-mode: window-controls-overlay)",
	).matches;
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
	| "supported" // 홈 화면 설치됨(standalone) + 푸시 지원 → 바로 켤 수 있음
	| "needs-install" // 미설치(비 standalone) → 알림 필수 조건: 홈 화면 설치 먼저(iOS·Android·데스크톱 공통)
	| "unsupported"; // 설치해도 푸시 불가한 환경(인앱 브라우저·구형 등)

// 잠금화면 알림은 홈 화면에 앱을 설치(standalone 실행)해야만 안정적으로 동작하므로,
// 플랫폼과 무관하게 설치를 '필수'로 요구한다. (iOS는 Safari 탭에서 PushManager 자체가
// 막히고, Android/데스크톱도 브라우저 탭보다 설치형이 전달 신뢰도가 높다.)
export function getInstallState(): InstallState {
	// iOS Safari 탭: PushManager가 막혀 isPushSupported()=false 지만 홈 화면 설치로 해결 → needs-install
	if (isIOS() && !isStandalone()) return "needs-install";
	// 그 외 환경에서 푸시 API 자체가 없으면 설치해도 불가 → unsupported
	if (!isPushSupported()) return "unsupported";
	// 푸시는 가능하지만 홈 화면 미설치 → 설치를 먼저 요구(안드로이드/데스크톱 브라우저 탭 포함)
	if (!isStandalone()) return "needs-install";
	return "supported";
}
