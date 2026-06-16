/**
 * remoteDrafts.ts
 *
 * 원격 보드 멤버십(drafts/reservations) 동기화 순수 로직.
 * 위치(흩어짐/settle)는 호출자(boardStore)가 별도 처리한다.
 */
import type {
	BoardDraftsPayload,
	DraftTeam,
	MagnetPosition,
	Reservation,
	StagePoint,
} from "../../types/board";
import { centroidAnchor, clampAnchor } from "./geometry";

/** drafts/reservations를 멤버십만으로 정규화한 비교용 문자열(위치·순서 무시). */
export function canonicalizeDrafts(p: BoardDraftsPayload): string {
	return JSON.stringify({
		teams: [...p.teams]
			.map((t) => ({ id: t.id, memberIds: [...t.memberIds].sort(), createdMs: t.createdMs }))
			.sort((a, b) => a.id.localeCompare(b.id)),
		reservations: [...p.reservations]
			.map((r) => ({ id: r.id, playerId: r.playerId, teamId: r.teamId, createdMs: r.createdMs }))
			.sort((a, b) => a.id.localeCompare(b.id)),
	});
}

/**
 * 원격 payload로 멤버십(drafts/reservations)을 재구성한다.
 * - magnets의 teamId를 payload 기준으로 재설정(in-place mutate).
 * - 같은 id 팀은 oldAnchors 위치 유지, 새 팀은 멤버 중심(centroid)으로 배치 후 화면 클램프.
 * - payload에 있어도 로컬에 자석이 없는 멤버/예약은 무시.
 */
export function reconcileMembership(
	payload: BoardDraftsPayload,
	magnets: Map<string, MagnetPosition>,
	oldAnchors: Map<string, StagePoint>,
	vw: number,
	vh: number,
): { drafts: Map<string, DraftTeam>; reservations: Map<string, Reservation> } {
	// 멤버십 초기화 후 payload로 재구성
	for (const m of magnets.values()) m.teamId = null;

	const drafts = new Map<string, DraftTeam>();
	for (const team of payload.teams) {
		const memberIds = team.memberIds.filter((id) => magnets.has(id));
		if (memberIds.length === 0) continue;
		const anchor = oldAnchors.get(team.id) ?? centroidAnchor(memberIds, magnets);
		drafts.set(team.id, {
			id: team.id,
			anchorMemberIds: memberIds,
			anchor: clampAnchor(anchor, vw, vh),
			createdAt: team.createdMs,
		});
		for (const id of memberIds) {
			const m = magnets.get(id);
			if (m) m.teamId = team.id;
		}
	}

	const reservations = new Map<string, Reservation>();
	for (const r of payload.reservations) {
		if (!drafts.has(r.teamId)) continue;
		if (!magnets.has(r.playerId)) continue;
		reservations.set(r.id, {
			id: r.id,
			playerId: r.playerId,
			teamId: r.teamId,
			createdAt: r.createdMs,
		});
	}

	return { drafts, reservations };
}
