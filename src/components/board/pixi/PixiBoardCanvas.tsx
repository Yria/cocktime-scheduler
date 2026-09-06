import { createRoot, unmountRoot } from "@pixi/react";
import { Component, useEffect, useRef, type ReactNode } from "react";
import { BG_BOARD } from "../../../lib/board/constants";
import { BoardRuntime, type BoardCallbacks } from "../../../lib/board/pixi/runtime";
import { BoardScene } from "./BoardScene";

class SceneErrorBoundary extends Component<{ onError: (error: unknown) => void; children: ReactNode }, { failed: boolean }> {
	state = { failed: false };
	static getDerivedStateFromError() { return { failed: true }; }
	componentDidCatch(error: unknown) { this.props.onError(error); }
	render() { return this.state.failed ? null : this.props.children; }
}

export interface PixiBoardProps extends BoardCallbacks {
	width: number;
	height: number;
	onError: (error: unknown) => void;
}

/** Thin host: await init failures, and unmount the reconciler before destroying Pixi. */
export default function PixiBoardCanvas(props: PixiBoardProps) {
	const hostRef = useRef<HTMLDivElement>(null);
	const runtimeRef = useRef<BoardRuntime | null>(null);
	const latestRef = useRef(props);
	useEffect(() => {
		latestRef.current = props;
		runtimeRef.current?.setCallbacks(props);
		runtimeRef.current?.resize(props.width, props.height);
	}, [props]);

	useEffect(() => {
		const host = hostRef.current;
		if (!host) return;
		// Each StrictMode generation owns a distinct canvas, including pending init.
		const canvas = document.createElement("canvas");
		canvas.style.display = "block";
		canvas.style.touchAction = "none";
		canvas.setAttribute("aria-label", "세션 팀 편성 보드");
		canvas.dataset.boardRenderer = "pixi";
		host.appendChild(canvas);
		const root = createRoot(canvas);
		let disposed = false;
		let settled = false;
		let released = false;
		let runtime: BoardRuntime | null = null;
		const release = () => {
			if (released || !settled) return;
			released = true;
			runtime?.dispose();
			if (runtimeRef.current === runtime) runtimeRef.current = null;
			unmountRoot(root);
		};
		const fail = (error: unknown) => { if (!disposed) latestRef.current.onError(error); };
		const contextLost = (event: Event) => {
			event.preventDefault();
			runtime?.controller.cancel();
			runtime?.scheduler.pause();
			// Fall back with the authoritative stores intact; no stale GPU cache reuse.
			fail(new Error("보드 WebGL context가 유실되어 호환 렌더러로 전환합니다."));
		};
		canvas.addEventListener("webglcontextlost", contextLost);
		// An array restricts autoDetectRenderer; a string would also try WebGPU/Canvas.
		const options = { preference: ["webgl"], autoStart: false, sharedTicker: false, autoDensity: true,
			resolution: window.devicePixelRatio || 1, width: latestRef.current.width, height: latestRef.current.height,
			background: BG_BOARD, antialias: true };
		void (async () => {
			try {
				const app = await root.render(null, options);
				if (disposed) return;
				const current = latestRef.current;
				runtime = new BoardRuntime(app, current.width, current.height, current);
				runtimeRef.current = runtime;
				await root.render(<SceneErrorBoundary onError={fail}><BoardScene runtime={runtime} resolution={options.resolution} /></SceneErrorBoundary>, options);
			} catch (error) { fail(error); }
			finally { settled = true; if (disposed) release(); }
		})();
		return () => {
			disposed = true;
			canvas.removeEventListener("webglcontextlost", contextLost);
			canvas.remove();
			release();
		};
	}, []);
	return <div ref={hostRef} style={{ width: props.width, height: props.height, overflow: "hidden" }} />;
}
