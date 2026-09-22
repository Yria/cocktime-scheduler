import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import SessionBoardRenderer from "../src/components/board/SessionBoardRenderer";
import MatchEditModal from "../src/components/board/MatchEditModal";
import { useAppStore } from "../src/store/appStore";
import { useBoardStore } from "../src/store/boardStore";
import { useSessionStore } from "../src/store/sessionStore";
import type { SessionPlayer } from "../src/types";
import "../src/index.css";

// Actual canvas and modal, with local data and no session subscriptions or writes.
const scale = new URLSearchParams(location.search).get("scale") === "0.5" ? 0.5 : 1;
const width = window.innerWidth;
const height = 600;
const players = Array.from({ length: 8 }, (_, i): SessionPlayer => ({
	id: `p${i}`, playerId: `p${i}`, memberId: null, name: `선수${i + 1}`,
	gender: "M", skills: { grade: 5 }, status: i < 4 ? "playing" : "waiting",
	gameCount: 0, mixedCount: 0, waitSince: null, joinedAtMatch: 0,
	allowMixedSingle: false, cockChecked: true,
}));
useAppStore.setState({ sessionMeta: null });
useSessionStore.setState({
	sessionPlayers: new Map(players.map((p) => [p.id, p])), isEditor: true, _clientId: null,
	restingIds: [], cockCheckEnabled: false,
	courts: [{ id: 1, match: { id: "match-1", courtId: 1, gameType: "남복",
		teamA: ["p0", "p1"], teamB: ["p2", "p3"], startedAt: "2026-09-16T00:00:00Z" } }],
});
useBoardStore.setState({
	magnets: new Map(players.map((p, i) => [p.id, { playerId: p.id, teamId: null, x: 70 + (i % 4) * 80, y: 420 }])),
	drafts: new Map(), reservations: new Map(), courtAnchors: new Map([[1, { x: 190, y: 180 }]]),
	stageW: width / scale, stageH: height / scale, scale, manualLayout: false,
});
const events = { opened: 0, closed: 0 };
Object.assign(window, { matchEditTest: events });
export type MatchEditTestApi = typeof events;

export default function Fixture() {
	const [courtId, setCourtId] = useState<number | null>(null);
	return <>
		<SessionBoardRenderer width={width} height={height}
			onMagnetClick={() => {}} onCockCheck={() => {}} onSlotClick={() => {}}
			onEditMatch={(id) => { events.opened++; setCourtId(id); }} />
		{courtId !== null && <MatchEditModal courtId={courtId}
			onClose={() => { events.closed++; setCourtId(null); }} />}
	</>;
}

createRoot(document.getElementById("root")!).render(<StrictMode><Fixture /></StrictMode>);
