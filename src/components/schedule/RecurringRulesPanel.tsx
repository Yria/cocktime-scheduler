import { ruleSummary } from "../../lib/schedule/recurrence";
import type { RecurringScheduleRow } from "../../lib/supabase/types";
import EmptyState from "../shared/EmptyState";

interface Props {
	rules: RecurringScheduleRow[];
	placeName: (id: number | null) => string | null;
	onAdd: () => void;
	onEdit: (rule: RecurringScheduleRow) => void;
	onToggle: (rule: RecurringScheduleRow) => void;
	onDelete: (rule: RecurringScheduleRow) => void;
}

export default function RecurringRulesPanel({
	rules,
	placeName,
	onAdd,
	onEdit,
	onToggle,
	onDelete,
}: Props) {
	return (
		<div className="flex flex-col gap-2.5">
			{/* 섹션 헤더 */}
			<div className="flex items-center justify-between">
				<h2
					className="text-strong"
					style={{ fontSize: 18, fontWeight: 800 }}
				>
					반복 규칙
				</h2>
				<button type="button" onClick={onAdd} className="btn-tint-blue">
					+ 규칙 추가
				</button>
			</div>

			{rules.length === 0 ? (
				<EmptyState style={{ padding: "20px 8px", lineHeight: 1.5 }}>
					반복 규칙이 없습니다. '+ 규칙 추가'로 매주 반복 일정을 만들어보세요.
				</EmptyState>
			) : (
				rules.map((rule) => {
					const active = rule.is_active;
					return (
						<div
							key={rule.id}
							role="button"
							tabIndex={0}
							onClick={() => onEdit(rule)}
							onKeyDown={(e) => {
								if (e.key === "Enter" || e.key === " ") {
									e.preventDefault();
									onEdit(rule);
								}
							}}
							className="bg-white dark:bg-[rgba(30,30,35,0.8)] border border-[rgba(0,0,0,0.06)] dark:border-[rgba(255,255,255,0.1)]"
							style={{
								borderRadius: 12,
								padding: "12px 14px",
								display: "flex",
								alignItems: "center",
								justifyContent: "space-between",
								gap: 10,
								width: "100%",
								textAlign: "left",
								cursor: "pointer",
								opacity: active ? 1 : 0.55,
							}}
						>
							<div className="flex items-center gap-2 min-w-0">
								<span
									className="text-strong truncate"
									style={{ fontSize: 14, fontWeight: 600 }}
								>
									{ruleSummary(rule, placeName(rule.place_id))}
								</span>
								{!active && (
									<span
										style={{
											fontSize: 10,
											fontWeight: 700,
											color: "#64748b",
											background: "rgba(100,116,139,0.14)",
											padding: "2px 6px",
											borderRadius: 5,
											flexShrink: 0,
										}}
									>
										중지됨
									</span>
								)}
							</div>

							<div className="flex items-center gap-1.5 flex-shrink-0">
								<button
									type="button"
									onClick={(e) => {
										e.stopPropagation();
										onToggle(rule);
									}}
									className="text-muted"
									style={{
										fontSize: 12.5,
										fontWeight: 600,
										background: "none",
										border: "none",
										cursor: "pointer",
										padding: "2px 4px",
									}}
								>
									{active ? "중지" : "켜기"}
								</button>
								<button
									type="button"
									onClick={(e) => {
										e.stopPropagation();
										onDelete(rule);
									}}
									style={{
										fontSize: 12.5,
										fontWeight: 600,
										color: "#ef4444",
										background: "none",
										border: "none",
										cursor: "pointer",
										padding: "2px 4px",
									}}
								>
									삭제
								</button>
							</div>
						</div>
					);
				})
			)}
		</div>
	);
}
