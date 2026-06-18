import type { Court, GameType, Gender, PairHistory, PlayerSkills, SessionPlayer } from "../../types";
import { addPair } from "../pairHistory";
import type {
	ClientSessionState,
	MatchRow,
	PairHistoryRow,
	SessionPlayerRow,
	SessionSnapshot,
} from "./types";

/** 로그 표시용 선수(이름/성별/스킬). */
export type LogPlayer = { name: string; gender: Gender; skills?: PlayerSkills };

/**
 * 매치 row를 로그용 팀 배열로 변환(순수). "그 시점 스냅샷"(player_snapshot)을 우선 사용하고,
 * 스냅샷이 없는 구 매치만 현재 선수 맵으로 폴백, 그래도 없으면 "?".
 * → 선수가 설정에서 삭제돼도 로그는 당시 이름을 유지한다(인스턴스 미참조).
 */
export function matchLogTeams(
	m: MatchRow,
	playerMap: ReadonlyMap<string, LogPlayer>,
): { teamA: LogPlayer[]; teamB: LogPlayer[] } {
	const snap = m.player_snapshot;
	const at = (i: number, fallbackId: string): LogPlayer => {
		const s = snap?.[i];
		if (s) return { name: s.name, gender: s.gender, skills: s.skills };
		const p = playerMap.get(fallbackId);
		return p ? { name: p.name, gender: p.gender, skills: p.skills } : { name: "?", gender: "M" };
	};
	return {
		teamA: [at(0, m.team_a_p1), at(1, m.team_a_p2)],
		teamB: [at(2, m.team_b_p1), at(3, m.team_b_p2)],
	};
}

export function rowToSessionPlayer(row: SessionPlayerRow): SessionPlayer {
	return {
		id: row.id,
		playerId: row.player_id,
		name: row.name,
		gender: row.gender,
		skills: row.skills,
		allowMixedSingle: row.allow_mixed_single,
		status: row.status,
		gameCount: row.game_count,
		mixedCount: row.mixed_count,
		waitSince: row.wait_since,
		joinedAtMatch: row.joined_at_match ?? 0,
	};
}

function buildPairHistory(rows: PairHistoryRow[]): PairHistory {
	const history: PairHistory = {};
	for (const row of rows) {
		addPair(history, row.player_a, row.player_b, row.count);
	}
	return history;
}

export function snapshotToClientState(
	snapshot: SessionSnapshot,
): ClientSessionState {
	const courtCount = snapshot.session.court_count;

	// Courts — match.teamA/B는 session_players.id 참조
	const courts: Court[] = Array.from({ length: courtCount }, (_, i) => ({
		id: i + 1,
		match: null,
	}));

	for (const m of snapshot.matches) {
		const court = courts.find((c) => c.id === m.court_id);
		if (!court) continue;

		court.match = {
			id: m.id,
			courtId: m.court_id,
			gameType: m.game_type,
			teamA: [m.team_a_p1, m.team_a_p2],
			teamB: [m.team_b_p1, m.team_b_p2],
			startedAt: m.started_at,
		};
	}

	// PairHistory
	const pairHistory = buildPairHistory(snapshot.pairHistory);

	// 직전 게임 타입 — 스냅샷은 진행중 경기만 포함하므로, 진행중 경기 참가자만 seed한다.
	// (완료 후 자유로 돌아온 선수는 세션 도중 match_completed 브로드캐스트로 갱신됨)
	const lastGameType: Record<string, GameType> = {};
	for (const m of snapshot.matches) {
		for (const id of [m.team_a_p1, m.team_a_p2, m.team_b_p1, m.team_b_p2]) {
			lastGameType[id] = m.game_type;
		}
	}

	// waitingIds / restingIds
	const waitingIds = snapshot.players
		.filter((p) => p.status === "waiting")
		.map((p) => p.id);
	const restingIds = snapshot.players
		.filter((p) => p.status === "resting")
		.map((p) => p.id);

	const boardDrafts = snapshot.session.board_drafts ?? { teams: [], reservations: [] };

	return { courts, players: snapshot.players, waitingIds, restingIds, pairHistory, matchAssignCount: snapshot.session.match_assign_count, lastGameType, boardDrafts };
}
