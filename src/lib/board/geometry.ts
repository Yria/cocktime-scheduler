import type { MagnetPosition, StagePoint } from "../../types/board";
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
	TOOLBAR_H,
	COURT_BAR_H,
} from "./constants";

/** stage 크기 미상(마운트 직전)일 때의 기본 뷰포트. stage 영역 = 화면 − 툴바 − 코트바. */
export const DEFAULT_VIEWPORT = { vw: 400, vh: 800 - TOOLBAR_H - COURT_BAR_H };

/**
 * 그룹(팀/코트) anchor를 화면 경계 안으로만 클램프(코트 레인 제한 없음).
 * 팀 박스 상/하단(TEAM_BOX_ABOVE/BELOW)이 화면 안에 있도록만 보정.
 */
export function clampAnchor(p: StagePoint, vw: number, vh: number): StagePoint {
	const halfW = TEAM_W / 2;
	const minY = TEAM_BOX_ABOVE;
	const maxY = Math.max(minY, vh - TEAM_BOX_BELOW);
	return {
		x: Math.max(halfW, Math.min(vw - halfW, p.x)),
		y: Math.max(minY, Math.min(maxY, p.y)),
	};
}

/** 멤버 자석들의 중심(새 팀의 로컬 위치 추정). 멤버가 없으면 기본 좌표. */
export function centroidAnchor(
	memberIds: string[],
	magnets: Map<string, MagnetPosition>,
): StagePoint {
	let sx = 0;
	let sy = 0;
	let n = 0;
	for (const id of memberIds) {
		const m = magnets.get(id);
		if (m) {
			sx += m.x;
			sy += m.y;
			n++;
		}
	}
	return n > 0 ? { x: sx / n, y: sy / n } : { x: 200, y: 200 };
}

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

export interface TeamRect {
	minX: number;
	maxX: number;
	minY: number;
	maxY: number;
}

/**
 * 팀(anchor) 경계 박스 — pad만큼 확장. 위/아래 범위가 비대칭(라벨·CTA 때문).
 * 히트 판정(TEAM_HIT_PADDING)과 충돌 keep-out(MAG_R)이 pad만 달리해 공유한다.
 */
export function teamRect(anchor: StagePoint, pad: number): TeamRect {
	return {
		minX: anchor.x - (TEAM_W / 2 + pad),
		maxX: anchor.x + (TEAM_W / 2 + pad),
		minY: anchor.y - (TEAM_BOX_ABOVE + pad),
		maxY: anchor.y + (TEAM_BOX_BELOW + pad),
	};
}

export function isInsideTeamBounds(
	point: StagePoint,
	anchor: StagePoint,
): boolean {
	const r = teamRect(anchor, TEAM_HIT_PADDING);
	return (
		point.x >= r.minX &&
		point.x <= r.maxX &&
		point.y >= r.minY &&
		point.y <= r.maxY
	);
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
