import { GROUP_GRID_WIDTH } from "../../lib/board/groupGrid";

// ── 보드 줌(축소 전용) 0.4~1배 ─────────────────────────
// 수동 줌(±·핀치)과 자동 fit 스케일이 공유하는 단일 상태. 이펙트에서 React setState 없이 store로 set하기 위해
// scale을 store에 둔다(자동정렬 이펙트의 set-state-in-effect 회피). SessionBoard가 읽고/조절한다.
// 320px 화면에서도 좌우 거터를 제외한 보드에 그룹 세 개와 간격이 들어간다.
export const ZOOM_MIN = 0.4;
export const ZOOM_MAX = 1;
export const ZOOM_STEP = 0.1;
export const clampScale = (v: number) => Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Math.round(v * 100) / 100));

/** 그룹 세 개가 가로로 들어오는 기본 배율. 마지막 그룹이 잘리지 않도록 내림한다. */
export function initialBoardScale(boardWidth: number): number {
	return clampScale(Math.floor(boardWidth / GROUP_GRID_WIDTH * 100) / 100);
}
