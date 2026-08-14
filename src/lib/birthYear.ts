/**
 * birthYear.ts
 *
 * 출생년도 표기 규약. 동명이인이 많아 이름만으로는 구분이 안 되므로,
 * 보드를 제외한 화면에서는 이름 뒤에 두 자리 년생을 회색으로 덧붙인다("홍길동 85").
 * 보드(자석/코트)는 공간이 좁고 이미 사진·성별로 구분되므로 대상이 아니다.
 */

/**
 * 출생년도 → 두 자리 표기("1985" → "85", 2001 → "01").
 * 미입력이거나 상식 밖 값(1900 미만·현재+연도 초과)이면 null — 호출부는 년생 없이 이름만 표시한다.
 */
export function birthYearShort(birthYear: number | null | undefined): string | null {
	if (birthYear == null || !Number.isFinite(birthYear)) return null;
	const y = Math.trunc(birthYear);
	if (y < 1900 || y > 2100) return null;
	return String(y % 100).padStart(2, "0");
}

/**
 * 이름 + 년생 한 줄 문자열("홍길동 85"). 년생이 없으면 이름 그대로.
 * 확인 다이얼로그 문구·aria-label 등 JSX 를 못 쓰는 자리에서 사용.
 * 화면 표시는 년생만 회색으로 빼는 <BirthYearTag> 를 우선 사용한다.
 */
export function nameWithBirthYear(
	name: string,
	birthYear: number | null | undefined,
): string {
	const y = birthYearShort(birthYear);
	return y ? `${name} ${y}` : name;
}
