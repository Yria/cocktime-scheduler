import type { MagnetPosition, StagePoint } from "../../types/board";
import {
	SLOT_SIZE,
	SLOT_GAP,
	TEAM_HIT_PADDING,
	TEAM_W,
	TEAM_BOX_ABOVE,
	TEAM_BOX_BELOW,
	MAGNET_SIZE,
	MAGNET_R,
	TOOLBAR_H,
	COURT_BAR_H,
	SLOT_SNAP_R,
	DETACH_ZONE_H,
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

/**
 * 드롭 점이 팀의 빈 슬롯(구멍) 중 하나에 충분히 가까운지(중심거리 ≤ radius).
 * 그룹 합류/예약은 이때만 허용 — 박스 안 아무 곳이 아니라 "구멍에 정확히 놓을 때만" 반응.
 */
export function isOnEmptySlot(
	point: StagePoint,
	anchor: StagePoint,
	memberCount: number,
	radius: number = SLOT_SNAP_R,
): boolean {
	for (const off of computeEmptySlots(memberCount)) {
		if (distance(point, { x: anchor.x + off.x, y: anchor.y + off.y }) <= radius) return true;
	}
	return false;
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
 * 휴식 필드(하단) 안에 점이 있는지. stageH = 보드 캔버스 높이, fieldH = 필드(드롭/패널) 높이.
 * 접힘이면 REST_FIELD_H, 펼침이면 restZoneHeight(휴식 인원수에 따라 여러 줄로 확장)를 호출자가 넘긴다.
 */
export function isInRestField(point: StagePoint, stageH: number, fieldH: number): boolean {
	return point.y >= stageH - fieldH;
}

/** '팀에서 빼기' 드롭존(상단 밴드) 안에 점이 있는지 — 논리 좌표 기준. */
export function isInDetachZone(point: StagePoint): boolean {
	return point.y <= DETACH_ZONE_H;
}

// 휴식존 펼침 패널 레이아웃 — 인원수에 따라 여러 줄로 확장(최소 1줄=기존 높이 108과 동일).
const REST_STEP_X = MAGNET_SIZE + 10; // 자석 가로 간격(=74)
const REST_ROW_H = MAGNET_SIZE + 6; // 줄 높이(=70)
const REST_HEAD_H = 24; // 상단 라벨 영역
const REST_PANEL_PAD = 14; // 하단 여백

/** 한 줄에 들어가는 휴식 자석 수(stageW 기준). */
export function restPerRow(stageW: number): number {
	return Math.max(1, Math.floor((stageW - 16) / REST_STEP_X));
}

/**
 * 휴식 펼침 패널 높이 — 인원수에 따라 줄 수만큼 확장. 0~1줄이면 기존 높이(108)와 동일.
 * stageH - DETACH_ZONE_H 로 상한 클램프 — 극단 인원에서도 isInRestField 임계값(stageH - h)이 음수가 되어
 * '보드 전체가 휴식 드롭존'이 되는 것을 막는다(상단 detach strip은 항상 비-휴식으로 보존).
 * 감지(isInRestField)와 렌더(RestZonePanel)가 같은 값을 써야 영역이 일치하므로 양쪽 모두 이 함수를 호출한다.
 */
export function restZoneHeight(count: number, stageW: number, stageH: number): number {
	const rows = Math.max(1, Math.ceil(count / restPerRow(stageW)));
	const h = REST_HEAD_H + rows * REST_ROW_H + REST_PANEL_PAD;
	return Math.min(h, Math.max(REST_HEAD_H + REST_ROW_H, stageH - DETACH_ZONE_H));
}

/**
 * 휴식존 내부 자석 슬롯 좌표(절대, stage 기준). index 순서로 앞에서부터 빈칸 없이 채우고(자동 재패킹),
 * 한 줄을 넘치면 다음 줄로. 패널은 인원수(count)에 따라 위로 확장되므로 panelTop을 count로 산정한다.
 */
export function restSlotOffset(index: number, count: number, stageW: number, stageH: number): StagePoint {
	const perRow = restPerRow(stageW);
	const col = index % perRow;
	const row = Math.floor(index / perRow);
	const panelTop = stageH - restZoneHeight(count, stageW, stageH);
	return {
		x: MAGNET_R + 12 + col * REST_STEP_X,
		y: panelTop + REST_HEAD_H + MAGNET_R + row * REST_ROW_H,
	};
}
