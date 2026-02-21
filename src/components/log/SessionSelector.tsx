import type { SessionRow } from "../../lib/supabase/types";

function formatSessionLabel(row: SessionRow): string {
	const d = new Date(row.started_at);
	const month = d.getMonth() + 1;
	const day = d.getDate();
	const h = d.getHours().toString().padStart(2, "0");
	const m = d.getMinutes().toString().padStart(2, "0");
	return `${month}/${day} ${h}:${m}`;
}

interface SessionSelectorProps {
	loading: boolean;
	sessions: SessionRow[];
	selectedId: number | null;
	setSelectedId: (id: number) => void;
}

export default function SessionSelector({
	loading,
	sessions,
	selectedId,
	setSelectedId,
}: SessionSelectorProps) {
	return (
		<div
			className="flex-shrink-0 flex gap-2 overflow-x-auto no-sb"
			style={{
				background: "#ffffff",
				borderBottom: "0.5px solid rgba(0,0,0,0.06)",
				padding: "10px 16px",
			}}
		>
			{loading ? (
				<span style={{ fontSize: 13, color: "#98a0ab" }}>불러오는 중…</span>
			) : sessions.length === 0 ? (
				<span style={{ fontSize: 13, color: "#98a0ab" }}>
					세션 기록이 없습니다
				</span>
			) : (
				sessions.map((s) => {
					const isSelected = s.id === selectedId;
					return (
						<button
							key={s.id}
							type="button"
							onClick={() => setSelectedId(s.id)}
							style={{
								flexShrink: 0,
								fontSize: 13,
								fontWeight: isSelected ? 600 : 500,
								padding: "5px 14px",
								borderRadius: 20,
								border: isSelected ? "none" : "1px solid rgba(0,0,0,0.1)",
								background: isSelected ? "#0b84ff" : "transparent",
								color: isSelected ? "#fff" : "#64748b",
								cursor: "pointer",
								display: "flex",
								alignItems: "center",
								gap: 5,
							}}
						>
							{s.is_active && (
								<span
									style={{
										width: 6,
										height: 6,
										borderRadius: "50%",
										background: isSelected ? "#fff" : "#34c759",
										boxShadow: isSelected
											? "none"
											: "0 0 4px rgba(52,199,89,0.6)",
										flexShrink: 0,
									}}
								/>
							)}
							{s.is_active ? "현재 세션" : formatSessionLabel(s)}
						</button>
					);
				})
			)}
		</div>
	);
}
