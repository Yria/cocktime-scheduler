import type { Application, Container } from "pixi.js";
import { useBoardStore } from "../../../store/boardStore";
import { useDebugStore } from "../../../store/debugStore";
import { useSessionStore } from "../../../store/sessionStore";
import type { StagePoint } from "../../../types/board";
import { EMPTY_SLOT_R, MAGNET_HIT_R, TEAM_BOX_ABOVE, TEAM_BOX_BELOW, TEAM_W } from "../constants";
import { computeSlotOffset, isInDetachZone, isInRestField } from "../geometry";
import { resolveDropTarget } from "../dropResolver";
import { cockPendingIds, playingIdsFromCourts } from "../membership";
import { registerBoardCameraFlush } from "./cameraBridge";
import { cardControls } from "./cardControls";
import { createFrameScheduler } from "./frameScheduler";
import { createBoardInteractionController, type BoardInteractionTarget } from "./interactionController";
import { createBoardProjection } from "./projection";
import type { BoardEntity, BoardSnapshot, BoardSource, CardView, MagnetView } from "./types";
import { sourceKey } from "./types";

export interface BoardCallbacks {
	onMagnetClick: (id: string) => void;
	onCockCheck: (id: string) => void;
	onSlotClick: (id: string) => void;
	onEditMatch: (id: number) => void;
}

interface Binding {
	node: Container;
	point: StagePoint;
	parentKey?: string;
	animation?: { from: StagePoint; started: number };
}

export interface BoardPresentation {
	scene: BoardSnapshot;
	drag: { view: BoardEntity; point: StagePoint } | null;
	hover: ReturnType<typeof useBoardStore.getState>["hoverTarget"];
	playerDragging: boolean;
}

/** One instance per mounted renderer. Only the commit paths call domain commands. */
export class BoardRuntime {
	private app: Application;
	private callbacks: BoardCallbacks;
	private width: number;
	private height: number;
	private scale = useBoardStore.getState().scale;
	private projection = createBoardProjection();
	private listeners = new Set<() => void>();
	private bindings = new Map<string, Binding>();
	private lifted = new Map<string, number>();
	private z = 10000;
	private world: Container | null = null;
	private preview: Container | null = null;
	private dragging: BoardPresentation["drag"] = null;
	private dragPoint: StagePoint | null = null;
	private committing = false;
	private disposed = false;
	private pendingHover = false;
	private skipAnimationPlayer: string | null = null;
	private cleanups: (() => void)[] = [];
	private presentation: BoardPresentation;
	private eligibility: { players: unknown; courts: unknown; resting: unknown; cock: boolean; playing: Set<string>; notReady: Set<string>; restingIds: Set<string> } | null = null;
	readonly scheduler;
	readonly controller;
	readonly metrics = { frames: 0, pointerFrames: 0 };

	constructor(app: Application, width: number, height: number, callbacks: BoardCallbacks) {
		this.app = app; this.width = width; this.height = height; this.callbacks = callbacks;
		this.presentation = this.readPresentation();
		this.scheduler = createFrameScheduler((time) => this.draw(time));
		this.controller = createBoardInteractionController({
			pick: (p) => this.pick(p),
			getScale: () => this.scale,
			onZoom: (scale) => { this.scale = scale; this.scheduler.invalidate(); },
			commitZoom: (changed) => {
				useBoardStore.getState().commitBoardView({ scale: this.scale, cssWidth: this.width, cssHeight: this.height, userChanged: changed });
			},
			onDragStart: (target) => this.beginDrag(target),
			onDragMove: (_target, point) => {
				if (!this.dragging) return;
				this.dragPoint = point;
				this.pendingHover = true;
				this.scheduler.invalidate();
			},
			onDragEnd: (_target, point) => this.finishDrag(point),
			onCancel: () => this.cancelDrag(),
		});
		this.cleanups.push(useBoardStore.subscribe(this.refresh), useSessionStore.subscribe(this.refresh));
		this.cleanups.push(registerBoardCameraFlush(() => this.controller.flushZoom()));
		this.attachInput(app.canvas);
	}

