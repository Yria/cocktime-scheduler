/**
 * teamGenerator.ts
 *
 * 팀 생성 알고리즘. 규칙 상세는 TEAM_GENERATION_RULES.md 참고.
 */
import type {
	GameCountHistory,
	GameType,
	GeneratedTeam,
	MixedHistory,
	PairHistory,
	Player,
	SkillLevel,
} from "../types";

// ─────────────────────────────────────────────
// 스킬 점수 계산
// ─────────────────────────────────────────────

const SKILL_VALUES: Record<SkillLevel, number> = { O: 3, V: 2, X: 1 };

/** 선수의 전체 스킬 평균 점수 (1.0 ~ 3.0) */
export function skillScore(player: Player): number {
	const values = Object.values(player.skills) as SkillLevel[];
	return values.reduce((sum, s) => sum + SKILL_VALUES[s], 0) / values.length;
}

// ─────────────────────────────────────────────
// 파트너 중복 이력
// ─────────────────────────────────────────────

function partnerCount(a: Player, b: Player, history: PairHistory): number {
	return (
		(history[a.id]?.has(b.id) ? 1 : 0) + (history[b.id]?.has(a.id) ? 1 : 0)
	);
}

// ─────────────────────────────────────────────
// 페어링 품질 점수 (낮을수록 좋음)
// ─────────────────────────────────────────────

/**
 * 페어링 점수 계산.
 *
 * 규칙 3: 파트너끼리 실력이 비슷할수록 좋다 (intra_diff 최소화).
 * 규칙 4: 팀 간 실력 편차도 낮을수록 좋다 (inter_diff 최소화).
 * 파트너 중복 이력은 가장 높은 가중치로 기피.
 */
function pairingScore(
	teamA: [Player, Player],
	teamB: [Player, Player],
	history: PairHistory,
): number {
	const sA0 = skillScore(teamA[0]),
		sA1 = skillScore(teamA[1]);
	const sB0 = skillScore(teamB[0]),
		sB1 = skillScore(teamB[1]);

	// 파트너 내 실력 차이 (규칙 3)
	const intraDiff = Math.abs(sA0 - sA1) + Math.abs(sB0 - sB1);
	// 팀 간 총 실력 차이 (규칙 4)
	const interDiff = Math.abs(sA0 + sA1 - (sB0 + sB1));
	// 파트너 중복 페널티 (최우선)
	const historyPenalty =
		partnerCount(teamA[0], teamA[1], history) +
		partnerCount(teamB[0], teamB[1], history);

	return historyPenalty * 10 + intraDiff * 1.5 + interDiff * 0.5;
}

// ─────────────────────────────────────────────
// 최적 페어링 선택
// ─────────────────────────────────────────────

/**
 * 4명 중 3가지 페어링 조합을 평가해 최적 조합 반환.
 * 스킬 유사도(규칙 3·4)와 파트너 중복 이력을 모두 고려.
 */
function bestPairing(
	players: [Player, Player, Player, Player],
	history: PairHistory,
): [[Player, Player], [Player, Player]] {
	const [p0, p1, p2, p3] = players;

	const combos: [[Player, Player], [Player, Player]][] = [
		[
			[p0, p1],
			[p2, p3],
		],
		[
			[p0, p2],
			[p1, p3],
		],
		[
			[p0, p3],
			[p1, p2],
		],
	];

	let best = combos[0];
	let bestScore = Infinity;

	for (const [teamA, teamB] of combos) {
		const score = pairingScore(teamA, teamB, history);
		if (score < bestScore) {
			bestScore = score;
			best = [teamA, teamB];
		}
	}

	return best;
}

// ─────────────────────────────────────────────
// 혼복용 남자 선발 (규칙 1·2)
// ─────────────────────────────────────────────

/**
 * 혼복에 투입할 남자 2명 선발.
 *
 * 규칙 1: 혼복 출전이 적은 남자를 우선.
 * 규칙 2: 혼복 출전 횟수가 같다면 서로 실력이 비슷한 쌍 선택.
 */
