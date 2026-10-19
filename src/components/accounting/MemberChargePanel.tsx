import { useState } from "react";
import { ArrowRightLeft, Pencil, UserRound, XCircle } from "lucide-react";
import { won } from "../../lib/dues/duesText";
import { memberLabel } from "../../lib/dues/summary";
import type {
	AccountingData,
	BillingGroup,
	Charge,
} from "../../lib/dues/types";
import MemberPicker from "./MemberPicker";
import type { OperationDraft } from "./OperationDialog";

const kinds = { monthly: "회비", court: "대관", manual: "수동" };

interface Row {
	charge: Charge;
	group: BillingGroup;
	owe: number;
}

/**
 * 부과 변경을 사람 단위로 한다. 정산함처럼 회원을 먼저 고르고, 그 회원의 유효
 * 부과만 모아 금액 변경·취소·이월을 건다 — 회차를 펼쳐 명단에서 한 명을 찾던
 * 길을 줄인다. 처리 자체는 회차별 화면과 같은 전표(replace/carry)를 쓴다.
 */
export default function MemberChargePanel({
	data,
	ym,
	labels,
	member,
	onMember,
	disabled,
	onDraft,
}: {
	data: AccountingData;
	ym: string;
	labels: Map<number, string>;
	member: string;
	onMember: (id: string) => void;
	disabled: boolean;
	onDraft: (draft: OperationDraft) => void;
}) {
	const [selected, setSelected] = useState<string[]>([]);
	const [showAll, setShowAll] = useState(false);
	const groups = new Map(data.groups.map((g) => [g.id, g]));
	const oweOf = (chargeId: string) =>
		data.due
			.filter((d) => d.charge_id === chargeId)
			.reduce((sum, d) => sum + d.remaining, 0);
	const rowsOf = (id: string): Row[] =>
		data.charges
			.filter((c) => c.member_id === id && c.state === "live")
			.flatMap((charge) => {
				const group = groups.get(charge.group_id);
				return group ? [{ charge, group, owe: oweOf(charge.id) }] : [];
			})
			.sort(
				(a, b) =>
					b.group.occurred_on.localeCompare(a.group.occurred_on) ||
					a.group.label.localeCompare(b.group.label),
			);
	const describe = (id: string) => {
		const rows = rowsOf(id);
		const month = rows.filter((r) => r.group.occurred_on.startsWith(ym));
		const owe = rows.reduce((sum, r) => sum + r.owe, 0);
		return [
			month.length ? `${Number(ym.slice(5))}월 부과 ${month.length}건` : "",
			owe ? `미납 ${won(owe)}` : "",
		]
			.filter(Boolean)
			.join(" · ");
	};
	const rows = member ? rowsOf(member) : [];
	// 이번 달 부과와 아직 덜 받은 부과가 고칠 일의 대부분 — 나머지는 접어 둔다.
	const primary = rows.filter(
		(r) => r.group.occurred_on.startsWith(ym) || r.owe > 0,
	);
	const rest = rows.filter((r) => !primary.includes(r));
	const shown = showAll ? [...primary, ...rest] : primary;
	// 접혀 안 보이는 부과는 처리 대상에서 뺀다 — 보이는 것만 바꾼다.
	const picked = selected.filter((id) => shown.some((r) => r.charge.id === id));
	const pick = (id: string) => {
		onMember(id);
		setSelected([]);
		setShowAll(false);
	};
	const label = (g: BillingGroup) =>
		g.session_id ? (labels.get(g.session_id) ?? g.label) : g.label;
	return (
		<div className="ac-member-charge">
			<div className="ac-receipt-picker ac-settlement-member-search">
				<MemberPicker
					compact
					data={data}
					label="회원"
					value={member}
					onChange={pick}
					descriptionForMember={describe}
				/>
			</div>
			{!member ? (
				<div className="ac-charge-empty">
					<UserRound size={26} aria-hidden="true" />
					<strong>부과를 바꿀 회원을 검색하세요</strong>
					<p>회원을 고르면 그 회원의 부과만 모아 보여 줍니다.</p>
				</div>
			) : (
				<>
					<div className="ac-issued-detail-head">
						<h3>
							{memberLabel(data, member)}의 부과{" "}
							<span className="ac-caption">유효 {rows.length}건</span>
						</h3>
					</div>
					{shown.map(({ charge: c, group: g, owe }) => (
						<div key={c.id} className="ac-issued-member">
							<div>
								<label>
									<input
										type="checkbox"
										aria-label={`${label(g)} · ${g.occurred_on} · ${won(c.amount)}`}
										disabled={disabled}
										checked={picked.includes(c.id)}
										onChange={(e) =>
											setSelected(
												e.target.checked
													? [...picked, c.id]
													: picked.filter((id) => id !== c.id),
											)
										}
									/>
									<strong>{label(g)}</strong>
								</label>
								<span>
									{kinds[g.kind]} · {g.occurred_on.slice(5).replace("-", "/")}
									{c.previous_id ? " · 변경 발행" : ""}
								</span>
								<small className={owe > 0 ? "is-ask" : "is-ok"}>
									{owe > 0 ? `미납 ${won(owe)}` : "완납"}
								</small>
							</div>
							<strong className="ac-number">{won(c.amount)}</strong>
						</div>
					))}
					{!rows.length && (
						<p className="ac-caption">유효한 부과가 없습니다.</p>
					)}
					{rows.length > 0 && !shown.length && !showAll && (
						<p className="ac-caption">이번 달 부과와 미납 부과가 없습니다.</p>
					)}
					{rest.length > 0 && (
						<button
							type="button"
							className="ac-link"
							onClick={() => {
								setShowAll(!showAll);
								setSelected(
									picked.filter((id) =>
										primary.some((r) => r.charge.id === id),
									),
								);
							}}
						>
							{showAll
								? "다른 달 완납 부과 접기"
								: `다른 달 완납 부과 ${rest.length}건 보기`}
						</button>
					)}
					<p className="ac-caption" aria-live="polite">
						{picked.length
							? `${picked.length}건 선택 · 아래에서 처리를 고르세요`
							: "바꿀 부과를 체크하세요"}
					</p>
					<div
						className="ac-member-charge-actions"
						role="group"
						aria-label="선택한 부과 처리"
					>
						<button
							type="button"
							disabled={disabled || !picked.length}
							onClick={() => onDraft({ type: "replace", chargeIds: picked })}
						>
							<Pencil size={16} aria-hidden="true" />
							금액 변경
						</button>
						<button
							type="button"
							className="is-stop"
							disabled={disabled || !picked.length}
							onClick={() =>
								onDraft({
									type: "replace",
									chargeIds: picked,
									cancelOnly: true,
								})
							}
						>
							<XCircle size={16} aria-hidden="true" />
							부과 취소
						</button>
						<button
							type="button"
							disabled={disabled}
							aria-label="이 회원 미납·입금 이월"
							onClick={() => onDraft({ type: "carry", memberId: member })}
						>
							<ArrowRightLeft size={16} aria-hidden="true" />
							이월
						</button>
					</div>
					<p className="ac-caption">
						변경·취소는 원부과를 취소 표시로 남기고, 이미 받은 돈은 잔액으로
						돌린 뒤 새 부과에 다시 씁니다.
					</p>
				</>
			)}
		</div>
	);
}
