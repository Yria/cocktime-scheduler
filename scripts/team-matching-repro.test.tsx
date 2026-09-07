/**
 * Offline reproduction of TEAM_MATCHING_REVIEW R1/R2/R3.
 * Run: pnpm exec vitest run --config scripts/team-matching-repro.config.ts
 * Assertions describe the proposed consistent behavior; unfixed cases FAIL intentionally.
 * Uses actual UI selection, store/actions, transformers and migration function bodies.
 * Network transport, auth/editor ownership and modal/photo decoration are fixture boundaries.
 */
import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionPlayer } from "../src/types";
import type { MatchRow, SessionPlayerRow, SessionSnapshot } from "../src/lib/supabase/types";

const io = vi.hoisted(() => ({ rpc: vi.fn(), load: vi.fn(), completed: vi.fn() }));
vi.mock("../src/lib/supabase/client", () => ({ supabase: { rpc: io.rpc } }));
vi.mock("../src/lib/supabase", async () => ({
	...await import("../src/lib/supabase/actions"),
	supabase: { rpc: io.rpc },
	dbLoadSessionState: io.load,
	dbLoadCompletedMatchTeams: io.completed,
	dbLoadMatches: vi.fn(),
	sendBroadcast: vi.fn(),
	dbBoardClaimEditor: vi.fn(),
	dbBoardHandoffEditor: vi.fn(),
	dbBoardReleaseEditor: vi.fn(),
	dbBoardTakeoverEditor: vi.fn(),
}));
vi.mock("../src/lib/supabase/sessionChannels", () => ({ createSessionChannels: vi.fn() }));
vi.mock("../src/lib/supabase/clubSettings", () => ({
	fetchGroupSettings: vi.fn().mockResolvedValue(null), grantCockSupport: vi.fn(),
}));
vi.mock("../src/store/appStore", () => ({
	useAppStore: { getState: () => ({ sessionMeta: { sessionId: 1, singleWomanIds: [] } }) },
}));
vi.mock("../src/store/authStore", () => ({ useAuthStore: { getState: () => ({}) } }));
vi.mock("../src/store/sessionStore", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../src/store/sessionStore")>();
	// SSR normally reads Zustand's initial (empty) server snapshot. Feed the real fixture
	// state to component selectors while retaining every actual store action unchanged.
	const selectCurrent = <T,>(select: (state: ReturnType<typeof actual.useSessionStore.getState>) => T) => select(actual.useSessionStore.getState());
	return { ...actual, useSessionStore: Object.assign(selectCurrent, actual.useSessionStore) };
});
vi.mock("../src/store/boardStore", () => ({
	useBoardStore: (select: (state: { setMatchRoster: () => void }) => unknown) => select({ setMatchRoster: () => {} }),
}));
vi.mock("../src/components/common/ModalSheet", () => ({ default: ({ children }: { children: ReactNode }) => children }));
vi.mock("../src/components/shared/PlayerCard", () => ({ default: ({ name }: { name: string }) => createElement("span", null, name) }));

import { useSessionStore } from "../src/store/sessionStore";
import { initialState } from "../src/store/sessionStoreState";
import MatchEditModal from "../src/components/board/MatchEditModal";
import { buildRecommendData } from "../src/lib/board/recommendPool";
import { determineGameType } from "../src/lib/teamSelection/pairPlayers";
import { rowToSessionPlayer, snapshotToClientState } from "../src/lib/supabase/transformers";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const [m1, m2, f1, f2, m3, resting, unchecked] = [1, 2, 3, 4, 5, 6, 7].map(id);
const matchId = id(100);
let db: PGlite;

function latestFunction(name: string): string {
	const dir = new URL("../supabase/migrations/", import.meta.url);
	const pattern = new RegExp(`create\\s+or\\s+replace\\s+function\\s+(?:public\\.)?${name}\\s*\\(`, "i");
	let definition = "";
	for (const file of readdirSync(dir).filter(f => f.endsWith(".sql")).sort()) {
		const sql = readFileSync(new URL(file, dir), "utf8");
		const start = sql.search(pattern);
		if (start < 0) continue;
		const rest = sql.slice(start);
		const body = /\bas\s+(\$[A-Za-z0-9_]*\$)/i.exec(rest);
		if (!body) throw new Error(`Cannot read function body: ${file} / ${name}`);
		const end = rest.indexOf(body[1], body.index + body[0].length);
		if (end < 0) throw new Error(`Unclosed function body: ${file} / ${name}`);
		definition = rest.slice(0, rest.indexOf(";", end + body[1].length) + 1);
	}
	if (!definition) throw new Error(`Missing migration function: ${name}`);
	return definition;
}

