import { useState } from "react";
import { X } from "lucide-react";
import type { AttendanceRow, SessionRow } from "../../lib/supabase/types";
import { fmtClock, fmtRange } from "../../lib/schedule/timeFmt";
import { waitDisplay, guestCapForSession, splitConfirmedByCapacity, freepassSummary, isNewbieAtt, type WaitDisplay } from "../../lib/schedule/waitStatus";
import { useAuthStore } from "../../store/authStore";
import { scheduleActions } from "../../store/scheduleStore";
import { toast } from "../../store/toastStore";
import ModalSheet from "../common/ModalSheet";
import NewMemberIcon from "../shared/NewMemberIcon";
import TicketIcon from "../shared/TicketIcon";
import ConfirmDialog from "../common/ConfirmDialog";
import EmptyState from "../shared/EmptyState";
import PlayerAvatar from "../shared/PlayerAvatar";
import BirthYearTag from "../shared/BirthYearTag";
import { nameWithBirthYear } from "../../lib/birthYear";

interface Props {
	session: SessionRow;
	placeName: string | null;
	/** 이 세션의 참석 행(취소 제외, position 오름차순) */
	attendances: AttendanceRow[];
	memberId: string | null;
	/** 오버레이 z-index(기본 50). 다른 시트(일정 관리 달력의 회차 시트) 위에 겹쳐 띄울 때 올린다. */
	zIndex?: number;
	/** 운영진 제거 버튼 노출(기본 true). 지난 회차 열람처럼 읽기 전용으로 띄울 땐 false —
	 *  종료된 회차의 참석 행은 대관비 엔빵·회비 부과의 근거라 임의로 지우면 정산이 어긋난다. */
	allowRemove?: boolean;
	onClose: () => void;
}

/**
 * 일정 참가자 목록 모달 — 읽기 전용 리스트형.
 * 확정/대기 그룹으로 나눠 아바타 + 이름 + (게스트/본인) + 카풀 의향/대기순번을 한 줄에 표시한다.
 */
