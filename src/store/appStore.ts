import type { RealtimeChannel } from "@supabase/supabase-js";
import { create } from "zustand";
import { OAUTH_AVAILABLE, requestAccessToken } from "../lib/googleAuth";
import {
	fetchPlayers,
	updatePlayer,
	updatePlayerWithToken,
} from "../lib/sheetsApi";
import {
	dbSaveTeamCandidates,
	dbUpdateSessionPlayer,
	fetchActiveSession,
	fetchSessionSnapshot,
	sendBroadcast,
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
}

interface AppState {
	allPlayers: Player[];
	sessionMeta: SessionMeta | null;

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

let _loadingSessionId: number | null = null;

export const useAppStore = create<AppState>((set, get) => ({
	allPlayers: [],
	sessionMeta: null,
	_sessionWatchChannel: null,

	setupGuests: [],

	resetSetupState: () =>
		set({
			setupGuests: [],
		}),

	fetchPlayersAction: async () => {
		const players = await fetchPlayers();
		set({ allPlayers: players });
	},

	loadSessionAction: async (row: SessionRow) => {
		// 이미 같은 세션이 로드되었거나 로딩 중이면 스킵 (동시 호출 방지)
		if (get().sessionMeta?.sessionId === row.id) {
			return true;
		}
		if (_loadingSessionId === row.id) {
			return true;
		}
		_loadingSessionId = row.id;
		try {
			const [snapshot, players] = await Promise.all([
				fetchSessionSnapshot(row.id),
				fetchPlayers().catch(() => [] as Player[]),
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
				},
				setupGuests: guests,
			});
			return true;
		} catch (e) {
			console.error("Failed to load session:", e);
			return false;
		} finally {
			_loadingSessionId = null;
		}
	},

	checkActiveSessionAction: async () => {
		const row = await fetchActiveSession();
		if (row?.is_active) {
			if (get().sessionMeta?.sessionId === row.id) return true;
			return await get().loadSessionAction(row);
		}
		return false;
	},

	startOrUpdateSessionAction: async (
		selected: Player[],
		settings: SessionSettings,
	) => {
		const { sessionMeta } = get();

		if (sessionMeta) {
			// 참가자 변경 여부 확인 (팀 후보 재생성 여부 결정)
			const currentPlayerIds = new Set(selected.map((p) => p.id));
			const { sessionPlayers } = useSessionStore.getState();
			const previousPlayerIds = new Set(
				[...sessionPlayers.values()].map((p) => p.playerId),
			);

			const playersChanged =
				currentPlayerIds.size !== previousPlayerIds.size ||
				[...currentPlayerIds].some((id) => !previousPlayerIds.has(id)) ||
				[...previousPlayerIds].some((id) => !currentPlayerIds.has(id));

			const success = await updateSession(
				sessionMeta.sessionId,
				settings.courtCount,
				selected,
				settings.singleWomanIds,
			);
			if (!success) return false;

			// DB에서 최신 상태를 가져와서 전체 상태를 다시 초기화
			const snapshot = await fetchSessionSnapshot(sessionMeta.sessionId);
			if (!snapshot) return false;

			const clientState = snapshotToClientState(snapshot);

			// 참가자가 변경되면 기존 후보 초기화 (SessionMain에서 자동 보충됨)
			if (playersChanged) {
				await dbSaveTeamCandidates(sessionMeta.sessionId, []);
				clientState.candidateTeams = [];
			}

			// sessionStore를 DB 상태로 완전히 재초기화
			useSessionStore.getState().initialize(clientState);

			// 다른 클라이언트에게 "DB 다시 로드하라"는 신호만 전송
			useSessionStore.getState().notifySessionRefresh();

			set({
				sessionMeta: {
					sessionId: sessionMeta.sessionId,
					courtCount: settings.courtCount,
					singleWomanIds: settings.singleWomanIds,
				},
			});
			return true;
		}

		const result = await startSession(
			settings.courtCount,
			selected,
			settings.singleWomanIds,
		);
		if (!result) return false;

		const { sessionId, sessionPlayers } = result;
		const courts = Array.from({ length: settings.courtCount }, (_, i) => ({
			id: i + 1,
			match: null as null,
		}));

		// 새 세션의 초기 상태를 sessionStore에 직접 설정 (팀 후보는 SessionMain에서 자동 생성됨)
		useSessionStore.getState().initialize({
			courts,
			players: sessionPlayers,
			waitingIds: sessionPlayers.map((p) => p.id),
			restingIds: [],
			pairHistory: {},
			candidateTeams: [],
			matchQueue: [],
		});

		set({
			sessionMeta: {
				sessionId,
				courtCount: settings.courtCount,
				singleWomanIds: settings.singleWomanIds,
			},
		});
		return true;
	},

	updatePlayerAction: async (player: Player) => {
		const { sessionMeta } = get();
		try {
			if (OAUTH_AVAILABLE) {
				try {
					const token = await requestAccessToken();
					await updatePlayerWithToken(
						token,
						player.name,
						player.gender,
						player.skills,
					);
				} catch (e) {
					if (
						e instanceof Error &&
						(e.message.includes("광고 차단기") ||
							e.message.includes("초기화 실패"))
					) {
						await updatePlayer(player.name, player.gender, player.skills);
					} else {
						throw e;
					}
				}
			} else {
				await updatePlayer(player.name, player.gender, player.skills);
			}

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
						useSessionStore
							.getState()
							.applyBroadcast(
								{ event: "player_updated", payload: { player: updated } },
								() => {},
							);
						const { _channel } = useSessionStore.getState();
						if (_channel) {
							sendBroadcast(_channel, {
								event: "player_updated",
								payload: { player: updated },
							});
						}
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
		settings: { courtCount: number; singleWomanIds: string[] },
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
