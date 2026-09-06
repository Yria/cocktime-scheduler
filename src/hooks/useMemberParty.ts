import { useEffect, useRef, useState } from "react";
import { selectMemberParty } from "../lib/board/memberParty";
import { randomId } from "../lib/randomId";
import {
	fetchMemberPartyState, setMemberPartyHold, finishMemberParty, type MemberPartyResult, type MemberPartyState,
} from "../lib/supabase/memberParty";
import { useAppStore } from "../store/appStore";
import { useAuthStore } from "../store/authStore";
import { useBoardStore } from "../store/boardStore";
import { useSessionStore } from "../store/sessionStore";

export const PARTY_REASON: Record<string, string> = {
	session_closed: "종료된 세션이에요.",
	admin_available: "운영진이 모두 경기 중일 때 사용할 수 있어요.",
	no_admin: "세션에 참여한 운영진이 있어야 사용할 수 있어요.",
	not_participant: "이 세션에 참여한 회원만 사용할 수 있어요.",
	playing: "경기가 끝나면 참여할 수 있어요.",
	resting: "휴식을 해제한 뒤 참여해 주세요.",
	cock_unchecked: "콕 제출 확인 후 참여할 수 있어요.",
	assigned: "이미 편성되거나 예약된 팀이 있어요.",
	editor: "회원 파티는 읽기 모드에서만 참여할 수 있어요.",
};

