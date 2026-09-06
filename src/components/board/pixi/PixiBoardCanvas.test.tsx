import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PixiBoardProps } from "./PixiBoardCanvas";

interface CanvasDouble {
	style: Record<string, string>;
	dataset: Record<string, string>;
	listeners: Map<string, (event: Event) => void>;
	setAttribute: ReturnType<typeof vi.fn>;
	remove: ReturnType<typeof vi.fn>;
	addEventListener(name: string, listener: (event: Event) => void): void;
	removeEventListener(name: string): void;
}
interface RuntimeDouble {
	dispose: ReturnType<typeof vi.fn>;
	resize: ReturnType<typeof vi.fn>;
	setCallbacks: ReturnType<typeof vi.fn>;
	controller: { cancel: ReturnType<typeof vi.fn> };
	scheduler: { pause: ReturnType<typeof vi.fn> };
}

const harness = vi.hoisted(() => ({
	effects: [] as Array<() => void | (() => void)>,
	refs: [] as Array<{ current: unknown }>,
	refIndex: 0,
	createRoot: vi.fn(),
	unmountRoot: vi.fn(),
	createRuntime: vi.fn(),
}));

// These tests execute the real host effect with deterministic deferred init.
// Pixi/GPU and React's effect runner are the ports; no browser dependency is needed.
vi.mock("react", async (importOriginal) => ({
	...await importOriginal<typeof import("react")>(),
	useRef: (value: unknown) => {
		const index = harness.refIndex++;
		return harness.refs[index] ?? (harness.refs[index] = { current: value });
	},
	useEffect: (effect: () => void | (() => void)) => { harness.effects.push(effect); },
}));
vi.mock("@pixi/react", () => ({ createRoot: harness.createRoot, unmountRoot: harness.unmountRoot }));
vi.mock("../../../lib/board/pixi/runtime", () => ({
	BoardRuntime: function (...args: unknown[]) { return harness.createRuntime(...args); },
}));
vi.mock("./BoardScene", () => ({ BoardScene: () => null }));

import PixiBoardCanvas from "./PixiBoardCanvas";

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
	return { promise, resolve, reject };
}

function runtimeDouble(): RuntimeDouble {
	return {
		dispose: vi.fn(), resize: vi.fn(), setCallbacks: vi.fn(),
		controller: { cancel: vi.fn() }, scheduler: { pause: vi.fn() },
	};
}

function props(): PixiBoardProps {
	return {
		width: 390, height: 700, onError: vi.fn(),
		onMagnetClick: vi.fn(), onCockCheck: vi.fn(), onSlotClick: vi.fn(), onEditMatch: vi.fn(),
	};
}

function hostRender(input: PixiBoardProps) {
	harness.effects = [];
	harness.refIndex = 0;
	PixiBoardCanvas(input);
	harness.effects[0]();
	return harness.effects[1];
}

async function flushInit() {
	// Await both root.render continuations and the host's finally block.
	for (let i = 0; i < 5; i++) await Promise.resolve();
}