function selectMenForMixed(
	men: Player[],
	mixedHistory: MixedHistory,
): [Player, Player] {
	if (men.length === 2) return [men[0], men[1]];

	const mixCount = (p: Player) => mixedHistory[p.id] ?? 0;

	// 혼복 출전 횟수 최솟값
	const minMixed = Math.min(...men.map(mixCount));
	// 최소 출전 + 1 이하까지 후보로 포함 (너무 적으면 range 확장)
	let eligible = men.filter((m) => mixCount(m) <= minMixed + 1);
	if (eligible.length < 2) eligible = men;

	// 후보 중 실력 차이가 가장 작은 쌍 탐색
	let bestPair: [Player, Player] = [eligible[0], eligible[1]];
	let bestDiff = Math.abs(skillScore(eligible[0]) - skillScore(eligible[1]));

	for (let i = 0; i < eligible.length; i++) {
		for (let j = i + 1; j < eligible.length; j++) {
			const diff = Math.abs(skillScore(eligible[i]) - skillScore(eligible[j]));
			if (diff < bestDiff) {
				bestDiff = diff;
				bestPair = [eligible[i], eligible[j]];
			}
		}
	}

	return bestPair;
}

// ─────────────────────────────────────────────
// 게임 타입 결정
// ─────────────────────────────────────────────

function determineGameType(
	players: Player[],
	singleWomanIds: string[],
): GameType {
	const women = players.filter((p) => p.gender === "F");
	if (women.length === 0) return "남복";
	if (women.length === 4) return "여복";
	if (women.length === 2) return "혼복";
	// 여자 1명 또는 3명
	if (women.length === 1)
		return singleWomanIds.includes(women[0].id) ? "혼합" : "남복";
	return "남복";
}

// ─────────────────────────────────────────────
// 대기열에서 4명 선발
// ─────────────────────────────────────────────

/**
 * 대기열에서 다음 게임에 투입할 4명 선발.
 *
 * 우선순위:
 *  0) 전체 대기열을 경기 횟수 오름차순 정렬 → 경기 적게 한 사람 우선 (규칙 0)
 *  1) 혼복 가능(여 2 + 남 2)이면 혼복 우선 — 남자는 규칙 1·2로 선발
 *  2) 여자 1명 + 혼합 불허 시 여자 제외하고 남자 4명
 *  3) 그 외 정렬된 순서대로 4명
 */
function selectFour(
	waiting: Player[],
	mixedHistory: MixedHistory,
	gameCountHistory: GameCountHistory,
	singleWomanIds: string[],
): Player[] | null {
	// 경기 횟수 적은 순으로 정렬 (동점이면 기존 대기 순서 유지)
	const sorted = [...waiting].sort(
		(a, b) => (gameCountHistory[a.id] ?? 0) - (gameCountHistory[b.id] ?? 0),
	);

	const candidates = sorted.slice(0, Math.min(8, sorted.length));
	const women = candidates.filter((p) => p.gender === "F");
	const men = candidates.filter((p) => p.gender === "M");

	// 혼복 우선
	if (women.length >= 2 && men.length >= 2) {
		const selectedMen = selectMenForMixed(men, mixedHistory);
		return [women[0], women[1], selectedMen[0], selectedMen[1]];
	}

	// 여자 1명이고 혼합 불허(해당 여자가 singleWomanIds에 없음) → 여자 제외 남자 4명
	if (
		women.length === 1 &&
		!singleWomanIds.includes(women[0].id) &&
		men.length >= 4
	) {
		return men.slice(0, 4);
	}

	// 그 외: 정렬된 순서대로 4명
	if (candidates.length >= 4) return candidates.slice(0, 4);

	return null;
}

// ─────────────────────────────────────────────
// 혼복 팀 구성 (여+남 vs 여+남)
// ─────────────────────────────────────────────

/**
 * 혼복 구성: 각 팀에 여자 1명 + 남자 1명.
 * 남자끼리 실력 차이가 이미 최소화된 상태로 전달되므로
 * 여기서는 파트너 중복 이력을 기준으로 최적 매칭.
 */
function buildMixedTeams(
	women: Player[],
	men: [Player, Player],
	history: PairHistory,
): [[Player, Player], [Player, Player]] {
	const optionA: [[Player, Player], [Player, Player]] = [
		[women[0], men[0]],
		[women[1], men[1]],
	];
	const optionB: [[Player, Player], [Player, Player]] = [
		[women[0], men[1]],
		[women[1], men[0]],
	];

	const scoreA = pairingScore(optionA[0], optionA[1], history);
	const scoreB = pairingScore(optionB[0], optionB[1], history);

	return scoreA <= scoreB ? optionA : optionB;
}

// ─────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────

