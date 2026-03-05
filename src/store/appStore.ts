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
	sendBroadcast,
	snapshotToClientState,
	startSession,
	supabase,
	updateSession,
	type SessionRow,
} from "../lib/supabaseClient";
import { dbSaveTeamCandidates } from "../lib/supabase/api";
import {
	calculateTeamCandidateCount,
	generateBulkTeamCandidates,
} from "../lib/teamGenerator";
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

	setAllPlayers: (players: Player[]) => void;
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
	sessionMeta: null,
	_sessionWatchChannel: null,

	setAllPlayers: (players) => set({ allPlayers: players }),
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
		const players = await fetchPlayers();
		set({ allPlayers: players });
	},

	loadSessionAction: async (row: SessionRow) => {
		try {
			const [snapshot, players] = await Promise.all([
				fetchSessionSnapshot(row.id),
				fetchPlayers().catch(() => [] as Player[]),
			]);
			if (!snapshot) return false;

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
		const { sessionMeta } = get();

		if (sessionMeta) {
			// 참가자 변경 여부 확인 (팀 후보 재생성 여부 결정)
			const currentPlayerIds = new Set(selected.map((p) => p.id));
			const { waiting, resting, courts } = useSessionStore.getState();
			const currentSessionPlayers = [
				...waiting,
				...resting,
				...courts.flatMap((c) =>
					c.match ? [...c.match.teamA, ...c.match.teamB] : [],
				),
			];
			const previousPlayerIds = new Set(
				currentSessionPlayers.map((p) => p.playerId),
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

			console.log(
				`[updateSession] DB 상태 다시 로드 - waiting: ${clientState.waiting.length}명, resting: ${clientState.resting.length}명`,
			);

			// 참가자가 변경되었을 때만 팀 후보 재생성
			if (playersChanged) {
				console.log("[updateSession] 참가자 변경 감지 → 팀 후보 재생성");
				const candidateCount = calculateTeamCandidateCount(settings.courtCount);
				console.log(`[updateSession] 팀 후보 ${candidateCount}개 생성 중...`);
				const teamCandidates = generateBulkTeamCandidates(
					candidateCount,
					snapshot.players,
					settings.singleWomanIds,
				);
				console.log(
					`[updateSession] 팀 후보 ${teamCandidates.length}개 생성 완료`,
				);
				await dbSaveTeamCandidates(sessionMeta.sessionId, teamCandidates);
				console.log(`[updateSession] 팀 후보 DB 저장 완료`);
				clientState.candidateTeams = teamCandidates;
			} else {
				console.log(
					"[updateSession] 참가자 변경 없음 → 기존 팀 후보 유지",
				);
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
				setupInitialized: true,
				setupCourtCount: settings.courtCount,
				setupSingleWomanIds: new Set(settings.singleWomanIds),
				setupSelectedIds: new Set(snapshot.players.map((p) => p.playerId)),
			});
			return true;
		}

		const result = await startSession(
			settings.courtCount,
			null,
			selected,
			settings.singleWomanIds,
		);
		if (!result) return false;

		const { sessionId, sessionPlayers } = result;
		const courts = Array.from({ length: settings.courtCount }, (_, i) => ({
			id: i + 1,
			match: null as null,
			reserved: null as null,
		}));

		// 팀 후보 대량 생성 및 저장
		const candidateCount = calculateTeamCandidateCount(settings.courtCount);
		console.log(`[startSession] 팀 후보 ${candidateCount}개 생성 중...`);
		const teamCandidates = generateBulkTeamCandidates(
			candidateCount,
			sessionPlayers,
			settings.singleWomanIds,
		);
		console.log(`[startSession] 팀 후보 ${teamCandidates.length}개 생성 완료`);
		await dbSaveTeamCandidates(sessionId, teamCandidates);
		console.log(`[startSession] 팀 후보 DB 저장 완료`);

		// 새 세션의 초기 상태를 sessionStore에 직접 설정
		useSessionStore.getState().initialize({
			courts,
			waiting: sessionPlayers,
			resting: [],
			pairHistory: {},
			candidateTeams: teamCandidates,
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
						(e.message.includes("광고 차단기") || e.message.includes("초기화 실패"))
					) {
						console.warn("OAuth 실패, Edge Function으로 대체 시도:", e.message);
						await updatePlayer(
							player.name,
							player.gender,
							player.skills,
						);
					} else {
						throw e;
					}
				}
			} else {
				await updatePlayer(
					player.name,
					player.gender,
					player.skills,
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
