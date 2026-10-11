import type { Application, Container } from "pixi.js";
import { useBoardStore } from "../../../store/boardStore";
import { useDebugStore } from "../../../store/debugStore";
import { useSessionStore } from "../../../store/sessionStore";
import { setLocalDragActive } from "../../../store/board/localDrag";
import { useRemoteDragStore, type RemoteDrag } from "../../../store/remoteDragStore";
import { toast } from "../../../store/toastStore";
import type { StagePoint } from "../../../types/board";
import { EMPTY_SLOT_R, MAGNET_HIT_R, PAIR_RADIUS, PAIR_RADIUS_DETACH, TEAM_BOX_ABOVE, TEAM_BOX_BELOW, TEAM_W } from "../constants";
import { computeSlotOffset, isInDetachZone, isInRestField, isInsideTeamBounds, slotIndexAt } from "../geometry";
import type { ProposalComposer } from "../matchProposals";
import { nearestFreePartner, resolveDropTarget } from "../dropResolver";
import { cockPendingIds, playingIdsFromCourts } from "../membership";
import { registerBoardCameraFlush } from "./cameraBridge";
import { cardControls } from "./cardControls";
import { createDragSender } from "./dragSender";
import { createFrameScheduler } from "./frameScheduler";
import { createBoardInteractionController, type BoardInteractionTarget } from "./interactionController";
import { createBoardProjection } from "./projection";
import { useAdminCoverageStore } from "../../../store/adminCoverageStore";
import { canUseMatchPlayer } from "../matchRosterEdit";
import type { BoardEntity, BoardSnapshot, BoardSource, CardView, MagnetView } from "./types";
import { sourceKey } from "./types";

export interface BoardCallbacks {
	onMagnetClick: (id: string) => void;
	onCockCheck: (id: string) => void;
	onSlotClick: (id: string) => void;
	proposals?: ProposalComposer;
	onEmptyDoubleTap?: () => void;
	locate?: { playerId: string } | null;
}

interface Binding {
	node: Container;
	point: StagePoint;
	parentKey?: string;
	animation?: { from: StagePoint; started: number };
}

/** 다른 운영진이 끌고 있는 항목(동시 편집) — 원본 자리는 흐리게, 미리보기는 별도 레이어에 그린다. */
export interface RemoteDragView {
	key: string;
	view: BoardEntity;
	name: string;
}

export interface BoardPresentation {
	scene: BoardSnapshot;
	drag: { view: BoardEntity; point: StagePoint } | null;
	hover: ReturnType<typeof useBoardStore.getState>["hoverTarget"];
	playerDragging: boolean;
	locate: BoardCallbacks["locate"];
	/** 원격 드래그 미리보기 목록과 흐리게 그릴 원본 key 집합(동시 편집이 아니면 항상 빈 값). */
	remote: readonly RemoteDragView[];
	remoteHeld: ReadonlySet<string>;
}

