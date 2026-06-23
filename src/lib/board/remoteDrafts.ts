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
 *
 * 멤버십 불변식을 파생 단계에서 강제한다(동시편집 레이스로 어긋난 payload·서버 데이터를 화면에서 자가 치유):
 *  · I1) 한 선수는 최대 한 팀의 anchor — 같은 선수가 두 팀 memberIds에 들어 있으면 한 팀만 유지.
 *        모든 클라가 같은 팀을 보유자로 뽑도록 (createdMs↑, id↑) 결정적 순서로 처리(먼저 만들어진 팀이 유지).
 *  · I2) 경기중(코트 배치) 선수는 어느 팀의 anchor도 아님 — 경기 시작/로스터 편입으로 코트에 올라간 뒤
 *        draft 해체(dissolve) 저장이 레이스로 유실돼도, 여기서 항상 제거해 "팀에 있는데 게임중" 중복 표시를 막는다.
 *  ghost(Reservation)는 의도된 빌려주기(경기중 선수 예약 포함)이므로 건드리지 않는다(아래 reservations 루프).
 */
export function reconcileMembership(
	payload: BoardDraftsPayload,
	magnets: Map<string, MagnetPosition>,
	oldAnchors: Map<string, StagePoint>,
	vw: number,
	vh: number,
	playingIds: ReadonlySet<string>,
): { drafts: Map<string, DraftTeam>; reservations: Map<string, Reservation> } {
	// 멤버십 초기화 후 payload로 재구성
	for (const m of magnets.values()) m.teamId = null;

	// I1 결정적 순서 — 중복 선수는 먼저 만들어진(같으면 id가 앞선) 팀이 유지한다.
	const teams = [...payload.teams].sort(
		(a, b) => a.createdMs - b.createdMs || a.id.localeCompare(b.id),
	);
	const assignedAnchor = new Set<string>(); // I1: 이미 다른 팀 anchor로 확정된 선수

	const drafts = new Map<string, DraftTeam>();
	for (const team of teams) {
		const memberIds = team.memberIds.filter(
			(id) => magnets.has(id) && !assignedAnchor.has(id) && !playingIds.has(id), // I1 + I2
		);
		if (memberIds.length === 0) continue;
		for (const id of memberIds) assignedAnchor.add(id);
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
