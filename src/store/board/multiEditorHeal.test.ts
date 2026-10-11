import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Court, SessionPlayer } from "../../types";
import type { BoardDraftsPayload, DraftTeam, MagnetPosition } from "../../types/board";

// 동시 편집(D5): 로컬 지식에 기대는 자동 정제는 화면만 바꾸고 저장하지 않는다. 플래그가 꺼져 있으면 기존처럼 저장한다.
const h = vi.hoisted(() => ({
	save: vi.fn(),
	session: {
		isEditor: true, multiEditor: false, _clientId: "editor" as string | null, _myName: "운영진", boardDraftsVersion: 3,
		courts: [] as Court[], sessionPlayers: new Map<string, SessionPlayer>(),
		applyDraftsIfNewer: vi.fn(), resyncFromServer: vi.fn(async () => {}),
	},
}));
vi.mock("../../lib/supabase", () => ({ dbBoardSaveDrafts: h.save }));
vi.mock("../sessionStore", () => ({ useSessionStore: { getState: () => h.session } }));
vi.mock("../appStore", () => ({ useAppStore: { getState: () => ({ sessionMeta: { sessionId: 1, singleWomanIds: [] } }) } }));
vi.mock("../../lib/supabase/matchAvoid", () => ({ fetchMatchAvoidGroups: vi.fn(), createMatchAvoidGroup: vi.fn(),
	deleteMatchAvoidGroup: vi.fn(), fetchBoardSelectionRules: vi.fn() }));

import { useBoardStore } from "../boardStore";
import { clearDraftsBase, flushBoardDrafts, refineLocally, syncState } from "./draftsSync";

const mag = (playerId: string, teamId: string | null): MagnetPosition => ({ playerId, x: 100, y: 100, teamId });
const team = (id: string, anchorMemberIds: string[]): DraftTeam => ({ id, anchorMemberIds, anchor: { x: 300, y: 500 }, createdAt: 1 });
const playing: Court = { id: 1, match: { id: "m1", teamA: ["p", "q"], teamB: ["r", "s"], gameType: "남복" } as never };

// 픽스처 주입 자체는 저장 대상이 아니다 — 원격 적용과 같은 플래그로 감싼다.
function quietly(run: () => void) {
	syncState.applyingRemoteDrafts = true;
	try { run(); } finally { syncState.applyingRemoteDrafts = false; }
}
function seed() {
	quietly(() => useBoardStore.setState({
		magnets: new Map(["a", "b", "c", "p"].map(id => [id, mag(id, "t1")])),
		drafts: new Map([["t1", team("t1", ["a", "b", "c", "p"])]]),
		reservations: new Map(),
		assigningTeamIds: new Set(),
	}));
}

beforeEach(() => {
	vi.clearAllMocks();
	h.save.mockResolvedValue(4);
	Object.assign(h.session, { isEditor: true, multiEditor: false, _clientId: "editor", courts: [] });
	quietly(() => useBoardStore.getState().reset());
	syncState.lastSyncedDraftsJson = "";
	clearDraftsBase();
});
afterEach(async () => { await flushBoardDrafts(); });

describe("경기중 anchor 자가 치유(healPlayingAnchors)", () => {
	it("단일 편집자 모드에서는 기존처럼 정제 결과를 저장한다", async () => {
		seed(); h.session.courts = [playing];
		useBoardStore.getState().healPlayingAnchors();
		await flushBoardDrafts();
		expect(useBoardStore.getState().drafts.get("t1")?.anchorMemberIds).toEqual(["a", "b", "c"]);
		expect(h.save).toHaveBeenCalledTimes(1);
	});
	it("동시 편집에서는 화면만 정제하고 저장하지 않는다", async () => {
		seed(); h.session.courts = [playing]; h.session.multiEditor = true;
		useBoardStore.getState().healPlayingAnchors();
		await flushBoardDrafts();
		expect(useBoardStore.getState().drafts.get("t1")?.anchorMemberIds).toEqual(["a", "b", "c"]);
		expect(h.save).not.toHaveBeenCalled();
		expect(syncState.localRefine).toBe(false);
	});
	it("동시 편집이어도 정제 뒤의 사용자 편집은 저장한다", async () => {
		seed(); h.session.courts = [playing]; h.session.multiEditor = true;
		useBoardStore.getState().healPlayingAnchors();
		useBoardStore.getState().dismissTeam("t1");
		await flushBoardDrafts();
		expect(h.save).toHaveBeenCalledTimes(1);
	});
});

describe("원격 적용 후 heal push(applyRemoteDrafts)", () => {
	const payload: BoardDraftsPayload = { teams: [{ id: "t1", memberIds: ["a", "b", "c", "p"], createdMs: 1 }], reservations: [] };
	function seedFree() {
		quietly(() => useBoardStore.setState({
			magnets: new Map(["a", "b", "c", "p"].map(id => [id, mag(id, null)])),
			drafts: new Map(), reservations: new Map(), assigningTeamIds: new Set(),
		}));
	}
	it("단일 편집자 모드: 경기중 선수를 뺀 결과를 서버로 영속화한다", async () => {
		seedFree(); h.session.courts = [playing];
		useBoardStore.getState().applyRemoteDrafts(payload, 0);
		await flushBoardDrafts();
		expect(useBoardStore.getState().drafts.get("t1")?.anchorMemberIds).toEqual(["a", "b", "c"]);
		expect(h.save).toHaveBeenCalledTimes(1);
	});
	it("동시 편집: 같은 정제를 화면에만 반영한다", async () => {
		seedFree(); h.session.courts = [playing]; h.session.multiEditor = true;
		useBoardStore.getState().applyRemoteDrafts(payload, 0);
		await flushBoardDrafts();
		expect(useBoardStore.getState().drafts.get("t1")?.anchorMemberIds).toEqual(["a", "b", "c"]);
		expect(h.save).not.toHaveBeenCalled();
	});
});

describe("refineLocally", () => {
	it("예외가 나도 플래그를 되돌린다", () => {
		h.session.multiEditor = true;
		expect(() => refineLocally(() => { throw new Error("x"); })).toThrow("x");
		expect(syncState.localRefine).toBe(false);
	});
	it("꺼져 있으면 플래그를 세우지 않고 그대로 실행한다", () => {
		let seen: boolean | null = null;
		refineLocally(() => { seen = syncState.localRefine; });
		expect(seen).toBe(false);
	});
});