const NO_REMOTE: readonly RemoteDragView[] = [];
/** 이 간격 안에 양쪽이 같은 항목을 잡으면 '동시'로 보고 연결 id 로 가른다(D10). */
const GRAB_TIE_MS = 250;
const NO_REMOTE_HELD: ReadonlySet<string> = new Set();
/** 원격 미리보기 보간 시간상수(지수평활). 250ms 간격 샘플을 부드럽게 잇는다. */
const REMOTE_TAU_MS = 100;

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
	private proposalUnsubscribe?: () => void;
	private presentation: BoardPresentation;
	// 실시간 드래그(동시 편집) — 송신 스로틀, 원격 미리보기 노드와 보간 상태, 마지막 프레임 시각.
	private sender = createDragSender(() => useRemoteDragStore.getState().port);
	/** 공유 드래그를 시작한 시각(동시 잡기 판정 — remoteDragStore.startedAt 과 같은 이 기기 시계). */
	private dragStartedAt = 0;
	private remotePreviews = new Map<string, { node: Container; x: number; y: number }>();
	private remoteCache: { drags: ReadonlyMap<string, RemoteDrag>; scene: BoardSnapshot; dragKey: string | null; remote: readonly RemoteDragView[]; held: ReadonlySet<string> } | null = null;
	private lastFrame = 0;
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
			commitZoom: () => {
				useBoardStore.getState().commitBoardView({ scale: this.scale, cssWidth: this.width, cssHeight: this.height });
			},
			onDragStart: (target) => this.beginDrag(target),
			onDragMove: (_target, point) => {
				if (!this.dragging) return;
				this.dragPoint = point;
				this.sender.move(point);
				this.pendingHover = true;
				this.scheduler.invalidate();
			},
			onDragEnd: (_target, point) => this.finishDrag(point),
			onCancel: () => this.cancelDrag(),
			onEmptyDoubleTap: () => this.callbacks.onEmptyDoubleTap?.(),
		});
		this.cleanups.push(useBoardStore.subscribe(this.refresh), useSessionStore.subscribe(this.refresh), useAdminCoverageStore.subscribe(this.refresh),
			useRemoteDragStore.subscribe(this.onRemoteDrags));
		this.proposalUnsubscribe = callbacks.proposals?.subscribe(this.refresh);
		this.cleanups.push(() => this.proposalUnsubscribe?.());
		this.cleanups.push(registerBoardCameraFlush(() => this.controller.flushZoom()));
		this.attachInput(app.canvas);
	}

	getSnapshot = () => this.presentation;
	subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
	setCallbacks(callbacks: BoardCallbacks) {
		if (callbacks.proposals !== this.callbacks.proposals) {
			this.proposalUnsubscribe?.();
			this.proposalUnsubscribe = callbacks.proposals?.subscribe(this.refresh);
		}
		if (callbacks.locate && callbacks.locate !== this.callbacks.locate) {
			for (const view of this.readScene().entities) {
				const members = view.kind === "card" ? view.members : [view];
				if (members.some((member) => member.player.id === callbacks.locate?.playerId)) this.lifted.set(view.key, ++this.z);
			}
		}
		this.callbacks = callbacks;
		this.refresh();
	}
	setWorld = (node: Container | null) => { this.world = node; this.scheduler.invalidate(); };
	setPreview = (node: Container | null) => { this.preview = node; this.scheduler.invalidate(); };
	/** 원격 미리보기 노드 등록. 처음 붙을 때는 원본 자리에서 출발해 목표로 미끄러진다. */
	bindRemotePreview(key: string, node: Container) {
		const existing = this.remotePreviews.get(key);
		if (existing?.node === node) return;
		const view = this.allViews().find((v) => v.key === key);
		const parent = view && this.parentOf(view);
		const from = existing ?? (view ? this.point(view, parent) : useRemoteDragStore.getState().drags.get(key)) ?? { x: 0, y: 0 };
		node.position.set(from.x, from.y);
		this.remotePreviews.set(key, { node, x: from.x, y: from.y });
		this.scheduler.invalidate();
	}
	unbindRemotePreview(key: string, node: Container) {
		if (this.remotePreviews.get(key)?.node === node) this.remotePreviews.delete(key);
		this.scheduler.invalidate();
	}
	zIndex(key: string, initial: number) { return this.lifted.get(key) ?? initial; }
	committed = () => { this.skipAnimationPlayer = null; this.scheduler.invalidate(); };

	private readPresentation(): BoardPresentation {
		const bs = useBoardStore.getState();
		const scene = this.readScene();
		const { remote, held } = this.readRemote(scene);
		return { scene, drag: this.dragging, hover: bs.hoverTarget, playerDragging: bs.dragInfo !== null, locate: this.callbacks.locate, remote, remoteHeld: held };
	}
	/** 원격 드래그 → 이 기기 장면의 항목. 장면에 없는 key(상태가 아직 안 맞음)는 그리지 않는다. 내가 끄는 항목은 제외. */
	private readRemote(scene: BoardSnapshot) {
		const drags = useRemoteDragStore.getState().drags;
		const dragKey = this.dragging?.view.key ?? null;
		const cache = this.remoteCache;
		if (cache && cache.drags === drags && cache.scene === scene && cache.dragKey === dragKey) return cache;
		if (drags.size === 0) {
			this.remoteCache = { drags, scene, dragKey, remote: NO_REMOTE, held: NO_REMOTE_HELD };
			return this.remoteCache;
		}
		const views = new Map(this.allViews(scene).map((view) => [view.key, view] as const));
		const remote: RemoteDragView[] = [];
		for (const drag of drags.values()) {
			const view = views.get(drag.key);
			if (view && drag.key !== dragKey) remote.push({ key: drag.key, view, name: drag.name });
		}
		// move·keepalive 는 좌표만 바뀐다 — 좌표는 draw() 가 store 에서 직접 읽어 보간하므로, 항목·이름·뷰가 같으면
		// 이전 배열/Set 을 그대로 써 presentation 을 새로 내지 않는다(BoardScene·카드 전체 리렌더 방지).
		const prev = cache?.remote;
		if (cache && prev && prev.length === remote.length && prev !== NO_REMOTE
			&& prev.every((item, i) => item.key === remote[i].key && item.view === remote[i].view && item.name === remote[i].name)) {
			this.remoteCache = { drags, scene, dragKey, remote: prev, held: cache.held };
			return this.remoteCache;
		}
		this.remoteCache = { drags, scene, dragKey, remote, held: new Set(remote.map((item) => item.key)) };
		return this.remoteCache;
	}
	private readScene() { return this.projection(useBoardStore.getState(), useSessionStore.getState(), this.callbacks.proposals?.getSnapshot(), useAdminCoverageStore.getState()); }

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
			&& next.hover === this.presentation.hover && next.playerDragging === this.presentation.playerDragging && next.locate === this.presentation.locate
			&& next.remote === this.presentation.remote) return;
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
		const dt = this.lastFrame ? Math.min(100, Math.max(0, time - this.lastFrame)) : 16;
		this.lastFrame = time;
		if (this.remotePreviews.size) {
			const drags = useRemoteDragStore.getState().drags;
			const k = 1 - Math.exp(-dt / REMOTE_TAU_MS);
			for (const [key, preview] of this.remotePreviews) {
				const target = drags.get(key);
				if (!target) continue;
				const dx = target.x - preview.x; const dy = target.y - preview.y;
				if (Math.hypot(dx, dy) < 0.5) { preview.x = target.x; preview.y = target.y; }
				else { preview.x += dx * k; preview.y += dy * k; active = true; }
				preview.node.position.set(preview.x, preview.y);
			}
		}
		for (const binding of this.bindings.values()) {
			const animation = binding.animation;
			if (!animation) continue;
			const t = Math.min(1, Math.max(0, (time - animation.started) / 220));
			const ease = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
			binding.node.position.set(animation.from.x + (binding.point.x - animation.from.x) * ease, animation.from.y + (binding.point.y - animation.from.y) * ease);
			if (t === 1) binding.animation = undefined;
			else active = true;
		}
		if (!active) this.lastFrame = 0;
		this.app.render(); this.metrics.frames++;
		return active;
	}

	private allViews(scene = this.presentation.scene): BoardEntity[] {
		return scene.entities.flatMap((e) => e.kind === "card" ? [e, ...e.members] : [e]);
	}
	private find(source: BoardSource, scene = this.presentation.scene) { return this.allViews(scene).find((v) => sourceKey(v.source) === sourceKey(source)); }
	private isValid(source: BoardSource, scene = this.readScene()) {
		const view = this.find(source, scene);
		return !!view && JSON.stringify(view.source) === JSON.stringify(source);
	}
	private isDragValid(scene = this.readScene()) {
		const original = this.dragging?.view;
		if (!original || !this.isValid(original.source, scene)) return false;
		if (original.kind !== "card") return true;
		const latest = this.find(original.source, scene);
		return latest?.kind === "card" && latest.members.length === original.members.length
			&& latest.members.every((member, i) => member.key === original.members[i].key
				&& member.point.x === original.members[i].point.x && member.point.y === original.members[i].point.y);
	}

	private parentOf(view: BoardEntity, scene = this.presentation.scene): CardView | undefined {
		if (view.kind === "card") return undefined;
		return scene.entities.find((e): e is CardView => e.kind === "card" && e.members.some((m) => m.key === view.key));
	}
	/** 소프트락 — 이 항목·부모 카드·(카드면) 멤버 중 하나라도 다른 운영진이 잡고 있으면 그 원격 드래그. */
	private remoteHolder(view: BoardEntity, parent?: CardView): RemoteDrag | undefined {
		const drags = useRemoteDragStore.getState().drags;
		if (drags.size === 0) return undefined;
		const keys = [view.key, ...(parent ? [parent.key] : []), ...(view.kind === "card" ? view.members.map((m) => m.key) : [])];
		for (const key of keys) { const drag = drags.get(key); if (drag) return drag; }
		return undefined;
	}
	/**
	 * 내가 끄는 항목을 상대도 잡았을 때 내가 놓아야 하는가. 늦게 잡은 쪽은 보통 소프트락에 막히므로 겹침은
	 * '거의 동시'이거나 한쪽이 상대 start 를 놓쳤을 때만 생긴다.
	 *  · 상대 start 를 못 받고 move/keepalive 부터 받았다 → 상대가 먼저 잡고 있었다 → 내가 놓는다.
	 *  · 상대가 GRAB_TIE_MS 넘게 늦게 잡았다 → 상대가 놓는다(상대는 내 start 를 놓쳤고, 내 keepalive 를 받으면 위 규칙으로 놓는다).
	 *  · GRAB_TIE_MS 안의 동시 잡기 → 양쪽이 같은 결론을 내도록 연결 id 사전순으로 큰 쪽이 놓는다.
	 */
	private yieldsTo(holder: RemoteDrag, connId: string): boolean {
		if (holder.joinedLate) return true;
		const diff = holder.startedAt - this.dragStartedAt;
		if (diff > GRAB_TIE_MS) return false;
		if (diff < -GRAB_TIE_MS) return true;
		return connId > holder.c;
	}
	/** 원격 드래그 수신 — 다시 그리고, 내가 끄는 항목과 겹친 동시 잡기를 정리한다. */
	private onRemoteDrags = () => {
		if (this.disposed) return;
		const drag = this.dragging;
		const port = useRemoteDragStore.getState().port;
		if (drag && port && this.sender.active) {
			const holder = this.remoteHolder(drag.view, this.parentOf(drag.view));
			if (holder?.phase === "live" && holder.c !== port.connId && this.yieldsTo(holder, port.connId)) {
				this.controller.cancel();
				toast(`${holder.name || "다른 운영진"}님이 잡고 있어요`);
			}
		}
		this.refresh();
		this.scheduler.invalidate();
	};

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
			key: view.key, source: view.source, point: this.point(view, parent), draggable: view.draggable && !this.remoteHolder(view, parent),
			onTap: () => invoke(() => {
				if (view.cockPending) this.callbacks.onCockCheck(view.player.id);
				else if (view.source.kind === "free") this.callbacks.onMagnetClick(view.player.id);
			}),
			onDoubleTap: () => invoke(() => {
				navigator.vibrate?.(30);
				const bs = useBoardStore.getState(); const source = view.source;
				if (this.callbacks.proposals?.getSnapshot().enabled) {
					if (source.kind === "proposal-member") this.callbacks.proposals.removeMember(source.playerId);
					return;
				}
				if (source.kind === "proposal-member") {
					this.callbacks.proposals?.removeSubmittedMember(source.groupId, source.playerId); return;
				}
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
			const controlPaddingY = view.source.kind === "proposal" ? 6 : 0;
			const inControl = (rect: typeof controls.main | null) => rect !== null
				&& x >= rect.x && x <= rect.x + rect.width && y >= rect.y - controlPaddingY && y <= rect.y + rect.height + controlPaddingY;
			if (view.source.kind === "proposal") {
				const id = view.source.groupId;
				const action = inControl(controls.unconfirm) ? "remove" : inControl(controls.main) ? "submit" : null;
				if (action) return { key: `${view.key}:${action}`, point: center, draggable: false, onTap: () => {
					if (!this.isValid(view.source)) return;
					if (action === "remove") this.callbacks.proposals?.removeGroup(id);
					else if (view.appearance.ctaEnabled) this.callbacks.proposals?.submit(id);
				} };
			}
			if (view.source.kind === "team" && inControl(controls.unconfirm)) {
				const id = view.source.teamId;
				return button("dismiss", () => useBoardStore.getState().dismissTeam(id));
			}
			if (view.source.kind === "court" && view.appearance.showUnconfirm && inControl(controls.unconfirm)) {
				const id = view.source.courtId; return button("cancel-roster", () => useBoardStore.getState().cancelMatchEdit(id));
			}
			if (view.source.kind !== "proposal" && inControl(controls.main)) {
				if (view.source.kind === "court") {
					const id = view.source.courtId;
					const editing = view.appearance.showUnconfirm;
					return button(editing ? "apply-roster" : "complete", () => {
						if (!view.appearance.ctaEnabled) return;
						const board = useBoardStore.getState();
						if (editing) void board.applyMatchEdit(id);
						else void board.completeMatch(id);
					});
				}
				const id = view.source.teamId;
				if (view.appearance.ctaEnabled) return button("cta", () => {
					if (view.members.length < 4) useBoardStore.getState().autoFillTeam(id);
					else void useBoardStore.getState().startMatch(id);
				});
			}
			if (!view.appearance.dashed || view.members.some((member) => member.draggable))
				for (const member of [...view.members].reverse()) if (inside(this.point(member, view), MAGNET_HIT_R)) return this.magnetTarget(member, view);
			if (view.source.kind === "team") {
				const id = view.source.teamId;
				for (const slot of view.emptySlots) {
					const offset = computeSlotOffset(slot);
					if (inside({ x: center.x + offset.x, y: center.y + offset.y }, EMPTY_SLOT_R)) return button(`slot${slot}`, () => this.callbacks.onSlotClick(id));
				}
			}
			if (x >= -TEAM_W / 2 && x <= TEAM_W / 2 && y >= -TEAM_BOX_ABOVE && y <= TEAM_BOX_BELOW) return { key: view.key, source: view.source, point: center, draggable: view.draggable && !this.remoteHolder(view) };
		}
		return null;
	}

	private beginDrag(target: BoardInteractionTarget) {
		if (!target.source || !this.isValid(target.source)) return;
		const view = this.find(target.source);
		if (!view?.draggable) return;
		const parent = this.parentOf(view);
		if (this.remoteHolder(view, parent)) return; // 다른 운영진이 잡고 있다(소프트락)
		this.committing = true;
		this.dragging = { view, point: target.point };
		this.dragPoint = target.point;
		setLocalDragActive(true);
		// 개인 제안 작성(제안 카드·멤버, 작성 모드의 자유 자석)은 공유 보드 편집이 아니라 보내지 않는다.
		const privateDrag = view.source.kind === "proposal" || view.source.kind === "proposal-member" || !!this.callbacks.proposals?.getSnapshot().enabled;
		if (!privateDrag) { this.dragStartedAt = Date.now(); this.sender.start(view.key, target.point); }
		this.lifted.set(parent?.key ?? view.key, ++this.z);
		const binding = this.bindings.get(view.key); if (binding) binding.animation = undefined;
		const bs = useBoardStore.getState();
		if (view.kind === "card") { if (view.source.kind !== "proposal") bs.markManualLayout(); }
		else bs.setDragInfo({ playerId: view.player.id, detachable: !this.callbacks.proposals?.getSnapshot().enabled && (view.source.kind === "anchor" || view.source.kind === "proposal-member" || view.ghost), restable: useSessionStore.getState().isEditor && !view.ghost && view.source.kind !== "playing" && view.source.kind !== "roster" && view.source.kind !== "proposal-member" });
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
			if (source.kind === "proposal") this.callbacks.proposals?.move(source.groupId, point);
			else if (source.kind === "team") { bs.setTeamAnchor(source.teamId, point.x, point.y); bs.settleBoard({ teamId: source.teamId }); }
			else if (source.kind === "court") { bs.setCourtAnchor(source.courtId, point.x, point.y); bs.settleBoard({ courtId: source.courtId }); }
			else {
				this.skipAnimationPlayer = source.playerId;
				const court = useSessionStore.getState().isEditor && source.kind !== "proposal-member" ? this.rosterTarget(point) : undefined;
				if (court?.source.kind === "court") {
					bs.stageMatchPlayer(court.source.courtId, slotIndexAt(point, this.point(court)), source.playerId);
				} else if (source.kind === "roster") { /* A staged player stays in this preview until save/cancel. */ }
				else if (this.callbacks.proposals?.dropSubmitted(source.playerId, point, source.kind === "proposal-member" ? source.groupId : undefined)) { /* Private roster update owns this drop. */ }
				else if (this.callbacks.proposals?.getSnapshot().enabled) {
					// Shared team/court slots are not blank space for a new private proposal.
					const overSharedGroup = this.readScene().entities.some((view) => view.kind === "card"
						&& view.source.kind !== "proposal" && isInsideTeamBounds(point, this.point(view)));
					if (!overSharedGroup) this.callbacks.proposals.drop(source.playerId, point);
				}
				else if (source.kind === "proposal-member") { /* Composer was disabled while dragging. */ }
				else if (source.kind === "playing") bs.handlePlayingMagnetDrop(source.playerId, point);
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
			this.sender.end(point);
			setLocalDragActive(false); // 드롭 결과가 store 에 반영된 뒤 — 보류한 원격 적용이 이 드롭을 덮지 않는다
			this.committing = false; this.publish();
		}
	}

	private cancelDrag() {
		if (this.dragging) this.restoreSource(this.dragging.view.key);
		this.committing = true; this.dragging = null; this.dragPoint = null; this.pendingHover = false;
		this.sender.cancel();
		setLocalDragActive(false);
		useBoardStore.getState().clearDrag(); useBoardStore.getState().setRestFieldHot(false);
		this.scale = this.lastStoreScale = useBoardStore.getState().scale;
		this.scheduler.invalidate();
		this.committing = false;
		if (!this.disposed) this.publish();
	}

	private restoreSource(key: string) {
		const latest = this.allViews(this.readScene()).find((v) => v.key === key);
		const binding = this.bindings.get(key);
		if (latest && binding) {
			binding.animation = undefined; binding.point = latest.point;
			binding.node.position.set(latest.point.x, latest.point.y);
		}
	}

	private updateHover(source: BoardSource, point: StagePoint) {
		const ss = useSessionStore.getState();
		if (ss.isEditor && "playerId" in source && source.kind !== "proposal-member") {
			const court = this.rosterTarget(point);
			if (court?.source.kind === "court") {
				const board = useBoardStore.getState();
				const slot = slotIndexAt(point, this.point(court));
				board.setRestFieldHot(false); board.setDetachHot(false);
				board.setHoverTarget(slot >= 0 && court.appearance.ctaEnabled && canUseMatchPlayer(source.playerId, court.source.courtId, ss, board.matchEdits ?? new Map())
					? { kind: "slot", teamId: court.key, slotIndex: slot } : null);
				return;
			}
			if (source.kind === "roster") { useBoardStore.getState().setHoverTarget(null); return; }
		}
		const proposals = this.callbacks.proposals?.getSnapshot();
		if (proposals?.enabled) {
			if (!("playerId" in source)) return;
			const bs = useBoardStore.getState();
			if ((source.kind !== "free" && source.kind !== "proposal-member")
				|| ss.restingIds.includes(source.playerId)
				|| (ss.cockCheckEnabled && !ss.sessionPlayers.get(source.playerId)?.cockChecked)
				|| this.presentation.scene.entities.some((view) => view.kind === "card"
					&& view.source.kind !== "proposal" && isInsideTeamBounds(point, this.point(view)))) {
				bs.setHoverTarget(null); return;
			}
			const group = [...proposals.groups].reverse().find((item) => isInsideTeamBounds(point, item.anchor));
			if (group) {
				bs.setHoverTarget(group.playerIds.length < 4 && !proposals.sendingIds.has(group.id)
					? { kind: "slot", teamId: group.id, slotIndex: group.playerIds.length } : null);
				return;
			}
			const selected = new Set(proposals.groups.flatMap((item) => item.playerIds));
			const candidates = new Map(this.presentation.scene.entities.flatMap((view) => view.kind === "magnet"
				&& view.source.kind === "free" && !view.cockPending && !view.resting && !selected.has(view.player.id)
				? [[view.player.id, { playerId: view.player.id, ...view.point, teamId: null }] as const] : []));
			const partner = nearestFreePartner(source.playerId, point, candidates, new Set(), new Set(), new Set(),
				selected.has(source.playerId) ? PAIR_RADIUS_DETACH : PAIR_RADIUS);
			bs.setHoverTarget(partner ? { kind: "magnet", id: partner.id } : null);
			return;
		}
		if (proposals?.isAdmin && ss.isEditor && "playerId" in source) {
			const group = [...proposals.proposals].reverse().find((item) => {
				const anchor = proposals.anchors.get(item.id);
				return anchor && isInsideTeamBounds(point, anchor);
			});
			if (group) {
				const slot = slotIndexAt(point, proposals.anchors.get(group.id)!);
				const eligible = source.kind === "proposal-member" || (source.kind === "free"
					&& !ss.restingIds.includes(source.playerId) && (!ss.cockCheckEnabled || ss.sessionPlayers.get(source.playerId)?.cockChecked));
				useBoardStore.getState().setHoverTarget(eligible && slot >= 0 && !proposals.resolvingIds.has(group.id)
					? { kind: "slot", teamId: group.id, slotIndex: slot } : null);
				return;
			}
		}
		if (source.kind === "proposal-member") { useBoardStore.getState().setHoverTarget(null); return; }
		if (source.kind === "proposal") {
			const bs = useBoardStore.getState();
			const target = proposals?.isAdmin && ss.isEditor
				? [...bs.drafts.values()].reverse().find(team => team.courtId != null
					&& !ss.courts.some(court => court.id === team.courtId && court.match)
					&& !bs.assigningTeamIds.has(team.id) && isInsideTeamBounds(point, team.anchor)) : undefined;
			bs.setHoverTarget(target ? { kind: "slot", teamId: target.id, slotIndex: -1 } : null);
			return;
		}
		if (!ss.isEditor || source.kind === "team" || source.kind === "court" || source.kind === "playing") return;
		const bs = useBoardStore.getState();
		const rest = isInRestField(point, this.height / this.scale);
		const detach = !rest && (source.kind === "anchor" || source.kind === "ghost") && isInDetachZone(point);
		bs.setRestFieldHot(rest); bs.setDetachHot(detach);
		if (rest || detach) { bs.setHoverTarget(null); return; }
		if ([...bs.drafts.values()].some(team => team.courtId != null
			&& ss.courts.some(court => court.id === team.courtId && court.match) && isInsideTeamBounds(point, team.anchor))) {
			bs.setHoverTarget(null); return;
		}
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

	private rosterTarget(point: StagePoint) {
		return [...this.readScene().entities].reverse().find((view): view is CardView => view.kind === "card"
			&& view.source.kind === "court" && isInsideTeamBounds(point, this.point(view)));
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
		if (this.dragging) setLocalDragActive(false);
		this.sender.cancel();
		for (const cleanup of this.cleanups) cleanup();
		this.controller.dispose(); this.scheduler.dispose();
		this.bindings.clear(); this.remotePreviews.clear(); this.listeners.clear();
	}
}
