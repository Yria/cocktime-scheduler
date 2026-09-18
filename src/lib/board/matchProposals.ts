import type { MagnetPosition, StagePoint } from "../../types/board";
import type { MatchProposal } from "../supabase/matchProposals";
import { PAIR_RADIUS, TEAM_BOX_ABOVE, TEAM_BOX_BELOW, TEAM_W } from "./constants";
import { clampAnchor, distance, isInsideTeamBounds, teamRect } from "./geometry";

export interface ProposalGroup {
	id: string;
	playerIds: string[];
	anchor: StagePoint;
}

export function isActiveMatchProposal(proposal: MatchProposal): boolean {
	return proposal.status === "pending" || proposal.status === "reviewed";
}

export interface ProposalComposerSnapshot {
	enabled: boolean;
	groups: readonly ProposalGroup[];
	sendingIds: ReadonlySet<string>;
	proposals: readonly MatchProposal[];
	anchors: ReadonlyMap<string, StagePoint>;
	resolvingIds: ReadonlySet<string>;
	viewerId: string | null;
	isAdmin: boolean;
}

/** Use the same privacy boundary for cards, floor magnets and local layout. */
export function visibleMatchProposals(snapshot?: ProposalComposerSnapshot): MatchProposal[] {
	return snapshot?.proposals.filter((proposal) => isActiveMatchProposal(proposal)
		&& (snapshot.isAdmin || proposal.created_by === snapshot.viewerId)) ?? [];
}

/** Private positions stay on this device; new cards avoid actual teams and other proposals. */
export function placeProposalAnchors(ids: readonly string[], current: ReadonlyMap<string, StagePoint>,
	obstacles: readonly StagePoint[], bounds: { width: number; height: number }): Map<string, StagePoint> {
	const anchors = new Map<string, StagePoint>();
	const occupied = [...obstacles];
	for (const id of ids) {
		const existing = current.get(id);
		if (existing) {
			const point = clampAnchor(existing, bounds.width, bounds.height);
			anchors.set(id, point); occupied.push(point);
		}
	}
	for (const id of ids) {
		if (anchors.has(id)) continue;
		let best = clampAnchor({ x: TEAM_W / 2, y: TEAM_BOX_ABOVE }, bounds.width, bounds.height);
		let bestScore = Infinity;
		const cols = Math.max(1, Math.floor((bounds.width - 24 + 16) / (TEAM_W + 16)));
		const rowHeight = TEAM_BOX_ABOVE + TEAM_BOX_BELOW + 16;
		const rows = Math.max(1, Math.ceil(bounds.height / rowHeight));
		for (let row = 0; row < rows; row++) {
			for (let col = 0; col < cols; col++) {
				const { x, y } = clampAnchor({ x: 12 + TEAM_W / 2 + col * (TEAM_W + 16),
					y: 10 + TEAM_BOX_ABOVE + row * rowHeight }, bounds.width, bounds.height);
				const rect = teamRect({ x, y }, 8);
				const score = occupied.reduce((sum, point) => {
					const other = teamRect(point, 0);
					return sum + Math.max(0, Math.min(rect.maxX, other.maxX) - Math.max(rect.minX, other.minX))
						* Math.max(0, Math.min(rect.maxY, other.maxY) - Math.max(rect.minY, other.minY));
				}, 0);
				if (score < bestScore) { best = { x, y }; bestScore = score; }
				if (score === 0) break;
			}
			if (bestScore === 0) break;
		}
		anchors.set(id, best); occupied.push(best);
	}
	return anchors;
}

/** A separate local model: none of these commands modify shared board membership. */
export interface ProposalComposer {
	getSnapshot: () => ProposalComposerSnapshot;
	subscribe: (listener: () => void) => () => void;
	drop: (playerId: string, point: StagePoint) => void;
	dropSubmitted: (playerId: string, point: StagePoint, sourceGroupId?: string) => boolean;
	removeSubmittedMember: (groupId: string, playerId: string) => void;
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
