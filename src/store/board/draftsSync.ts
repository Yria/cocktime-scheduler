import type { BoardDraftsPayload, DraftTeam, Reservation } from "../../types/board";
import { teamMembers } from "../../lib/board/membership";
import { dbBoardSaveDrafts, dbLoadSessionState } from "../../lib/supabase";
import { draftsFingerprint, mergeDrafts } from "../../lib/board/mergeDrafts";
import { isLocalDragActive, waitForLocalDragEnd } from "./localDrag";
import { useSessionStore } from "../sessionStore";
import { useAppStore } from "../appStore";
import { toast } from "../toastStore";
import { serializeBoardLayout } from "../../lib/board/savedLayout";
import type { BoardState } from "./types";

/** draft 팀 createdBy 스탬프용 — 현재 편집자 표시 이름(sessionStore._myName). 미설정 시 폴백. */
export function currentEditorName(): string {
	return useSessionStore.getState()._myName ?? "익명";
}

// ── 보드 멤버십 공유(drafts/reservations) ────────────────────
// applyRemoteDrafts(matchSlice)와 boardStore.ts의 subscribe가 함께 읽고 쓰는 모듈 상태.
// ES 모듈 간에는 let 재대입이 공유되지 않으므로 객체 프로퍼티로 둔다.
export const syncState = {
	/** 원격 멤버십 적용 중에는 자체 브로드캐스트/저장을 막기 위한 플래그. */
	applyingRemoteDrafts: false,
	/** 마지막으로 동기화한 명단·배치 JSON. 동일 상태의 재저장을 막는다. */
	lastSyncedDraftsJson: "",
	exclusiveDraftEdit: false,
	/** 동시 편집에서 로컬 지식 의존 자동 정제 중 — 화면만 바꾸고 저장하지 않는다(refineLocally). */
	localRefine: false,
};

/**
 * 로컬 지식(이 기기의 자석·코트 상태)에 기대는 자동 정제(heal)를 실행한다.
 * 단일 편집자 모드에서는 그대로 실행해 결과가 평소처럼 저장된다. 동시 편집(multiEditor)에서는 화면만
 * 정제하고 저장하지 않는다 — 선수 합류·경기 완료 이벤트를 늦게 받은 운영진 기기가 남의 정상 배치를
 * 서버에서 지우는 것을 막는다. 사용자가 직접 한 편집만 저장된다.
 */
export function refineLocally(run: () => void) {
	const before = beginRefineFold();
	if (!useSessionStore.getState().multiEditor) {
		run();
		endRefineFold(before);
		return;
	}
	const prev = syncState.localRefine;
	syncState.localRefine = true;
	try {
		run();
	} finally {
		syncState.localRefine = prev;
	}
	endRefineFold(before);
}

/** 명단·예약과 편집자가 확정한 배치를 동일한 버전으로 저장한다. */
export function serializeBoardDrafts(s: {
	drafts: Map<string, DraftTeam>;
	reservations: Map<string, Reservation>;
} & Pick<BoardState, "magnets" | "courtAnchors" | "manualLayout">): BoardDraftsPayload {
	const layout = serializeBoardLayout(s);
	return {
		...(layout ? { layout } : {}),
		teams: [...s.drafts.values()].map((t) => {
			const memberIds = new Set(teamMembers(t.id, s.drafts, s.reservations).map((m) => m.playerId));
			// 슬롯은 현재 멤버(anchor+ghost) 것만 동기화 — 취소된 예약 등 스테일 키 제거.
			let slots: Record<string, number> | undefined;
			if (t.slots && Object.keys(t.slots).length) {
				const entries = Object.entries(t.slots).filter(([pid]) => memberIds.has(pid));
				if (entries.length) slots = Object.fromEntries(entries);
			}
			return {
				id: t.id,
				...(t.courtId != null ? { courtId: t.courtId } : {}),
				memberIds: [...t.anchorMemberIds],
				createdMs: t.createdAt,
				...(slots ? { slots } : {}),
				...(t.createdBy ? { createdBy: t.createdBy } : {}),
				...(t.confirmedMs != null ? { confirmedMs: t.confirmedMs } : {}),
				...(t.waitForCompletion && t.courtId == null && memberIds.size >= 2 && memberIds.size < 4 ? { waitForCompletion: true } : {}),
			};
		}),
		reservations: [...s.reservations.values()].filter((r) => s.drafts.has(r.teamId)).map((r) => ({
			id: r.id,
			playerId: r.playerId,
			teamId: r.teamId,
			createdMs: r.createdAt,
		})),
	};
}

