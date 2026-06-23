import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { startSessionFromSchedule } from "../lib/supabase/schedule";
import type { CarpoolRole } from "../lib/supabase/types";
import { appActions, useAppStore } from "../store/appStore";
import { authActions, useAuthStore } from "../store/authStore";
import { scheduleActions, useScheduleStore } from "../store/scheduleStore";
import AppScreen from "./common/AppScreen";
import HeaderMenu from "./common/HeaderMenu";
import NotificationBell from "./common/NotificationBell";
import ProfileSetup from "./ProfileSetup";
import ScheduleCard from "./schedule/ScheduleCard";
import Spinner from "./shared/Spinner";

interface Props {
	onStart: () => void;
}

function joinErrorMsg(e?: string): string {
	if (e?.includes("already joined")) return "이미 신청했습니다";
	if (e?.includes("not open")) return "모집 중이 아닙니다";
	if (e?.includes("not authenticated")) return "로그인이 필요합니다";
	return "신청에 실패했습니다";
}

function startErrorMsg(e?: string): string {
	if (e?.includes("profile incomplete"))
		return "성별 미입력 참석자가 있어 시작할 수 없습니다";
	if (e?.includes("not open")) return "이미 시작되었거나 모집 중이 아닙니다";
	if (e?.includes("forbidden")) return "운영진만 시작할 수 있습니다";
	return "세션 시작에 실패했습니다";
}