export default function SessionParticipantsModal({
	session: s,
	placeName,
	attendances,
	memberId,
	zIndex = 50,
	allowRemove = true,
	onClose,
}: Props) {
	const confirmed = attendances.filter((a) => a.status === "confirmed");
	const waiting = attendances.filter((a) => a.status === "waitlisted");
	const latePool = attendances.filter((a) => a.status === "late_pool");
	// 정원 초과(프리패스=만석일 때 들어온 운영진·신규회원)만 별도 섹션으로. 정원 안 운영진·신규는 확정에 그대로 포함.
	const split = splitConfirmedByCapacity(attendances, s.capacity);
	const { base: confirmedBase, over: freepassOver } = split;
	const freepass = freepassSummary(split);
	// 신규 표식(🌱)은 ParticipantRow 가 행마다 직접 판정한다 — 섹션과 무관하게 **가입 2주 이내
	// 회원이면 항상** 붙는다(운영자 결정 2026-09-03). 요약 문구의 사유별 인원은 한 사람을 두 번 세지
	// 않으려고 운영진/신규를 배타 분류하지만(freepassSummary), 표식은 그 분류를 따르지 않는다.
	const guestCap = guestCapForSession(s.scheduled_at);
	// 정모 식사 체크 회차 — 헤더 집계 + 행 표식(불참자만). 카드(ScheduleCard)와 같은 기준으로 센다.
	const mealOn = s.is_regular && s.meal_enabled;
	const mealJoin = [...confirmed, ...latePool].filter((a) => a.meal_joining).length;

	// 운영진만 임의 참석자 제거 가능(본인 행은 제외 — 본인은 카드의 '참여 취소' 사용).
	// allowRemove=false(지난 회차 열람)면 운영진에게도 감춘다.
	const isAdmin = useAuthStore((st) => st.isAdmin);
	const canRemove = isAdmin && allowRemove;
	const [pendingRemove, setPendingRemove] = useState<AttendanceRow | null>(null);
	const [removing, setRemoving] = useState(false);

	async function handleRemove() {
		if (!pendingRemove) return;
		setRemoving(true);
		const res = await scheduleActions.adminRemove(s.id, pendingRemove.member_id);
		setRemoving(false);
		if (res.ok) setPendingRemove(null);
		else toast("제거에 실패했어요. 잠시 후 다시 시도해주세요.", { variant: "error" });
	}

	// 제거 확인 문구 — 확정/대기, 회원/게스트(알림 수신자), 세션 상태에 따라 분기.
	function removeMessage(a: AttendanceRow): string {
		const isGuest = a.member?.is_guest ?? a.invited_by != null;
		// 운영진이 본인이 초대한 게스트를 제거하면 RPC 는 수신자==본인이라 통지를 생략 → 안내도 생략.
		const notifies = !(isGuest && a.invited_by === memberId);
		const to = isGuest ? "신청한 회원에게" : "당사자에게";
		const notice = notifies ? ` ${to} 알림이 갑니다.` : "";
		if (a.status === "confirmed") {
			// 대기 자동 승급은 open 세션에서만 일어남(active 는 승급 없이 확정 해제만) → 승급 안내도 open 일 때만.
			const promote = s.status === "open" ? " 대기자가 있으면 자동으로 승급됩니다." : "";
			return `확정 참석에서 제외됩니다.${promote}${notice}`;
		}
		return `대기 명단에서 제외됩니다.${notice}`;
	}

	return (
		<ModalSheet position="bottom" zIndex={zIndex} onClose={onClose}>
			{/* 헤더 */}
			<div className="px-5 pt-5 pb-3">
				<div
					className="text-strong"
					style={{ fontSize: 15.5, fontWeight: 800 }}
				>
					{fmtRange(s.scheduled_at, s.ends_at)}
				</div>
				<div
					className="text-faint mt-0.5"
					style={{ fontSize: 12.5 }}
				>
					{placeName ?? "장소 미정"}
				</div>
				<div
					className="text-muted mt-1.5"
					style={{ fontSize: 12.5, fontWeight: 600 }}
				>
					확정 {split.counted.length}
					{s.capacity != null ? `/${s.capacity}` : ""}명
					{freepass ? ` (${freepass})` : ""}
					{waiting.length > 0 ? ` · 대기 ${waiting.length}` : ""}
					{latePool.length > 0 ? ` · 늦참 ${latePool.length}` : ""}
					{mealOn ? ` · 식사 ${mealJoin}명` : ""}
				</div>
			</div>

			{/* 리스트 (스크롤) */}
			<div className="px-3 pb-5 overflow-y-auto no-sb" style={{ maxHeight: "60vh" }}>
				{confirmed.length === 0 &&
				waiting.length === 0 &&
				latePool.length === 0 ? (
					<EmptyState>아직 참가자가 없습니다.</EmptyState>
				) : (
					<>
						{confirmedBase.length > 0 && (
							<Section title={`확정 ${confirmedBase.length}명`}>
								{confirmedBase.map((a) => (
									<ParticipantRow
										key={a.member_id}
										row={a}
										memberId={memberId}
										carpoolEnabled={s.carpool_enabled}
										mealOn={mealOn}
										scheduledAt={s.scheduled_at}
										canRemove={canRemove}
										onRemove={setPendingRemove}
									/>
								))}
							</Section>
						)}

						{freepassOver.length > 0 && (
							<>
								{confirmedBase.length > 0 && (
									<div className="mx-2 my-1.5 border-t border-[rgba(0,0,0,0.06)] dark:border-[rgba(255,255,255,0.08)]" />
								)}
								<Section title={`${freepass} · 정원 외`}>
									{freepassOver.map((a) => (
										<ParticipantRow
											key={a.member_id}
											row={a}
											memberId={memberId}
											carpoolEnabled={s.carpool_enabled}
											mealOn={mealOn}
											scheduledAt={s.scheduled_at}
											canRemove={canRemove}
											onRemove={setPendingRemove}
										/>
									))}
								</Section>
							</>
						)}

						{waiting.length > 0 && (
							<>
								{confirmed.length > 0 && (
									<div className="mx-2 my-1.5 border-t border-[rgba(0,0,0,0.06)] dark:border-[rgba(255,255,255,0.08)]" />
								)}
								<Section title={`대기 ${waiting.length}명`}>
									{waiting.map((a) => (
										<ParticipantRow
											key={a.member_id}
											row={a}
											memberId={memberId}
											carpoolEnabled={s.carpool_enabled}
											mealOn={mealOn}
											scheduledAt={s.scheduled_at}
											waitInfo={waitDisplay(attendances, a, guestCap)}
											canRemove={canRemove}
											onRemove={setPendingRemove}
										/>
									))}
								</Section>
							</>
						)}

						{latePool.length > 0 && (
							<>
								{(confirmed.length > 0 || waiting.length > 0) && (
									<div className="mx-2 my-1.5 border-t border-[rgba(0,0,0,0.06)] dark:border-[rgba(255,255,255,0.08)]" />
								)}
								<Section title={`정원 외 늦참 ${latePool.length}명`}>
									{latePool.map((a) => (
										<ParticipantRow
											key={a.member_id}
											row={a}
											memberId={memberId}
											carpoolEnabled={s.carpool_enabled}
											mealOn={mealOn}
											scheduledAt={s.scheduled_at}
											isPool
											canRemove={canRemove}
											onRemove={setPendingRemove}
										/>
									))}
								</Section>
							</>
						)}
					</>
				)}
			</div>

			{/* 운영진: 제거 재확인 — 참여목록 모달(기본 z=50) 위에 겹쳐 띄운다(+20). */}
			{pendingRemove && (
				<ConfirmDialog
					zIndex={zIndex + 20}
					title={`${pendingRemove.member?.name ?? "회원"}님을 제거할까요?`}
					message={removeMessage(pendingRemove)}
					confirmLabel="제거"
					cancelLabel="닫기"
					tone="danger"
					busy={removing}
					busyLabel="제거 중…"
					onConfirm={handleRemove}
					onCancel={() => setPendingRemove(null)}
					onDismiss={() => setPendingRemove(null)}
				/>
			)}
		</ModalSheet>
	);
}

