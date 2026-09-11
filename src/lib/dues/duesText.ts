import type { ChargeStatus } from "./sessionTypes";

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
	return new Date(iso).toLocaleDateString("ko-KR", {
		month: "numeric",
		day: "numeric",
		timeZone: "Asia/Seoul",
	});
}

/**
 * ISO → '9/6'(KST). 목록 행의 날짜 열 전용 — ko-KR numeric('9. 6.')은 34px 열에서
 * 두 줄로 접혔다.
 */
export function fmtMDSlash(iso: string): string {
	const kst = new Date(new Date(iso).getTime() + 9 * 3600 * 1000);
	return `${kst.getUTCMonth() + 1}/${kst.getUTCDate()}`;
}

const DOW = ["일", "월", "화", "수", "목", "금", "토"];

/**
 * '9/8 (화)' (KST). 회원 화면의 날짜 표기 — 회차·납부일을 요일까지 말한다.
 * timestamptz 와 `YYYY-MM-DD`(date 열: `dues_groups.occurred_on`) 둘 다 받는다.
 * date 는 정오로 고정해 파싱한다 — 자정은 시간대 계산에서 날짜가 밀 수 있다.
 */
export function fmtMDDow(value: string): string {
	const iso = /^\d{4}-\d{2}-\d{2}$/.test(value)
		? `${value}T12:00:00+09:00`
		: value;
	const kst = new Date(new Date(iso).getTime() + 9 * 3600 * 1000);
	return `${fmtMDSlash(iso)} (${DOW[kst.getUTCDay()]})`;
}

/** ISO(timestamptz) → 'YYYY-MM' (KST). null → null. */
export function ymOfIso(iso: string | null): string | null {
	if (!iso) return null;
	const kst = new Date(new Date(iso).getTime() + 9 * 3600 * 1000);
	return `${kst.getUTCFullYear()}-${String(kst.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** 대관 세션 라벨: '7.12 TK배드민턴'(장소 있으면). */
export function sessionLabel(s: {
	scheduledAt: string | null;
	placeName?: string | null;
	title?: string | null;
}): string {
	const d = s.scheduledAt ? fmtMD(s.scheduledAt) : (s.title ?? "세션");
	return s.placeName ? `${d} ${s.placeName}` : d;
}

/**
 * 발행 대기(초안)의 보류 사유. 서버가 넣는 값(dues_charge_drafts.hold_reason)을 사람 말로 옮긴다.
 * 값이 늘면 여기에 추가한다 — 모르는 값은 원문을 그대로 보여 준다.
 */
export const holdReasonLabel: Record<string, string> = {
	amount_out_of_range: "인당 금액이 평소 범위를 벗어남",
	head_count_jump: "대상 인원이 지난달과 크게 다름",
	new_members: "이미 발행된 묶음에 새 대상이 생김",
};

export function ymRangeKst(ym: string): { start: string; end: string } {
	const [y, m] = ym.split("-").map(Number);
	const nextY = m === 12 ? y + 1 : y;
	const nextM = m === 12 ? 1 : m + 1;
	const pad = (n: number) => String(n).padStart(2, "0");
	return {
		start: `${y}-${pad(m)}-01T00:00:00+09:00`,
		end: `${nextY}-${pad(nextM)}-01T00:00:00+09:00`,
	};
}
