import type { Court } from "../../types";
import type { DraftTeam, StagePoint } from "../../types/board";
import { TEAM_W, TEAM_BOX_ABOVE, TEAM_BOX_BELOW } from "./constants";
import { dissolveDraft, type Draft } from "./draftMutations";

export function initialCourtAnchor(index: number, width: number): StagePoint {
	const cols = Math.max(1, Math.floor((width - 8) / (TEAM_W + 16)));
	return { x: 12 + TEAM_W / 2 + (index % cols) * (TEAM_W + 16),
		y: 10 + TEAM_BOX_ABOVE + Math.floor(index / cols) * (TEAM_BOX_ABOVE + TEAM_BOX_BELOW + 16) };
}

/** 기존 그룹의 명단과 위치를 우선 승계한다. 코트마다 정확히 하나의 그룹만 남는다. */
export function reconcileCourtGroups(state: Draft & { courtAnchors: Map<number, StagePoint> }, courts: Court[], width: number) {
	const available = [...state.drafts.values()].filter(team => team.courtId == null);
	const retained = new Set<string>();
	for (const [index, court] of courts.entries()) {
		let team = [...state.drafts.values()].find(item => item.courtId === court.id && !retained.has(item.id));
		if (!team) {
			team = court.match ? undefined : available.shift();
			if (team) team.courtId = court.id;
			else {
				const id = `court-${court.id}`;
				let anchor = state.courtAnchors.get(court.id);
				if (!anchor) {
					let cell = index;
					do { anchor = initialCourtAnchor(cell++, width); }
					while ([...state.drafts.values()].some(other => Math.abs(other.anchor.x - anchor!.x) < TEAM_W + 8
						&& Math.abs(other.anchor.y - anchor!.y) < TEAM_BOX_ABOVE + TEAM_BOX_BELOW + 8));
				}
				team = { id, courtId: court.id, anchorMemberIds: [], createdAt: court.id, anchor };
				state.drafts.set(id, team);
			}
		}
		retained.add(team.id);
		if (court.match && state.courtAnchors.has(court.id)) team.anchor = state.courtAnchors.get(court.id)!;
		state.courtAnchors.set(court.id, { ...team.anchor });
	}
	for (const [id, team] of [...state.drafts]) {
		if (retained.has(id)) continue;
		delete team.courtId;
		dissolveDraft(state, id);
	}
	for (const id of state.courtAnchors.keys()) if (!courts.some(court => court.id === id)) state.courtAnchors.delete(id);
}

/** 가까운 행/열만 맞춘다. 원래의 순서와 간격을 보존하고 한 축당 최대 24px만 이동한다. */
export function alignCourtGroups(teams: DraftTeam[]) {
	const originals = new Map(teams.map(team => [team.id, { ...team.anchor }]));
	for (const axis of ["x", "y"] as const) {
		const sorted = [...teams].sort((a, b) => originals.get(a.id)![axis] - originals.get(b.id)![axis]);
		for (let i = 0; i < sorted.length;) {
			const first = originals.get(sorted[i].id)![axis];
			let end = i + 1;
			while (end < sorted.length && originals.get(sorted[end].id)![axis] - originals.get(sorted[end - 1].id)![axis] <= 24) end++;
			const last = originals.get(sorted[end - 1].id)![axis];
			// 연쇄적으로 가까운 넓은 묶음은 그대로 둔다. 잘라서 맞추면 다음 클릭에 또 합쳐져 이동한다.
			if (last - first <= 24) for (const team of sorted.slice(i, end)) team.anchor = { ...team.anchor, [axis]: (first + last) / 2 };
			i = end;
		}
	}
	// 정렬 때문에 새로 겹치게 되는 경우는 원래 위치를 유지한다.
	for (const team of teams) for (const other of teams) {
		if (team === other) continue;
		const a = originals.get(team.id)!, b = originals.get(other.id)!;
		const overlaps = (p: StagePoint, q: StagePoint) => Math.abs(p.x - q.x) < TEAM_W + 8 && Math.abs(p.y - q.y) < TEAM_BOX_ABOVE + TEAM_BOX_BELOW + 8;
		if (!overlaps(a, b) && overlaps(team.anchor, other.anchor)) {
			team.anchor = a; other.anchor = b;
		}
	}
}
