import type { ChargeStatus } from "../../../lib/supabase/dues";

// 회계 UI 공용 포맷/라벨 헬퍼.

/** 12,000원 형식. */
export function won(n: number): string {
	return `${n.toLocaleString("ko-KR")}원`;
}

/** 현재(KST) 'YYYY-MM'. */
export function currentYm(): string {
	const now = new Date();
	// KST = UTC+9. toLocaleString 로 서울 기준 연·월 추출.
	const kst = new Date(now.getTime() + 9 * 3600 * 1000);
	return `${kst.getUTCFullYear()}-${String(kst.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** 'YYYY-MM' ± n개월. */
export function shiftYm(ym: string, delta: number): string {
	const [y, m] = ym.split("-").map(Number);
	const total = y * 12 + (m - 1) + delta;
	const ny = Math.floor(total / 12);
	const nm = (total % 12) + 1;
	return `${ny}-${String(nm).padStart(2, "0")}`;
}

/** '2026년 7월'. */
export function ymLabel(ym: string): string {
	const [y, m] = ym.split("-").map(Number);
	return `${y}년 ${m}월`;
}

const STATUS_LABEL: Record<ChargeStatus, string> = {
	unpaid: "미납",
	partial: "부분납",
	paid: "완납",
	overpaid: "초과납",
	waived: "면제",
	void: "무효",
};

export function statusLabel(s: ChargeStatus): string {
	return STATUS_LABEL[s] ?? s;
}

/** 상태 칩 색(배경/글자). tailwind arbitrary — light/dark 공용. */
export function statusChipClass(s: ChargeStatus): string {
	switch (s) {
		case "paid":
		case "overpaid":
			return "bg-[rgba(52,199,89,0.14)] text-[#1c8a3b]";
		case "partial":
			return "bg-[rgba(255,149,0,0.16)] text-[#c2670a]";
		case "waived":
		case "void":
			return "bg-[rgba(100,116,139,0.16)] text-[#64748b]";
		default: // unpaid
			return "bg-[rgba(255,59,48,0.14)] text-[#d1362c]";
	}
}

/** charge 잔액(미납액). */
export function remaining(amountDue: number, amountPaid: number): number {
	return Math.max(0, amountDue - amountPaid);
}

/** ISO → '7.12' (KST, 월.일). */
export function fmtMD(iso: string): string {
	return new Date(iso).toLocaleDateString("ko-KR", { month: "numeric", day: "numeric", timeZone: "Asia/Seoul" });
}

/** ISO(timestamptz) → 'YYYY-MM' (KST). null → null. */
export function ymOfIso(iso: string | null): string | null {
	if (!iso) return null;
	const kst = new Date(new Date(iso).getTime() + 9 * 3600 * 1000);
	return `${kst.getUTCFullYear()}-${String(kst.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** 대관 세션 라벨: '7.12 TK배드민턴'(장소 있으면). */
export function sessionLabel(s: { scheduledAt: string | null; placeName?: string | null; title?: string | null }): string {
	const d = s.scheduledAt ? fmtMD(s.scheduledAt) : (s.title ?? "세션");
	return s.placeName ? `${d} ${s.placeName}` : d;
}

/**
 * 거래내역에서 '열린(활동 있는) 세션' id 집합 — 공통 헬퍼.
 * 세션 필터·세션 관련 UI가 실제 돈이 오간 세션만 보이게. 직접 링크(session_id) + 배분(입금)의 세션 모두 포함.
 */
export function activeSessionIds(
	txns: { id: number; sessionId: number | null }[],
	txAllocations: Record<number, { sessionIds: number[] }>,
): Set<number> {
	const ids = new Set<number>();
	for (const t of txns) {
		if (t.sessionId != null) ids.add(t.sessionId);
		for (const sid of txAllocations[t.id]?.sessionIds ?? []) ids.add(sid);
	}
	return ids;
}