export function generateTeam(
	waiting: Player[],
	history: PairHistory,
	mixedHistory: MixedHistory,
	gameCountHistory: GameCountHistory,
	singleWomanIds: string[],
): GeneratedTeam | null {
	if (waiting.length < 4) return null;

	const selected = selectFour(
		waiting,
		mixedHistory,
		gameCountHistory,
		singleWomanIds,
	);
	if (!selected || selected.length < 4) return null;

	const four = selected as [Player, Player, Player, Player];
	const gameType = determineGameType(four, singleWomanIds);

	let teamA: [Player, Player];
	let teamB: [Player, Player];

	if (gameType === "혼복") {
		const women = four.filter((p) => p.gender === "F");
		const men = four.filter((p) => p.gender === "M") as [Player, Player];
		[teamA, teamB] = buildMixedTeams(women, men, history);
	} else {
		[teamA, teamB] = bestPairing(four, history);
	}

	return { teamA, teamB, gameType };
}

export function generateTeamWithGroup(
	groupPlayers: Player[],
	waiting: Player[],
	history: PairHistory,
	gameCountHistory: GameCountHistory,
	singleWomanIds: string[],
): GeneratedTeam | null {
	if (groupPlayers.length === 4) {
		return generateTeamFromPlayers(
			groupPlayers as [Player, Player, Player, Player],
			history,
			singleWomanIds,
		);
	}

	const need = 4 - groupPlayers.length;
	if (waiting.length < need) return null;

	// 경기 횟수 적은 순으로 정렬하여 부족한 인원 채우기
	const sortedWaiting = [...waiting].sort(
		(a, b) => (gameCountHistory[a.id] ?? 0) - (gameCountHistory[b.id] ?? 0),
	);
	const filled = sortedWaiting.slice(0, need);
	const four = [...groupPlayers, ...filled] as [Player, Player, Player, Player];

	// 예약인원이 2명일 경우, 무조건 두 명을 한 팀(A팀)으로 묶는다
	if (groupPlayers.length === 2) {
		const teamA: [Player, Player] = [groupPlayers[0], groupPlayers[1]];
		const teamB: [Player, Player] = [filled[0], filled[1]];

		// 강제로 팀을 나눴으므로 gameType만 판별 (만약 남남/여여 라도 혼복 판별될 수 있으나, 일단 그대로 반환)
		let gameType = determineGameType(four, singleWomanIds);

		// 만약 혼복으로 판별되었으나, 1팀이 남남/여여라면 '혼합'으로 바꿔서 표시상 어색함을 줄임
		if (gameType === "혼복") {
			const isTeamAMixed =
				teamA.some((p) => p.gender === "M") &&
				teamA.some((p) => p.gender === "F");
			if (!isTeamAMixed) {
				gameType = "혼합";
			}
		}

		return { teamA, teamB, gameType };
	} else {
		// 3명 예약인 경우 등은 기존 로직 활용
		return generateTeamFromPlayers(four, history, singleWomanIds);
	}
}

export function generateTeamFromPlayers(
	players: [Player, Player, Player, Player],
	history: PairHistory,
	singleWomanIds: string[],
): GeneratedTeam {
	const gameType = determineGameType(players, singleWomanIds);
	let teamA: [Player, Player];
	let teamB: [Player, Player];

	if (gameType === "혼복") {
		const women = players.filter((p) => p.gender === "F");
		const men = players.filter((p) => p.gender === "M") as [Player, Player];
		[teamA, teamB] = buildMixedTeams(women, men, history);
	} else {
		[teamA, teamB] = bestPairing(players, history);
	}

	return { teamA, teamB, gameType };
}

export function recordHistory(
	history: PairHistory,
	team: GeneratedTeam,
): PairHistory {
	const next = { ...history };
	const pairs: [Player, Player][] = [team.teamA, team.teamB];

	for (const [a, b] of pairs) {
		if (!next[a.id]) next[a.id] = new Set();
		if (!next[b.id]) next[b.id] = new Set();
		next[a.id].add(b.id);
		next[b.id].add(a.id);
	}
	return next;
}

/**
 * 경기 참여 횟수 업데이트. 팀 배정 시 반드시 호출.
 */
export function recordGameCount(
	gameCountHistory: GameCountHistory,
	team: GeneratedTeam,
): GameCountHistory {
	const next = { ...gameCountHistory };
	for (const p of [...team.teamA, ...team.teamB]) {
		next[p.id] = (next[p.id] ?? 0) + 1;
	}
	return next;
}

/**
 * 혼복 게임 완료 시 혼복 출전 횟수 업데이트.
 * generateTeam 후 혼복이면 반드시 호출.
 */
export function recordMixedHistory(
	mixedHistory: MixedHistory,
	team: GeneratedTeam,
): MixedHistory {
	if (team.gameType !== "혼복") return mixedHistory;
	const next = { ...mixedHistory };
	for (const p of [...team.teamA, ...team.teamB]) {
		if (p.gender === "M") {
			next[p.id] = (next[p.id] ?? 0) + 1;
		}
	}
	return next;
}
