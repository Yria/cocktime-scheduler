import type { StagePoint } from "../../types/board";
import { TEAM_W, TEAM_BOX_ABOVE, TEAM_BOX_BELOW } from "./constants";

export const GROUP_COLUMNS = 3;
export const GROUP_GRID_WIDTH = 24 + TEAM_W * GROUP_COLUMNS + 16 * (GROUP_COLUMNS - 1);
export const GROUP_ROW_HEIGHT = TEAM_BOX_ABOVE + TEAM_BOX_BELOW + 16;

/** 좌상단부터 세 칸씩 채운다. 아홉 칸을 넘으면 같은 규칙으로 다음 행을 쓴다. */
export function groupGridAnchor(index: number): StagePoint {
	return { x: 12 + TEAM_W / 2 + index % GROUP_COLUMNS * (TEAM_W + 16),
		y: 10 + TEAM_BOX_ABOVE + Math.floor(index / GROUP_COLUMNS) * GROUP_ROW_HEIGHT };
}

/** 코트 1~4개는 왼쪽 두 열, 5개부터는 세 열을 사용한다. 칸 번호는 항상 3열 기준. */
export function courtGridIndex(index: number, courtCount: number): number {
	const columns = courtCount <= 4 ? 2 : GROUP_COLUMNS;
	return Math.floor(index / columns) * GROUP_COLUMNS + index % columns;
}

/** 다음 팀은 코트 사이 빈칸부터 채우므로 마지막 코트와 전체 그룹 수 중 더 긴 쪽을 쓴다. */
export function groupGridRows(groupCount: number, courtCount = 0): number {
	const courtExtent = courtCount > 0 ? courtGridIndex(courtCount - 1, courtCount) + 1 : 0;
	return Math.ceil(Math.max(groupCount, courtExtent) / GROUP_COLUMNS);
}

export function nextGroupAnchor(occupied: Iterable<StagePoint>): StagePoint {
	const points = [...occupied];
	for (let index = 0; ; index++) {
		const point = groupGridAnchor(index);
		if (!points.some(other => Math.abs(other.x - point.x) < TEAM_W + 8
			&& Math.abs(other.y - point.y) < GROUP_ROW_HEIGHT - 8)) return point;
	}
}
