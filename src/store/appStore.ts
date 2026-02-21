import type { RealtimeChannel } from "@supabase/supabase-js";
import { create } from "zustand";
import { OAUTH_AVAILABLE, requestAccessToken } from "../lib/googleAuth";
import {
	fetchPlayers,
	updatePlayer,
	updatePlayerWithToken,
} from "../lib/sheetsApi";
import {
	type ClientSessionState,
	fetchActiveSession,
	fetchSessionSnapshot,
	type SessionRow,
	snapshotToClientState,
	startSession,
	supabase,
	updateSession,
} from "../lib/supabaseClient";
import type { Player, SessionSettings } from "../types";

const ENV_SHEET_ID = import.meta.env.VITE_SHEET_ID as string;
const ENV_API_KEY = import.meta.env.VITE_API_KEY as string;
const ENV_SCRIPT_URL = (import.meta.env.VITE_SCRIPT_URL as string) ?? "";

export interface SessionMeta {
	sessionId: number;
	courtCount: number;
	singleWomanIds: string[];
	initialState: ClientSessionState;
}

interface AppState {
	allPlayers: Player[];
	scriptUrl: string;
	savedNames: Set<string> | null;
	sessionMeta: SessionMeta | null;

	setAllPlayers: (players: Player[]) => void;
	setScriptUrl: (url: string) => void;
	setSavedNames: (names: Set<string> | null) => void;
	setSessionMeta: (meta: SessionMeta | null) => void;
	clearSessionMeta: () => void;

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
	setupInitialized: boolean;
	setupCourtCount: number;
	setupSingleWomanIds: Set<string>;
	setupSelectedIds: Set<string>;
	setupGuests: Player[];

	setSetupCourtCount: (count: number) => void;
	setSetupSingleWomanIds: (
		updater: Set<string> | ((prev: Set<string>) => Set<string>),
	) => void;
	setSetupSelectedIds: (
		updater: Set<string> | ((prev: Set<string>) => Set<string>),
	) => void;
	setSetupGuests: (updater: Player[] | ((prev: Player[]) => Player[])) => void;
	setSetupInitialized: (v: boolean) => void;
	resetSetupState: () => void;
}