beforeAll(async () => {
	// No data directory or server URL: an ephemeral, in-memory PostgreSQL instance.
	db = new PGlite();
	await db.exec(`
		create table sessions(id bigint primary key, match_state_version bigint default 0, cock_check_enabled boolean default true);
		create table session_players(
			id uuid primary key, session_id bigint references sessions(id), player_id text, member_id uuid,
			name text, gender text, skills jsonb default '{"grade":5}', allow_mixed_single boolean default false,
			status text, cock_checked boolean default true, game_count int default 0, mixed_count int default 0,
			wait_since timestamptz, joined_at_match int default 0
		);
		create table matches(
			id uuid primary key, session_id bigint references sessions(id), court_id int, game_type text,
			team_a_p1 uuid, team_a_p2 uuid, team_b_p1 uuid, team_b_p2 uuid,
			status text, started_at timestamptz default now(), ended_at timestamptz,
			player_snapshot jsonb, assigned_by text
		);
		create function public.board_assert_editor(bigint,text,text,integer) returns void
		language plpgsql as $$ begin return; end $$;
	`);
	for (const name of ["set_match_roster", "complete_match"]) {
		await db.exec(latestFunction(name));
	}
});
afterAll(async () => { await db?.close(); });

async function players(): Promise<SessionPlayer[]> {
	return (await db.query<SessionPlayerRow>("select * from session_players order by id")).rows.map(rowToSessionPlayer);
}
async function storedMatch(): Promise<MatchRow> {
	return (await db.query<MatchRow>("select * from matches where id=$1", [matchId])).rows[0];
}

beforeEach(async () => {
	vi.clearAllMocks();
	await db.exec("truncate matches, session_players, sessions cascade");
	await db.exec("insert into sessions(id) values(1)");
	for (const [i, pid] of [m1, m2, f1, f2, m3, resting, unchecked].entries()) {
		await db.query(`insert into session_players(id,session_id,player_id,member_id,name,gender,status,cock_checked,allow_mixed_single)
			values($1::uuid,1,$1::text,$1::uuid,$2,$3,$4,$5,$6)`, [pid,
			pid === resting ? "휴식검증선수" : pid === unchecked ? "미확인검증선수" : `선수${i + 1}`,
			pid === f1 || pid === f2 ? "F" : "M", i < 4 ? "playing" : pid === resting ? "resting" : "waiting",
			pid !== unchecked, pid === f1]);
	}
	await db.query(`insert into matches(id,session_id,court_id,game_type,team_a_p1,team_a_p2,team_b_p1,team_b_p2,status)
		values($1,1,1,'혼복',$2,$3,$4,$5,'playing')`, [matchId, m1, f1, m2, f2]);
	useSessionStore.setState({
		...initialState, isEditor: true, _clientId: "offline-editor", _myName: "검증 운영진",
		_channel: {} as RealtimeChannel,
		sessionPlayers: new Map((await players()).map(p => [p.id, p])),
		courts: [{ id: 1, match: { id: matchId, courtId: 1, gameType: "혼복", teamA: [m1, f1], teamB: [m2, f2], startedAt: "2026-09-07T00:00:00Z" } }],
		lastGameType: { [m1]: "혼복", [m2]: "혼복", [f1]: "혼복", [f2]: "혼복", [m3]: "남복" },
	});
	io.rpc.mockImplementation(async (name: string, p: Record<string, unknown>) => {
		// The actual app action prepares these named RPC arguments. Only transport is replaced.
		const common = [p.p_match_id, p.p_session_id];
		const team = [p.p_team_a_p1, p.p_team_a_p2, p.p_team_b_p1, p.p_team_b_p2];
		if (name === "set_match_roster") {
			const result = await db.query("select * from set_match_roster($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
				[...common, ...team, p.p_removed_ids, p.p_added_ids, p.p_client_id, p.p_name]);
			return { data: result.rows, error: null };
		}
		if (name === "complete_match") {
			const result = await db.query("select * from complete_match($1,$2,$3,$4,$5,$6,$7,$8,$9)",
				[...common, p.p_game_type, ...team, p.p_client_id, p.p_name]);
			return { data: result.rows, error: null };
		}
		throw new Error(`Unexpected offline RPC: ${name}`);
	});
});

