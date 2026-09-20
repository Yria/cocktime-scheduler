import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router-dom";
import Home from "../src/components/Home";
import SessionSetup from "../src/components/SessionSetup";
import BoardToolbar from "../src/components/board/BoardToolbar";
import Toaster from "../src/components/common/Toaster";
import { appActions, useAppStore } from "../src/store/appStore";
import { useAuthStore } from "../src/store/authStore";
import { useSessionStore } from "../src/store/sessionStore";
import "../src/index.css";

// The browser spec intercepts every backend request; these are test identities.
const params = new URLSearchParams(location.search);
const isAdmin = params.get("role") !== "member";
useAuthStore.setState({
	ready: true, memberLoaded: params.get("pending") !== "true", isAdmin,
	user: { id: "test-user" } as never, memberId: "test-member", myName: "테스트 회원",
	myGender: "M", myBirthYear: 1990, myResidence: "테스트 동네",
});
useAppStore.setState({
	sessionChecked: true,
	sessionMeta: { sessionId: 7, courtCount: 2, singleWomanIds: [], cockCheckEnabled: true, isScheduled: false },
	allPlayers: [], setupGuests: [],
});
useSessionStore.setState({ isEditor: isAdmin, courts: [], _clientId: null });

export function Fixture() {
	const navigate = useNavigate();
	return <div className="app-card-shell">
		<Routes>
			<Route path="/" element={<Home onStart={() => navigate("/setup")} />} />
			<Route path="/setup" element={<SessionSetup onStart={async (players, settings) => {
				if (await appActions.startOrUpdateSession(players, settings)) navigate("/session");
			}} />} />
			<Route path="/session" element={<div style={{ position: "relative", minHeight: 400 }}><BoardToolbar /></div>} />
		</Routes>
		<Toaster />
	</div>;
}

Object.assign(window, { sessionLifecycleTest: { app: useAppStore, auth: useAuthStore, actions: appActions } });
createRoot(document.getElementById("root")!).render(
	<MemoryRouter initialEntries={[params.get("path") ?? "/"]}><Fixture /></MemoryRouter>,
);
