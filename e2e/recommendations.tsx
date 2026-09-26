import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import RecommendTeammateDialog from "../src/components/board/RecommendTeammateDialog";
import { useAppStore } from "../src/store/appStore";
import { useBoardStore } from "../src/store/boardStore";
import { useSessionStore } from "../src/store/sessionStore";
import { useMatchAvoidStore } from "../src/store/matchAvoidStore";
import type { SessionPlayer } from "../src/types";
import "../src/index.css";

// Local fixture: no subscription, session ID, backend writes, or member photos.
const seeded = new URLSearchParams(location.search).has("seed");
const avoiding = new URLSearchParams(location.search).has("avoid");
const players: SessionPlayer[] = Array.from({ length: 8 }, (_, i) => ({
	id: `p${i}`, playerId: `p${i}`, memberId: null, name: `${i < 4 ? "대기" : "경기중"}선수${i + 1}`,
	gender: "M", skills: { grade: i < 4 ? 3 : 9 }, status: i < 4 ? "waiting" : "playing",
	gameCount: i < 4 ? 4 : 0, mixedCount: 0, waitSince: null, joinedAtMatch: 0, allowMixedSingle: false, cockChecked: true,
}));
// ?avoid: 대기선수1·2는 운영진이 같이 매칭하지 않기로 묶은 사이(회원 id 연결).
if (avoiding) players.forEach((p, i) => { p.memberId = `m${i}`; });
useMatchAvoidStore.setState({ rules: avoiding ? [["m0", "m1"]] : [], rulesStatus: avoiding ? "ready" : "idle" });
useAppStore.setState({ sessionMeta: null });
useSessionStore.setState({
	sessionPlayers: new Map(players.map(p => [p.id, p])), isEditor: true, _clientId: null,
	cockCheckEnabled: true, groupHistory: [{ matchId: "repeat", members: ["p0", "p1", "p2", "p3"] }], lastGameType: {},
	courts: [{ id: 1, match: { id: "busy", courtId: 1, gameType: "남복", teamA: ["p4", "p5"], teamB: ["p6", "p7"], startedAt: new Date().toISOString() } }],
});
useBoardStore.setState({
	magnets: new Map(players.map((p, i) => [p.id, { playerId: p.id, teamId: null, x: 50 + i * 50, y: 100 }])),
	drafts: new Map(), reservations: new Map(), courtAnchors: new Map(), stageW: 900, stageH: 700, scale: 1,
});
Object.assign(window, { recommendationTest: { board: useBoardStore, session: useSessionStore } });
export type RecommendationTestApi = { board: typeof useBoardStore; session: typeof useSessionStore };
export default function Fixture() {
	const [open, setOpen] = useState(true);
	return open ? <RecommendTeammateDialog {...(seeded ? { seedId: "p0" } : { newTeam: true })} onClose={() => setOpen(false)} /> : <p>편성 완료</p>;
}
createRoot(document.getElementById("root")!).render(<StrictMode><Fixture /></StrictMode>);