export default function Home({ onStart }: Props) {
	const navigate = useNavigate();
	const authReady = useAuthStore((s) => s.ready);
	const authUser = useAuthStore((s) => s.user);
	const isAdmin = useAuthStore((s) => s.isAdmin);
	const memberId = useAuthStore((s) => s.memberId);
	const myGender = useAuthStore((s) => s.myGender);
	const myBirthYear = useAuthStore((s) => s.myBirthYear);
	const myResidence = useAuthStore((s) => s.myResidence);
	const sessionMeta = useAppStore((s) => s.sessionMeta);
	const schedules = useScheduleStore((s) => s.schedules);
	const places = useScheduleStore((s) => s.places);
	const attendances = useScheduleStore((s) => s.attendances);
	const scheduleLoading = useScheduleStore((s) => s.loading);

	const [authBusy, setAuthBusy] = useState(false);
	const [busyId, setBusyId] = useState<number | null>(null);
	const [editingProfile, setEditingProfile] = useState(false);

	// 시작 시각 도달을 감지해 '진행 하이라이트'를 켜기 위한 시계(30초 tick)
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		const id = setInterval(() => setNow(Date.now()), 30_000);
		return () => clearInterval(id);
	}, []);

	// 즉석 세션용 시트 연동(로그인 후 백그라운드) + 일정 로드
	useEffect(() => {
		if (authUser) {
			void scheduleActions.load();
			void appActions.fetchPlayers().catch(() => {});
		}
	}, [authUser]);

	const handleKakaoLogin = useCallback(async () => {
		setAuthBusy(true);
		try {
			await authActions.signInWithKakao();
		} catch {
			setAuthBusy(false);
		}
	}, []);

	const handleJoin = useCallback(async (sessionId: number) => {
		setBusyId(sessionId);
		const res = await scheduleActions.join(sessionId);
		setBusyId(null);
		if (!res.ok) alert(joinErrorMsg(res.error));
	}, []);

	const handleCancel = useCallback(async (sessionId: number) => {
		setBusyId(sessionId);
		await scheduleActions.cancel(sessionId);
		setBusyId(null);
	}, []);

	const handleStartSession = useCallback(
		async (sessionId: number) => {
			setBusyId(sessionId);
			const res = await startSessionFromSchedule(sessionId);
			if (!res.ok) {
				setBusyId(null);
				alert(startErrorMsg(res.error));
				return;
			}
			// is_active=true → 활성 세션 로드 후 보드로 이동
			await appActions.checkActiveSession();
			setBusyId(null);
			navigate("/session");
		},
		[navigate],
	);

	const handleSetCarpool = useCallback(
		async (sessionId: number, role: CarpoolRole) => {
			await scheduleActions.setCarpool(sessionId, role);
		},
		[],
	);

	// ── 초기 로딩 ──
	if (!authReady) {
		return (
			<div className="min-h-[100dvh] flex items-center justify-center bg-[#fafbff] dark:bg-[#0f172a]">
				<Spinner size={18} />
			</div>
		);
	}

	// ── 비로그인: 로그인 화면 ──
	if (!authUser) {
		return (
			<div
				className="min-h-[100dvh] flex flex-col items-center justify-center bg-[#fafbff] dark:bg-[#0f172a]"
				style={{
					padding: "1.5rem",
					paddingTop: "max(1.5rem, env(safe-area-inset-top))",
					paddingBottom: "max(1.5rem, env(safe-area-inset-bottom))",
				}}
			>
				<div className="w-full max-w-sm flex flex-col gap-5 items-center">
					<img
						src="logo.png"
						className="w-48 max-w-[80%] h-auto object-contain drop-shadow-[0_4px_12px_rgba(11,132,255,0.15)] dark:[filter:brightness(0)_invert(1)]"
						alt="콕타임 배드민턴 클럽"
					/>
					<p
						className="text-[#64748b] dark:text-[rgba(235,235,245,0.6)] text-center"
						style={{ fontSize: 14, fontWeight: 500 }}
					>
						로그인하고 일정을 확인하세요
					</p>
					<button
						type="button"
						onClick={handleKakaoLogin}
						disabled={authBusy}
						style={{
							width: "100%",
							padding: "15px",
							borderRadius: 12,
							fontSize: 16,
							fontWeight: 700,
							color: "#191600",
							background: "#FEE500",
							border: "none",
							cursor: authBusy ? "not-allowed" : "pointer",
							opacity: authBusy ? 0.6 : 1,
						}}
					>
						{authBusy ? "이동 중…" : "카카오로 로그인"}
					</button>
				</div>
			</div>
		);
	}

	// ── 로그인: 일정 목록 ──
	const placeName = (id: number | null) =>
		id == null ? null : (places.find((p) => p.id === id)?.name ?? null);

	// 진행 하이라이트: 시작 시각이 지난 open 일정. 분리해 맨 위로 올리고 하이라이트한다.
	// (요청: 시작 이후 계속 유지 — 종료 시각과 무관. 시작 전이면 세션시작 버튼도 숨김)
	const isLiveSchedule = (s: (typeof schedules)[number]) =>
		s.status === "open" &&
		s.scheduled_at != null &&
		Date.parse(s.scheduled_at) <= now;
	const liveSchedules = schedules.filter(isLiveSchedule);
	const restSchedules = schedules.filter((s) => !isLiveSchedule(s));
	const orderedSchedules = [...liveSchedules, ...restSchedules];
	const liveIds = new Set(liveSchedules.map((s) => s.id));

	return (
		<>
		<AppScreen
			logo
			onRefresh={() => scheduleActions.load()}
			right={
				<>
					<NotificationBell />
					<HeaderMenu onEditProfile={() => setEditingProfile(true)} />
				</>
			}
		>
			<div className="w-full max-w-sm mx-auto flex flex-col gap-4">
				{/* 진행 중 세션 이어하기 */}
				{sessionMeta && (
					<button
						type="button"
						onClick={() => navigate("/session")}
						style={{
							width: "100%",
							padding: "14px",
							borderRadius: 12,
							fontSize: 15,
							fontWeight: 700,
							color: "#fff",
							background: "#0b84ff",
							border: "none",
							cursor: "pointer",
							boxShadow: "0 4px 16px rgba(11,132,255,0.3)",
						}}
					>
						진행 중 세션 이어하기
					</button>
				)}

				{/* 일정 섹션 헤더 */}
				<div className="flex items-center justify-between mt-1">
					<h2
						className="text-[#0f1724] dark:text-white"
						style={{ fontSize: 18, fontWeight: 800 }}
					>
						일정
					</h2>
					{isAdmin && (
						<button
							type="button"
							onClick={() => navigate("/schedule")}
							style={{
								fontSize: 13,
								fontWeight: 700,
								color: "#0b84ff",
								background: "rgba(11,132,255,0.1)",
								border: "none",
								borderRadius: 8,
								padding: "6px 12px",
								cursor: "pointer",
							}}
						>
							일정 관리
						</button>
					)}
				</div>

				{/* 일정 목록 */}
				{scheduleLoading && schedules.length === 0 ? (
					<div className="flex justify-center py-8">
						<Spinner size={16} />
					</div>
				) : schedules.length === 0 ? (
					<div
						className="text-center text-[#98a0ab] dark:text-[rgba(235,235,245,0.4)]"
						style={{ fontSize: 14, padding: "32px 0" }}
					>
						{isAdmin
							? "아직 일정이 없습니다. '일정 추가'로 만들어보세요."
							: "예정된 일정이 없습니다."}
					</div>
				) : (
					<div className="flex flex-col gap-2.5">
						{orderedSchedules.map((s) => (
							<ScheduleCard
								key={s.id}
								session={s}
								placeName={placeName(s.place_id)}
								attendances={attendances.filter((a) => a.session_id === s.id)}
								memberId={memberId}
								isAdmin={isAdmin}
								isLive={liveIds.has(s.id)}
								busy={busyId === s.id}
								onJoin={() => handleJoin(s.id)}
								onCancel={() => handleCancel(s.id)}
								onStartSession={() => handleStartSession(s.id)}
								onSetCarpool={(role) => handleSetCarpool(s.id, role)}
							/>
						))}
					</div>
				)}

				{/* 운영진: 즉석 세션 시작 */}
				{isAdmin && (
					<button
						type="button"
						onClick={onStart}
						className="text-[#64748b] dark:text-[rgba(235,235,245,0.6)] border border-dashed border-[rgba(0,0,0,0.12)] dark:border-[rgba(255,255,255,0.15)]"
						style={{
							width: "100%",
							padding: "12px",
							borderRadius: 12,
							fontSize: 14,
							fontWeight: 600,
							background: "none",
							cursor: "pointer",
							marginTop: 4,
						}}
					>
						즉석 세션 시작
					</button>
				)}

				{/* 매치 로그 */}
				<button
					type="button"
					onClick={() => navigate("/logs")}
					className="text-[#98a0ab] dark:text-[rgba(235,235,245,0.4)]"
					style={{
						background: "none",
						border: "none",
						fontSize: 13,
						fontWeight: 500,
						cursor: "pointer",
						padding: "4px 0",
						alignSelf: "center",
					}}
				>
					매치 로그 보기
				</button>
			</div>
		</AppScreen>

			{/* 프로필 모달(고정 오버레이) — 셸 밖에 두어 pull-to-refresh transform 영향 차단 */}
			{!!memberId &&
				(myGender == null || myBirthYear == null || !myResidence) && (
					<ProfileSetup />
				)}
			{editingProfile && (
				<ProfileSetup mode="edit" onClose={() => setEditingProfile(false)} />
			)}
		</>
	);
}
