import "./accounting.css";
import { useEffect, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { memberSummary } from "../../lib/dues/v2/summary";
import { purposeLabel } from "../../lib/dues/v2/types";
import { fetchClubAccount, type ClubAccount } from "../../lib/supabase/dues";
import { useAccountingData } from "../../store/accountingV2Store";
import { useAuthStore } from "../../store/authStore";
import {
	entryAlertActions,
	useEntryAlertSlot,
} from "../../store/entryAlertStore";
import {
	currentYm,
	publicLedgerMaxYm,
	shiftYm,
	won,
} from "../admin/dues/duesText";
import AppScreen from "../common/AppScreen";
import ConfirmDialog from "../common/ConfirmDialog";
import AccountCopyRow from "../dues/AccountCopyRow";
import CashLedgerView from "./CashLedgerView";

export default function AccountingMember() {
	const navigate = useNavigate();
	const params = useParams<{ page: string }>();
	const member = useAuthStore((s) => s.memberId)!;
	const { data, error, refresh } = useAccountingData();
	const [account, setAccount] = useState<ClubAccount | null>(null);
	const [ledgerYm, setLedgerYm] = useState(publicLedgerMaxYm());
	useEffect(() => {
		let disposed = false;
		void fetchClubAccount().then((a) => {
			if (!disposed) setAccount(a);
		});
		return () => {
			disposed = true;
		};
	}, [member]);
	const ym = currentYm();
	const summary = data ? memberSummary(data, member, ym) : null;
	const ledger = params.page === "ledger";
	return (
		<AppScreen
			contentClassName="accounting-screen"
			title="회비"
			onBack={() => navigate("/")}
			onRefresh={refresh}
		>
			<nav className="ac-tabs">
				<button
					type="button"
					aria-current={!ledger ? "page" : undefined}
					onClick={() => navigate("/my-dues")}
				>
					내 회비
				</button>
				<button
					type="button"
					aria-current={ledger ? "page" : undefined}
					onClick={() => navigate("/my-dues/ledger")}
				>
					클럽 회계
				</button>
			</nav>
			{error && (
				<p role="alert" className="text-red-600">
					{error}
				</p>
			)}
			{!data || !summary ? (
				<p className="text-muted">납부 내역을 불러오는 중…</p>
			) : ledger ? (
				<>
					<div className="flex items-center justify-center gap-5 my-4">
						<button
							type="button"
							aria-label="이전 달"
							disabled={ledgerYm <= "2026-07"}
							onClick={() => setLedgerYm(shiftYm(ledgerYm, -1))}
						>
							‹
						</button>
						<strong>{ledgerYm}</strong>
						<button
							type="button"
							aria-label="다음 달"
							disabled={ledgerYm >= publicLedgerMaxYm()}
							onClick={() => setLedgerYm(shiftYm(ledgerYm, 1))}
						>
							›
						</button>
					</div>
					<CashLedgerView ym={ledgerYm} revision={data.mode.revision} />
				</>
			) : (
				<div className="ac-member-details flex flex-col gap-4">
					<section className="ac-card ac-member-summary">
						<h2 className="text-sm font-semibold">이번에 낼 돈</h2>
						<p className="text-2xl font-bold my-2">{won(summary.toPay)}</p>
						<p className="text-xs text-muted">
							납기 도래 미납 {won(summary.outstanding)}
							{summary.availableCarry > 0 &&
								` − 이월 입금 사용 예정 ${won(Math.min(summary.outstanding, summary.availableCarry))}`}
						</p>
						{summary.availableCarry > 0 && (
							<p className="text-xs text-muted mt-2">
								이월 입금의 자동 사용을 기다리고 있어요. 적용되면 아래 납부
								내역에도 반영됩니다.
							</p>
						)}
						{summary.proxyDue > 0 && (
							<p className="mt-2 text-sm">
								게스트 대납 안내 {won(summary.proxyDue)} · 본인 금액과 별도
							</p>
						)}
					</section>
					<AccountCopyRow account={account} />
					{(summary.futureDue > 0 || summary.futureCash > 0) && (
						<section className="rounded-xl border border-black/10 dark:border-white/15 p-3 text-sm">
							<h2 className="font-semibold mb-2">다음 정산</h2>
							<p>
								앞으로 낼 돈 {won(summary.futureDue)} · 이미 낸 돈{" "}
								{won(summary.futureCash)}
							</p>
						</section>
					)}
					{summary.pending > 0 && (
						<p className="rounded-xl bg-blue-50 dark:bg-blue-950 p-3 text-sm">
							사용할 곳을 정하지 않은 회원 잔액 {won(summary.pending)}이 있어요.
							운영진에게 이월 또는 환불을 요청해 주세요.
						</p>
					)}
					{summary.refundPending > 0 && (
						<p className="rounded-xl bg-amber-50 dark:bg-amber-950 p-3 text-sm">
							환불 대기 {won(summary.refundPending)} · 아직 실제 출금에 연결되지
							않았어요.
						</p>
					)}
					<section>
						<h2 className="font-semibold text-sm mb-2">낼 돈의 근거</h2>
						{data.charges
							.filter(
								(c) =>
									c.state === "live" &&
									(c.member_id === member || c.payer_hint === member),
							)
							.map((c) => {
								const ds = data.due
									.filter((d) => d.charge_id === c.id && d.remaining > 0)
									.sort((a, b) => a.due_ym.localeCompare(b.due_ym));
								return ds.length ? (
									<div
										key={c.id}
										className="border-b border-black/10 dark:border-white/10 py-3 text-sm"
									>
										<p>
											{data.groups.find((g) => g.id === c.group_id)?.label}
											{c.member_id !== member &&
												` · ${data.members.find((m) => m.id === c.member_id)?.name ?? "게스트"} 대납 안내`}
										</p>
										{ds.map((d) => (
											<p key={d.id} className="text-muted">
												{d.due_ym} 납기 · {won(d.remaining)}
												{d.due_ym > ym ? " (납기 전)" : ""}
											</p>
										))}
									</div>
								) : null;
							})}
					</section>
					<section>
						<h2 className="font-semibold text-sm mb-2">입금 잔액·이월</h2>
						{data.positions
							.filter((p) => p.owner_id === member && p.purpose !== "club")
							.map((p) => (
								<div
									className="text-sm border-b border-black/10 dark:border-white/10 py-2"
									key={p.id}
								>
									<p>
										{purposeLabel[p.purpose]} · {won(p.amount)}
										{p.available_ym && ` · ${p.available_ym}부터 사용`}
									</p>
									<p className="text-xs text-muted">
										원입금{" "}
										{data.bank.find((t) => t.id === p.bank_tx_id)?.occurred_at
											? new Date(
													data.bank.find((t) => t.id === p.bank_tx_id)!
														.occurred_at,
												).toLocaleDateString("ko-KR", {
													timeZone: "Asia/Seoul",
												})
											: `#${p.bank_tx_id}`}
									</p>
								</div>
							))}
					</section>
					<section>
						<h2 className="font-semibold text-sm mb-2">납부·사용·해제 이력</h2>
						{[...data.allocations]
							.sort((a, b) => b.created_at.localeCompare(a.created_at))
							.map((a) => {
								const c = data.charges.find((c) => c.id === a.charge_id),
									bank = data.bank.find((t) => t.id === a.bank_tx_id);
								return (
									<div
										key={a.id}
										className="text-sm border-b border-black/10 dark:border-white/10 py-3"
									>
										<p>
											{data.groups.find((g) => g.id === c?.group_id)?.label} ·
											사용 {won(a.amount)}
											{a.reversed > 0 && ` / 해제 ${won(a.reversed)}`}
										</p>
										<p className="text-xs text-muted">
											{bank
												? `${new Date(bank.occurred_at).toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul" })} 원입금에서 사용`
												: `${new Date(a.created_at).toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul" })} 납부 처리`}
											{c?.state === "cancelled" && " · 부과 취소"}
											{c?.previous_id && " · 취소 후 새 발행"}
										</p>
									</div>
								);
							})}
					</section>
					{data.refunds.length > 0 && (
						<section>
							<h2 className="font-semibold text-sm mb-2">환불 완료</h2>
							{data.refunds.map((r) => (
								<p key={r.out_tx_id} className="text-sm py-2">
									{won(r.amount)} · 원입금 #{r.in_tx_id} → 환불 출금 #
									{r.out_tx_id}
								</p>
							))}
						</section>
					)}
				</div>
			)}
		</AppScreen>
	);
}

export function AccountingEntryAlert() {
	const navigate = useNavigate();
	const onMyDues = useLocation().pathname.startsWith("/my-dues");
	const member = useAuthStore((s) => s.memberId);
	const complete = useAuthStore(
		(s) => s.myGender != null && s.myBirthYear != null && !!s.myResidence,
	);
	const { data } = useAccountingData();
	const summary =
		data && member ? memberSummary(data, member, currentYm()) : null;
	const show = useEntryAlertSlot(
		"unpaidDues",
		!!summary &&
			complete &&
			!onMyDues &&
			(summary.toPay + summary.proxyDue > 0 ||
				summary.pending > 0 ||
				summary.refundPending > 0),
	);
	const close = () => entryAlertActions.close("unpaidDues");
	useEffect(() => {
		if (onMyDues) entryAlertActions.close("unpaidDues");
	}, [onMyDues]);
	if (!show || !summary) return null;
	return (
		<ConfirmDialog
			title="회비 정산 내역을 확인해 주세요"
			confirmLabel="내 회비 보기"
			cancelLabel="닫기"
			onCancel={close}
			onDismiss={close}
			onConfirm={() => {
				close();
				navigate("/my-dues");
			}}
		>
			<p className="text-sm">
				이번에 낼 돈 {won(summary.toPay)}
				{summary.proxyDue > 0 && ` · 게스트 대납 안내 ${won(summary.proxyDue)}`}
			</p>
			{summary.pending > 0 && (
				<p className="text-sm mt-2">
					사용처를 정할 잔액 {won(summary.pending)}
				</p>
			)}
			{summary.refundPending > 0 && (
				<p className="text-sm mt-2">환불 대기 {won(summary.refundPending)}</p>
			)}
		</ConfirmDialog>
	);
}
