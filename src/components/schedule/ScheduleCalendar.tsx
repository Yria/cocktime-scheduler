import { useMemo } from "react";
import {
	dateStrDow,
	isoToDateKST,
	isoToTimeKST,
	monthGrid,
	todayKST,
} from "../../lib/schedule/calendar";
import { WEEKDAY_LABELS } from "../../lib/schedule/recurrence";
import type { SessionRow } from "../../lib/supabase/types";
import { statusStyle } from "./styles";

interface Props {
	year: number;
	month: number; // 0-based
	occurrences: SessionRow[]; // scheduled_at 보유, 표시 월 그리드 범위
	placeName: (id: number | null) => string | null;
	selectedDate: string | null; // YYYY-MM-DD
	loading: boolean;
	onPrev: () => void;
	onNext: () => void;
	onSelectDate: (date: string) => void;
	onSelectOccurrence: (occ: SessionRow) => void;
	onAddOneOff: (date: string) => void;
}

// 요일 헤더 색조 (일=빨강, 토=파랑, 평일=회색)
function dowColor(dow: number): string {
	if (dow === 0) return "#ef4444";
	if (dow === 6) return "#0b84ff";
	return "#64748b";
}

export default function ScheduleCalendar({
	year,
	month,
	occurrences,
	placeName,
	selectedDate,
	loading,
	onPrev,
	onNext,
	onSelectDate,
	onSelectOccurrence,
	onAddOneOff,
}: Props) {
	const today = todayKST();
	const cells = useMemo(() => monthGrid(year, month), [year, month]);

	// scheduled_at 의 KST 달력 날짜별로 그룹핑
	const byDate = useMemo(() => {
		const map = new Map<string, SessionRow[]>();
		for (const o of occurrences) {
			if (!o.scheduled_at) continue;
			const key = isoToDateKST(o.scheduled_at);
			const arr = map.get(key);
			if (arr) arr.push(o);
			else map.set(key, [o]);
		}
		return map;
	}, [occurrences]);

	// 선택일 회차 목록 (시간 오름차순, 닫힌 것 포함)
	const selectedList = useMemo(() => {
		if (!selectedDate) return [];
		const arr = byDate.get(selectedDate) ?? [];
		return [...arr].sort((a, b) =>
			(a.scheduled_at ?? "").localeCompare(b.scheduled_at ?? ""),
		);
	}, [byDate, selectedDate]);

	const navBtnStyle: React.CSSProperties = {
		background: "none",
		border: "none",
		cursor: "pointer",
		fontSize: 22,
		lineHeight: 1,
		fontWeight: 700,
		padding: "2px 10px",
		color: "#64748b",
	};

	return (
		<div
			className="bg-white dark:bg-[rgba(30,30,35,0.8)] border border-[rgba(0,0,0,0.06)] dark:border-[rgba(255,255,255,0.1)]"
			style={{ borderRadius: 12, padding: 14 }}
		>
			{/* 헤더 */}
			<div className="flex items-center justify-between mb-3">
				<button
					type="button"
					onClick={onPrev}
					aria-label="이전 달"
					style={navBtnStyle}
				>
					‹
				</button>
				<div className="flex items-center gap-2">
					<span
						className="text-[#0f1724] dark:text-white"
						style={{ fontSize: 16, fontWeight: 800 }}
					>
						{year}년 {month + 1}월
					</span>
					{loading && (
						<span
							className="text-[#98a0ab] dark:text-[rgba(235,235,245,0.4)]"
							style={{ fontSize: 11, fontWeight: 600 }}
						>
							불러오는 중…
						</span>
					)}
				</div>
				<button
					type="button"
					onClick={onNext}
					aria-label="다음 달"
					style={navBtnStyle}
				>
					›
				</button>
			</div>

			{/* 요일 헤더 */}
			<div className="grid grid-cols-7 mb-1">
				{WEEKDAY_LABELS.map((label, dow) => (
					<div
						key={label}
						style={{
							textAlign: "center",
							fontSize: 12,
							fontWeight: 700,
							padding: "4px 0",
							color: dowColor(dow),
						}}
					>
						{label}
					</div>
				))}
			</div>

			{/* 날짜 그리드 (42칸) */}
			<div className="grid grid-cols-7 gap-0.5">
				{cells.map((cell) => {
					const dow = dateStrDow(cell.date);
					const isToday = cell.date === today;
					const isSelected = cell.date === selectedDate;
					const dayOccs = (byDate.get(cell.date) ?? []).filter(
						(o) => o.status !== "closed",
					);
					const dots = dayOccs.slice(0, 3);
					const extra = dayOccs.length - dots.length;
					return (
						<button
							key={cell.date}
							type="button"
							onClick={() => onSelectDate(cell.date)}
							style={{
								minHeight: 46,
								display: "flex",
								flexDirection: "column",
								alignItems: "center",
								gap: 3,
								padding: "4px 0 3px",
								borderRadius: 9,
								cursor: "pointer",
								background: isSelected
									? "rgba(11,132,255,0.12)"
									: "transparent",
								border: isSelected
									? "1px solid #0b84ff"
									: "1px solid transparent",
								opacity: cell.inMonth ? 1 : 0.35,
							}}
						>
							<span
								style={{
									fontSize: 13,
									fontWeight: isToday ? 800 : 500,
									width: 22,
									height: 22,
									lineHeight: "22px",
									textAlign: "center",
									borderRadius: "50%",
									color: isToday ? "#fff" : dowColor(dow),
									background: isToday ? "#0b84ff" : "transparent",
								}}
							>
								{cell.day}
							</span>
							<div className="flex items-center gap-0.5" style={{ height: 6 }}>
								{dots.map((o) => (
									<span
										key={o.id}
										style={{
											width: 5,
											height: 5,
											borderRadius: "50%",
											background: statusStyle(o.status).color,
										}}
									/>
								))}
								{extra > 0 && (
									<span
										className="text-[#98a0ab] dark:text-[rgba(235,235,245,0.4)]"
										style={{ fontSize: 9, fontWeight: 700, lineHeight: 1 }}
									>
										+{extra}
									</span>
								)}
							</div>
						</button>
					);
				})}
			</div>

			{/* 선택일 상세 */}
			{selectedDate && (
				<div className="mt-3 pt-3 border-t border-[rgba(0,0,0,0.06)] dark:border-[rgba(255,255,255,0.08)]">
					<div
						className="text-[#0f1724] dark:text-white mb-2"
						style={{ fontSize: 14, fontWeight: 700 }}
					>
						{Number(selectedDate.slice(5, 7))}월 {Number(selectedDate.slice(8, 10))}일 (
						{WEEKDAY_LABELS[dateStrDow(selectedDate)]})
					</div>

					{selectedList.length === 0 ? (
						<div
							className="text-[#98a0ab] dark:text-[rgba(235,235,245,0.4)]"
							style={{ fontSize: 13, padding: "10px 0" }}
						>
							이 날 일정 없음
						</div>
					) : (
						<div className="flex flex-col gap-1.5">
							{selectedList.map((o) => {
								const st = statusStyle(o.status);
								const cancelled = o.status === "cancelled";
								const place = placeName(o.place_id);
								return (
									<button
										key={o.id}
										type="button"
										onClick={() => onSelectOccurrence(o)}
										className="bg-[rgba(0,0,0,0.02)] dark:bg-[rgba(255,255,255,0.04)]"
										style={{
											display: "flex",
											alignItems: "center",
											gap: 8,
											width: "100%",
											textAlign: "left",
											border: "none",
											borderRadius: 9,
											padding: "9px 11px",
											cursor: "pointer",
											opacity: cancelled ? 0.55 : 1,
										}}
									>
										<span
											className="text-[#0f1724] dark:text-white"
											style={{
												fontSize: 14,
												fontWeight: 700,
												textDecoration: cancelled ? "line-through" : "none",
											}}
										>
											{o.scheduled_at ? isoToTimeKST(o.scheduled_at) : "--:--"}
										</span>
										<span
											className="text-[#64748b] dark:text-[rgba(235,235,245,0.6)] truncate"
											style={{
												fontSize: 12.5,
												flex: 1,
												minWidth: 0,
												textDecoration: cancelled ? "line-through" : "none",
											}}
										>
											{place ?? "장소 미정"}
										</span>
										<span
											className="text-[#98a0ab] dark:text-[rgba(235,235,245,0.45)]"
											style={{ fontSize: 11.5, fontWeight: 500, flexShrink: 0 }}
										>
											{o.capacity != null ? `최대 ${o.capacity}명` : "무제한"}
										</span>
										<span
											style={{
												fontSize: 10.5,
												fontWeight: 700,
												color: st.color,
												background: st.bg,
												padding: "2px 6px",
												borderRadius: 5,
												flexShrink: 0,
											}}
										>
											{st.label}
										</span>
									</button>
								);
							})}
						</div>
					)}

					<button
						type="button"
						onClick={() => onAddOneOff(selectedDate)}
						className="text-[#0b84ff] border border-[rgba(11,132,255,0.4)] dark:border-[rgba(11,132,255,0.5)]"
						style={{
							width: "100%",
							marginTop: 10,
							padding: "9px",
							borderRadius: 9,
							fontSize: 13.5,
							fontWeight: 700,
							background: "transparent",
							cursor: "pointer",
						}}
					>
						+ 이 날 일정 추가
					</button>
				</div>
			)}
		</div>
	);
}
