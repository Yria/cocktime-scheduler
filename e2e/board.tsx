import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Application } from "pixi.js";
import SessionBoardRenderer from "../src/components/board/SessionBoardRenderer";
import { useBoardStore } from "../src/store/boardStore";
import { useSessionStore } from "../src/store/sessionStore";
import { useAppStore } from "../src/store/appStore";
import type { SessionPlayer } from "../src/types";

// This fixture does not mount session effects or connect to any backend.
useAppStore.setState({ sessionMeta: null });
const players = Array.from({ length: 12 }, (_, i) => ({
	id: `p${i}`, name: ["김가나다", "박선수", "긴이름테스트선수", "이연습"][i % 4],
	gender: i % 2 ? "F" : "M", skills: { grade: 3 + i % 6 }, gameCount: i % 3, status: "waiting", cockChecked: true,
	playerId: `p${i}`, memberId: null, allowMixedSingle: true, mixedCount: 0, waitSince: null, joinedAtMatch: 0,
} satisfies SessionPlayer));
useSessionStore.setState({ sessionPlayers: new Map(players.map((p) => [p.id, p])), isEditor: true,
	courts: [], restingIds: ["p11"], cockCheckEnabled: false, _clientId: null });
useBoardStore.setState({ magnets: new Map(players.map((p, i) => [p.id, { playerId: p.id, teamId: null, x: 90 + i % 6 * 110, y: 100 + Math.floor(i / 6) * 110 }])),
	drafts: new Map(), reservations: new Map(), courtAnchors: new Map(), stageW: 800, stageH: 600, scale: 1, userScale: null, manualLayout: false });
let renders = 0;
const originalRender = Application.prototype.render;
Application.prototype.render = function () { renders++; return originalRender.call(this); };
const root = createRoot(document.getElementById("root")!);
const clicks: string[] = [];
const props = { width: 800, height: 600,
	onMagnetClick: (id: string) => clicks.push(id), onCockCheck: (id: string) => clicks.push(`cock:${id}`),
	onSlotClick: (id: string) => clicks.push(`team:${id}`), onEditMatch: () => {} };
const mount = () => root.render(<StrictMode><SessionBoardRenderer {...props} /></StrictMode>);
const api = { board: useBoardStore, session: useSessionStore, mount, unmount: () => root.render(null), clicks, get renders() { return renders; } };
export type BoardTestApi = typeof api;
Object.assign(window, { boardTest: api });
mount();
