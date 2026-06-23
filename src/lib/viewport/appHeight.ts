/**
 * iOS 설치형 PWA 풀스크린 높이 보정 (iOS 버전 무관 — iOS17 시뮬레이터~iOS26 실기기 재현).
 *
 * iOS standalone 에서 CSS 뷰포트 단위(lvh/dvh/svh)는 레이아웃 뷰포트(예: 869)만
 * 보고해 물리 화면(예: 956)에 못 닿는다. 반면 window.screen 은 진짜 화면 크기를 주므로,
 * 그 값을 CSS 변수 --app-h 로 주입하면 셸(.app-shell-h / .app-shell-minh)이 화면 전체를
 * 그린다. (실기기 검증: height=screen.height 일 때 콘텐츠가 홈 인디케이터 밑까지 렌더됨)
 *
 * 일반 브라우저는 동적 툴바가 있어 screen.height 가 과대 → 적용하지 않고 CSS dvh 폴백 사용.
 */
export function initAppHeight(): void {
	const standalone = window.matchMedia("(display-mode: standalone)").matches;
	if (!standalone) return; // 브라우저는 CSS dvh/lvh 폴백으로 충분

	const apply = () => {
		// screen.width/height 가 방향에 따라 swap 될 수도, 안 될 수도 있어 max/min 으로 정규화
		const { width, height } = window.screen;
		const landscape = window.matchMedia("(orientation: landscape)").matches;
		const full = landscape ? Math.min(width, height) : Math.max(width, height);
		document.documentElement.style.setProperty("--app-h", `${full}px`);
	};

	apply();
	window.addEventListener("resize", apply);
	window.addEventListener("orientationchange", apply);
}
