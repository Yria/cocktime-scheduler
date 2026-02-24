/**
 * teamGenerator.ts
 *
 * 팀 생성 알고리즘. 규칙 상세는 docs/TEAM_GENERATION_RULES.md 참고.
 */
import type {
	GameType,
	GeneratedTeam,
	PairHistory,
	SessionPlayer,
	SkillLevel,
} from "../types";

// ─────────────────────────────────────────────
// 스킬 점수 계산
// ─────────────────────────────────────────────

const SKILL_VALUES: Record<SkillLevel, number> = { O: 3, V: 2, X: 1 };

/** 선수의 전체 스킬 평균 점수 (1.0 ~ 3.0) */
export function skillScore(player: SessionPlayer): number {
	const values = Object.values(player.skills) as SkillLevel[];
	return values.reduce((sum, s) => sum + SKILL_VALUES[s], 0) / values.length;
}

// ─────────────────────────────────────────────
// 파트너 중복 이력 (단방향 체크 — recordHistory가 양방향 저장하므로 한쪽만 확인)
// ─────────────────────────────────────────────

function partnerCount(
	a: SessionPlayer,
	b: SessionPlayer,
	history: PairHistory,
): number {
	return history[a.id]?.has(b.id) ? 1 : 0;
}

// ─────────────────────────────────────────────
// 페어링 품질 점수 (낮을수록 좋음)
// ─────────────────────────────────────────────

/**
 * score = historyPenalty × 10 + intraDiff × 1.5 + interDiff × 0.5
 *
 * 규칙 3: 파트너 실력 유사성 (intraDiff, 가중치 1.5)
 * 규칙 4: 팀 간 실력 균형 (interDiff, 가중치 0.5)
 * 규칙 5: 파트너 중복 기피 (historyPenalty, 가중치 10)
 */
export function pairingScore(
	teamA: [SessionPlayer, SessionPlayer],
	teamB: [SessionPlayer, SessionPlayer],
	history: PairHistory,
): number {
	const sA0 = skillScore(teamA[0]),
		sA1 = skillScore(teamA[1]);
	const sB0 = skillScore(teamB[0]),
		sB1 = skillScore(teamB[1]);

	const intraDiff = Math.abs(sA0 - sA1) + Math.abs(sB0 - sB1);
	const interDiff = Math.abs(sA0 + sA1 - (sB0 + sB1));
	const historyPenalty =
		partnerCount(teamA[0], teamA[1], history) +
		partnerCount(teamB[0], teamB[1], history);

	return historyPenalty * 10 + intraDiff * 1.5 + interDiff * 0.5;
}

// ─────────────────────────────────────────────
// 최적 페어링 선택
// ─────────────────────────────────────────────

