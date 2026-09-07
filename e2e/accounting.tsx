import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import AccountingAdmin from "../src/components/accounting/AccountingAdmin";
import AccountingMember from "../src/components/accounting/AccountingMember";
import AccountingControls from "../src/components/accounting/AccountingControls";
import { useAuthStore } from "../src/store/authStore";
import { useAccountingMode } from "../src/store/accountingV2Store";
import "../src/index.css";

// All non-local traffic is intercepted by accounting.spec.ts. No auth/session effects mount.
const query = new URLSearchParams(location.search);
const member = query.get("member") ?? "00000000-0000-4000-8000-000000000004";
useAuthStore.setState({
	memberId: member,
	isAdmin: !query.has("member"),
	ready: true,
	memberLoaded: true,
});
export function Fixture() {
	const { mode, error } = useAccountingMode();
	if (error) return <p role="alert">{error}</p>;
	if (!mode) return <p>Loading</p>;
	if (!mode.enabled)
		return (
			<>
				<p>기존 부과 사용 중</p>
				<AccountingControls mode={mode} />
			</>
		);
	return (
		<Routes>
			<Route path="/dues/:ym/:page?" element={<AccountingAdmin />} />
			<Route path="/my-dues/:page?" element={<AccountingMember />} />
		</Routes>
	);
}
createRoot(document.getElementById("root")!).render(
	<MemoryRouter initialEntries={[query.get("path") ?? "/dues/2026-08"]}>
		<Fixture />
	</MemoryRouter>,
);
