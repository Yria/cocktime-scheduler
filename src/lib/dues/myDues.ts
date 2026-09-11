/**
 * 회원 화면(`/my-dues`)의 **달 단위** 집계. Claude Design `콕타임 회계 v2` 3a
 * '내 회비' 카드의 계산 근거이며, `memberSummary`(오늘 기준 낼 돈)와 역할이 다르다.
 *
 * 달의 정의는 **부과 달**이다 — `dues_groups.occurred_on`(회비=그 달, 대관비=회차
 * 날짜, 수동=발생일)의 KST 달. 납부 달로 잡으면 `낸 돈 + 남은 금액 = 부과`가
 * 깨져서 같은 카드 안에서 서로를 부정하는 숫자가 나온다(9월 회비를 10월에 내면
 * '낸 0 / 부과 29,000 / 남은 0'). 그래서 이 파일의 모든 금액은 한 달의 부과를
 * 기준으로 하고, 납부 줄의 날짜는 실제 입금일을 그대로 보여 준다.
 *
 * 서버 조회(`dues_read`)는 본인 관련 부과·납기·배분을 **월 제한 없이** 전부 주므로
 * 달 이동은 재조회 없이 이 함수만 다시 돌린다.
 *
 * 살아 있는(`live`) 부과만 세도 회원이 낸 돈이 사라지지 않는다 — 서버가 그걸 보장한다:
 * `replace`(취소 후 발행)는 취소 전에 그 부과의 배분을 전부 해제해 잔액(position)으로
 * 돌리고, `waive`(면제)는 살아 있는 배분이 있으면 아예 거부한다("납부가 있는 부과는
 * 취소 후 발행으로 처리하세요"). 그래서 취소·면제 부과에는 실돈이 남지 않는다.
 */
import { fmtMDDow, fmtMDSlash, won, ymOfIso } from "./duesText";
import { shortGroupLabel } from "./labelShorten";
import type { AccountingData, BillingGroup, Charge } from "./types";

/** 카드의 종류별 줄 — '9월 회비' · '회차 대관비' · 수동 묶음 하나. */
export interface MyDuesLine {
	key: string;
	label: string;
	/** 이 종류에 실제로 배분된 금액(해제분 제외). */
	paid: number;
	charged: number;
	remaining: number;
	/** '9/3 (목) 납부' · '4회차 중 3회차 납부' · '미납' 같은 상태 한 줄. */
	note: string;
}

/** 납부 내역 한 줄 = 통장 입금 1건이 이 달 부과에 배분된 금액. */
export interface MyDuesPayment {
	key: string;
	/** '9/12 (토)' — 실제 입금일(KST). */
	date: string;
	/** '9/11 · 9/12 대관비 2회차' 처럼 무엇을 냈는지. */
	targets: string;
	amount: number;
}

/** 미납 한 건 — 알림 문장과 '남은 금액' 보조줄이 함께 쓴다. */
export interface MyDuesItem {
	key: string;
	/** '9/8 (화) 대관비' · '9월 회비'. */
	label: string;
	amount: number;
	occurredOn: string;
	/** 남은 금액의 납기 달. 오늘 달보다 뒤면 '납기 이월'이라 지금 낼 돈이 아니다. */
	dueYm: string;
}

export interface MyDuesMonth {
	ym: string;
	charged: number;
	paid: number;
	remaining: number;
	/** 0~1. 부과가 없으면 0. 미터와 카드 진행률이 함께 쓴다. */
	ratio: number;
	lines: MyDuesLine[];
	payments: MyDuesPayment[];
	refunds: { key: string; date: string; amount: number }[];
	unpaid: MyDuesItem[];
	/** 게스트 등 다른 사람 부과의 대납 안내 — 본인 금액과 섞지 않는다. */
	proxy: { charged: number; remaining: number; names: string[] };
	empty: boolean;
}

const monthLabel = (ym: string) => `${Number(ym.slice(5))}월 회비`;

/** 미납·납부 줄에서 부과 한 건을 가리키는 이름. */
function itemLabel(g: BillingGroup, ym: string): string {
	if (g.kind === "monthly") return monthLabel(ym);
	if (g.kind === "court") return `${fmtMDDow(g.occurred_on)} 대관비`;
	return shortGroupLabel(g.label);
}

/** 카드 줄의 묶음 키 — 회비·대관비는 종류로 합치고 수동 부과는 묶음별로 둔다. */
const lineKey = (g: BillingGroup) =>
	g.kind === "manual" ? `manual:${g.id}` : g.kind;

const lineLabel = (g: BillingGroup, ym: string) =>
	g.kind === "monthly"
		? monthLabel(ym)
		: g.kind === "court"
			? "회차 대관비"
			: shortGroupLabel(g.label);

const KIND_ORDER: Record<BillingGroup["kind"], number> = {
	monthly: 0,
	court: 1,
	manual: 2,
};

