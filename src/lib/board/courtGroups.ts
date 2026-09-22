import type { Court } from "../../types";
import type { StagePoint } from "../../types/board";
import { dissolveDraft, type Draft } from "./draftMutations";
import { groupGridAnchor, nextGroupAnchor } from "./groupGrid";

export function initialCourtAnchor(index: number): StagePoint {
	return groupGridAnchor(index);
}

/** 코트별 고정 그룹을 복원하며, 별도로 만든 예비 그룹의 명단과 위치는 보존한다. */
export function reconcileCourtGroups(state: Draft & { courtAnchors: Map<number, StagePoint> }, courts: Court[]) {
	const retained = new Set<string>();
	for (const court of courts) {
		let team = [...state.drafts.values()].find(item => item.courtId === court.id && !retained.has(item.id));
		if (!team) {
			// 번호를 당긴 기존 그룹은 ID를 유지한다. 재증설 시 그 그룹을 덮어쓰지 않는다.
			const baseId = `court-${court.id}`;
			let id = baseId;
			for (let suffix = 1; state.drafts.has(id); suffix++) id = `${baseId}-${suffix}`;
			let anchor = state.courtAnchors.get(court.id);
			if (!anchor) {
				anchor = nextGroupAnchor([...state.drafts.values()].map(other => other.anchor));
			}
			team = { id, courtId: court.id, anchorMemberIds: [], createdAt: court.id, anchor };
			state.drafts.set(id, team);
		}
		retained.add(team.id);
		if (court.match && state.courtAnchors.has(court.id)) team.anchor = state.courtAnchors.get(court.id)!;
		state.courtAnchors.set(court.id, { ...team.anchor });
	}
	for (const [id, team] of [...state.drafts]) {
		if (retained.has(id) || team.courtId == null) continue;
		delete team.courtId;
		dissolveDraft(state, id);
	}
	for (const id of state.courtAnchors.keys()) if (!courts.some(court => court.id === id)) state.courtAnchors.delete(id);
}
