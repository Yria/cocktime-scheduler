import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { SessionRow } from "../lib/supabase/types";
import { appActions, useAppStore } from "../store/appStore";
import { authActions, authDisplayName, useAuthStore } from "../store/authStore";
import { scheduleActions, useScheduleStore } from "../store/scheduleStore";
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

export default function Home({ onStart }: Props) {
	const navigate = useNavigate();
	const authReady = useAuthStore((s) => s.ready);
	const authUser = useAuthStore((s) => s.user);
	const isAdmin = useAuthStore((s) => s.isAdmin);
	const memberId = useAuthStore((s) => s.memberId);
	const sessionMeta = useAppStore((s) => s.sessionMeta);
	const schedules = useScheduleStore((s) => s.schedules);
	const places = useScheduleStore((s) => s.places);
	const attendances = useScheduleStore((s) => s.attendances);
	const scheduleLoading = useScheduleStore((s) => s.loading);

	const [authBusy, setAuthBusy] = useState(false);
	const [busyId, setBusyId] = useState<number | null>(null);

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

	const handleDelete = useCallback(async (s: SessionRow) => {
		if (!confirm(`'${s.title ?? "일정"}'을(를) 삭제할까요?`)) return;
		await scheduleActions.remove(s.id);
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

	return (
		<div
			className="min-h-[100dvh] bg-[#fafbff] dark:bg-[#0f172a]"
			style={{
				padding: "1.25rem",
				paddingTop: "max(1.25rem, env(safe-area-inset-top))",
				paddingBottom: "max(1.25rem, env(safe-area-inset-bottom))",
			}}
		>
			<div className="w-full max-w-sm mx-auto flex flex-col gap-4">
				{/* 헤더 */}
				<div className="flex items-center justify-between">
					<img
						src="logo.png"
						className="h-7 w-auto object-contain dark:[filter:brightness(0)_invert(1)]"
						alt="콕타임"
					/>
					<div className="flex items-center gap-2" style={{ fontSize: 12 }}>
						<span
							className="text-[#64748b] dark:text-[rgba(235,235,245,0.6)]"
							style={{ fontWeight: 600 }}
						>
							{authDisplayName(authUser)}
							{isAdmin ? " · 운영진" : ""}
						</span>
						<button
							type="button"
							onClick={() => authActions.signOut()}
							className="text-[#98a0ab] dark:text-[rgba(235,235,245,0.4)]"
							style={{
								background: "none",
								border: "none",
								fontWeight: 600,
								cursor: "pointer",
							}}
						>
							로그아웃
						</button>
					</div>
				</div>

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
							onClick={() => navigate("/schedule/new")}
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
							+ 일정 추가
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
						{schedules.map((s) => (
							<ScheduleCard
								key={s.id}
								session={s}
								placeName={placeName(s.place_id)}
								attendances={attendances.filter((a) => a.session_id === s.id)}
								memberId={memberId}
								isAdmin={isAdmin}
								busy={busyId === s.id}
								onJoin={() => handleJoin(s.id)}
								onCancel={() => handleCancel(s.id)}
								onDelete={() => handleDelete(s)}
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
		</div>
	);
}
