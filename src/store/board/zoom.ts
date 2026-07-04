// ── 보드 줌(축소 전용) 0.5~1배 ─────────────────────────
// 수동 줌(±·핀치)과 자동 fit 스케일이 공유하는 단일 상태. 이펙트에서 React setState 없이 store로 set하기 위해
// scale을 store에 둔다(자동정렬 이펙트의 set-state-in-effect 회피). SessionBoard가 읽고/조절한다.
export const ZOOM_MIN = 0.5;
export const ZOOM_MAX = 1;
export const ZOOM_STEP = 0.1;
export const SCALE_KEY = "cocktime-board-scale";
export const clampScale = (v: number) => Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Math.round(v * 100) / 100));
export function loadScale(): number {
	try {
		const v = parseFloat(localStorage.getItem(SCALE_KEY) ?? "");
		return Number.isFinite(v) ? clampScale(v) : 1;
	} catch {
		return 1;
	}
}