/**
 * 편집 가능하면 true(= 내가 편집자). 자유(lockFree) 상태여도 드래그로 암묵 점유하지 않는다 — 편집권은
 * 오직 '편집 권한 가져오기' 버튼(자유면 다이얼로그 없이 즉시)이나 진입 1회 auto-claim(opener)으로만 획득한다.
 * 이래야 편집자가 나가 락이 free가 돼도 관전자가 드래그만으로 편집자가 되지 않는다.
 */
export function claimEdit(): boolean {
	return useSessionStore.getState().isEditor && !syncState.exclusiveDraftEdit;
}

// 요청 시점의 세션/편집자를 보관한다. 화면 이탈로 _clientId가 지워져도 마지막 드롭을 저장하며,
// 다른 세션으로 이동한 뒤 도착한 응답은 새 세션의 명단이나 버전을 건드리지 않는다.
// multi: 동시 편집 모드에서 넣은 요청 — payload 는 '이 기기 로컬 투영(mine)'이고 실제 전송값은 drain 시 base 와 머지해 만든다.
type DraftSave = {
	sessionId: number; clientId: string; name: string; payload: BoardDraftsPayload; base: number;
	multi?: boolean; retries?: number;
};
const pendingSaves: DraftSave[] = [];
let inFlight: DraftSave | null = null;
let savePromise: Promise<void> | null = null;
const sameScope = (a: DraftSave, b: DraftSave) => a.sessionId === b.sessionId && a.clientId === b.clientId;
export function hasPendingDraftSave() {
	const sessionId = useAppStore.getState().sessionMeta?.sessionId;
	return inFlight?.sessionId === sessionId || pendingSaves.some(request => request.sessionId === sessionId)
		|| debounced?.request.sessionId === sessionId;
}

// ── 동시 편집(multiEditor) 전용: 3-way 머지 기준(base)·rebase-retry·디바운스·계측 ─────────
/**
 * 머지 기준 — 서버 버전 version 을 이 기기에 적용한 직후의 상태.
 *  · projection: 적용 직후 로컬 serialize 결과(이 기기 자석·코트 지식으로 reconcile 된 모습).
 *  · raw: 그 버전의 서버 payload 원본.
 * 저장 시 mergeDrafts(projection, 지금 로컬, raw)로 '내가 실제로 바꾼 것'만 원본 위에 얹는다. 로컬 정제(늦게 받은
 * 선수·코트 때문에 화면에서만 빠진 배치)는 projection 과 같아 '내 변경'이 아니므로 서버 원본을 지우지 않는다.
 * 갱신 지점: applyRemoteDrafts(payload, version) 내부 한 곳 + 저장 성공.
 */
export type DraftsBase = { sessionId: number; version: number; projection: BoardDraftsPayload; raw: BoardDraftsPayload };
let draftsBase: DraftsBase | null = null;

export function setDraftsBase(sessionId: number, version: number, projection: BoardDraftsPayload, raw: BoardDraftsPayload) {
	draftsBase = { sessionId, version, projection, raw };
}
/** 해당 세션의 머지 기준(다른 세션 것이면 null). */
export function getDraftsBase(sessionId: number | undefined): DraftsBase | null {
	return draftsBase && draftsBase.sessionId === sessionId ? draftsBase : null;
}
export function clearDraftsBase() { draftsBase = null; }

