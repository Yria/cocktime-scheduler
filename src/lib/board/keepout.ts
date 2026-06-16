/**
 * keepout.ts
 *
 * 자유 자석 흩어짐/정리(settle·scatter) 공용 기하 — 팀 keep-out 박스, 화면 경계, 자유 자석 추출.
 * settle.ts와 scatter.ts가 공유한다.
 */
import type { MagnetPosition, StagePoint } from "../../types/board";
import { MAGNET_SIZE, TEAM_BOX_ABOVE, TEAM_BOX_BELOW, TEAM_W } from "./constants";

export const MAG_R = MAGNET_SIZE / 2;
/** 흩어짐: 보이는 원이 "딱 맞닿을 때까지"만 밀어냄(여유 간격 0 = 지름). */
export const MIN_MAG_DIST = MAGNET_SIZE;

// 팀 keep-out 박스 반(half) 범위 = 팀 박스 + 자석 반지름(자석 중심 기준 경계).
// 여유(PAD)는 0이므로 박스+MAG_R로 충분하다.
export const KEEPOUT_X = TEAM_W / 2 + MAG_R;
export const KEEPOUT_UP = TEAM_BOX_ABOVE + MAG_R;
export const KEEPOUT_DOWN = TEAM_BOX_BELOW + MAG_R;

export interface Bounds {
	minX: number;
	minY: number;
	maxX: number;
	maxY: number;
}

/** 자유 자석이 머무를 수 있는 영역(화면 안, 상단 마진 고려). */
export function computeBounds(
	viewportW: number,
	viewportH: number,
	topMargin = 0,
): Bounds {
	return {
		minX: MAG_R + 4,
		minY: Math.max(MAG_R + 4, topMargin + MAG_R),
		maxX: viewportW - MAG_R - 4,
		maxY: viewportH - MAG_R - 4,
	};
}

/** 팀에 묶이지 않고 제외 대상도 아닌 자유 자석 목록. */
export function freeMagnets(
	magnets: Map<string, MagnetPosition>,
	excludeIds?: ReadonlySet<string>,
): MagnetPosition[] {
	return [...magnets.values()].filter(
		(m) => m.teamId === null && !excludeIds?.has(m.playerId),
	);
}

/** 자석 중심(px,py)이 팀(anchor) keep-out 박스 안에 있는가(배타적 경계). */
export function inTeamKeepOut(px: number, py: number, anchor: StagePoint): boolean {
	const dx = px - anchor.x;
	const dy = py - anchor.y;
	return Math.abs(dx) < KEEPOUT_X && dy > -KEEPOUT_UP && dy < KEEPOUT_DOWN;
}

/** 두 자석 좌표가 거의 일치할 때 결정적 분리 각도(라디안). charCode 0 방지로 ||1. */
export function tieAngle(a: string, b: string): number {
	return (
		(((a.charCodeAt(0) || 1) * 7 + (b.charCodeAt(0) || 1) * 13) % 360) *
		(Math.PI / 180)
	);
}