describe("PixiBoardCanvas host lifecycle", () => {
	let canvases: CanvasDouble[];
	beforeEach(() => {
		vi.clearAllMocks();
		harness.refs = [{ current: { appendChild: vi.fn() } }];
		harness.effects = [];
		harness.refIndex = 0;
		canvases = [];
		vi.stubGlobal("window", { devicePixelRatio: 3 });
		vi.stubGlobal("document", {
			createElement: vi.fn(() => {
				const canvas: CanvasDouble = {
					style: {}, dataset: {}, listeners: new Map(), setAttribute: vi.fn(), remove: vi.fn(),
					addEventListener(name, listener) { this.listeners.set(name, listener); },
					removeEventListener(name) { this.listeners.delete(name); },
				};
				canvases.push(canvas);
				return canvas;
			}),
		});
	});
	afterEach(() => { vi.unstubAllGlobals(); });

	it("awaits initialization, disables all automatic ticker paths, then releases once", async () => {
		const init = deferred<object>();
		const app = {};
		const root = { render: vi.fn().mockImplementationOnce(() => init.promise).mockResolvedValue(app) };
		const runtime = runtimeDouble();
		harness.createRoot.mockReturnValue(root);
		harness.createRuntime.mockReturnValue(runtime);
		const cleanup = hostRender(props())();
		expect(root.render).toHaveBeenCalledWith(null, expect.objectContaining({
			autoStart: false, sharedTicker: false, resolution: 3, preference: ["webgl"],
		}));
		expect(harness.createRuntime).not.toHaveBeenCalled();
		init.resolve(app);
		await flushInit();
		expect(harness.createRuntime).toHaveBeenCalledOnce();
		expect(root.render).toHaveBeenCalledTimes(2);
		cleanup?.();
		cleanup?.();
		expect(runtime.dispose).toHaveBeenCalledOnce();
		expect(harness.unmountRoot).toHaveBeenCalledExactlyOnceWith(root);
		expect(runtime.dispose.mock.invocationCallOrder[0]).toBeLessThan(harness.unmountRoot.mock.invocationCallOrder[0]);
	});

	it("removes an abandoned canvas immediately but waits for init before reconciler teardown", async () => {
		const init = deferred<object>();
		const root = { render: vi.fn(() => init.promise) };
		harness.createRoot.mockReturnValue(root);
		const cleanup = hostRender(props())();
		cleanup?.();
		expect(canvases[0].remove).toHaveBeenCalledOnce();
		expect(canvases[0].listeners.size).toBe(0);
		expect(harness.unmountRoot).not.toHaveBeenCalled();
		init.resolve({});
		await flushInit();
		expect(harness.createRuntime).not.toHaveBeenCalled();
		expect(harness.unmountRoot).toHaveBeenCalledExactlyOnceWith(root);
	});

	it("reports initialization rejection to the error boundary and releases the failed root", async () => {
		const init = deferred<object>();
		const root = { render: vi.fn(() => init.promise) };
		harness.createRoot.mockReturnValue(root);
		const input = props();
		const cleanup = hostRender(input)();
		const error = new Error("WebGL unavailable");
		init.reject(error);
		await flushInit();
		expect(input.onError).toHaveBeenCalledExactlyOnceWith(error);
		expect(harness.createRuntime).not.toHaveBeenCalled();
		cleanup?.();
		expect(harness.unmountRoot).toHaveBeenCalledExactlyOnceWith(root);
	});

	it("does not report an abandoned generation's late failure", async () => {
		const init = deferred<object>();
		const root = { render: vi.fn(() => init.promise) };
		harness.createRoot.mockReturnValue(root);
		const input = props();
		hostRender(input)()?.();
		init.reject(new Error("late failure"));
		await flushInit();
		expect(input.onError).not.toHaveBeenCalled();
		expect(harness.unmountRoot).toHaveBeenCalledExactlyOnceWith(root);
	});

	it("keeps StrictMode generations isolated when their initialization completes out of order", async () => {
		const oldInit = deferred<object>();
		const newInit = deferred<object>();
		const oldRoot = { render: vi.fn(() => oldInit.promise) };
		const newRoot = { render: vi.fn().mockImplementationOnce(() => newInit.promise).mockResolvedValue({}) };
		const runtime = runtimeDouble();
		harness.createRoot.mockReturnValueOnce(oldRoot).mockReturnValueOnce(newRoot);
		harness.createRuntime.mockReturnValue(runtime);
		const input = props();
		const mount = hostRender(input);
		mount()?.();
		const cleanupNew = mount();
		expect(canvases).toHaveLength(2);
		expect(harness.createRoot.mock.calls[0][0]).not.toBe(harness.createRoot.mock.calls[1][0]);
		newInit.resolve({});
		await flushInit();
		oldInit.resolve({});
		await flushInit();
		expect(harness.createRuntime).toHaveBeenCalledOnce();
		expect(harness.unmountRoot).toHaveBeenCalledExactlyOnceWith(oldRoot);
		const nextProps = { ...input, width: 500 };
		hostRender(nextProps);
		expect(runtime.resize).toHaveBeenCalledWith(500, 700);
		cleanupNew?.();
		expect(runtime.dispose).toHaveBeenCalledOnce();
		expect(harness.unmountRoot).toHaveBeenLastCalledWith(newRoot);
	});

	it("constructs the runtime with latest dimensions and callbacks after slow init", async () => {
		const init = deferred<object>();
		const app = {};
		const root = { render: vi.fn().mockImplementationOnce(() => init.promise).mockResolvedValue(app) };
		harness.createRoot.mockReturnValue(root);
		harness.createRuntime.mockReturnValue(runtimeDouble());
		const input = props();
		const cleanup = hostRender(input)();
		const updated = { ...input, width: 600, height: 400, onSlotClick: vi.fn() };
		hostRender(updated);
		init.resolve(app);
		await flushInit();
		expect(harness.createRuntime).toHaveBeenCalledWith(app, 600, 400, updated);
		cleanup?.();
	});

	it("cancels input and pauses drawing before notifying context loss", async () => {
		const root = { render: vi.fn().mockResolvedValue({}) };
		const runtime = runtimeDouble();
		harness.createRoot.mockReturnValue(root);
		harness.createRuntime.mockReturnValue(runtime);
		const input = props();
		const cleanup = hostRender(input)();
		await flushInit();
		const event = new Event("webglcontextlost", { cancelable: true });
		canvases[0].listeners.get("webglcontextlost")?.(event);
		expect(event.defaultPrevented).toBe(true);
		expect(runtime.controller.cancel).toHaveBeenCalledOnce();
		expect(runtime.scheduler.pause).toHaveBeenCalledOnce();
		expect(input.onError).toHaveBeenCalledOnce();
		expect(runtime.scheduler.pause.mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(input.onError).mock.invocationCallOrder[0]);
		cleanup?.();
	});
});
