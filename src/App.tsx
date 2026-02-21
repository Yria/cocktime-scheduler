import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	Navigate,
	Route,
	Routes,
	useLocation,
	useNavigate,
} from "react-router-dom";
import Home from "./components/Home";
import SessionMain from "./components/SessionMain";
import SessionSetup from "./components/SessionSetup";
import { fetchPlayers } from "./lib/sheetsApi";
import {
	type ClientSessionState,
	fetchActiveSession,
	fetchSessionSnapshot,
	type SessionRow,
	snapshotToClientState,
	startSession,
	supabase,
} from "./lib/supabaseClient";
import type { Player, SessionSettings } from "./types";

interface SessionMeta {
	sessionId: number;
	courtCount: number;
	singleWomanIds: string[];
	initialState: ClientSessionState;
}

const SAVE_KEY = "bmt_session_players";

const ENV_SHEET_ID = import.meta.env.VITE_SHEET_ID as string;
const ENV_API_KEY = import.meta.env.VITE_API_KEY as string;
const ENV_SCRIPT_URL = (import.meta.env.VITE_SCRIPT_URL as string) ?? "";

const CLIENT_ID = crypto.randomUUID();

function loadSavedNames(): Set<string> | null {
	try {
		const raw = localStorage.getItem(SAVE_KEY);
		if (!raw) return null;
		return new Set(JSON.parse(raw) as string[]);
	} catch {
		return null;
	}
}

