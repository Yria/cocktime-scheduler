import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import DuesAdminPage from "../src/components/admin/dues/DuesAdminPage";
import MyDuesPage from "../src/components/dues/MyDuesPage";
import { useAuthStore } from "../src/store/authStore";
import { useDuesMode } from "../src/store/duesStore";
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
	const { mode, error } = useDuesMode();
	if (error) return <p role="alert">{error}</p>;
	if (!mode) return <p>Loading</p>;
	return (
		<Routes>
			<Route path="/" element={<p>홈</p>} />
			<Route path="/dues/:ym/:page?" element={<DuesAdminPage />} />
			<Route path="/my-dues/:page?" element={<MyDuesPage />} />
		</Routes>
	);
}
createRoot(document.getElementById("root")!).render(
	<MemoryRouter initialEntries={[query.get("path") ?? "/dues/2026-08"]}>
		<Fixture />
	</MemoryRouter>,
);
