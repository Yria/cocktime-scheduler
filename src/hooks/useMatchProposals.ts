import { useEffect } from "react";
import { useAppStore } from "../store/appStore";
import { useAuthStore } from "../store/authStore";
import { useBoardStore } from "../store/boardStore";
import { useSessionStore } from "../store/sessionStore";
import { useMatchProposalStore } from "../store/matchProposalStore";
import { toast } from "../store/toastStore";
import { supabase } from "../lib/supabase/client";
import { editMatchProposals, fetchMatchProposals, sendMatchProposal, startMatchProposal, updateMatchProposal, type MatchProposal } from "../lib/supabase/matchProposals";
import { dropProposalMember, isActiveMatchProposal, visibleMatchProposals, placeProposalAnchors, removeProposalMember, type ProposalComposer, type ProposalComposerSnapshot } from "../lib/board/matchProposals";
import { clampAnchor, isInsideTeamBounds, slotIndexAt } from "../lib/board/geometry";
import { cockPendingIds, playingIdsFromCourts } from "../lib/board/membership";
import { arrangeBoard } from "../lib/board/arrange";
import { buildRecommendData } from "../lib/board/recommendPool";
import { autoFillTeammates, pairPlayers } from "../lib/teamSelection";
import type { SessionPlayer } from "../types";
import { randomId } from "../lib/randomId";
import { settleFreeMagnets } from "../lib/board/settle";
import type { DraftTeam } from "../types/board";
import { acquireAdminCoverage, coverageRosterKey, releaseAdminCoverage } from "../lib/board/adminCoverageGate";

const EMPTY: ProposalComposerSnapshot = { enabled: false, groups: [], sendingIds: new Set(),
	proposals: [], anchors: new Map(), resolvingIds: new Set(), viewerId: null, isAdmin: false };

export function matchProposalScope() {
	const auth = useAuthStore.getState();
	const sessionId = useAppStore.getState().sessionMeta?.sessionId;
	return auth.memberLoaded && auth.user && sessionId ? `${auth.user.id}:${sessionId}:${auth.isAdmin}` : null;
}

function editable() {
	const state = useMatchProposalStore.getState();
	return state.enabled && !useSessionStore.getState().isEditor && state.scope !== null && state.scope === matchProposalScope();
}

/** Private proposals can select waiting free magnets, never copy shared team/court membership. */
function proposalCandidates() {
	const board = useBoardStore.getState(), session = useSessionStore.getState();
	const playing = playingIdsFromCourts(session.courts);
	const reserved = new Set([...board.reservations.values()].map((reservation) => reservation.playerId));
	const resting = new Set(session.restingIds);
	const notReady = cockPendingIds(session.sessionPlayers.values(), session.cockCheckEnabled);
	return [...board.magnets.values()].filter((magnet) => magnet.teamId === null
		&& session.sessionPlayers.has(magnet.playerId) && !playing.has(magnet.playerId) && !reserved.has(magnet.playerId)
		&& !resting.has(magnet.playerId) && !notReady.has(magnet.playerId));
}

