// ── 보드 줌(축소 전용) 0.5~1배 ─────────────────────────
// 수동 줌(±·핀치)과 자동 fit 스케일이 공유하는 단일 상태. 이펙트에서 React setState 없이 store로 set하기 위해
// scale을 store에 둔다(자동정렬 이펙트의 set-state-in-effect 회피). SessionBoard가 읽고/조절한다.
export const ZOOM_MIN = 0.5;
export const ZOOM_MAX = 1;
export const ZOOM_STEP = 0.1;
export const SCALE_KEY = "cocktime-board-scale";
/**
 * 사용자가 **직접** 배율을 조정했다는 표식. SCALE_KEY 와 분리한 이유: 이전 버전의 자동 fit 이
 * setScale 을 통해 SCALE_KEY 에 값을 써 왔으므로(구 fitAndArrange 의 `setScale(fit)`), 저장값 존재만으로
 * 잠금을 판정하면 **수동 조정을 한 번도 안 한 기존 기기가 전부 잠겨** 자동 fit 이 영구 정지한다.
 * 이 키는 수동 경로(setScale)에서만 기록되므로 구 기기는 자연히 미잠금으로 시작한다.
 */
export const SCALE_LOCK_KEY = "cocktime-board-scale-lock";
export const clampScale = (v: number) => Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Math.round(v * 100) / 100));
export function loadScale(): number {
	try {
		const v = parseFloat(localStorage.getItem(SCALE_KEY) ?? "");
		return Number.isFinite(v) ? clampScale(v) : 1;
	} catch {
		return 1;
	}
}

/**
 * 사용자가 직접 맞춘 배율(없으면 null = 자동 fit 에 일임).
 * 자동 fit 은 이 값을 **상한**으로만 쓴다 — 확대는 안 하고, 내용이 화면을 넘치면 축소는 한다.
 * (잠금을 "배율 고정"으로 구현하면 로스터가 커진 세션에서 자유 자석이 화면 밖으로 밀려 안 보인다.)
 */
export function loadUserScale(): number | null {
	try {
		if (localStorage.getItem(SCALE_LOCK_KEY) == null) return null;
		const v = parseFloat(localStorage.getItem(SCALE_KEY) ?? "");
		return Number.isFinite(v) ? clampScale(v) : null;
	} catch {
		return null;
	}
}
