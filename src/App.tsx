import { useCallback, useEffect, useRef, useState } from "react";
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
import {
	endSession,
	fetchSession,
	type SessionInitData,
	type SessionRow,
	type SessionStateData,
	startSession,
	supabase,
	updateSessionInitData,
} from "./lib/supabaseClient";
import type { Player, SessionSettings } from "./types";

interface SessionInit {
	selected: Player[];
	settings: SessionSettings;
}

const SAVE_KEY = "bmt_session_players";

// 탭마다 고유한 클라이언트 ID (무한루프 방지)
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
	const [sessionInit, setSessionInit] = useState<SessionInit | null>(null);
	const [initialStateData, setInitialStateData] =
		useState<SessionStateData | null>(null);
	const [sessionLoading, setSessionLoading] = useState(true);
	const [activeSessionId, setActiveSessionId] = useState<number | null>(null);

	const currentPathRef = useRef(window.location.pathname);
	const activeSessionIdRef = useRef<number | null>(null);

	const updateActiveSessionId = useCallback((id: number | null) => {
		setActiveSessionId(id);
		activeSessionIdRef.current = id;
	}, []);

	const location = useLocation();

	// pathname 변경 추적 (location.pathname 기반)
	useEffect(() => {
		currentPathRef.current = location.pathname;
	}, [location.pathname]);

	// 마운트 시 Supabase에서 활성 세션 확인
	useEffect(() => {
		async function checkActiveSession() {
			const row = await fetchSession();
			if (row?.is_active && row.init_data) {
				const {
					allPlayers: ap,
					scriptUrl: su,
					selected,
					settings,
				} = row.init_data;
				setAllPlayers(ap);
				setScriptUrl(su);
				setSessionInit({ selected, settings });
				setSavedNames(loadSavedNames());
				if (row.state_data) setInitialStateData(row.state_data);
				updateActiveSessionId(row.id);

				// 만약 이미 세션 설정 화면에 진입한 상태라면 방해(강제이동)하지 않음
				if (!window.location.pathname.includes("/setup")) {
					navigate("/session", { replace: true });
				}
			}
			setSessionLoading(false);
		}
		checkActiveSession();
	}, [navigate, updateActiveSessionId]);

	// Realtime 구독: 다른 사용자가 세션 시작/종료 시 자동 전환
	useEffect(() => {
		const channel = supabase
			.channel("app-session-changes")
			.on(
				"postgres_changes",
				{
					event: "*",
					schema: "public",
					table: "sessions",
				},
				(payload) => {
					const row = payload.new as SessionRow;
					if (!row || !row.id) return;
					if (row.last_client_id === CLIENT_ID) {
						if (
							row.is_active &&
							row.id === activeSessionIdRef.current &&
							row.state_data
						) {
							// Keep initialStateData fresh so if we remount SessionMain, we don't rollback
							setInitialStateData(row.state_data);
						}
						return;
					}

					if (row.is_active && row.init_data) {
						const isOnSession = currentPathRef.current.includes("/session");
						if (!isOnSession) {
							// 사용자가 의도적으로 /setup 화면으로 나간 경우 강제 복귀시키지 않음 (외부 업데이트 무시)
							if (row.id === activeSessionIdRef.current) return;
							if (currentPathRef.current.includes("/setup")) return;

							const {
								allPlayers: ap,
								scriptUrl: su,
								selected,
								settings,
							} = row.init_data;
							setAllPlayers(ap);
							setScriptUrl(su);
							setSessionInit({ selected, settings });
							setSavedNames(loadSavedNames());
							if (row.state_data) setInitialStateData(row.state_data);
							updateActiveSessionId(row.id);
							navigate("/session", { replace: true });
						} else {
							// 이미 /session 화면에 있다면
							if (row.id === activeSessionIdRef.current) {
								setAllPlayers(row.init_data.allPlayers);
								setScriptUrl(row.init_data.scriptUrl);
								setSessionInit({
									selected: row.init_data.selected,
									settings: row.init_data.settings,
								});
							}
						}
					} else if (!row.is_active) {
						if (activeSessionIdRef.current === row.id) {
							setSavedNames(null);
							setSessionInit(null);
							setInitialStateData(null);
							updateActiveSessionId(null);
							navigate("/", { replace: true });
						}
					}
				},
			)
			.subscribe();

		return () => {
			supabase.removeChannel(channel);
		};
	}, [navigate, updateActiveSessionId]);

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

			const initData: SessionInitData = {
				allPlayers,
				scriptUrl,
				selected,
				settings,
			};
			if (activeSessionIdRef.current) {
				await updateSessionInitData(
					activeSessionIdRef.current,
					initData,
					CLIENT_ID,
				);
				setSessionInit({ selected, settings });
				navigate("/session");
			} else {
				const newSession = await startSession(initData, CLIENT_ID);
				if (newSession) {
					updateActiveSessionId(newSession.id);
				}
				setInitialStateData(null);
				setSessionInit({ selected, settings });
				navigate("/session");
			}
		},
		[allPlayers, scriptUrl, navigate, updateActiveSessionId],
	);

	const handleSessionEnd = useCallback(async () => {
		if (activeSessionIdRef.current) {
			await endSession(activeSessionIdRef.current, CLIENT_ID);
		}

		localStorage.removeItem(SAVE_KEY);
		setSavedNames(null);
		setSessionInit(null);
		setInitialStateData(null);
		updateActiveSessionId(null);
		navigate("/setup");
	}, [navigate, updateActiveSessionId]);

	const handleUpdatePlayer = useCallback((updated: Player) => {
		setAllPlayers((prev) =>
			prev.map((p) => (p.id === updated.id ? updated : p)),
		);
	}, []);

	const handleSessionBack = useCallback(() => {
		navigate("/setup");
	}, [navigate]);

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
						allPlayers.length > 0 ? (
							<SessionSetup
								players={allPlayers}
								savedNames={savedNames}
								scriptUrl={scriptUrl}
								initialSelected={sessionInit?.selected}
								initialSettings={sessionInit?.settings}
								isUpdating={!!activeSessionId}
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
						sessionInit && activeSessionId ? (
							<SessionMain
								sessionId={activeSessionId}
								initialPlayers={sessionInit.selected}
								settings={sessionInit.settings}
								initialStateData={initialStateData}
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
