import { CircleAlert, CircleCheck } from "lucide-react";
import { useEffect, useMemo } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuthStore } from "../../store/authStore";
import { duesActions, useDuesStore } from "../../store/duesStore";
import {
	entryAlertActions,
	useEntryAlertSlot,
} from "../../store/entryAlertStore";
import ConfirmDialog from "../common/ConfirmDialog";
import { remaining, subjectJosa, won } from "../admin/dues/duesText";
import AccountCopyRow from "./AccountCopyRow";
import RefundPendingCard from "./RefundPendingCard";
import { chargeLabel, selectUnpaid, unpaidSum } from "./myUnpaid";

/**
 * 회비 진입 알림 — 앱을 열었을 때 **낼 돈**(미납)이나 **돌려받을 돈**(많이 보내 남은 잔돈)이 있으면 띄운다.
 *
 * 환불도 여기 얹는 이유: 남은 돈은 운영진의 정산함에만 보이고, 돌려주려면 회원의 계좌번호가 필요하다.
 * 회원이 [내 회비]를 스스로 열지 않으면 서로 알 방법이 없어 잔돈이 그대로 묶인다. 조회는 미납 확인과
 * 같은 1회 호출에 얹어 앱 진입 비용을 늘리지 않는다(checkUnpaidAlert).
 *
 * - 노출 조건: 로그인 회원 · 프로필 완성(ProfileSetup 모달과 겹치지 않게) · (미납 잔액 > 0 또는 돌려받을 돈 > 0) · 이번 실행에서 안 닫음.
 * - 다른 진입 알림과 **겹치지 않는다** — 진입 알림은 슬롯 하나를 나눠 쓰고(entryAlertStore) 이 알림이
 *   우선순위 첫째다. 닫으면 다음 알림(신규회원 안내 등)이 그 자리에 뜬다.
 * - `/my-dues` 에선 띄우지 않고 "봤음" 처리한다 — 그 화면이 같은 내용(미납 내역·계좌)을 이미 전면에
 *   보여주므로 모달이 정보를 더하지 않는다. 미납 푸시(`dues_unpaid`)가 이 경로로 딥링크되는 게 대표 경로.
 * - 정산되어 미납이 0이 되면 조건이 깨져 자연히 안 뜬다(별도 해제 처리 없음 — 부과 상태가 유일한 근거).
 * - 닫기는 이번 앱 실행에만 유효(localStorage 미사용) → 미납이 남아있는 동안 앱을 열 때마다 다시 뜬다.
 * - 보드(/session) 화면에선 App 이 언마운트해 경기 운영을 가리지 않는다.
 */