	getSnapshot = () => this.presentation;
	subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
	setCallbacks(callbacks: BoardCallbacks) { this.callbacks = callbacks; }
	setWorld = (node: Container | null) => { this.world = node; this.scheduler.invalidate(); };
	setPreview = (node: Container | null) => { this.preview = node; this.scheduler.invalidate(); };
	zIndex(key: string, initial: number) { return this.lifted.get(key) ?? initial; }
	committed = () => { this.skipAnimationPlayer = null; this.scheduler.invalidate(); };

	private readPresentation(): BoardPresentation {
		const bs = useBoardStore.getState();
		return { scene: this.projection(bs, useSessionStore.getState()), drag: this.dragging, hover: bs.hoverTarget, playerDragging: bs.dragInfo !== null };
	}

	private refresh = () => {
		if (this.disposed || this.committing) return;
		const next = this.readPresentation();
		if (this.presentation.scene.isEditor && !next.scene.isEditor) {
			this.controller.cancel(); this.publish(); return;
		}
		if (this.dragging && !this.isDragValid(next.scene)) {
			this.controller.cancel(); return;
		}
		const committedScale = useBoardStore.getState().scale;
		// Unrelated store updates must not replace the in-flight pinch value.
		if (committedScale !== this.lastStoreScale) {
			this.scale = committedScale; this.lastStoreScale = committedScale;
			this.scheduler.invalidate();
		}
		if (next.scene === this.presentation.scene && next.drag === this.presentation.drag
			&& next.hover === this.presentation.hover && next.playerDragging === this.presentation.playerDragging) return;
		this.presentation = next;
		for (const listener of this.listeners) listener();
	};
	private lastStoreScale = useBoardStore.getState().scale;

	private publish() {
		this.presentation = this.readPresentation();
		for (const listener of this.listeners) listener();
	}

	resize(width: number, height: number) {
		if (width === this.width && height === this.height) return;
		this.controller.flushZoom();
		this.width = width; this.height = height;
		this.scheduler.invalidate();
	}

	place(key: string, node: Container, point: StagePoint, parentKey?: string, playerId?: string) {
		const old = this.bindings.get(key);
		const moved = old && (old.point.x !== point.x || old.point.y !== point.y);
		const binding: Binding = old?.node === node ? old : { node, point, parentKey };
		if (moved && playerId && playerId !== this.skipAnimationPlayer && !this.dragging) {
			binding.animation = { from: { x: node.x, y: node.y }, started: performance.now() };
		} else if (!moved && old?.node === node && binding.animation) {
			// A hover/asset commit does not restart a position tween.
		} else {
			binding.animation = undefined;
			node.position.set(point.x, point.y);
		}
		binding.point = point; binding.parentKey = parentKey;
		this.bindings.set(key, binding);
		this.scheduler.invalidate();
	}

	unbind(key: string, node: Container) {
		if (this.bindings.get(key)?.node === node) this.bindings.delete(key);
		this.scheduler.invalidate();
	}

	private draw(time: number): boolean {
		if (this.disposed) return false;
		const renderer = this.app.renderer;
		if (renderer.screen.width !== this.width || renderer.screen.height !== this.height) renderer.resize(this.width, this.height);
		this.world?.scale.set(this.scale);
		if (this.preview && this.dragPoint) this.preview.position.set(this.dragPoint.x, this.dragPoint.y);
		if (this.pendingHover && this.dragging && this.dragPoint) {
			this.pendingHover = false; this.metrics.pointerFrames++;
			this.updateHover(this.dragging.view.source, this.dragPoint);
		}
		let active = false;
		for (const binding of this.bindings.values()) {
			const animation = binding.animation;
			if (!animation) continue;
			const t = Math.min(1, Math.max(0, (time - animation.started) / 220));
			const ease = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
			binding.node.position.set(animation.from.x + (binding.point.x - animation.from.x) * ease, animation.from.y + (binding.point.y - animation.from.y) * ease);
			if (t === 1) binding.animation = undefined;
			else active = true;
		}
		this.app.render(); this.metrics.frames++;
		return active;
	}

