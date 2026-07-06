import type { AttendanceRow, SessionRow } from "../../lib/supabase/types";
import { fmtRange } from "../../lib/schedule/timeFmt";
import ModalSheet from "../common/ModalSheet";
import EmptyState from "../shared/EmptyState";
import PlayerAvatar from "../shared/PlayerAvatar";

interface Props {
	session: SessionRow;
	placeName: string | null;
	/** 이 세션의 참석 행(취소 제외, position 오름차순) */
	attendances: AttendanceRow[];
	memberId: string | null;
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
	onClose,
}: Props) {
	const confirmed = attendances.filter((a) => a.status === "confirmed");
	const waiting = attendances.filter((a) => a.status === "waitlisted");

	return (
		<ModalSheet position="bottom" onClose={onClose}>
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
					확정 {confirmed.length}
					{s.capacity != null ? `/${s.capacity}` : ""}명
					{waiting.length > 0 ? ` · 대기 ${waiting.length}` : ""}
				</div>
			</div>

			{/* 리스트 (스크롤) */}
			<div className="px-3 pb-5 overflow-y-auto no-sb" style={{ maxHeight: "60vh" }}>
				{confirmed.length === 0 && waiting.length === 0 ? (
					<EmptyState>아직 참가자가 없습니다.</EmptyState>
				) : (
					<>
						{confirmed.length > 0 && (
							<Section title={`확정 ${confirmed.length}명`}>
								{confirmed.map((a) => (
									<ParticipantRow
										key={a.member_id}
										row={a}
										memberId={memberId}
										carpoolEnabled={s.carpool_enabled}
									/>
								))}
							</Section>
						)}

						{waiting.length > 0 && (
							<>
								{confirmed.length > 0 && (
									<div className="mx-2 my-1.5 border-t border-[rgba(0,0,0,0.06)] dark:border-[rgba(255,255,255,0.08)]" />
								)}
								<Section title={`대기 ${waiting.length}명`}>
									{waiting.map((a, i) => (
										<ParticipantRow
											key={a.member_id}
											row={a}
											memberId={memberId}
											carpoolEnabled={s.carpool_enabled}
											waitRank={i + 1}
										/>
									))}
								</Section>
							</>
						)}
					</>
				)}
			</div>
		</ModalSheet>
	);
}

/**
 * 참가자 뱃지 pill(운영진/게스트 공용) — 색만 다르고 모양 동일.
 * 색은 className으로 주입해 다크모드(dark:)에서 밝은 톤으로 분기(라이트 톤은 다크 서페이스에서 묻힘).
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
	waitRank,
}: {
	row: AttendanceRow;
	memberId: string | null;
	carpoolEnabled: boolean;
	waitRank?: number;
}) {
	const name = a.member?.name ?? "회원";
	const isMe = a.member_id === memberId;
	const isGuest = a.member?.is_guest ?? a.invited_by != null;
	// 운영진 여부 — nested user_roles 에 role='admin' 행이 있으면 운영진(게스트는 role 없음 → 자동 제외).
	const isAdmin = (a.member?.user_roles ?? []).some((r) => r.role === "admin");
	// 게스트를 데려온(신청한) 회원 이름 — 배지에 함께 노출. 신청자 회원이 삭제되면 null → "게스트"만.
	const inviterName = a.inviter?.name ?? null;

	const isWaiting = waitRank != null;

	return (
		<div className="flex items-center gap-2.5 px-2 py-1.5">
			{/* 대기자는 그레이스케일+감광으로 확정자와 구분 */}
			<div
				style={{
					filter: isWaiting ? "grayscale(1)" : undefined,
					opacity: isWaiting ? 0.55 : 1,
				}}
			>
				<PlayerAvatar name={name} gender={a.member?.gender ?? null} size={34} />
			</div>
			<span
				className="text-strong truncate min-w-0"
				style={{ fontSize: 13.5, fontWeight: 600 }}
			>
				{name}
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
				<Pill className="text-[#6d5bd0] bg-[rgba(109,91,208,0.12)] dark:text-[#b3a4f5] dark:bg-[rgba(179,164,245,0.16)]">
					🛡️ 운영진
				</Pill>
			)}
			{isGuest && (
				<Pill className="text-[#b4762b] bg-[rgba(180,118,43,0.12)] dark:text-[#e0a860] dark:bg-[rgba(224,168,96,0.16)]">
					🎫 {inviterName ? `${inviterName}님 게스트` : "게스트"}
				</Pill>
			)}

			{/* 우측: 대기순번 또는 카풀 의향 */}
			<span className="ml-auto flex-shrink-0" style={{ fontSize: 12, fontWeight: 700 }}>
				{waitRank != null ? (
					<span style={{ color: "#f59e0b" }}>대기 {waitRank}번째</span>
				) : carpoolEnabled && a.carpool_role === "can_drive" ? (
					<span style={{ color: "#2c7a57" }}>🚗 운전 가능</span>
				) : carpoolEnabled && a.carpool_role === "need_ride" ? (
					<span style={{ color: "#b4762b" }}>🙋 탑승 필요</span>
				) : null}
			</span>
		</div>
	);
}