/** 입금 1건이 무엇을 냈는지 — 대관비는 회차 날짜를 모아 세고 나머지는 이름을 잇는다. */
function targetsLabel(groups: BillingGroup[], ym: string): string {
	const court = groups
		.filter((g) => g.kind === "court")
		.sort((a, b) => a.occurred_on.localeCompare(b.occurred_on));
	const parts: string[] = [];
	if (groups.some((g) => g.kind === "monthly")) parts.push(monthLabel(ym));
	if (court.length)
		parts.push(
			`${court.map((g) => fmtMDSlash(g.occurred_on)).join(" · ")} 대관비${
				court.length > 1 ? ` ${court.length}회차` : ""
			}`,
		);
	for (const g of groups.filter((g) => g.kind === "manual"))
		parts.push(shortGroupLabel(g.label));
	return parts.join(" · ");
}

/** 부과 한 건의 남은 금액이 언제까지 납기인지 — 이월된 미납은 달이 뒤로 밀려 있다. */
function dueYmOf(data: AccountingData, chargeId: string): string {
	return data.due
		.filter((d) => d.charge_id === chargeId && d.remaining > 0)
		.reduce((max, d) => (d.due_ym > max ? d.due_ym : max), "");
}

/** 이 달에 부과가 있었던 달 목록(오름차순). 달 이동 버튼의 범위. */
export function myDuesMonths(
	data: AccountingData,
	memberId: string,
): string[] {
	const groups = new Map(data.groups.map((g) => [g.id, g]));
	const months = new Set<string>();
	for (const c of data.charges) {
		if (c.member_id !== memberId && c.payer_hint !== memberId) continue;
		const g = groups.get(c.group_id);
		if (g) months.add(g.occurred_on.slice(0, 7));
	}
	return [...months].sort();
}

/**
 * 오늘 기준 낼 돈의 근거 목록 — 납기가 도래한 본인 미납을 발생일 순으로 준다.
 * 카드는 달 단위지만 이 목록은 **달을 넘어** 모은다. 다른 달 미납이 화면에서
 * 사라지면 회원이 낼 돈을 못 본다.
 */
export function myDuesUnpaid(
	data: AccountingData,
	memberId: string,
	asOfYm: string,
): MyDuesItem[] {
	const groups = new Map(data.groups.map((g) => [g.id, g]));
	const mine = new Map<string, Charge>();
	for (const c of data.charges)
		if (c.state === "live" && c.member_id === memberId) mine.set(c.id, c);
	const byCharge = new Map<string, number>();
	for (const d of data.due) {
		if (!mine.has(d.charge_id) || d.due_ym > asOfYm || d.remaining <= 0)
			continue;
		byCharge.set(d.charge_id, (byCharge.get(d.charge_id) ?? 0) + d.remaining);
	}
	const items: MyDuesItem[] = [];
	for (const [id, amount] of byCharge) {
		const g = groups.get(mine.get(id)!.group_id);
		if (!g) continue;
		items.push({
			key: id,
			label: itemLabel(g, g.occurred_on.slice(0, 7)),
			amount,
			occurredOn: g.occurred_on,
			dueYm: dueYmOf(data, id),
		});
	}
	return items.sort(
		(a, b) =>
			a.occurredOn.localeCompare(b.occurredOn) || a.label.localeCompare(b.label),
	);
}

