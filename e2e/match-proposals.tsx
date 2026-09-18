import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import type { User } from "@supabase/supabase-js";
import SessionBoard from "../src/components/board/SessionBoard";
import Toaster from "../src/components/common/Toaster";
import { useAppStore } from "../src/store/appStore";
import { useAuthStore } from "../src/store/authStore";
import { useSessionStore } from "../src/store/sessionStore";
import { useBoardStore } from "../src/store/boardStore";
import { useMatchProposalStore } from "../src/store/matchProposalStore";
import type { SessionPlayer } from "../src/types";
import "../src/index.css";

const params = new URLSearchParams(location.search);
const isAdmin = params.get("role") === "admin";
const userNumber = isAdmin ? 1 : params.get("role") === "other" ? 3 : 2;
const uid = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const user = { id: uid(userNumber), aud: "authenticated", app_metadata: {}, user_metadata: {}, created_at: "2026-09-18T00:00:00Z" } satisfies User;
useAuthStore.setState({ user, ready: true, memberLoaded: true, memberId: uid(userNumber), isAdmin, myName: isAdmin ? "운영진" : "민수" });
useAppStore.setState({ sessionMeta: { sessionId: 1, courtCount: 2, singleWomanIds: [], cockCheckEnabled: false, isScheduled: true } });
const players = Array.from({ length: 10 }, (_, i): SessionPlayer => ({
	id: uid(i + 1), playerId: uid(i + 1), memberId: uid(i + 1),
	name: ["운영진", "민수", "지수", "현우", "수빈", "지훈", "서연", "민재", "하늘", "예진"][i],
	gender: i % 2 ? "F" : "M", skills: { grade: 5 }, status: "waiting", gameCount: i % 3,
	mixedCount: 0, waitSince: null, joinedAtMatch: 0, allowMixedSingle: false, cockChecked: true,
}));
useSessionStore.setState({ sessionPlayers: new Map(players.map((p) => [p.id, p])), isEditor: false,
	courts: [{ id: 1, match: null }, { id: 2, match: null }], restingIds: [], cockCheckEnabled: false,
	lockSynced: true, lockFree: false, holderName: "운영진", holderClientId: "another-device", _clientId: null,
	boardDrafts: { teams: [], reservations: [] },
	// Keep the actual proposal transport; stub unrelated live session channels and editor claiming.
	subscribe: () => {}, unsubscribe: () => {}, claimEditingIfFree: () => {},
});
useBoardStore.getState().reset();
Object.assign(window, { proposalTest: { board: useBoardStore, session: useSessionStore, auth: useAuthStore, proposals: useMatchProposalStore } });
export type ProposalTestApi = { board: typeof useBoardStore; session: typeof useSessionStore; auth: typeof useAuthStore; proposals: typeof useMatchProposalStore };
createRoot(document.getElementById("root")!).render(<StrictMode><MemoryRouter><SessionBoard /><Toaster /></MemoryRouter></StrictMode>);
