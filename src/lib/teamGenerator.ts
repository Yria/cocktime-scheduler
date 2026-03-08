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
	TeamStrategy,
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
// 직전 게임 동반자 겹침 (규칙 9)
// ─────────────────────────────────────────────

function coPlayerOverlap(
	group: SessionPlayer[],
	lastCoPlayers: Record<string, string[]>,
): number {
	let overlap = 0;
	for (let i = 0; i < group.length; i++) {
		const coPlayers = lastCoPlayers[group[i].id];
		if (!coPlayers) continue;
		for (let j = i + 1; j < group.length; j++) {
			if (coPlayers.includes(group[j].id)) overlap++;
		}
	}
	return overlap;
}

/**
 * 후보(최대 8명)에서 C(n,4) 조합 중 동반자 겹침이 최소인 4명을 선택.
 * 동점 시 원래 정렬순 우선 (첫 번째 조합 반환).
 */
function selectBestGroup(
	candidates: SessionPlayer[],
	lastCoPlayers: Record<string, string[]>,
): SessionPlayer[] {
	if (candidates.length <= 4 || Object.keys(lastCoPlayers).length === 0) {
		return candidates.slice(0, 4);
	}

	const n = candidates.length;
	let bestGroup: SessionPlayer[] = candidates.slice(0, 4);
	let bestOverlap = coPlayerOverlap(bestGroup, lastCoPlayers);

	if (bestOverlap === 0) return bestGroup;

	for (let i = 0; i < n - 3; i++) {
		for (let j = i + 1; j < n - 2; j++) {
			for (let k = j + 1; k < n - 1; k++) {
				for (let l = k + 1; l < n; l++) {
					if (i === 0 && j === 1 && k === 2 && l === 3) continue; // already checked
					const group = [candidates[i], candidates[j], candidates[k], candidates[l]];
					const overlap = coPlayerOverlap(group, lastCoPlayers);
					if (overlap < bestOverlap) {
						bestOverlap = overlap;
						bestGroup = group;
						if (bestOverlap === 0) return bestGroup;
					}
				}
			}
		}
	}

	return bestGroup;
}

/**
 * 직전 게임 동반자 기록 갱신 (모든 게임 타입 공통).
 * 4명 각각에 대해 나머지 3명을 기록한다.
 */
export function updateLastCoPlayers(
	lastCoPlayers: Record<string, string[]>,
	team: GeneratedTeam,
): Record<string, string[]> {
	const allPlayers = [...team.teamA, ...team.teamB];
	const next = { ...lastCoPlayers };
	for (const player of allPlayers) {
		next[player.id] = allPlayers
			.filter((p) => p.id !== player.id)
			.map((p) => p.id);
	}
	return next;
}

// ─────────────────────────────────────────────
// 페어링 품질 점수 (낮을수록 좋음)
// ─────────────────────────────────────────────

/**
 * score = intraDiff × 1.5 + interDiff × 0.5
 *
 * 규칙 10: 파트너 실력 유사성 (intraDiff, 가중치 1.5)
 * 규칙 11: 팀 간 실력 균형 (interDiff, 가중치 0.5)
 */
export function pairingScore(
	teamA: [SessionPlayer, SessionPlayer],
	teamB: [SessionPlayer, SessionPlayer],
): number {
	const sA0 = skillScore(teamA[0]),
		sA1 = skillScore(teamA[1]);
	const sB0 = skillScore(teamB[0]),
		sB1 = skillScore(teamB[1]);

	const intraDiff = Math.abs(sA0 - sA1) + Math.abs(sB0 - sB1);
	const interDiff = Math.abs(sA0 + sA1 - (sB0 + sB1));

	return intraDiff * 1.5 + interDiff * 0.5;
}

// ─────────────────────────────────────────────
// 최적 페어링 선택
// ─────────────────────────────────────────────