/**
 * 로컬 정제를 머지 기준(projection)에 접어 넣는다 — 정제는 저장하지 않을 뿐 아니라 '내 변경'으로도 세지 않아야 한다.
 * 안 접으면 정제 결과가 화면에 남아 다음 사용자 편집 저장의 mine 에 섞이고, mergeDrafts 가 그걸 내 변경으로 보아
 * 남의 정상 배치(예: 다른 운영진이 옮긴 선수)를 서버에서 지운다. 정제 전후 로컬 차이를 projection 위에 같은
 * 3-way 규칙으로 얹는다(before→after 가 바꾼 배치만 반영, 나머지 projection 유지).
 * OFF 에서도 접는다 — base 는 OFF 에서 쓰이지 않고, 관전 중(OFF) 정제가 ON 전환 뒤 새는 것을 막는다.
 */
function beginRefineFold(): { base: DraftsBase; before: BoardDraftsPayload } | null {
	const base = getDraftsBase(useAppStore.getState().sessionMeta?.sessionId);
	return base && bridge ? { base, before: bridge.serialize() } : null;
}
function endRefineFold(start: { base: DraftsBase; before: BoardDraftsPayload } | null) {
	if (!start || !bridge || draftsBase !== start.base) return; // 정제 중 기준이 바뀌었으면(원격 적용) 그 기준이 이미 최신
	const after = bridge.serialize();
	if (draftsFingerprint(after) === draftsFingerprint(start.before)) return;
	const { base } = start;
	draftsBase = { ...base, projection: mergeDrafts(start.before, after, base.projection).payload };
}

/**
 * draftsSync 가 보드 store 를 직접 import 하면 순환 참조가 된다(boardStore → draftsSync). boardStore 가 시작 시 등록한다.
 *  · serialize: 지금 로컬 보드(mine)
 *  · project: 서버 payload 를 이 기기에 적용했을 때의 투영(부수효과 없음)
 *  · apply: 로컬에 payload 를 적용하고 base 를 version/기준값으로 갱신(applyRemoteDrafts)
 */
export type BoardBridge = {
	serialize: () => BoardDraftsPayload;
	project: (payload: BoardDraftsPayload) => BoardDraftsPayload;
	apply: (payload: BoardDraftsPayload, version: number, base?: { projection: BoardDraftsPayload; raw: BoardDraftsPayload }) => void;
};
let bridge: BoardBridge | null = null;
export function registerBoardBridge(next: BoardBridge) { bridge = next; }

/** 동시 편집 저장 계측 — 충돌·재시도·폴백 빈도를 보고 리더 선출/op-RPC 필요성을 판단한다. */
export const multiSaveStats = { saves: 0, skipped: 0, conflicts: 0, rebased: 0, fallbacks: 0, modeSwitches: 0 };
function track(kind: keyof typeof multiSaveStats, detail?: Record<string, unknown>) {
	multiSaveStats[kind]++;
	console.info(`[board-multi] ${kind}`, { ...multiSaveStats, ...detail });
}

/** 동시 편집에서 연속 드롭을 한 번의 CAS 로 묶는 디바운스(ms). 기존 큐 coalescing 위에 얹는다. */
export const MULTI_SAVE_DEBOUNCE_MS = 300;
/** rebase-retry 최대 횟수. 넘으면 기존 경로(force resync + 토스트). */
export const MULTI_REBASE_MAX = 3;
let debounced: { request: DraftSave; timer: ReturnType<typeof setTimeout> } | null = null;

function enqueue(request: DraftSave) {
	const pending = pendingSaves.find(item => sameScope(item, request));
	if (pending) {
		pending.payload = request.payload;
		if (request.multi) pending.multi = true;
	} else pendingSaves.push(request);
	if (!savePromise) startSaving();
}
function releaseDebounced() {
	if (!debounced) return;
	clearTimeout(debounced.timer);
	const { request } = debounced;
	debounced = null;
	// 기다리는 사이 동시 편집이 꺼졌으면 저장하지 않고 버린다(D8: 모드 전환 처리 후 조용히 중단).
	// 단일 편집자 저장으로 바꿔 보내면 머지 안 된 로컬(mine)이 남의 새 버전을 덮고, editor_* 가 비어 있어
	// 서버 OFF 경로가 이 기기에 편집권까지 넘긴다('편집 권한 가져오기'를 누르지 않았는데도).
	if (request.multi && !useSessionStore.getState().multiEditor) {
		if (isStillHere(request)) void switchedOff(request);
		else if (!savePromise) notifyIdle();
		return;
	}
	enqueue(request);
}