/**
 * 운영진 표식용 채운(fill) 왕관 아이콘(Tabler filled crown, 24 그리드 = lucide와 동일).
 * 이모지(👑)는 플랫폼마다 모양이 달라 인라인 SVG로 고정. 색은 currentColor로 부모 className에서 주입.
 */
function CrownIcon({ size = 16 }: { size?: number }) {
	return (
		<svg
			width={size}
			height={size}
			viewBox="0 0 24 24"
			fill="currentColor"
			aria-hidden="true"
		>
			<path d="M19 19h-14c-.5 0 -.9 -.3 -1 -.8l-2 -10c0 -.4 .1 -.8 .5 -1.1c.4 -.2 .8 -.2 1.1 0l4.1 3.3l3.4 -5.1c.4 -.6 1.3 -.6 1.7 0l3.4 5.1l4.1 -3.3c.3 -.3 .8 -.3 1.1 0c.4 .2 .5 .6 .5 1.1l-2 10c0 .5 -.5 .8 -1 .8z" />
		</svg>
	);
}

/**
 * 참가자 뱃지 pill(게스트용) — 색은 className으로 주입해 다크모드(dark:)에서 밝은 톤으로 분기
 * (라이트 톤은 다크 서페이스에서 묻힘). 운영진은 pill 대신 CrownIcon 으로 표기.
 */
