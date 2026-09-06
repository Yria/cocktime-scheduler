import { Component, lazy, Suspense, useCallback, useState, type ReactNode } from "react";
import type Konva from "konva";
import type { BoardCallbacks } from "../../lib/board/pixi/runtime";

const PixiBoardCanvas = lazy(() => import("./pixi/PixiBoardCanvas"));
const KonvaBoardCanvas = lazy(() => import("./KonvaBoardCanvas"));

export interface BoardRendererProps extends BoardCallbacks {
	width: number;
	height: number;
	scale: number;
	onStageWheel: (e: Konva.KonvaEventObject<WheelEvent>) => void;
	onStageTouchMove: (e: Konva.KonvaEventObject<TouchEvent>) => void;
	onStageTouchEnd: () => void;
	onMagnetDragMove: (id: string, x: number, y: number) => void;
	onMagnetDragEnd: (id: string, x: number, y: number) => void;
	onGhostDragEnd: (id: string, x: number, y: number) => void;
}

class RendererBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
	state = { failed: false };
	static getDerivedStateFromError() { return { failed: true }; }
	render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

export default function SessionBoardRenderer(props: BoardRendererProps) {
	// Read-only A/B switch, with a single mounted renderer and no duplicate effects.
	const [legacy, setLegacy] = useState(() => new URLSearchParams(window.location.search).get("boardRenderer") === "konva");
	const fallback = <KonvaBoardCanvas {...props} />;
	const onError = useCallback((error: unknown) => {
		console.warn("Pixi board unavailable; using compatibility renderer", error);
		setLegacy(true);
	}, []);
	return <Suspense fallback={<div role="status" style={{ color: "#94A3B8", padding: 12 }}>보드 준비 중…</div>}>
		<RendererBoundary fallback={fallback}>
			{legacy ? fallback : <PixiBoardCanvas {...props} onError={onError} />}
		</RendererBoundary>
	</Suspense>;
}