export function myDuesMonth(
	data: AccountingData,
	memberId: string,
	ym: string,
): MyDuesMonth {
	const groups = new Map(data.groups.map((g) => [g.id, g]));
	const groupOf = (c: Charge) => groups.get(c.group_id);
	const inMonth = (c: Charge) => groupOf(c)?.occurred_on.slice(0, 7) === ym;

	const mine = data.charges.filter(
		(c) => c.state === "live" && c.member_id === memberId && inMonth(c),
	);
	const ids = new Set(mine.map((c) => c.id));

	const remainingOf = new Map<string, number>();
	for (const d of data.due)
		if (ids.has(d.charge_id))
			remainingOf.set(
				d.charge_id,
				(remainingOf.get(d.charge_id) ?? 0) + d.remaining,
			);

	const allocs = data.allocations.filter(
		(a) => ids.has(a.charge_id) && a.amount - a.reversed > 0,
	);
	const paidOf = new Map<string, number>();
	for (const a of allocs)
		paidOf.set(
			a.charge_id,
			(paidOf.get(a.charge_id) ?? 0) + a.amount - a.reversed,
		);

	const charged = mine.reduce((s, c) => s + c.amount, 0);
	const remaining = mine.reduce((s, c) => s + (remainingOf.get(c.id) ?? 0), 0);
	const paid = mine.reduce((s, c) => s + (paidOf.get(c.id) ?? 0), 0);

	const bank = new Map(data.bank.map((t) => [t.id, t]));
	const payDate = (chargeId: string) => {
		const dates = allocs
			.filter((a) => a.charge_id === chargeId)
			.map((a) => bank.get(a.bank_tx_id)?.occurred_at ?? a.created_at);
		return [...new Set(dates)];
	};

	// ── 종류별 줄 ────────────────────────────────────────────────────────────
	const buckets = new Map<string, Charge[]>();
	for (const c of mine) {
		const g = groupOf(c)!;
		const k = lineKey(g);
		buckets.set(k, [...(buckets.get(k) ?? []), c]);
	}
	const lines: MyDuesLine[] = [...buckets]
		.sort(([, a], [, b]) => {
			const ga = groupOf(a[0])!;
			const gb = groupOf(b[0])!;
			return (
				KIND_ORDER[ga.kind] - KIND_ORDER[gb.kind] ||
				lineLabel(ga, ym).localeCompare(lineLabel(gb, ym))
			);
		})
		.map(([key, cs]) => {
			const g = groupOf(cs[0])!;
			const lineCharged = cs.reduce((s, c) => s + c.amount, 0);
			const lineRemaining = cs.reduce(
				(s, c) => s + (remainingOf.get(c.id) ?? 0),
				0,
			);
			const linePaid = cs.reduce((s, c) => s + (paidOf.get(c.id) ?? 0), 0);
			const dates = [...new Set(cs.flatMap((c) => payDate(c.id)))];
			let note: string;
			if (g.kind === "court") {
				const done = cs.filter(
					(c) => (remainingOf.get(c.id) ?? 0) === 0,
				).length;
				note =
					done === cs.length
						? `${cs.length}회차 납부`
						: `${cs.length}회차 중 ${done}회차 납부`;
			} else if (lineRemaining === 0 && dates.length === 1)
				note = `${fmtMDDow(dates[0])} 납부`;
			else if (lineRemaining === 0 && dates.length > 1)
				note = `${dates.length}건 납부`;
			else if (linePaid > 0) note = `부분 납부 · 남은 ${won(lineRemaining)}`;
			else note = "미납";
			return {
				key,
				label: lineLabel(g, ym),
				paid: linePaid,
				charged: lineCharged,
				remaining: lineRemaining,
				note,
			};
		});

	// ── 납부 내역(입금 1건 = 한 줄) ─────────────────────────────────────────
	const txs = new Map<string, typeof allocs>();
	for (const a of allocs) {
		const k = bank.has(a.bank_tx_id) ? `tx:${a.bank_tx_id}` : `alloc:${a.id}`;
		txs.set(k, [...(txs.get(k) ?? []), a]);
	}
	const payments: MyDuesPayment[] = [...txs]
		.map(([key, rows]) => ({
			key,
			rows,
			when: bank.get(rows[0].bank_tx_id)?.occurred_at ?? rows[0].created_at,
		}))
		.sort((a, b) => b.when.localeCompare(a.when))
		.map(({ key, rows, when }) => ({
			key,
			date: fmtMDDow(when),
			targets: targetsLabel(
				[
					...new Map(
						rows
							.map((a) =>
								groupOf(data.charges.find((c) => c.id === a.charge_id)!),
							)
							.filter((g): g is BillingGroup => !!g)
							.map((g) => [g.id, g] as const),
					).values(),
				],
				ym,
			),
			amount: rows.reduce((s, a) => s + a.amount - a.reversed, 0),
		}));

	// ── 이 달에 실제로 나간 환불 ────────────────────────────────────────────
	const refunds = data.refunds
		.filter((r) => r.owner_id === memberId)
		.map((r) => ({ r, tx: bank.get(r.out_tx_id) }))
		.filter(({ tx }) => tx && ymOfIso(tx.occurred_at) === ym)
		.map(({ r, tx }) => ({
			key: `refund:${r.out_tx_id}:${r.in_tx_id}`,
			date: fmtMDDow(tx!.occurred_at),
			amount: r.amount,
		}));

	// ── 미납 목록과 대납 안내 ───────────────────────────────────────────────
	const unpaid: MyDuesItem[] = mine
		.filter((c) => (remainingOf.get(c.id) ?? 0) > 0)
		.map((c) => {
			const g = groupOf(c)!;
			return {
				key: c.id,
				label: itemLabel(g, ym),
				amount: remainingOf.get(c.id) ?? 0,
				occurredOn: g.occurred_on,
				dueYm: dueYmOf(data, c.id),
			};
		})
		.sort(
			(a, b) =>
				a.occurredOn.localeCompare(b.occurredOn) ||
				a.label.localeCompare(b.label),
		);

	const proxyCharges = data.charges.filter(
		(c) =>
			c.state === "live" &&
			c.member_id !== memberId &&
			c.payer_hint === memberId &&
			inMonth(c),
	);
	const proxyIds = new Set(proxyCharges.map((c) => c.id));
	const proxy = {
		charged: proxyCharges.reduce((s, c) => s + c.amount, 0),
		remaining: data.due
			.filter((d) => proxyIds.has(d.charge_id))
			.reduce((s, d) => s + d.remaining, 0),
		names: [
			...new Set(
				proxyCharges.map(
					(c) =>
						data.members.find((m) => m.id === c.member_id)?.name ?? "게스트",
				),
			),
		],
	};

	return {
		ym,
		charged,
		paid,
		remaining,
		ratio: charged > 0 ? Math.max(0, (charged - remaining) / charged) : 0,
		lines,
		payments,
		refunds,
		unpaid,
		proxy,
		empty:
			charged === 0 &&
			paid === 0 &&
			payments.length === 0 &&
			refunds.length === 0 &&
			proxy.charged === 0,
	};
}
