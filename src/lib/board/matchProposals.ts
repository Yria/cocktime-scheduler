import type { MagnetPosition, StagePoint } from "../../types/board";
import { PAIR_RADIUS } from "./constants";
import { clampAnchor, distance, isInsideTeamBounds } from "./geometry";

export interface ProposalGroup {
	id: string;
	playerIds: string[];
	anchor: StagePoint;
}

export interface ProposalComposerSnapshot {
	enabled: boolean;
	groups: readonly ProposalGroup[];
	sendingIds: ReadonlySet<string>;
}

/** A separate local model: none of these commands modify shared board membership. */
export interface ProposalComposer {
	getSnapshot: () => ProposalComposerSnapshot;
	subscribe: (listener: () => void) => () => void;
	drop: (playerId: string, point: StagePoint) => void;
	move: (groupId: string, point: StagePoint) => void;
	removeMember: (playerId: string) => void;
	removeGroup: (groupId: string) => void;
	submit: (groupId: string) => void;
}

export function removeProposalMember(groups: readonly ProposalGroup[], playerId: string): ProposalGroup[] {
	return groups.map((group) => group.playerIds.includes(playerId)
		? { ...group, playerIds: group.playerIds.filter((id) => id !== playerId) } : group)
		.filter((group) => group.playerIds.length > 0);
}

/** Drop onto a local group, another free magnet, or open space (a one-person proposal). */
export function dropProposalMember(
	groups: readonly ProposalGroup[], playerId: string, point: StagePoint,
	freeMagnets: readonly MagnetPosition[], bounds: { width: number; height: number }, newId: string,
): ProposalGroup[] {
	const target = [...groups].reverse().find((group) => isInsideTeamBounds(point, group.anchor));
	if (target) {
		if (target.playerIds.includes(playerId) || target.playerIds.length >= 4) return [...groups];
		return removeProposalMember(groups, playerId).map((group) => group.id === target.id
			? { ...group, playerIds: [...group.playerIds, playerId] } : group);
	}
	const selected = new Set(groups.flatMap((group) => group.playerIds));
	const partner = freeMagnets.filter((magnet) => magnet.playerId !== playerId && !selected.has(magnet.playerId))
		.map((magnet) => ({ magnet, distance: distance(point, magnet) }))
		.filter((candidate) => candidate.distance <= PAIR_RADIUS)
		.sort((a, b) => a.distance - b.distance)[0]?.magnet;
	const next = removeProposalMember(groups, playerId);
	// Pulling a member into open space removes it from the local group.
	if (selected.has(playerId) && !partner) return next;
	return [...next, {
		id: newId, playerIds: partner ? [partner.playerId, playerId] : [playerId],
		anchor: clampAnchor(point, bounds.width, bounds.height),
	}];
}
