/**
 * pairPlayers.ts
 *
 * 확정된 4명을 받아 최적 페어로 편성하고 GeneratedTeam을 반환하는 순수 함수.
 *
 * 단계:
 * 1. 게임 타입 결정 (혼복/남복/여복/혼합)
 * 2. 게임 타입에 따라 페어 편성
 *    - 혼복: 여+남 vs 여+남, 실력 균형 최적 조합
 *    - 그 외: 3가지 페어 조합 중 pairingScore 최솟값 선택
 * 3. ID만 추출하여 GeneratedTeam 반환
 */
import type { GameType, GeneratedTeam, SessionPlayer } from "../../types";
import { skillScore } from "./rankCandidates";

// ─────────────────────────────────────────────
// 게임 타입 결정
// ─────────────────────────────────────────────

/**
 * 4명의 성별 구성으로 게임 타입을 결정한다.
 *
 * - 여자 0명 → 남복
 * - 여자 2명 → 혼복
 * - 여자 4명 → 여복
 * - 여자 1명 → allowMixedSingle 또는 singleWomanIds 포함 시 혼합, 아니면 남복
 * - 여자 3명 → 남복 (남자 1명 포함)
 */
export function determineGameType(
	four: [SessionPlayer, SessionPlayer, SessionPlayer, SessionPlayer],
	singleWomanIds: string[],
): GameType {
	const women = four.filter((p) => p.gender === "F");
	if (women.length === 0) return "남복";
	if (women.length === 4) return "여복";
	if (women.length === 2) return "혼복";
	if (women.length === 1) {
		const isSingleAllowed =
			women[0].allowMixedSingle || singleWomanIds.includes(women[0].playerId);
		return isSingleAllowed ? "혼합" : "남복";
	}
	// 여자 3명 (남자 1명): 남복으로 처리
	return "남복";
}

// ─────────────────────────────────────────────
// 페어링 품질 점수
// ─────────────────────────────────────────────

/**
 * 두 페어의 실력 균형을 점수로 계산한다 (낮을수록 좋음).
 *
 * score = intraDiff × 0.5 + interDiff × 1.5
 * - intraDiff: 파트너 간 실력 차이 합산 (페어 내 유사성)
 * - interDiff: 두 팀 실력 합산 차이 (팀 간 균형, 강약 교차 우선)
 */
export function pairingScore(
	teamA: [SessionPlayer, SessionPlayer],
	teamB: [SessionPlayer, SessionPlayer],
): number {
	const sA0 = skillScore(teamA[0]);
	const sA1 = skillScore(teamA[1]);
	const sB0 = skillScore(teamB[0]);
	const sB1 = skillScore(teamB[1]);

	const intraDiff = Math.abs(sA0 - sA1) + Math.abs(sB0 - sB1);
	const interDiff = Math.abs(sA0 + sA1 - (sB0 + sB1));

	return intraDiff * 0.5 + interDiff * 1.5;
}

// ─────────────────────────────────────────────
// 페어 편성 내부 헬퍼
// ─────────────────────────────────────────────

/**
 * 4명 중 3가지 페어 조합을 모두 평가해 pairingScore가 가장 낮은 조합을 반환한다.
 * 동점이면 동점 조합 중 랜덤 선택 (다양성 확보).
 */
function bestPairing(
	four: [SessionPlayer, SessionPlayer, SessionPlayer, SessionPlayer],
): [[SessionPlayer, SessionPlayer], [SessionPlayer, SessionPlayer]] {
	const [p0, p1, p2, p3] = four;

	const combos: [[SessionPlayer, SessionPlayer], [SessionPlayer, SessionPlayer]][] = [
		[[p0, p1], [p2, p3]],
		[[p0, p2], [p1, p3]],
		[[p0, p3], [p1, p2]],
	];

	let best: [[SessionPlayer, SessionPlayer], [SessionPlayer, SessionPlayer]][] = [combos[0]];
	let bestScore = pairingScore(combos[0][0], combos[0][1]);

	for (let i = 1; i < combos.length; i++) {
		const score = pairingScore(combos[i][0], combos[i][1]);
		if (score < bestScore) {
			bestScore = score;
			best = [combos[i]];
		} else if (score === bestScore) {
			best.push(combos[i]);
		}
	}

	return best[Math.floor(Math.random() * best.length)];
}

/**
 * 혼복 전용: 여자 2명 × 남자 2명을 실력 균형 기준으로 최적 크로스 배치한다.
 * (여A+남A vs 여B+남B) vs (여A+남B vs 여B+남A) 중 낮은 점수 선택.
 * 동점이면 랜덤 선택 (다양성 확보).
 */
function bestMixedPairing(
	women: [SessionPlayer, SessionPlayer],
	men: [SessionPlayer, SessionPlayer],
): [[SessionPlayer, SessionPlayer], [SessionPlayer, SessionPlayer]] {
	const optionA: [[SessionPlayer, SessionPlayer], [SessionPlayer, SessionPlayer]] = [
		[women[0], men[0]],
		[women[1], men[1]],
	];
	const optionB: [[SessionPlayer, SessionPlayer], [SessionPlayer, SessionPlayer]] = [
		[women[0], men[1]],
		[women[1], men[0]],
	];

	const scoreA = pairingScore(optionA[0], optionA[1]);
	const scoreB = pairingScore(optionB[0], optionB[1]);

	if (scoreA < scoreB) return optionA;
	if (scoreB < scoreA) return optionB;
	return Math.random() < 0.5 ? optionA : optionB;
}

// ─────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────

/**
 * 확정된 4명을 받아 최적 페어로 편성하고 GeneratedTeam을 반환한다.
 *
 * @param four 경기에 확정된 4명 (순서 무관)
 * @param singleWomanIds 혼합 허용 여성 Player.id 목록
 * @returns GeneratedTeam — teamA/B는 session_players.id 참조
 */
export function pairPlayers(
	four: [SessionPlayer, SessionPlayer, SessionPlayer, SessionPlayer],
	singleWomanIds: string[],
	reason?: string,
): GeneratedTeam {
	const gameType = determineGameType(four, singleWomanIds);

	let teamA: [SessionPlayer, SessionPlayer];
	let teamB: [SessionPlayer, SessionPlayer];

	if (gameType === "혼복") {
		const women = four.filter((p) => p.gender === "F") as [SessionPlayer, SessionPlayer];
		const men = four.filter((p) => p.gender === "M") as [SessionPlayer, SessionPlayer];
		[teamA, teamB] = bestMixedPairing(women, men);
	} else {
		[teamA, teamB] = bestPairing(four);
	}

	const score = pairingScore(teamA, teamB);
	const balanceNote = score === 0 ? "실력 균형 최적" : score <= 1 ? "실력 균형 양호" : "";
	const fullReason = [reason, balanceNote].filter(Boolean).join(" · ");

	return {
		teamA: [teamA[0].id, teamA[1].id],
		teamB: [teamB[0].id, teamB[1].id],
		gameType,
		reason: fullReason || undefined,
	};
}
