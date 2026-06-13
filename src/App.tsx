import { useCallback, useEffect, useRef } from "react";
import {
	Navigate,
	Route,
	Routes,
	useLocation,
	useNavigate,
} from "react-router-dom";
import SessionBoard from "./components/board/SessionBoard";
import Toaster from "./components/common/Toaster";
import Home from "./components/Home";
import LogPage from "./components/LogPage";
import SessionSetup from "./components/SessionSetup";
import { usePageVisibility } from "./hooks/usePageVisibility";
import type { SessionRow } from "./lib/supabase";
import { appActions, useAppStore } from "./store/appStore";
import { useSessionStore } from "./store/sessionStore";
import type { Player, SessionSettings } from "./types";

export default function App() {
	const navigate = useNavigate();
	const navRef = useRef(navigate);
	navRef.current = navigate;

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
	const sessionMeta = useAppStore((s) => s.sessionMeta);
	const sessionChecked = useAppStore((s) => s.sessionChecked);

	const sessionMetaRef = useRef<number | null>(null);
	const initialPathRef = useRef(window.location.pathname);
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
			const success = await appActions.loadSession(row);
			const path = currentPathRef.current;
			if (success && !path.includes("/setup")) {
				navRef.current("/session", { replace: true });
			}
		},
		[],
	);

	// 마운트 시 활성 세션 확인 → 초기 URL이 홈(/)일 때만 세션 페이지로 자동 이동.
	// setup/session 등 특정 경로로 진입했다면 그 경로 유지.
	useEffect(() => {
		async function check() {
			const hasActive = await appActions.checkActiveSession();
			if (hasActive && initialPathRef.current === "/") {
				navRef.current("/session", { replace: true });
			}
		}
		check();
	}, []);

	// 페이지가 다시 활성화되었을 때(백그라운드 -> 포그라운드) 세션 동기화
	const isVisible = usePageVisibility();
	const wasVisibleRef = useRef(true);
	useEffect(() => {
		if (isVisible && !wasVisibleRef.current) {
			appActions.checkActiveSession();
		}
		wasVisibleRef.current = isVisible;
	}, [isVisible]);

	// 다른 클라이언트의 세션 시작/종료 감지
	useEffect(() => {
		appActions.subscribeSessionWatch({
			onSessionStart: async (row) => {
				if (currentPathRef.current.includes("/setup")) return;
				if (sessionMetaRef.current === row.id) return;
				if (useAppStore.getState().sessionMeta?.sessionId === row.id) return;
				await applySession(row);
			},
			onSessionEnd: (endedSessionId) => {
				if (sessionMetaRef.current === endedSessionId) {
					appActions.setSessionMeta(null);
					useSessionStore.getState().reset();
					appActions.resetSetupState();
					navRef.current("/", { replace: true });
				}
			},
		});

		return () => {
			appActions.unsubscribeSessionWatch();
		};
	}, [applySession]);

	const handleHomeStart = useCallback(() => {
		navRef.current("/setup");
	}, []);

	const handleSetupStart = useCallback(
		async (selected: Player[], settings: SessionSettings) => {
			const success = await appActions.startOrUpdateSession(selected, settings);
			if (success) {
				navRef.current("/session");
			}
		},
		[],
	);

	if (!sessionChecked) {
		return (
			<div className="md:max-w-sm md:mx-auto min-h-[100dvh] flex items-center justify-center">
				<p className="text-gray-400 dark:text-gray-500 text-sm">연결 중...</p>
			</div>
		);
	}

	// sessionChecked와 sessionMeta는 같은 zustand set()에 묶여 있어 한 렌더에 반영됨.
	// checked=true && sessionMeta=null은 "세션 없음 확정" 상태.
	const sessionGuarded = (element: React.ReactNode) =>
		sessionMeta ? element : <Navigate to="/" replace />;

	return (
		<div className="md:max-w-sm md:mx-auto md:shadow-[0_0_80px_rgba(0,0,0,0.4)]">
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
					element={sessionGuarded(<SessionBoard />)}
				/>
				<Route
					path="/session/board"
					element={<Navigate to="/session" replace />}
				/>
				<Route path="/logs" element={<LogPage />} />
				<Route path="*" element={<Navigate to="/" replace />} />
			</Routes>
			<Toaster />
		</div>
	);
}