/** Keep surrounding magnets reachable without putting private groups into boardStore.drafts. */
export function settleProposalLayout(rearrange = false) {
	const state = useMatchProposalStore.getState();
	if (!state.scope || state.scope !== matchProposalScope()) return;
	const groups = state.groups;
	const board = useBoardStore.getState();
	const session = useSessionStore.getState();
	const visible = visibleMatchProposals(state);
	const realAnchors = [...[...board.drafts.values()].map((team) => team.anchor), ...board.courtAnchors.values()];
	if (rearrange) {
		// Arrange cloned layout data with private cards as temporary obstacles. Never put them in shared drafts.
		const magnets = new Map([...board.magnets].map(([id, magnet]) => [id, { ...magnet }]));
		const drafts = new Map([...board.drafts].map(([id, team]) => [id, { ...team }]));
		const courtAnchors = new Map(board.courtAnchors);
		const privateIds = [...groups.map((group) => group.id), ...visible.map((proposal) => proposal.id)];
		for (const id of privateIds) drafts.set(`proposal:${id}`, { id: `proposal:${id}`, anchorMemberIds: [],
			anchor: { x: 0, y: 0 }, createdAt: Number.MAX_SAFE_INTEGER });
		const excluded = playingIdsFromCourts(session.courts);
		for (const group of groups) for (const id of group.playerIds) excluded.add(id);
		for (const proposal of visible) for (const id of proposal.player_ids) excluded.add(id);
		arrangeBoard({ magnets, drafts, reservations: board.reservations, courtAnchors, courts: session.courts,
			sessionPlayers: session.sessionPlayers, playingIds: excluded, restingIds: new Set(session.restingIds),
			cockPendingIds: cockPendingIds(session.sessionPlayers.values(), session.cockCheckEnabled),
			viewW: board.stageW, viewH: board.stageH });
		useBoardStore.setState({ magnets, courtAnchors });
		useMatchProposalStore.setState({
			groups: groups.map((group) => ({ ...group, anchor: drafts.get(`proposal:${group.id}`)!.anchor })),
			anchors: new Map(visible.map((proposal) => [proposal.id, drafts.get(`proposal:${proposal.id}`)!.anchor])),
		});
		return;
	}
	const anchors = placeProposalAnchors(visible.map((proposal) => proposal.id), state.anchors,
		[...groups.map((group) => group.anchor), ...realAnchors],
		{ width: board.stageW, height: board.stageH });
	if (anchors.size !== state.anchors.size || [...anchors].some(([id, point]) =>
		point.x !== state.anchors.get(id)?.x || point.y !== state.anchors.get(id)?.y)) useMatchProposalStore.setState({ anchors });
	if (!groups.length && !anchors.size && !state.anchors.size) return;
	const magnets = new Map([...board.magnets].map(([id, magnet]) => [id, { ...magnet }]));
	const obstacles = new Map<string, DraftTeam>(board.drafts);
	for (const group of groups) obstacles.set(`proposal:${group.id}`, { id: `proposal:${group.id}`,
		anchorMemberIds: [], anchor: group.anchor, createdAt: 0 });
	for (const [id, anchor] of anchors) obstacles.set(`proposal:${id}`, { id: `proposal:${id}`, anchorMemberIds: [], anchor, createdAt: 0 });
	for (const [id, anchor] of board.courtAnchors) obstacles.set(`court:${id}`, { id: `court:${id}`, anchorMemberIds: [], anchor, createdAt: 0 });
	const excluded = playingIdsFromCourts(session.courts);
	for (const group of groups) for (const id of group.playerIds) excluded.add(id);
	for (const proposal of visible) for (const id of proposal.player_ids) excluded.add(id);
	settleFreeMagnets(magnets, obstacles, board.stageW, board.stageH, excluded);
	if ([...magnets].some(([id, magnet]) => magnet.x !== board.magnets.get(id)?.x || magnet.y !== board.magnets.get(id)?.y)) {
		useBoardStore.setState({ magnets });
	}
}

function errorMessage(error: unknown, fallback: string) {
	const message = error && typeof error === "object" && "message" in error ? String(error.message) : "";
	if (message.includes("admin coverage required")) return "운영진의 경기 상태가 바뀌었어요. 동기화 후 다시 시작해 주세요.";
	if (message.includes("session closed")) return "종료된 세션에는 제안할 수 없어요.";
	if (message.includes("player left session")) return "세션을 나간 회원이 있어요. 제안할 회원을 다시 골라주세요.";
	if (message.includes("not participant")) return "이 세션에 참여한 회원만 제안할 수 있어요.";
	if (message.includes("not editor")) return "현재 보드 편집 권한이 필요해요.";
	if (message.includes("proposal changed")) return "제안이 변경됐어요. 최신 명단을 확인해 주세요.";
	if (message.includes("proposal already closed")) return "이미 처리된 제안이에요.";
	if (message.includes("players already grouped")) return "다른 팀에 포함된 회원이 있어요.";
	if (message.includes("players")) return "경기 중이거나 대기 상태가 아닌 회원이 있어요.";
	if (message.includes("court already assigned")) return "다른 경기가 코트에 먼저 배정됐어요.";
	return fallback;
}

