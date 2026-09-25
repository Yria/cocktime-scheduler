import type { BoardDraftsPayload, DraftTeam, Reservation } from "../../types/board";
import { teamMembers } from "../../lib/board/membership";
import { dbBoardSaveDrafts } from "../../lib/supabase";
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
};

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
type DraftSave = { sessionId: number; clientId: string; name: string; payload: BoardDraftsPayload; base: number };
const pendingSaves: DraftSave[] = [];
let inFlight: DraftSave | null = null;
let savePromise: Promise<void> | null = null;
const sameScope = (a: DraftSave, b: DraftSave) => a.sessionId === b.sessionId && a.clientId === b.clientId;
export function hasPendingDraftSave() {
	const sessionId = useAppStore.getState().sessionMeta?.sessionId;
	return inFlight?.sessionId === sessionId || pendingSaves.some(request => request.sessionId === sessionId);
}

/** 제안 승인 RPC는 앞서 수정한 명단의 저장이 끝난 버전에서만 실행한다. */
export async function flushBoardDrafts(): Promise<void> {
	while (savePromise) await savePromise;
}

async function drainSaves() {
	while (pendingSaves.length) {
		const request = pendingSaves.shift()!;
		inFlight = request;
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
	});
}

/** 명단·배치를 기존 board_save_drafts CAS로 저장. 연속 드롭은 진행 중인 요청 뒤에 최신 상태만 큐잉한다. */
export function pushDraftsToRemote(payload: BoardDraftsPayload) {
	const ss = useSessionStore.getState();
	if (!ss.isEditor) return; // 보기 전용은 보드 드래프트를 공유하지 않음
	const sessionId = useAppStore.getState().sessionMeta?.sessionId;
	const clientId = ss._clientId;
	if (!sessionId || !clientId) return;
	const request: DraftSave = { sessionId, clientId, name: ss._myName ?? "기기", payload, base: ss.boardDraftsVersion };
	const pending = pendingSaves.find(item => sameScope(item, request));
	if (pending) pending.payload = payload;
	else pendingSaves.push(request);
	if (!savePromise) startSaving();
}
