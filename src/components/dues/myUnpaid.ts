import type { MyChargeRow } from "../../lib/supabase/dues";
import { currentYm, fmtMD, remaining } from "../admin/dues/duesText";

// 회원 본인 관점의 "미납" 정의 — 내 회비 탭(MyDuesTab)과 진입 알림(UnpaidDuesAlert)이 공유한다.
// 두 곳의 판정이 갈리면 "알림은 뜨는데 화면엔 미납이 없다"가 되므로 정의를 한 군데로 모은다.

/**
 * 미납/부분납 부과만. 대관비·수동 부과(회식·공동구매)는 월 무관 전부, 회비는 실효 월(이월=deferredTo,
 * 없으면 periodYm)이 기준 월 이하인 것만(미래로 이월된 건 아직 안 뜸). 회비 시스템 정산은 2026-07부터라
 * 과거 회비 미납은 없음. 면제(waived)·부과삭제(void)·완납은 status 필터에서 자연히 빠진다.
 */
export function selectUnpaid(
	charges: MyChargeRow[],
	ym: string = currentYm(),
): MyChargeRow[] {
	return charges.filter(
		(c) =>
			(c.status === "unpaid" || c.status === "partial") &&
			(c.kind === "court_fee" ||
				c.kind === "manual" ||
				(c.kind === "monthly_fee" &&
					(c.deferredTo ?? c.periodYm ?? "") <= ym)),
	);
}

/** 미납 잔액 합계(부분납은 남은 금액만). */
export function unpaidSum(charges: MyChargeRow[]): number {
	return charges.reduce((s, c) => s + remaining(c.amountDue, c.amountPaid), 0);
}

/** '7월 회비' / '7.12 대관비' / '7.12 대관비 (게스트 대납)' / '8/22 정모 회식'. */
export function chargeLabel(c: MyChargeRow): string {
	if (c.kind === "monthly_fee")
		return `${c.periodYm ? `${Number(c.periodYm.slice(5))}월` : ""} 회비`;
	// 수동 부과는 이름을 행이 들고 있다(만들 때 운영진이 붙인 것).
	if (c.kind === "manual")
		return `${c.label ?? "기타 부과"}${c.isProxy ? " (게스트 대납)" : ""}`;
	const d = c.scheduledAt ? fmtMD(c.scheduledAt) : (c.sessionTitle ?? "세션");
	return `${d} 대관비${c.isProxy ? " (게스트 대납)" : ""}`;
}
