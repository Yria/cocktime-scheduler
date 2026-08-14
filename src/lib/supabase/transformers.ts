import type { Court, GameType, Gender, GroupHistory, PlayerSkills, SessionPlayer } from "../../types";
import { normalizeSkills } from "./members";
import type {
	ClientSessionState,
	CompletedMatchTeamRow,
	MatchRow,
	SessionPlayerRow,
	SessionSnapshot,
} from "./types";

/** 로그 표시용 선수(이름/성별/스킬/년생). */
export type LogPlayer = {
	name: string;
	gender: Gender;
	skills?: PlayerSkills;
	/** 이름 뒤 년생 표기용. 스냅샷에는 없는 값이라 항상 현재 선수 맵(회원 링크)에서 온다. */
	birthYear?: number | null;
};

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
		const p = playerMap.get(fallbackId);
		// 년생은 스냅샷에 없는 값 — 이름이 스냅샷에서 와도 년생만은 현재 선수 맵에서 채운다.
		// 선수가 삭제되면 년생 없이 이름만 남는다(로그 자체는 스냅샷으로 보존).
		if (s) return { name: s.name, gender: s.gender, skills: s.skills, birthYear: p?.birthYear ?? null };
		return p
			? { name: p.name, gender: p.gender, skills: p.skills, birthYear: p.birthYear ?? null }
			: { name: "?", gender: "M" };
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
		memberId: row.member_id ?? null,
		name: row.name,
		gender: row.gender,
		// 빈/미판독 skills({}·null·구 6종)를 항상 유효 등급으로 바닥값 처리(등급 0 소비 방지).
		// 일정 시작 브릿지 RPC가 미채점 회원을 '{}'로 스냅샷해도 편성 알고리즘이 grade 5로 본다.
		skills: normalizeSkills(row.skills),
		allowMixedSingle: row.allow_mixed_single,
		status: row.status,
		gameCount: row.game_count,
		mixedCount: row.mixed_count,
		waitSince: row.wait_since,
		joinedAtMatch: row.joined_at_match ?? 0,
		cockChecked: row.cock_checked ?? false,
	};
}

/** 완료 매치 row들 → 그룹 이력(경기당 {matchId, 4인 id}). 재결성 회피 벌점의 원천 — 초기 스냅샷과 resync가 공유. */
export function matchRowsToGroupHistory(completed: CompletedMatchTeamRow[]): GroupHistory {
	return completed.map((m) => ({
		matchId: m.id,
		// 선수 삭제(FK ON DELETE SET NULL)로 빠진 자리는 제외 — 남은 멤버끼리의 겹침만 벌점에 반영.
		members: [m.team_a_p1, m.team_a_p2, m.team_b_p1, m.team_b_p2].filter(
			(id): id is string => id !== null,
		),
	}));
}

/**
 * resync 병합 — 서버(권위) 목록 위에, 그 스냅샷 시점 이후 로컬에 선반영된 항목(완료 RPC 직후
 * broadcast append)을 matchId 기준으로 보존한다. 길이 비교가 아니라 id 집합 비교라
 * "resync 교체 직후 같은 매치의 broadcast가 도착해 중복 append → 이후 catch-up 영구 무력화"
 * 레이스가 없다(append 쪽도 matchId dedup — handleMatchCompleted). 서버에 새 항목이 없으면
 * 로컬 참조를 그대로 반환해 불필요한 재렌더를 막는다.
 */
export function mergeGroupHistory(local: GroupHistory, server: GroupHistory): GroupHistory {
	const localIds = new Set(local.map((g) => g.matchId));
	if (!server.some((g) => !localIds.has(g.matchId))) return local;
	const serverIds = new Set(server.map((g) => g.matchId));
	return [...server, ...local.filter((g) => !serverIds.has(g.matchId))];
}

/**
 * 진행중 매치 row 배열을 코트 배열로 재구성(순수). 초기 스냅샷과 catch-up refetch(refetchMatches)가
 * 동일 매핑을 공유하도록 추출 — courtCount 만큼 빈 코트를 만들고 진행중 매치를 코트에 배치한다.
 */
export function matchRowsToCourts(courtCount: number, matches: MatchRow[]): Court[] {
	const courts: Court[] = Array.from({ length: courtCount }, (_, i) => ({
		id: i + 1,
		match: null,
	}));
	for (const m of matches) {
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
	return courts;
}

export function snapshotToClientState(
	snapshot: SessionSnapshot,
): ClientSessionState {
	const courtCount = snapshot.session.court_count;

	// Courts — match.teamA/B는 session_players.id 참조 (진행중 매치만)
	const courts = matchRowsToCourts(courtCount, snapshot.matches);

	// 그룹 이력 — 완료 매치의 4인 묶음(재결성 회피 원천). 쌍 단위 pair_history 사용은 폐기(2026-07).
	const groupHistory = matchRowsToGroupHistory(snapshot.completedMatches);

	// 직전 게임 타입 — 완료 매치(ended_at 오름차순, 나중 경기가 덮어씀) 위에 진행중 매치를 덮어 seed.
	// (구) 진행중만 seed해서 리로드 직후 대기 선수들의 로테이션 항이 죽는 갭이 있었다.
	const lastGameType: Record<string, GameType> = {};
	for (const m of [...snapshot.completedMatches].sort((a, b) =>
		(a.ended_at ?? "").localeCompare(b.ended_at ?? ""),
	)) {
		for (const id of [m.team_a_p1, m.team_a_p2, m.team_b_p1, m.team_b_p2]) {
			if (id) lastGameType[id] = m.game_type;
		}
	}
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
	const boardDraftsVersion = snapshot.session.board_drafts_version ?? 0;

	return { courts, players: snapshot.players, waitingIds, restingIds, groupHistory, matchAssignCount: snapshot.session.match_assign_count, lastGameType, boardDrafts, boardDraftsVersion, matchStateVersion: snapshot.session.match_state_version ?? 0, cockCheckEnabled: snapshot.session.cock_check_enabled ?? true };
}
