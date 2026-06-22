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
