import type { ReactNode } from "react";
import { moneyClass, signed } from "./duesText";

// 회계 UI 공용 프리미티브. 입금·출금 정산행 등에서 재사용(중복 제거).

/** 항목 순액 표시(초록/빨강 + 부호, 0이면 '정산 0'). 회계·공개회계 행 공용. */
export function NetAmount({ n }: { n: number }) {
	return <span className={moneyClass(n >= 0)} style={{ fontWeight: 800 }}>{n === 0 ? "정산 0" : signed(n)}</span>;
}

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
