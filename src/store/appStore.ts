import type { RealtimeChannel } from "@supabase/supabase-js";
import { create } from "zustand";
import { fetchMembers, updateMemberProfile } from "../lib/supabase/members";
import {
	dbUpdateSessionPlayer,
	fetchActiveSession,
	fetchSessionSnapshot,
	snapshotToClientState,
	startSession,
	supabase,
	updateSession,
	type SessionRow,
} from "../lib/supabase";
import type { Player, SessionSettings } from "../types";
import { useSessionStore } from "./sessionStore";

export interface SessionMeta {
	sessionId: number;
	courtCount: number;
	singleWomanIds: string[];
	cockCheckEnabled: boolean;
	/** 일정(스케줄)으로 연 세션인가 — scheduled_at != null(반복 회차 포함). 즉석 세션은 false.
	 *  일정 세션은 수동 종료 금지(BoardToolbar 종료 버튼 숨김): 종료는 일정 라이프사이클이 관리하고,
	 *  즉석 세션만 편집자가 수동 종료할 수 있다. */
	isScheduled: boolean;
}

interface AppState {
	allPlayers: Player[];
	sessionMeta: SessionMeta | null;
	sessionChecked: boolean;

	fetchPlayersAction: () => Promise<void>;
	loadSessionAction: (row: SessionRow) => Promise<boolean>;
	checkActiveSessionAction: () => Promise<boolean>;
	startOrUpdateSessionAction: (
		selected: Player[],
		settings: SessionSettings,
	) => Promise<boolean>;
	updatePlayerAction: (player: Player) => Promise<boolean>;

	// Session watch (App-level postgres_changes)
	_sessionWatchChannel: RealtimeChannel | null;
	subscribeSessionWatch: (callbacks: {
		onSessionStart: (row: SessionRow) => Promise<void>;
		onSessionEnd: (sessionId: number) => void;
	}) => void;
	unsubscribeSessionWatch: () => void;

	// Setup Screen State
	setupGuests: Player[];

	resetSetupState: () => void;
}

let _loadingPromise: { sessionId: number; promise: Promise<boolean> } | null =
	null;

