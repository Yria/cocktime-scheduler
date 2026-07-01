/**
 * player.ts
 *
 * 게스트(임시 추가 선수) id 규약. id가 GUEST_ID_PREFIX로 시작하면 게스트.
 */
export const GUEST_ID_PREFIX = "guest-";

// 같은 밀리초에 두 명을 추가해도 충돌하지 않도록 카운터를 덧붙인다.
let guestCounter = 0;

/** 새 게스트 id 생성 (세션 내 유일). */
export function makeGuestId(): string {
	guestCounter += 1;
	return `${GUEST_ID_PREFIX}${Date.now()}-${guestCounter}`;
}

/** id가 게스트 id인지 여부. */
export function isGuestId(id: string): boolean {
	return id.startsWith(GUEST_ID_PREFIX);
}

/** 흔한 2글자 성(복성). 성을 제외한 이름 첫 글자를 뽑을 때 성 길이 판별에 쓴다. */
const COMPOUND_SURNAMES = [
	"남궁", "황보", "제갈", "선우", "독고", "동방", "사공", "서문",
];

/**
 * 프로필 사진이 없을 때 아바타에 표시할 이니셜(성을 제외한 이름의 첫 글자).
 * - 한글 이름: 성(1글자, 복성은 2글자)을 뺀 이름의 첫 글자. 예) 김민수 → "민", 남궁민수 → "민"
 * - 성만 있는 1글자 이름·비한글 이름: 첫 글자를 그대로 사용.
 */
export function getNameInitial(name: string): string {
	const trimmed = name.trim();
	if (!trimmed) return "";
	// 한글로 시작하지 않으면(영문 등) 성 개념이 없으므로 첫 글자 사용.
	if (!/^[가-힣]/.test(trimmed)) return trimmed.charAt(0);
	const surnameLen = COMPOUND_SURNAMES.some((s) => trimmed.startsWith(s)) ? 2 : 1;
	// 성만 있는 이름은 성 글자를 그대로 표시.
	return trimmed.length > surnameLen ? trimmed.charAt(surnameLen) : trimmed.charAt(0);
}