function bestPairing(
	players: [SessionPlayer, SessionPlayer, SessionPlayer, SessionPlayer],
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
		const score = pairingScore(teamA, teamB);
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
// 대기열에서 4명 선발 (기본 전략: 게임수 균등)
// ─────────────────────────────────────────────

interface SelectFourResult {
	players: SessionPlayer[];
	reason: string;
}

function selectFour(
	waiting: SessionPlayer[],
	singleWomanIds: string[],
	lastMixedPlayerIds: string[] = [],
	lastCoPlayers: Record<string, string[]> = {},
): SelectFourResult | null {
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
				selectedMen = selectMenForMixed(forcedMen, []);
			} else if (forcedMen.length === 1) {
				const partner = pickPartnerForForcedMan(
					forcedMen[0],
					nonForcedMen,
					lastMixedMenIds,
				);
				selectedMen = [forcedMen[0], partner];
			} else {
				selectedMen = selectMenForMixed(nonForcedMen, lastMixedMenIds);
			}

			return { players: [allWomen[0], allWomen[1], selectedMen[0], selectedMen[1]], reason: "혼복 강제배치" };
		}
	}

	const ordered = [...forceMixed, ...forceHard, ...sorted];
	const candidates = ordered.slice(0, Math.min(8, ordered.length));
	const women = candidates.filter((p) => p.gender === "F");
	const men = candidates.filter((p) => p.gender === "M");

	// 혼복 우선 (규칙 1·1.5·2)
	if (women.length >= 2 && men.length >= 2) {
		const selectedWomen = pickWomenPreferred(women, lastMixedWomenIds, 2);
		const allWaitingMen = ordered.filter((p) => p.gender === "M");
		const selectedMen = selectMenForMixed(allWaitingMen, lastMixedMenIds);
		return { players: [selectedWomen[0], selectedWomen[1], selectedMen[0], selectedMen[1]], reason: "혼복 우선" };
	}

	// 여자 1명이고 혼합 불허 → 여자 제외 남자 4명 (규칙 9 적용)
	if (
		women.length === 1 &&
		!women[0].allowMixedSingle &&
		!singleWomanIds.includes(women[0].playerId) &&
		men.length >= 4
	) {
		return { players: selectBestGroup(men, lastCoPlayers), reason: forceHard.length > 0 ? "빡겜 우선배치" : "게임수 균등" };
	}

	// 상위 혼복·남복 규칙으로 편성 불가 + 여자 ≥ 4명 → 여자 4명 (여복, 규칙 1.8)
	if (women.length >= 4) {
		const sortedWomen = women
			.slice()
			.sort((a, b) => a.gameCount - b.gameCount);
		return { players: selectBestGroup(sortedWomen, lastCoPlayers), reason: "여복 편성" };
	}

	// 그 외: 정렬된 순서대로 4명 (규칙 9 적용)
	if (candidates.length >= 4) {
		return { players: selectBestGroup(candidates, lastCoPlayers), reason: forceHard.length > 0 ? "빡겜 우선배치" : "게임수 균등" };
	}

	return null;
}

// ─────────────────────────────────────────────
// 4명 → GeneratedTeam 빌드 (공통 헬퍼)
// ─────────────────────────────────────────────

function buildTeamFromFour(
	four: [SessionPlayer, SessionPlayer, SessionPlayer, SessionPlayer],
	singleWomanIds: string[],
	reason: string,
	strategy?: TeamStrategy,
): GeneratedTeam {
	const gameType = determineGameType(four, singleWomanIds);

	let teamA: [SessionPlayer, SessionPlayer];
	let teamB: [SessionPlayer, SessionPlayer];

	if (gameType === "혼복") {
		const women = four.filter((p) => p.gender === "F");
		const men = four.filter((p) => p.gender === "M") as [
			SessionPlayer,
			SessionPlayer,
		];
		[teamA, teamB] = buildMixedTeams(women, men);
	} else {
		[teamA, teamB] = bestPairing(four);
	}

	// 실력 균형 점수 계산 (낮을수록 좋음)
	const score = pairingScore(teamA, teamB);
	const balanceNote = score === 0 ? "실력 균형 최적" : score <= 1 ? "실력 균형 양호" : "";
	const fullReason = balanceNote ? `${reason} · ${balanceNote}` : reason;

	return { teamA, teamB, gameType, reason: fullReason, strategy };
}

