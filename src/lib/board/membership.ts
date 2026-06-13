/**
 * membership.ts
 *
 * 보드 멤버십/상태 파생 순수 함수.
 * - 예비팀의 유효 멤버는 anchor(원본) + 그 팀 향한 ghost(예약)를 합쳐 derive한다.
 * - "경기중" 여부는 보드 로컬이 아니라 sessionStore.courts(playingIds)에서 derive한다.
 */
import type { Court } from "../../types";
import type {
	DraftTeam,
	MagnetPosition,
	PlayerLifecycle,
	Reservation,
	TeamMember,
} from "../../types/board";

type DraftMap = ReadonlyMap<string, DraftTeam>;
type ResMap = ReadonlyMap<string, Reservation>;
type MagMap = ReadonlyMap<string, MagnetPosition>;

/** 코트에 배치되어 경기중인 session_player.id 집합. */
export function playingIdsFromCourts(courts: Court[]): Set<string> {
	const out = new Set<string>();
	for (const c of courts) {
		if (!c.match) continue;
		for (const id of c.match.teamA) out.add(id);
		for (const id of c.match.teamB) out.add(id);
	}
	return out;
}

/**
 * 예비팀의 유효 멤버 목록(슬롯 0..3). anchor가 먼저, ghost는 createdAt 순으로 뒤에 붙는다.
 * 같은 playerId 중복은 제거한다(불변식: 한 팀에 같은 선수 1명).
 */
export function teamMembers(
	teamId: string,
	drafts: DraftMap,
	reservations: ResMap,
): TeamMember[] {
	const team = drafts.get(teamId);
	if (!team) return [];

	const seen = new Set<string>();
	const out: TeamMember[] = [];

	for (const pid of team.anchorMemberIds) {
		if (seen.has(pid)) continue;
		seen.add(pid);
		out.push({ playerId: pid, kind: "anchor", slot: out.length });
	}

	const ghosts = [...reservations.values()]
		.filter((r) => r.teamId === teamId && !seen.has(r.playerId))
		.sort((a, b) => a.createdAt - b.createdAt);
	for (const r of ghosts) {
		if (seen.has(r.playerId)) continue;
		seen.add(r.playerId);
		out.push({ playerId: r.playerId, kind: "ghost", slot: out.length });
	}

	return out;
}

export function teamMemberCount(
	teamId: string,
	drafts: DraftMap,
	reservations: ResMap,
): number {
	return teamMembers(teamId, drafts, reservations).length;
}

export function isMemberOf(
	playerId: string,
	teamId: string,
	drafts: DraftMap,
	reservations: ResMap,
): boolean {
	const team = drafts.get(teamId);
	if (team && team.anchorMemberIds.includes(playerId)) return true;
	for (const r of reservations.values()) {
		if (r.teamId === teamId && r.playerId === playerId) return true;
	}
	return false;
}

/** 이 선수를 ghost로 가진 예비팀에서 해당 reservation을 찾는다. */
export function findReservation(
	playerId: string,
	teamId: string,
	reservations: ResMap,
): Reservation | null {
	for (const r of reservations.values()) {
		if (r.playerId === playerId && r.teamId === teamId) return r;
	}
	return null;
}

export function deriveLifecycle(
	playerId: string,
	magnets: MagMap,
	playingIds: Set<string>,
): PlayerLifecycle {
	if (playingIds.has(playerId)) return "playing";
	const m = magnets.get(playerId);
	if (m && m.teamId !== null) return "anchored";
	return "free";
}

/**
 * 예비팀이 경기시작 가능한가.
 * 조건: 멤버 정확히 4명 && 전원이 (코트에서 경기중 아님) && ghost 멤버는 다른 팀에 묶이지 않은 free 상태.
 * (anchor 멤버는 이 팀에 묶인 것이므로 OK.)
 */
export function isTeamStartable(
	teamId: string,
	drafts: DraftMap,
	reservations: ResMap,
	magnets: MagMap,
	playingIds: Set<string>,
): boolean {
	const members = teamMembers(teamId, drafts, reservations);
	if (members.length !== 4) return false;
	return members.every((m) => {
		if (playingIds.has(m.playerId)) return false;
		if (m.kind === "ghost") {
			const mag = magnets.get(m.playerId);
			if (mag && mag.teamId !== null) return false; // 다른 팀에 anchor로 묶임
		}
		return true;
	});
}
