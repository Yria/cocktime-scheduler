import { useAuthStore } from "../../store/authStore";
import { duesActions, useDuesMode } from "../../store/duesStore";
import AccountingMember from "../accounting/AccountingMember";
import EmptyState from "../shared/EmptyState";

/**
 * 회비 · 클럽 회계 탭 — AccountingMember 본문을 그대로 빌려 쓴다(embedded).
 *
 * 회계 모드 확인(useDuesMode)은 **이 탭이 떠 있을 때만** 한다 — 그 훅은 마운트 동안 15초 폴링을 돌리므로
 * 기록 탭에서까지 돌릴 이유가 없다. 회계가 꺼져 있거나 확인이 안 되면 예전처럼 화면 전체를 막지 않고
 * 이 탭 자리에만 조용히 안내한다(기록·정보 수정 탭은 회계와 무관하다).
 */
export default function DuesTab({ page }: { page: "mine" | "ledger" }) {
	const { mode, error } = useDuesMode();
	const member = useAuthStore((s) => s.memberId);

	// 서버는 회계가 꺼져 있으면 dues_mode 를 '확인 불가' 예외로 돌려준다(accountingMode) —
	// 그래서 '꺼짐'과 '조회 실패'가 같은 error 로 온다. 둘 다 회원이 할 수 있는 건 기다렸다 다시 보는 것뿐이라 한 문장으로 안내한다.
	if (error || mode?.enabled === false) {
		return (
			<div className="me-notice">
				<strong>지금은 회비 내역을 볼 수 없어요</strong>
				회계를 정리하는 중이거나 아직 열리지 않았어요. 열리면 이 탭에서 바로 볼 수 있어요.
				<div style={{ marginTop: 12 }}>
					<button
						type="button"
						className="btn-lq-secondary"
						style={{ padding: "8px 18px" }}
						onClick={() => void duesActions.mode()}
					>
						다시 확인
					</button>
				</div>
			</div>
		);
	}
	if (!mode || !member) return <EmptyState loading style={{ padding: "40px 0" }} />;
	return <AccountingMember key={member} embedded page={page} />;
}
