import { extend } from "@pixi/react";
import { Container } from "pixi.js";
import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { computeSlotOffset } from "../../../lib/board/geometry";
import type { BoardRuntime, BoardPresentation } from "../../../lib/board/pixi/runtime";
import type { BoardEntity, CardView, MagnetView } from "../../../lib/board/pixi/types";
import { BoardTextureProvider, CardVisual, CardControlsVisual, EmptySlotVisual, MagnetVisual, SlotHoverVisual } from "./PixiVisuals";

extend({ Container });

function usePosition(runtime: BoardRuntime, view: BoardEntity, parentKey?: string) {
	const nodeRef = useRef<Container | null>(null);
	const ref = useCallback((node: Container | null) => {
		if (!node && nodeRef.current) runtime.unbind(view.key, nodeRef.current);
		nodeRef.current = node;
	}, [runtime, view.key]);
	useLayoutEffect(() => {
		if (nodeRef.current) runtime.place(view.key, nodeRef.current, view.point, parentKey, view.kind === "magnet" ? view.player.id : undefined);
	}, [runtime, view, parentKey]);
	return ref;
}

const Magnet = memo(function Magnet({ runtime, view, parentKey, hidden, dragging, hovered }: {
	runtime: BoardRuntime; view: MagnetView; parentKey?: string; hidden: boolean; dragging: boolean; hovered: boolean;
}) {
	const ref = usePosition(runtime, view, parentKey);
	useLayoutEffect(() => { runtime.scheduler.invalidate(); });
	return <pixiContainer ref={ref} visible={!hidden} eventMode="none">
		<MagnetVisual appearance={view} dragging={dragging} hovered={hovered} />
	</pixiContainer>;
});

function useFlash(active: boolean) {
	const [flash, setFlash] = useState(false);
	useEffect(() => {
		if (!active) return;
		let timer: number | undefined;
		const update = () => {
			window.clearInterval(timer);
			if (!document.hidden) timer = window.setInterval(() => setFlash((f) => !f), 550);
		};
		update(); document.addEventListener("visibilitychange", update);
		return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", update); };
	}, [active]);
	return active && flash;
}

function CardContents({ runtime, view, presentation, preview = false }: {
	runtime: BoardRuntime; view: CardView; presentation: BoardPresentation; preview?: boolean;
}) {
	const flash = useFlash(view.appearance.blink);
	const hover = presentation.hover;
	useLayoutEffect(() => { runtime.scheduler.invalidate(); });
	return <>
		<CardVisual appearance={view.appearance} dragging={presentation.playerDragging} flash={flash} />
		{hover?.kind === "slot" && view.source.kind === "team" && hover.teamId === view.source.teamId && (
			<pixiContainer x={computeSlotOffset(hover.slotIndex).x} y={computeSlotOffset(hover.slotIndex).y}><SlotHoverVisual /></pixiContainer>
		)}
		{view.emptySlots.map((slot) => {
			const p = computeSlotOffset(slot);
			return <pixiContainer key={slot} x={p.x} y={p.y}><EmptySlotVisual /></pixiContainer>;
		})}
		{view.members.map((member) => preview
			? <pixiContainer key={member.key} x={member.point.x} y={member.point.y}><MagnetVisual appearance={member} dragging={presentation.playerDragging} hovered={false} /></pixiContainer>
			: <Magnet key={member.key} runtime={runtime} view={member} parentKey={view.key}
				hidden={presentation.drag?.view.key === member.key} dragging={presentation.playerDragging} hovered={hover?.kind === "magnet" && hover.id === member.player.id} />)}
		<CardControlsVisual appearance={view.appearance} dragging={presentation.playerDragging} flash={flash} />
	</>;
}

function Card({ runtime, view, index, presentation }: { runtime: BoardRuntime; view: CardView; index: number; presentation: BoardPresentation }) {
	const ref = usePosition(runtime, view);
	return <pixiContainer ref={ref} zIndex={runtime.zIndex(view.key, index)} visible={presentation.drag?.view.key !== view.key} eventMode="none">
		<CardContents runtime={runtime} view={view} presentation={presentation} />
	</pixiContainer>;
}

export function BoardScene({ runtime, resolution }: { runtime: BoardRuntime; resolution: number }) {
	const presentation = useSyncExternalStore(runtime.subscribe, runtime.getSnapshot);
	useLayoutEffect(() => { runtime.committed(); });
	const setWorld = useCallback((node: Container | null) => runtime.setWorld(node), [runtime]);
	const setPreview = useCallback((node: Container | null) => runtime.setPreview(node), [runtime]);
	const invalidate = useCallback(() => runtime.scheduler.invalidate(), [runtime]);
	const drag = presentation.drag;
	return <BoardTextureProvider resolution={resolution} invalidate={invalidate}>
		<pixiContainer ref={setWorld} eventMode="none" isRenderGroup>
			<pixiContainer sortableChildren eventMode="none">
				{presentation.scene.entities.map((view, index) => view.kind === "card"
					? <Card key={view.key} runtime={runtime} view={view} index={index} presentation={presentation} />
					: <pixiContainer key={view.key} zIndex={runtime.zIndex(view.key, index)}>
						<Magnet runtime={runtime} view={view} hidden={drag?.view.key === view.key} dragging={presentation.playerDragging} hovered={presentation.hover?.kind === "magnet" && presentation.hover.id === view.player.id} />
					</pixiContainer>)}
			</pixiContainer>
			{drag && <pixiContainer ref={setPreview} eventMode="none">
				{drag.view.kind === "magnet"
					? <MagnetVisual appearance={drag.view} dragging={presentation.playerDragging} hovered={false} />
					: <CardContents runtime={runtime} view={drag.view} presentation={presentation} preview />}
			</pixiContainer>}
		</pixiContainer>
	</BoardTextureProvider>;
}
