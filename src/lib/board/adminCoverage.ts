import type { Court, SessionPlayer } from "../../types";
import type { DraftTeam, MagnetPosition, Reservation } from "../../types/board";
import { playingIdsFromCourts, teamMembers } from "./membership";

export interface CoverageCandidate {
	key: string;
	ids: string[];
	order: number;
	label: string;
}
export interface CoverageProposal {
	id: string; player_ids: string[]; created_at: string; status: string;
}
export interface CoverageInputs {
	sessionPlayers: ReadonlyMap<string, SessionPlayer>;
	courts: Court[];
	cockCheckEnabled: boolean;
	adminMemberIds: ReadonlySet<string>;
	drafts: ReadonlyMap<string, DraftTeam>;
	reservations: ReadonlyMap<string, Reservation>;
	magnets: ReadonlyMap<string, MagnetPosition>;
	startingIds?: ReadonlySet<string>;
	proposals?: readonly CoverageProposal[];
}

/** A resting administrator can still operate the board. Unchecked registrations
 * are not evidence of arrival when cock checking is enabled. Courts are authoritative. */
export function availableAdminIds(input: CoverageInputs): string[] {
	const playing = playingIdsFromCourts(input.courts);
	return [...input.sessionPlayers.values()].filter(p => p.memberId && input.adminMemberIds.has(p.memberId)
		&& (!input.cockCheckEnabled || p.cockChecked || playing.has(p.id)))
		.map(p => p.id).filter(id => !playing.has(id) && !input.startingIds?.has(id));
}

export function leavesNoAdmin(ids: readonly string[], input: CoverageInputs): boolean {
	const outside = availableAdminIds(input);
	// No available administrator already: holding ordinary members cannot fix that.
	return outside.length > 0 && outside.every(id => ids.includes(id));
}

/** Keep original order; deferring a team never rewrites its timestamp. */
export function coverageQueue(input: CoverageInputs): CoverageCandidate[] {
	const playing = playingIdsFromCourts(input.courts);
	const ready = (ids: string[]) => ids.length === 4 && new Set(ids).size === 4 && ids.every(id => {
		const p = input.sessionPlayers.get(id);
		return p && p.status !== "resting" && (!input.cockCheckEnabled || p.cockChecked)
			&& !playing.has(id) && !input.startingIds?.has(id);
	});
	const candidates: CoverageCandidate[] = [];
	for (const team of input.drafts.values()) {
		const members = teamMembers(team.id, input.drafts, input.reservations);
		const ids = members.map(m => m.playerId);
		if (!ready(ids) || members.some(m => m.kind === "ghost" && input.magnets.get(m.playerId)?.teamId)) continue;
		candidates.push({ key: `team:${team.id}`, ids, order: team.confirmedMs ?? team.createdAt, label: ids.map(id => input.sessionPlayers.get(id)!.name).join(" · ") });
	}
	for (const p of input.proposals ?? []) {
		if (!["pending", "reviewed"].includes(p.status) || !ready(p.player_ids)) continue;
		if (p.player_ids.some(id => input.magnets.get(id)?.teamId || [...input.reservations.values()].some(r => r.playerId === id))) continue;
		candidates.push({ key: `proposal:${p.id}`, ids: p.player_ids, order: Date.parse(p.created_at) || 0, label: p.player_ids.map(id => input.sessionPlayers.get(id)!.name).join(" · ") });
	}
	return candidates.sort((a, b) => a.order - b.order || a.key.localeCompare(b.key));
}

export function adminCoverageDecision(ids: readonly string[], input: CoverageInputs) {
	const held = leavesNoAdmin(ids, input);
	const alternative = held ? coverageQueue(input).find(team => !leavesNoAdmin(team.ids, input)) : undefined;
	return { held, alternative };
}
