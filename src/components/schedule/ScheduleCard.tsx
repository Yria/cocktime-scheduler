import { useState } from "react";
import { ChevronRight } from "lucide-react";
import type { Gender, PlayerSkills } from "../../types";
import type {
	AttendanceRow,
	CarpoolRole,
	SessionRow,
} from "../../lib/supabase/types";
import { fmtRange } from "../../lib/schedule/timeFmt";
import GuestSection from "./GuestSection";
import PlayerAvatar from "../shared/PlayerAvatar";
import CarpoolAnnounceBuilder from "./carpool/CarpoolAnnounceBuilder";
import SessionParticipantsModal from "./SessionParticipantsModal";

/** 인라인 아바타 스택에 노출할 최대 인원(초과분은 +N 칩) */
const STACK_MAX = 6;

interface Props {
	session: SessionRow;
	placeName: string | null;
	/** 이 세션의 참석 행(취소 제외) */
	attendances: AttendanceRow[];
	memberId: string | null;
	isAdmin: boolean;
	/** 시작 시각이 지난 open 일정 — 맨 위로 분리·하이라이트 + 세션시작 버튼 노출 */
	isLive: boolean;
	busy: boolean;
	onJoin: () => void;
	onCancel: () => void;
	onStartSession: () => void;
	onSetCarpool: (role: CarpoolRole) => void;
	/** 게스트 신청(성공/실패 반환). */
	onAddGuest: (guest: { name: string; gender: Gender; skills: PlayerSkills }) => Promise<{ ok: boolean; error?: string }>;
	/** 게스트 취소(초대 회원 본인). */
	onCancelGuest: (guestMemberId: string) => void;
	/** 정모 회차: 대진표·안내 페이지로 진입. */
	onOpenNotice?: () => void;
}

