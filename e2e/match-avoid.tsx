import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import BoardToolbar from "../src/components/board/BoardToolbar";
import { useAppStore } from "../src/store/appStore";
import { useAuthStore } from "../src/store/authStore";
import { useSessionStore } from "../src/store/sessionStore";
import { useMatchAvoidStore } from "../src/store/matchAvoidStore";
import type { SessionPlayer } from "../src/types";
import "../src/index.css";

// Local fixture: the page's Supabase REST calls are answered by the spec (page.route).
// ?member: 일반 회원, ?operator: 목록 주인이 아닌 운영진. 기본은 목록 주인.
const query = new URLSearchParams(location.search);
const admin = !query.has("member"), owner = admin && !query.has("operator");
const players: SessionPlayer[] = ["지수", "현우", "수빈", "지훈", "서연"].map((name, i) => ({
	id: `p${i}`, playerId: `p${i}`, memberId: `m${i}`, name, gender: "M", skills: { grade: 5 }, status: "waiting", gameCount: 0,
	mixedCount: 0, waitSince: null, joinedAtMatch: 0, allowMixedSingle: false, cockChecked: true,
}));
players.push({ ...players[0], id: "guest", playerId: "guest", memberId: null, name: "게스트 민호" });
useAppStore.setState({ sessionMeta: null });
useAuthStore.setState({ isAdmin: admin });
useMatchAvoidStore.setState({ owner });
useSessionStore.setState({
	sessionPlayers: new Map(players.map(p => [p.id, p])), isEditor: admin, _clientId: null,
	courts: [{ id: 1, match: null }, { id: 2, match: null }],
});
Object.assign(window, { avoidTest: { avoid: useMatchAvoidStore } });
export type MatchAvoidTestApi = { avoid: typeof useMatchAvoidStore };
createRoot(document.getElementById("root")!).render(<StrictMode><MemoryRouter><BoardToolbar /></MemoryRouter></StrictMode>);
