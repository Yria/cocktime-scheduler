import type { AccountingCommand, AccountingData, BillingGroup } from "./types";

/**
 * 발행된 부과 묶음에 회원 한 명을 추가하는 규칙(부과 탭 [부과 변경] → [+ 사람 추가]).
 * 서버 `dues_issue` 가 `group_id` 로 기존 묶음에 줄을 더하는 경로를 그대로 쓴다.
 */

/** 새로 추가할 사람의 금액 — 기존 유효 부과 중 가장 많은 금액, 동률이면 작은 쪽(수동 부과 신규 규칙과 같은 방향). */
export function groupAddAmount(
	data: AccountingData,
	groupId: string,
): number | null {
	const counts = new Map<number, number>();
	for (const c of data.charges)
		if (c.group_id === groupId && c.state === "live")
			counts.set(c.amount, (counts.get(c.amount) ?? 0) + 1);
	let best: number | null = null,
		bestCount = 0;
	for (const [amount, count] of counts)
		if (count > bestCount || (count === bestCount && amount < (best ?? 0))) {
			best = amount;
			bestCount = count;
		}
	return best;
}

/** 새 부과의 납기 — 기존 유효 부과의 첫 납기 중 가장 흔한 달, 없으면 발생월. */
export function groupAddDueYm(data: AccountingData, group: BillingGroup) {
	const live = new Set(
		data.charges
			.filter((c) => c.group_id === group.id && c.state === "live")
			.map((c) => c.id),
	);
	const first = new Map<string, string>();
	for (const d of data.due)
		if (live.has(d.charge_id)) {
			const was = first.get(d.charge_id);
			if (!was || d.due_ym < was) first.set(d.charge_id, d.due_ym);
		}
	const counts = new Map<string, number>();
	for (const ym of first.values()) counts.set(ym, (counts.get(ym) ?? 0) + 1);
	return (
		[...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ??
		group.occurred_on.slice(0, 7)
	);
}

export type GroupAddState = "candidate" | "readd" | "charged" | "blocked";

/**
 * 묶음 기준 회원 상태. 서버 `dues_issue` 는 [사람 추가](`reissue_cancelled`)로 보낸 발행이면
 * 취소된 부과가 있어도 다시 부과한다(옛 부과에 이어 붙임) — 면제(waived)만 계속 막는다.
 */
export function groupAddState(
	data: AccountingData,
	groupId: string,
	memberId: string,
): GroupAddState {
	const mine = data.charges.filter(
		(c) => c.group_id === groupId && c.member_id === memberId,
	);
	if (mine.some((c) => c.state === "live")) return "charged";
	if (mine.some((c) => c.state === "waived")) return "blocked";
	return mine.length ? "readd" : "candidate";
}

export function groupAddCommand(
	group: BillingGroup,
	memberId: string,
	memberName: string,
	amount: number,
	dueYm: string,
): AccountingCommand {
	return {
		action: "issue",
		reason: `${group.label} · ${memberName} 추가 부과`,
		group_id: group.id,
		kind: group.kind,
		label: group.label,
		date: group.occurred_on,
		ym: dueYm,
		lines: [{ member_id: memberId, amount, due_ym: dueYm }],
		// 사람이 직접 고른 추가 — 서버가 취소된 부과가 있는 회원도 다시 발행한다.
		reissue_cancelled: true,
		basis: { added_to_group: true },
	};
}