// 저장 큐가 비었을 때 알림 — 동시 편집에서 저장 중 보류했던 원격 적용을 다시 시도한다(useSessionBoardEffects).
const idleListeners = new Set<() => void>();
export function subscribeDraftSaveIdle(listener: () => void): () => void {
	idleListeners.add(listener);
	return () => { idleListeners.delete(listener); };
}
function notifyIdle() {
	for (const listener of [...idleListeners]) listener();
}

/** 제안 승인 RPC는 앞서 수정한 명단의 저장이 끝난 버전에서만 실행한다. */
export async function flushBoardDrafts(): Promise<void> {
	releaseDebounced();
	while (savePromise) await savePromise;
}

/** CAS 실패의 기존 처리 — 같은 범위 큐를 버리고 서버 최신으로 강제 동기화한다. */
async function fallbackResync(request: DraftSave, stillHere: boolean) {
	for (let i = pendingSaves.length - 1; i >= 0; i--) if (sameScope(pendingSaves[i], request)) pendingSaves.splice(i, 1);
	if (!stillHere) return;
	const session = useSessionStore.getState();
	// 동시 편집: 같은 버전의 강제 원복도 다시 그리도록 기준을 비운다(이펙트는 '기준보다 새 버전'만 재적용).
	if (request.multi) clearDraftsBase();
	await session.resyncFromServer({ force: true });
	toast("보드 변경을 저장하지 못해 서버의 최신 상태로 동기화했어요", { variant: "error" });
}

/** 동시 편집이 꺼진 것을 저장 실패로 알았을 때 — 같은 범위 큐를 버리고 토스트 없이 서버 상태로 수렴한다. */
async function switchedOff(request: DraftSave) {
	track("modeSwitches");
	for (let i = pendingSaves.length - 1; i >= 0; i--) if (sameScope(pendingSaves[i], request)) pendingSaves.splice(i, 1);
	clearDraftsBase();
	await useSessionStore.getState().resyncFromServer({ force: true });
}

function isStillHere(request: DraftSave) {
	const session = useSessionStore.getState();
	return useAppStore.getState().sessionMeta?.sessionId === request.sessionId
		&& (session._clientId === request.clientId || session._clientId == null);
}

/**
 * 서버에 있는 값(server — 방금 저장한 머지 결과, 또는 저장 생략 시 서버 원본)이 화면(mine)과 다르면 화면을 맞춘다.
 * 정원 초과로 밀려난 선수·칸 충돌·서버에만 있던 배치 때문에 다를 수 있고, 그대로 두면 다음 서버 버전까지 화면과
 * 서버가 어긋난다(경기 시작이 다른 로스터로 나간다). 그 사이 로컬이 더 바뀌었거나 드래그·대기 저장이 있으면
 * 건드리지 않는다 — 다음 저장의 머지가 서버 값을 유지한다.
 */
function convergeLocal(request: DraftSave, server: BoardDraftsPayload, version: number) {
	if (!bridge || isLocalDragActive()) return;
	// 서버 값 자체가 아니라 '이 기기에 적용했을 때의 모습'과 비교한다 — 자석이 아직 없는 선수 등 로컬 지식 차이는 어긋남이 아니다.
	const projection = bridge.project(server);
	if (draftsFingerprint(projection) === draftsFingerprint(request.payload)) return;
	if (pendingSaves.some(pending => sameScope(pending, request)) || (debounced && sameScope(debounced.request, request))) return;
	if (draftsFingerprint(bridge.serialize()) !== draftsFingerprint(request.payload)) return;
	bridge.apply(server, version, { projection, raw: server });
}

