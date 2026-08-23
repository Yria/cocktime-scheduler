import { CircleAlert } from "lucide-react";
import { useEffect, useMemo } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuthStore } from "../../store/authStore";
import { duesActions, useDuesStore } from "../../store/duesStore";
import ConfirmDialog from "../common/ConfirmDialog";
import { remaining, won } from "../admin/dues/duesText";
import AccountCopyRow from "./AccountCopyRow";
import { chargeLabel, selectUnpaid, unpaidSum } from "./myUnpaid";

/**
 * 미납 진입 알림 — 앱을 열었을 때 미납(회비·대관비)이 있으면 납부할 내역 + 입금 계좌를 띄운다.
 *
 * - 노출 조건: 로그인 회원 · 프로필 완성(ProfileSetup 모달과 겹치지 않게) · 미납 잔액 > 0 · 이번 실행에서 안 닫음.
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
	const dismissed = useDuesStore((s) => s.unpaidAlertDismissed);

	// 프로필 미완성이면 Home 이 ProfileSetup 모달을 띄우는 중 → 모달 겹침 방지(가입 직후엔 미납도 없음).
	const profileComplete =
		!!memberId && myGender != null && myBirthYear != null && !!myResidence;

	useEffect(() => {
		if (!memberId) {
			// 로그아웃/계정 전환: 이전 회원의 미납 스냅샷을 버린다.
			duesActions.resetUnpaidAlert();
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

	if (!profileComplete || dismissed || onMyDues || total <= 0) return null;

	// 제목은 실제 미납 종류에 맞춘다(대관비만 미납인 경우가 흔함).
	// 수동 부과(회식·공동구매 등)는 종류가 제각각이라 이름을 제목에 넣지 않고 '내역'으로 뭉갠다 —
	// 정확한 이름은 바로 아래 항목별 목록에 그대로 뜬다.
	const hasFee = unpaid.some((c) => c.kind === "monthly_fee");
	const hasCourt = unpaid.some((c) => c.kind === "court_fee");
	const hasManual = unpaid.some((c) => c.kind === "manual");
	const what = hasManual
		? "내역"
		: hasFee && hasCourt
			? "회비·대관비"
			: hasCourt
				? "대관비"
				: "회비";

	const close = () => duesActions.dismissUnpaidAlert();

	return (
		<ConfirmDialog
			title={
				<span className="flex items-center gap-1.5">
					<CircleAlert size={19} strokeWidth={2.4} className="text-[#d1362c]" />
					미납 {what}가 있어요
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
				아래 계좌로 입금해 주세요. 운영진이 통장 내역을 확인하면 이 안내는
				사라져요.
			</p>

			{/* 미납 내역 — 총액 + 항목별 */}
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

			{/* 입금 계좌 */}
			<div
				className="bg-[rgba(11,132,255,0.06)] border border-[rgba(11,132,255,0.22)]"
				style={{ borderRadius: 14, padding: "13px 14px", marginBottom: 20 }}
			>
				<p
					className="text-muted"
					style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}
				>
					입금 계좌
				</p>
				<AccountCopyRow account={account} />
			</div>
		</ConfirmDialog>
	);
}
