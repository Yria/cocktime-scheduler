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

// ── 초성 검색 ─────────────────────────────────────────────────────────
const CHOSUNG = ["ㄱ", "ㄲ", "ㄴ", "ㄷ", "ㄸ", "ㄹ", "ㅁ", "ㅂ", "ㅃ", "ㅅ", "ㅆ", "ㅇ", "ㅈ", "ㅉ", "ㅊ", "ㅋ", "ㅌ", "ㅍ", "ㅎ"];
/** 한글 음절 → 초성 문자열(비한글은 그대로). "황서진" → "ㅎㅅㅈ". */
export function chosungOf(s: string): string {
	let out = "";
	for (const ch of (s ?? "").normalize("NFC")) {
		const code = ch.charCodeAt(0);
		if (code >= 0xac00 && code <= 0xd7a3) out += CHOSUNG[Math.floor((code - 0xac00) / 588)];
		else out += ch;
	}
	return out;
}
/** 검색어가 초성(ㄱ~ㅎ)으로만 이뤄졌는지. */
const isChosungQuery = (q: string) => q.length > 0 && /^[ㄱ-ㅎ]+$/.test(q);

/**
 * 이름이 검색어에 매칭되는지 — 공백무시·대소문자무시 부분일치 + 초성 검색.
 *  · 일반어("황서") → 이름에 부분포함.
 *  · 초성어("ㅎㅅㅈ") → 이름의 초성 문자열에 부분포함.
 */
export function nameMatches(name: string, query: string): boolean {
	const q = (query ?? "").normalize("NFC").replace(/\s+/g, "").toLowerCase();
	if (!q) return true;
	const n = (name ?? "").normalize("NFC").replace(/\s+/g, "").toLowerCase();
	if (n.includes(q)) return true;
	if (isChosungQuery(q)) return chosungOf(name).replace(/\s+/g, "").includes(q);
	return false;
}

export interface CandidatePoolMember {
	id: string;
	name: string;
	isGuest?: boolean;
	isActive?: boolean;
	/** members.created_at(ISO). 동명 게스트 중 "최신 1행" 판정용 — 없으면 원본 순서를 그대로 존중한다. */
	createdAt?: string | null;
}
export interface MemberLite extends CandidatePoolMember {
	gender: "M" | "F" | null;
	birthYear: number | null;
}
export interface MemberCandidate extends MemberLite {
	score: number; // 3 정확 · 2 부분포함
}

// ── 후보 위생(동명 게스트 접기) ────────────────────────────────────────
// 게스트는 방문마다 members 행이 새로 생긴다(RPC add_guest_attendance 가 유일 경로) → 프로덕션에 동명 게스트가
// 11그룹 28행(문병기 4·신현재 4·김지훈 3·김윤호 3 …). 후보는 slice(0,4)·검색은 slice(0,6) 으로 잘리고 둘 다
// 이름만 보므로, 중복 게스트가 실제 회원을 목록 밖으로 밀어낸다. 게스트는 birth_year 도 없어 화면에서 구분 불가.
// 그래서 손대는 곳은 "후보 집합"뿐 — 적요 파싱·점수 계산(매칭 로직)은 그대로 둔다.
// 거부한 대안:
//   · 게스트 전면 제외 — 게스트 대관비 입금 매칭이 이 화면의 존재 이유(fetchMembersForAdmin(true))다.
//   · 비활성 회원 제외 — 비활성이 되면 새 부과만 안 생기고 **이미 생긴 부과는 남는다**. 그 부과에 입금을
//     붙일 사람이 후보에서 사라지면 배분할 길이 없다. 그래서 빼지 않고 동명 그룹 안에서만 뒤로 보낸다.
//   · 데이터 자체 정리(삭제·머지) — dues_charges·dues_allocations·attendances 가 ON DELETE CASCADE 라 회계가 유실된다.

export interface CandidatePoolOptions {
	/**
	 * 절대 접지 않을 회원 id — 미납이 남은 행 등. 돈이 걸린 행을 숨기면 그 부과를 배분할 길이 사라진다.
	 * (게스트 미납이 지금 0원이라는 건 오늘의 사실일 뿐 불변식이 아니므로 규칙으로 막아 둔다.)
	 */
	protectedIds?: Iterable<string>;
	/**
	 * 동명 실제 회원이 있어도 게스트 대표 1행은 남긴다. 검색(사용자가 이름을 직접 지목)용 완화 스위치.
	 * 자동 후보 제안에서는 끈다 — 실제 회원이 있으면 그게 정답일 확률이 압도적이다.
	 */
	keepGuestsWithNamesakeMember?: boolean;
}

/**
 * 동명 게스트 그룹을 최신 1행으로 접는다(원본 순서 보존).
 * createdAt 이 하나도 없으면(현재 fetchMembersForAdmin 이 select 하지 않는다) 최신 판정 근거가 없으므로
 * 원본 순서의 첫 행을 대표로 둔다 — 임의로 뒤 행을 고르면 fetch 의 tie 순서(name asc 뒤는 미정의)에 따라
 * 새로고침마다 대표가 바뀌어 화면이 흔들린다.
 */