	private allViews(scene = this.presentation.scene): BoardEntity[] {
		return scene.entities.flatMap((e) => e.kind === "card" ? [e, ...e.members] : [e]);
	}
	private find(source: BoardSource, scene = this.presentation.scene) { return this.allViews(scene).find((v) => v.key === sourceKey(source)); }
	private isValid(source: BoardSource, scene = this.projection(useBoardStore.getState(), useSessionStore.getState())) {
		const view = this.find(source, scene);
		return !!view && JSON.stringify(view.source) === JSON.stringify(source);
	}
	private isDragValid(scene = this.projection(useBoardStore.getState(), useSessionStore.getState())) {
		const original = this.dragging?.view;
		if (!original || !this.isValid(original.source, scene)) return false;
		if (original.kind !== "card") return true;
		const latest = this.find(original.source, scene);
		return latest?.kind === "card" && latest.members.length === original.members.length
			&& latest.members.every((member, i) => member.key === original.members[i].key
				&& member.point.x === original.members[i].point.x && member.point.y === original.members[i].point.y);
	}

	private point(view: BoardEntity, parent?: CardView): StagePoint {
		const node = this.bindings.get(view.key)?.node;
		const local = node ? { x: node.x, y: node.y } : view.point;
		if (!parent) return local;
		const p = this.point(parent);
		return { x: local.x + p.x, y: local.y + p.y };
	}

	private magnetTarget(view: MagnetView, parent?: CardView): BoardInteractionTarget {
		const invoke = (action: () => void) => { if (this.isValid(view.source)) action(); };
		return {
			key: view.key, source: view.source, point: this.point(view, parent), draggable: view.draggable,
			onTap: () => invoke(() => {
				if (view.cockPending) this.callbacks.onCockCheck(view.player.id);
				else if (view.source.kind === "free") this.callbacks.onMagnetClick(view.player.id);
			}),
			onDoubleTap: () => invoke(() => {
				navigator.vibrate?.(30);
				const bs = useBoardStore.getState(); const source = view.source;
				if (source.kind === "ghost") bs.cancelReservation(source.reservationId);
				else if (view.resting) bs.unrestPlayer(view.player.id);
				else if (source.kind === "anchor") bs.detachMember(source.playerId, this.point(view, parent));
			}),
			onLongPress: () => invoke(() => { navigator.vibrate?.(30); useDebugStore.getState().openDebug(view.player.id); }),
		};
	}

	private pick(point: StagePoint): BoardInteractionTarget | null {
		this.controller?.flushZoom();
		const entities = this.presentation.scene.entities.map((view, index) => ({ view, z: this.zIndex(view.key, index) })).sort((a, b) => b.z - a.z);
		const inside = (p: StagePoint, r: number) => Math.hypot(point.x - p.x, point.y - p.y) <= r;
		for (const { view } of entities) {
			if (view.kind === "magnet") { if (inside(this.point(view), MAGNET_HIT_R)) return this.magnetTarget(view); continue; }
			const center = this.point(view); const x = point.x - center.x; const y = point.y - center.y;
			const button = (key: string, action: () => void): BoardInteractionTarget => ({ key: `${view.key}:${key}`, point: center, draggable: false, onTap: () => {
				if (this.isValid(view.source) && useSessionStore.getState().isEditor) action();
			} });
			const controls = cardControls(view.appearance.showUnconfirm);
			const inControl = (rect: typeof controls.main | null) => rect !== null
				&& x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height;
			if (view.source.kind === "team" && inControl(controls.unconfirm)) {
				const id = view.source.teamId;
				return button("unconfirm", () => useBoardStore.getState().unconfirmTeam(id));
			}
			if (inControl(controls.main)) {
				if (view.source.kind === "court") { const id = view.source.courtId; return button("complete", () => { void useBoardStore.getState().completeMatch(id); }); }
				const id = view.source.teamId;
				if (view.appearance.ctaEnabled) return button("cta", () => {
					if (view.confirmed) void useBoardStore.getState().startMatch(id);
					else useBoardStore.getState().confirmTeam(id);
				});
			}
			if (view.source.kind === "court" && view.appearance.showEdit && x >= TEAM_W / 2 - 26 && x <= TEAM_W / 2 - 2 && y >= -TEAM_BOX_ABOVE + 4 && y <= -TEAM_BOX_ABOVE + 28) {
				const id = view.source.courtId; return button("edit", () => this.callbacks.onEditMatch(id));
			}
			for (const member of [...view.members].reverse()) if (inside(this.point(member, view), MAGNET_HIT_R)) return this.magnetTarget(member, view);
			if (view.source.kind === "team") {
				const id = view.source.teamId;
				for (const slot of view.emptySlots) {
					const offset = computeSlotOffset(slot);
					if (inside({ x: center.x + offset.x, y: center.y + offset.y }, EMPTY_SLOT_R)) return button(`slot${slot}`, () => this.callbacks.onSlotClick(id));
				}
			}
			if (x >= -TEAM_W / 2 && x <= TEAM_W / 2 && y >= -TEAM_BOX_ABOVE && y <= TEAM_BOX_BELOW) return { key: view.key, source: view.source, point: center, draggable: view.draggable };
		}
		return null;
	}

