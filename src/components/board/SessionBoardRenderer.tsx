import { Component, lazy, Suspense } from "react";
import type { BoardCallbacks } from "../../lib/board/pixi/runtime";

const PixiBoardCanvas = lazy(() => import("./pixi/PixiBoardCanvas"));

export interface BoardRendererProps extends BoardCallbacks {
	width: number;
	height: number;
}

/** Owns renderer failures; retry remounts Pixi while the session shell and stores stay alive. */
export default class SessionBoardRenderer extends Component<BoardRendererProps, { failed: boolean }> {
	state = { failed: false };
	static getDerivedStateFromError() { return { failed: true }; }
	componentDidCatch(error: unknown) { console.warn("Session board rendering failed", error); }
	private onError = (error: unknown) => {
		console.warn("Session board rendering failed", error);
		this.setState({ failed: true });
	};
	render() {
		if (this.state.failed) return (
			<div role="alert" style={{ color: "#CBD5E1", padding: 24, textAlign: "center" }}>
				<p>보드를 표시할 수 없어요. 다시 시도해 주세요.</p>
				<button type="button" className="rounded-lg bg-blue-600 px-4 py-2 font-semibold text-white" onClick={() => this.setState({ failed: false })}>
					다시 시도
				</button>
			</div>
		);
		return (
			<Suspense fallback={<div role="status" style={{ color: "#94A3B8", padding: 12 }}>보드 준비 중…</div>}>
				<PixiBoardCanvas {...this.props} onError={this.onError} />
			</Suspense>
		);
	}
}
