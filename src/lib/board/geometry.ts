import type { StagePoint } from "../../types/board";
import {
	SLOT_SIZE,
	SLOT_GAP,
	TEAM_HIT_PADDING,
	TEAM_W,
	TEAM_BOX_ABOVE,
	TEAM_BOX_BELOW,
	REST_ZONE_H,
	REST_FIELD_H,
	MAGNET_SIZE,
	MAGNET_R,
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

/**
 * 휴식 필드(하단) 안에 점이 있는지. stageH = 보드 캔버스 높이.
 * expanded=true(펼침)면 패널 높이, false(접힘)면 푸터 위 얇은 캐치존 기준.
 */
export function isInRestField(point: StagePoint, stageH: number, expanded: boolean): boolean {
	const h = expanded ? REST_ZONE_H : REST_FIELD_H;
	return point.y >= stageH - h;
}

/** 휴식존 내부 자석 슬롯 좌표(절대, stage 기준). index 순서로 한 줄 배치(넘치면 줄바꿈). */
export function restSlotOffset(index: number, stageW: number, stageH: number): StagePoint {
	const step = MAGNET_SIZE + 10;
	const perRow = Math.max(1, Math.floor((stageW - 16) / step));
	const col = index % perRow;
	const row = Math.floor(index / perRow);
	return {
		x: MAGNET_R + 12 + col * step,
		y: stageH - REST_ZONE_H + MAGNET_R + 20 + row * (MAGNET_SIZE + 6),
	};
}
