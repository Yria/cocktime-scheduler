import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { startSessionFromSchedule } from "../lib/supabase/schedule";
import type { CarpoolRole } from "../lib/supabase/types";
import type { Gender, PlayerSkills } from "../types";
import { appActions, useAppStore } from "../store/appStore";
import { authActions, useAuthStore } from "../store/authStore";
import {
	shouldShowInstallPrompt,
	useInstallPromptStore,
} from "../store/installPromptStore";
import { scheduleActions, useScheduleStore } from "../store/scheduleStore";
import { latePoolCutoffMs } from "../lib/schedule/latePool";
import AppScreen from "./common/AppScreen";
import HeaderMenu from "./common/HeaderMenu";
import InstallPromptToast from "./common/InstallPromptToast";
import NotificationBell from "./common/NotificationBell";
import ProfileSetup from "./ProfileSetup";
import ScheduleCard from "./schedule/ScheduleCard";
import EmptyState from "./shared/EmptyState";
import Spinner from "./shared/Spinner";

interface Props {
	onStart: () => void;
}

function joinErrorMsg(e?: string): string {
	if (e?.includes("already joined")) return "이미 신청했습니다";
	if (e?.includes("not open yet")) return "아직 신청 기간이 아닙니다";
	if (e?.includes("session ended")) return "이미 종료된 일정입니다";
	if (e?.includes("not open")) return "모집 중이 아닙니다";
	if (e?.includes("not authenticated")) return "로그인이 필요합니다";
	return "신청에 실패했습니다";
}

function startErrorMsg(e?: string): string {
	if (e?.includes("profile incomplete"))
		return "성별 미입력 참석자가 있어 시작할 수 없습니다";
	if (e?.includes("session ended")) return "이미 종료된 일정입니다";
	if (e?.includes("not open")) return "이미 시작되었거나 모집 중이 아닙니다";
	if (e?.includes("forbidden")) return "운영진만 시작할 수 있습니다";
	return "세션 시작에 실패했습니다";
}

function guestErrorMsg(e?: string): string {
	if (e?.includes("guest name required")) return "게스트 이름을 입력해 주세요";
	if (e?.includes("guest gender required")) return "게스트 성별을 선택해 주세요";
	// 동명 회원이 있으면 게스트로 신청 불가 — 회원 본인이 직접 참석 신청하도록 안내.
	if (e?.includes("name_is_member"))
		return "이미 같은 이름의 회원이 있어요. 회원 본인이 직접 참석 신청하도록 안내해 주세요";
	if (e?.includes("must join first")) return "먼저 본인 참석 신청을 해주세요";
	if (e?.includes("session ended")) return "이미 종료된 일정입니다";
	if (e?.includes("not open yet")) return "아직 신청 기간이 아닙니다";
	if (e?.includes("not open")) return "모집 중이 아닙니다";
	if (e?.includes("not authenticated")) return "로그인이 필요합니다";
	return "게스트 신청에 실패했습니다";
}

