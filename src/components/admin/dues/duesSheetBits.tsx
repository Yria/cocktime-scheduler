// 정산 대조 시트의 공용 조각 — 세션(SessionSettleSheet)과 수동 부과(ManualSettleSheet)가 같이 쓴다.
//
// 원래 SessionSettleSheet 안에만 있었다. 수동 부과 대조 시트를 만들면서 두 벌로 복사하면 같은
// "머릿수 → 건수 → 돈" 표가 시트마다 다르게 자라므로(카드에서 이미 그 일이 났다) 꺼내 뒀다.
//
// 표의 문법: `Row` 한 줄 = 사실 하나. `indent` 는 **바로 위 줄의 부분집합**일 때만 쓴다(미납 ⊂ 낼 돈).
// `Divider` 아래는 위 줄들의 결론(합계·순액).

import type { CSSProperties, ReactNode } from "react";

export function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
	return (
		<div>
			<div className="flex items-baseline gap-1.5" style={{ marginBottom: 6 }}>
				<b className="text-strong" style={{ fontSize: 13.5 }}>{title}</b>
				{hint && <span className="text-faint" style={{ fontSize: 11 }}>{hint}</span>}
			</div>
			<div className="flex flex-col" style={{ gap: 3, background: "rgba(120,120,128,0.06)", borderRadius: 10, padding: "9px 11px" }}>
				{children}
			</div>
		</div>
	);
}

const TONE: Record<string, string> = {
	in: "text-[#1c8a3b]",
	out: "text-[#d1362c]",
	warn: "text-[#c2670a]",
	muted: "text-muted",
};

export function Row({ label, value, sub, tone, strong, indent }: {
	label: string;
	value: string;
	sub?: string;
	tone?: "in" | "out" | "warn" | "muted";
	strong?: boolean;
	indent?: boolean;
}) {
	const cls = tone ? TONE[tone] : "text-strong";
	return (
		<div className="flex items-baseline gap-2" style={{ fontSize: 13, paddingLeft: indent ? 12 : 0 }}>
			<span className={indent ? "text-muted" : "text-strong"} style={{ fontWeight: strong ? 700 : 500, flexShrink: 0 }}>
				{indent ? "└ " : ""}{label}
			</span>
			{sub && <span className="text-faint" style={{ fontSize: 11, minWidth: 0 }}>{sub}</span>}
			<span style={{ flex: 1 }} />
			<span className={cls} style={{ fontWeight: strong ? 800 : 700, fontVariantNumeric: "tabular-nums", flexShrink: 0 }}>{value}</span>
		</div>
	);
}

export function Divider() {
	return <div style={{ height: 1, background: "rgba(120,120,128,0.22)", margin: "3px 0" }} />;
}

export function Tag({ tone, children }: { tone: "warn" | "info" | "muted"; children: ReactNode }) {
	const map: Record<string, CSSProperties> = {
		warn: { background: "rgba(255,149,0,0.16)", color: "#c2670a" },
		info: { background: "rgba(11,132,255,0.14)", color: "#0b84ff" },
		muted: { background: "rgba(120,120,128,0.16)", color: "#64748b" },
	};
	return (
		<span style={{ fontSize: 10.5, fontWeight: 700, padding: "1px 6px", borderRadius: 6, whiteSpace: "nowrap", ...map[tone] }}>
			{children}
		</span>
	);
}
