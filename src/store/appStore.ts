import type { RealtimeChannel } from "@supabase/supabase-js";
import { create } from "zustand";
import { OAUTH_AVAILABLE, requestAccessToken } from "../lib/googleAuth";
import {
	fetchPlayers,
	updatePlayer,
	updatePlayerWithToken,
} from "../lib/sheetsApi";
import {
	dbUpdateSessionPlayer,
	fetchActiveSession,
	fetchSessionSnapshot,
	type SessionRow,
	sendBroadcast,
	snapshotToClientState,
	startSession,
	supabase,
	updateSession,
} from "../lib/supabaseClient";
import type { Player, SessionSettings } from "../types";
import { useSessionStore } from "./sessionStore";

const ENV_SHEET_ID = import.meta.env.VITE_SHEET_ID as string;
const ENV_API_KEY = import.meta.env.VITE_API_KEY as string;
const ENV_SCRIPT_URL = (import.meta.env.VITE_SCRIPT_URL as string) ?? "";

export interface SessionMeta {
	sessionId: number;
	courtCount: number;
	singleWomanIds: string[];
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

			const clientState = snapshotToClientState(snapshot);
			const singleWomanIds = snapshot.players
				.filter((p) => p.allowMixedSingle)
				.map((p) => p.playerId);

			if (players.length > 0) {
				set({
					allPlayers: players,
					scriptUrl: row.script_url ?? ENV_SCRIPT_URL,
				});
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
				savedNames: new Set(snapshot.players.map((p) => p.name)),
				sessionMeta: {
					sessionId: row.id,
					courtCount: row.court_count,
					singleWomanIds,
				},
				setupInitialized: true,
				setupCourtCount: row.court_count,
				setupSingleWomanIds: new Set(singleWomanIds),
				setupSelectedIds: new Set(snapshot.players.map((p) => p.playerId)),
				setupGuests: guests,
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
			// 현재 sessionStore 상태에서 플레이어 ID 목록 수집
			const { waiting, resting, courts, reservedGroups } =
				useSessionStore.getState();
			const currentPlayerIds = new Set([
				...waiting.map((p) => p.playerId),
				...resting.map((p) => p.playerId),
				...courts
					.flatMap((c) =>
						c.match ? [...c.match.teamA, ...c.match.teamB] : [],
					)
					.map((p) => p.playerId),
				...reservedGroups.flatMap((g) => g.players).map((p) => p.playerId),
			]);
			const selectedIdSet = new Set(selected.map((p) => p.id));
			const removedPlayerIds = [...currentPlayerIds].filter(
				(id) => !selectedIdSet.has(id),
			);

			const success = await updateSession(
				sessionMeta.sessionId,
				settings.courtCount,
				selected,
				settings.singleWomanIds,
			);
			if (!success) return false;

			// 추가된 플레이어는 DB에서 가져온 값 사용 (wait_since 등 서버 값 필요)
			const snapshot = await fetchSessionSnapshot(sessionMeta.sessionId);
			if (!snapshot) return false;

			const clientState = snapshotToClientState(snapshot);
			const addedPlayers = clientState.waiting.filter(
				(p) => !currentPlayerIds.has(p.playerId),
			);

			// sessionStore에 설정 변경 반영 + broadcast로 다른 클라이언트에 전파
			useSessionStore.getState().syncSettings(
				settings.courtCount,
				settings.singleWomanIds,
				addedPlayers,
				removedPlayerIds,
			);

			set({
				sessionMeta: {
					sessionId: sessionMeta.sessionId,
					courtCount: settings.courtCount,
					singleWomanIds: settings.singleWomanIds,
				},
				setupInitialized: true,
				setupCourtCount: settings.courtCount,
				setupSingleWomanIds: new Set(settings.singleWomanIds),
				setupSelectedIds: new Set(snapshot.players.map((p) => p.playerId)),
			});
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

		// 새 세션의 초기 상태를 sessionStore에 직접 설정
		useSessionStore.getState().initialize({
			courts,
			waiting: sessionPlayers,
			resting: [],
			reservedGroups: [],
			pairHistory: {},
		});

		set({
			sessionMeta: {
				sessionId,
				courtCount: settings.courtCount,
				singleWomanIds: settings.singleWomanIds,
			},
			setupInitialized: true,
			setupCourtCount: settings.courtCount,
			setupSingleWomanIds: new Set(settings.singleWomanIds),
			setupSelectedIds: new Set(selected.map((p) => p.id)),
		});
		return true;
	},

	updatePlayerAction: async (player: Player) => {
		const { scriptUrl, sessionMeta } = get();
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
						scriptUrl &&
						e instanceof Error &&
						(e.message.includes("광고 차단기") || e.message.includes("초기화 실패"))
					) {
						console.warn("OAuth 실패, Script URL로 대체 시도:", e.message);
						await updatePlayer(
							scriptUrl,
							player.name,
							player.gender,
							player.skills,
						);
					} else {
						throw e;
					}
				}
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

			if (sessionMeta) {
				// 세션 참가 중인 플레이어인지 확인
				const { waiting, resting, courts } = useSessionStore.getState();
				const sessionPlayer = [
					...waiting,
					...resting,
					...courts.flatMap((c) =>
						c.match ? [...c.match.teamA, ...c.match.teamB] : [],
					),
				].find((p) => p.playerId === player.id);

				if (sessionPlayer) {
					// session_players DB 업데이트 + broadcast
					const updated = await dbUpdateSessionPlayer(
						sessionPlayer.id,
						player.gender,
						player.skills,
					);
					if (updated) {
						useSessionStore.getState().applyBroadcast(
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
					return true;
				}
			}

			// 세션 미참가: allPlayers 캐시만 갱신
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
