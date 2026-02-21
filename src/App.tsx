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
import type { SessionRow } from "./lib/supabaseClient";
import { useAppStore } from "./store/appStore";
import type { Player, SessionSettings } from "./types";

const SAVE_KEY = "bmt_session_players";

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

	const allPlayers = useAppStore((s) => s.allPlayers);
	const setSavedNames = useAppStore((s) => s.setSavedNames);
	const sessionMeta = useAppStore((s) => s.sessionMeta);
	const setSessionMeta = useAppStore((s) => s.setSessionMeta);
	const loadSessionAction = useAppStore((s) => s.loadSessionAction);
	const checkActiveSessionAction = useAppStore(
		(s) => s.checkActiveSessionAction,
	);
	const startOrUpdateSessionAction = useAppStore(
		(s) => s.startOrUpdateSessionAction,
	);

	const [sessionLoading, setSessionLoading] = useState(true);

	const sessionMetaRef = useRef<number | null>(null);
	const currentPathRef = useRef(window.location.pathname);
	const location = useLocation();

	useEffect(() => {
		currentPathRef.current = location.pathname;
	}, [location.pathname]);

	useEffect(() => {
		sessionMetaRef.current = sessionMeta ? sessionMeta.sessionId : null;
	}, [sessionMeta]);

	// snapshot 로드 → 상태 설정 → navigate (setup 화면이 아닌 경우)
	const applySession = useCallback(
		async (row: SessionRow) => {
			const success = await loadSessionAction(row);
			if (success && !currentPathRef.current.includes("/setup")) {
				navigate("/session", { replace: true });
			}
		},
		[navigate, loadSessionAction],
	);

	// 마운트 시 활성 세션 확인 → 홈(/)에서만 세션 페이지로 자동 이동
	useEffect(() => {
		async function checkActiveSession() {
			const hasActive = await checkActiveSessionAction();
			if (hasActive && currentPathRef.current === "/") {
				navigate("/session", { replace: true });
			}
			setSessionLoading(false);
		}
		checkActiveSession();
	}, [checkActiveSessionAction, navigate]);

	// 다른 클라이언트의 세션 시작/종료 감지
	const subscribeSessionWatch = useAppStore((s) => s.subscribeSessionWatch);
	const unsubscribeSessionWatch = useAppStore((s) => s.unsubscribeSessionWatch);

	useEffect(() => {
		subscribeSessionWatch({
			onSessionStart: async (row) => {
				// setup 화면에서 직접 설정 중이면 무시 (본인이 업데이트 중)
				if (currentPathRef.current.includes("/setup")) return;
				// 같은 세션이든 다른 세션이든 활성 세션 데이터 리로드
				await applySession(row);
			},
			onSessionEnd: (endedSessionId) => {
				if (sessionMetaRef.current === endedSessionId) {
					setSavedNames(null);
					setSessionMeta(null);
					navigate("/", { replace: true });
				}
			},
		});

		return () => {
			unsubscribeSessionWatch();
		};
	}, [
		navigate,
		setSessionMeta,
		applySession,
		setSavedNames,
		subscribeSessionWatch,
		unsubscribeSessionWatch,
	]);

	const handleHomeStart = useCallback(() => {
		setSavedNames(loadSavedNames());
		navigate("/setup");
	}, [navigate, setSavedNames]);

	const handleSetupStart = useCallback(
		async (selected: Player[], settings: SessionSettings) => {
			localStorage.setItem(
				SAVE_KEY,
				JSON.stringify(selected.map((p) => p.name)),
			);

			const success = await startOrUpdateSessionAction(selected, settings);
			if (success) {
				navigate("/session");
			}
		},
		[navigate, startOrUpdateSessionAction],
	);

	const handleSessionEnd = useCallback(() => {
		localStorage.removeItem(SAVE_KEY);
		setSavedNames(null);
		setSessionMeta(null);
		navigate("/setup");
	}, [navigate, setSessionMeta, setSavedNames]);

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
						allPlayers.length > 0 || !!sessionMeta ? (
							<SessionSetup onStart={handleSetupStart} />
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
