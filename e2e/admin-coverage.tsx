import { createRoot } from "react-dom/client";
import { useSyncExternalStore } from "react";
import AdminCoverageNotice from "../src/components/board/AdminCoverageNotice";
import { useAdminCoverageStore } from "../src/store/adminCoverageStore";
import { useBoardStore } from "../src/store/boardStore";
import { useSessionStore } from "../src/store/sessionStore";
import { useAppStore } from "../src/store/appStore";
import { createBoardProjection } from "../src/lib/board/pixi/projection";
import type { SessionPlayer } from "../src/types";
import type { DraftTeam } from "../src/types/board";
import "../src/index.css";

const alternative = !new URLSearchParams(location.search).has("sole");
const players: SessionPlayer[] = Array.from({ length: 12 }, (_, i) => ({ id: `p${i}`, playerId: `m${i}`, memberId: `m${i}`,
	name: ["운영진 민수", "지수", "현우", "수빈", "지훈", "서연", "민재", "하늘", "운영진 예진", "도윤", "지원", "준호"][i],
	gender: "M", skills: { grade: 5 }, status: "waiting", gameCount: 0, mixedCount: 0, allowMixedSingle: false, cockChecked: true, waitSince: null, joinedAtMatch: 0 }));
useAppStore.setState({ sessionMeta: null });
let starts = 0;
useSessionStore.setState({ sessionPlayers: new Map(players.map(p => [p.id, p])), isEditor: true, cockCheckEnabled: true, restingIds: [], _clientId: null,
	courts: [{ id: 1, match: { id: "busy", courtId: 1, gameType: "남복", teamA: ["p8", "p9"], teamB: ["p10", "p11"], startedAt: "" } }, { id: 2, match: null }],
	handleAssign: async (team, courtId) => { starts++; useSessionStore.setState(s => ({ courts: s.courts.map(c => c.id === courtId ? { ...c, match: { ...team, id: "started", courtId, startedAt: "" } } : c) })); },
});
useAdminCoverageStore.setState({ loaded: true, memberIds: new Set(["m0", "m8"]), starting: new Map(), prompt: null });
const drafts: DraftTeam[] = [{ id: "first", anchorMemberIds: ["p0", "p1", "p2", "p3"], anchor: { x: 200, y: 200 }, createdAt: 1 }];
if (alternative) drafts.push({ id: "second", anchorMemberIds: ["p4", "p5", "p6", "p7"], anchor: { x: 500, y: 200 }, createdAt: 2 });
useBoardStore.setState({ drafts: new Map(drafts.map(t => [t.id, t])),
	magnets: new Map(players.map((p, i) => [p.id, { playerId: p.id, teamId: i < 4 ? "first" : i < 8 && alternative ? "second" : null, x: 50 + i * 50, y: 200 }])), reservations: new Map(),
});
const project = createBoardProjection();
const scene = () => project(useBoardStore.getState(), useSessionStore.getState(), undefined, useAdminCoverageStore.getState());
Object.assign(window, { coverageTest: { starts: () => starts, session: useSessionStore, board: useBoardStore, coverage: useAdminCoverageStore, scene } });
export type CoverageTestApi = { starts: () => number; session: typeof useSessionStore; board: typeof useBoardStore; coverage: typeof useAdminCoverageStore; scene: typeof scene };
export default function Fixture() {
	useSyncExternalStore(useSessionStore.subscribe, useSessionStore.getState);
	useSyncExternalStore(useBoardStore.subscribe, useBoardStore.getState);
	const cards = scene().entities.filter(e => e.kind === "card" && e.source.kind === "team");
	return <main className="min-h-screen bg-slate-100 p-6"><h1 className="text-xl font-bold mb-4">경기 대기</h1>
		{cards.map(card => <section key={card.key} className="mb-4 rounded-xl bg-white p-4">
			<p>{card.appearance.label}</p><button className="btn-lq-primary mt-3" onClick={() => { if (card.source.kind === "team") void useBoardStore.getState().startMatch(card.source.teamId); }}>{card.appearance.ctaLabel}</button>
		</section>)}<AdminCoverageNotice sync={false} /></main>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