function guestsRecentFirst<T extends CandidatePoolMember>(guests: T[]): T[] {
	if (!guests.some((g) => g.createdAt)) return guests;
	return guests
		.map((g, i) => ({ g, i }))
		// ISO 타임스탬프는 사전순 = 시간순이므로 부등호로 비교한다(localeCompare 는 로케일 가중치가 개입할 여지가 있다).
		.sort((a, b) => {
			const x = a.g.createdAt ?? "";
			const y = b.g.createdAt ?? "";
			return y > x ? 1 : y < x ? -1 : a.i - b.i;
		})
		.map((x) => x.g);
}

/**
 * 후보 집합 위생 규칙(순수함수).
 *  1. 같은 이름(공백·NFC·대소문자 정규화) 그룹에서 실제 회원(비게스트)은 전부 남긴다 — 동명이인은 여전히 둘 다 후보.
 *  2. 그 그룹의 게스트는 접는다: 실제 회원이 있으면 제거(완화 옵션 시 대표 1행), 게스트만이면 최신 1행.
 *  3. 비활성 회원은 빼지 않는다. 동명 충돌 때만 활성 회원을 앞에 둔다.
 *  4. protectedIds 는 무조건 남긴다(미납 배분 경로 보존).
 *  5. 정렬 안정성: 남긴 행은 원본에서 그 이름 그룹이 차지했던 자리에 되꽂아, 그룹 밖 순서는 흔들지 않는다.
 */
export function sanitizeCandidatePool<T extends CandidatePoolMember>(members: T[], opts: CandidatePoolOptions = {}): T[] {
	const protectedIds = opts.protectedIds ? new Set(opts.protectedIds) : null;
	const keyOf = (m: T) => normMemberName(m.name).toLowerCase();

	// 1) 동명 그룹(원본 등장 순서 유지).
	const groups = new Map<string, T[]>();
	for (const m of members) {
		const key = keyOf(m);
		const g = groups.get(key);
		if (g) g.push(m);
		else groups.set(key, [m]);
	}

	// 2) 그룹마다 남길 행과 그룹 내부 순서를 정한다(회원 → 게스트, 활성 → 비활성).
	const kept = new Map<string, T[]>();
	for (const [key, g] of groups) {
		if (!key) {
			// 이름이 공백뿐이면 정규화 키가 ""로 같아져 서로 무관한 사람들이 한 그룹으로 접힌다. 손대지 않는다.
			kept.set(key, [...g]);
			continue;
		}
		if (g.length === 1) {
			kept.set(key, [...g]); // 단독 이름이 대다수 — 손대지 않는다.
			continue;
		}
		const real = g.filter((m) => !m.isGuest);
		const guests = g.filter((m) => m.isGuest);
		// isActive 미지정(테스트 픽스처·MemberLite)은 활성으로 본다 — false 만 뒤로.
		const ordered: T[] = [...real.filter((m) => m.isActive !== false), ...real.filter((m) => m.isActive === false)];
		const dropGuests = real.length > 0 && !opts.keepGuestsWithNamesakeMember;
		const guestOrdered = guestsRecentFirst(guests);
		const protectedGuests = protectedIds ? guestOrdered.filter((gu) => protectedIds.has(gu.id)) : [];
		if (protectedGuests.length > 0) {
			// 미납이 걸린 행이 곧 그 이름의 대표 — 운영진이 지금 배분해야 하는 게 그 행이다.
			// 동명 회원이 있어도 이 행은 남긴다(숨기면 배분 불가).
			ordered.push(...protectedGuests);
			// 완화(검색) 모드에서는 최신 행도 함께 남긴다. "옛 방문 미납 + 오늘 방문 선납"이 겹치면
			// 미납 행만 남아 오늘 행을 고를 수가 없다 — 이름을 직접 지목한 검색에서 그건 막다른 길이다.
			// 자동 후보(엄격 모드)에서는 안 더한다: 칩 4칸을 동명으로 채우면 실제 회원이 밀린다.
			if (opts.keepGuestsWithNamesakeMember && guestOrdered.length > 0 && !protectedGuests.includes(guestOrdered[0])) {
				ordered.push(guestOrdered[0]);
			}
		} else if (!dropGuests && guestOrdered.length > 0) {
			ordered.push(guestOrdered[0]); // 최신 1행만 대표로
		}
		kept.set(key, ordered);
	}

	// 3) 원본 자리에 되꽂기.
	const out: T[] = [];
	for (const m of members) {
		const q = kept.get(keyOf(m));
		if (!q || q.length === 0) continue;
		out.push(q.shift() as T);
	}
	return out;
}

/**
 * 정규화된 적요 이름 → 후보 회원(점수순, 상위 5). 동명이인은 여러 개 나옴.
 * 후보 집합은 sanitizeCandidatePool 로 먼저 정리한다 — 중복 게스트가 상위 5칸을 먹어 실제 회원이 사라지는 것 방지.
 */
export function suggestMembers<T extends MemberLite>(rawName: string, members: T[], opts?: CandidatePoolOptions): (T & { score: number })[] {
	const q = normalizeDepositName(rawName);
	if (!q) return [];
	const out: (T & { score: number })[] = [];
	for (const m of sanitizeCandidatePool(members, opts)) {
		const n = normMemberName(m.name);
		if (!n) continue;
		let score = 0;
		if (n === q) score = 3;
		else if (n.includes(q) || q.includes(n)) score = 2;
		if (score > 0) out.push({ ...m, score });
	}
	return out.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name)).slice(0, 5);
}