	private beginDrag(target: BoardInteractionTarget) {
		if (!target.source || !this.isValid(target.source)) return;
		const view = this.find(target.source);
		if (!view?.draggable) return;
		this.committing = true;
		this.dragging = { view, point: target.point };
		this.dragPoint = target.point;
		const parent = this.presentation.scene.entities.find((e) => e.kind === "card" && e.members.some((m) => m.key === view.key));
		this.lifted.set(parent?.key ?? view.key, ++this.z);
		const binding = this.bindings.get(view.key); if (binding) binding.animation = undefined;
		const bs = useBoardStore.getState();
		if (view.kind === "card") bs.markManualLayout();
		else bs.setDragInfo({ playerId: view.player.id, detachable: view.source.kind === "anchor" || view.ghost, restable: useSessionStore.getState().isEditor && !view.ghost && view.source.kind !== "playing" });
		this.committing = false; this.publish();
	}

	private finishDrag(point: StagePoint) {
		const drag = this.dragging;
		if (!drag) return;
		if (!this.isDragValid() || (this.presentation.scene.isEditor && !useSessionStore.getState().isEditor)) { this.cancelDrag(); return; }
		this.controller.flushZoom();
		this.committing = true; this.pendingHover = false;
		const bs = useBoardStore.getState(); const source = drag.view.source;
		try {
			if (source.kind === "team") { bs.setTeamAnchor(source.teamId, point.x, point.y); bs.settleBoard({ teamId: source.teamId }); }
			else if (source.kind === "court") { bs.setCourtAnchor(source.courtId, point.x, point.y); bs.settleBoard({ courtId: source.courtId }); }
			else {
				this.skipAnimationPlayer = source.playerId;
				if (source.kind === "playing") bs.handlePlayingMagnetDrop(source.playerId, point);
				else if (source.kind === "ghost") {
					if (isInDetachZone(point)) bs.cancelReservation(source.reservationId);
					else bs.handleGhostDrop(source.reservationId, point);
				} else if (!useSessionStore.getState().isEditor) bs.handleDrop(source.playerId, point);
				else if (source.kind === "anchor" && isInDetachZone(point)) bs.detachMember(source.playerId, point);
				else if (isInRestField(point, this.height / this.scale)) {
					if (useSessionStore.getState().restingIds.includes(source.playerId)) bs.unrestPlayer(source.playerId);
					else bs.restPlayer(source.playerId);
				} else bs.handleDrop(source.playerId, point);
			}
		} finally {
			this.restoreSource(drag.view.key);
			this.dragging = null; this.dragPoint = null; bs.clearDrag(); bs.setRestFieldHot(false);
			this.committing = false; this.publish();
		}
	}

	private cancelDrag() {
		if (this.dragging) this.restoreSource(this.dragging.view.key);
		this.committing = true; this.dragging = null; this.dragPoint = null; this.pendingHover = false;
		useBoardStore.getState().clearDrag(); useBoardStore.getState().setRestFieldHot(false);
		this.scale = this.lastStoreScale = useBoardStore.getState().scale;
		this.scheduler.invalidate();
		this.committing = false;
		if (!this.disposed) this.publish();
	}

	private restoreSource(key: string) {
		const latest = this.allViews(this.projection(useBoardStore.getState(), useSessionStore.getState())).find((v) => v.key === key);
		const binding = this.bindings.get(key);
		if (latest && binding) {
			binding.animation = undefined; binding.point = latest.point;
			binding.node.position.set(latest.point.x, latest.point.y);
		}
	}

