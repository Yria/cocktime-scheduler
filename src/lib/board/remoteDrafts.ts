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

/** drafts/reservations를 멤버십만으로 정규화한 비교용 문자열(위치·순서 무시). forcedIds(그룹표시)·createdBy(멤버 추가 시 갱신)·confirmedMs(매칭확정)도 포함해 그 변경만 있어도 동기되게 한다. */
export function canonicalizeDrafts(p: BoardDraftsPayload): string {
	return JSON.stringify({
		teams: [...p.teams]
			.map((t) => ({
				id: t.id,
				memberIds: [...t.memberIds].sort(),
				createdMs: t.createdMs,
				forcedIds: [...(t.forcedIds ?? [])].sort(),
				slots: Object.entries(t.slots ?? {}).sort(([a], [b]) => a.localeCompare(b)),
				createdBy: t.createdBy ?? null,
				confirmedMs: t.confirmedMs ?? null,
			}))
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
		// forcedIds는 살아남은 멤버(anchor + 이 팀의 예약 ghost)와의 교집합만 유지(빠진 멤버 자동 제외 → ≥2 판정이 현재 멤버 기준).
		// ghost도 포함해야 "4명+예약 잠금"의 ghost 락이 동기 후에도 보존된다.
		const ghostIds = payload.reservations
			.filter((r) => r.teamId === team.id && magnets.has(r.playerId))
			.map((r) => r.playerId);
		const forcedIds = (team.forcedIds ?? []).filter((id) => memberIds.includes(id) || ghostIds.includes(id));
		// 슬롯 위치 — 자석이 살아있는 멤버 것만 유지(스테일 키는 teamMembers가 무시하므로 안전).
		const slots = team.slots
			? Object.fromEntries(Object.entries(team.slots).filter(([pid]) => magnets.has(pid)))
			: undefined;
		// 매칭확정(confirmedMs)은 유효 멤버(anchor + 이 팀 ghost, 중복 제외)가 4명일 때만 유지 —
		// I1/I2 필터로 인원이 줄었는데 확정 표시가 남는 스테일을 동기 경계에서 정제한다.
		const memberCount = memberIds.length + new Set(ghostIds.filter((id) => !memberIds.includes(id))).size;
		drafts.set(team.id, {
			id: team.id,
			anchorMemberIds: memberIds,
			anchor: clampAnchor(anchor, vw, vh),
			createdAt: team.createdMs,
			...(forcedIds.length ? { forcedIds } : {}),
			...(slots && Object.keys(slots).length ? { slots } : {}),
			...(team.createdBy ? { createdBy: team.createdBy } : {}),
			...(team.confirmedMs != null && memberCount >= 4 ? { confirmedMs: team.confirmedMs } : {}),
		});
		for (const id of memberIds) {
			const m = magnets.get(id);
			if (m) m.teamId = team.id;
		}
	}

	// 예약(ghost) 재구성 — 동기화 경계 방어:
	//  · anchor로 확정된 선수(assignedAnchor)는 ghost가 될 수 없다(anchor xor ghost) → 스킵해 stale "anchor+ghost" 모순 제거.
	//    (경기중 선수는 I2로 anchor에서 빠져 assignedAnchor에 없으므로, "경기중 + ghost" 의도된 빌려주기는 보존된다.)
	//  · 같은 (선수, 팀) 쌍 중복 예약은 가장 오래된 것 하나만(동시 생성·stale 재유입 정리). createdMs↑·id↑로 결정적.
	const reservations = new Map<string, Reservation>();
	const seenPairs = new Set<string>();
	const sortedRes = [...payload.reservations].sort(
		(a, b) => a.createdMs - b.createdMs || a.id.localeCompare(b.id),
	);
	for (const r of sortedRes) {
		if (!drafts.has(r.teamId)) continue;
		if (!magnets.has(r.playerId)) continue;
		if (assignedAnchor.has(r.playerId)) continue; // anchor 확정 선수는 ghost 불가
		const pairKey = `${r.playerId}:${r.teamId}`;
		if (seenPairs.has(pairKey)) continue; // 같은 선수·팀 중복 예약 제거
		seenPairs.add(pairKey);
		reservations.set(r.id, {
			id: r.id,
			playerId: r.playerId,
			teamId: r.teamId,
			createdAt: r.createdMs,
		});
	}

	return { drafts, reservations };
}
