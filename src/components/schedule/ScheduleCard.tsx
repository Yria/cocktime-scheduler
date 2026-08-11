import { useState } from "react";
import { ChevronRight } from "lucide-react";
import type { Gender, PlayerSkills } from "../../types";
import type {
	AttendanceRow,
	CarpoolRole,
	SessionRow,
} from "../../lib/supabase/types";
import { fmtClock, fmtRange } from "../../lib/schedule/timeFmt";
import { isLatePoolArrival, latePoolCutoffMs } from "../../lib/schedule/latePool";
import { waitDisplay, guestCapForSession, splitConfirmedByCapacity } from "../../lib/schedule/waitStatus";
import { openPlaceMap, type PlaceMapTarget } from "../../lib/kakaoMap";
import GuestSection from "./GuestSection";
import LateArrivalSlider from "./LateArrivalSlider";
import MealPlaceLink from "../shared/MealPlaceLink";
import PlayerAvatar from "../shared/PlayerAvatar";
import CarpoolAnnounceBuilder from "./carpool/CarpoolAnnounceBuilder";
import SessionParticipantsModal from "./SessionParticipantsModal";
import ConfirmDialog from "../common/ConfirmDialog";

/** 인라인 아바타 스택에 노출할 최대 인원(초과분은 +N 칩) */
const STACK_MAX = 6;

