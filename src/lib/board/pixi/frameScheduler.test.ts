import { describe, expect, it } from "vitest";
import { createFrameScheduler } from "./frameScheduler";

describe("board on-demand frames", () => {
	function fixture(flush: (t: number) => boolean) {
		let id = 0;
		const queued = new Map<number, (t: number) => void>();
		const scheduler = createFrameScheduler(flush, {
			request: (f) => { queued.set(++id, f); return id; },
			cancel: (h) => { queued.delete(h); },
		});
		return { scheduler, queued, tick: () => {
			const current = [...queued.values()]; queued.clear();
			for (const f of current) f(16);
		} };
	}
	it("coalesces changes and does not render an idle scene", () => {
		let renders = 0;
		const f = fixture(() => { renders++; return false; });
		expect(f.queued.size).toBe(0);
		f.scheduler.invalidate(); f.scheduler.invalidate();
		expect(f.queued.size).toBe(1);
		f.tick();
		expect(renders).toBe(1); expect(f.queued.size).toBe(0);
	});
	it("continues only an active animation and cancels on teardown", () => {
		const f = fixture(() => true);
		f.scheduler.invalidate(); f.tick();
		expect(f.queued.size).toBe(1);
		f.scheduler.dispose(); f.scheduler.invalidate();
		expect(f.queued.size).toBe(0);
	});
	it("keeps dirty work while hidden and resumes once", () => {
		const f = fixture(() => false);
		f.scheduler.invalidate(); f.scheduler.pause();
		expect(f.queued.size).toBe(0);
		f.scheduler.resume(); expect(f.queued.size).toBe(1);
		f.tick(); expect(f.queued.size).toBe(0);
	});
});