export const useAppStore = create<AppState>((set, get) => ({
	allPlayers: [],
	sessionMeta: null,
	sessionChecked: false,
	_sessionWatchChannel: null,

	setupGuests: [],

	resetSetupState: () =>
		set({
			setupGuests: [],
		}),

	fetchPlayersAction: async () => {
		const players = await fetchMembers();
		set({ allPlayers: players });
	},

	loadSessionAction: async (row: SessionRow) => {
		// 이미 같은 세션이 로드되었으면 스킵
		if (get().sessionMeta?.sessionId === row.id) {
			return true;
		}
		// 같은 세션 로딩이 진행 중이면 그 Promise를 공유
		if (_loadingPromise && _loadingPromise.sessionId === row.id) {
			return _loadingPromise.promise;
		}

		const promise = (async (): Promise<boolean> => {
			try {
				const [snapshot, players] = await Promise.all([
					fetchSessionSnapshot(row.id),
					fetchMembers().catch(() => [] as Player[]),
				]);
				if (!snapshot) return false;

				// 비동기 대기 중 다른 호출이 먼저 완료했을 수 있음
				if (get().sessionMeta?.sessionId === row.id) return true;

				const clientState = snapshotToClientState(snapshot);
				const singleWomanIds = snapshot.players
					.filter((p) => p.allowMixedSingle)
					.map((p) => p.playerId);

				if (players.length > 0) {
					set({ allPlayers: players });
				}

				const loadedPlayerIdSet = new Set(players.map((p) => p.id));
				const guests: Player[] = snapshot.players
					.filter((p) => !loadedPlayerIdSet.has(p.playerId))
					.map((p) => ({
						id: p.playerId,
						name: p.name,
						gender: p.gender,
						skills: p.skills,
					}));

				// sessionStore를 스냅샷으로 직접 초기화 (1회성, 이후에는 broadcast로만 업데이트)
				useSessionStore.getState().initialize(clientState);

				set({
					sessionMeta: {
						sessionId: row.id,
						courtCount: row.court_count,
						singleWomanIds,
						cockCheckEnabled: row.cock_check_enabled ?? true,
						isScheduled: row.scheduled_at != null,
					},
					setupGuests: guests,
					sessionChecked: true,
				});
				return true;
			} catch (e) {
				console.error("Failed to load session:", e);
				return false;
			} finally {
				_loadingPromise = null;
			}
		})();

		_loadingPromise = { sessionId: row.id, promise };
		return promise;
	},

	checkActiveSessionAction: async () => {
		const row = await fetchActiveSession();
		if (row?.is_active) {
			if (get().sessionMeta?.sessionId === row.id) {
				set({ sessionChecked: true });
				return true;
			}
			const ok = await get().loadSessionAction(row);
			set({ sessionChecked: true });
			return ok;
		}
		set({ sessionChecked: true });
		return false;
	},

	startOrUpdateSessionAction: async (
		selected: Player[],
		settings: SessionSettings,
	) => {
		const { sessionMeta } = get();

		if (sessionMeta) {
			const success = await updateSession(
				sessionMeta.sessionId,
				settings.courtCount,
				selected,
				settings.singleWomanIds,
				settings.cockCheckEnabled,
			);
			if (!success) return false;

			// DB에서 최신 상태를 가져와서 전체 상태를 다시 초기화
			const snapshot = await fetchSessionSnapshot(sessionMeta.sessionId);
			if (!snapshot) return false;

			const clientState = snapshotToClientState(snapshot);

			// sessionStore를 DB 상태로 완전히 재초기화
			useSessionStore.getState().initialize(clientState);

			// 다른 클라이언트에게 "DB 다시 로드하라"는 신호만 전송
			useSessionStore.getState().notifySessionRefresh();

			set({
				sessionMeta: {
					sessionId: sessionMeta.sessionId,
					courtCount: settings.courtCount,
					singleWomanIds: settings.singleWomanIds,
					cockCheckEnabled: settings.cockCheckEnabled,
					isScheduled: sessionMeta.isScheduled,
				},
			});
			return true;
		}

		const result = await startSession(
			settings.courtCount,
			selected,
			settings.singleWomanIds,
			settings.cockCheckEnabled,
		);
		if (!result) return false;

		const { sessionId, sessionPlayers } = result;
		const courts = Array.from({ length: settings.courtCount }, (_, i) => ({
			id: i + 1,
			match: null as null,
		}));

		// 새 세션의 초기 상태를 sessionStore에 직접 설정
		useSessionStore.getState().initialize({
			courts,
			players: sessionPlayers,
			waitingIds: sessionPlayers.map((p) => p.id),
			restingIds: [],
			pairHistory: {},
			matchAssignCount: 0,
			lastGameType: {},
			boardDrafts: { teams: [], reservations: [] },
			boardDraftsVersion: 0,
			matchStateVersion: 0,
			cockCheckEnabled: settings.cockCheckEnabled,
		});

		set({
			sessionMeta: {
				sessionId,
				courtCount: settings.courtCount,
				singleWomanIds: settings.singleWomanIds,
				cockCheckEnabled: settings.cockCheckEnabled,
				// 즉석 세션 시작(startSession)은 scheduled_at 없이 생성 → 항상 수동 종료 가능.
				isScheduled: false,
			},
		});
		return true;
	},

	updatePlayerAction: async (player: Player) => {
		const { sessionMeta } = get();
		try {
			// 회원 원본(members) 성별·실력 갱신. 권한은 members RLS(본인/운영진)가 강제.
			const ok = await updateMemberProfile(
				player.id,
				player.gender,
				player.skills,
			);
			if (!ok) throw new Error("회원 정보를 저장하지 못했어요. 권한을 확인해주세요.");

			if (sessionMeta) {
				// 세션 참가 중인 플레이어인지 확인
				const { sessionPlayers } = useSessionStore.getState();
				const sessionPlayer = Array.from(sessionPlayers.values()).find(
					(p) => p.playerId === player.id,
				);

				if (sessionPlayer) {
					// session_players DB 업데이트 + broadcast
					const updated = await dbUpdateSessionPlayer(
						sessionPlayer.id,
						player.gender,
						player.skills,
					);
					if (updated) {
						useSessionStore.getState().broadcastPlayerUpdated(updated);
					}
				}
			}

			// allPlayers 캐시 갱신 (세션 참가 여부 무관)
			set((state) => ({
				allPlayers: state.allPlayers.map((p) =>
					p.id === player.id ? player : p,
				),
			}));
			return true;
		} catch (e) {
			console.error("Failed to update player:", e);
			throw e;
		}
	},

	subscribeSessionWatch: ({ onSessionStart, onSessionEnd }) => {
		get().unsubscribeSessionWatch();
		const channel = supabase
			.channel("app-session-watch")
			.on(
				"postgres_changes",
				{ event: "*", schema: "public", table: "sessions" },
				async (payload) => {
					const row = payload.new as SessionRow;
					if (!row || !row.id) return;

					if (row.is_active) {
						await onSessionStart(row);
					} else if (!row.is_active) {
						onSessionEnd(row.id);
					}
				},
			)
			.subscribe();

		set({ _sessionWatchChannel: channel });
	},

	unsubscribeSessionWatch: () => {
		const { _sessionWatchChannel } = get();
		if (_sessionWatchChannel) {
			supabase.removeChannel(_sessionWatchChannel);
			set({ _sessionWatchChannel: null });
		}
	},
}));

// ── 안정적 참조 액션 (컴포넌트에서 구독 없이 직접 호출) ──────────

export const appActions = {
	fetchPlayers: () => useAppStore.getState().fetchPlayersAction(),
	loadSession: (row: SessionRow) =>
		useAppStore.getState().loadSessionAction(row),
	checkActiveSession: () => useAppStore.getState().checkActiveSessionAction(),
	startOrUpdateSession: (
		selected: Player[],
		settings: { courtCount: number; singleWomanIds: string[]; cockCheckEnabled: boolean },
	) => useAppStore.getState().startOrUpdateSessionAction(selected, settings),
	updatePlayer: (player: Player) =>
		useAppStore.getState().updatePlayerAction(player),
	subscribeSessionWatch: (callbacks: {
		onSessionStart: (row: SessionRow) => Promise<void>;
		onSessionEnd: (sessionId: number) => void;
	}) => useAppStore.getState().subscribeSessionWatch(callbacks),
	unsubscribeSessionWatch: () =>
		useAppStore.getState().unsubscribeSessionWatch(),
	setSessionMeta: (meta: SessionMeta | null) =>
		useAppStore.setState({ sessionMeta: meta }),
	setSetupGuests: (updater: Player[] | ((prev: Player[]) => Player[])) =>
		useAppStore.setState((state) => ({
			setupGuests:
				typeof updater === "function" ? updater(state.setupGuests) : updater,
		})),
	resetSetupState: () => useAppStore.getState().resetSetupState(),
} as const;