function bestPairing(
	players: [SessionPlayer, SessionPlayer, SessionPlayer, SessionPlayer],
	history: PairHistory,
): [[SessionPlayer, SessionPlayer], [SessionPlayer, SessionPlayer]] {
	const [p0, p1, p2, p3] = players;

	const combos: [
		[SessionPlayer, SessionPlayer],
		[SessionPlayer, SessionPlayer],
	][] = [
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

	let bestCombos: [[SessionPlayer, SessionPlayer], [SessionPlayer, SessionPlayer]][] = [];
	let bestScore = Infinity;

	for (const [teamA, teamB] of combos) {
		const score = pairingScore(teamA, teamB, history);
		if (score < bestScore) {
			bestScore = score;
			bestCombos = [[teamA, teamB]];
		} else if (score === bestScore) {
			bestCombos.push([teamA, teamB]);
		}
	}

	return bestCombos[Math.floor(Math.random() * bestCombos.length)];
}

// ─────────────────────────────────────────────
// 혼복용 남자 선발 (규칙 1·1.5·2)
// ─────────────────────────────────────────────

/**
 * 혼복에 투입할 남자 2명 선발.
 *
 * 규칙 1:   mixedCount가 적은 남자를 우선.
 * 규칙 1.5: 직전 혼복 출전자는 최하위 — 가용 남자 2명 미만 시 완화.
 * 규칙 2:   동점이면 실력이 비슷한 쌍 선택.
 */
function selectMenForMixed(
	men: SessionPlayer[],
	lastMixedMenIds: string[] = [],
): [SessionPlayer, SessionPlayer] {
	if (men.length === 2) return [men[0], men[1]];

	// 규칙 1.5: 직전 혼복 출전자를 제외한 풀에서 먼저 탐색 (가용 부족 시 완화)
	const preferred = men.filter((m) => !lastMixedMenIds.includes(m.id));
	const pool = preferred.length >= 2 ? preferred : men;

	// 규칙 2: mixedCount 합산과 실력 차이를 종합적으로 고려 (mixedCount 우선)
	let bestPairs: [SessionPlayer, SessionPlayer][] = [];
	let bestScore = Infinity;

	for (let i = 0; i < pool.length; i++) {
		for (let j = i + 1; j < pool.length; j++) {
			const m1 = pool[i];
			const m2 = pool[j];
			
			const mixedSum = m1.mixedCount + m2.mixedCount;
			const diff = Math.abs(skillScore(m1) - skillScore(m2));
			
			// mixedCount 합산에 큰 가중치(10)를 두어 횟수가 적은 선수가 무조건 우선되도록 함
			const score = mixedSum * 10 + diff;
			
			if (score < bestScore) {
				bestScore = score;
				bestPairs = [[m1, m2]];
			} else if (score === bestScore) {
				bestPairs.push([m1, m2]);
			}
		}
	}

	// 동점인 쌍이 여러 개면 랜덤으로 하나 선택
	return bestPairs[Math.floor(Math.random() * bestPairs.length)];
}

// ─────────────────────────────────────────────
// 규칙 1.5: 여자 후순위 정렬 헬퍼
// ─────────────────────────────────────────────

/**
 * 직전 혼복 출전 여자를 후순위로 밀어 count명 반환.
 * 가용 인원이 부족하면 완화 적용.
 */
function pickWomenPreferred(
	women: SessionPlayer[],
	lastMixedWomenIds: string[],
	count: number,
): SessionPlayer[] {
	const preferred = women.filter((w) => !lastMixedWomenIds.includes(w.id));
	const fallback = women.filter((w) => lastMixedWomenIds.includes(w.id));
	const pool = [...preferred, ...fallback];

	if (pool.length <= count) return pool;

	// 규칙 2.5: 혼복 여자 2명 선발 시 실력 차이가 가장 작은 쌍 선택
	if (count === 2) {
		// 우선순위가 높은 그룹(preferred)에서 2명 이상이면 그 안에서 실력 유사성 고려
		const targetPool = preferred.length >= 2 ? preferred : pool;
		
		let bestPairs: [SessionPlayer, SessionPlayer][] = [];
		let bestDiff = Infinity;

		for (let i = 0; i < targetPool.length; i++) {
			for (let j = i + 1; j < targetPool.length; j++) {
				const diff = Math.abs(skillScore(targetPool[i]) - skillScore(targetPool[j]));
				if (diff < bestDiff) {
					bestDiff = diff;
					bestPairs = [[targetPool[i], targetPool[j]]];
				} else if (diff === bestDiff) {
					bestPairs.push([targetPool[i], targetPool[j]]);
				}
			}
		}
		return bestPairs[Math.floor(Math.random() * bestPairs.length)];
	}

	return pool.slice(0, count);
}

// ─────────────────────────────────────────────
// 규칙 7 헬퍼: 강제 포함 남자 1명의 파트너 선발
// ─────────────────────────────────────────────

/**
 * 강제 포함 남자의 파트너를 후보에서 선발.
 * 규칙 1.5(직전 혼복 출전자 후순위) + 규칙 1+2(mixedCount + 실력 유사성) 적용.
 */
function pickPartnerForForcedMan(
	forcedMan: SessionPlayer,
	candidates: SessionPlayer[],
	lastMixedMenIds: string[],
): SessionPlayer {
	const preferred = candidates.filter((m) => !lastMixedMenIds.includes(m.id));
	const pool = preferred.length > 0 ? preferred : candidates;

	let bestCandidates: SessionPlayer[] = [];
	let bestScore = Infinity;

	for (const m of pool) {
		const mixedSum = forcedMan.mixedCount + m.mixedCount;
		const diff = Math.abs(skillScore(forcedMan) - skillScore(m));
		
		const score = mixedSum * 10 + diff;
		
		if (score < bestScore) {
			bestScore = score;
			bestCandidates = [m];
		} else if (score === bestScore) {
			bestCandidates.push(m);
		}
	}

	return bestCandidates[Math.floor(Math.random() * bestCandidates.length)];
}

// ─────────────────────────────────────────────
// 게임 타입 결정
// ─────────────────────────────────────────────

function determineGameType(
	players: SessionPlayer[],
	singleWomanIds: string[],
): GameType {
	const women = players.filter((p) => p.gender === "F");
	if (women.length === 0) return "남복";
	if (women.length === 4) return "여복";
	if (women.length === 2) return "혼복";
	if (women.length === 1) {
		const isSingleAllowed =
			women[0].allowMixedSingle || singleWomanIds.includes(women[0].playerId);
		return isSingleAllowed ? "혼합" : "남복";
	}
	return "남복";
}

// ─────────────────────────────────────────────
// 대기열에서 4명 선발
// ─────────────────────────────────────────────

/**
 * 대기열에서 다음 게임에 투입할 4명 선발.
 *
 * 우선순위:
 *  0) gameCount 오름차순 정렬 → 경기 적게 한 사람 우선 (규칙 0, stable sort)
 *  7) forceMixed 선수가 있으면 혼복 강제 시도 — 여2+남2 미충족 시에도 (규칙 7)
 *  8) forceHardGame 선수가 있으면 우선 선발 후, 나머지는 skillScore 내림차순 (규칙 8)
 *  1) 혼복 가능(여 2 + 남 2)이면 혼복 우선 (규칙 1)
 *     여자 선발 시 직전 혼복 출전자 후순위 (규칙 1.5)
 *     남자 선발은 selectMenForMixed (규칙 1·1.5·2)
 *  2) 여자 1명 + 혼합 불허 시 여자 제외하고 남자 4명
 *  3) 상위 규칙 편성 불가 시 여자 4명 이상이면 여복 (규칙 1.8)
 *  4) 그 외 정렬된 순서대로 4명
 *
 * @param lastMixedPlayerIds 직전 혼복 경기에 출전한 SessionPlayer.id 목록 (규칙 1.5).
 *   호출자가 매칭 완료 후 갱신해서 전달해야 한다.
 */
function selectFour(
	waiting: SessionPlayer[],
	singleWomanIds: string[],
	lastMixedPlayerIds: string[] = [],
): SessionPlayer[] | null {
	// forceMixed 선수 분리, forceHardGame 선수 분리, 나머지는 gameCount 오름차순 정렬 (규칙 0, 8)
	const forceMixed = waiting.filter((p) => p.forceMixed);
	const forceHard = waiting.filter((p) => !p.forceMixed && p.forceHardGame);
	const rest = waiting.filter((p) => !p.forceMixed && !p.forceHardGame);
	// 규칙 8: forceHardGame 선수가 있으면 나머지를 skillScore 내림차순으로 정렬 (강자 우선)
	const sorted =
		forceHard.length > 0
			? [...rest].sort((a, b) => skillScore(b) - skillScore(a))
			: [...rest].sort((a, b) => a.gameCount - b.gameCount);

	// 규칙 1.5: 직전 혼복 출전 남자/여자 IDs (대기 중인 선수만)
	const waitingIds = new Set(waiting.map((p) => p.id));
	const lastMixedMenIds = lastMixedPlayerIds.filter(
		(id) =>
			waitingIds.has(id) && waiting.find((p) => p.id === id)?.gender === "M",
	);
	const lastMixedWomenIds = lastMixedPlayerIds.filter(
		(id) =>
			waitingIds.has(id) && waiting.find((p) => p.id === id)?.gender === "F",
	);

	// 규칙 7: forceMixed 선수가 있으면 혼복 강제 시도
	if (forceMixed.length > 0) {
		const forcedWomen = forceMixed.filter((p) => p.gender === "F");
		const forcedMen = forceMixed.filter((p) => p.gender === "M");
		const nonForced = [...forceHard, ...sorted];
		const nonForcedWomen = nonForced.filter((p) => p.gender === "F");
		const nonForcedMen = nonForced.filter((p) => p.gender === "M");

		const womenNeeded = Math.max(0, 2 - forcedWomen.length);
		const menNeeded = Math.max(0, 2 - forcedMen.length);

		if (
			nonForcedWomen.length >= womenNeeded &&
			nonForcedMen.length >= menNeeded
		) {
			// 규칙 1.5 적용: 여자 추가 선발 시 직전 혼복 출전자 후순위
			const addWomen = pickWomenPreferred(
				nonForcedWomen,
				lastMixedWomenIds,
				womenNeeded,
			);
			const allWomen = [...forcedWomen, ...addWomen].slice(0, 2);

			// 남자: 강제 포함 선수 반드시 포함
			let selectedMen: [SessionPlayer, SessionPlayer];
			if (forcedMen.length >= 2) {
				// 강제 남자 2명 이상 → 그 중 최적 2명 (규칙 2, 1.5 완화)
				selectedMen = selectMenForMixed(forcedMen, []);
			} else if (forcedMen.length === 1) {
				// 강제 남자 1명 + 비강제 남자 중 파트너 선발 (규칙 1·1.5·2)
				const partner = pickPartnerForForcedMan(
					forcedMen[0],
					nonForcedMen,
					lastMixedMenIds,
				);
				selectedMen = [forcedMen[0], partner];
			} else {
				// 강제 남자 없음 → 비강제 남자 중 선발 (규칙 1·1.5·2)
				selectedMen = selectMenForMixed(nonForcedMen, lastMixedMenIds);
			}

			return [allWomen[0], allWomen[1], selectedMen[0], selectedMen[1]];
		}
		// 혼복 구성 불가 → 일반 로직으로 진행 (forceMixed는 ordered 앞에 배치)
	}

	const ordered = [...forceMixed, ...forceHard, ...sorted];
	const candidates = ordered.slice(0, Math.min(8, ordered.length));
	const women = candidates.filter((p) => p.gender === "F");
	const men = candidates.filter((p) => p.gender === "M");

	// 혼복 우선 (규칙 1·1.5·2)
	if (women.length >= 2 && men.length >= 2) {
		const selectedWomen = pickWomenPreferred(women, lastMixedWomenIds, 2);
		// 남자 선발은 대기 중인 남자 전원 대상 (혼복 남자 참여 공정성 원칙)
		const allWaitingMen = ordered.filter((p) => p.gender === "M");
		const selectedMen = selectMenForMixed(allWaitingMen, lastMixedMenIds);
		return [selectedWomen[0], selectedWomen[1], selectedMen[0], selectedMen[1]];
	}

	// 여자 1명이고 혼합 불허 → 여자 제외 남자 4명
	if (
		women.length === 1 &&
		!women[0].allowMixedSingle &&
		!singleWomanIds.includes(women[0].playerId) &&
		men.length >= 4
	) {
		return men.slice(0, 4);
	}

	// 상위 혼복·남복 규칙으로 편성 불가 + 여자 ≥ 4명 → 여자 4명 (여복)
	if (women.length >= 4) {
		return women.slice(0, 4);
	}

	// 그 외: 정렬된 순서대로 4명
	if (candidates.length >= 4) return candidates.slice(0, 4);

	return null;
}

// ─────────────────────────────────────────────
// 혼복 팀 구성 (여+남 vs 여+남)
// ─────────────────────────────────────────────

function buildMixedTeams(
	women: SessionPlayer[],
	men: [SessionPlayer, SessionPlayer],
	history: PairHistory,
): [[SessionPlayer, SessionPlayer], [SessionPlayer, SessionPlayer]] {
	const optionA: [
		[SessionPlayer, SessionPlayer],
		[SessionPlayer, SessionPlayer],
	] = [
		[women[0], men[0]],
		[women[1], men[1]],
	];
	const optionB: [
		[SessionPlayer, SessionPlayer],
		[SessionPlayer, SessionPlayer],
	] = [
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

/**
 * @param lastMixedPlayerIds 직전 혼복 경기 출전자의 SessionPlayer.id 목록 (규칙 1.5).
 *   코트 배정 완료 후 호출자가 갱신해서 전달한다.
 */
export function generateTeam(
	waiting: SessionPlayer[],
	history: PairHistory,
	singleWomanIds: string[],
	lastMixedPlayerIds: string[] = [],
): GeneratedTeam | null {
	if (waiting.length < 4) return null;

	const selected = selectFour(waiting, singleWomanIds, lastMixedPlayerIds);
	if (!selected || selected.length < 4) return null;

	const four = selected as [
		SessionPlayer,
		SessionPlayer,
		SessionPlayer,
		SessionPlayer,
	];
	const gameType = determineGameType(four, singleWomanIds);

	let teamA: [SessionPlayer, SessionPlayer];
	let teamB: [SessionPlayer, SessionPlayer];

	if (gameType === "혼복") {
		const women = four.filter((p) => p.gender === "F");
		const men = four.filter((p) => p.gender === "M") as [
			SessionPlayer,
			SessionPlayer,
		];
		[teamA, teamB] = buildMixedTeams(women, men, history);
	} else {
		[teamA, teamB] = bestPairing(four, history);
	}

	return { teamA, teamB, gameType };
}

export function generateTeamWithGroup(
	groupPlayers: SessionPlayer[],
	waiting: SessionPlayer[],
	history: PairHistory,
	singleWomanIds: string[],
): GeneratedTeam | null {
	if (groupPlayers.length === 4) {
		return generateTeamFromPlayers(
			groupPlayers as [
				SessionPlayer,
				SessionPlayer,
				SessionPlayer,
				SessionPlayer,
			],
			history,
			singleWomanIds,
		);
	}

	const need = 4 - groupPlayers.length;
	if (waiting.length < need) return null;

	const sortedWaiting = [...waiting].sort((a, b) => a.gameCount - b.gameCount);
	const filled = sortedWaiting.slice(0, need);
	const four = [...groupPlayers, ...filled] as [
		SessionPlayer,
		SessionPlayer,
		SessionPlayer,
		SessionPlayer,
	];

	if (groupPlayers.length === 2) {
		const teamA: [SessionPlayer, SessionPlayer] = [
			groupPlayers[0],
			groupPlayers[1],
		];
		const teamB: [SessionPlayer, SessionPlayer] = [filled[0], filled[1]];

		let gameType = determineGameType(four, singleWomanIds);

		if (gameType === "혼복") {
			const isTeamAMixed =
				teamA.some((p) => p.gender === "M") &&
				teamA.some((p) => p.gender === "F");
			if (!isTeamAMixed) {
				gameType = "혼합";
			}
		}

		return { teamA, teamB, gameType };
	}

	return generateTeamFromPlayers(four, history, singleWomanIds);
}

export function generateTeamFromPlayers(
	players: [SessionPlayer, SessionPlayer, SessionPlayer, SessionPlayer],
	history: PairHistory,
	singleWomanIds: string[],
): GeneratedTeam {
	const gameType = determineGameType(players, singleWomanIds);
	let teamA: [SessionPlayer, SessionPlayer];
	let teamB: [SessionPlayer, SessionPlayer];

	if (gameType === "혼복") {
		const women = players.filter((p) => p.gender === "F");
		const men = players.filter((p) => p.gender === "M") as [
			SessionPlayer,
			SessionPlayer,
		];
		[teamA, teamB] = buildMixedTeams(women, men, history);
	} else {
		[teamA, teamB] = bestPairing(players, history);
	}

	return { teamA, teamB, gameType };
}

/**
 * 코트 배정 시 PairHistory 업데이트 (클라이언트 상태용).
 * DB pair_history upsert는 dbCompleteMatch에서 처리.
 */
export function recordHistory(
	history: PairHistory,
	team: GeneratedTeam,
): PairHistory {
	const next = { ...history };
	const pairs: [SessionPlayer, SessionPlayer][] = [team.teamA, team.teamB];

	for (const [a, b] of pairs) {
		if (!next[a.id]) next[a.id] = new Set();
		if (!next[b.id]) next[b.id] = new Set();
		next[a.id].add(b.id);
		next[b.id].add(a.id);
	}
	return next;
}
