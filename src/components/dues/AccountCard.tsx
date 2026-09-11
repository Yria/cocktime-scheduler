import { useEffect, useRef, useState } from "react";
import type { ClubAccount } from "../../lib/supabase/duesSettings";
import { toast } from "../../store/toastStore";

/**
 * 클럽 입금 계좌 카드 (Claude Design 3a '입금 계좌'). 번호가 주인공이고 복사가 바로
 * 옆에 붙는다. 계좌 전체번호는 로그인 회원 전용(`dues_club_account`) — 이 컴포넌트는
 * 이미 받은 값만 그린다. 예금주 뒤의 클럽 이름은 계좌 payload 에 없어 넣지 않는다.
 */
export default function AccountCard({
	account,
}: {
	account: ClubAccount | null;
}) {
	const [copied, setCopied] = useState(false);
	const timer = useRef<number | undefined>(undefined);
	useEffect(() => () => window.clearTimeout(timer.current), []);

	const copy = async () => {
		const num = account?.account?.replace(/\s/g, "");
		if (!num) return;
		try {
			await navigator.clipboard.writeText(num);
			setCopied(true);
			window.clearTimeout(timer.current);
			timer.current = window.setTimeout(() => setCopied(false), 2000);
		} catch {
			// iOS PWA·비보안 컨텍스트에서는 클립보드가 막힌다 — 손으로 복사하는 길을 말해 준다.
			toast("복사가 안 돼요 — 번호를 길게 눌러 복사하세요", { variant: "error" });
		}
	};

	if (!account?.account)
		return (
			<p className="ac-notice is-ask">
				<span aria-hidden="true">?</span>
				<span>입금 계좌가 아직 등록되지 않았어요. 운영진에게 문의하세요.</span>
			</p>
		);

	return (
		<section className="ac-card ac-mine-card" aria-label="입금 계좌">
			<div className="ac-sheet-head">
				<h2>입금 계좌</h2>
				{account.bankName && <span>{account.bankName}</span>}
			</div>
			<div className="ac-account-line">
				<div>
					<div className="ac-number ac-account-number">{account.account}</div>
					{account.accountHolder && (
						<div className="ac-row-note">예금주 {account.accountHolder}</div>
					)}
				</div>
				<button
					type="button"
					className={`ac-account-copy${copied ? " is-done" : ""}`}
					aria-label="계좌번호 복사"
					onClick={copy}
				>
					{copied ? "복사됨" : "복사"}
				</button>
			</div>
			<p className="sr-only" role="status">
				{copied ? "계좌번호를 복사했어요" : ""}
			</p>
			<div className="ac-band" />
			<p className="ac-row-note ac-mine-note">
				입금자명은 <b>본인 이름</b>으로 남겨 주세요. 이름이 다르면 총무가 직접
				대조해야 해서 반영이 늦어집니다.
			</p>
		</section>
	);
}