export const proposalComposer: ProposalComposer = {
	getSnapshot: () => {
		const state = useMatchProposalStore.getState();
		return state.scope && state.scope === matchProposalScope() ? state : EMPTY;
	},
	subscribe: (listener) => useMatchProposalStore.subscribe(listener),
	dropSubmitted: (playerId, point, sourceGroupId) => {
		if (!canEditSubmitted()) return false;
		const state = useMatchProposalStore.getState();
		const source = state.proposals.find((proposal) => proposal.id === sourceGroupId && isActiveMatchProposal(proposal));
		const target = [...state.proposals].reverse().find((proposal) => isActiveMatchProposal(proposal)
			&& state.anchors.has(proposal.id) && isInsideTeamBounds(point, state.anchors.get(proposal.id)!));
		if (!source && !target) return false;
		if ((source && state.resolvingIds.has(source.id)) || (target && state.resolvingIds.has(target.id))) return true;
		if (!target) {
			if (source) void editSubmitted([{ proposal: source, ids: source.player_ids.filter((id) => id !== playerId) }]);
			return true;
		}
		if (!source && !proposalCandidates().some((magnet) => magnet.playerId === playerId)) return true;
		const slot = slotIndexAt(point, state.anchors.get(target.id)!);
		if (slot < 0) return true;
		const ids = [...target.player_ids];
		const existing = ids.indexOf(playerId);
		if (existing >= 0) {
			if (source?.id === target.id && slot < ids.length && slot !== existing) {
				[ids[slot], ids[existing]] = [ids[existing], ids[slot]];
				void editSubmitted([{ proposal: target, ids }]);
			}
			return true;
		}
		const displaced = ids[slot];
		if (slot < ids.length) ids[slot] = playerId;
		else if (ids.length < 4) ids.push(playerId);
		else return true;
		const changes = [{ proposal: target, ids }];
		if (source && source.id !== target.id) changes.push({ proposal: source,
			ids: source.player_ids.flatMap((id) => id === playerId ? displaced ? [displaced] : [] : [id]) });
		void editSubmitted(changes);
		return true;
	},
	removeSubmittedMember: (groupId, playerId) => {
		const proposal = useMatchProposalStore.getState().proposals.find((item) => item.id === groupId);
		if (proposal) void editSubmitted([{ proposal, ids: proposal.player_ids.filter((id) => id !== playerId) }]);
	},
	drop: (playerId, point) => {
		if (!editable()) return;
		const state = useMatchProposalStore.getState();
		const board = useBoardStore.getState();
		const session = useSessionStore.getState();
		if (!session.sessionPlayers.has(playerId)) return;
		if ([...state.anchors.values()].some((anchor) => isInsideTeamBounds(point, anchor))) return;
		if (state.groups.some((group) => state.sendingIds.has(group.id) && group.playerIds.includes(playerId))) return;
		// Freeze a sending group so a pending request and the visible selection cannot diverge.
		const frozen = state.groups.filter((group) => state.sendingIds.has(group.id));
		const proposedIds = new Set(visibleMatchProposals(state).flatMap((proposal) => proposal.player_ids));
		const candidates = proposalCandidates().filter((magnet) => !proposedIds.has(magnet.playerId));
		if (!candidates.some((magnet) => magnet.playerId === playerId)) {
			// Non-matching free magnets can still be repositioned, with no membership changes.
			if (!state.groups.some((group) => group.playerIds.includes(playerId)) && !proposedIds.has(playerId)) board.handleDrop(playerId, point);
			return;
		}
		const next = dropProposalMember(state.groups, playerId, point,
			candidates,
			{ width: board.stageW, height: board.stageH }, randomId());
		if (frozen.some((group) => next.find((candidate) => candidate.id === group.id) !== group)) return;
		state.setGroups(next);
		// Moving a freed token is local layout only; shared draft membership is untouched.
		if (!next.some((group) => group.playerIds.includes(playerId))) board.handleDrop(playerId, point);
		settleProposalLayout();
	},
	move: (groupId, point) => {
		const board = useBoardStore.getState();
		const state = useMatchProposalStore.getState();
		if (!state.scope || state.scope !== matchProposalScope()) return;
		const anchor = clampAnchor(point, board.stageW, board.stageH);
		if (state.proposals.some((proposal) => proposal.id === groupId && isActiveMatchProposal(proposal)
			&& (state.isAdmin || proposal.created_by === state.viewerId))) {
			useMatchProposalStore.setState({ anchors: new Map(state.anchors).set(groupId, anchor) });
		} else if (editable()) state.setGroups(state.groups.map((group) => group.id === groupId ? { ...group, anchor } : group));
		settleProposalLayout();
	},
	removeMember: (playerId) => {
		if (!editable()) return;
		const state = useMatchProposalStore.getState();
		if (state.groups.some((group) => state.sendingIds.has(group.id) && group.playerIds.includes(playerId))) return;
		state.setGroups(removeProposalMember(state.groups, playerId));
	},
	removeGroup: (groupId) => {
		const state = useMatchProposalStore.getState();
		if (!state.scope || state.scope !== matchProposalScope()) return;
		if (state.isAdmin && state.proposals.some((proposal) => proposal.id === groupId)) {
			void resolveProposal(groupId, "rejected");
		} else if (editable() && !state.sendingIds.has(groupId)) state.setGroups(state.groups.filter((group) => group.id !== groupId));
	},
	submit: (groupId) => {
		const state = useMatchProposalStore.getState();
		if (!state.scope || state.scope !== matchProposalScope()) return;
		const proposal = state.proposals.find((item) => item.id === groupId);
		if (proposal) {
			if (canEditSubmitted()) { if (proposal.player_ids.length < 4) autoFillSubmitted(proposal); else void startSubmitted(proposal); }
			else if (proposal.created_by === state.viewerId) void resolveProposal(groupId, "withdrawn");
		} else void submitGroup(groupId);
	},
};