export default function ScheduleCard({
	session: s,
	placeName,
	attendances,
	memberId,
	isAdmin,
	isLive,
	busy,
	onJoin,
	onCancel,
	onStartSession,
	onSetCarpool,
	onAddGuest,
	onCancelGuest,
	onOpenNotice,
}: Props) {
	const [showParticipants, setShowParticipants] = useState(false);
	const [showCarpoolBuilder, setShowCarpoolBuilder] = useState(false);
	const confirmed = attendances.filter((a) => a.status === "confirmed");
	const waiting = attendances.filter((a) => a.status === "waitlisted");
	// 인라인 스택 — 확정자 우선, 모자라면 대기자로 채움
	const roster = [...confirmed, ...waiting];
	const stackList = roster.slice(0, STACK_MAX);
	const stackExtra = roster.length - stackList.length;
	const mine = memberId
		? attendances.find((a) => a.member_id === memberId)
		: undefined;
	const myWaitRank =
		mine?.status === "waitlisted"
			? waiting.filter((a) => a.position <= mine.position).length
			: 0;
	const isOpen = s.status === "open";
	const canDrive = attendances.filter(
		(a) => a.carpool_role === "can_drive",
	).length;
	const needRide = attendances.filter(
		(a) => a.carpool_role === "need_ride",
	).length;
	const attending = mine != null && mine.status !== "cancelled";

	return (
		<div
			className={
				isLive
					? "bg-white dark:bg-[rgba(30,30,35,0.92)]"
					: "bg-white dark:bg-[rgba(30,30,35,0.8)] border border-[rgba(0,0,0,0.06)] dark:border-[rgba(255,255,255,0.1)]"
			}
			style={{
				borderRadius: 12,
				padding: "14px 16px",
				...(isLive
					? {
							border: "1.5px solid #2c7a57",
							boxShadow: "0 4px 18px rgba(44,122,87,0.28)",
						}
					: null),
			}}
		>
			<div className="flex items-start justify-between gap-2">
				<div className="flex flex-col gap-1 min-w-0">
					<div className="flex items-center gap-2">
						<span
							className="text-strong truncate"
							style={{ fontSize: 15, fontWeight: 700 }}
						>
							{fmtRange(s.scheduled_at, s.ends_at)}
						</span>
						{s.status === "active" && (
							<span
								style={{
									fontSize: 10,
									fontWeight: 700,
									color: "#30d158",
									background: "rgba(52,199,89,0.12)",
									padding: "2px 6px",
									borderRadius: 5,
								}}
							>
								진행중
							</span>
						)}
						{s.is_regular && (
							<span
								style={{
									fontSize: 10,
									fontWeight: 800,
									color: "#fff",
									background: "#2c7a57",
									padding: "2px 7px",
									borderRadius: 5,
									letterSpacing: "0.02em",
								}}
							>
								정모
							</span>
						)}
					</div>
					<span
						className="text-faint"
						style={{ fontSize: 12.5 }}
					>
						{placeName ?? "장소 미정"}
					</span>
				</div>
			</div>

			{/* 정모: 대진표·안내 진입 */}
			{s.is_regular && onOpenNotice && (
				<button
					type="button"
					onClick={onOpenNotice}
					className="flex items-center justify-between w-full mt-3"
					style={{
						background: "rgba(44,122,87,0.1)",
						border: "1px solid rgba(44,122,87,0.25)",
						borderRadius: 10,
						padding: "9px 13px",
						cursor: "pointer",
					}}
				>
					<span
						style={{ fontSize: 13.5, fontWeight: 700, color: "#2c7a57" }}
					>
						🏸 대진표 · 안내 보기
					</span>
					<ChevronRight size={17} color="#2c7a57" />
				</button>
			)}

			{/* 참석 현황 + 버튼 */}
			<div className="flex items-center justify-between mt-3 pt-3 border-t border-[rgba(0,0,0,0.06)] dark:border-[rgba(255,255,255,0.08)]">
				<span
					className="text-muted"
					style={{ fontSize: 12.5, fontWeight: 600 }}
				>
					확정 {confirmed.length}
					{s.capacity != null ? `/${s.capacity}` : ""}명
					{waiting.length > 0 ? ` · 대기 ${waiting.length}` : ""}
				</span>

				{isOpen ? (
					mine?.status === "confirmed" ? (
						<div className="flex items-center gap-2">
							<span style={statusBadge("#30d158", "rgba(52,199,89,0.14)")}>
								<span style={statusDot("#30d158")} />
								참석 중
							</span>
							<button
								type="button"
								onClick={onCancel}
								disabled={busy}
								style={chipBtn("#ef4444", busy)}
							>
								취소
							</button>
						</div>
					) : mine?.status === "waitlisted" ? (
						<div className="flex items-center gap-2">
							<span style={statusBadge("#f59e0b", "rgba(245,158,11,0.14)")}>
								<span style={statusDot("#f59e0b")} />
								대기 {myWaitRank}번째
							</span>
							<button
								type="button"
								onClick={onCancel}
								disabled={busy}
								style={chipBtn("#ef4444", busy)}
							>
								취소
							</button>
						</div>
					) : (
						<button
							type="button"
							onClick={onJoin}
							disabled={busy}
							style={{
								fontSize: 13,
								fontWeight: 700,
								color: "#fff",
								background: busy ? "rgba(11,132,255,0.5)" : "#0b84ff",
								border: "none",
								borderRadius: 8,
								padding: "7px 16px",
								cursor: busy ? "not-allowed" : "pointer",
							}}
						>
							참석하기
						</button>
					)
				) : (
					<span
						className="text-faint"
						style={{ fontSize: 12 }}
					>
						모집 마감
					</span>
				)}
			</div>

			{/* 참가자 아바타 스택 — 탭하면 전체 목록 모달 */}
			{roster.length > 0 && (
				<button
					type="button"
					onClick={() => setShowParticipants(true)}
					className="flex items-center gap-2 mt-2.5 w-full"
					style={{
						background: "none",
						border: "none",
						padding: 0,
						cursor: "pointer",
					}}
					aria-label="참가자 목록 보기"
				>
					<div className="flex items-center">
						{stackList.map((a, i) => {
							// 대기자는 그레이스케일+감광으로 확정자와 구분.
							const isWaiting = a.status === "waitlisted";
							return (
								<div
									key={a.member_id}
									className="rounded-full ring-2 ring-white dark:ring-[#1e1e23]"
									style={{
										position: "relative",
										marginLeft: i === 0 ? 0 : -8,
										zIndex: stackList.length - i,
										filter: isWaiting ? "grayscale(1)" : undefined,
										opacity: isWaiting ? 0.55 : 1,
									}}
								>
									<PlayerAvatar
										name={a.member?.name ?? "회원"}
										gender={a.member?.gender ?? null}
										size={28}
									/>
								</div>
							);
						})}
						{stackExtra > 0 && (
							<div
								className="rounded-full ring-2 ring-white dark:ring-[#1e1e23] flex items-center justify-center text-muted bg-[rgba(0,0,0,0.06)] dark:bg-white/10"
								style={{
									width: 28,
									height: 28,
									marginLeft: -8,
									fontSize: 11,
									fontWeight: 700,
								}}
							>
								+{stackExtra}
							</div>
						)}
					</div>
					<ChevronRight
						size={16}
						className="ml-auto text-[#c0c6cf] dark:text-[rgba(235,235,245,0.35)]"
					/>
				</button>
			)}

			{/* 카풀 의향 (참석자) — 카풀 사용 일정에서만 */}
			{attending && s.carpool_enabled && (
				<div
					className="flex items-center gap-1.5 mt-2.5"
					style={{ fontSize: 12 }}
				>
					<span
						className="text-faint"
						style={{ fontWeight: 600 }}
					>
						카풀
					</span>
					{(["can_drive", "need_ride", "none"] as const).map((r) => {
						const active = (mine?.carpool_role ?? "none") === r;
						const bg = active
							? r === "can_drive"
								? "#2c7a57"
								: r === "need_ride"
									? "#b4762b"
									: "#94a3b8"
							: "rgba(0,0,0,0.05)";
						return (
							<button
								key={r}
								type="button"
								onClick={() => onSetCarpool(r)}
								style={{
									fontSize: 11.5,
									fontWeight: 600,
									padding: "4px 9px",
									borderRadius: 7,
									border: "none",
									cursor: "pointer",
									color: active ? "#fff" : "#64748b",
									background: bg,
								}}
							>
								{r === "can_drive"
									? "운전 가능"
									: r === "need_ride"
										? "탑승 필요"
										: "안 함"}
							</button>
						);
					})}
				</div>
			)}

			{/* 운영자: 카풀 공지 빌더 진입 */}
			{isAdmin && s.carpool_enabled && (canDrive > 0 || needRide > 0) && (
				<button
					type="button"
					onClick={() => setShowCarpoolBuilder(true)}
					className="btn-tint-blue mt-2"
				>
					🚗 카풀 공지 만들기
				</button>
			)}

			{/* 게스트 신청 + 내가 데려온 게스트 목록 */}
			<GuestSection
				attendances={attendances}
				memberId={memberId}
				isOpen={isOpen}
				attending={attending}
				busy={busy}
				onAddGuest={onAddGuest}
				onCancelGuest={onCancelGuest}
			/>

			{/* 세션 시작 버튼: 시작 시각이 지난(=isLive) open 일정에만 노출 */}
			{isAdmin && isOpen && isLive && (
				<button
					type="button"
					onClick={onStartSession}
					disabled={busy}
					style={{
						width: "100%",
						marginTop: 10,
						padding: "10px",
						borderRadius: 9,
						fontSize: 13.5,
						fontWeight: 700,
						color: "#fff",
						background: busy ? "rgba(44,122,87,0.5)" : "#2c7a57",
						border: "none",
						cursor: busy ? "not-allowed" : "pointer",
					}}
				>
					경기 시작
				</button>
			)}

			{showParticipants && (
				<SessionParticipantsModal
					session={s}
					placeName={placeName}
					attendances={attendances}
					memberId={memberId}
					onClose={() => setShowParticipants(false)}
				/>
			)}

			{showCarpoolBuilder && (
				<CarpoolAnnounceBuilder
					session={s}
					placeName={placeName}
					onClose={() => setShowCarpoolBuilder(false)}
				/>
			)}
		</div>
	);
}

function chipBtn(color: string, busy: boolean): React.CSSProperties {
	return {
		fontSize: 12.5,
		fontWeight: 600,
		color,
		background: "none",
		border: "none",
		cursor: busy ? "not-allowed" : "pointer",
		opacity: busy ? 0.5 : 1,
	};
}

/** 내 참석 상태 배지 — 색 점 + pill 배경으로 "참석 중 / 대기" 를 한눈에 보이게 한다. */
function statusBadge(color: string, bg: string): React.CSSProperties {
	return {
		display: "inline-flex",
		alignItems: "center",
		gap: 5,
		fontSize: 12.5,
		fontWeight: 700,
		color,
		background: bg,
		padding: "5px 11px",
		borderRadius: 999,
		lineHeight: 1,
	};
}

function statusDot(color: string): React.CSSProperties {
	return {
		width: 7,
		height: 7,
		borderRadius: 999,
		background: color,
		flexShrink: 0,
	};
}
