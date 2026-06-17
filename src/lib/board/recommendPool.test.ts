import { describe, it, expect } from "vitest";
import type { Court, SessionPlayer } from "../../types";
import type { DraftTeam, MagnetPosition, Reservation } from "../../types/board";
import { buildRecommendData, type RecommendPoolInputs } from "./recommendPool";

// ── 픽스처 ───────────────────────────────────────────────
function player(
	id: string,
	gender: "M" | "F" = "M",
	status: SessionPlayer["status"] = "waiting",
): SessionPlayer {
	return {
		id,
		playerId: id,
		name: id,
		gender,
		skills: { 클리어: "V", 스매시: "V", 로테이션: "V", 드랍: "V", 헤어핀: "V", 푸시: "V" },
		allowMixedSingle: false,
		status,
		gameCount: 0,
		mixedCount: 0,
		waitSince: null,
		joinedAtMatch: 0,
	};
}
function mag(playerId: string, teamId: string | null): MagnetPosition {
	return { playerId, x: 0, y: 0, teamId };
}
function draft(id: string, anchorMemberIds: string[]): DraftTeam {
	return { id, anchorMemberIds, anchor: { x: 0, y: 0 }, createdAt: 0 };
}

function makeInputs(opts: {
	players: SessionPlayer[];
	magnets?: MagnetPosition[];
	drafts?: DraftTeam[];
	reservations?: Reservation[];
	courts?: Court[];
}): RecommendPoolInputs {
	return {
		sessionPlayers: new Map(opts.players.map((p) => [p.id, p])),
		magnets: new Map((opts.magnets ?? []).map((m) => [m.playerId, m])),
		drafts: new Map((opts.drafts ?? []).map((d) => [d.id, d])),
		reservations: new Map((opts.reservations ?? []).map((r) => [r.id, r])),
		courts: opts.courts ?? [],
		pairHistory: {},
		lastGameType: {},
		matchAssignCount: 0,
	};
}

const ids = (ps: SessionPlayer[]) => ps.map((p) => p.id).sort();

describe("buildRecommendData", () => {
	it("teamId 모드 — members=팀 멤버, pool은 멤버·타팀 anchor 제외(자유/이 팀은 포함 없음)", () => {
		const inputs = makeInputs({
			players: ["a", "b", "c", "d"].map((id) => player(id)),
			magnets: [mag("a", "T"), mag("b", "T"), mag("c", null), mag("d", "OTHER")],
			drafts: [draft("T", ["a", "b"]), draft("OTHER", ["d"])],
		});
		const data = buildRecommendData({ teamId: "T" }, [], inputs);
		expect(data).not.toBeNull();
		expect(ids(data!.members)).toEqual(["a", "b"]);
		// 풀: a,b(멤버) 제외, d(타팀 anchor) 제외 → c만
		expect(ids(data!.pool)).toEqual(["c"]);
		expect(data!.confirmed).toEqual(data!.members); // extra 없음
	});

	it("seedId 모드 — members=[시드], pool에서 시드 제외", () => {
		const inputs = makeInputs({
			players: ["s", "x", "y"].map((id) => player(id)),
			magnets: [mag("s", null), mag("x", null), mag("y", null)],
		});
		const data = buildRecommendData({ seedId: "s" }, [], inputs);
		expect(ids(data!.members)).toEqual(["s"]);
		expect(ids(data!.pool)).toEqual(["x", "y"]);
	});

	it("excludePlaying=false(기본)면 경기중 선수도 풀에 포함, true면 제외", () => {
		const inputs = makeInputs({
			players: ["a", "b", "p"].map((id) => player(id)),
			magnets: [mag("a", "T"), mag("b", null), mag("p", null)],
			drafts: [draft("T", ["a"])],
			courts: [{ id: 1, match: { teamA: ["p", "q"], teamB: ["r", "s"] } } as unknown as Court],
		});
		const included = buildRecommendData({ teamId: "T" }, [], inputs);
		expect(ids(included!.pool)).toEqual(["b", "p"]); // p(경기중) 포함
		expect(included!.playingIds.has("p")).toBe(true);

		const excluded = buildRecommendData({ teamId: "T" }, [], inputs, { excludePlaying: true });
		expect(ids(excluded!.pool)).toEqual(["b"]); // p 제외
	});

	it("extraConfirmedIds(다중선택분)는 confirmed에 합쳐지고 풀에서 빠진다", () => {
		const inputs = makeInputs({
			players: ["a", "b", "c"].map((id) => player(id)),
			magnets: [mag("a", "T"), mag("b", null), mag("c", null)],
			drafts: [draft("T", ["a"])],
		});
		const data = buildRecommendData({ teamId: "T" }, ["b"], inputs);
		expect(ids(data!.members)).toEqual(["a"]); // members는 다중선택분 미포함
		expect(ids(data!.confirmed)).toEqual(["a", "b"]); // confirmed엔 포함
		expect(ids(data!.pool)).toEqual(["c"]); // b는 풀에서 제외
	});

	it("resting 선수와 magnet 없는 선수는 풀에서 제외", () => {
		const inputs = makeInputs({
			players: [player("seed"), player("a"), player("rest", "M", "resting"), player("nomag")],
			magnets: [mag("seed", null), mag("a", null), mag("rest", null)], // nomag은 자석 없음
		});
		const data = buildRecommendData({ seedId: "seed" }, [], inputs);
		expect(ids(data!.pool)).toEqual(["a"]); // rest(resting)·nomag(자석없음) 제외
	});

	it("대상이 무효면 null — teamId/seedId 없음, 없는 팀, 없는 시드", () => {
		const inputs = makeInputs({ players: [player("a")], magnets: [mag("a", null)] });
		expect(buildRecommendData({}, [], inputs)).toBeNull();
		expect(buildRecommendData({ teamId: "ghost" }, [], inputs)).toBeNull();
		expect(buildRecommendData({ seedId: "ghost" }, [], inputs)).toBeNull();
	});
});
