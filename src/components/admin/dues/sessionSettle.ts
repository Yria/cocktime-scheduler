import { nameWithBirthYear } from "../../../lib/birthYear";
import type { AdminMemberRow } from "../../../lib/supabase/adminMembers";
import type { ChargeStatus, CourtChargeRow, SessionAttendanceRow, SessionFeeRow } from "../../../lib/supabase/dues";
import { remaining } from "./duesText";

// ============================================================
// 세션 정산 대조(현황 → 세션 상세 시트)
//
// 목적: "참석 인원 × 정액"과 실제 부과·입금이 갈리는 이유를 화면에서 끝까지 설명한다.
//   당일취소자에게도 정액이 부과되므로 부과 건수 > 참석 인원이 되고(운영진은 반대로 빠지고),
//   그래서 머릿수 곱셈이 통장과 안 맞는다 — 그 차이를 항목으로 분해해 보여주는 것이 이 모듈이다.
//
// **불변식: 부과 대상 판정은 서버 `dues_generate_session_court`(20260817040000)의 미러다.**
//   여기서 갈리면 화면이 "부과 누락"을 오탐/누락한다. 서버 규칙을 바꾸면 이 파일과
//   sessionSettle.test.ts 를 반드시 함께 고친다(ACCOUNTING_SPEC §4 대관비 룰).
//     · 대상(두 모드 공통) = confirmed/late_pool + 부과대상 당일취소.
//       엔빵은 운영진·게스트 포함, 정액은 운영진 제외.
//     · 엔빵 인당 = 총액 ÷ 분모(=대상 수) **10원 절상**, 그 값이 정액 이상 ~ 정액+200원 미만이면
//       정액으로 스냅(한방향 — 정액보다 싸게 나오면 계산값 그대로).
//     · 정액 인당 = 기본액(6,000).
//     · 당일취소 술어 = dues_is_day_cancel_chargeable (세션 당일 취소 + 확정 후 1시간 경과).
// ============================================================

const KST_OFFSET_MS = 9 * 3600 * 1000;
const GRACE_MS = 3600 * 1000; // 확정 후 1시간 — 즉시 철회는 자리를 점유한 적이 없어 부과 근거가 없다.

/** KST 달력일 키(연-월-일). 서버 술어의 `(ts at time zone 'Asia/Seoul')::date` 대응. */
function kstDateKey(iso: string): string {
	const d = new Date(new Date(iso).getTime() + KST_OFFSET_MS);
	return `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}`;
}

/** 확정 참가자(부과·엔빵 분모의 기준). */
export function isAttending(status: string): boolean {
	return status === "confirmed" || status === "late_pool";
}

/** 엔빵 스냅 폭 — 인당이 정액 이상 이 폭 미만이면 정액으로 통일한다(서버와 같은 값). */
const FLAT_SNAP_BAND = 200;

/**
 * 엔빵 인당 금액을 정액 근처에서 정액으로 스냅. 서버의 ③ 규칙 미러 — **한방향**이다.
 * 정액보다 싸게 나온 금액은 올리지 않는다(회원이 계산값보다 더 내는 일은 없다).
 */
function snapToFlat(perHead: number, flatFee: number): number {
	return perHead >= flatFee && perHead < flatFee + FLAT_SNAP_BAND ? flatFee : perHead;
}

/**
 * `dues_is_day_cancel_chargeable` 미러 — 당일취소 부과 대상인가(두 모드 공통).
 * ①취소 ②확정 이력 있음 ③취소일(KST)=세션일(KST) ④확정→취소 1시간 이상.
 */
export function isDayCancelChargeable(a: SessionAttendanceRow, scheduledAt: string | null): boolean {
	if (a.status !== "cancelled" || !a.confirmedAt || !a.cancelledAt || !scheduledAt) return false;
	if (kstDateKey(a.cancelledAt) !== kstDateKey(scheduledAt)) return false;
	return new Date(a.cancelledAt).getTime() - new Date(a.confirmedAt).getTime() >= GRACE_MS;
}

