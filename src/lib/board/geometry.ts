import type { StagePoint } from "../../types/board";
import {
	SLOT_SIZE,
	SLOT_GAP,
	TEAM_HIT_PADDING,
	TEAM_W,
	TEAM_BOX_ABOVE,
	TEAM_BOX_BELOW,
} from "./constants";

export function distance(a: StagePoint, b: StagePoint): number {
	const dx = a.x - b.x;
	const dy = a.y - b.y;
	return Math.sqrt(dx * dx + dy * dy);
}

const H_HALF = (SLOT_SIZE + SLOT_GAP) / 2;
const V_HALF = (SLOT_SIZE + SLOT_GAP) / 2;
const GRID_OFFSETS: readonly StagePoint[] = [
	{ x: -H_HALF, y: -V_HALF },
	{ x: +H_HALF, y: -V_HALF },
	{ x: -H_HALF, y: +V_HALF },
	{ x: +H_HALF, y: +V_HALF },
];

export function computeSlotOffset(index: number, total: number): StagePoint {
	if (index < 0 || index >= total) return { x: 0, y: 0 };
	return GRID_OFFSETS[index] ?? { x: 0, y: 0 };
}

export function computeEmptySlots(memberCount: number): StagePoint[] {
	if (memberCount === 1) return [GRID_OFFSETS[1], GRID_OFFSETS[2], GRID_OFFSETS[3]];
	if (memberCount === 2) return [GRID_OFFSETS[2], GRID_OFFSETS[3]];
	if (memberCount === 3) return [GRID_OFFSETS[3]];
	return [];
}

export function isInsideTeamBounds(
	point: StagePoint,
	anchor: StagePoint,
): boolean {
	const halfW = TEAM_W / 2 + TEAM_HIT_PADDING;
	const dx = point.x - anchor.x;
	const dy = point.y - anchor.y;
	if (Math.abs(dx) > halfW) return false;
	const above = TEAM_BOX_ABOVE + TEAM_HIT_PADDING;
	const below = TEAM_BOX_BELOW + TEAM_HIT_PADDING;
	return dy >= -above && dy <= below;
}