function Pill({
	className,
	children,
}: {
	className: string;
	children: React.ReactNode;
}) {
	return (
		<span
			className={className}
			style={{
				fontSize: 11,
				fontWeight: 700,
				padding: "2px 7px",
				borderRadius: 999,
				flexShrink: 0,
			}}
		>
			{children}
		</span>
	);
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
	return (
		<div>
			<div
				className="text-faint px-2 pt-1.5 pb-1"
				style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: 0.2 }}
			>
				{title}
			</div>
			{children}
		</div>
	);
}

function ParticipantRow({
	row: a,
	memberId,
	carpoolEnabled,
	mealOn,
	scheduledAt,
	waitInfo,
	isPool = false,
	canRemove = false,
	onRemove,
}: {
	row: AttendanceRow;
	memberId: string | null;
	carpoolEnabled: boolean;
	/** 정모 식사 체크 회차 — 불참자에게만 '식사 안 함' 표식을 붙인다(기본이 참여라 불참이 정보). */
	mealOn: boolean;
	scheduledAt: string | null;
	/** 대기 행이면 표시 상태(순번 또는 게스트 정원 대기). 확정/늦참 행은 undefined. */
	waitInfo?: WaitDisplay;
	/** 정원 외 늦참(late_pool) 행 — 바이올렛 링 + 도착시각 강조. */
	isPool?: boolean;
	/** 운영진 뷰 — 제거 버튼 노출(본인 행 제외). */
	canRemove?: boolean;
	onRemove?: (row: AttendanceRow) => void;
}) {
	const name = a.member?.name ?? "회원";
	const isMe = a.member_id === memberId;
	const isGuest = a.member?.is_guest ?? a.invited_by != null;
	// 운영진 여부 — nested user_roles 에 role='admin' 행이 있으면 운영진(게스트는 role 없음 → 자동 제외).
	const isAdmin = (a.member?.user_roles ?? []).some((r) => r.role === "admin");
	// 가입 2주 이내(=이 회차에서 대기줄을 건너뛸 수 있는) 회원인가 — 확정·정원 외·대기·늦참 어느
	// 섹션에서든 표식을 붙인다. 게스트·유예 지난 회원은 false(isNewbieAtt).
	const isNewbie = isNewbieAtt(a, scheduledAt);

	// 게스트를 데려온(신청한) 회원 이름 — 배지에 함께 노출. 신청자 회원이 삭제되면 null → "게스트"만.
	// 배지 안 문구라 회색 분리 대신 한 문자열로 년생을 붙인다("홍길동 85님 게스트").
	const inviterName = a.inviter
		? nameWithBirthYear(a.inviter.name, a.inviter.birth_year)
		: null;

	const isWaiting = waitInfo != null;
	// 늦참 도착시각 — 대기자가 아니고 오프셋>0·시작시각 有 일 때. "⏰ 오후 8:00~"(정원 외는 🌙 바이올렛)
	const lateArrival =
		!isWaiting && a.late_minutes > 0 && scheduledAt
			? fmtClock(
					new Date(
						new Date(scheduledAt).getTime() + a.late_minutes * 60000,
					).toISOString(),
				)
			: null;

	return (
		<div className="flex items-center gap-2.5 px-2 py-1.5">
			{/* 대기자는 그레이스케일+감광, 정원 외 늦참은 바이올렛 링으로 확정자와 구분 */}
			<div
				style={{
					filter: isWaiting ? "grayscale(1)" : undefined,
					opacity: isWaiting ? 0.55 : 1,
					borderRadius: 999,
					boxShadow: isPool ? "0 0 0 2px var(--late-pool)" : undefined,
				}}
			>
				<PlayerAvatar name={name} gender={a.member?.gender ?? null} photoId={isGuest ? undefined : (a.member_id ?? undefined)} size={34} />
			</div>
			<span
				className="text-strong truncate min-w-0"
				style={{ fontSize: 13.5, fontWeight: 600 }}
			>
				{name}
				<BirthYearTag birthYear={a.member?.birth_year} size={11.5} />
				{isMe && (
					<span
						className="text-faint ml-1"
						style={{ fontSize: 12, fontWeight: 500 }}
					>
						(나)
					</span>
				)}
			</span>
			{isAdmin && (
				<span
					className="text-[#f59e0b] dark:text-[#fbbf24] inline-flex flex-shrink-0"
					role="img"
					aria-label="운영진"
					title="운영진"
				>
					<CrownIcon size={16} />
				</span>
			)}
			{/* 신규 회원 표식 — 운영진 왕관과 같은 아이콘 전용 표기. 이름 뒤 배지가 길어지면 긴 이름이
			    밀려 잘리므로 설명은 title/aria-label 로만 준다. */}
			{isNewbie && (
				<span
					className="text-[#15803d] dark:text-[#6ee7a8] inline-flex flex-shrink-0"
					role="img"
					aria-label="신규 회원 (가입 2주 이내)"
					title="신규 회원 · 가입 2주 이내라 만석이어도 참여"
				>
					<NewMemberIcon size={16} />
				</span>
			)}
			{/* 우선참여권으로 얻은 자리 표식 — 신규 표식과 달리 '사람'이 아니라 **그 자리의 성격**이라
			    행의 exempt_reason 을 그대로 본다. 헤더 배지와 달리 여기서는 반짝이지 않는다
			    (.ticket-badge 를 붙이지 않는다 — 목록에서 여러 개가 명멸하면 읽기 어렵다). */}
			{a.exempt_reason === "ticket" && (
				<span
					className="inline-flex flex-shrink-0"
					style={{ color: "var(--ticket-gold)" }}
					role="img"
					aria-label="우선참여권으로 참여"
					title="우선참여권 · 대기 포인트 7점으로 정원 외 자리 참여"
				>
					<TicketIcon size={16} />
				</span>
			)}
			{isGuest && (
				<Pill className="text-[#b4762b] bg-[rgba(180,118,43,0.12)] dark:text-[#e0a860] dark:bg-[rgba(224,168,96,0.16)]">
					🎫 {inviterName ? `${inviterName}님 게스트` : "게스트"}
				</Pill>
			)}

			{/* 우측: 식사 불참 + 늦참 도착시각 + (대기순번 또는 카풀 의향).
			    식사 표식은 카풀/대기 삼항과 배타가 아니라 독립 — 대기자에게도 함께 보인다. */}
			<span
				className="ml-auto flex-shrink-0 flex items-center gap-1.5"
				style={{ fontSize: 12, fontWeight: 700 }}
			>
				{mealOn && !a.meal_joining && (
					<span className="text-faint">식사 안 함</span>
				)}
				{lateArrival &&
					(isPool ? (
						<span style={{ color: "var(--late-pool)" }}>🌙 {lateArrival}~</span>
					) : (
						<span style={{ color: "var(--late-amber)" }}>⏰ {lateArrival}~</span>
					))}
				{waitInfo != null ? (
					<span style={{ color: "#f59e0b" }}>
						{waitInfo.kind === "guestCap"
							? "게스트 정원 대기"
							: `대기 ${waitInfo.rank}번째`}
					</span>
				) : carpoolEnabled && a.carpool_role === "can_drive" ? (
					<span style={{ color: "#2c7a57" }}>🚗 운전 가능</span>
				) : carpoolEnabled && a.carpool_role === "need_ride" ? (
					<span style={{ color: "#b4762b" }}>🙋 탑승 필요</span>
				) : null}
			</span>

			{/* 운영진 전용 제거 버튼 — 본인 행은 제외(본인은 카드의 '참여 취소' 사용). */}
			{canRemove && !isMe && onRemove && (
				<button
					type="button"
					onClick={() => onRemove(a)}
					aria-label={`${name} 제거`}
					className="flex-shrink-0 inline-flex items-center justify-center rounded-full text-faint hover:text-[#e5484d] hover:bg-[rgba(229,72,77,0.12)] transition-colors"
					style={{ width: 26, height: 26 }}
				>
					<X size={15} strokeWidth={2.5} />
				</button>
			)}
		</div>
	);
}
