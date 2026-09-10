import {
	buildSessionSettle,
	EXEMPT_LABEL,
	EXTRA_LABEL,
	TARGET_LABEL,
} from "./sessionSettle";
import type { CourtChargeRow, SessionFeeRow } from "./sessionTypes";
import { billingProgress } from "./overview";
import { memberLabel } from "./summary";
import type { AccountingData, BillingGroup, Charge } from "./types";

export interface AccountingParticipation {
	sessions: SessionFeeRow[];
	adminIds: string[];
	flatFee: number;
}

export interface BillingPerson {
	memberId: string;
	state: "charged" | "excluded" | "unissued";
	label: string;
	reason: string;
	exclusion?: string;
	payment?: ReturnType<typeof billingProgress>["rows"][number];
}

// Retain the attendance rules from 30ddf07's sessionSettle. Financial facts
// always come from the canonical ledger; an excluded participant is never counted as a payment.
export function groupParticipation(
	data: AccountingData,
	group: BillingGroup,
	ym: string,
	context?: AccountingParticipation,
) {
	const progress = billingProgress(data, [group], ym);
	const all = data.charges.filter((c) => c.group_id === group.id);
	const replaced = new Set(all.map((c) => c.previous_id).filter(Boolean));
	const charges = new Map<string, Charge>();
	for (const charge of all
		.filter((c) => !replaced.has(c.id))
		.sort(
			(a, b) =>
				a.issued_at.localeCompare(b.issued_at) || a.id.localeCompare(b.id),
		)) {
		if (charges.get(charge.member_id)?.state !== "live")
			charges.set(charge.member_id, charge);
	}
	const people = new Map<string, BillingPerson>();
	for (const payment of progress.rows) {
		people.set(payment.charge.member_id, {
			memberId: payment.charge.member_id,
			state: "charged",
			label:
				payment.remaining === 0
					? "완납"
					: payment.remaining === payment.later
						? "납기 이월"
						: payment.paid > 0
							? "부분 납부"
							: "미납",
			reason: "",
			payment,
		});
	}
	for (const c of charges.values()) {
		if (people.has(c.member_id)) continue;
		const label = c.state === "waived" ? "미납 면제" : "부과 취소";
		people.set(c.member_id, {
			memberId: c.member_id,
			state: "excluded",
			label,
			// basis.reason records issuance/replacement, not the later waiver.
			reason: "",
			exclusion: label,
		});
	}
	const session =
		group.kind === "court"
			? context?.sessions.find((s) => s.id === group.session_id)
			: undefined;
	let attendance: ReturnType<typeof buildSessionSettle> | undefined;
	if (session && context) {
		const admins = new Set(context.adminIds);
		const members = new Map(
			data.members.map((m) => [
				m.id,
				{
					id: m.id,
					name: m.name,
					birthYear: m.birth_year,
					isAdmin: admins.has(m.id),
					isGuest: m.guest,
				},
			]),
		);
		const rows: CourtChargeRow[] = [...charges.values()].map((c, i) => {
			const payment = people.get(c.member_id)?.payment;
			return {
				id: i,
				memberId: c.member_id,
				sessionId: session.id,
				sessionTitle: session.title,
				scheduledAt: session.scheduledAt,
				amountDue: c.amount,
				amountPaid: payment?.paid ?? 0,
				status:
					c.state === "cancelled"
						? "void"
						: c.state === "waived"
							? "waived"
							: payment?.remaining === 0
								? "paid"
								: payment?.paid
									? "partial"
									: "unpaid",
				payerHint: c.payer_hint,
				isDayCancel: c.basis?.is_day_cancel === true,
				voidedBy: null,
			};
		});
		const draftIds = new Set(
			data.drafts
				.filter((d) => d.source_key === group.source_key)
				.flatMap((d) =>
					(Array.isArray(d.payload.lines) ? d.payload.lines : []).flatMap(
						(line: unknown) =>
							typeof line === "object" &&
							line !== null &&
							"member_id" in line &&
							typeof line.member_id === "string"
								? [line.member_id]
								: [],
					),
				),
		);
		attendance = buildSessionSettle(
			session,
			rows,
			members,
			context.flatFee,
			[],
			draftIds,
		);
		const excludedLabels = {
			adminFlat: "운영진",
			grace: "1시간 내 철회",
			noCourtFee: "대관비 없는 회차",
			preCancel: "사전취소",
			waitlisted: "대기",
			noAttendance: "참석 기록 없음",
		};
		for (const p of attendance.exempt)
			people.set(p.memberId, {
				memberId: p.memberId,
				state: "excluded",
				label: "부과 제외",
				reason: EXEMPT_LABEL[p.reason],
				exclusion: excludedLabels[p.reason],
			});
		for (const p of attendance.missing)
			people.set(p.memberId, {
				memberId: p.memberId,
				state: "unissued",
				label: "부과 없음",
				reason: `${TARGET_LABEL[p.targetReason]} · 발행 내역 없음`,
			});
		for (const p of attendance.pending)
			people.set(p.memberId, {
				memberId: p.memberId,
				state: "unissued",
				label: session.status === "closed" ? "발행 대기" : "종료 후 부과",
				reason: TARGET_LABEL[p.targetReason],
			});
		for (const p of attendance.charged) {
			const row = people.get(p.memberId);
			if (row?.state !== "charged") continue;
			row.reason = p.extraReason
				? p.extraReason === "noAttendance"
					? "참석 기록 없음"
					: `현재 참석 기준 확인 · ${EXTRA_LABEL[p.extraReason]}`
				: p.isDayCancel
					? "당일취소 부과"
					: "";
		}
	}
	const rows = [...people.values()].sort((a, b) => {
		const rank = (p: BillingPerson) =>
			p.state === "excluded"
				? 3
				: p.state === "unissued"
					? 1
					: p.payment?.remaining
						? 0
						: 2;
		return (
			rank(a) - rank(b) ||
			memberLabel(data, a.memberId).localeCompare(
				memberLabel(data, b.memberId),
				"ko",
			)
		);
	});
	const exclusions = new Map<string, number>();
	for (const p of rows)
		if (p.exclusion)
			exclusions.set(p.exclusion, (exclusions.get(p.exclusion) ?? 0) + 1);
	return {
		progress,
		rows,
		attendance,
		complete: group.kind !== "court" || !!session,
		totalCount: rows.length,
		chargedCount: rows.filter((p) => p.state === "charged").length,
		excludedCount: rows.filter((p) => p.state === "excluded").length,
		unissuedCount: rows.filter((p) => p.state === "unissued").length,
		exclusions: [...exclusions].map(([label, count]) => ({ label, count })),
	};
}