export const useAppStore = create<AppState>((set, get) => ({
	allPlayers: [],
	scriptUrl: "",
	savedNames: null,
	sessionMeta: null,
	_sessionWatchChannel: null,

	setAllPlayers: (players) => set({ allPlayers: players }),
	setScriptUrl: (url) => set({ scriptUrl: url }),
	setSavedNames: (names) => set({ savedNames: names }),
	setSessionMeta: (meta) => set({ sessionMeta: meta }),
	clearSessionMeta: () => set({ sessionMeta: null }),

	setupInitialized: false,
	setupCourtCount: 2,
	setupSingleWomanIds: new Set(),
	setupSelectedIds: new Set(),
	setupGuests: [],

	setSetupInitialized: (v) => set({ setupInitialized: v }),
	setSetupCourtCount: (count) => set({ setupCourtCount: count }),
	setSetupSingleWomanIds: (updater) =>
		set((state) => ({
			setupSingleWomanIds:
				typeof updater === "function"
					? updater(state.setupSingleWomanIds)
					: updater,
		})),
	setSetupSelectedIds: (updater) =>
		set((state) => ({
			setupSelectedIds:
				typeof updater === "function"
					? updater(state.setupSelectedIds)
					: updater,
		})),
	setSetupGuests: (updater) =>
		set((state) => ({
			setupGuests:
				typeof updater === "function" ? updater(state.setupGuests) : updater,
		})),
	resetSetupState: () =>
		set({
			setupInitialized: false,
			setupCourtCount: 2,
			setupSingleWomanIds: new Set(),
			setupSelectedIds: new Set(),
			setupGuests: [],
		}),

	fetchPlayersAction: async () => {
		const players = await fetchPlayers(ENV_SHEET_ID, ENV_API_KEY);
		set({ allPlayers: players, scriptUrl: ENV_SCRIPT_URL });
	},

	loadSessionAction: async (row: SessionRow) => {
		try {
			const [snapshot, players] = await Promise.all([
				fetchSessionSnapshot(row.id),
				fetchPlayers(ENV_SHEET_ID, ENV_API_KEY).catch(() => [] as Player[]),
			]);
			if (!snapshot) return false;
			const initialState = snapshotToClientState(snapshot);
			const singleWomanIds = snapshot.players
				.filter((p) => p.allowMixedSingle)
				.map((p) => p.playerId);

			if (players.length > 0) {
				set({
					allPlayers: players,
					scriptUrl: row.script_url ?? ENV_SCRIPT_URL,
				});
			}

			set({
				savedNames: new Set(snapshot.players.map((p) => p.name)),
				sessionMeta: {
					sessionId: row.id,
					courtCount: row.court_count,
					singleWomanIds,
					initialState,
				},
				// Sync remote settings to local setup state
				setupInitialized: true,
				setupCourtCount: row.court_count,
				setupSingleWomanIds: new Set(singleWomanIds),
				setupSelectedIds: new Set(snapshot.players.map((p) => p.playerId)),
			});
			return true;
		} catch (e) {
			console.error("Failed to load session:", e);
			return false;
		}
	},

	checkActiveSessionAction: async () => {
		const row = await fetchActiveSession();
		if (row?.is_active) {
			return await get().loadSessionAction(row);
		}
		return false;
	},

	startOrUpdateSessionAction: async (
		selected: Player[],
		settings: SessionSettings,
	) => {
		const { scriptUrl, sessionMeta } = get();
		if (sessionMeta) {
			const success = await updateSession(
				sessionMeta.sessionId,
				settings.courtCount,
				selected,
				settings.singleWomanIds,
			);
			if (!success) return false;

			const snapshot = await fetchSessionSnapshot(sessionMeta.sessionId);
			if (snapshot) {
				const initialState = snapshotToClientState(snapshot);
				set({
					sessionMeta: {
						sessionId: sessionMeta.sessionId,
						courtCount: settings.courtCount,
						singleWomanIds: settings.singleWomanIds,
						initialState,
					},
					setupInitialized: true,
					setupCourtCount: settings.courtCount,
					setupSingleWomanIds: new Set(settings.singleWomanIds),
				});
			}
			return true;
		}

		const result = await startSession(
			settings.courtCount,
			scriptUrl || null,
			selected,
			settings.singleWomanIds,
		);
		if (!result) return false;

		const { sessionId, sessionPlayers } = result;
		const courts = Array.from({ length: settings.courtCount }, (_, i) => ({
			id: i + 1,
			match: null as null,
		}));
		const initialState: ClientSessionState = {
			courts,
			waiting: sessionPlayers,
			resting: [],
			reservedGroups: [],
			pairHistory: {},
		};

		set({
			sessionMeta: {
				sessionId,
				courtCount: settings.courtCount,
				singleWomanIds: settings.singleWomanIds,
				initialState,
			},
			setupInitialized: true,
			setupCourtCount: settings.courtCount,
			setupSingleWomanIds: new Set(settings.singleWomanIds),
		});
		return true;
	},

	updatePlayerAction: async (player: Player) => {
		const { scriptUrl, allPlayers } = get();
		try {
			if (OAUTH_AVAILABLE) {
				const token = await requestAccessToken();
				await updatePlayerWithToken(
					token,
					player.name,
					player.gender,
					player.skills,
				);
			} else if (scriptUrl) {
				await updatePlayer(
					scriptUrl,
					player.name,
					player.gender,
					player.skills,
				);
			} else {
				throw new Error(
					"저장 방법이 설정되지 않았습니다 (OAuth Client ID 또는 Script URL 필요)",
				);
			}
			set({
				allPlayers: allPlayers.map((p) => (p.id === player.id ? player : p)),
			});
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
