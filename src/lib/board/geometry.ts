import type { MagnetPosition, StagePoint } from "../../types/board";
import {
	SLOT_SIZE,
	SLOT_GAP,
	TEAM_HIT_PADDING,
	TEAM_W,
	TEAM_BOX_ABOVE,
	TEAM_BOX_BELOW,
	TOOLBAR_H,
	COURT_BAR_H,
	SLOT_SNAP_R,
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

/** 슬롯 인덱스(0..3)의 anchor 기준 오프셋. 슬롯은 멤버 위치와 1:1(밀집 가정 없음). */
export function computeSlotOffset(index: number): StagePoint {
	return GRID_OFFSETS[index] ?? { x: 0, y: 0 };
}

/** 점유된 슬롯 집합을 빼고 남은 빈 슬롯 인덱스(0..3)들. */
export function emptySlotIndices(occupied: ReadonlySet<number>): number[] {
	const out: number[] = [];
	for (let i = 0; i < 4; i++) if (!occupied.has(i)) out.push(i);
	return out;
}

/**
 * 드롭 점이 어느 슬롯(0..3) 중심에 충분히 가까운지(중심거리 ≤ radius) → 그 슬롯 인덱스, 없으면 -1.
 * 빈/점유 무관한 순수 위치 판정 — 호출자가 점유 여부로 합류(빈칸)/교체(점유)를 가른다.
 */
export function slotIndexAt(
	point: StagePoint,
	anchor: StagePoint,
	radius: number = SLOT_SNAP_R,
): number {
	let best = -1;
	let bestD = radius;
	for (let i = 0; i < 4; i++) {
		const off = GRID_OFFSETS[i];
		const d = distance(point, { x: anchor.x + off.x, y: anchor.y + off.y });
		if (d <= bestD) {
			bestD = d;
			best = i;
		}
	}
	return best;
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
 * 휴식 드롭존(하단 바) 안에 점이 있는지. stageH = 보드 캔버스 높이.
 * 자석이 칠판 하단 경계를 넘어 바텀 바(RestBar) 영역으로 내려가야(논리 y ≥ stageH) 휴식/복귀 토글이 걸린다.
 * (구 펼침 패널이 칠판 안 넓은 영역을 드롭존으로 쓰던 fieldH 파라미터는 패널 폐지와 함께 제거 — 2026-07.)
 */
export function isInRestField(point: StagePoint, stageH: number): boolean {
	return point.y >= stageH;
}

/**
 * '팀에서 빼기' 드롭존 — 자석이 칠판(stage) 상단 경계를 넘어 네비(헤더) 영역으로 올라갔는지(논리 좌표).
 * 네비는 칠판 위(stage 컨테이너 top 바깥)에 있어 그 영역의 자석 중심은 논리 y가 0 이하가 된다(canvas 밖이라
 * 시각적으론 잘리지만 좌표는 음수로 잡힘). 빼기 판정·detachHot·네비 DOM 오버레이(DetachZoneOverlay)가 모두
 * 이 경계를 공유 → "칠판 상단 strip"이 아니라 "네비까지 끌어올려야" 빠진다.
 */
export function isInDetachZone(point: StagePoint): boolean {
	return point.y <= 0;
}
