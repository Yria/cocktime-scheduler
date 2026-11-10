import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import DuesAdminPage from "../src/components/admin/dues/DuesAdminPage";
import MyDuesPage from "../src/components/dues/MyDuesPage";
import MyPage from "../src/components/me/MyPage";
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
			{/* /my-dues 는 이제 /me/dues 로 넘겨주는 리다이렉트라 실제 화면은 /me 탭이다. 점수 RPC 는 spec 이 abort 하고 fetchMyRating 은 null 로 견딘다. */}
			<Route path="/my-dues/:page?" element={<MyDuesPage />} />
			<Route path="/me/:tab?" element={<MyPage />} />
		</Routes>
	);
}
createRoot(document.getElementById("root")!).render(
	<MemoryRouter initialEntries={[query.get("path") ?? "/dues/2026-08"]}>
		<Fixture />
	</MemoryRouter>,
);
