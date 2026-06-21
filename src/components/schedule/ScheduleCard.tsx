import type { AttendanceRow, SessionRow } from "../../lib/supabase/types";

const dtFmt = new Intl.DateTimeFormat("ko-KR", {
	timeZone: "Asia/Seoul",
	month: "long",
	day: "numeric",
	weekday: "short",
	hour: "numeric",
	minute: "2-digit",
});

function fmt(iso: string | null): string {
	return iso ? dtFmt.format(new Date(iso)) : "시간 미정";
}

interface Props {
	session: SessionRow;
	placeName: string | null;
	/** 이 세션의 참석 행(취소 제외) */
	attendances: AttendanceRow[];
	memberId: string | null;
	isAdmin: boolean;
	busy: boolean;
	onJoin: () => void;
	onCancel: () => void;
	onDelete: () => void;
}

export default function ScheduleCard({
	session: s,
	placeName,
	attendances,
	memberId,
	isAdmin,
	busy,
	onJoin,
	onCancel,
	onDelete,
}: Props) {
	const confirmed = attendances.filter((a) => a.status === "confirmed");
	const waiting = attendances.filter((a) => a.status === "waitlisted");
	const mine = memberId
		? attendances.find((a) => a.member_id === memberId)
		: undefined;
	const myWaitRank =
		mine?.status === "waitlisted"
			? waiting.filter((a) => a.position <= mine.position).length
			: 0;
	const isOpen = s.status === "open";

	return (
		<div
			className="bg-white dark:bg-[rgba(30,30,35,0.8)] border border-[rgba(0,0,0,0.06)] dark:border-[rgba(255,255,255,0.1)]"
			style={{ borderRadius: 12, padding: "14px 16px" }}
		>
			<div className="flex items-start justify-between gap-2">
				<div className="flex flex-col gap-1 min-w-0">
					<div className="flex items-center gap-2">
						<span
							className="text-[#0f1724] dark:text-white truncate"
							style={{ fontSize: 15, fontWeight: 700 }}
						>
							{s.title ?? "제목 없음"}
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
					</div>
					<span
						className="text-[#64748b] dark:text-[rgba(235,235,245,0.6)]"
						style={{ fontSize: 13, fontWeight: 500 }}
					>
						{fmt(s.scheduled_at)}
					</span>
					<span
						className="text-[#98a0ab] dark:text-[rgba(235,235,245,0.45)]"
						style={{ fontSize: 12 }}
					>
						{placeName ?? "장소 미정"}
					</span>
				</div>
				{isAdmin && (
					<button
						type="button"
						onClick={onDelete}
						className="text-[#cbd2d9] dark:text-[rgba(235,235,245,0.3)]"
						style={{
							background: "none",
							border: "none",
							fontSize: 12,
							cursor: "pointer",
							flexShrink: 0,
						}}
					>
						삭제
					</button>
				)}
			</div>

			{/* 참석 현황 + 버튼 */}
			<div className="flex items-center justify-between mt-3 pt-3 border-t border-[rgba(0,0,0,0.06)] dark:border-[rgba(255,255,255,0.08)]">
				<span
					className="text-[#64748b] dark:text-[rgba(235,235,245,0.6)]"
					style={{ fontSize: 12.5, fontWeight: 600 }}
				>
					확정 {confirmed.length}
					{s.capacity != null ? `/${s.capacity}` : ""}명
					{waiting.length > 0 ? ` · 대기 ${waiting.length}` : ""}
				</span>

				{isOpen ? (
					mine?.status === "confirmed" ? (
						<div className="flex items-center gap-2">
							<span
								style={{ fontSize: 12.5, fontWeight: 700, color: "#30d158" }}
							>
								참석 확정
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
							<span
								style={{ fontSize: 12.5, fontWeight: 700, color: "#f59e0b" }}
							>
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
						className="text-[#98a0ab] dark:text-[rgba(235,235,245,0.4)]"
						style={{ fontSize: 12 }}
					>
						모집 마감
					</span>
				)}
			</div>
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