	private updateHover(source: BoardSource, point: StagePoint) {
		const ss = useSessionStore.getState();
		if (!ss.isEditor || source.kind === "team" || source.kind === "court" || source.kind === "playing") return;
		const bs = useBoardStore.getState();
		const rest = isInRestField(point, this.height / this.scale);
		const detach = !rest && (source.kind === "anchor" || source.kind === "ghost") && isInDetachZone(point);
		bs.setRestFieldHot(rest); bs.setDetachHot(detach);
		if (rest || detach) { bs.setHoverTarget(null); return; }
		let e = this.eligibility;
		if (!e || e.players !== ss.sessionPlayers || e.courts !== ss.courts || e.resting !== ss.restingIds || e.cock !== ss.cockCheckEnabled) {
			e = this.eligibility = { players: ss.sessionPlayers, courts: ss.courts, resting: ss.restingIds, cock: ss.cockCheckEnabled,
				playing: playingIdsFromCourts(ss.courts), notReady: cockPendingIds(ss.sessionPlayers.values(), ss.cockCheckEnabled), restingIds: new Set(ss.restingIds) };
		}
		const target = resolveDropTarget(source.playerId, point, bs.magnets, bs.drafts, bs.reservations, e.playing, e.notReady, e.restingIds);
		if (target.kind === "attach" && target.slot !== undefined) bs.setHoverTarget({ kind: "slot", teamId: target.teamId, slotIndex: target.slot });
		else if (target.kind === "replace") bs.setHoverTarget({ kind: "slot", teamId: target.teamId, slotIndex: target.slot });
		else if (target.kind === "createPair") bs.setHoverTarget({ kind: "magnet", id: target.partnerId });
		else bs.setHoverTarget(null);
	}

	private attachInput(canvas: HTMLCanvasElement) {
		const activePointers = new Set<number>();
		const sample = (e: PointerEvent) => {
			const r = canvas.getBoundingClientRect();
			return { id: e.pointerId, x: (e.clientX - r.left) * this.width / (r.width || this.width), y: (e.clientY - r.top) * this.height / (r.height || this.height) };
		};
		const down = (e: PointerEvent) => { if (e.button !== 0) return; e.preventDefault(); activePointers.add(e.pointerId); canvas.setPointerCapture(e.pointerId); this.controller.pointerDown(sample(e)); };
		const move = (e: PointerEvent) => { this.controller.pointerMove(sample(e)); };
		const up = (e: PointerEvent) => { activePointers.delete(e.pointerId); this.controller.pointerUp(sample(e)); if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId); };
		const cancel = () => { activePointers.clear(); this.controller.cancel(); };
		const lost = (e: PointerEvent) => { if (activePointers.has(e.pointerId)) cancel(); };
		const wheel = (e: WheelEvent) => { e.preventDefault(); this.controller.wheel(e.deltaY); };
		const visibility = () => {
			if (document.hidden) { cancel(); this.scheduler.pause(); }
			else { this.refresh(); this.scheduler.resume(); this.scheduler.invalidate(); }
		};
		canvas.style.touchAction = "none";
		canvas.addEventListener("pointerdown", down); canvas.addEventListener("pointermove", move); canvas.addEventListener("pointerup", up);
		canvas.addEventListener("pointercancel", cancel); canvas.addEventListener("lostpointercapture", lost); canvas.addEventListener("wheel", wheel, { passive: false });
		window.addEventListener("blur", cancel); document.addEventListener("visibilitychange", visibility);
		this.cleanups.push(() => {
			canvas.removeEventListener("pointerdown", down); canvas.removeEventListener("pointermove", move); canvas.removeEventListener("pointerup", up);
			canvas.removeEventListener("pointercancel", cancel); canvas.removeEventListener("lostpointercapture", lost); canvas.removeEventListener("wheel", wheel);
			window.removeEventListener("blur", cancel); document.removeEventListener("visibilitychange", visibility);
		});
	}

	dispose() {
		if (this.disposed) return;
		this.disposed = true;
		for (const cleanup of this.cleanups) cleanup();
		this.controller.dispose(); this.scheduler.dispose();
		this.bindings.clear(); this.listeners.clear();
	}
}