export default function App() {
	const navigate = useNavigate();

	useEffect(() => {
		const mq = window.matchMedia("(prefers-color-scheme: dark)");
		const apply = (dark: boolean) => {
			document.documentElement.classList.toggle("dark", dark);
		};
		apply(mq.matches);
		const handler = (e: MediaQueryListEvent) => apply(e.matches);
		mq.addEventListener("change", handler);
		return () => mq.removeEventListener("change", handler);
	}, []);

	const [allPlayers, setAllPlayers] = useState<Player[]>([]);
	const [scriptUrl, setScriptUrl] = useState("");
	const [savedNames, setSavedNames] = useState<Set<string> | null>(null);
	const [sessionMeta, setSessionMeta] = useState<SessionMeta | null>(null);
	const [sessionLoading, setSessionLoading] = useState(true);

	const sessionMetaRef = useRef<SessionMeta | null>(null);
	const currentPathRef = useRef(window.location.pathname);
	const location = useLocation();

	useEffect(() => {
		currentPathRef.current = location.pathname;
	}, [location.pathname]);

	const updateSessionMeta = useCallback((meta: SessionMeta | null) => {
		setSessionMeta(meta);
		sessionMetaRef.current = meta;
	}, []);

	// snapshot 로드 → 상태 설정 → navigate (setup 화면이 아닌 경우)
	const applySession = useCallback(
		async (row: SessionRow) => {
			const [snapshot, players] = await Promise.all([
				fetchSessionSnapshot(row.id),
				fetchPlayers(ENV_SHEET_ID, ENV_API_KEY).catch(() => [] as Player[]),
			]);
			if (!snapshot) return;
			const initialState = snapshotToClientState(snapshot);
			const singleWomanIds = snapshot.players
				.filter((p) => p.allowMixedSingle)
				.map((p) => p.playerId);

			// 전체 플레이어 목록 + scriptUrl 복원
			if (players.length > 0) {
				setAllPlayers(players);
				setScriptUrl(row.script_url ?? ENV_SCRIPT_URL);
			}
			// 세션 참여자 이름으로 savedNames 설정 → SessionSetup에서 해당 인원만 체크
			setSavedNames(new Set(snapshot.players.map((p) => p.name)));

			updateSessionMeta({
				sessionId: row.id,
				courtCount: row.court_count,
				singleWomanIds,
				initialState,
			});
			if (!currentPathRef.current.includes("/setup")) {
				navigate("/session", { replace: true });
			}
		},
		[navigate, updateSessionMeta, setAllPlayers, setScriptUrl, setSavedNames],
	);

	// 마운트 시 활성 세션 확인
	useEffect(() => {
		async function checkActiveSession() {
			const row = await fetchActiveSession();
			if (row?.is_active) {
				await applySession(row);
			}
			setSessionLoading(false);
		}
		checkActiveSession();
	}, [applySession]);

	// 다른 클라이언트의 세션 시작/종료 감지
	useEffect(() => {
		const channel = supabase
			.channel("app-session-watch")
			.on(
				"postgres_changes",
				{ event: "*", schema: "public", table: "sessions" },
				async (payload) => {
					const row = payload.new as SessionRow;
					if (!row || !row.id) return;

					if (row.is_active) {
						// 이미 이 세션을 보고 있으면 무시
						if (row.id === sessionMetaRef.current?.sessionId) return;
						// setup 화면에서 직접 설정 중이면 무시
						if (currentPathRef.current.includes("/setup")) return;

						await applySession(row);
					} else if (!row.is_active) {
						if (sessionMetaRef.current?.sessionId === row.id) {
							setSavedNames(null);
							updateSessionMeta(null);
							navigate("/", { replace: true });
						}
					}
				},
			)
			.subscribe();

		return () => {
			supabase.removeChannel(channel);
		};
	}, [navigate, updateSessionMeta, applySession]);

	const handleHomeStart = useCallback(
		(players: Player[], url: string) => {
			setAllPlayers(players);
			setScriptUrl(url);
			setSavedNames(loadSavedNames());
			navigate("/setup");
		},
		[navigate],
	);

	const handleSetupStart = useCallback(
		async (selected: Player[], settings: SessionSettings) => {
			localStorage.setItem(
				SAVE_KEY,
				JSON.stringify(selected.map((p) => p.name)),
			);

			const result = await startSession(
				settings.courtCount,
				scriptUrl || null,
				selected,
				settings.singleWomanIds,
			);
			if (!result) return;

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

			updateSessionMeta({
				sessionId,
				courtCount: settings.courtCount,
				singleWomanIds: settings.singleWomanIds,
				initialState,
			});
			navigate("/session");
		},
		[scriptUrl, navigate, updateSessionMeta],
	);

	const handleSessionEnd = useCallback(() => {
		localStorage.removeItem(SAVE_KEY);
		setSavedNames(null);
		updateSessionMeta(null);
		navigate("/setup");
	}, [navigate, updateSessionMeta]);

	const handleUpdatePlayer = useCallback((updated: Player) => {
		setAllPlayers((prev) =>
			prev.map((p) => (p.id === updated.id ? updated : p)),
		);
	}, []);

	const handleSessionBack = useCallback(() => {
		navigate("/setup");
	}, [navigate]);

	// 전체 목록(allPlayers)이 있으면 우선 사용, 없으면 세션 참여자로 fallback
	const setupPlayers = useMemo(() => {
		if (allPlayers.length > 0) return allPlayers;
		if (!sessionMeta) return [];
		const { waiting, resting, courts, reservedGroups } =
			sessionMeta.initialState;
		const playingPlayers = courts.flatMap((c) =>
			c.match ? [...c.match.teamA, ...c.match.teamB] : [],
		);
		const reservedPlayers = reservedGroups.flatMap((g) => g.players);
		const playerMap = new Map<string, Player>();
		for (const sp of [
			...waiting,
			...resting,
			...playingPlayers,
			...reservedPlayers,
		]) {
			if (!playerMap.has(sp.playerId)) {
				playerMap.set(sp.playerId, {
					id: sp.playerId,
					name: sp.name,
					gender: sp.gender,
					skills: sp.skills,
				});
			}
		}
		return Array.from(playerMap.values());
	}, [allPlayers, sessionMeta]);

	if (sessionLoading) {
		return (
			<div className="md:max-w-sm md:mx-auto min-h-[100dvh] flex items-center justify-center">
				<p className="text-gray-400 dark:text-gray-500 text-sm">연결 중...</p>
			</div>
		);
	}

	return (
		<div className="md:max-w-sm md:mx-auto">
			<Routes>
				<Route path="/" element={<Home onStart={handleHomeStart} />} />
				<Route
					path="/setup"
					element={
						setupPlayers.length > 0 || !!sessionMeta ? (
							<SessionSetup
								players={setupPlayers}
								savedNames={savedNames}
								scriptUrl={scriptUrl}
								isUpdating={!!sessionMeta}
								initialCourtCount={sessionMeta?.courtCount}
								initialSingleWomanIds={sessionMeta?.singleWomanIds}
								onUpdatePlayer={handleUpdatePlayer}
								onStart={handleSetupStart}
							/>
						) : (
							<Navigate to="/" replace />
						)
					}
				/>
				<Route
					path="/session"
					element={
						sessionMeta ? (
							<SessionMain
								sessionId={sessionMeta.sessionId}
								courtCount={sessionMeta.courtCount}
								singleWomanIds={sessionMeta.singleWomanIds}
								initialState={sessionMeta.initialState}
								clientId={CLIENT_ID}
								onBack={handleSessionBack}
								onEnd={handleSessionEnd}
							/>
						) : (
							<Navigate to="/" replace />
						)
					}
				/>
				<Route path="*" element={<Navigate to="/" replace />} />
			</Routes>
		</div>
	);
}