/** 당일 취소이긴 하나 grace(1시간) 안에 스스로 물린 건 — 부과 제외 사유로 명시 노출한다. */
function isGraceWithdrawn(a: SessionAttendanceRow, scheduledAt: string | null): boolean {
	if (a.status !== "cancelled" || !a.confirmedAt || !a.cancelledAt || !scheduledAt) return false;
	if (kstDateKey(a.cancelledAt) !== kstDateKey(scheduledAt)) return false;
	return new Date(a.cancelledAt).getTime() - new Date(a.confirmedAt).getTime() < GRACE_MS;
}

/**
 * 부과 대상이 아닌 이유. 두 곳에서 쓴다.
 *  · 부과가 **없는** 사람 → 정상 면제인지(adminFlat·grace) 조용히 설명.
 *  · 부과가 **있는** 사람 → 규칙과 어긋난 잔재이므로 사유와 함께 '확인 필요'로 세운다.
 *    자동정리(self-heal DELETE)는 `amount_paid = 0` 게이트라 **이미 낸 건은 못 지운다** —
 *    그래서 사전취소·grace 철회인데 완납된 행이 살아남아 "받은 돈이 참석×정액보다 많은" 원인이 된다.
 */
export type NonTargetReason =
	| "adminFlat" // 정액 세션의 운영진 — 대관비를 걷지 않음
	| "grace" // 확정 후 1시간 내 철회(오조작)
	| "preCancel" // 세션 전에 취소(자리를 비워 남이 들어갈 수 있었음)
	| "waitlisted" // 대기 — 자리를 잡은 적 없음
	| "noAttendance"; // 참석 기록 자체가 없음

/** '정상 면제'로 조용히 보여줄 사유(나머지는 부과가 있을 때만 확인 대상으로 뜬다). */
const CALM_REASONS = new Set<NonTargetReason>(["adminFlat", "grace"]);

export interface SettleChargeRow {
	chargeId: number;
	memberId: string;
	name: string;
	amountDue: number;
	amountPaid: number;
	remain: number;
	status: ChargeStatus;
	isDayCancel: boolean;
	payerName: string | null; // 게스트 대납자 이름(payer_hint ≠ member)
	voidedByName: string | null; // 부과삭제한 운영진
	isAdmin: boolean;
	live: boolean; // void·waived 가 아님(= 낼 돈에 들어감)
	extraReason: NonTargetReason | null; // null 이면 정상(현 규칙의 부과 대상)
}

export interface SettlePersonRow {
	memberId: string;
	name: string;
	isAdmin: boolean;
	isGuest: boolean;
}

export interface SettleExemptRow extends SettlePersonRow {
	reason: NonTargetReason;
}

/**
 * 명단 한 행의 분류 — 부과가 있든 없든 **한 목록**에 세우고 우측에 사유를 적기 위한 것.
 * 섹션을 쪼개면 "이 사람 어디 있지"를 세 곳에서 찾아야 해서 대조가 안 된다.
 */
export type RosterKind =
	| "missing" // ⚠ 부과 대상인데 부과가 없음
	| "stale" // ⚠ 살아 있는데 현 규칙 대상이 아닌 부과(잔재)
	| "charged" // 정상 부과
	| "orphan" // 참석 기록이 없는 부과(대조 근거 없음)
	| "exempt"; // 부과 없이 정상적으로 빠짐

export interface SettleRosterRow {
	key: string;
	name: string;
	/** 이름 뒤 년생 표기용(동명이인 구분). 미입력 회원·조회 실패는 null. */
	birthYear: number | null;
	kind: RosterKind;
	charge: SettleChargeRow | null; // null = 부과 없는 사람
	reason: NonTargetReason | null; // 우측 사유(missing 은 null — 문구가 모드에 따라 갈림)
	isAdmin: boolean;
}

/** 동명이인 tie-break 용(정렬 1순위는 이름 가나다). 확인할 것이 먼저 오게. */
const KIND_RANK: Record<RosterKind, number> = { missing: 0, stale: 1, charged: 2, orphan: 3, exempt: 4 };

export interface SessionSettle {
	mode: "split" | "flat"; // 엔빵 | 정액
	total: number | null; // 엔빵 총액(coalesce(세션,규칙))
	perHead: number; // 인당 부과액 — 엔빵=총액÷대상수(10원 절상 + 정액 근처 스냅), 정액=기본액
	/** 실제 부과된 금액의 종류 — 1개면 `N건 × 단가` 곱셈이 성립(섞여 있으면 곱셈 표기를 숨긴다). */
	dueAmounts: number[];