function canEditSubmitted() {
	const state = useMatchProposalStore.getState();
	return !!state.scope && state.scope === matchProposalScope() && state.isAdmin && useSessionStore.getState().isEditor;
}

function applyProposals(rows: MatchProposal[]) {
	useMatchProposalStore.setState((state) => ({ revision: state.revision + 1,
		proposals: [...rows, ...state.proposals.filter((proposal) => !rows.some((row) => row.id === proposal.id))].filter(isActiveMatchProposal) }));
}

async function editSubmitted(changes: { proposal: MatchProposal; ids: string[] }[]) {
	if (!canEditSubmitted()) return;
	const state = useMatchProposalStore.getState();
	const session = useSessionStore.getState();
	if (!session._clientId || changes.some(({ proposal }) => state.resolvingIds.has(proposal.id) || !isActiveMatchProposal(proposal))) return;
	const scope = state.scope;
	const ids = changes.map(({ proposal }) => proposal.id);
	useMatchProposalStore.setState({ resolvingIds: new Set([...state.resolvingIds, ...ids]) });
	try {
		const rows = await editMatchProposals(changes.map(({ proposal, ids }) => ({ id: proposal.id, updated_at: proposal.updated_at, player_ids: ids })), session._clientId, session._myName ?? "운영진");
		if (scope === matchProposalScope()) applyProposals(rows);
	} catch (error) {
		if (scope === matchProposalScope()) {
			toast(errorMessage(error, "명단을 바꾸지 못했어요. 다시 시도해 주세요."), { variant: "error" });
			window.dispatchEvent(new Event("online"));
		}
	} finally {
		if (scope === matchProposalScope()) useMatchProposalStore.setState((current) => ({ resolvingIds: new Set([...current.resolvingIds].filter((id) => !ids.includes(id))) }));
	}
}

function autoFillSubmitted(proposal: MatchProposal) {
	if (!canEditSubmitted()) return;
	const board = useBoardStore.getState(), session = useSessionStore.getState();
	const data = buildRecommendData({ newTeam: true }, proposal.player_ids, { ...board, ...session }, { excludePlaying: true, excludeReserved: true });
	if (!data || data.confirmed.length !== proposal.player_ids.length) { toast("세션을 나간 회원을 먼저 빼주세요.", { variant: "error" }); return; }
	const picks = autoFillTeammates(data.confirmed, data.pool, data.ctx, 4 - data.confirmed.length);
	if (!picks.length) { toast("자동매칭할 수 있는 대기 회원이 없어요.", { variant: "error" }); return; }
	void editSubmitted([{ proposal, ids: [...proposal.player_ids, ...picks.map((player) => player.id)] }]);
}