interface Props {
	session: SessionRow;
	placeName: string | null;
	/** 모임 장소 지도 열기 타깃(웹+앱 스킴). 있으면 장소명을 탭하면 카카오맵(모바일=네이티브 앱)이 열린다. */
	placeMapTarget?: PlaceMapTarget | null;
	/** 이 세션의 참석 행(취소 제외) */
	attendances: AttendanceRow[];
	memberId: string | null;
	isAdmin: boolean;
	/** 시작 시각이 지난 open 일정 — 맨 위로 분리·하이라이트 + "진행중" 배지 */
	isLive: boolean;
	/** 세션시작 버튼 노출 조건 — 시작 10분 전부터(open, 미종료). isLive와 별개. */
	canStart: boolean;
	/** 참여(참석하기) 가능 — 모집중/진행중이고 종료 전. active 여도 종료 전이면 늦참 입장 허용. */
	joinable: boolean;
	/** 예정 시간의 2/3 지점(정원 외 늦참 경계) 이후 — 입장 시 '완전 늦참' 확인 다이얼로그. */
	lateJoin: boolean;
	busy: boolean;
	onJoin: () => void;
	onCancel: () => void;
	onStartSession: () => void;
	onSetCarpool: (role: CarpoolRole) => void;
	/** 정모 식사(회식) 참여 여부 — 정모 + 식사 체크 회차에서만 노출. 기본 참여. */
	onSetMeal: (joining: boolean) => void;
	/** 내가 데려온 게스트의 식사 참여 여부(게스트는 계정이 없어 초대 회원이 대신 고른다). */
	onSetGuestMeal: (guestMemberId: string, joining: boolean) => void;
	/** 늦참 도착 오프셋(분) 설정 — 8시 경계를 넘지 않는 같은 존 내 이동(상태 불변, 디바운스). */
	onSetLate: (minutes: number) => void;
	/** 8시 경계 전환(정원 외 늦참 진입/복귀) 적용 — 확인 후 호출. status·정원 재동기화 포함. */
	onApplyLatePool: (minutes: number) => Promise<{ ok: boolean; error?: string }>;
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
	placeMapTarget,
	attendances,
	memberId,
	isAdmin,
	isLive,
	canStart,
	joinable,
	lateJoin,
	busy,
	onJoin,
	onCancel,
	onStartSession,
	onSetCarpool,
	onSetMeal,
	onSetGuestMeal,
	onSetLate,
	onApplyLatePool,
	onAddGuest,
	onCancelGuest,
	onOpenNotice,
}: Props) {
	const [showParticipants, setShowParticipants] = useState(false);
	const [showCarpoolBuilder, setShowCarpoolBuilder] = useState(false);
	const [showCancelConfirm, setShowCancelConfirm] = useState(false);
	// 완전 늦참(2/3 지점 이후) 입장 확인 대기
	const [showLateJoinConfirm, setShowLateJoinConfirm] = useState(false);
	// 정원외늦참 '진입' 확인 대기 — { 후보 오프셋 }. null=대기 없음.
	// (복귀·같은 존 이동은 모달 없이 바로 적용하므로 진입 케이스만 여기 담긴다.)
	const [pendingLate, setPendingLate] = useState<{ minutes: number } | null>(
		null,
	);
	const [lateBusy, setLateBusy] = useState(false);
	const confirmed = attendances.filter((a) => a.status === "confirmed");
	const waiting = attendances.filter((a) => a.status === "waitlisted");
	const latePool = attendances.filter((a) => a.status === "late_pool");
	// 게스트 확정 상한 — 주말 무제한/평일 2(서버 session_guest_cap 미러).
	const guestCap = guestCapForSession(s.scheduled_at);
	// 정원 초과 프리패스 운영진(만석일 때 들어온 운영진)만 별도 카운트/표기.
	const { freepassOps } = splitConfirmedByCapacity(attendances, s.capacity);
	// 인라인 스택 — 확정자 우선, 대기자, 정원 외 늦참 순으로 채움
	const roster = [...confirmed, ...waiting, ...latePool];
	const stackList = roster.slice(0, STACK_MAX);
	const stackExtra = roster.length - stackList.length;
	const mine = memberId
		? attendances.find((a) => a.member_id === memberId)
		: undefined;
	// 본인 참석 행은 항상 회원(invited_by=null)이라 게이트가 찼어도 queue 순번(막힌 게스트 제외)으로 나온다.
	const myWait =
		mine?.status === "waitlisted" ? waitDisplay(attendances, mine, guestCap) : null;
	const isOpen = s.status === "open";
	const isActive = s.status === "active";
	// 참여 버튼 탭 — 2/3 지점 이후면 '완전 늦참' 확인 다이얼로그, 아니면 바로 참여.
	const handleJoinClick = () => {
		if (lateJoin) setShowLateJoinConfirm(true);
		else onJoin();
	};
	const canDrive = attendances.filter(
		(a) => a.carpool_role === "can_drive",
	).length;
	const needRide = attendances.filter(
		(a) => a.carpool_role === "need_ride",
	).length;
	const attending = mine != null && mine.status !== "cancelled";
	// 정모 식사 체크 노출 — 정모 + 회차 토글이 둘 다 켜져 있을 때(서버 RPC 게이트와 동일 조건).
	const mealOn = s.is_regular && s.meal_enabled;
	// 대진표 본문이 실제로 있는지 — 없으면 '대진표 보기' 버튼을 띄우지 않는다.
	const hasNotice = Boolean(s.notice_md?.trim());
	// 식사 인원 = 실제로 오는 사람(확정 + 정원 외 늦참) 중 참여. 대기자는 승격돼야 오므로 제외.
	const mealJoin = [...confirmed, ...latePool].filter(
		(a) => a.meal_joining,
	).length;

	// 늦참 슬라이더 표시값 — 경계 확인 대기 중이면 후보값을 미리 보여준다(확정 전까지 서버 미반영).
	const committedLate = mine?.late_minutes ?? 0;
	const sliderLate = pendingLate ? pendingLate.minutes : committedLate;
	// 정원 외 풀 경계 시각(후반 2/3 지점) — 확인 다이얼로그 문구용. 예) 6~9시 세션이면 8시.
	const poolCutoffMs = latePoolCutoffMs(s.scheduled_at, s.ends_at);
	const poolCutoffClock =
		poolCutoffMs != null
			? fmtClock(new Date(poolCutoffMs).toISOString())
			: null;

	// 슬라이더 조작 →
	//  · 정원외늦참 '진입'(일반→풀): 확인 다이얼로그로 게이팅.
	//  · '복귀'(풀→일반): 모달 없이 바로 전환 적용(정원 여유면 확정, 없으면 대기).
	//  · 같은 존 내 시간 조정: 오프셋만 반영.
	const handleSlide = (minutes: number) => {
		if (!s.scheduled_at) {
			onSetLate(minutes);
			return;
		}
		const wasPool = mine?.status === "late_pool";
		const willPool = isLatePoolArrival(s.scheduled_at, s.ends_at, minutes);
		if (wasPool === willPool) {
			onSetLate(minutes);
			return;
		}
		if (willPool) {
			setPendingLate({ minutes }); // 진입 — 확인
		} else {
			void applyLate(minutes); // 복귀 — 바로 적용
		}
	};
	// 전환 RPC 실행(진입 확인 후 / 복귀 즉시 공용). 실패 시 알림, 성공 시 대기(pending) 해제.
	const applyLate = async (minutes: number) => {
		setLateBusy(true);
		const res = await onApplyLatePool(minutes);
		setLateBusy(false);
		if (!res.ok) {
			alert(res.error ?? "늦참 설정에 실패했습니다.");
			return false;
		}
		return true;
	};
	const confirmLate = async () => {
		if (!pendingLate) return;
		const ok = await applyLate(pendingLate.minutes);
		// 성공해야 다이얼로그를 닫는다(실패면 유지 — 슬라이더 원복 방지).
		if (ok) setPendingLate(null);
	};

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
					{placeMapTarget ? (
						<a
							href={placeMapTarget.webUrl}
							target="_blank"
							rel="noopener noreferrer"
							onClick={(e) => {
								e.stopPropagation();
								e.preventDefault();
								openPlaceMap(placeMapTarget);
							}}
							aria-label={`${placeName ?? "모임 장소"} 지도 열기`}
							className="text-muted inline-flex items-center gap-1 w-fit rounded-full bg-black/[0.05] dark:bg-white/[0.08] active:opacity-70 transition-opacity"
							style={{ fontSize: 12, fontWeight: 500, padding: "3px 10px", marginLeft: -2 }}
						>
							<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
								<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
								<circle cx="12" cy="10" r="2.6" />
							</svg>
							<span className="truncate" style={{ maxWidth: 180 }}>{placeName ?? "모임 장소"}</span>
							<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ opacity: 0.65 }}>
								<path d="m9 18 6-6-6-6" />
							</svg>
						</a>
					) : (
						<span className="text-faint" style={{ fontSize: 12.5 }}>
							{placeName ?? "장소 미정"}
						</span>
					)}
				</div>
			</div>

			{/* 정모: 대진표·안내 진입 — 본문(notice_md)이 실제로 작성된 회차에만.
			    빈 채로 버튼을 띄우면 눌러도 "준비 중" 만 나와 헛걸음이 된다. */}
			{s.is_regular && onOpenNotice && hasNotice && (
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
					{freepassOps.length > 0 ? ` (운영진 ${freepassOps.length}명)` : ""}
					{waiting.length > 0 ? ` · 대기 ${waiting.length}` : ""}
					{latePool.length > 0 ? ` · 늦참 ${latePool.length}` : ""}
					{mealOn ? ` · 🍚 ${mealJoin}` : ""}
				</span>

				{isOpen || isActive ? (
					mine?.status === "confirmed" ? (
						<div className="flex items-center gap-2">
							<span style={statusBadge("#30d158", "rgba(52,199,89,0.14)")}>
								<span style={statusDot("#30d158")} />
								참석 중
							</span>
							<button
								type="button"
								onClick={() => setShowCancelConfirm(true)}
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
								{myWait?.kind === "guestCap"
									? "게스트 정원 대기"
									: `대기 ${myWait?.rank ?? 0}번째`}
							</span>
							<button
								type="button"
								onClick={() => setShowCancelConfirm(true)}
								disabled={busy}
								style={chipBtn("#ef4444", busy)}
							>
								취소
							</button>
						</div>
					) : mine?.status === "late_pool" ? (
						<div className="flex items-center gap-2">
							<span style={statusBadge("var(--late-pool)", "rgba(139,92,246,0.16)")}>
								<span style={statusDot("var(--late-pool)")} />
								🌙 정원 외 늦참
							</span>
							<button
								type="button"
								onClick={() => setShowCancelConfirm(true)}
								disabled={busy}
								style={chipBtn("#ef4444", busy)}
							>
								취소
							</button>
						</div>
					) : joinable ? (
						<button
							type="button"
							onClick={handleJoinClick}
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
					) : (
						<span className="text-faint" style={{ fontSize: 12 }}>
							모집 마감
						</span>
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
							// 대기자는 그레이스케일+감광, 정원 외 늦참은 바이올렛 링으로 확정자와 구분.
							const isWaiting = a.status === "waitlisted";
							const isPool = a.status === "late_pool";
							return (
								<div
									key={a.member_id}
									className={
										isPool
											? "rounded-full ring-2 ring-[#8b5cf6] dark:ring-[#a78bfa]"
											: "rounded-full ring-2 ring-white dark:ring-[#1e1e23]"
									}
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
										photoId={
											(a.member?.is_guest ?? a.invited_by != null)
												? undefined
												: (a.member_id ?? undefined)
										}
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

			{/* 카풀 의향 (참석자) — 카풀 사용 일정에서만. 늦참 슬라이더와 통일된 세그먼트 컨트롤. */}
			{attending && s.carpool_enabled && (
				<div className="ctl-row">
					<span className="ctl-label">카풀</span>
					<div className="ctl-seg">
						{(["can_drive", "need_ride", "none"] as const).map((r) => {
							const active = (mine?.carpool_role ?? "none") === r;
							const fill =
								r === "can_drive"
									? "#2c7a57"
									: r === "need_ride"
										? "#b4762b"
										: "#94a3b8";
							return (
								<button
									key={r}
									type="button"
									onClick={() => onSetCarpool(r)}
									disabled={busy}
									className={active ? "on" : ""}
									style={active ? { background: fill } : undefined}
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
				</div>
			)}

			{/* 식사(회식) 참여 (참석자) — 정모 + 식사 체크 회차에서만. 카풀과 같은 세그먼트 컨트롤.
			    기본이 '참여'라 미선택 상태가 따로 없다(안 먹는 사람만 '안 먹음'으로 바꾼다). */}
			{/* 한 줄에 [참여 | 안 먹음] + 가게 — 카풀 줄의 3등분 격자에 폭을 맞춘다: 세그먼트가 2칸분
			    (flex:2, 내부 2버튼이 각 1칸), 가게가 1칸분(flex:1). 가게는 트랙 안에 넣지 않고
			    기존 알약 디자인 그대로 옆에 둔다. 가게가 없으면 세그먼트가 카풀처럼 풀폭(flex:1).
			    선택은 참석자만, 가게는 참석 여부와 무관하게 노출(어디서 먹는지 알아야 참여를 정한다). */}
			{mealOn && (attending || s.meal_place) && (
				<div className="ctl-row">
					<span className="ctl-label">식사</span>
					{attending && (
						<div
							className="ctl-seg"
							style={s.meal_place ? { flex: 2 } : undefined}
						>
							{([true, false] as const).map((v) => {
								const active = (mine?.meal_joining ?? true) === v;
								return (
									<button
										key={String(v)}
										type="button"
										onClick={() => onSetMeal(v)}
										disabled={busy}
										className={active ? "on" : ""}
										style={
											active
												? { background: v ? "#2c7a57" : "#94a3b8" }
												: undefined
										}
									>
										{v ? "참여" : "안 먹음"}
									</button>
								);
							})}
						</div>
					)}
					<MealPlaceLink
						name={s.meal_place}
						lat={s.meal_place_lat}
						lng={s.meal_place_lng}
						variant={attending ? "card" : "page"}
					/>
				</div>
			)}

			{/* 늦참 체크 (참석자) — 시작·종료가 정해진 open 일정에서만. 8시 경계는 handleSlide가 게이팅. */}
			{attending && isOpen && s.scheduled_at && s.ends_at && (
				<LateArrivalSlider
					scheduledAt={s.scheduled_at}
					endsAt={s.ends_at}
					value={sliderLate}
					disabled={busy || lateBusy || pendingLate != null}
					onChange={handleSlide}
				/>
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
				guestCap={guestCap}
				mealOn={mealOn}
				onAddGuest={onAddGuest}
				onCancelGuest={onCancelGuest}
				onSetGuestMeal={onSetGuestMeal}
			/>

			{/* 참여취소 재확인 — 실수 취소 방지(대기/참석/정원 외 늦참 문구 분기) */}
			{showCancelConfirm && (
				<ConfirmDialog
					title="참여를 취소할까요?"
					message={
						mine?.status === "waitlisted"
							? "대기 신청이 취소됩니다."
							: mine?.status === "late_pool"
								? "정원 외 늦참 신청이 취소됩니다."
								: "참석 신청이 취소됩니다. 대기자가 있으면 자동으로 승급될 수 있어요."
					}
					confirmLabel="참여 취소"
					cancelLabel="닫기"
					tone="danger"
					onConfirm={() => {
						setShowCancelConfirm(false);
						onCancel();
					}}
					onCancel={() => setShowCancelConfirm(false)}
					onDismiss={() => setShowCancelConfirm(false)}
				/>
			)}

			{/* 완전 늦참(2/3 지점 이후) 입장 재확인 — 정상 접수(자리 있으면 확정, 없으면 대기)임을 안내. */}
			{showLateJoinConfirm && (
				<ConfirmDialog
					title="완전 늦참으로 참여할까요?"
					message={`이미 예정 시간의 2/3${
						poolCutoffClock ? `(${poolCutoffClock})` : ""
					}가 지났어요. 자리가 있으면 바로 참여하고, 없으면 대기로 접수돼요.`}
					confirmLabel="참여하기"
					cancelLabel="닫기"
					onConfirm={() => {
						setShowLateJoinConfirm(false);
						onJoin();
					}}
					onCancel={() => setShowLateJoinConfirm(false)}
					onDismiss={() => setShowLateJoinConfirm(false)}
				/>
			)}

			{/* 정원 외 늦참 '진입' 재확인 — 정원과 별도 접수됨을 명시적으로 통보(복귀는 모달 없이 바로 적용). */}
			{pendingLate && (
				<ConfirmDialog
					title="정원 외 늦참으로 신청할까요?"
					message={`${
						poolCutoffClock ? `${poolCutoffClock} 이후 도착이라 ` : ""
					}정원과 별도로 접수돼요. 도착했을 때 자리가 있으면 바로 참여하고, 없으면 대기합니다. 정원 확정 인원에는 포함되지 않아요.${
						mine?.status === "confirmed" && waiting.length > 0
							? " 내 확정 자리는 대기 1순위에게 넘어가요."
							: ""
					}`}
					confirmLabel="늦참으로 신청"
					cancelLabel="닫기"
					busy={lateBusy}
					busyLabel="처리 중…"
					onConfirm={confirmLate}
					onCancel={() => setPendingLate(null)}
					onDismiss={() => setPendingLate(null)}
				/>
			)}

			{/* 세션 시작 버튼: 시작 10분 전부터(=canStart) open 일정에만 노출 */}
			{isAdmin && isOpen && canStart && (
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