/**
 * 동시 편집 저장 1건 — base 와 머지한 값을 CAS 로 저장하고, 충돌이면 rebase 후 재시도한다.
 * 실패 판정: board_save_drafts 는 권한·CAS 실패 모두 null 이라 스냅샷으로 원인을 가린다.
 *  ① 플래그가 꺼졌으면 → 모드 전환(조용히 서버 상태로)  ② 서버 버전이 그대로면 → CAS 원인 아님, 기존 폴백
 *  ③ 그 외 → await 이후 로컬(mine)을 다시 읽어 머지·적용하고 큐 맨 앞에 다시 넣는다(최대 3회).
 */
async function saveMulti(request: DraftSave) {
	const base = getDraftsBase(request.sessionId);
	let send = request.payload;
	if (base) {
		const merged = mergeDrafts(base.projection, request.payload, base.raw);
		if (!merged.changed) { // 서버 원본과 같다 — 저장할 것이 없다
			track("skipped");
			if (isStillHere(request)) convergeLocal(request, merged.payload, base.version);
			return;
		}
		send = merged.payload;
		request.base = base.version;
	}
	const version = await dbBoardSaveDrafts(request.sessionId, request.clientId, request.name, send, request.base).catch(() => null);
	const stillHere = isStillHere(request);
	const session = useSessionStore.getState();
	if (version != null) {
		track("saves");
		for (const pending of pendingSaves) if (sameScope(pending, request)) pending.base = version;
		// 기준을 먼저 옮긴다 — 이어지는 applyDraftsIfNewer 가 이펙트를 깨워도 같은 버전이라 재적용하지 않는다.
		setDraftsBase(request.sessionId, version, request.payload, send);
		if (stillHere) convergeLocal(request, send, version);
		if (stillHere) session.applyDraftsIfNewer(send, version);
		return;
	}
	if (!stillHere || !base) { await fallbackResync(request, stillHere); return; }
	const snap = await dbLoadSessionState(request.sessionId).catch(() => null);
	if (!isStillHere(request)) { await fallbackResync(request, false); return; }
	if (!snap) { track("fallbacks", { reason: "no-snapshot" }); await fallbackResync(request, true); return; }
	if (snap.multiEditor !== true) {
		// 동시 편집이 꺼졌다 — 기존 단일 편집자 규칙으로 돌아가므로 조용히 서버 상태를 받는다(폴백 토스트 없음).
		await switchedOff(request);
		return;
	}
	if (snap.version === request.base) { track("fallbacks", { reason: "not-cas" }); await fallbackResync(request, true); return; }
	const retries = (request.retries ?? 0) + 1;
	if (retries > MULTI_REBASE_MAX || !bridge) { track("fallbacks", { reason: "retries" }); await fallbackResync(request, true); return; }
	track("conflicts", { base: request.base, theirs: snap.version, retries });
	// 로컬 드래그 중이면 적용을 드롭/취소 뒤로 미룬다(드래그 중 적용하면 드래그가 취소된다).
	await waitForLocalDragEnd();
	if (!isStillHere(request)) { await fallbackResync(request, false); return; }
	if (!useSessionStore.getState().multiEditor) { await switchedOff(request); return; } // 기다리는 사이 꺼졌다
	// ── 여기부터 동기 구간: await 동안의 드롭까지 포함한 지금 로컬을 mine 으로 다시 읽는다.
	const mine = bridge.serialize();
	const theirs = snap.drafts;
	const merged = mergeDrafts(base.projection, mine, theirs);
	const projection = bridge.project(theirs);
	// sessionStore 에는 theirs/버전을 넣고(늦게 온 행 이벤트가 머지 위에 theirs 를 다시 덮지 않게),
	// 로컬 화면에는 머지 결과를 그리되 기준은 theirs 로 둔다 — 이펙트는 기준보다 새 버전만 재적용한다.
	bridge.apply(merged.payload, snap.version, { projection, raw: theirs });
	useSessionStore.getState().applyDraftsIfNewer(theirs, snap.version);
	// 큐·디바운스에 남은 같은 범위 요청은 머지 전 로컬 스냅샷이라 버린다(mine 을 await 이후에 다시 읽었으므로 포함됨).
	for (let i = pendingSaves.length - 1; i >= 0; i--) if (sameScope(pendingSaves[i], request)) pendingSaves.splice(i, 1);
	if (debounced && sameScope(debounced.request, request)) { clearTimeout(debounced.timer); debounced = null; }
	track("rebased", { changed: merged.changed });
	// 머지 결과가 theirs 와 같으면 저장 생략(drain 의 머지에서 changed=false 로 걸러진다).
	pendingSaves.unshift({ ...request, payload: bridge.serialize(), base: snap.version, retries });
}