async function startSubmitted(proposal: MatchProposal, adminAbsenceConsent?: string) {
	if (!canEditSubmitted()) return;
	const state = useMatchProposalStore.getState(), session = useSessionStore.getState();
	if (!session._clientId || state.resolvingIds.has(proposal.id)) return;
	const empty = session.courts.find((court) => !court.match);
	if (!empty) { toast("빈 코트가 없어요", { variant: "error" }); return; }
	const four = proposal.player_ids.map((id) => session.sessionPlayers.get(id)).filter((player): player is SessionPlayer => !!player);
	if (four.length !== 4) return;
	const coverageKey = `proposal:${proposal.id}`;
	if (!acquireAdminCoverage(coverageKey, proposal.player_ids, consent => {
		const latest = useMatchProposalStore.getState().proposals.find(p => p.id === proposal.id);
		if (latest && isActiveMatchProposal(latest)) void startSubmitted(latest, consent);
	}, adminAbsenceConsent)) return;
	const team = pairPlayers(four as [SessionPlayer, SessionPlayer, SessionPlayer, SessionPlayer], useAppStore.getState().sessionMeta?.singleWomanIds ?? [], "회원 매칭 제안");
	const scope = state.scope, anchor = state.anchors.get(proposal.id);
	useMatchProposalStore.setState({ resolvingIds: new Set([...state.resolvingIds, proposal.id]) });
	try {
		const row = await startMatchProposal(proposal, randomId(), empty.id, team, session._clientId, session._myName ?? "운영진", adminAbsenceConsent === coverageRosterKey(proposal.player_ids));
		if (scope !== matchProposalScope()) return;
		applyProposals([row]);
		await useSessionStore.getState().resyncFromServer();
		if (scope !== matchProposalScope()) return;
		const court = useSessionStore.getState().courts.find((item) => item.match?.id === row.match_id);
		if (court && anchor) useBoardStore.getState().setCourtAnchor(court.id, anchor.x, anchor.y);
		toast("경기를 시작했어요", { variant: "success" });
	} catch (error) {
		if (scope === matchProposalScope()) {
			toast(errorMessage(error, "경기를 시작하지 못했어요. 다시 시도해 주세요."), { variant: "error" });
			void useSessionStore.getState().resyncFromServer();
			window.dispatchEvent(new Event("online"));
		}
	} finally {
		releaseAdminCoverage(coverageKey);
		if (scope === matchProposalScope()) useMatchProposalStore.setState((current) => {
			const resolvingIds = new Set(current.resolvingIds); resolvingIds.delete(proposal.id); return { resolvingIds };
		});
	}
}

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
			proposals: [proposal, ...current.proposals.filter((item) => item.id !== proposal.id)].filter(isActiveMatchProposal), error: null,
			anchors: new Map(current.anchors).set(groupId, current.groups.find((item) => item.id === groupId)?.anchor ?? group.anchor),
			revision: current.revision + 1,
		}));
		toast(isActiveMatchProposal(proposal) ? "운영진에게 매칭 제안을 보냈어요"
			: proposal.status === "started" ? "이 제안으로 경기가 시작됐어요"
			: "선택한 회원의 경기가 시작되어 매칭 제안을 취소했어요", { variant: "success" });
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

