import { useCallback, useEffect, useRef } from "react";
import { Navigate, Route, Routes, useNavigate } from "react-router-dom";
import SessionBoard from "./components/board/SessionBoard";
import Toaster from "./components/common/Toaster";
import Home from "./components/Home";
import LogPage from "./components/LogPage";
import SessionSetup from "./components/SessionSetup";
import MemberAdminPage from "./components/admin/MemberAdminPage";
import RegularNoticePage from "./components/schedule/RegularNoticePage";
import SchedulePage from "./components/schedule/SchedulePage";
import { useDarkMode } from "./hooks/useDarkMode";
import { usePageVisibility } from "./hooks/usePageVisibility";
import type { SessionRow } from "./lib/supabase";
import { supabase } from "./lib/supabase";
import {
	notificationContext,
	notificationMessage,
	subscribeNotifications,
} from "./lib/supabase/notifications";
import { appActions, useAppStore } from "./store/appStore";
import { authActions, useAuthStore } from "./store/authStore";
import { notificationActions } from "./store/notificationStore";
import { pushActions } from "./store/pushStore";
import { scheduleActions, useScheduleStore } from "./store/scheduleStore";
import { useSessionStore } from "./store/sessionStore";
import { toast } from "./store/toastStore";
import type { Player, SessionSettings } from "./types";

export default function App() {
	const navigate = useNavigate();
	const navRef = useRef(navigate);
	// 최신 navigate를 ref에 동기화(렌더 중 ref 변경 금지 → effect로)
	useEffect(() => {
		navRef.current = navigate;
	});

	useDarkMode();

	// 인증 세션 초기화/복원 (Phase 1: RLS 무변경, 로그인 기능만 도입)
	useEffect(() => {
		authActions.init();
	}, []);

	// 웹푸시: SW 멱등 등록 + 현재 권한/구독 상태 동기화(권한요청 없음)
	useEffect(() => {
		void pushActions.init();
	}, []);

	// 푸시 알림 클릭(SW) → 앱이 이미 열려 있으면 해당 경로로 라우팅
	useEffect(() => {
		if (!("serviceWorker" in navigator)) return;
		const onMsg = (e: MessageEvent) => {
			if (e.data?.type !== "push-navigate" || typeof e.data.url !== "string")
				return;
			try {
				const path = new URL(e.data.url).pathname;
				const base = import.meta.env.BASE_URL;
				const route = path.startsWith(base)
					? `/${path.slice(base.length)}`
					: path;
				navRef.current(route || "/");
			} catch {
				navRef.current("/");
			}
		};
		navigator.serviceWorker.addEventListener("message", onMsg);
		return () => navigator.serviceWorker.removeEventListener("message", onMsg);
	}, []);

	// 앱내 실시간 알림 (Phase 8): 자동승급·공지 → 종모양 목록 + 토스트
	const memberId = useAuthStore((s) => s.memberId);
	useEffect(() => {
		if (!memberId) {
			notificationActions.clear();
			return;
		}
		void notificationActions.load(memberId);
		const ch = subscribeNotifications(memberId, (n) => {
			notificationActions.pushRealtime(n);
			const { schedules, places } = useScheduleStore.getState();
			toast(notificationMessage(n, notificationContext(n, schedules, places)), {
				variant: "success",
				duration: 6000,
			});
			// 알림이 의미하는 일정/참석 변경을 화면에 반영(재쿼리)
			void scheduleActions.load();
		});
		return () => {
			supabase.removeChannel(ch);
		};
	}, [memberId]);

	const allPlayers = useAppStore((s) => s.allPlayers);
	const sessionMeta = useAppStore((s) => s.sessionMeta);
	const sessionChecked = useAppStore((s) => s.sessionChecked);

	const initialPathRef = useRef(window.location.pathname);

	// snapshot 로드 → 상태 설정 → navigate (setup 화면이 아닌 경우)
	const applySession = useCallback(async (row: SessionRow) => {
		const success = await appActions.loadSession(row);
		if (success && !window.location.pathname.includes("/setup")) {
			navRef.current("/session", { replace: true });
		}
	}, []);

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

	// 페이지가 다시 활성화되었을 때(백그라운드 -> 포그라운드) 자동 재동기화.
	// 백그라운드 동안 realtime broadcast/postgres_changes 를 놓쳤을 수 있으므로 권위 상태를 다시 읽는다.
	const isVisible = usePageVisibility();
	const wasVisibleRef = useRef(true);
	useEffect(() => {
		if (isVisible && !wasVisibleRef.current) {
			appActions.checkActiveSession();
			const mid = useAuthStore.getState().memberId;
			if (mid) {
				// 알림 + 일정/참석 갱신
				void notificationActions.load(mid);
				void scheduleActions.load();
			}
			// 보드 활성 중이면 코트 배정·보드 멤버십 권위 재조회(놓친 매치/팀 변경 수렴)
			if (useAppStore.getState().sessionMeta) {
				void useSessionStore.getState().resyncFromServer({ indicate: true });
			}
		}
		wasVisibleRef.current = isVisible;
	}, [isVisible]);

	// 다른 클라이언트의 세션 시작/종료 감지
	useEffect(() => {
		appActions.subscribeSessionWatch({
			onSessionStart: async (row) => {
				if (window.location.pathname.includes("/setup")) return;
				if (useAppStore.getState().sessionMeta?.sessionId === row.id) return;
				await applySession(row);
			},
			onSessionEnd: (endedSessionId) => {
				if (useAppStore.getState().sessionMeta?.sessionId === endedSessionId) {
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
			<div className="md:max-w-sm md:mx-auto app-shell-minh flex items-center justify-center">
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
				<Route path="/session" element={sessionGuarded(<SessionBoard />)} />
				<Route path="/schedule" element={<SchedulePage />} />
				<Route path="/notice/:sessionId" element={<RegularNoticePage />} />
				<Route path="/members" element={<MemberAdminPage />} />
				<Route path="/logs" element={<LogPage />} />
				<Route path="*" element={<Navigate to="/" replace />} />
			</Routes>
			<Toaster />
		</div>
	);
}
