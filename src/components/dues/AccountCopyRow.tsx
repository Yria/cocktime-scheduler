import { Copy } from "lucide-react";
import type { ClubAccount } from "../../lib/supabase/dues";
import { toast } from "../../store/toastStore";

/**
 * 클럽 입금 계좌 한 줄(은행 계좌번호 + 복사 버튼 + 예금주). 내 회비 탭과 미납 알림이 공유.
 * 계좌 전체번호는 로그인 회원 전용(dues_club_account) — 이 컴포넌트는 이미 받은 값만 그린다.
 */
export default function AccountCopyRow({
	account,
}: {
	account: ClubAccount | null;
}) {
	const copyAccount = async () => {
		const num = account?.account?.replace(/\s/g, "");
		if (!num) return;
		try {
			await navigator.clipboard.writeText(num);
			toast("계좌번호를 복사했어요", { variant: "success" });
		} catch {
			toast("복사가 안 돼요 — 번호를 길게 눌러 복사하세요", { variant: "error" });
		}
	};

	if (!account?.account)
		return (
			<p className="text-faint" style={{ fontSize: 13 }}>
				입금 계좌가 아직 등록되지 않았어요. 운영진에게 문의하세요.
			</p>
		);

	return (
		<>
			<div className="flex items-center gap-2">
				<span
					className="text-strong"
					style={{ fontSize: 16, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}
				>
					{account.bankName ? `${account.bankName} ` : ""}
					{account.account}
				</span>
				<button
					type="button"
					onClick={copyAccount}
					aria-label="계좌번호 복사"
					className="text-[#0b84ff] flex items-center gap-1"
					style={{
						marginLeft: "auto",
						fontSize: 12.5,
						fontWeight: 700,
						border: "1px solid #0b84ff",
						background: "transparent",
						borderRadius: 8,
						padding: "4px 10px",
						cursor: "pointer",
						flexShrink: 0,
					}}
				>
					<Copy size={13} strokeWidth={2.2} /> 복사
				</button>
			</div>
			{account.accountHolder && (
				<p className="text-muted" style={{ fontSize: 13, marginTop: 4 }}>
					예금주 {account.accountHolder}
				</p>
			)}
		</>
	);
}
