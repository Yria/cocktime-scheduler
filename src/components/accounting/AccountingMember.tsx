import "./accounting.css";
// 공용 원장 뷰(`CashLedgerView`)의 열·간격 규칙이 이 파일에 있다 — 회원 화면도 운영진과
// 같은 기하로 그려야 한다.
import "./accounting-layout.css";
// 홈 톤 스킨 — 반드시 accounting-layout.css **뒤**(동률 특정도 다수가 소스 순서로
// 갈린다). 회원 화면도 `.ac-layout-v2` 를 붙여 운영진 `/dues` 와 같은 톤으로 그린다.
import "./accounting-home.css";
import { useEffect, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import {
	currentYm,
	publicLedgerMaxYm,
	SERVICE_START_YM,
	shiftYm,
	subjectJosa,
	won,
	ymLabel,
} from "../../lib/dues/duesText";
import {
	type MyDuesItem,
	myDuesMonth,
	myDuesMonths,
	myDuesUnpaid,
} from "../../lib/dues/myDues";
import { memberSummary } from "../../lib/dues/summary";
import { fetchClubAccount, type ClubAccount } from "../../lib/supabase/duesSettings";
import { useAuthStore } from "../../store/authStore";
import { useDuesData } from "../../store/duesStore";
import {
	entryAlertActions,
	useEntryAlertSlot,
} from "../../store/entryAlertStore";
import AppScreen from "../common/AppScreen";
import ConfirmDialog from "../common/ConfirmDialog";
import AccountCard from "../dues/AccountCard";
import CashLedgerView from "./CashLedgerView";

/** 레일 금액은 '단위: 원' 머리글과 함께 숫자만 쓴다(운영진 회계 시트와 같은 규약). */
const num = (n: number) => n.toLocaleString("ko-KR");

/** 미납 목록을 한 줄 보조 문구로 — 한 건이면 이름, 여러 건이면 '외 N건'. */
function itemsNote(items: MyDuesItem[], now: string): string {
	if (!items.length) return "";
	const head = items[0];
	const deferred = head.dueYm > now ? " · 납기 이월" : "";
	return items.length === 1
		? `${head.label}${deferred}`
		: `${head.label} 외 ${items.length - 1}건`;
}

export default function AccountingMember() {
	const navigate = useNavigate();
	const params = useParams<{ page: string }>();
	const member = useAuthStore((s) => s.memberId)!;
	const { data, error, refresh } = useDuesData();
	const [account, setAccount] = useState<ClubAccount | null>(null);
	const now = currentYm();
	// 두 탭의 달은 서로 다른 규칙을 따른다 — 내 회비는 이번 달까지, 클럽 회계는
	// 지난달까지(당월은 정산 중이라 비공개). 그래서 달을 각각 기억한다.
	const [mineYm, setMineYm] = useState(now);
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

	const ledger = params.page === "ledger";
	const month = data ? myDuesMonth(data, member, mineYm) : null;
	// '지금 낼 돈'은 달과 무관하다 — 카드가 달 단위여도 이 숫자는 오늘 기준으로 센다.
	const today = data ? memberSummary(data, member, now) : null;
	const unpaid = data ? myDuesUnpaid(data, member, now) : [];
	const months = data ? myDuesMonths(data, member) : [];
	const mineMin = months.length && months[0] < now ? months[0] : now;

	const ym = ledger ? ledgerYm : mineYm;
	const canPrev = ledger ? ledgerYm > SERVICE_START_YM : mineYm > mineMin;
	const canNext = ledger ? ledgerYm < publicLedgerMaxYm() : mineYm < now;
	const step = (delta: number) =>
		ledger
			? setLedgerYm(shiftYm(ledgerYm, delta))
			: setMineYm(shiftYm(mineYm, delta));
	const label = Number(mineYm.slice(5));
	// 미터는 히어로에 쓴 '낸 돈'을 그대로 그린다(서버 불변식상 부과−남은 금액과 같다).
	const percent = month ? Math.min(100, Math.round(month.ratio * 100)) : 0;
	// 알림 문장의 주어 — 조사는 마지막 낱말에 붙는다('회비가' / '2건이' / '2,000원이').
	const unpaidNames = !unpaid.length
		? ""
		: unpaid.length === 1
			? unpaid[0].label
			: `${unpaid[0].label} 외 ${unpaid.length - 1}건`;

	return (
		<AppScreen
			contentClassName="accounting-screen ac-layout-v2 ac-mine-page"
			title="회비"
			onBack={() => navigate("/")}
			onRefresh={refresh}
		>
			<div className="ac-month">
				<button
					type="button"
					aria-label="이전 달"
					disabled={!canPrev}
					onClick={() => step(-1)}
				>
					‹
				</button>
				<strong>{ymLabel(ym)}</strong>
				<button
					type="button"
					aria-label="다음 달"
					disabled={!canNext}
					onClick={() => step(1)}
				>
					›
				</button>
			</div>
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
				<p role="alert" className="ac-notice is-stop">
					{error}
				</p>
			)}
			{!data || !month || !today ? (
				<p className="ac-caption">납부 내역을 불러오는 중…</p>
			) : ledger ? (
				<div className="ac-mine-ledger">
					<CashLedgerView ym={ledgerYm} revision={data.mode.revision} />
					<p className="ac-row-note ac-mine-note">
						회원 화면에서는 항목별 합계까지만 보입니다. 개별 거래와 다른 회원의
						납부 상태는 총무만 볼 수 있습니다.
					</p>
				</div>
			) : (
				<>
					<section className="ac-card ac-mine-card" aria-label="회비 납부 현황">
						<div className="ac-sheet-head">
							<h2>{label}월에 낸 회비</h2>
							<span>단위: 원</span>
						</div>
						{month.empty ? (
							<p className="ac-empty">이 달에는 부과도 납부도 없습니다.</p>
						) : (
							<>
								<p className="ac-mine-hero">
									<span className="ac-number">{num(month.paid)}</span>
									<span>/ 부과 {num(month.charged)}</span>
								</p>
								<div
									className="ac-meter"
									role="progressbar"
									aria-label={`${label}월 부과 납부율`}
									aria-valuemin={0}
									aria-valuemax={100}
									aria-valuenow={percent}
								>
									<span style={{ width: `${percent}%` }} />
								</div>
								{month.lines.map((line) => (
									<div className="ac-row" key={line.key}>
										<span className="ac-row-body">
											<strong>{line.label}</strong>
											<span className="ac-row-note">{line.note}</span>
										</span>
										<strong className="ac-amount">{num(line.paid)}</strong>
									</div>
								))}
								{/* 이중선(`.ac-total`)을 쓰지 않는다 — 이 줄은 위 줄들의 합이
								    아니라 남은 돈이다. 위 줄들의 합은 히어로의 '낸 돈'이다. */}
								<div className="ac-row ac-mine-rest">
									<span className="ac-row-body">
										<strong>남은 금액</strong>
										{month.unpaid.length > 0 && (
											<span className="ac-row-note">
												{itemsNote(month.unpaid, now)}
											</span>
										)}
									</span>
									<strong
										className={`ac-amount${month.remaining > 0 ? " ac-mine-due" : ""}`}
									>
										{num(month.remaining)}
									</strong>
								</div>
							</>
						)}
					</section>

					{today.toPay > 0 && (
						/* 카드의 '남은 금액'은 그 달, 이 알림은 달을 넘는 오늘 기준이다.
						   두 수가 다를 수 있으므로 라벨로 무엇의 합인지 먼저 말한다. */
						<p className="ac-notice is-ask">
							<span aria-hidden="true">?</span>
							<span>
								<strong>지금 낼 돈 {won(today.toPay)}</strong>
								{unpaidNames && ` — ${unpaidNames}`}
								{subjectJosa(unpaidNames || won(today.toPay))} 아직 확인되지
								않았습니다. 아래 계좌로 입금하면 총무가 대조합니다.
								{today.availableCarry > 0 &&
									` 이월 입금 ${won(Math.min(today.outstanding, today.availableCarry))}은 자동으로 먼저 사용됩니다.`}
							</span>
						</p>
					)}
					{month.proxy.remaining > 0 && (
						<p className="ac-notice is-ask">
							<span aria-hidden="true">?</span>
							<span>
								{month.proxy.names.join(" · ")} 대납 안내{" "}
								{won(month.proxy.remaining)} · 본인 금액과 별도입니다.
							</span>
						</p>
					)}
					{today.pending > 0 && (
						<p className="ac-notice is-ask">
							<span aria-hidden="true">?</span>
							<span>
								사용할 곳을 정하지 않은 회원 잔액 {won(today.pending)}이 있어요.
								운영진에게 이월 또는 환불을 요청해 주세요.
							</span>
						</p>
					)}
					{today.refundPending > 0 && (
						<p className="ac-notice is-ask">
							<span aria-hidden="true">?</span>
							<span>
								환불 대기 {won(today.refundPending)} · 아직 실제 출금에 연결되지
								않았어요.
							</span>
						</p>
					)}

					<AccountCard account={account} />

					{month.payments.length > 0 && (
						<section className="ac-sheet ac-mine-list" aria-label="납부 내역">
							<div className="ac-sheet-head">
								{/* 이 달 '부과'의 납부 내역이라 입금일은 다른 달일 수 있다
								    (선납·후납). 그래서 '이번 달'이 아니라 달을 밝힌다. */}
								<h2>{label}월 납부 내역</h2>
								<span>{month.payments.length}건 · 원</span>
							</div>
							<div>
								{month.payments.map((pay) => (
									<div className="ac-row" key={pay.key}>
										<span className="ac-row-body">
											<strong>{pay.date}</strong>
											<span className="ac-row-note">{pay.targets}</span>
											<span className="ac-row-state is-ok">
												<span aria-hidden="true">✓</span> 확인됨
											</span>
										</span>
										<strong className="ac-amount">{num(pay.amount)}</strong>
									</div>
								))}
								{/* 줄이 하나면 합계를 쓰지 않는다 — 같은 수가 바로 위에
								    또 있으면 합계가 고장 난 것처럼 읽힌다. */}
								{month.payments.length > 1 && (
									<div className="ac-row ac-total">
										<span className="ac-row-body">
											<strong>합계</strong>
										</span>
										<strong className="ac-amount">{num(month.paid)}</strong>
									</div>
								)}
							</div>
						</section>
					)}

					{month.refunds.length > 0 && (
						<section className="ac-sheet ac-mine-list" aria-label="환불">
							<div className="ac-sheet-head">
								<h2>환불</h2>
								<span>{month.refunds.length}건 · 원</span>
							</div>
							<div>
								{month.refunds.map((r) => (
									<div className="ac-row" key={r.key}>
										<span className="ac-row-body">
											<strong>{r.date}</strong>
											<span className="ac-row-state is-ok">
												<span aria-hidden="true">✓</span> 출금 완료
											</span>
										</span>
										<strong className="ac-amount">{num(r.amount)}</strong>
									</div>
								))}
							</div>
						</section>
					)}

					{(today.futureDue > 0 || today.futureCash > 0) && (
						<section className="ac-card ac-mine-card" aria-label="다음 정산">
							<div className="ac-sheet-head">
								<h2>다음 정산</h2>
								<span>납기 전</span>
							</div>
							<p className="ac-row-note ac-mine-note">
								앞으로 낼 돈 {won(today.futureDue)} · 이미 낸 돈{" "}
								{won(today.futureCash)}
							</p>
						</section>
					)}
				</>
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
	const { data } = useDuesData();
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
			<p className="ac-caption">
				이번에 낼 돈 {won(summary.toPay)}
				{summary.proxyDue > 0 && ` · 게스트 대납 안내 ${won(summary.proxyDue)}`}
			</p>
			{summary.pending > 0 && (
				<p className="ac-caption">
					사용처를 정할 잔액 {won(summary.pending)}
				</p>
			)}
			{summary.refundPending > 0 && (
				<p className="ac-caption">환불 대기 {won(summary.refundPending)}</p>
			)}
		</ConfirmDialog>
	);
}
