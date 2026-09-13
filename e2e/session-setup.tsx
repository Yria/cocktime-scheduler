import { useState } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import SessionSetup from "../src/components/SessionSetup";
import { updateSession } from "../src/lib/supabase/session";
import { useAppStore } from "../src/store/appStore";
import { useAuthStore } from "../src/store/authStore";
import "../src/index.css";

// Requests are intercepted by session-setup.spec.ts; no production writes.
useAuthStore.setState({ ready: true, memberLoaded: true, isAdmin: true });
useAppStore.setState({
	allPlayers: ["박민준", "이서연", "최지훈"].map((name, i) => ({
		id: `00000000-0000-4000-8000-00000000000${i + 1}`,
		name,
		gender: "M",
		skills: { grade: 5 },
	})),
	sessionMeta: null,
	setupGuests: [],
});
export function Fixture() {
	const [done, setDone] = useState(false);
	if (done) return <p>저장 완료</p>;
	return (
		<SessionSetup
			onStart={async (players, settings) => {
				const ok = await updateSession(
					1,
					settings.courtCount,
					players,
					settings.singleWomanIds,
					settings.cockCheckEnabled,
				);
				if (!ok) throw new Error("세션 설정을 저장하지 못했습니다.");
				setDone(true);
			}}
		/>
	);
}
createRoot(document.getElementById("root")!).render(
	<MemoryRouter>
		<Fixture />
	</MemoryRouter>,
);