function lateErrorMsg(e?: string): string {
	if (e?.includes("session ended")) return "이미 종료된 일정입니다";
	if (e?.includes("not attending")) return "참석 신청 후 이용할 수 있습니다";
	if (e?.includes("not authenticated")) return "로그인이 필요합니다";
	return "늦참 신청에 실패했습니다";
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
	// PWA 설치 유도 토스트 노출 여부(스토어 구독 — dismiss/설치 시 재계산).
	const installState = useInstallPromptStore();

	const [authBusy, setAuthBusy] = useState(false);
	const [busyId, setBusyId] = useState<number | null>(null);
	const [editingProfile, setEditingProfile] = useState(false);

	// 시작 시각 도달을 감지해 '진행 하이라이트'를 켜기 위한 시계(30초 tick)
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		const id = setInterval(() => setNow(Date.now()), 30_000);
		return () => clearInterval(id);
	}, []);

	// 즉석 세션용 회원 명단 로드(로그인 후 백그라운드) + 일정 로드
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

	const handleSetLate = useCallback((sessionId: number, minutes: number) => {
		scheduleActions.setLate(sessionId, minutes);
	}, []);

	const handleApplyLatePool = useCallback(
		async (sessionId: number, minutes: number) => {
			const res = await scheduleActions.applyLateTransition(sessionId, minutes);
			// 서버 원문 에러를 친절 메시지로 변환(참석/게스트와 동일 기준).
			return res.ok ? res : { ok: false, error: lateErrorMsg(res.error) };
		},
		[],
	);

	const handleAddGuest = useCallback(
		async (
			sessionId: number,
			guest: { name: string; gender: Gender; skills: PlayerSkills },
		) => {
			const res = await scheduleActions.addGuest(sessionId, guest);
			// 서버 원문 에러를 친절 메시지로 변환(참석/경기시작과 동일 기준). 종료 일정은 "이미 종료된 일정입니다".
			return res.ok ? res : { ok: false, error: guestErrorMsg(res.error) };
		},
		[],
	);

	const handleCancelGuest = useCallback(
		async (sessionId: number, guestMemberId: string) => {
			setBusyId(sessionId);
			await scheduleActions.cancelGuest(sessionId, guestMemberId);
			setBusyId(null);
		},
		[],
	);

	// ── 초기 로딩 ──
	if (!authReady) {
		return (
			<div className="app-shell-minh flex items-center justify-center bg-[#fafbff] dark:bg-[#0f172a]">
				<Spinner size={18} />
			</div>
		);
	}

	// ── 비로그인: 로그인 화면 ──
	if (!authUser) {
		return (
			<div
				className="app-shell-minh flex flex-col items-center justify-center bg-[#fafbff] dark:bg-[#0f172a]"
				style={{
					padding: "1.5rem",
					paddingTop: "max(1.5rem, env(safe-area-inset-top))",
					paddingBottom: "max(1.5rem, env(safe-area-inset-bottom))",
				}}
			>
				<div className="app-card flex flex-col gap-5 items-center">
					<img
						src="logo.png"
						className="w-48 max-w-[80%] h-auto object-contain drop-shadow-[0_4px_12px_rgba(11,132,255,0.15)] dark:[filter:brightness(0)_invert(1)]"
						alt="콕타임 배드민턴 클럽"
					/>
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
							display: "flex",
							alignItems: "center",
							justifyContent: "center",
							gap: 8,
						}}
					>
						{/* 카카오 말풍선 심볼 */}
						<svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
							<path
								fill="#191600"
								d="M12 3.5c-5.06 0-9.16 3.24-9.16 7.24 0 2.59 1.72 4.86 4.3 6.13-.19.69-.68 2.48-.78 2.86-.12.47.17.46.36.34.15-.1 2.39-1.62 3.36-2.28.62.09 1.26.13 1.92.13 5.06 0 9.16-3.24 9.16-7.24S17.06 3.5 12 3.5z"
							/>
						</svg>
						{authBusy ? "이동 중…" : "카카오로 로그인"}
					</button>
				</div>
			</div>
		);
	}

	// ── 로그인: 일정 목록 ──
	const placeName = (id: number | null) =>
		id == null ? null : (places.find((p) => p.id === id)?.name ?? null);

	// PWA 설치 유도 토스트 — 프로필 완성 + 편집 중 아님 + 노출 조건 충족일 때만.
	// (하단 고정 토스트가 마지막 버튼을 가리지 않도록 스크롤 콘텐츠 끝에 스페이서도 같은 조건으로 넣는다.)
	const profileComplete =
		!!memberId && myGender != null && myBirthYear != null && !!myResidence;
	const showInstallToast =
		profileComplete && !editingProfile && shouldShowInstallPrompt(installState);

	// 종료된 일정 숨김: 종료 시각이 지난 open 일정은 참석 불가 + 미노출(서버 join 가드와 동일 기준).
	// active(진행중)는 종료 시각과 무관하게 유지 — 운영 중인 세션을 목록에서 지우지 않는다.
	const isPastSchedule = (s: (typeof schedules)[number]) =>
		s.status === "open" && s.ends_at != null && Date.parse(s.ends_at) <= now;
	const visibleSchedules = schedules.filter((s) => !isPastSchedule(s));

	// 진행 하이라이트: 시작 시각이 지난 open 일정. 분리해 맨 위로 올리고 하이라이트한다.
	// (요청: 시작 이후 계속 유지 — 종료 시각 전까지. 시작 전이면 세션시작 버튼도 숨김)
	const isLiveSchedule = (s: (typeof schedules)[number]) =>
		s.status === "open" &&
		s.scheduled_at != null &&
		Date.parse(s.scheduled_at) <= now;
	const liveSchedules = visibleSchedules.filter(isLiveSchedule);
	const restSchedules = visibleSchedules.filter((s) => !isLiveSchedule(s));
	const orderedSchedules = [...liveSchedules, ...restSchedules];
	const liveIds = new Set(liveSchedules.map((s) => s.id));

	// 세션 시작 버튼 노출: 하이라이트(isLive)와 별개로 시작 10분 전부터 허용.
	const START_LEAD_MS = 10 * 60 * 1000;
	const canStartSchedule = (s: (typeof schedules)[number]) =>
		s.status === "open" &&
		s.scheduled_at != null &&
		Date.parse(s.scheduled_at) - START_LEAD_MS <= now;
	const canStartIds = new Set(
		visibleSchedules.filter(canStartSchedule).map((s) => s.id),
	);

	// 참여 가능(참석하기 노출): 모집중(open) 또는 진행중(active)이고 종료 전. 서버 join 가드와 동일 기준.
	// → '경기 시작'으로 active 가 돼도 종료(ends_at) 전까진 늦참 입장 가능.
	const canJoinSchedule = (s: (typeof schedules)[number]) =>
		(s.status === "open" || s.status === "active") &&
		(s.ends_at == null || Date.parse(s.ends_at) > now);
	const joinableIds = new Set(
		visibleSchedules.filter(canJoinSchedule).map((s) => s.id),
	);
	// 완전 늦참: 예정 시간의 2/3 지점(정원 외 늦참 경계)을 넘긴 시점. 이후 입장 시 확인 다이얼로그.
	const lateJoinSchedule = (s: (typeof schedules)[number]) => {
		const cutoff = latePoolCutoffMs(s.scheduled_at, s.ends_at);
		return cutoff != null && now >= cutoff;
	};
	const lateJoinIds = new Set(
		visibleSchedules.filter(lateJoinSchedule).map((s) => s.id),
	);

	return (
		<>
		<AppScreen
			logo
			onRefresh={() => Promise.all([scheduleActions.load(), appActions.checkActiveSession()]).then(() => {})}
			right={
				// 아이콘 버튼(40px·중앙정렬)은 글리프가 버튼 안쪽에 있어 거터선보다 들어온다.
				// 음수 마진으로 마지막 아이콘(⋮)의 우측을 본문 우측 거터선에 맞춘다(좌측 로고와 대칭).
				<div className="flex items-center gap-0.5" style={{ marginRight: -18 }}>
					<NotificationBell />
					<HeaderMenu onEditProfile={() => setEditingProfile(true)} />
				</div>
			}
		>
			<div className="app-card flex flex-col gap-4">
				{/* 진행 중 세션 입장(수동) — 자동참여 폐지 후 라이브 보드로 들어가는 입구.
				    sessionMeta는 마운트/포그라운드 복귀/새로고침 시 checkActiveSession이 세팅. */}
				{sessionMeta && (
					<button
						type="button"
						onClick={() => navigate("/session")}
						className="btn-solid-blue text-[15px]"
					>
						진행 중 세션 입장
					</button>
				)}

				{/* 일정 섹션 헤더 — minHeight로 '일정 관리' 버튼 유무(운영진/일반)에 따른 높이차 제거 */}
				<div className="flex items-center justify-between mt-1 min-h-[32px]">
					<h2 className="text-strong" style={{ fontSize: 18, fontWeight: 800 }}>
						일정
					</h2>
					{isAdmin && (
						<button
							type="button"
							onClick={() => navigate("/schedule")}
							className="btn-tint-blue"
						>
							일정 관리
						</button>
					)}
				</div>

				{/* 일정 목록 */}
				{scheduleLoading && schedules.length === 0 ? (
					<EmptyState loading spinnerSize={16} style={{ padding: "32px 0" }} />
				) : visibleSchedules.length === 0 ? (
					<EmptyState style={{ fontSize: 14, padding: "32px 0" }}>
						{isAdmin
							? "아직 일정이 없습니다. '일정 추가'로 만들어보세요."
							: "예정된 일정이 없습니다."}
					</EmptyState>
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
								canStart={canStartIds.has(s.id)}
								joinable={joinableIds.has(s.id)}
								lateJoin={lateJoinIds.has(s.id)}
								busy={busyId === s.id}
								onJoin={() => handleJoin(s.id)}
								onCancel={() => handleCancel(s.id)}
								onStartSession={() => handleStartSession(s.id)}
								onSetCarpool={(role) => handleSetCarpool(s.id, role)}
							onSetLate={(minutes) => handleSetLate(s.id, minutes)}
								onApplyLatePool={(minutes) => handleApplyLatePool(s.id, minutes)}
								onAddGuest={(guest) => handleAddGuest(s.id, guest)}
								onCancelGuest={(gid) => handleCancelGuest(s.id, gid)}
								onOpenNotice={() => navigate(`/notice/${s.id}`)}
							/>
						))}
					</div>
				)}

				{/* 운영진: 즉석 세션 시작 */}
				{isAdmin && (
					<button
						type="button"
						onClick={onStart}
						className="text-muted border border-dashed border-[rgba(0,0,0,0.12)] dark:border-[rgba(255,255,255,0.15)]"
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
					className="text-faint"
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

				{/* 설치 유도 토스트가 하단 고정으로 뜰 때, 마지막 버튼이 토스트에 가려 눌리지 않도록 여백 확보 */}
				{showInstallToast && <div aria-hidden style={{ height: 92 }} />}
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

			{/* PWA 홈 화면 설치 유도 토스트 — 프로필 완성 + 프로필 편집 중 아님일 때만(모달 위 겹침 방지). */}
			{showInstallToast && <InstallPromptToast />}
		</>
	);
}