export async function resolveProposal(id: string, status: "reviewed" | "withdrawn" | "rejected") {
	const scope = matchProposalScope();
	const state = useMatchProposalStore.getState();
	const proposal = state.proposals.find((item) => item.id === id);
	if (!scope || state.scope !== scope || state.resolvingIds.has(id) || !proposal || !isActiveMatchProposal(proposal)
		|| (status === "withdrawn" ? proposal.created_by !== state.viewerId : !state.isAdmin)) return;
	useMatchProposalStore.setState({ resolvingIds: new Set([...state.resolvingIds, id]) });
	try {
		await updateMatchProposal(id, status);
		if (scope !== matchProposalScope() || useMatchProposalStore.getState().scope !== scope) return;
		useMatchProposalStore.setState((current) => ({ revision: current.revision + 1, proposals: status !== "reviewed"
			? current.proposals.filter((item) => item.id !== id)
			: current.proposals.map((item) => item.id === id ? { ...item, status } : item) }));
		toast(status === "rejected" ? "매칭 제안을 거절했어요" : status === "withdrawn" ? "매칭 제안을 취소했어요" : "매칭 제안을 확인했어요", { variant: "success" });
	} catch {
		if (scope === matchProposalScope()) toast("처리하지 못했어요. 다시 눌러주세요.", { variant: "error" });
	} finally {
		if (scope === matchProposalScope() && useMatchProposalStore.getState().scope === scope) useMatchProposalStore.setState((current) => {
			const resolvingIds = new Set(current.resolvingIds); resolvingIds.delete(id); return { resolvingIds };
		});
	}
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
	const proposals = useMatchProposalStore((state) => state.proposals);
	const playerIds = useSessionStore((state) => [...state.sessionPlayers.keys()].join(","));
	useEffect(() => {
		if (!matchProposalScope()) return;
		const state = useMatchProposalStore.getState();
		const board = useBoardStore.getState();
		const players = useSessionStore.getState().sessionPlayers;
		const playing = playingIdsFromCourts(courts);
		// Unsent groups live only on this device; cancel the whole suggestion on a start.
		const availableGroups = state.groups.filter((group) => !group.playerIds.some((id) => playing.has(id)));
		const cancelledLocal = availableGroups.length !== state.groups.length;
		let changed = false;
		const groups = availableGroups.map((group) => {
			const ids = group.playerIds.filter((id) => players.has(id));
			const anchor = clampAnchor(group.anchor, board.stageW, board.stageH);
			if (ids.length === group.playerIds.length && anchor.x === group.anchor.x && anchor.y === group.anchor.y) return group;
			changed = true; return { ...group, playerIds: ids, anchor };
		}).filter((group) => group.playerIds.length > 0);
		if (changed || cancelledLocal) state.setGroups(groups);
		if (cancelledLocal) toast("선택한 회원의 경기가 시작되어 매칭 제안을 취소했어요");
		// The DB cancels sent proposals atomically. Hide stale cards during realtime catch-up.
		const active = state.proposals.filter((proposal) => !proposal.player_ids.some((id) => playing.has(id)));
		if (active.length !== state.proposals.length) useMatchProposalStore.setState((current) => ({
			proposals: active, revision: current.revision + 1,
		}));
		settleProposalLayout();
	}, [bounds, drafts, courts, playerIds, proposals]);
	useEffect(() => {
		const scope = matchProposalScope();
		useMatchProposalStore.getState().reset(scope ?? undefined, participating && !useSessionStore.getState().isEditor && !!scope, userId, isAdmin);
		if (!sessionId || !scope) return;
		// Switching the editing lock changes drag behavior without refetching submitted proposals.
		const unsubscribeEditing = useSessionStore.subscribe((session, previous) => {
			if (session.isEditor === previous.isEditor) return;
			useMatchProposalStore.setState((state) => ({ enabled: participating && !session.isEditor,
				groups: session.isEditor ? [] : state.groups }));
		});
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
					useMatchProposalStore.setState({ proposals: proposals.filter((proposal) => isActiveMatchProposal(proposal)
						&& (isAdmin || proposal.created_by === userId)), error: null });
				}
			} catch {
				if (!disposed && sequence === request && scope === matchProposalScope()) {
					const error = "제안을 불러오지 못했어요. 잠시 후 다시 확인할게요.";
					if (!useMatchProposalStore.getState().error) toast(error, { variant: "error" });
					useMatchProposalStore.setState({ error });
				}
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
			unsubscribeEditing();
			document.removeEventListener("visibilitychange", onVisible); window.removeEventListener("online", onVisible);
			void supabase.removeChannel(channel);
			useMatchProposalStore.getState().reset();
		};
	}, [sessionId, userId, memberLoaded, isAdmin, participating]);
	return proposalComposer;
}