// ─────────────────────────────────────────────
// 혼복 팀 구성 (여+남 vs 여+남)
// ─────────────────────────────────────────────

function buildMixedTeams(
	women: SessionPlayer[],
	men: [SessionPlayer, SessionPlayer],
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

	const scoreA = pairingScore(optionA[0], optionA[1]);
	const scoreB = pairingScore(optionB[0], optionB[1]);

	return scoreA <= scoreB ? optionA : optionB;
}

// ─────────────────────────────────────────────
// 전략별 4명 선발 함수
// ─────────────────────────────────────────────

/** C(n,4) 조합 열거 헬퍼. cap 개수 제한 (성능 보호). */
function* combinations4(
	arr: SessionPlayer[],
	cap = 20,
): Generator<[SessionPlayer, SessionPlayer, SessionPlayer, SessionPlayer]> {
	const n = Math.min(arr.length, cap);
	for (let i = 0; i < n - 3; i++) {
		for (let j = i + 1; j < n - 2; j++) {
			for (let k = j + 1; k < n - 1; k++) {
				for (let l = k + 1; l < n; l++) {
					yield [arr[i], arr[j], arr[k], arr[l]];
				}
			}
		}
	}
}

/**
 * 전략 2: 동반자 회피
 * 전체 대기열에서 lastCoPlayers 겹침이 최소인 4명 조합을 탐색.
 */
function selectFourCoPlayerAvoidance(
	waiting: SessionPlayer[],
	lastCoPlayers: Record<string, string[]>,
): SelectFourResult | null {
	if (waiting.length < 4) return null;
	if (Object.keys(lastCoPlayers).length === 0) {
		// 동반자 기록이 없으면 기본 정렬 후 상위 4명
		const sorted = [...waiting].sort((a, b) => a.gameCount - b.gameCount);
		return { players: sorted.slice(0, 4), reason: "동반자 회피" };
	}

	// 동반자 연결이 적은 선수를 우선 배치하여 탐색 범위 축소
	const sorted = [...waiting].sort((a, b) => {
		const aConns = (lastCoPlayers[a.id] ?? []).filter((id) => waiting.some((p) => p.id === id)).length;
		const bConns = (lastCoPlayers[b.id] ?? []).filter((id) => waiting.some((p) => p.id === id)).length;
		return aConns - bConns;
	});

	let bestGroup: SessionPlayer[] = sorted.slice(0, 4);
	let bestOverlap = coPlayerOverlap(bestGroup, lastCoPlayers);

	if (bestOverlap === 0) return { players: bestGroup, reason: "동반자 회피" };

	for (const group of combinations4(sorted)) {
		const overlap = coPlayerOverlap(group, lastCoPlayers);
		if (overlap < bestOverlap) {
			bestOverlap = overlap;
			bestGroup = [...group];
			if (bestOverlap === 0) break;
		}
	}

	return { players: bestGroup, reason: "동반자 회피" };
}

/**
 * 전략 3: 새 조합 우선
 * pairHistory에서 한 번도 같이 한 적 없는 사람들끼리 우선 매칭.
 * 4명 중 6쌍의 "과거 동반 횟수"를 최소화.
 */
