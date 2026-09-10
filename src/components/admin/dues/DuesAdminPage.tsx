import { Navigate } from "react-router-dom";
import { useAuthStore } from "../../../store/authStore";
import { duesActions, useDuesMode } from "../../../store/duesStore";
import AccountingAdmin from "../../accounting/AccountingAdmin";
import AppScreen from "../../common/AppScreen";

export default function DuesAdminPage() {
	const { mode, error } = useDuesMode();
	const ready = useAuthStore((s) => s.ready && s.memberLoaded);
	const admin = useAuthStore((s) => s.isAdmin);
	if (!ready) return null;
	if (!admin) return <Navigate to="/" replace />;
	if (error)
		return (
			<AppScreen title="회비 관리" onRefresh={duesActions.mode}>
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
			<AppScreen title="회비 관리">
				<p className="text-muted">회계 상태를 확인하는 중…</p>
			</AppScreen>
		);
	return <AccountingAdmin />;
}
