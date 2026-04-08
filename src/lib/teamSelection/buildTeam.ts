/**
 * buildTeam.ts
 *
 * rankCandidates를 반복 호출하여 4명을 선발하고,
 * pairPlayers로 최적 페어를 편성하여 GeneratedTeam을 반환한다.
 */
import type { GeneratedTeam, PairHistory, SessionPlayer } from "../../types";
import { rankCandidates, WEIGHT_PROFILES, type RankContext, type Weights } from "./rankCandidates";
import { pairPlayers } from "./pairPlayers";

// ─────────────────────────────────────────────
// 타입
// ─────────────────────────────────────────────

export interface BuildTeamContext {
	pairHistory: PairHistory;
	lastCoPlayers: Record<string, string[]>;
	singleWomanIds: string[];
}

// ─────────────────────────────────────────────
// 단일 팀 선발
// ─────────────────────────────────────────────

/**
 * pool에서 rankCandidates를 4번 반복하여 4명을 선발하고 팀을 편성한다.
 *
 * @param pool 후보 풀 (호출자가 구성 및 필터링 완료)
 * @param context 히스토리 정보 및 singleWomanIds
 * @param options.pickIndices 각 라운드에서 몇 번째 후보를 선택할지
 * @param options.weights 가중치 오버라이드
 * @param options.reason 이유 라벨 오버라이드
 * @returns GeneratedTeam, pool이 4명 미만이면 null
 */
export function buildTeam(
	pool: SessionPlayer[],
	context: BuildTeamContext,
	options?: {
		pickIndices?: [number, number, number, number];
		weights?: Weights;
		reason?: string;
	},
): GeneratedTeam | null {
	if (pool.length < 4) return null;

	const pickIndices = options?.pickIndices ?? [0, 0, 0, 0];
	const weights = options?.weights;

	const rankCtx: RankContext = {
		pairHistory: context.pairHistory,
		lastCoPlayers: context.lastCoPlayers,
	};

	const confirmed: SessionPlayer[] = [];
	const remaining = [...pool];

	for (let round = 0; round < 4; round++) {
		const ranked = rankCandidates(confirmed, remaining, rankCtx, weights);
		if (ranked.length === 0) return null;

		const pickIdx = Math.min(pickIndices[round], ranked.length - 1);
		const picked = ranked[pickIdx].player;

		confirmed.push(picked);
		const idx = remaining.findIndex((p) => p.id === picked.id);
		if (idx !== -1) remaining.splice(idx, 1);
	}

	// reason: 명시적 전달 > 성별 기반 자동 결정
	const women = confirmed.filter((p) => p.gender === "F").length;
	const autoReason =
		women === 2 ? "혼복 우선" :
		women === 4 ? "여복 편성" :
		"게임수 균등";
	const reason = options?.reason ?? autoReason;

	return pairPlayers(
		confirmed as [SessionPlayer, SessionPlayer, SessionPlayer, SessionPlayer],
		context.singleWomanIds,
		reason,
	);
}

// ─────────────────────────────────────────────
// 다전략 후보 생성
// ─────────────────────────────────────────────

/** 4명 조합의 중복 감지용 키 생성 */
function groupKey(team: GeneratedTeam): string {
	return [...team.teamA, ...team.teamB].sort().join(",");
}

/** Fisher-Yates 셔플 (원본 변경 없이 복사본 반환) */
function shuffle<T>(arr: T[]): T[] {
	const copy = [...arr];
	for (let i = copy.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[copy[i], copy[j]] = [copy[j], copy[i]];
	}
	return copy;
}

/** 라운드별 랜덤 pickIndex 생성 (상위 N명 중 랜덤 선택) */
function randomPickIndices(): [number, number, number, number] {
	return [
		Math.floor(Math.random() * 3), // 상위 3명 중
		Math.floor(Math.random() * 2), // 상위 2명 중
		Math.floor(Math.random() * 2),
		0,
	];
}

/**
 * 다양한 가중치 프로필로 팀 후보를 생성한다.
 * 각 프로필은 다른 기준으로 선수를 선발하여 다양한 이유의 후보를 만든다.
 *
 * @param count 생성할 팀 후보 수
 * @param pool 후보 풀
 * @param context 히스토리 정보
 * @returns 중복 없는 팀 후보 목록
 */
export function generateCandidateTeams(
	count: number,
	pool: SessionPlayer[],
	context: BuildTeamContext,
): GeneratedTeam[] {
	if (pool.length < 4) return [];

	const results: GeneratedTeam[] = [];
	const seenKeys = new Set<string>();

	function tryAdd(team: GeneratedTeam | null): boolean {
		if (!team) return false;
		const key = groupKey(team);
		if (seenKeys.has(key)) return false;
		seenKeys.add(key);
		results.push(team);
		return true;
	}

	// 1단계: 각 가중치 프로필로 1팀씩 (프로필 순서 셔플로 다양성 확보)
	const profileKeys = shuffle(Object.keys(WEIGHT_PROFILES));
	for (const profileKey of profileKeys) {
		if (results.length >= count) break;
		const profile = WEIGHT_PROFILES[profileKey];
		tryAdd(buildTeam(pool, context, { weights: profile.weights, reason: profile.label }));
	}

	// 2단계: 부족하면 프로필별 랜덤 pickIndices 변주
	for (const profileKey of profileKeys) {
		if (results.length >= count) break;
		const profile = WEIGHT_PROFILES[profileKey];
		for (let v = 0; v < 3; v++) {
			if (results.length >= count) break;
			tryAdd(buildTeam(pool, context, {
				weights: profile.weights,
				reason: profile.label,
				pickIndices: randomPickIndices(),
			}));
		}
	}

	// 3단계: 그래도 부족하면 셔플 풀로 랜덤 생성
	const maxAttempts = (count - results.length) * 5;
	for (let attempt = 0; results.length < count && attempt < maxAttempts; attempt++) {
		tryAdd(buildTeam(shuffle(pool), context, { reason: "랜덤 셔플" }));
	}

	return results;
}
