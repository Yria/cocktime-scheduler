/* eslint-disable @typescript-eslint/no-explicit-any -- 카카오 지도 SDK는 전역 주입 + 공식 타입 없음 */
// 거주 동(텍스트) → 동 중심점 좌표 변환.
// 개인정보 원칙: 회원별 정밀 좌표는 저장하지 않는다(집주소 = 개인정보). "동의 중심점"만 쓰며,
// 이는 이미 저장된 동 텍스트보다 더 드러나는 정보가 없다(같은 동은 같은 점).
// 캐시는 메모리(Map)만 — 동 종류가 수십 개라 호출이 적고, localStorage 는 기기별이라 이점이 미미.

import { loadKakaoMaps } from "../kakaoMap";

export interface LatLng {
	lat: number;
	lng: number;
}

// region 텍스트 → 좌표(null = 해석 실패). 세션 수명 동안 공유.
const cache = new Map<string, LatLng | null>();

/** 동 텍스트 1건 지오코딩(addressSearch). 실패 시 null. 결과 메모리 캐시. */
export async function geocodeDong(region: string): Promise<LatLng | null> {
	const key = region.trim();
	if (!key) return null;
	if (cache.has(key)) return cache.get(key) ?? null;

	let kakao: any;
	try {
		kakao = await loadKakaoMaps();
	} catch {
		cache.set(key, null);
		return null;
	}

	const result = await new Promise<LatLng | null>((resolve) => {
		const geocoder = new kakao.maps.services.Geocoder();
		geocoder.addressSearch(key, (res: any[], status: any) => {
			if (status === kakao.maps.services.Status.OK && res?.length) {
				resolve({ lat: Number(res[0].y), lng: Number(res[0].x) });
			} else {
				resolve(null);
			}
		});
	});
	cache.set(key, result);
	return result;
}

/** 여러 동을 중복 제거 후 병렬 지오코딩. region(trim) → 좌표|null 맵. */
export async function geocodeDongs(
	regions: string[],
): Promise<Map<string, LatLng | null>> {
	const distinct = Array.from(
		new Set(regions.map((r) => r.trim()).filter(Boolean)),
	);
	const out = new Map<string, LatLng | null>();
	await Promise.all(
		distinct.map(async (r) => {
			out.set(r, await geocodeDong(r));
		}),
	);
	return out;
}
