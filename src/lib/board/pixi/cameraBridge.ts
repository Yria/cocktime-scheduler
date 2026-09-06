/** The DOM layout policy flushes an in-flight camera before auto-fit/resize/commands. */
let flush: (() => void) | undefined;

export function registerBoardCameraFlush(callback: () => void) {
	flush = callback;
	return () => { if (flush === callback) flush = undefined; };
}

export function flushBoardCamera() { flush?.(); }
