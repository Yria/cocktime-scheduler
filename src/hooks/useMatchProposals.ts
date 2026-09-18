import { useEffect } from "react";
import { useAppStore } from "../store/appStore";
import { useAuthStore } from "../store/authStore";
import { useBoardStore } from "../store/boardStore";
import { useSessionStore } from "../store/sessionStore";
import { useMatchProposalStore } from "../store/matchProposalStore";
import { toast } from "../store/toastStore";
import { supabase } from "../lib/supabase/client";
import { fetchMatchProposals, sendMatchProposal, updateMatchProposal } from "../lib/supabase/matchProposals";
import { dropProposalMember, removeProposalMember, type ProposalComposer, type ProposalComposerSnapshot } from "../lib/board/matchProposals";
import { clampAnchor } from "../lib/board/geometry";
import { playingIdsFromCourts } from "../lib/board/membership";
import { randomId } from "../lib/randomId";
import { settleFreeMagnets } from "../lib/board/settle";
import type { DraftTeam } from "../types/board";

const EMPTY: ProposalComposerSnapshot = { enabled: false, groups: [], sendingIds: new Set() };

export function matchProposalScope() {
	const auth = useAuthStore.getState();
	const sessionId = useAppStore.getState().sessionMeta?.sessionId;
	return auth.memberLoaded && auth.user && sessionId ? `${auth.user.id}:${sessionId}:${auth.isAdmin}` : null;
}

function editable() {
	const state = useMatchProposalStore.getState();
	return state.enabled && state.scope !== null && state.scope === matchProposalScope();
}

/** Keep surrounding magnets reachable without putting private groups into boardStore.drafts. */
export function settleProposalLayout() {
	if (!editable()) return;
	const { groups } = useMatchProposalStore.getState();
	if (!groups.length) return;
	const board = useBoardStore.getState();
	const session = useSessionStore.getState();
	const magnets = new Map([...board.magnets].map(([id, magnet]) => [id, { ...magnet }]));
	const obstacles = new Map<string, DraftTeam>(board.drafts);
	for (const group of groups) obstacles.set(`proposal:${group.id}`, { id: `proposal:${group.id}`,
		anchorMemberIds: [], anchor: group.anchor, createdAt: 0 });
	for (const [id, anchor] of board.courtAnchors) obstacles.set(`court:${id}`, { id: `court:${id}`, anchorMemberIds: [], anchor, createdAt: 0 });
	const excluded = playingIdsFromCourts(session.courts);
	for (const group of groups) for (const id of group.playerIds) excluded.add(id);
	settleFreeMagnets(magnets, obstacles, board.stageW, board.stageH, excluded);
	if ([...magnets].some(([id, magnet]) => magnet.x !== board.magnets.get(id)?.x || magnet.y !== board.magnets.get(id)?.y)) {
		useBoardStore.setState({ magnets });
	}
}

function errorMessage(error: unknown, fallback: string) {
	const message = error && typeof error === "object" && "message" in error ? String(error.message) : "";
	if (message.includes("session closed")) return "종료된 세션에는 제안할 수 없어요.";
	if (message.includes("player left session")) return "세션을 나간 회원이 있어요. 제안할 회원을 다시 골라주세요.";
	if (message.includes("not participant")) return "이 세션에 참여한 회원만 제안할 수 있어요.";
	return fallback;
}

export const proposalComposer: ProposalComposer = {
	getSnapshot: () => {
		const state = useMatchProposalStore.getState();
		return state.scope && state.scope === matchProposalScope() ? state : EMPTY;
	},
	subscribe: (listener) => useMatchProposalStore.subscribe(listener),
	drop: (playerId, point) => {
		if (!editable()) return;
		const state = useMatchProposalStore.getState();
		const board = useBoardStore.getState();
		const session = useSessionStore.getState();
		if (!session.sessionPlayers.has(playerId)) return;
		if (state.groups.some((group) => state.sendingIds.has(group.id) && group.playerIds.includes(playerId))) return;
		// Freeze a sending group so a pending request and the visible selection cannot diverge.
		const frozen = state.groups.filter((group) => state.sendingIds.has(group.id));
		const playing = playingIdsFromCourts(session.courts);
		const next = dropProposalMember(state.groups, playerId, point,
			[...board.magnets.values()].filter((magnet) => magnet.teamId === null
				&& !playing.has(magnet.playerId)),
			{ width: board.stageW, height: board.stageH }, randomId());
		if (frozen.some((group) => next.find((candidate) => candidate.id === group.id) !== group)) return;
		state.setGroups(next);
		// Moving a freed token is local layout only; shared draft membership is untouched.
		if (!next.some((group) => group.playerIds.includes(playerId))) board.handleDrop(playerId, point);
		settleProposalLayout();
	},
	move: (groupId, point) => {
		if (!editable()) return;
		const board = useBoardStore.getState();
		const state = useMatchProposalStore.getState();
		state.setGroups(state.groups.map((group) => group.id === groupId
			? { ...group, anchor: clampAnchor(point, board.stageW, board.stageH) } : group));
		settleProposalLayout();
	},
	removeMember: (playerId) => {
		if (!editable()) return;
		const state = useMatchProposalStore.getState();
		if (state.groups.some((group) => state.sendingIds.has(group.id) && group.playerIds.includes(playerId))) return;
		state.setGroups(removeProposalMember(state.groups, playerId));
	},
	removeGroup: (groupId) => {
		if (!editable()) return;
		const state = useMatchProposalStore.getState();
		if (!state.sendingIds.has(groupId)) state.setGroups(state.groups.filter((group) => group.id !== groupId));
	},
	submit: (groupId) => { void submitGroup(groupId); },
};

