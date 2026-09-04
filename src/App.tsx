import { Suspense, lazy, useCallback, useEffect, useRef } from "react";
import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import SessionBoard from "./components/board/SessionBoard";
import Toaster from "./components/common/Toaster";
import Home from "./components/Home";
import LogPage from "./components/LogPage";
import SessionSetup from "./components/SessionSetup";
import MemberAdminPage from "./components/admin/MemberAdminPage";
import DuesAdminPage from "./components/admin/dues/DuesAdminPage";
import MyDuesPage from "./components/dues/MyDuesPage";
import UnpaidDuesAlert from "./components/dues/UnpaidDuesAlert";
import NewbieFreepassAlert from "./components/schedule/NewbieFreepassAlert";
// 개발 전용 VFX 비교 화면 — lazy 라 프로덕션 번들에 본문이 들어가지 않는다(별 청크로 분리되고
// import.meta.env.DEV 가드 때문에 절대 요청되지 않는다).
const VfxLabPage = lazy(() => import("./components/vfx/VfxLabPage"));
import RegularNoticePage from "./components/schedule/RegularNoticePage";
import SchedulePage from "./components/schedule/SchedulePage";
import { useDarkMode } from "./hooks/useDarkMode";
import { usePageVisibility } from "./hooks/usePageVisibility";
import { refreshPlayerPhotoIndex } from "./lib/playerPhoto";
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
	const location = useLocation();
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

	// 사진 인덱스(누가 사진을 갖고 있나)를 로그인 후 1회 받아둔다. 이게 없으면 사진 없는 회원마다
	// Storage 404 를 매 렌더 재요청한다(무료 플랜 호출 한도를 태우던 원인).
	useEffect(() => {
		if (!memberId) return;
		void refreshPlayerPhotoIndex();
	}, [memberId]);
	useEffect(() => {
		if (!memberId) {
			notificationActions.clear();
			return;
		}
		void notificationActions.load(memberId);
		const ch = subscribeNotifications(memberId, (n) => {
			notificationActions.pushRealtime(n);
			const { schedules, places } = useScheduleStore.getState();
			// 부정적 알림(강등·취소·마감)은 초록 success 가 아닌 중립 info 로 — 오해 방지.
			const negative = new Set([
				"demoted",
				"session_cancelled",
				"session_closed",
				"dues_unpaid",
			]);
			toast(notificationMessage(n, notificationContext(n, schedules, places)), {
				variant: negative.has(n.type) ? "info" : "success",
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

	// 마운트 시 활성 세션 확인(sessionChecked·sessionMeta 세팅). 자동 이동은 하지 않는다 —
	// 진행 중 세션 입장은 Home의 '진행 중 세션 입장' 버튼(수동)으로만(자동참여 폐지).
	useEffect(() => {
		void appActions.checkActiveSession();
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

	// (앱 전역 session watch 제거 — 자동참여 폐지 + Realtime 감축) 진행 중 세션 입장은 Home 버튼(수동),
	// 세션 종료 시 보드 이탈은 세션 채널(session-meta onEnd)이 담당한다.

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
			<div className="app-card-shell app-shell-minh flex items-center justify-center">
				<p className="text-gray-400 dark:text-gray-500 text-sm">연결 중...</p>
			</div>
		);
	}

	// sessionChecked와 sessionMeta는 같은 zustand set()에 묶여 있어 한 렌더에 반영됨.
	// checked=true && sessionMeta=null은 "세션 없음 확정" 상태.
	const sessionGuarded = (element: React.ReactNode) =>
		sessionMeta ? element : <Navigate to="/" replace />;

	// 보드(자석 세션)는 폭 제한 없이 풀폭(초광각 PC만 1280 상한) — .app-board-shell.
	// 그 외 일반 화면은 md+ 카드 셸(--card-max 폭 + 그림자) — .app-card-shell.
	const isBoard = location.pathname.startsWith("/session");

	return (
		<div className={isBoard ? "app-board-shell" : "app-card-shell"}>
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
				<Route path="/dues" element={<DuesAdminPage />} />
				<Route path="/dues/:ym" element={<DuesAdminPage />} />
				<Route path="/dues/:ym/:page" element={<DuesAdminPage />} />
				<Route path="/my-dues" element={<MyDuesPage />} />
				<Route path="/my-dues/:page" element={<MyDuesPage />} />
				<Route path="/logs" element={<LogPage />} />
				{/* 개발 전용 — 티켓 VFX 비교. 프로덕션 빌드에서는 라우트가 등록되지 않는다
				    (import.meta.env.DEV 가 false 로 접혀 지연 import 가 실행되지 않음). */}
				{import.meta.env.DEV && (
					<Route
						path="/dev/vfx"
						element={
							<Suspense fallback={null}>
								<VfxLabPage />
							</Suspense>
						}
					/>
				)}
				<Route path="*" element={<Navigate to="/" replace />} />
			</Routes>
			{/* 진입 알림 — 앱을 열 때 알려야 할 것들. 조건이 동시에 참이어도 **한 번에 하나만** 뜨고
			    닫으면 다음 것이 그 자리에 뜬다(슬롯 = entryAlertStore, 순서는 그 파일 ORDER).
			    보드(/session)에선 경기 운영 화면을 가리지 않도록 띄우지 않는다. */}
			{!isBoard && (
				<>
					{/* 미납(회비·대관비)·환불 — 납부 내역·계좌 안내 */}
					<UnpaidDuesAlert />
					{/* 신규회원 2주 프리패스 — 만석에도 참여된다는 안내 */}
					<NewbieFreepassAlert />
				</>
			)}
			<Toaster />
		</div>
	);
}