async function drainSaves() {
	while (pendingSaves.length) {
		const request = pendingSaves.shift()!;
		inFlight = request;
		if (request.multi) {
			await saveMulti(request);
			inFlight = null;
			continue;
		}
		const version = await dbBoardSaveDrafts(request.sessionId, request.clientId, request.name, request.payload, request.base).catch(() => null);
		const session = useSessionStore.getState();
		const stillHere = useAppStore.getState().sessionMeta?.sessionId === request.sessionId
			&& (session._clientId === request.clientId || session._clientId == null);
		if (version == null) {
			for (let i = pendingSaves.length - 1; i >= 0; i--) if (sameScope(pendingSaves[i], request)) pendingSaves.splice(i, 1);
			if (stillHere) {
				await session.resyncFromServer({ force: true });
				toast("보드 변경을 저장하지 못해 서버의 최신 상태로 동기화했어요", { variant: "error" });
			}
		} else {
			for (const pending of pendingSaves) if (sameScope(pending, request)) pending.base = version;
			if (stillHere) session.applyDraftsIfNewer(request.payload, version);
		}
		inFlight = null;
	}
}

function startSaving() {
	savePromise = drainSaves().finally(() => {
		inFlight = null;
		savePromise = null;
		if (pendingSaves.length) startSaving();
		else if (!debounced) notifyIdle();
	});
}

/** 명단·배치를 기존 board_save_drafts CAS로 저장. 연속 드롭은 진행 중인 요청 뒤에 최신 상태만 큐잉한다. */
export function pushDraftsToRemote(payload: BoardDraftsPayload) {
	const ss = useSessionStore.getState();
	if (!ss.isEditor) return; // 보기 전용은 보드 드래프트를 공유하지 않음
	const sessionId = useAppStore.getState().sessionMeta?.sessionId;
	const clientId = ss._clientId;
	if (!sessionId || !clientId) return;
	if (ss.multiEditor) {
		// 동시 편집: 기준 버전은 '로컬이 반영한 서버 버전' — 화면에 아직 안 그린 새 버전 위에 덮어쓰지 않는다.
		const base = getDraftsBase(sessionId)?.version ?? ss.boardDraftsVersion;
		const request: DraftSave = { sessionId, clientId, name: ss._myName ?? "기기", payload, base, multi: true };
		const queued = pendingSaves.find(item => sameScope(item, request));
		if (queued) { queued.payload = payload; queued.multi = true; return; }
		if (debounced && sameScope(debounced.request, request)) {
			// trailing 디바운스 — 연속 드롭은 마지막 상태 1건으로.
			debounced.request.payload = payload;
			clearTimeout(debounced.timer);
			debounced.timer = setTimeout(releaseDebounced, MULTI_SAVE_DEBOUNCE_MS);
		} else {
			releaseDebounced();
			debounced = { request, timer: setTimeout(releaseDebounced, MULTI_SAVE_DEBOUNCE_MS) };
		}
		return;
	}
	const request: DraftSave = { sessionId, clientId, name: ss._myName ?? "기기", payload, base: ss.boardDraftsVersion };
	const pending = pendingSaves.find(item => sameScope(item, request));
	if (pending) pending.payload = payload;
	else pendingSaves.push(request);
	if (!savePromise) startSaving();
}