describe("대조군: 검증 경로가 정상 동작하는지", () => {
	it("일반 추천은 휴식·콕 미확인 선수를 제외한다", () => {
		const s = useSessionStore.getState();
		const data = buildRecommendData({ newTeam: true }, [], {
			...s, drafts: new Map(), reservations: new Map(),
			magnets: new Map([...s.sessionPlayers.keys()].map(pid => [pid, { playerId: pid, teamId: null, x: 0, y: 0 }])),
		});
		expect(data?.pool.map(p => p.id)).not.toContain(resting);
		expect(data?.pool.map(p => p.id)).not.toContain(unchecked);
		expect(data?.pool.map(p => p.id)).toContain(m3);
	});
	it("가용한 대기 선수의 로스터 교체는 실제 SQL에 저장된다", async () => {
		await useSessionStore.getState().handleSetMatchRoster(1, [m1, f1], [m2, m3]);
		expect((await storedMatch()).team_b_p2).toBe(m3);
		expect((await players()).find(p => p.id === m3)?.status).toBe("playing");
	});
});

describe("R1: 일반 편성과 경기 수정의 자격을 일치시킨다는 기준", () => {
	it.each(["휴식검증선수", "미확인검증선수"])("교체 목록에 %s가 없어야 한다", (name) => {
		const html = renderToStaticMarkup(createElement(MatchEditModal, { courtId: 1, onClose: () => {} }));
		expect(html).toContain("교체할 선수"); // Verify that the real modal rendered instead of returning null.
		expect(html.includes(name)).toBe(false);
	});
	it.each([["휴식", resting], ["콕 미확인", unchecked]])("%s 선수를 넣는 요청이 최종 반영되지 않아야 한다", async (_label, pid) => {
		await useSessionStore.getState().handleSetMatchRoster(1, [m1, f1], [m2, pid]);
		expect((await storedMatch()).team_b_p2).toBe(f2);
	});
});

describe("R2: 최종 로스터에 맞는 유형·추천 이력·집계", () => {
	it("혼복에서 허용된 남3·여1로 바꾸면 저장 유형도 혼합이어야 한다", async () => {
		await useSessionStore.getState().handleSetMatchRoster(1, [m1, f1], [m2, m3]);
		const s = useSessionStore.getState();
		const four = [m1, f1, m2, m3].map(pid => s.sessionPlayers.get(pid)!) as [SessionPlayer, SessionPlayer, SessionPlayer, SessionPlayer];
		expect(determineGameType(four, [])).toBe("혼합");
		expect((await storedMatch()).game_type).toBe("혼합");
	});
	it("새 참가자의 직전 유형은 현재 진행 중인 경기 유형과 같아야 한다", async () => {
		await useSessionStore.getState().handleSetMatchRoster(1, [m1, f1], [m2, m3]);
		const s = useSessionStore.getState();
		expect(s.lastGameType[m3]).toBe(s.courts[0].match!.gameType);
	});
	it("남3·여1로 수정한 경기를 완료해도 새 참가자의 혼복 수가 늘면 안 된다", async () => {
		await useSessionStore.getState().handleSetMatchRoster(1, [m1, f1], [m2, m3]);
		await useSessionStore.getState().handleComplete(1);
		expect((await storedMatch()).status).toBe("completed");
		expect((await players()).find(p => p.id === m3)?.mixedCount).toBe(0);
	});
});

describe("R3: 같은 서버 상태에 대한 초기 로드와 재연결 결과", () => {
	it("시작·완료 이벤트를 놓친 뒤에도 직전 유형은 초기 로드와 같아야 한다", async () => {
		await db.exec("update matches set status='completed', ended_at='2026-09-07T00:20:00Z'; update session_players set status='waiting' where status='playing'");
		const serverPlayers = await players();
		const completed = [await storedMatch()];
		const session = { court_count: 1, board_drafts: { teams: [], reservations: [] }, board_drafts_version: 1, match_state_version: 2, match_assign_count: 1, cock_check_enabled: true };
		const fresh = snapshotToClientState({ session, players: serverPlayers, matches: [], completedMatches: completed } as SessionSnapshot);
		expect(fresh.lastGameType[m1]).toBe("혼복");
		useSessionStore.setState({ lastGameType: { [m1]: "남복" }, groupHistory: [] });
		io.load.mockResolvedValue({ drafts: session.board_drafts, version: 1, matchStateVersion: 2, syncVersion: 3, courtCount: 1, matches: [], players: serverPlayers, editorClientId: "offline-editor", editorName: "검증 운영진", editorLeaseUntil: null });
		io.completed.mockResolvedValue(completed);
		await useSessionStore.getState().resyncFromServer();
		const restored = useSessionStore.getState();
		// Positive controls: the server snapshot was actually applied, not skipped by a version guard.
		expect(restored.syncVersion).toBe(3);
		expect(restored.courts).toEqual(fresh.courts);
		expect(restored.groupHistory).toEqual(fresh.groupHistory);
		expect(restored.lastGameType[m1]).toBe(fresh.lastGameType[m1]);
	});
});