export function useMemberParty() {
	const sessionId = useAppStore((s) => s.sessionMeta?.sessionId);
	const isEditor = useSessionStore((s) => s.isEditor);
	const lockSynced = useSessionStore((s) => s.lockSynced);
	const boardClientId = useSessionStore((s) => s._clientId);
	const memberId = useAuthStore((s) => s.memberId);
	const [state, setState] = useState<MemberPartyState | null>(null);
	const [holding, setHolding] = useState(false);
	const [notice, setNotice] = useState<string | null>(null);
	const [result, setResult] = useState<MemberPartyResult | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [remainingMs, setRemainingMs] = useState(0);
	const controls = useRef<{ begin: () => void; end: () => void } | null>(null);
	const scope = `${sessionId}:${memberId}:${isEditor}:${lockSynced}:${boardClientId}`;
	const [previousScope, setPreviousScope] = useState(scope);
	if (previousScope !== scope) {
		setPreviousScope(scope);
		setState(null);
		setHolding(false);
		setNotice(null);
		setResult(null);
		setError(null);
		setRemainingMs(0);
	}

	useEffect(() => {
		if (!sessionId || !memberId || isEditor || !lockSynced || !boardClientId) return;

		// Each mount owns its lease. Serialize mutations so a delayed press cannot
		// arrive after its release, including unmount/blur while the RPC is in flight.
		const clientId = randomId();
		let active = true;
		let pressed = false;
		let pressVersion = 0;
		let busy = false;
		let nextPoll = 0;
		let nextHeartbeat = 0;
		let realtimeSupported = false;
		let realtimeRefreshTimer: ReturnType<typeof setTimeout> | null = null;
		let refreshRequested = false;
		let availabilityVersion = 0;
		let chain: Promise<unknown> = Promise.resolve();
		let current: MemberPartyState | null = null;
		let heldRound: string | null = null;
		let observedRound: string | null = null;
		let resultSeen: string | null = null;
		let clockOffset = 0;
		const mutate = <T,>(operation: () => Promise<T>): Promise<T> => {
			const result = chain.then(operation, operation);
			chain = result.catch(() => undefined);
			return result;
		};
		const release = () => {
			if (!pressed) return;
			pressed = false;
			const version = ++pressVersion;
			const contextVersion = availabilityVersion;
			if (active) {
				setHolding(false);
				setResult(null);
				setNotice("참여 신청을 취소했어요. 다시 꾹 눌러 참여해 주세요.");
			}
			void mutate(() => setMemberPartyHold(sessionId, clientId, false, null, boardClientId))
				.then((value) => { if (active) apply(value, version, contextVersion); })
				.catch(() => { /* A disconnected lease expires on the server. */ });
			nextPoll = 0;
		};
		const apply = (value: MemberPartyState, version: number, contextVersion: number) => {
			if (!active || version !== pressVersion || contextVersion !== availabilityVersion) return;
			current = value;
			if (value.realtimeEnabled !== undefined) realtimeSupported = value.realtimeEnabled;
			clockOffset = Date.parse(value.serverNow) - Date.now();
			setState(value);
			const result = value.lastResult;
			if (result && result.roundId === observedRound && result.roundId !== resultSeen && (!pressed || heldRound === result.roundId)) {
				resultSeen = result.roundId;
				setResult(result);
				pressed = false; // A fresh press is required for every new round.
				setHolding(false);
				setNotice(result.status === "created"
					? result.memberIds?.includes(value.myPlayerId ?? "")
						? "내 파티가 만들어졌어요! 보드에서 확인해 주세요."
						: "4명 파티가 만들어졌어요. 다음 파티에 참여해 보세요."
					: "4명이 모이지 않았거나 참여 조건이 바뀌어 취소됐어요. 다시 눌러 주세요.");
				void useSessionStore.getState().resyncFromServer();
			}
			if (value.roundId) observedRound = value.roundId;
			if (pressed && !heldRound && value.roundId) heldRound = value.roundId;
			if (pressed && (!value.available || !value.eligible)) release();
		};
		const poll = async () => {
			if (!active || busy || document.hidden || !navigator.onLine) return;
			busy = true;
			refreshRequested = false;
			const version = pressVersion;
			const contextVersion = availabilityVersion;
			const wasPressed = pressed;
			const renewHold = wasPressed && (!heldRound || Date.now() >= nextHeartbeat);
			const requestRound = heldRound;
			try {
				const value = renewHold
					? await mutate(() => setMemberPartyHold(sessionId, clientId, pressed && version === pressVersion && !useSessionStore.getState().isEditor, requestRound, boardClientId))
					: await fetchMemberPartyState(sessionId);
				if (!active || version !== pressVersion || contextVersion !== availabilityVersion) return;
				if (renewHold) nextHeartbeat = Date.now() + 1000;
				if (wasPressed && requestRound && value.roundId !== requestRound) {
					// Another device may have finished multiple rounds while this
					// response was delayed. Never turn that old press into a new hold.
					pressed = false;
					setHolding(false);
					setNotice("모집이 끝났어요. 다음 파티는 다시 눌러 참여해 주세요.");
				}
				apply(value, version, contextVersion);
				setError(null);
				if (wasPressed && pressed && value.roundId && value.endsAt && Date.parse(value.endsAt) <= Date.parse(value.serverNow)) {
					if (!value.participants.includes(value.myPlayerId ?? "")) {
						release();
						setNotice("이번 모집이 마감됐어요. 다음 파티에 참여해 주세요.");
						return;
					}
					const board = useBoardStore.getState();
					const session = useSessionStore.getState();
					const ids = selectMemberParty(value.participants, { ...board, ...session }) ?? [];
					const result = await mutate(() => pressed && version === pressVersion && !useSessionStore.getState().isEditor
						? finishMemberParty(sessionId, value.roundId!, ids, session.boardDraftsVersion, boardClientId)
						: Promise.resolve({ status: "pending" as const }));
					if (!active || version !== pressVersion) return;
					if (result.status === "stale") {
						await useSessionStore.getState().resyncFromServer();
					} else if (result.status === "created" || result.status === "cancelled") {
						// Fetch the common result before re-issuing a heartbeat, which
						// otherwise could unintentionally enter the next round.
						pressed = false;
						setHolding(false);
						const finished = await fetchMemberPartyState(sessionId);
						if (active) apply(finished, version, contextVersion);
					}
				}
			} catch {
				if (active && version === pressVersion) {
					release();
					setError("연결을 확인한 뒤 다시 눌러 주세요.");
				}
			} finally {
				busy = false;
				const now = Date.now();
				const realtime = realtimeSupported && useSessionStore.getState().broadcastConnected;
				// Broadcast wakes idle viewers immediately. Periodic reads recover missed messages
				// and expired leases; a timer alone cannot make PostgreSQL emit an expiry event.
				let delay = realtime ? (current?.roundId ? 3000 : 25_000) : (current?.roundId ? 1000 : 3000);
				if (pressed) delay = Math.min(delay, Math.max(0, nextHeartbeat - now));
				const until = current?.endsAt ? Date.parse(current.endsAt) - now - clockOffset : 0;
				if (until > 0) delay = Math.min(delay, until);
				nextPoll = version !== pressVersion || refreshRequested ? 0 : now + delay;
			}
		};
		controls.current = {
			begin: () => {
				if (!active || pressed || !current?.available || !current.eligible || useSessionStore.getState().isEditor || document.hidden || !navigator.onLine) return;
				pressed = true;
				pressVersion++;
				heldRound = null;
				nextHeartbeat = 0;
				setHolding(true);
				setNotice(null);
				setResult(null);
				setError(null);
				nextPoll = 0;
				void poll();
			},
			end: release,
		};
		const tick = () => {
			const until = current?.endsAt ? Date.parse(current.endsAt) : 0;
			setRemainingMs(Math.max(0, until - Date.now() - clockOffset));
			if (Date.now() >= nextPoll) void poll();
		};
		const visibility = () => {
			if (document.hidden) release();
			else { nextPoll = 0; void poll(); }
		};
		// Staff roles live on the server. Recheck immediately after a court or
		// participant change instead of leaving a now-unavailable button until
		// the next idle poll. A change during a request queues another check.
		const unsubscribe = useSessionStore.subscribe((next, previous) => {
			const contextChanged = next.courts !== previous.courts || next.sessionPlayers !== previous.sessionPlayers || next.boardDrafts !== previous.boardDrafts;
			if (contextChanged || next.broadcastConnected !== previous.broadcastConnected) {
				if (contextChanged) availabilityVersion++;
				refreshRequested = true;
				nextPoll = 0;
				void poll();
			}
			if (next.memberPartyChangeVersion !== previous.memberPartyChangeVersion && !realtimeRefreshTimer) {
				// First press/finish can change multiple rows in one transaction. Collapse that
				// burst and queue a follow-up if a request is already in flight.
				realtimeRefreshTimer = setTimeout(() => {
					realtimeRefreshTimer = null;
					refreshRequested = true;
					nextPoll = 0;
					void poll();
				}, 100);
			}
		});
		const timer = window.setInterval(tick, 100);
		window.addEventListener("blur", release);
		window.addEventListener("pagehide", release);
		window.addEventListener("offline", release);
		document.addEventListener("visibilitychange", visibility);
		void poll();
		return () => {
			active = false;
			release();
			controls.current = null;
			unsubscribe();
			if (realtimeRefreshTimer) clearTimeout(realtimeRefreshTimer);
			window.clearInterval(timer);
			window.removeEventListener("blur", release);
			window.removeEventListener("pagehide", release);
			window.removeEventListener("offline", release);
			document.removeEventListener("visibilitychange", visibility);
		};
	}, [sessionId, memberId, isEditor, lockSynced, boardClientId]);

	return {
		state, holding, notice, result, error, remainingMs,
		begin: () => controls.current?.begin(),
		end: () => controls.current?.end(),
		clearResult: () => { setNotice(null); setResult(null); setError(null); },
	};
}
