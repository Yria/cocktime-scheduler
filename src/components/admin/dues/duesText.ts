import type { ChargeStatus } from "../../../lib/supabase/dues";

// 회계 UI 공용 포맷/라벨 헬퍼.

/** 12,000원 형식. */
export function won(n: number): string {
	return `${n.toLocaleString("ko-KR")}원`;
}

/**
 * +12,000원 / −12,000원 (0은 '0원'). 정산 대조 시트의 순액 표기 공용.
 * `signed` 는 0을 `+0` 으로 쓰므로 그것과 따로 둔다.
 */
export function signedWon(n: number): string {
	if (n === 0) return "0원";
	return `${n > 0 ? "+" : "−"}${won(Math.abs(n))}`;
}

/** 수입/양수=초록, 지출/음수=빨강 텍스트 클래스(회계 공용). */
export function moneyClass(positive: boolean): string {
	return positive ? "text-[#1c8a3b]" : "text-[#d1362c]";
}

/** +12,000원 / −12,000원 (부호 표기). */
export function signed(n: number): string {
	return `${n >= 0 ? "+" : "−"}${won(Math.abs(n))}`;
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

/** 서비스 시작 월. 이보다 이전 달은 통장·부과 데이터가 아예 없으므로 회계 열람 대상이 아니다. */
export const SERVICE_START_YM = "2026-07";

/**
 * 공개 회계(클럽 회계)에서 열람 가능한 최신 월 = 지난달(당월은 정산 중이라 비공개).
 * 단 서비스 시작 월보다 앞으로는 내려가지 않는다(빈 달만 보이는 걸 방지).
 */
export function publicLedgerMaxYm(): string {
	const last = shiftYm(currentYm(), -1);
	return last < SERVICE_START_YM ? SERVICE_START_YM : last; // 'YYYY-MM' 은 사전순=시간순
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
/**
 * 주격 조사 — 앞 글자에 종성이 있으면 "이", 없으면 "가". 한글이 아니면 "가".
 * 부과 이름이 데이터에서 오므로("회식", "공동구매", "회비·대관비") 조사를 고정하면 "내역가"가 나온다.
 */
export function subjectJosa(word: string): string {
	const ch = word.trim().slice(-1);
	const code = ch.charCodeAt(0);
	if (Number.isNaN(code) || code < 0xac00 || code > 0xd7a3) return "가";
	return (code - 0xac00) % 28 === 0 ? "가" : "이";
}

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
