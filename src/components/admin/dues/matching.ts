// 은행 입금 → 회원 매칭 제안(§8). 제안만 — 확정은 항상 관리자.
// 실데이터 노이즈("7월회비 이한비", "김태혁0719", "7/12 송유현", "고은림(게스트", "콕1타")를 걷어내
// 회원명 후보를 뽑는다.

/** 적요(입금자명 원문) → 이름 후보 문자열. 목적어/날짜/숫자/괄호 제거. */
export function normalizeDepositName(raw: string): string {
	let s = (raw ?? "").normalize("NFC").trim();
	s = s.split("(")[0]; // "고은림(게스트" → "고은림"
	s = s
		.replace(/\d{1,2}\s?월\s?\d{1,2}\s?일/g, "") // 7월12일
		.replace(/\d{1,2}\/\d{1,2}/g, "") // 7/12
		.replace(/월?\s?회비/g, "") // 회비 / 월회비 / 7월 회비
		.replace(/콕\s?\d*\s?타?/g, "") // 콕1타 / 콕
		.replace(/\d{1,2}\s?월/g, "") // 7월
		.replace(/\d{1,2}\s?일/g, "") // 12일
		.replace(/\d+/g, "") // 남은 숫자(0712·712·0719)
		.replace(/\s+/g, "")
		.trim();
	return s;
}

/** 회원명 정규화(공백/NFC). */
function normMemberName(name: string): string {
	return (name ?? "").normalize("NFC").replace(/\s+/g, "").trim();
}

export interface MemberLite {
	id: string;
	name: string;
	gender: "M" | "F" | null;
	birthYear: number | null;
}
export interface MemberCandidate extends MemberLite {
	score: number; // 3 정확 · 2 부분포함
}

/** 정규화된 적요 이름 → 후보 회원(점수순, 상위 5). 동명이인은 여러 개 나옴. */
export function suggestMembers(rawName: string, members: MemberLite[]): MemberCandidate[] {
	const q = normalizeDepositName(rawName);
	if (!q) return [];
	const out: MemberCandidate[] = [];
	for (const m of members) {
		const n = normMemberName(m.name);
		if (!n) continue;
		let score = 0;
		if (n === q) score = 3;
		else if (n.includes(q) || q.includes(n)) score = 2;
		if (score > 0) out.push({ ...m, score });
	}
	return out.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name)).slice(0, 5);
}

