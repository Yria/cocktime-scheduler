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
