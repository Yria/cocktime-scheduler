import { useCallback, useEffect, useRef, useState } from "react";
import { Navigate, Route, Routes, useNavigate } from "react-router-dom";
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

	const currentPathRef = useRef(window.location.pathname);

	// pathname 변경 추적
	useEffect(() => {
		currentPathRef.current = window.location.pathname;
	});

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
				navigate("/session", { replace: true });
			}
			setSessionLoading(false);
		}
		checkActiveSession();
	}, []); // eslint-disable-line react-hooks/exhaustive-deps

	// Realtime 구독: 다른 사용자가 세션 시작/종료 시 자동 전환
	useEffect(() => {
		const channel = supabase
			.channel("app-session-changes")
			.on(
				"postgres_changes",
				{
					event: "UPDATE",
					schema: "public",
					table: "sessions",
					filter: "id=eq.1",
				},
				(payload) => {
					const row = payload.new as SessionRow;
					if (row.last_client_id === CLIENT_ID) return;

					if (row.is_active && row.init_data) {
						// 이미 세션 중이면 setSessionInit 호출 안 함 (무한루프 방지)
						// SessionMain이 자체 Realtime 구독으로 state 동기화를 처리함
						const isOnSession = currentPathRef.current.includes("/session");
						if (!isOnSession) {
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
							navigate("/session", { replace: true });
						}
					} else if (!row.is_active) {
						setSavedNames(null);
						setSessionInit(null);
						setInitialStateData(null);
						navigate("/", { replace: true });
					}
				},
			)
			.subscribe();

		return () => {
			supabase.removeChannel(channel);
		};
	}, []); // eslint-disable-line react-hooks/exhaustive-deps

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
			await startSession(initData, CLIENT_ID);

			setInitialStateData(null);
			setSessionInit({ selected, settings });
			navigate("/session");
		},
		[allPlayers, scriptUrl, navigate],
	);

	const handleSessionEnd = useCallback(async () => {
		await endSession(CLIENT_ID);

		localStorage.removeItem(SAVE_KEY);
		setSavedNames(null);
		setSessionInit(null);
		setInitialStateData(null);
		navigate("/setup");
	}, [navigate]);

	const handleUpdatePlayer = useCallback((updated: Player) => {
		setAllPlayers((prev) =>
			prev.map((p) => (p.id === updated.id ? updated : p)),
		);
	}, []);

	const handleSetupBack = useCallback(() => {
		navigate("/");
	}, [navigate]);

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
								onUpdatePlayer={handleUpdatePlayer}
								onStart={handleSetupStart}
								onBack={handleSetupBack}
							/>
						) : (
							<Navigate to="/" replace />
						)
					}
				/>
				<Route
					path="/session"
					element={
						sessionInit ? (
							<SessionMain
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
