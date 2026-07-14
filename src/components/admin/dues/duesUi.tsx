import type { ReactNode } from "react";

// 회계 UI 공용 프리미티브. 입금·출금 정산행 등에서 재사용(중복 제거).

/**
 * 선택 토글 칩(초록 활성 + ✓ 접두). 정산함 입금 항목칩·출금 선택칩 공용.
 * key 는 상위 map 에서 <ToggleChip key=… /> 로 지정.
 */
export function ToggleChip({ label, on, onClick, disabled }: { label: ReactNode; on: boolean; onClick: () => void; disabled?: boolean }) {
	return (
		<button
			type="button"
			onClick={onClick}
			disabled={disabled}
			className={on ? "text-[#1c8a3b]" : "text-faint"}
			style={{ fontSize: 12.5, fontWeight: on ? 700 : 500, padding: "5px 11px", borderRadius: 8, cursor: "pointer", border: "none", background: on ? "rgba(52,199,89,0.18)" : "rgba(120,120,128,0.1)" }}
		>
			{on ? "✓ " : ""}
			{label}
		</button>
	);
}
