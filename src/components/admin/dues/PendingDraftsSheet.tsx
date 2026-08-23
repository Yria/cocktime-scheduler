import { useMemo, useState } from "react";
import { nameWithBirthYear } from "../../../lib/birthYear";
import {
	HOLD_HINT,
	HOLD_LABEL,
	type PendingDraftGroup,
	discardDrafts,
	issueDrafts,
} from "../../../lib/supabase/chargeDrafts";
import { duesActions, useDuesStore } from "../../../store/duesStore";
import { toast } from "../../../store/toastStore";
import ConfirmDialog from "../../common/ConfirmDialog";
import ModalSheet from "../../common/ModalSheet";
import { won } from "./duesText";

/**
 * 발행 대기 초안 검토 시트.
 *
 * 부과는 발행된 사실이고 규칙은 초안을 만드는 도구다(§ 부과 재설계). 초안이 평소와 같으면 규칙이 바로
 * 발행하고, 이상하면 여기로 온다 — **회원에게는 아직 보이지 않는 상태**다.
 * 운영진이 판정 근거 숫자를 눈으로 확인하고 [발행] 또는 [폐기]를 고른다.
 */
export default function PendingDraftsSheet({
	ym,
	onClose,
}: {
	ym: string;
	onClose: () => void;
}) {
	const drafts = useDuesStore((s) => s.pendingDrafts);
	const members = useDuesStore((s) => s.members);
	const memberById = useMemo(() => new Map(members.map((m) => [m.id, m])), [members]);

	const [busy, setBusy] = useState(false);
	const [confirm, setConfirm] = useState<{ g: PendingDraftGroup; act: "issue" | "discard" } | null>(
		null,
	);

	async function run() {
		if (!confirm || busy) return;
		setBusy(true);
		const res =
			confirm.act === "issue"
				? await issueDrafts(confirm.g.group)
				: await discardDrafts(confirm.g.group);
		setBusy(false);
		setConfirm(null);
		if (!res.ok) {
			toast("처리에 실패했어요. 잠시 후 다시 시도해주세요.", { variant: "error" });
			return;
		}
		toast(
			"issued" in res
				? `${res.issued}명에게 부과했어요${res.skipped > 0 ? ` (${res.skipped}건은 이미 있어 건너뜀)` : ""}`
				: `${res.discarded}건 폐기했어요`,
			{ variant: "success" },
		);
		await duesActions.refreshMonth(ym);
	}

	return (
		<>
			<ModalSheet
				position="bottom"
				onClose={onClose}
				closeOnEscape
				title="발행 대기 부과"
				subtitle="회원에게는 아직 보이지 않아요. 확인하고 발행하세요."
			>
				<div className="flex flex-col gap-3 px-5 pb-6">
					{drafts.length === 0 && (
						<p className="text-faint" style={{ fontSize: 13, padding: "8px 0" }}>
							대기 중인 부과가 없어요.
						</p>
					)}
					{drafts.map((g) => {
						const d = g.holdDetail;
						return (
							<div
								key={g.group}
								className="bg-white dark:bg-[rgba(30,30,35,0.6)] border border-[rgba(0,0,0,0.08)] dark:border-[rgba(255,255,255,0.1)]"
								style={{ borderRadius: 12, padding: "11px 13px" }}
							>
								<div className="flex items-center gap-2">
									<b className="text-strong truncate" style={{ fontSize: 13.5, flex: 1, minWidth: 0 }}>
										{g.label}
									</b>
									<span
										style={{
											fontSize: 11,
											fontWeight: 800,
											color: "#c2670a",
											background: "rgba(194,103,10,0.12)",
											borderRadius: 6,
											padding: "2px 7px",
											flexShrink: 0,
										}}
									>
										확인 필요
									</span>
								</div>

								<p className="text-[#c2670a] mt-1" style={{ fontSize: 12.5, fontWeight: 700 }}>
									{HOLD_LABEL[g.holdReason] ?? g.holdReason}
								</p>
								<p className="text-faint" style={{ fontSize: 11.5, lineHeight: 1.5 }}>
									{HOLD_HINT[g.holdReason] ?? ""}
								</p>

								{/* 판정 근거 — 숫자를 그대로 보여준다. 운영진이 눈으로 이상함을 잡는 지점. */}
								<div
									className="bg-[rgba(0,0,0,0.03)] dark:bg-[rgba(255,255,255,0.05)] mt-2"
									style={{ borderRadius: 9, padding: "8px 10px", fontSize: 12 }}
								>
									<Row label="부과 인원" value={`${g.head}명`} />
									<Row label="인당 금액" value={won(g.perHead)} strong />
									<Row label="부과 합계" value={won(g.total)} />
									{d?.total != null && <Row label="대관 총액" value={won(d.total)} />}
									{d?.flat != null && <Row label="정액 기준" value={won(d.flat)} />}
									{/* 회비: 대상·지난달 인원이 판정 근거다(인원 급변을 눈으로 확인) */}
									{d?.target != null && <Row label="이번 달 대상" value={`${d.target}명`} />}
									{d?.prev_month != null && d.prev_month > 0 && (
										<Row label="지난달 발행" value={`${d.prev_month}명`} />
									)}
									{d?.already_issued != null && d.already_issued > 0 && (
										<Row label="이미 발행됨" value={`${d.already_issued}명`} />
									)}
								</div>

								{/* 명단 */}
								<div className="mt-2 flex flex-wrap gap-1">
									{g.members.map((m) => {
										const mem = memberById.get(m.memberId);
										return (
											<span
												key={m.memberId}
												className="text-muted"
												style={{
													fontSize: 11.5,
													fontWeight: 600,
													background: "rgba(120,120,128,0.1)",
													borderRadius: 6,
													padding: "2px 7px",
												}}
											>
												{nameWithBirthYear(mem?.name ?? "회원", mem?.birthYear ?? null)}
												{m.isDayCancel && <span className="text-[#c2670a]"> 당일취소</span>}
											</span>
										);
									})}
								</div>

								<div className="flex gap-2 mt-2.5">
									<button
										type="button"
										onClick={() => setConfirm({ g, act: "issue" })}
										disabled={busy}
										className="btn-solid-blue"
										style={{ flex: 1 }}
									>
										발행
									</button>
									<button
										type="button"
										onClick={() => setConfirm({ g, act: "discard" })}
										disabled={busy}
										className="btn-tint-neutral"
										style={{ flex: 1 }}
									>
										폐기
									</button>
								</div>
							</div>
						);
					})}
				</div>
			</ModalSheet>

			{confirm && (
				<ConfirmDialog
					zIndex={70}
					title={
						confirm.act === "issue"
							? `${confirm.g.head}명에게 ${won(confirm.g.perHead)} 부과할까요?`
							: "이 초안을 폐기할까요?"
					}
					message={
						confirm.act === "issue"
							? `총 ${won(confirm.g.total)}이 부과되고 회원의 미납 목록에 뜹니다.`
							: "부과하지 않고 초안만 지웁니다. 규칙이 다시 계산하면 또 대기로 올라올 수 있어요."
					}
					confirmLabel={confirm.act === "issue" ? "부과" : "폐기"}
					cancelLabel="닫기"
					tone={confirm.act === "issue" ? undefined : "danger"}
					busy={busy}
					busyLabel="처리 중…"
					onConfirm={run}
					onCancel={() => setConfirm(null)}
					onDismiss={() => setConfirm(null)}
				/>
			)}
		</>
	);
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
	return (
		<div className="flex items-baseline justify-between gap-2">
			<span className="text-faint">{label}</span>
			<span className={strong ? "text-strong" : "text-muted"} style={{ fontWeight: strong ? 800 : 600 }}>
				{value}
			</span>
		</div>
	);
}
