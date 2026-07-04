import type { SessionStatus } from "../../lib/supabase/types";

// 회차 상태별 색상 (달력 칩 / 라벨)
export interface StatusStyle {
	label: string;
	color: string;
	bg: string;
}

export function statusStyle(status: SessionStatus): StatusStyle {
	switch (status) {
		case "draft":
			return { label: "예정", color: "#64748b", bg: "rgba(100,116,139,0.14)" };
		case "open":
			return { label: "모집중", color: "#0b84ff", bg: "rgba(11,132,255,0.14)" };
		case "active":
			return { label: "진행중", color: "#16a34a", bg: "rgba(52,199,89,0.16)" };
		case "closed":
			return { label: "종료", color: "#94a3b8", bg: "rgba(148,163,184,0.14)" };
		case "cancelled":
			return { label: "취소됨", color: "#ef4444", bg: "rgba(239,68,68,0.12)" };
	}
}
