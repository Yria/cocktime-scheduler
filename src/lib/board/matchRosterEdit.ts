import type { Court, SessionPlayer } from "../../types";

/** Local preview only; never included in board_drafts or a match until explicitly saved. */
export interface MatchRosterEdit {
	matchId: string;
	original: string[];
	roster: string[];
}

export const rosterSaveKey = (courtId: number) => `roster:${courtId}`;
/** 다른 코트의 '선수 변경' 명단에 올라간 선수 — 화면에서 숨겨져 있으므로 어떤 추천·자동 채움에도 쓰지 않는다. */
export const editingRosterIds = (edits: ReadonlyMap<number, MatchRosterEdit>) => new Set([...edits.values()].flatMap(edit => edit.roster));
export const sameRoster = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((id, i) => id === b[i]);

export function currentMatchEdit(edit: MatchRosterEdit | undefined, court: Court | undefined) {
	return edit && court?.match?.id === edit.matchId && sameRoster(edit.original, [...court.match.teamA, ...court.match.teamB]) ? edit : undefined;
}

export function canUseMatchPlayer(playerId: string, courtId: number, session: {
	courts: Court[]; sessionPlayers: Map<string, SessionPlayer>; restingIds: string[]; cockCheckEnabled: boolean;
}, edits: ReadonlyMap<number, MatchRosterEdit>) {
	const player = session.sessionPlayers.get(playerId);
	if (!player) return false;
	if (session.courts.some(c => c.id !== courtId && c.match && [...c.match.teamA, ...c.match.teamB].includes(playerId))) return false;
	if ([...edits].some(([id, edit]) => id !== courtId && currentMatchEdit(edit, session.courts.find(c => c.id === id))?.roster.includes(playerId))) return false;
	const own = session.courts.find(c => c.id === courtId)?.match;
	if (own && [...own.teamA, ...own.teamB].includes(playerId)) return true;
	return player.status !== "resting" && !session.restingIds.includes(playerId) && (!session.cockCheckEnabled || player.cockChecked);
}
