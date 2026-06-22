import type { CSSProperties } from "react";
import type { SessionStatus } from "../../lib/supabase/types";

// 폼 입력 (구 ScheduleForm 와 동일 톤)
export const labelCls =
	"text-[#64748b] dark:text-[rgba(235,235,245,0.6)] block mb-1.5";
export const inputCls =
	"w-full bg-white dark:bg-[rgba(30,30,35,0.8)] text-[#0f1724] dark:text-white border border-[rgba(0,0,0,0.12)] dark:border-[rgba(255,255,255,0.12)]";
export const inputStyle: CSSProperties = {
	padding: "11px 13px",
	borderRadius: 10,
	fontSize: 15,
	outline: "none",
};
export const labelStyle: CSSProperties = { fontSize: 13, fontWeight: 600 };

export function primaryBtnStyle(busy: boolean): CSSProperties {
	return {
		width: "100%",
		padding: "14px",
		borderRadius: 12,
		fontSize: 16,
		fontWeight: 700,
		color: "#fff",
		background: busy ? "rgba(11,132,255,0.5)" : "#0b84ff",
		border: "none",
		cursor: busy ? "not-allowed" : "pointer",
		boxShadow: busy ? "none" : "0 4px 16px rgba(11,132,255,0.3)",
	};
}

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

// 모달 오버레이/시트 (모바일 바텀시트 톤)
export const overlayStyle: CSSProperties = {
	position: "fixed",
	inset: 0,
	background: "rgba(0,0,0,0.45)",
	display: "flex",
	alignItems: "flex-end",
	justifyContent: "center",
	zIndex: 50,
	padding: 0,
};

export const sheetCls =
	"w-full max-w-sm bg-[#fafbff] dark:bg-[#0f172a] border-t border-[rgba(0,0,0,0.08)] dark:border-[rgba(255,255,255,0.08)]";
export const sheetStyle: CSSProperties = {
	borderTopLeftRadius: 18,
	borderTopRightRadius: 18,
	padding: "1.25rem",
	paddingBottom: "max(1.25rem, env(safe-area-inset-bottom))",
	maxHeight: "85dvh",
	overflowY: "auto",
};
