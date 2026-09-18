import { beforeEach, describe, expect, it } from "vitest";
import type { SessionPlayer } from "../types";
import { useSessionStore } from "./sessionStore";
import { handleMatchCompleted } from "./sessionBroadcastHandlers";
import { matchRowsToGroupHistory } from "../lib/supabase/transformers";
import { buildExchangeState } from "../lib/teamSelection/groupPolicy";

const endedAt = "2026-09-18T10:15:00Z";
const players: SessionPlayer[] = [1, 2, 8, 9].map((grade, i) => ({
	id: String(i), playerId: String(i), memberId: null, name: String(i), gender: "M", skills: { grade },
	allowMixedSingle: false, status: "waiting", gameCount: 1, mixedCount: 0, waitSince: endedAt,
	joinedAtMatch: 0, cockChecked: true,
}));
const payload = { matchId: "match", courtId: 1, gameType: "남복", teamA: players.slice(0, 2), teamB: players.slice(2), updatedPlayers: players };

beforeEach(() => useSessionStore.setState({ sessionPlayers: new Map(players.map(p => [p.id, p])), courts: [], groupHistory: [], lastGameType: {} }));

describe("완료 이벤트에서 교류 이력 보존", () => {
	it.each([true, false])("완료 시각 필드 유무(%s)와 무관하게 RPC의 서버 시각을 보존한다", explicit => {
		handleMatchCompleted({ ...payload, ...(explicit ? { completedAt: endedAt } : {}) }, useSessionStore.setState);
		expect(useSessionStore.getState().groupHistory).toEqual([{ matchId: "match", members: ["0", "1", "2", "3"], completedAt: endedAt }]);
	});
	it("중복 이벤트와 서버 스냅샷이 같은 경기 수와 교류 공백을 만든다", () => {
		handleMatchCompleted(payload, useSessionStore.setState);
		handleMatchCompleted(payload, useSessionStore.setState);
		const live = useSessionStore.getState().groupHistory;
		const loaded = matchRowsToGroupHistory([{ id: "match", team_a_p1: "0", team_a_p2: "1", team_b_p1: "2", team_b_p2: "3", game_type: "남복", ended_at: endedAt }]);
		expect(live).toEqual(loaded);
		const active = new Set(players.map(p => p.id));
		expect(buildExchangeState(players, live, active, Date.parse(endedAt))).toEqual(buildExchangeState(players, loaded, active, Date.parse(endedAt)));
	});
});
