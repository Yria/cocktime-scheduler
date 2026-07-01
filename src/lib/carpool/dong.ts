/**
 * 주소·자유입력 문자열에서 "구 동"(행정구역 동 단위)만 추출한다.
 * 카풀은 동 단위 위치만 쓰므로 상세주소·건물명·번지 등은 버린다.
 * 구/동 토큰이 없으면(예: 장소명만 입력) 원문(trim)을 그대로 반환한다(파싱 실패 폴백).
 *
 * 예) "서울 강남구 역삼동 123-4 5층" → "강남구 역삼동"
 *     "역삼동"                     → "역삼동"
 *     "서울 강남구 테헤란로 152"    → "강남구"(도로명은 동이 아니라 제외)
 *     "우리집"                     → "우리집"(파싱 불가 시 원문)
 *
 * 동 토큰은 동/읍/면/가(종로1가 등 법정동)만 인정하고 '로'(도로명)는 제외한다.
 */
export function dongFromAddress(addr: string): string {
	const parts = addr.trim().split(/\s+/);
	const gu = parts.find((p) => /[구군]$/.test(p));
	const dong = parts.find((p) => /[동읍면가]$/.test(p));
	return [gu, dong].filter(Boolean).join(" ") || addr.trim();
}