function selectFourNewCombination(
	waiting: SessionPlayer[],
	pairHistory: PairHistory,
): SelectFourResult | null {
	if (waiting.length < 4) return null;

	// pairHistory 기록이 적은 선수(다양한 상대와 덜 만남)를 우선 탐색
	const sorted = [...waiting].sort((a, b) => {
		const aSize = pairHistory[a.id]?.size ?? 0;
		const bSize = pairHistory[b.id]?.size ?? 0;
		return aSize - bSize;
	});

	/** 4명 그룹 내 6쌍 중 과거에 같이 한 쌍 수 */
	function historyOverlap(group: SessionPlayer[]): number {
		let count = 0;
		for (let i = 0; i < group.length; i++) {
			const partners = pairHistory[group[i].id];
			if (!partners) continue;
			for (let j = i + 1; j < group.length; j++) {
				if (partners.has(group[j].id)) count++;
			}
		}
		return count;
	}

	let bestGroup: SessionPlayer[] = sorted.slice(0, 4);
	let bestOverlap = historyOverlap(bestGroup);

	if (bestOverlap === 0) return { players: bestGroup, reason: "새 조합 우선" };

	for (const group of combinations4(sorted)) {
		const overlap = historyOverlap(group);
		if (overlap < bestOverlap) {
			bestOverlap = overlap;
			bestGroup = [...group];
			if (bestOverlap === 0) break;
		}
	}

	return { players: bestGroup, reason: "새 조합 우선" };
}

/**
 * 전략 4: 혼복 참여 균등
 * mixedCount가 가장 적은 남자를 강제 포함하여 혼복 편성.
 * 혼복이 불가능하면 null 반환.
 */
function selectFourMixedCountBalanced(
	waiting: SessionPlayer[],
	lastMixedPlayerIds: string[],
): SelectFourResult | null {
	const women = waiting.filter((p) => p.gender === "F");
	const men = waiting.filter((p) => p.gender === "M");

	if (women.length < 2 || men.length < 2) return null;

	// mixedCount 가장 적은 남자 2명 선발
	const sortedMen = [...men].sort((a, b) => a.mixedCount - b.mixedCount);
	const selectedMen = selectMenForMixed(sortedMen, []);

	// 여자: 직전 혼복 출전자 후순위
	const lastMixedWomenIds = lastMixedPlayerIds.filter(
		(id) => women.some((w) => w.id === id),
	);
	const selectedWomen = pickWomenPreferred(women, lastMixedWomenIds, 2);

	if (selectedWomen.length < 2) return null;

	return {
		players: [selectedWomen[0], selectedWomen[1], selectedMen[0], selectedMen[1]],
		reason: "혼복 참여 균등",
	};
}

/**
 * 전략 5: 실력 균형 최적
 * 4명의 skillScore 분산(max-min)이 최소인 조합을 탐색.
 */
function selectFourSkillBalanced(
	waiting: SessionPlayer[],
): SelectFourResult | null {
	if (waiting.length < 4) return null;

	// skillScore 기준 정렬 → 인접한 4명이 분산 최소
	const sorted = [...waiting].sort((a, b) => skillScore(a) - skillScore(b));

	let bestGroup: SessionPlayer[] = sorted.slice(0, 4);
	let bestRange = skillScore(bestGroup[3]) - skillScore(bestGroup[0]);

	if (bestRange === 0) return { players: bestGroup, reason: "실력 균형 최적" };

	// 정렬된 상태에서 슬라이딩 윈도우로 최소 range 탐색
	for (let i = 1; i <= sorted.length - 4; i++) {
		const group = sorted.slice(i, i + 4);
		const range = skillScore(group[3]) - skillScore(group[0]);
		if (range < bestRange) {
			bestRange = range;
			bestGroup = group;
			if (bestRange === 0) break;
		}
	}

	return { players: bestGroup, reason: "실력 균형 최적" };
}

/**
 * 전략 6: 랜덤 셔플
 * 대기열을 무작위로 섞은 뒤 상위 4명 선발.
 */
function selectFourRandomShuffle(
	waiting: SessionPlayer[],
): SelectFourResult | null {
	if (waiting.length < 4) return null;

	// Fisher-Yates shuffle
	const shuffled = [...waiting];
	for (let i = shuffled.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
	}

	return { players: shuffled.slice(0, 4), reason: "랜덤 셔플" };
}

// ─────────────────────────────────────────────
// 전략 디스패처
// ─────────────────────────────────────────────

