import { Navigate } from "react-router-dom";
import { useAuthStore } from "../../store/authStore";
import { duesActions, useDuesMode } from "../../store/duesStore";
import AccountingMember from "../accounting/AccountingMember";
import AppScreen from "../common/AppScreen";

export default function MyDuesPage() {
	const { mode, error } = useDuesMode();
	const ready = useAuthStore((s) => s.ready && s.memberLoaded);
	const member = useAuthStore((s) => s.memberId);
	if (!ready) return null;
	if (!member) return <Navigate to="/" replace />;
	if (error)
		return (
			<AppScreen title="회비" onRefresh={duesActions.mode}>
				<p role="alert">{error}</p>
				<button
					type="button"
					className="btn-lq-secondary"
					onClick={() => void duesActions.mode()}
				>
					다시 확인
				</button>
			</AppScreen>
		);
	if (!mode?.enabled)
		return (
			<AppScreen title="회비">
				<p className="text-muted">회계 상태를 확인하는 중…</p>
			</AppScreen>
		);
	return <AccountingMember key={member} />;
}
