import type { BoardLayoutPayload, DraftTeam, MagnetPosition, StagePoint } from "../../types/board";

type LayoutState = {
	drafts: Map<string, DraftTeam>;
	courtAnchors: Map<number, StagePoint>;
	magnets: Map<string, MagnetPosition>;
	manualLayout: boolean;
};

function validPoint(point: unknown): point is StagePoint {
	if (!point || typeof point !== "object") return false;
	const { x, y } = point as StagePoint;
	return Number.isFinite(x) && Number.isFinite(y) && x >= 0 && y >= 0;
}

/** JSON 경계에서 잘못된 좌표를 제외하고 키 순서를 고정해 같은 배치의 재저장을 피한다. */
function points(value: unknown): Record<string, StagePoint> {
	if (!value || typeof value !== "object" || Array.isArray(value)) return {};
	return Object.fromEntries(Object.entries(value).filter(([, point]) => validPoint(point))
		.sort(([a], [b]) => a.localeCompare(b)).map(([id, point]) => [id, { x: point.x, y: point.y }]));
}

export function readBoardLayout(layout: unknown): BoardLayoutPayload | undefined {
	if (!layout || typeof layout !== "object" || !("version" in layout) || layout.version !== 1) return;
	const data = layout as BoardLayoutPayload;
	return { version: 1, teams: points(data.teams), courts: points(data.courts), magnets: points(data.magnets) };
}

export function serializeBoardLayout(state: LayoutState): BoardLayoutPayload | undefined {
	if (!state.manualLayout) return;
	return {
		version: 1,
		teams: points(Object.fromEntries([...state.drafts].map(([id, team]) => [id, team.anchor]))),
		courts: points(Object.fromEntries(state.courtAnchors)),
		magnets: points(Object.fromEntries(state.magnets)),
	};
}

/** 서버 좌표를 그대로 복원한다. 현재 화면 크기로 클램프/정렬하면 재진입마다 배치가 변한다. */
export function applyBoardLayout(state: LayoutState, layout: BoardLayoutPayload) {
	for (const [id, team] of state.drafts) {
		const point = layout.teams[id] ?? (team.courtId != null ? layout.courts[team.courtId] : undefined);
		if (point) team.anchor = { ...point };
	}
	for (const [id, point] of Object.entries(layout.courts)) {
		const courtId = Number(id);
		if (Number.isInteger(courtId) && courtId > 0) state.courtAnchors.set(courtId, { ...point });
	}
	for (const team of state.drafts.values()) if (team.courtId != null) state.courtAnchors.set(team.courtId, { ...team.anchor });
	for (const [id, magnet] of state.magnets) {
		const point = layout.magnets[id];
		if (point) { magnet.x = point.x; magnet.y = point.y; }
	}
	state.manualLayout = true;
}