export default function UnpaidDuesAlert() {
	const navigate = useNavigate();
	const onMyDues = useLocation().pathname.startsWith("/my-dues");
	const memberId = useAuthStore((s) => s.memberId);
	const myGender = useAuthStore((s) => s.myGender);
	const myBirthYear = useAuthStore((s) => s.myBirthYear);
	const myResidence = useAuthStore((s) => s.myResidence);
	const charges = useDuesStore((s) => s.unpaidAlertCharges);
	const account = useDuesStore((s) => s.unpaidAlertAccount);
	const refunds = useDuesStore((s) => s.unpaidAlertRefunds);
	const dismissed = useDuesStore((s) => s.unpaidAlertDismissed);

	// 프로필 미완성이면 Home 이 ProfileSetup 모달을 띄우는 중 → 모달 겹침 방지(가입 직후엔 미납도 없음).
	const profileComplete =
		!!memberId && myGender != null && myBirthYear != null && !!myResidence;

	useEffect(() => {
		if (!memberId) {
			// 로그아웃/계정 전환: 이전 회원의 미납 스냅샷과 진입 알림 닫힘을 버린다.
			duesActions.resetUnpaidAlert();
			entryAlertActions.reset();
			return;
		}
		if (!profileComplete) return;
		void duesActions.checkUnpaidAlert(memberId);
	}, [memberId, profileComplete]);

	// 내 회비 화면을 열었으면 이번 실행에선 안내를 마친 것으로 본다(돌아왔을 때 다시 튀어나오지 않게).
	useEffect(() => {
		if (onMyDues) duesActions.dismissUnpaidAlert();
	}, [onMyDues]);

	const unpaid = useMemo(() => selectUnpaid(charges), [charges]);
	const total = unpaidSum(unpaid);
	const refundTotal = refunds.reduce((s, r) => s + r.left, 0);

	// 슬롯 요청 — 조건이 참이어도 앞선 알림이 떠 있으면 기다린다(여기선 우선순위 첫째라 바로 뜬다).
	const show = useEntryAlertSlot(
		"unpaidDues",
		profileComplete && !dismissed && !onMyDues && (total > 0 || refundTotal > 0),
	);
	if (!show) return null;

	// 제목은 실제 미납 종류에 맞춘다(대관비만 미납인 경우가 흔함).
	// 수동 부과는 **운영진이 붙인 이름을 그대로 쓴다** — '내역'으로 뭉개면 회원이 무슨 돈인지
	// 모른다(회식비인지 공동구매인지). 그 이름이 곧 설명이라 종류 이름보다 정보가 많다.
	const hasFee = unpaid.some((c) => c.kind === "monthly_fee");
	const hasCourt = unpaid.some((c) => c.kind === "court_fee");
	const names: string[] = [];
	if (hasFee) names.push("회비");
	if (hasCourt) names.push("대관비");
	for (const c of unpaid) {
		if (c.kind !== "manual") continue;
		const n = c.label?.trim();
		if (n && !names.includes(n)) names.push(n);
	}
	// 네 가지를 넘으면 제목이 줄바꿈되므로 둘만 적고 나머지는 개수로 뭉갠다(전체 이름은 아래 목록에 있다).
	const what =
		names.length === 0
			? "부과"
			: names.length <= 3
				? names.join("·")
				: `${names.slice(0, 2).join("·")} 외 ${names.length - 2}건`;

	const close = () => {
		duesActions.dismissUnpaidAlert();
		entryAlertActions.close("unpaidDues");
	};

	// 낼 돈이 있으면 그게 주제다(환불은 아래에 덧붙는다). 돌려받을 돈만 있으면 좋은 소식이라 아이콘·색이 다르다.
	const unpaidFirst = total > 0;

	return (
		<ConfirmDialog
			title={
				<span className="flex items-center gap-1.5">
					{unpaidFirst ? (
						<CircleAlert size={19} strokeWidth={2.4} className="text-[#d1362c]" />
					) : (
						<CircleCheck size={19} strokeWidth={2.4} className="text-[#1c8a3b]" />
					)}
					{unpaidFirst
						? `미납 ${what}${subjectJosa(what)} 있어요`
						: "돌려받을 돈이 있어요"}
				</span>
			}
			confirmLabel="내 회비 보기"
			cancelLabel="닫기"
			onConfirm={() => {
				close();
				navigate("/my-dues");
			}}
			onCancel={close}
			onDismiss={close}
		>
			<p
				className="text-muted"
				style={{ fontSize: 13.5, lineHeight: 1.55, margin: "2px 0 12px" }}
			>
				{unpaidFirst
					? "아래 계좌로 입금해 주세요. 운영진이 통장 내역을 확인하면 이 안내는 사라져요."
					: "낼 돈보다 많이 들어와 남은 돈이 있어요. 환불받을 계좌번호를 운영진에게 알려주세요."}
			</p>

			{/* 미납 내역 — 총액 + 항목별 */}
			{unpaidFirst && (
			<div
				className="bg-[rgba(255,59,48,0.07)] border border-[rgba(255,59,48,0.22)]"
				style={{ borderRadius: 14, padding: "13px 14px", marginBottom: 10 }}
			>
				<div className="flex items-baseline justify-between">
					<span
						className="text-muted"
						style={{ fontSize: 13, fontWeight: 600 }}
					>
						총 미납
					</span>
					<span
						className="text-[#d1362c]"
						style={{
							fontSize: 24,
							fontWeight: 800,
							fontVariantNumeric: "tabular-nums",
						}}
					>
						{won(total)}
					</span>
				</div>
				<div
					style={{
						borderTop: "1px solid rgba(255,59,48,0.16)",
						margin: "9px 0 7px",
					}}
				/>
				<div className="flex flex-col" style={{ gap: 3 }}>
					{unpaid.map((c) => (
						<div key={c.id} className="flex items-baseline justify-between gap-3">
							<span
								className="text-strong"
								style={{ fontSize: 13, fontWeight: 600 }}
							>
								{chargeLabel(c)}
							</span>
							<span
								className="text-muted"
								style={{
									fontSize: 13,
									fontWeight: 700,
									fontVariantNumeric: "tabular-nums",
									flexShrink: 0,
								}}
							>
								{won(remaining(c.amountDue, c.amountPaid))}
							</span>
						</div>
					))}
				</div>
			</div>
			)}

			{/* 돌려받을 돈 — 미납과 같은 화면에 둘 다 뜰 수 있다(낼 돈과 받을 돈은 다른 회차의 일). */}
			{refundTotal > 0 && (
				<div style={{ marginBottom: 10 }}>
					<RefundPendingCard rows={refunds} />
				</div>
			)}

			{/* 입금 계좌 — 낼 돈이 있을 때만(환불만 있으면 보낼 곳이 아니라 받을 계좌가 필요하다) */}
			{unpaidFirst && (
			<div
				className="bg-[rgba(11,132,255,0.06)] border border-[rgba(11,132,255,0.22)]"
				style={{ borderRadius: 14, padding: "13px 14px" }}
			>
				<p
					className="text-muted"
					style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}
				>
					입금 계좌
				</p>
				<AccountCopyRow account={account} />
			</div>
			)}
		</ConfirmDialog>
	);
}
