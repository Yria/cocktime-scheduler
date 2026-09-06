export interface FrameClock {
	request: (callback: (time: number) => void) => number;
	cancel: (handle: number) => void;
}

/** One frame owner. flush returns true only while a visible animation is active. */
export function createFrameScheduler(
	flush: (time: number) => boolean,
	clock: FrameClock = { request: (callback) => requestAnimationFrame(callback), cancel: (handle) => cancelAnimationFrame(handle) },
) {
	let handle: number | null = null;
	let disposed = false;
	let paused = false;
	let dirty = false;
	const invalidate = () => {
		if (disposed) return;
		dirty = true;
		if (paused || handle !== null) return;
		handle = clock.request((time) => {
			handle = null;
			dirty = false;
			if (flush(time)) invalidate();
		});
	};
	return {
		invalidate,
		pause() {
			paused = true;
			if (handle !== null) clock.cancel(handle);
			handle = null;
		},
		resume() {
			paused = false;
			if (dirty) invalidate();
		},
		dispose() {
			disposed = true;
			if (handle !== null) clock.cancel(handle);
			handle = null;
		},
	};
}
