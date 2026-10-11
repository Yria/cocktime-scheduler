import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Court, SessionPlayer } from "../../types";
import type { BoardDraftsPayload, MagnetPosition } from "../../types/board";

// 동시 편집(D7): 머지 기준(base)은 applyRemoteDrafts(payload, version) 한 곳에서 '적용 직후 로컬 투영'으로 기록되고,
// 저장은 그 기준과 머지해 내가 바꾼 배치만 서버 원본 위에 얹는다.
const h = vi.hoisted(() => ({
	save: vi.fn(), load: vi.fn(),
	session: {
		isEditor: true, multiEditor: true, _clientId: "editor" as string | null, _myName: "운영진", boardDraftsVersion: 5,
		courts: [] as Court[], sessionPlayers: new Map<string, SessionPlayer>(),
		applyDraftsIfNewer: vi.fn(), resyncFromServer: vi.fn(async () => {}),
	},
}));
vi.mock("../../lib/supabase", () => ({ dbBoardSaveDrafts: h.save, dbLoadSessionState: h.load }));
vi.mock("../sessionStore", () => ({ useSessionStore: { getState: () => h.session } }));
vi.mock("../appStore", () => ({ useAppStore: { getState: () => ({ sessionMeta: { sessionId: 1, singleWomanIds: [] } }) } }));
vi.mock("../../lib/supabase/matchAvoid", () => ({ fetchMatchAvoidGroups: vi.fn(), createMatchAvoidGroup: vi.fn(),
	deleteMatchAvoidGroup: vi.fn(), fetchBoardSelectionRules: vi.fn() }));

import { useBoardStore } from "../boardStore";
import { projectRemoteDrafts } from "./matchSlice";
import { clearDraftsBase, flushBoardDrafts, getDraftsBase, serializeBoardDrafts, syncState } from "./draftsSync";

const mag = (playerId: string): MagnetPosition => ({ playerId, x: 100, y: 100, teamId: null });
function quietly(run: () => void) {
	syncState.applyingRemoteDrafts = true;
	try { run(); } finally { syncState.applyingRemoteDrafts = false; }
}
// 이 기기엔 g 자석이 아직 없다(선수 합류 이벤트보다 board_drafts 가 먼저 도착).
const server: BoardDraftsPayload = { teams: [
	{ id: "X", memberIds: ["a", "b", "g"], createdMs: 1 },
	{ id: "Y", memberIds: ["c", "d"], createdMs: 2 },
], reservations: [] };
const sorted = (p: BoardDraftsPayload, id: string) => [...(p.teams.find(t => t.id === id)?.memberIds ?? [])].sort();

beforeEach(() => {
	vi.clearAllMocks();
	h.save.mockResolvedValue(6);
	Object.assign(h.session, { isEditor: true, multiEditor: true, _clientId: "editor", courts: [] });
	quietly(() => {
		useBoardStore.getState().reset();
		useBoardStore.setState({ magnets: new Map(["a", "b", "c", "d", "e"].map(id => [id, mag(id)])), assigningTeamIds: new Set() });
	});
	syncState.lastSyncedDraftsJson = "";
	clearDraftsBase();
});
afterEach(async () => { await flushBoardDrafts(); });

describe("동시 편집 머지 기준(base)", () => {
	it("applyRemoteDrafts 가 버전·적용 직후 투영·서버 원본을 기준으로 기록한다", () => {
		useBoardStore.getState().applyRemoteDrafts(server, 5);
		const base = getDraftsBase(1)!;
		expect(base.version).toBe(5);
		expect(base.raw).toBe(server);
		expect(sorted(base.projection, "X")).toEqual(["a", "b"]); // 자석 없는 g 는 화면에서만 빠진다
		expect(base.projection).toEqual(serializeBoardDrafts(useBoardStore.getState()));
		// 부수효과 없는 투영도 같은 결과
		expect(projectRemoteDrafts(useBoardStore.getState(), server)).toEqual(base.projection);
	});

	it("이미 같은 내용이라 적용을 건너뛰어도 기준 버전은 갱신한다", () => {
		useBoardStore.getState().applyRemoteDrafts(server, 5);
		useBoardStore.getState().applyRemoteDrafts(server, 8);
		expect(getDraftsBase(1)?.version).toBe(8);
	});

	it("사용자 편집 저장은 화면에서만 빠진 서버 배치를 지우지 않는다", async () => {
		useBoardStore.getState().applyRemoteDrafts(server, 5);
		useBoardStore.getState().handleDrop("e", { x: 900, y: 900 }); // 아무 팀에도 안 닿는 이동 → 좌표만
		useBoardStore.getState().dismissTeam("Y");
		await flushBoardDrafts();
		expect(h.save).toHaveBeenCalledTimes(1);
		const [, , , sent, version] = h.save.mock.calls[0];
		expect(version).toBe(5);
		expect(sorted(sent, "X")).toEqual(["a", "b", "g"]);
		expect(sent.teams.find((t: { id: string }) => t.id === "Y")).toBeUndefined();
	});

	it("로컬 정제(heal)는 기준에 접혀, 이후 사용자 편집 저장이 정제로 빠진 서버 배치를 지우지 않는다", async () => {
		useBoardStore.getState().applyRemoteDrafts(server, 5);
		// 이 기기만 c 가 경기중이라고 안다(코트 이벤트 순서 어긋남) → 화면에서 Y 가 정제된다.
		h.session.courts = [{ id: 1, match: { id: "m1", teamA: ["c", "p"], teamB: ["q", "r"], gameType: "남복" } } as never];
		useBoardStore.getState().healPlayingAnchors();
		expect(useBoardStore.getState().drafts.has("Y")).toBe(false);
		await flushBoardDrafts();
		expect(h.save).not.toHaveBeenCalled();
		useBoardStore.getState().dismissTeam("X"); // 무관한 사용자 편집
		await flushBoardDrafts();
		expect(h.save).toHaveBeenCalledTimes(1);
		const [, , , sent] = h.save.mock.calls[0];
		expect(sent.teams.find((t: { id: string }) => t.id === "X")).toBeUndefined();
		expect(sorted(sent, "Y")).toEqual(["c", "d"]); // 정제는 '내 변경'이 아니다 — 서버 원본 유지
	});
});