interface StrategyContext {
	waiting: SessionPlayer[];
	singleWomanIds: string[];
	lastMixedPlayerIds: string[];
	lastCoPlayers: Record<string, string[]>;
	pairHistory: PairHistory;
}

function selectFourByStrategy(
	strategy: TeamStrategy,
	ctx: StrategyContext,
): SelectFourResult | null {
	switch (strategy) {
		case "gameCountBalanced":
			return selectFour(ctx.waiting, ctx.singleWomanIds, ctx.lastMixedPlayerIds, ctx.lastCoPlayers);
		case "coPlayerAvoidance":
			return selectFourCoPlayerAvoidance(ctx.waiting, ctx.lastCoPlayers);
		case "newCombination":
			return selectFourNewCombination(ctx.waiting, ctx.pairHistory);
		case "mixedCountBalanced":
			return selectFourMixedCountBalanced(ctx.waiting, ctx.lastMixedPlayerIds);
		case "skillBalanced":
			return selectFourSkillBalanced(ctx.waiting);
		case "randomShuffle":
			return selectFourRandomShuffle(ctx.waiting);
	}
}

// ─────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────

/**
 * @param lastMixedPlayerIds 직전 혼복 경기 출전자의 SessionPlayer.id 목록 (규칙 5).
 * @param lastCoPlayers 직전 게임 동반자 기록 (규칙 9).
 */
export function generateTeam(
	waiting: SessionPlayer[],
	singleWomanIds: string[],
	lastMixedPlayerIds?: string[],
	lastCoPlayers?: Record<string, string[]>,
): GeneratedTeam | null {
	if (waiting.length < 4) return null;

	const result = selectFour(waiting, singleWomanIds, lastMixedPlayerIds ?? [], lastCoPlayers ?? {});
	if (!result || result.players.length < 4) return null;

	return buildTeamFromFour(
		result.players as [SessionPlayer, SessionPlayer, SessionPlayer, SessionPlayer],
		singleWomanIds,
		result.reason,
		"gameCountBalanced",
	);
}

/**
 * 코트 배정 시 PairHistory 업데이트 (클라이언트 상태용).
 * DB pair_history upsert는 dbCompleteMatch에서 처리.
 */
export function recordHistory(
	history: PairHistory,
	team: GeneratedTeam,
): PairHistory {
	// Deep-clone Sets to avoid mutating existing state
	const next: PairHistory = {};
	for (const key of Object.keys(history)) {
		next[key] = new Set(history[key]);
	}
	const pairs: [SessionPlayer, SessionPlayer][] = [team.teamA, team.teamB];

	for (const [a, b] of pairs) {
		if (!next[a.id]) next[a.id] = new Set();
		if (!next[b.id]) next[b.id] = new Set();
		next[a.id].add(b.id);
		next[b.id].add(a.id);
	}
	return next;
}

/** 다양한 전략으로 후보를 생성할 때 사용하는 전략 순서 */
const DIVERSE_STRATEGIES: TeamStrategy[] = [
	"gameCountBalanced",
	"coPlayerAvoidance",
	"newCombination",
	"mixedCountBalanced",
	"skillBalanced",
	"randomShuffle",
];

/**
 * 세션용 팀 후보를 대량으로 생성한다.
 * 선수가 부족해지면 앞에서 사용한 선수를 다시 풀에 넣어 계속 생성한다.
 *
 * @param targetCount 생성할 팀 개수
 * @param players 전체 선수 목록
 * @param singleWomanIds 혼합 가능한 여자 선수 ID 목록
 * @param lastMixedPlayerIds 직전 혼복 경기 출전자 ID 목록
 * @param lastCoPlayers 직전 게임 동반자 기록 (규칙 9)
 * @param pairHistory 파트너 이력 (전략 3: 새 조합 우선에 사용)
 * @param existingCandidates 유지할 기존 후보 (보충 모드: 중복 방지 및 선수 사용 추적)
 * @returns 생성된 후보 팀 목록 (기존 후보 미포함, 새로 생성된 것만)
 */