	// ── 항등식 ①: 머릿수 → 부과 대상 ──────────────────────────────
	//   attendCount − adminAttendCount + targetDayCancelCount = targetCount   (정액)
	//   attendCount                    + targetDayCancelCount = targetCount   (엔빵)
	attendCount: number; // 확정 참석(confirmed/late_pool)
	adminAttendCount: number; // 그중 운영진(정액은 면제되어 대상에서 빠짐)
	targetDayCancelCount: number; // 부과 대상이 된 당일취소 수(두 모드 공통. 정액은 운영진 제외 후)
	targetCount: number; // 현 규칙의 부과 대상 인원
	// 항등식엔 안 들어가는 설명용 머릿수 — 부과 행 유무와 무관하게 '규칙상 이렇게 갈렸다'를 센다.
	graceCount: number; // 당일 취소지만 확정 후 1시간 내 철회라 부과 대상이 아닌 수

	// ── 항등식 ②: 부과 대상 → 유효 부과 건수 ──────────────────────
	//   targetCount − missing − deadOnTargetCount + liveExtraCount = activeCount
	missing: SettlePersonRow[]; // ⚠ 부과 대상인데 부과가 없는 사람
	deadOnTargetCount: number; // 대상이지만 부과삭제·면제된 건
	liveExtraCount: number; // 대상이 아닌데 살아 있는 부과(잔재 — 받은 돈이 늘어나는 원인)
	activeCount: number; // 유효 부과(void·waived 제외) 건수

	charged: SettleChargeRow[]; // 실제 부과 명단 전원(완납·미납·당일취소·부과삭제)
	/** 화면용 통합 명단 = 부과 있는 사람 + 누락 + 정상 면제. 이름 가나다순, 우측에 사유. */
	roster: SettleRosterRow[];
	/** 확인 필요 건수 = 부과 누락 + 살아 있는 잔재. 카드 ⚠배지와 명단 헤더가 함께 쓰는 단일 소스. */
	flaggedCount: number;
	/**
	 * 명단 헤더에 띄우는 상태별 머릿수. **확인 필요 행은 빼고 센다** — 한 사람이 `완납`과
	 * `⚠확인` 양쪽에 잡히면 헤더가 분할처럼 읽히면서 합이 안 맞아 보인다(확인이 필요하다는 게
	 * 그 사람에 대한 더 중요한 사실이므로 납부 상태 대신 그쪽으로 센다).
	 * 불변식: `paid + unpaid + dead + none + flaggedCount = roster.length` (테스트로 강제)
	 */
	rosterCounts: { paid: number; unpaid: number; dead: number; none: number };
	exempt: SettleExemptRow[]; // 부과 없이 정상적으로 빠진 사람(사유 표기)
	extra: SettleChargeRow[]; // 부과는 있으나 현 규칙 대상이 아닌 건 전부(charged 의 부분집합)
	/**
	 * 확인 필요한 잔재 = extra 중 **살아 있고**(void·waived 아님) **참석 기록이 있는** 것.
	 *  · void/waived 는 운영진이 이미 부과삭제로 처리한 건 → 다시 물으면 늑대소년이 된다.
	 *  · 참석 기록이 없는 건은 규칙 위반이 아니라 비교 근거가 없는 상태 → orphanCharges 로 분리.
	 */
	staleCharges: SettleChargeRow[];
	/** 참석 기록이 없는 부과(서비스 초기 세션의 참석 데이터 미비 · 선납 후 세션 이탈). 정보로만. */
	orphanCharges: SettleChargeRow[];

	dueSum: number; // 낼 돈(유효 부과 합)
	voidSum: number; // 부과삭제·면제된 금액
	received: number; // 회원이 낸 돈(부과 배분 합)
	unpaidSum: number; // 남은 미납
	unpaidCount: number; // 미납 인원
	externalIn: number; // 비회원(외부) 대관 입금
	expense: number; // 코트 지출
	net: number; // 실제 순액 = 받은 돈 + 비회원 입금 − 지출
	expectedNet: number; // 전원 완납 시 순액 = 낼 돈 + 비회원 입금 − 지출
}

