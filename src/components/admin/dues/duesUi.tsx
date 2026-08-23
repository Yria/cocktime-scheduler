import type { ReactNode } from "react";
import { moneyClass, signed } from "./duesText";

// 회계 UI 공용 프리미티브. 입금·출금 정산행 등에서 재사용(중복 제거).

/** 항목 순액 표시(초록/빨강 + 부호, 0이면 '정산 0'). 회계·공개회계 행 공용. */
export function NetAmount({ n }: { n: number }) {
	return <span className={moneyClass(n >= 0)} style={{ fontWeight: 800 }}>{n === 0 ? "정산 0" : signed(n)}</span>;
}

/**
 * 항목별 정산 한 줄: 이름(+보조설명) · 들어온/나간 돈 세부 · 순액.
 * 운영진 [회계]와 회원 [클럽 회계]가 공용 — 같은 달 같은 숫자를 같은 모양으로 보여준다.
 * 세부는 수입·지출이 **양쪽 다 있을 때만** 표시(한쪽만이면 순액과 같은 숫자라 중복).
 */
export function LedgerRow({ name, nameColor, sub, inAmt = 0, outAmt = 0, right }: { name: string; nameColor?: string; sub?: string; inAmt?: number; outAmt?: number; right: ReactNode }) {
	const both = inAmt > 0 && outAmt > 0;
	return (
		<div className="flex items-center gap-2" style={{ fontSize: 13.5 }}>
			<span style={{ flex: 1, minWidth: 0, fontWeight: 600, color: nameColor }} className={nameColor ? undefined : "text-strong"}>
				{name}
				{sub && <span className="text-faint" style={{ fontWeight: 500, fontSize: 11.5 }}> · {sub}</span>}
			</span>
			{both && (
				<span className="flex items-center gap-1.5" style={{ fontSize: 11.5, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap", flexShrink: 0 }}>
					<span className="text-[#1c8a3b]">+{inAmt.toLocaleString("ko-KR")}</span>
					<span className="text-[#d1362c]">−{outAmt.toLocaleString("ko-KR")}</span>
				</span>
			)}
			{right && <span style={{ minWidth: 74, textAlign: "right" }}>{right}</span>}
		</div>
	);
}

/**
 * 선택 토글 칩(초록 활성 + ✓ 접두). 정산함 입금 항목칩·출금 선택칩 공용.
 * key 는 상위 map 에서 <ToggleChip key=… /> 로 지정.
 */
export function ToggleChip({ label, on, onClick, disabled, title }: { label: ReactNode; on: boolean; onClick: () => void; disabled?: boolean; title?: string }) {
	return (
		<button
			type="button"
			onClick={onClick}
			disabled={disabled}
			// 못 쓰는 칩은 감광 + 커서로 구분한다(사유는 title 로 — 수동 부과 필터가 이걸 쓴다).
			title={title}
			className={on ? "text-[#1c8a3b]" : "text-faint"}
			style={{ fontSize: 12.5, fontWeight: on ? 700 : 500, padding: "5px 11px", borderRadius: 8, cursor: disabled ? "not-allowed" : "pointer", border: "none", opacity: disabled ? 0.4 : 1, background: on ? "rgba(52,199,89,0.18)" : "rgba(120,120,128,0.1)" }}
		>
			{on ? "✓ " : ""}
			{label}
		</button>
	);
}
