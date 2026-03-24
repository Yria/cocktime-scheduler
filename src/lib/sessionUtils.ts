import type { Court, SessionPlayer } from "../types";

/**
 * 현재 경기중인 선수 ID 목록을 반환합니다.
 * courts.match.teamA/B는 ID 참조이므로 직접 반환합니다.
 */
export function getPlayingPlayerIds(courts: Court[]): string[] {
	return courts.flatMap((c) =>
		c.match ? [...c.match.teamA, ...c.match.teamB] : [],
	);
}

/**
 * 현재 경기중인 선수 목록을 반환합니다.
 * sessionPlayers Map과 함께 사용합니다.
 */
export function getPlayingPlayers(courts: Court[], sessionPlayers: Map<string, SessionPlayer>): SessionPlayer[] {
	return getPlayingPlayerIds(courts)
		.map((id) => sessionPlayers.get(id))
		.filter((p): p is SessionPlayer => p !== undefined);
}

/**
 * 배정 불가 선수 ID 집합을 반환합니다.
 * 경기중 선수와 대기열 선수를 합산합니다.
 */
export function getUnavailableIds(
	playingPlayers: SessionPlayer[],
	queuedPlayers: SessionPlayer[],
): Set<string> {
	return new Set([...playingPlayers, ...queuedPlayers].map((p) => p.id));
}