/**
 * 세션 1건의 정산 대조표를 만든다. 순수 함수(스토어 스냅샷만 입력) — 테스트로 서버 규칙과 대조한다.
 *
 * @param session   그 세션(참석행·엔빵 총액 fallback 포함)
 * @param charges   그 세션의 court_fee 부과 전체(void 포함)
 * @param memberById 회원 조회(운영진·게스트 판정, 이름)
 * @param flatFee   정액 기본액(dues_settings.court_fee_default)
 * @param txns      그 세션에 링크된 은행거래(비회원 입금 · 코트 지출)
 */
export function buildSessionSettle(
	session: SessionFeeRow,
	charges: CourtChargeRow[],
	memberById: Map<string, AdminMemberRow>,
	flatFee: number,
	txns: { direction: "in" | "out"; amount: number }[],
): SessionSettle {
	const nameOf = (id: string) => memberById.get(id)?.name ?? "(회원)";
	const birthYearOf = (id: string) => memberById.get(id)?.birthYear ?? null;
	const isAdminOf = (id: string) => memberById.get(id)?.isAdmin ?? false;

	// ── 모드·인당 금액(서버와 동일 계산) ──────────────────────────────
	const total = session.courtFee ?? session.ruleCourtFee;
	const split = total != null && total > 0;
	const attend = session.attendances.filter((a) => isAttending(a.status));
	// 엔빵 분모 = 부과 대상 수 = 실제 참석 + 부과대상 당일취소. 서버 v_head 와 같은 술어여야 한다
	// (분모 ≠ 부과대상이면 인당×인원이 총액과 어긋난다).
	const splitHead =
		attend.length +
		session.attendances.filter(
			(a) => !isAttending(a.status) && isDayCancelChargeable(a, session.scheduledAt),
		).length;
	// 서버: ceil(v_total::numeric / v_head / 10)::int * 10 → 정액 근처면 정액으로 스냅(한방향).
	const perHead = split
		? splitHead > 0
			? snapToFlat(Math.ceil((total as number) / splitHead / 10) * 10, flatFee)
			: 0
		: flatFee;

	// ── 부과 대상 집합 재현 ─────────────────────────────────────────
	// 대상이 아닌 참석행은 사유를 남긴다: 부과가 없으면 '정상 면제' 설명으로, 부과가 있으면 '확인 필요'로.
	const targets = new Set<string>();
	const nonTarget = new Map<string, NonTargetReason>();
	let targetDayCancelCount = 0;
	for (const a of session.attendances) {
		const dayCancel = isDayCancelChargeable(a, session.scheduledAt);
		const admin = isAdminOf(a.memberId);
		if (split) {
			// 엔빵: 실제 참석 + 부과대상 당일취소(운영진·게스트 포함).
			// 당일취소를 빼면 코트를 비운 사람이 한 푼도 안 내고 나온 사람들이 더 나눠 갖는 역진이 된다.
			if (isAttending(a.status) || dayCancel) {
				targets.add(a.memberId);
				if (dayCancel) targetDayCancelCount++;
			} else {
				nonTarget.set(
					a.memberId,
					isGraceWithdrawn(a, session.scheduledAt) ? "grace" : a.status === "cancelled" ? "preCancel" : "waitlisted",
				);
			}
			continue;
		}
		// 정액: 운영진 제외. 참석 + 당일취소(grace 초과).
		// **자리를 잡았는지 먼저 본다.** 운영진 판정을 앞세우면 사전취소·대기한 운영진까지
		// '운영진 · 대관비 면제'로 명단에 올라와, 오지도 않은 사람이 면제로 보인다.
		if (!isAttending(a.status) && !dayCancel) {
			nonTarget.set(
				a.memberId,
				isGraceWithdrawn(a, session.scheduledAt) ? "grace" : a.status === "cancelled" ? "preCancel" : "waitlisted",
			);
			continue;
		}
		if (admin) {
			nonTarget.set(a.memberId, "adminFlat"); // 왔지만 대관비를 걷지 않는 사람
			continue;
		}
		targets.add(a.memberId);
		if (dayCancel) targetDayCancelCount++;
	}
	// 사유별 머릿수 — 부과 유무와 무관하게 '규칙상 이렇게 갈렸다'를 세는 값(인원 대조 설명줄용).
	const reasonCount = (reason: NonTargetReason) => [...nonTarget.values()].filter((r) => r === reason).length;

	// ── 실제 부과 명단 ──────────────────────────────────────────────
	const chargedIds = new Set(charges.map((c) => c.memberId));

	// 부과 없이 빠진 사람 중 설명할 값이 있는 사유만 노출(사전취소·대기는 당연해서 생략).
	// **부과 행이 있는 사람은 제외** — 그 사람은 부과 행 자체가 사유를 들고 명단에 뜨므로,
	// 여기에도 넣으면 이름순 명단에서 같은 사람이 두 줄로 보인다(예: grace 인데 void 부과가 남은 건).
	const exempt: SettleExemptRow[] = [...nonTarget.entries()]
		.filter(([memberId, reason]) => CALM_REASONS.has(reason) && !chargedIds.has(memberId))
		.map(([memberId, reason]) => {
			const m = memberById.get(memberId);
			return { memberId, name: nameOf(memberId), isAdmin: m?.isAdmin ?? false, isGuest: m?.isGuest ?? false, reason };
		});
	const statusRank = (s: ChargeStatus) => (s === "paid" || s === "overpaid" ? 0 : s === "waived" || s === "void" ? 2 : 1);
	const charged: SettleChargeRow[] = charges
		.map((c) => {
			const proxy = c.payerHint && c.payerHint !== c.memberId ? c.payerHint : null;
			return {
				chargeId: c.id,
				memberId: c.memberId,
				name: nameOf(c.memberId),
				amountDue: c.amountDue,
				amountPaid: c.amountPaid,
				remain: remaining(c.amountDue, c.amountPaid),
				status: c.status,
				isDayCancel: c.isDayCancel,
				// 대납자·부과삭제자는 좁은 태그 안 문구 — 회색 분리 대신 한 문자열로 년생을 붙인다.
				payerName: proxy ? nameWithBirthYear(nameOf(proxy), birthYearOf(proxy)) : null,
				voidedByName: c.voidedBy ? nameWithBirthYear(nameOf(c.voidedBy), birthYearOf(c.voidedBy)) : null,
				isAdmin: isAdminOf(c.memberId),
				live: c.status !== "void" && c.status !== "waived",
				extraReason: targets.has(c.memberId) ? null : (nonTarget.get(c.memberId) ?? "noAttendance"),
			};
		})
		.sort((a, b) => statusRank(a.status) - statusRank(b.status) || a.name.localeCompare(b.name));

	// 부과 대상인데 부과 행이 아예 없는 사람 — 화면에 없던 정보(운영진이 손으로 세던 그것).
	const missing: SettlePersonRow[] = [...targets]
		.filter((id) => !chargedIds.has(id))
		.map((id) => {
			const m = memberById.get(id);
			return { memberId: id, name: nameOf(id), isAdmin: m?.isAdmin ?? false, isGuest: m?.isGuest ?? false };
		})
		.sort((a, b) => a.name.localeCompare(b.name));

	// ── 금액 ────────────────────────────────────────────────────────
	const live = charged.filter((c) => c.live); // 낼 돈
	const dueSum = live.reduce((s, c) => s + c.amountDue, 0);
	const voidSum = charged.filter((c) => !c.live).reduce((s, c) => s + c.amountDue, 0);
	const received = charged.reduce((s, c) => s + c.amountPaid, 0); // 무효분에 붙은 선납도 '받은 돈'은 사실이다
	const unpaid = live.filter((c) => c.remain > 0);
	const externalIn = txns.filter((t) => t.direction === "in").reduce((s, t) => s + t.amount, 0);
	const expense = txns.filter((t) => t.direction === "out").reduce((s, t) => s + t.amount, 0);
	const extra = charged.filter((c) => c.extraReason != null);
	const exemptSorted = exempt.sort((a, b) => a.reason.localeCompare(b.reason) || a.name.localeCompare(b.name));

	// ── 통합 명단 ───────────────────────────────────────────────────
	// charged(정상·잔재·고아) + missing + exempt 를 한 목록으로, **이름 가나다순**.
	// 사람을 이름으로 찾는 게 이 명단의 용도다(확인 대상은 우측 사유가 빨강으로 떠서 눈에 걸린다).
	// 한 사람이 두 줄로 나오지 않는 이유: missing ⊂ targets, exempt ⊂ nonTarget−charged, 부과는
	// (member, session) 유니크 → 세 소스가 서로 겹치지 않는다.
	const roster: SettleRosterRow[] = [
		...missing.map((m): SettleRosterRow => ({ key: `m${m.memberId}`, name: m.name, birthYear: birthYearOf(m.memberId), kind: "missing", charge: null, reason: null, isAdmin: m.isAdmin })),
		...charged.map((c): SettleRosterRow => ({
			key: `c${c.chargeId}`,
			name: c.name,
			birthYear: birthYearOf(c.memberId),
			kind: c.extraReason == null ? "charged" : c.extraReason === "noAttendance" ? "orphan" : c.live ? "stale" : "charged",
			charge: c,
			reason: c.extraReason,
			isAdmin: c.isAdmin,
		})),
		...exemptSorted.map((e): SettleRosterRow => ({ key: `e${e.memberId}`, name: e.name, birthYear: birthYearOf(e.memberId), kind: "exempt", charge: null, reason: e.reason, isAdmin: e.isAdmin })),
	].sort((a, b) => a.name.localeCompare(b.name, "ko") || KIND_RANK[a.kind] - KIND_RANK[b.kind]);

	// 명단 분할: 확인필요 / 부과없음 / 무효 / 미납 / 완납 — 다섯 칸이 서로 겹치지 않는다.
	let flaggedCount = 0;
	const rosterCounts = { paid: 0, unpaid: 0, dead: 0, none: 0 };
	for (const r of roster) {
		if (r.kind === "missing" || r.kind === "stale") flaggedCount++; // 납부 상태보다 우선해 센다
		else if (!r.charge) rosterCounts.none++;
		else if (!r.charge.live) rosterCounts.dead++;
		else if (r.charge.remain > 0) rosterCounts.unpaid++;
		else rosterCounts.paid++;
	}

	return {
		mode: split ? "split" : "flat",
		total: split ? (total as number) : null,
		perHead,
		dueAmounts: [...new Set(live.map((c) => c.amountDue))].sort((a, b) => a - b),
		attendCount: attend.length,
		adminAttendCount: attend.filter((a) => isAdminOf(a.memberId)).length,
		targetDayCancelCount,
		targetCount: targets.size,
		graceCount: reasonCount("grace"),
		missing,
		deadOnTargetCount: charged.filter((c) => !c.live && c.extraReason == null).length,
		liveExtraCount: charged.filter((c) => c.live && c.extraReason != null).length,
		activeCount: live.length,
		charged,
		roster,
		flaggedCount,
		rosterCounts,
		exempt: exemptSorted,
		extra,
		staleCharges: extra.filter((c) => c.live && c.extraReason !== "noAttendance"),
		orphanCharges: extra.filter((c) => c.extraReason === "noAttendance"),
		dueSum,
		voidSum,
		received,
		unpaidSum: unpaid.reduce((s, c) => s + c.remain, 0),
		unpaidCount: unpaid.length,
		externalIn,
		expense,
		net: received + externalIn - expense,
		expectedNet: dueSum + externalIn - expense,
	};
}

/** 부과 대상이 아닌 사유 라벨 — 부과가 **없을** 때(정상 면제로 조용히 설명). */
export const EXEMPT_LABEL: Record<NonTargetReason, string> = {
	adminFlat: "운영진 · 대관비 면제",
	grace: "확정 후 1시간 내 철회 · 미부과",
	preCancel: "사전취소",
	waitlisted: "대기",
	noAttendance: "참석 기록 없음",
};

/** 같은 사유 라벨 — 부과가 **있을** 때(규칙과 어긋난 잔재라 확인이 필요하다). */
export const EXTRA_LABEL: Record<NonTargetReason, string> = {
	adminFlat: "운영진인데 부과됨",
	grace: "1시간 내 철회인데 부과됨",
	preCancel: "사전취소인데 부과됨",
	waitlisted: "대기인데 부과됨",
	noAttendance: "참석 기록 없는데 부과됨",
};
