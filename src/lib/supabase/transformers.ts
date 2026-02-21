import type { Court, PairHistory, SessionPlayer } from "../../types";
import type {
	ClientSessionState,
	PairHistoryRow,
	SessionPlayerRow,
	SessionSnapshot,
} from "./types";

export function rowToSessionPlayer(row: SessionPlayerRow): SessionPlayer {
	return {
		id: row.id,
		playerId: row.player_id,
		name: row.name,
		gender: row.gender,
		skills: row.skills,
		allowMixedSingle: row.allow_mixed_single,
		status: row.status,
		forceMixed: row.force_mixed,
		gameCount: row.game_count,
		mixedCount: row.mixed_count,
		waitSince: row.wait_since,
	};
}

export function buildPairHistory(rows: PairHistoryRow[]): PairHistory {
	const history: PairHistory = {};
	for (const row of rows) {
		if (!history[row.player_a]) history[row.player_a] = new Set();
		if (!history[row.player_b]) history[row.player_b] = new Set();
		for (let i = 0; i < row.count; i++) {
			history[row.player_a].add(row.player_b);
			history[row.player_b].add(row.player_a);
		}
	}
	return history;
}

export function snapshotToClientState(
	snapshot: SessionSnapshot,
): ClientSessionState {
	const courtCount = snapshot.session.court_count;
	const playerMap = new Map(snapshot.players.map((p) => [p.id, p]));

	// Courts
	const courts: Court[] = Array.from({ length: courtCount }, (_, i) => ({
		id: i + 1,
		match: null,
	}));

	for (const m of snapshot.matches) {
		const court = courts.find((c) => c.id === m.court_id);
		if (!court) continue;
		const p1 = playerMap.get(m.team_a_p1);
		const p2 = playerMap.get(m.team_a_p2);
		const p3 = playerMap.get(m.team_b_p1);
		const p4 = playerMap.get(m.team_b_p2);
		if (!p1 || !p2 || !p3 || !p4) continue;
		court.match = {
			id: m.id,
			courtId: m.court_id,
			gameType: m.game_type,
			teamA: [p1, p2],
			teamB: [p3, p4],
			startedAt: m.started_at,
		};
	}

	// Reserved groups
	const reservedGroups = snapshot.reservedGroups.map((g) => ({
		id: g.id,
		memberIds: g.member_ids,
		readyIds: g.ready_ids,
		players: g.member_ids
			.map((id) => playerMap.get(id))
			.filter((p): p is SessionPlayer => !!p),
	}));

	// Waiting / Resting by status
	const waiting = snapshot.players.filter((p) => p.status === "waiting");
	const resting = snapshot.players.filter((p) => p.status === "resting");

	// PairHistory
	const pairHistory = buildPairHistory(snapshot.pairHistory);

	return { courts, waiting, resting, reservedGroups, pairHistory };
}