async function submitGroup(groupId: string) {
	if (!editable()) return;
	const state = useMatchProposalStore.getState();
	const group = state.groups.find((item) => item.id === groupId);
	const sessionId = useAppStore.getState().sessionMeta?.sessionId;
	if (!group || !sessionId || state.sendingIds.has(groupId)) return;
	const scope = state.scope;
	useMatchProposalStore.setState({ sendingIds: new Set([...state.sendingIds, groupId]) });
	try {
		const proposal = await sendMatchProposal(sessionId, group.id, group.playerIds);
		if (useMatchProposalStore.getState().scope !== scope || matchProposalScope() !== scope) return;
		useMatchProposalStore.setState((current) => ({
			groups: current.groups.filter((item) => item.id !== groupId),
			proposals: [proposal, ...current.proposals.filter((item) => item.id !== proposal.id)], error: null,
			revision: current.revision + 1,
		}));
		toast("운영진에게 매칭 제안을 보냈어요", { variant: "success" });
	} catch (error) {
		if (useMatchProposalStore.getState().scope === scope && matchProposalScope() === scope) {
			toast(errorMessage(error, "제안을 보내지 못했어요. 묶음은 그대로 있으니 다시 눌러주세요."), { variant: "error" });
		}
	} finally {
		if (useMatchProposalStore.getState().scope === scope) useMatchProposalStore.setState((current) => {
			const sendingIds = new Set(current.sendingIds); sendingIds.delete(groupId); return { sendingIds };
		});
	}
}

export async function resolveProposal(id: string, status: "reviewed" | "withdrawn") {
	const scope = matchProposalScope();
	await updateMatchProposal(id, status);
	if (scope !== matchProposalScope() || useMatchProposalStore.getState().scope !== scope) return;
	useMatchProposalStore.setState((state) => ({ revision: state.revision + 1, proposals: status === "withdrawn"
		? state.proposals.filter((item) => item.id !== id)
		: state.proposals.map((item) => item.id === id ? { ...item, status } : item) }));
}

export function useMatchProposals() {
	const sessionId = useAppStore((state) => state.sessionMeta?.sessionId);
	const userId = useAuthStore((state) => state.user?.id);
	const memberLoaded = useAuthStore((state) => state.memberLoaded);
	const isAdmin = useAuthStore((state) => state.isAdmin);
	const memberId = useAuthStore((state) => state.memberId);
	const participating = useSessionStore((state) => [...state.sessionPlayers.values()].some((player) => player.memberId === memberId));
	const bounds = useBoardStore((state) => `${state.stageW}:${state.stageH}`);
	const drafts = useBoardStore((state) => state.drafts);
	const courts = useSessionStore((state) => state.courts);
	const playerIds = useSessionStore((state) => [...state.sessionPlayers.keys()].join(","));
	useEffect(() => {
		if (!editable()) return;
		const state = useMatchProposalStore.getState();
		const board = useBoardStore.getState();
		const players = useSessionStore.getState().sessionPlayers;
		let changed = false;
		const groups = state.groups.map((group) => {
			const ids = group.playerIds.filter((id) => players.has(id));
			const anchor = clampAnchor(group.anchor, board.stageW, board.stageH);
			if (ids.length === group.playerIds.length && anchor.x === group.anchor.x && anchor.y === group.anchor.y) return group;
			changed = true; return { ...group, playerIds: ids, anchor };
		}).filter((group) => group.playerIds.length > 0);
		if (changed) state.setGroups(groups);
		settleProposalLayout();
	}, [bounds, drafts, courts, playerIds]);
	useEffect(() => {
		const scope = matchProposalScope();
		useMatchProposalStore.getState().reset(scope ?? undefined, !isAdmin && participating && !!scope);
		if (!sessionId || !scope) return;
		let disposed = false;
		let request = 0;
		const refresh = async () => {
			if (document.hidden) return;
			const sequence = ++request;
			const revision = useMatchProposalStore.getState().revision;
			useMatchProposalStore.setState({ loading: true });
			try {
				const proposals = await fetchMatchProposals(sessionId);
				if (!disposed && sequence === request && scope === matchProposalScope()) {
					if (revision !== useMatchProposalStore.getState().revision) { void refresh(); return; }
					useMatchProposalStore.setState({ proposals, error: null });
				}
			} catch {
				if (!disposed && sequence === request && scope === matchProposalScope()) useMatchProposalStore.setState({ error: "제안을 불러오지 못했어요. 잠시 후 다시 확인할게요." });
			} finally {
				if (!disposed && sequence === request && scope === matchProposalScope()) useMatchProposalStore.setState({ loading: false });
			}
		};
		const channel = supabase.channel(`match-proposals:${scope}`)
			.on("postgres_changes", { event: "INSERT", schema: "public", table: "match_proposals", filter: `session_id=eq.${sessionId}` }, () => { void refresh(); })
			.on("postgres_changes", { event: "UPDATE", schema: "public", table: "match_proposals", filter: `session_id=eq.${sessionId}` }, () => { void refresh(); })
			.subscribe((status) => { if (status === "SUBSCRIBED") void refresh(); });
		void refresh();
		// Catch up after reconnect/backgrounding; polling is a fallback for a missed change.
		const timer = window.setInterval(() => { void refresh(); }, 30000);
		const onVisible = () => { void refresh(); };
		document.addEventListener("visibilitychange", onVisible);
		window.addEventListener("online", onVisible);
		return () => {
			disposed = true; window.clearInterval(timer);
			document.removeEventListener("visibilitychange", onVisible); window.removeEventListener("online", onVisible);
			void supabase.removeChannel(channel);
			useMatchProposalStore.getState().reset();
		};
	}, [sessionId, userId, memberLoaded, isAdmin, participating]);
	return proposalComposer;
}