export function generateBulkTeamCandidates(
	targetCount: number,
	players: SessionPlayer[],
	singleWomanIds: string[],
	lastMixedPlayerIds?: string[],
	lastCoPlayers?: Record<string, string[]>,
	pairHistory?: PairHistory,
	existingCandidates?: GeneratedTeam[],
): GeneratedTeam[] {
	const candidates: GeneratedTeam[] = [];
	const seenGroups = new Set<string>(); // 동일 4명 중복 방지
	const usedPlayerIds = new Set<string>(); // 이미 후보에 뽑힌 선수 ID

	/** 후보 생성 후 사용된 선수 기록 */
	function trackUsage(team: GeneratedTeam) {
		for (const p of [...team.teamA, ...team.teamB]) {
			usedPlayerIds.add(p.id);
		}
	}

	// 기존 후보에서 중복 방지 및 선수 사용 추적 초기화
	if (existingCandidates) {
		for (const team of existingCandidates) {
			const groupKey = [...team.teamA, ...team.teamB]
				.map((p) => p.id)
				.sort()
				.join(",");
			seenGroups.add(groupKey);
			trackUsage(team);
		}
	}

	/**
	 * 아직 아무 후보에도 안 뽑힌 선수만으로 축소된 풀 반환.
	 * 4명 미만이면 null (전체 풀로 폴백 필요).
	 */
	function getUnusedPool(): SessionPlayer[] | null {
		const unused = players.filter((p) => !usedPlayerIds.has(p.id));
		return unused.length >= 4 ? unused : null;
	}

	if (players.length < 4) {
		return candidates;
	}

	// 각 전략을 순회하며 후보 생성
	const strategies = DIVERSE_STRATEGIES.slice(0, targetCount);
	while (strategies.length < targetCount) {
		strategies.push("randomShuffle");
	}

	const baseMixedIds = lastMixedPlayerIds ?? [];
	const baseCoPlayers = lastCoPlayers ?? {};
	const basePairHistory = pairHistory ?? {};

	for (let i = 0; i < strategies.length; i++) {
		const strategy = strategies[i];

		// 1차: 아직 안 뽑힌 선수만으로 시도 → 2차: 전체 풀로 폴백
		const unusedPool = getUnusedPool();
		const pools = unusedPool ? [unusedPool, players] : [players];
		let generated = false;

		for (const pool of pools) {
			const ctx: StrategyContext = {
				waiting: pool,
				singleWomanIds,
				lastMixedPlayerIds: baseMixedIds,
				lastCoPlayers: baseCoPlayers,
				pairHistory: basePairHistory,
			};

			const result = selectFourByStrategy(strategy, ctx);
			if (!result || result.players.length < 4) continue;

			const groupKey = result.players.map((p) => p.id).sort().join(",");
			if (seenGroups.has(groupKey)) continue;

			seenGroups.add(groupKey);
			const team = buildTeamFromFour(
				result.players as [SessionPlayer, SessionPlayer, SessionPlayer, SessionPlayer],
				singleWomanIds,
				result.reason,
				strategy,
			);
			candidates.push(team);
			trackUsage(team);
			generated = true;

			break;
		}

		if (!generated) {
			// 모든 풀에서 실패 → 랜덤 셔플로 대체
			if (strategy !== "randomShuffle") {
				const fallbackPool = unusedPool ?? players;
				for (let retry = 0; retry < 3; retry++) {
					const fallback = selectFourRandomShuffle(fallbackPool);
					if (!fallback || fallback.players.length < 4) break;
					const fbKey = fallback.players.map((p) => p.id).sort().join(",");
					if (!seenGroups.has(fbKey)) {
						seenGroups.add(fbKey);
						const team = buildTeamFromFour(
							fallback.players as [SessionPlayer, SessionPlayer, SessionPlayer, SessionPlayer],
							singleWomanIds,
							fallback.reason,
							"randomShuffle",
						);
						candidates.push(team);
						trackUsage(team);
						break;
					}
				}
			}
		}
	}

	return candidates;
}
