import { extend } from "@pixi/react";
import { Container } from "pixi.js";
import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { computeSlotOffset } from "../../../lib/board/geometry";
import type { BoardRuntime, BoardPresentation, RemoteDragView } from "../../../lib/board/pixi/runtime";
import type { BoardEntity, CardView, MagnetView } from "../../../lib/board/pixi/types";
import { BoardTextureProvider, CardVisual, CardControlsVisual, EmptySlotVisual, MagnetVisual, SlotHoverVisual, LocateVisual, RemoteHolderBadge } from "./PixiVisuals";

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

/** 다른 운영진이 잡고 있는 항목의 원래 자리 투명도(동시 편집). 위치는 건드리지 않는다. */
const REMOTE_HELD_ALPHA = 0.35;

const Magnet = memo(function Magnet({ runtime, view, parentKey, hidden, dragging, hovered, located, faded = false }: {
	runtime: BoardRuntime; view: MagnetView; parentKey?: string; hidden: boolean; dragging: boolean; hovered: boolean; located: boolean; faded?: boolean;
}) {
	const ref = usePosition(runtime, view, parentKey);
	useLayoutEffect(() => { runtime.scheduler.invalidate(); });
	return <pixiContainer ref={ref} visible={!hidden} alpha={faded ? REMOTE_HELD_ALPHA : 1} eventMode="none">
		<MagnetVisual appearance={view} dragging={dragging} hovered={hovered} />
		{located && <LocateVisual />}
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
	const replacing = hover?.kind === "slot" && hover.slotIndex === -1 && view.source.kind === "team" && hover.teamId === view.source.teamId;
	useLayoutEffect(() => { runtime.scheduler.invalidate(); });
	return <>
		<CardVisual appearance={replacing ? { ...view.appearance, label: "놓으면 명단 교체", stroke: "#34d399", labelColor: "#34d399" } : view.appearance} dragging={presentation.playerDragging} flash={flash} />
		{hover?.kind === "slot" && hover.slotIndex >= 0 && ((view.source.kind === "team" && hover.teamId === view.source.teamId)
			|| (view.source.kind === "court" && hover.teamId === view.key)
			|| (view.source.kind === "proposal" && hover.teamId === view.source.groupId)) && (
			<pixiContainer x={computeSlotOffset(hover.slotIndex).x} y={computeSlotOffset(hover.slotIndex).y}><SlotHoverVisual /></pixiContainer>
		)}
		{view.emptySlots.map((slot) => {
			const p = computeSlotOffset(slot);
			return <pixiContainer key={slot} x={p.x} y={p.y}><EmptySlotVisual waiting={view.waitingSlots?.includes(slot)} /></pixiContainer>;
		})}
		{view.members.map((member) => preview
			? <pixiContainer key={member.key} x={member.point.x} y={member.point.y}><MagnetVisual appearance={member} dragging={presentation.playerDragging} hovered={false} /></pixiContainer>
			: <Magnet key={member.key} runtime={runtime} view={member} parentKey={view.key}
				located={presentation.locate?.playerId === member.player.id} hidden={presentation.drag?.view.key === member.key} dragging={presentation.playerDragging} hovered={hover?.kind === "magnet" && hover.id === member.player.id}
				faded={presentation.remoteHeld.has(member.key)} />)}
		<CardControlsVisual appearance={view.appearance} dragging={presentation.playerDragging} flash={flash} />
	</>;
}

function Card({ runtime, view, index, presentation }: { runtime: BoardRuntime; view: CardView; index: number; presentation: BoardPresentation }) {
	const ref = usePosition(runtime, view);
	return <pixiContainer ref={ref} zIndex={runtime.zIndex(view.key, index)} visible={presentation.drag?.view.key !== view.key}
		alpha={presentation.remoteHeld.has(view.key) ? REMOTE_HELD_ALPHA : 1} eventMode="none">
		<CardContents runtime={runtime} view={view} presentation={presentation} />
	</pixiContainer>;
}

/** 원격 드래그 미리보기 — 로컬 드래그 미리보기처럼 월드좌표 오버레이에 따로 그리고, 위치는 런타임이 보간한다. */
function RemotePreview({ runtime, item, presentation }: { runtime: BoardRuntime; item: RemoteDragView; presentation: BoardPresentation }) {
	const nodeRef = useRef<Container | null>(null);
	const ref = useCallback((node: Container | null) => {
		if (node) runtime.bindRemotePreview(item.key, node);
		else if (nodeRef.current) runtime.unbindRemotePreview(item.key, nodeRef.current);
		nodeRef.current = node;
	}, [runtime, item.key]);
	return <pixiContainer ref={ref} eventMode="none">
		{item.view.kind === "magnet"
			? <MagnetVisual appearance={item.view} dragging hovered={false} />
			: <CardContents runtime={runtime} view={item.view} presentation={{ ...presentation, hover: null }} preview />}
		<RemoteHolderBadge name={item.name} card={item.view.kind === "card"} />
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
						<Magnet runtime={runtime} view={view} located={presentation.locate?.playerId === view.player.id} hidden={drag?.view.key === view.key} dragging={presentation.playerDragging} hovered={presentation.hover?.kind === "magnet" && presentation.hover.id === view.player.id}
							faded={presentation.remoteHeld.has(view.key)} />
					</pixiContainer>)}
			</pixiContainer>
			{drag && <pixiContainer ref={setPreview} eventMode="none">
				{drag.view.kind === "magnet"
					? <MagnetVisual appearance={drag.view} dragging={presentation.playerDragging} hovered={false} />
					: <CardContents runtime={runtime} view={drag.view} presentation={presentation} preview />}
			</pixiContainer>}
			{presentation.remote.map((item) => <RemotePreview key={item.key} runtime={runtime} item={item} presentation={presentation} />)}
		</pixiContainer>
	</BoardTextureProvider>;
}
