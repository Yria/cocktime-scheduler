/* eslint-disable @typescript-eslint/no-explicit-any -- 카카오 지도 SDK는 전역 주입 + 공식 타입 없음 */
// 카카오 지도 JS SDK 동적 로더 (도메인 제한 JS 앱키 사용 — 클라이언트 안전).
// .env: VITE_KAKAO_MAP_KEY=<카카오 개발자콘솔 JavaScript 키>
// 카카오 개발자콘솔 > 내 앱 > 플랫폼(Web)에 도메인 등록 필요(예: http://localhost:5173, 배포 도메인).
// services 라이브러리 포함 → 장소 키워드 검색(kakao.maps.services.Places) 사용.

// biome-ignore lint/suspicious/noExplicitAny: 카카오 SDK는 전역 window.kakao 로 주입되며 공식 타입이 없음
type KakaoNamespace = any;

let loadPromise: Promise<KakaoNamespace> | null = null;

export function hasKakaoKey(): boolean {
	return Boolean(import.meta.env.VITE_KAKAO_MAP_KEY);
}

export interface PlaceMapTarget {
	/** 데스크탑·폴백용 웹 URL(map.kakao.com). */
	webUrl: string;
	/** 모바일 카카오맵 네이티브 앱 스킴(kakaomap://). 좌표/이름 없으면 null. */
	appUrl: string | null;
}

/**
 * 장소 → 지도 열기 타깃. webUrl(웹)과 appUrl(네이티브 앱 스킴)을 함께 만든다.
 * - webUrl: 저장된 map_url(정확) → 좌표(핀) → 이름 검색.
 * - appUrl: 좌표 → `kakaomap://look`(네이티브 지도), 없으면 이름 → `kakaomap://search`.
 * 웹 URL을 못 만들면(정보 없음) null.
 */
export function buildPlaceMapTarget(
	place:
		| { name?: string | null; map_url?: string | null; lat?: number | null; lng?: number | null }
		| null
		| undefined,
): PlaceMapTarget | null {
	if (!place) return null;
	const name = place.name?.trim();
	const savedUrl = place.map_url?.trim();
	const hasCoords = place.lat != null && place.lng != null;

	let webUrl: string | null = null;
	if (savedUrl && /^https?:\/\//i.test(savedUrl)) webUrl = savedUrl;
	else if (hasCoords) webUrl = `https://map.kakao.com/link/map/${encodeURIComponent(name || "모임 장소")},${place.lat},${place.lng}`;
	else if (name) webUrl = `https://map.kakao.com/link/search/${encodeURIComponent(name)}`;
	if (!webUrl) return null;

	let appUrl: string | null = null;
	if (hasCoords) appUrl = `kakaomap://look?p=${place.lat},${place.lng}`;
	else if (name) appUrl = `kakaomap://search?q=${encodeURIComponent(name)}`;

	return { webUrl, appUrl };
}

function isMobileUA(): boolean {
	return typeof navigator !== "undefined" && /android|iphone|ipad|ipod/i.test(navigator.userAgent);
}

/**
 * 장소 지도 열기. 모바일이고 앱 스킴이 있으면 **카카오맵 네이티브 앱**을 우선 호출하고,
 * 앱이 안 떠서 화면이 그대로면(미설치 등) ~1.4초 뒤 웹으로 폴백한다. 데스크탑은 웹 새 탭.
 * (기존엔 map.kakao.com 웹 URL만 열어 카카오맵 앱이 이를 웹뷰로 띄우던 문제를 개선.)
 */
export function openPlaceMap(target: PlaceMapTarget): void {
	if (isMobileUA() && target.appUrl) {
		let opened = false;
		const onHide = () => {
			if (document.hidden) opened = true; // 앱이 떠서 PWA가 백그라운드로 → 폴백 취소
		};
		document.addEventListener("visibilitychange", onHide, { once: true });
		setTimeout(() => {
			document.removeEventListener("visibilitychange", onHide);
			if (!opened) window.location.href = target.webUrl; // 앱 미설치 → 웹
		}, 1400);
		window.location.href = target.appUrl; // 네이티브 앱 호출
		return;
	}
	window.open(target.webUrl, "_blank", "noopener,noreferrer");
}

/** 카카오 지도 SDK 로드(멱등). 이미 로드됐으면 즉시 resolve. 키 없으면 reject. */
export function loadKakaoMaps(): Promise<KakaoNamespace> {
	const key = import.meta.env.VITE_KAKAO_MAP_KEY as string | undefined;
	if (!key) {
		return Promise.reject(
			new Error("VITE_KAKAO_MAP_KEY 가 설정되지 않았습니다."),
		);
	}
	const w = window as unknown as { kakao?: KakaoNamespace };
	if (w.kakao?.maps?.LatLng) return Promise.resolve(w.kakao);
	if (loadPromise) return loadPromise;

	loadPromise = new Promise((resolve, reject) => {
		const script = document.createElement("script");
		script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${key}&autoload=false&libraries=services`;
		script.async = true;
		script.onload = () => {
			const kakao = (window as unknown as { kakao?: KakaoNamespace }).kakao;
			if (!kakao?.maps) {
				reject(new Error("Kakao SDK 로드 후 kakao.maps 없음"));
				return;
			}
			kakao.maps.load(() => resolve(kakao));
		};
		script.onerror = () => {
			loadPromise = null; // 재시도 허용
			reject(new Error("Kakao 지도 SDK 로드 실패(키/도메인 등록 확인)"));
		};
		document.head.appendChild(script);
	});
	return loadPromise;
}
