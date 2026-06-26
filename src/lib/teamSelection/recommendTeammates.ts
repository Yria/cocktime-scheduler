/**
 * recommendTeammates.ts
 *
 * 보드의 "팀 구성 중" 그룹에서 빈 슬롯(+)을 눌렀을 때 보여줄 추천 팀원 순위를 계산한다.
 *
 * 기존 rankCandidates(실력 유사도·과거 파트너·직전 동반·참여수·대기)를 기반(base cost)으로 두고,
 * 보드 추천에 특화된 세 가지 요소를 가산한다. 점수는 "낮을수록 좋음"(비용) — 오름차순 정렬.
 *
 * 추가 요소:
 *  1) W_ROTATE / W_ROTATE_REPEAT — 게임 타입 로테이션. 시드 시점과 후보 시점을 분리해 합산한다.
 *     - 후보 본인: 목표 타입과 같으면 +W_ROTATE(또 같은 경기 → 강하게 하위), 다르면 −W_ROTATE. 대칭.
 *       (예: 직전 혼복 후보는 혼복 팀에 넣으면 "또 혼복"이라 하위, 직전 남/여복 후보는 혼복 팀에 우대.)
 *     - 시드(확정 멤버): 같으면 약한 페널티 +W_ROTATE_REPEAT, 다르면 −W_ROTATE. 반복을 약하게 두어
 *       동성 시드(예: 남필립)에서 동성 후보가 과도하게 하위로 밀리지 않게 한다.
 *  2) W_GENDER / W_MIXED_COMPLETE — 성별 균형. 혼복(2남2녀) 목표에서 한쪽이 3명 이상이면 페널티(W_GENDER, 하위),
 *     반대로 confirmed가 이미 남녀 혼합(혼복 구조)이면 2남2녀를 채우는 부족 성별 후보에 보너스(W_MIXED_COMPLETE, 상위).
 *  3) W_PLAYING — 경기중 후보 페널티. 대기 선수가 상위에 오도록.
 */
import type { GameType, SessionPlayer } from "../../types";
import type { ForcedPair } from "../../types/board";
import { rankCandidates, type RankContext, type RankedCandidate, type Weights } from "./rankCandidates";

export interface RecommendContext extends RankContext {
	/** session_player.id → 직전(또는 현재 진행중) 경기의 게임 타입 */
	lastGameType: Record<string, GameType>;
	/** 현재 코트에서 경기중인 session_player.id */
	playingIds: ReadonlySet<string>;
	/** 의도적 그룹(드래그로 직접 묶음)의 재편성 회피 쌍 — 이 둘이 다시 만나면 강한 페널티(decay). */
	forcedPairs?: ForcedPair[];
	/** forced 페널티 decay 기준 클럭(세션 누적 배정수 matchAssignCount). 없으면 decay 0(=full). */
	matchAssignCount?: number;
}

/** forced 페널티가 0이 되기까지의 경과 라운드(중간 길이). 이 이상 다른 경기가 지나면 회피 해제. */
export const FORCED_WINDOW = 6;

/** 무순서 쌍 키. */
function pairKey(a: string, b: string): string {
	return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/** forcedPairs → 쌍키별 fromCount(여러 번 묶였으면 가장 최근=fromCount 최대). */
function buildForcedLookup(forcedPairs?: ForcedPair[]): Map<string, number> {
	const m = new Map<string, number>();
	if (!forcedPairs) return m;
	for (const f of forcedPairs) {
		const k = pairKey(f.a, f.b);
		const prev = m.get(k);
		if (prev === undefined || f.fromCount > prev) m.set(k, f.fromCount);
	}
	return m;
}

/** 경과 라운드 → 선형 decay 계수(0~1). 묶인 직후 1(=full), FORCED_WINDOW 경과 시 0. 음수/NaN은 클램프(레이스·손상 데이터 방어). */
export function forcedDecay(elapsed: number): number {
	if (!Number.isFinite(elapsed)) return 0;
	return Math.max(0, Math.min(1, 1 - elapsed / FORCED_WINDOW));
}

export interface RecommendWeights extends Weights {
	/** 로테이션 보너스 — 직전과 다른 성격의 게임으로 가는 후보에 주는 보너스 크기 */
	W_ROTATE: number;
	/** 반복 페널티 — 직전과 같은 성격(예: 또 남복)을 하는 후보에 주는 페널티. 보너스(W_ROTATE)보다 작게 둔다. */
	W_ROTATE_REPEAT: number;
	/** 혼복(2남2녀) 목표에서 성별 초과(3명 이상) 후보 페널티 */
	W_GENDER: number;
	/** 혼복 완성 보너스 — confirmed가 이미 남녀 혼합일 때 2남2녀에 부족한 성별 후보 우대 */
	W_MIXED_COMPLETE: number;
	/** 경기중 후보 페널티(대기 선수 우선) */
	W_PLAYING: number;
	/** 의도적으로 묶었던 쌍의 재편성 회피 — 묶인 직후 초기 페널티(라운드 경과로 선형 decay, 절대 금지는 아님) */
	W_FORCED: number;
}

export const RECOMMEND_WEIGHTS: RecommendWeights = {
	W_SKILL: 20.0, // 실력 유사 최우선
	W_PAIR: 8.0, // 동반 회피 — 함께 뛴 누적 횟수(직전+과거 통합). 같이 안 뛴 사람 우선
	W_GAME: 1.0, // 적게 뛴 사람 우선(절대 판수 gameCount, 보조)
	W_MIXED: 0, // 누적 혼복수는 로테이션(W_ROTATE)으로 대체
	// 오래 쉰(대기) 사람 강한 우선 — 연속 휴식 편차(누군 2번 쉬고 누군 2번 연속) 완화. 대기 분(分)에 비례해
	// 점수를 낮춘다(−waitMinutes×W_WAIT). waitSince는 경기 완료/휴식 복귀로 대기 진입할 때 갱신되므로,
	// 계속 못 들어간 사람만 값이 커져(자연 리셋) 다음 경기에 확실히 들어온다. ※ 분 단위라 실제 휴식 시간에
	// 비례 — 너무 세거나 약하면 이 값을 조절(튜닝 knob).
	W_WAIT: 1.0,
	W_ROTATE: 6.0, // 로테이션 보너스(직전과 다른 타입으로 전환)
	W_ROTATE_REPEAT: 2.0, // 반복 페널티(직전과 같은 타입 반복) — 보너스보다 작게 해 동성 시드의 동성 후보가 과하게 밀리지 않게
	W_GENDER: 50.0, // 혼복 성별 초과 = 하위
	W_MIXED_COMPLETE: 8.0, // 혼복 구조(남녀 혼합) 완성에 필요한 부족 성별 = 상위
	W_PLAYING: 30.0, // 경기중 = 하위(대기 우선)
	W_FORCED: 48.0, // 의도적으로 묶었던 쌍 재편성 = 강하게 하위(W_GENDER급). FORCED_WINDOW 라운드에 걸쳐 0으로 decay
};

/** 여자가 포함된(양성) 게임 타입인가 — 혼복/혼합. */
function isMixedType(gt: GameType | undefined): boolean {
	return gt === "혼복" || gt === "혼합";
}

/**
 * 이미 확정된 팀 멤버(confirmed)가 있을 때, pool에서 추천 팀원 순위를 점수 오름차순으로 반환한다.
 *
 * @param confirmed 현재 팀 멤버(anchor + ghost). pool에 포함되지 않아야 함.
 * @param pool 후보 풀(이 팀 멤버·대기열 예약자 제외, 경기중 선수 포함 가능).
 * @param ctx 히스토리 + lastGameType + playingIds
 */
export function recommendTeammates(
	confirmed: SessionPlayer[],
	pool: SessionPlayer[],
	ctx: RecommendContext,
	weights: RecommendWeights = RECOMMEND_WEIGHTS,
): RankedCandidate[] {
	const baseM = confirmed.filter((p) => p.gender === "M").length;
	const baseF = confirmed.filter((p) => p.gender === "F").length;
	const forcedLookup = buildForcedLookup(ctx.forcedPairs);

	return rankCandidates(confirmed, pool, ctx, weights)
		.map(({ player, score, breakdown }) => {
			let s = score;
			const m = baseM + (player.gender === "M" ? 1 : 0);
			const f = baseF + (player.gender === "F" ? 1 : 0);
			// 후보를 더하면 팀이 양성 혼합(혼복 지향)인가, 동성(남복/여복 지향)인가
			const targetMixed = m > 0 && f > 0;

			// 1) 게임 타입 로테이션 — 시드 시점과 후보 시점을 분리해 합산.
			let rotate = 0;
			//  - 시드(확정 멤버) 시점: 같은 성격이면 약한 페널티(+W_ROTATE_REPEAT), 다르면 보너스(−W_ROTATE).
			//    반복을 약하게 두어 동성 시드(예: 남필립)에서 동성 후보가 과도하게 밀리지 않게 한다.
			for (const subj of confirmed) {
				const last = ctx.lastGameType[subj.id];
				if (!last) continue;
				rotate += isMixedType(last) === targetMixed ? weights.W_ROTATE_REPEAT : -weights.W_ROTATE;
			}
			//  - 후보 본인 시점: 대칭(±W_ROTATE). 직전과 같은 성격을 또 하게 되면 강하게 하위.
			//    (예: 직전 혼복 후보는 혼복 팀에 넣으면 "또 혼복"이라 하위, 직전 남/여복 후보는 혼복 팀에 우대.)
			const candidateLast = ctx.lastGameType[player.id];
			if (candidateLast) {
				rotate += isMixedType(candidateLast) === targetMixed ? weights.W_ROTATE : -weights.W_ROTATE;
			}
			s += rotate;

			// 2) 성별 균형
			//    - 초과 페널티: 혼복(2남2녀) 목표인데 한쪽 성별이 3명 이상이면 +W_GENDER(하위)
			//    - 혼복 완성 보너스: confirmed가 이미 남녀 혼합(혼복 구조)이면, 2남2녀를 채우는
			//      "아직 2명 미만인(부족한) 성별" 후보에 −W_MIXED_COMPLETE(상위). 1남1녀처럼 양쪽 다 부족하면 동일 가산이라 편향 없음.
			let gender = 0;
			let genderImbalance = targetMixed && (m > 2 || f > 2);
			// '남복 편성 허용' 여성 예외 — 1F3M 구성에서 그 여성이 allowMixedSingle이면 성별 페널티 면제
			// (남자 경기에 넣어도 되는 여성이므로 추천 후보로 올라오게 한다). candidate 또는 confirmed의 단독 여성.
			if (genderImbalance && m === 3 && f === 1) {
				const woman = player.gender === "F" ? player : confirmed.find((p) => p.gender === "F");
				if (woman?.allowMixedSingle) genderImbalance = false;
			}
			if (genderImbalance) gender += weights.W_GENDER;
			const baseMixed = baseM > 0 && baseF > 0;
			if (baseMixed) {
				const fillsShortage = player.gender === "M" ? baseM < 2 : baseF < 2;
				if (fillsShortage) gender -= weights.W_MIXED_COMPLETE;
			}
			s += gender;

			// 3) 경기중 후보 페널티(대기 선수 우선)
			const playing = ctx.playingIds.has(player.id) ? weights.W_PLAYING : 0;
			s += playing;

			// 4) 의도적 그룹 재편성 회피 — confirmed 각 멤버와 후보가 "묶였던 쌍"이면 강한 페널티.
			//    묶인 직후 W_FORCED(full), 그 뒤 다른 경기가 지날수록(matchAssignCount 증가) 선형 decay → 0이면 자연 복귀.
			//    pairHistory와 동일하게 confirmed별로 합산(여러 명과 묶였으면 더 멀어짐). 절대 금지가 아니라 "꽤 많이" 하위.
			let forced = 0;
			// matchAssignCount(decay 클럭)가 없으면 forced 페널티 미적용(안전) — 클럭 없이는 decay 산정 불가.
			if (forcedLookup.size > 0 && ctx.matchAssignCount !== undefined) {
				const mac = ctx.matchAssignCount;
				for (const subj of confirmed) {
					const from = forcedLookup.get(pairKey(subj.id, player.id));
					if (from === undefined) continue;
					// 음수 경과(크로스클라이언트 동기 레이스: 내 matchAssignCount < 기록된 fromCount)는 forcedDecay가 1로 클램프.
					forced += weights.W_FORCED * forcedDecay(mac - from);
				}
			}
			s += forced;

			return {
				player,
				score: s,
				breakdown: breakdown ? { ...breakdown, rotate, gender, playing, forced } : undefined,
			};
		})
		.sort((a, b) => a.score - b.score);
}

/**
 * 자동편성 — 빈 슬롯을 추천도 높은순으로 greedy하게 채운다.
 *
 * 알고리즘 특성상 추천 점수는 "현재 확정 멤버가 누구냐"에 따라 매번 달라지므로,
 * 한 명을 뽑을 때마다 confirmed에 합치고 recommendTeammates를 다시 돌려 다음 1명을 고른다.
 * (한 번에 상위 N명을 자르는 방식과 다르다 — 매 라운드 재평가가 핵심.)
 *
 * @param confirmed 현재 확정 멤버(0~3명). pool에 포함되지 않아야 함.
 * @param pool 후보 풀(호출자가 경기중/휴식/타팀소속 등 필터 완료).
 * @param count 채울 인원 수(보통 4 − confirmed.length).
 * @returns 뽑힌 후보를 추천된 순서대로 반환. 풀이 모자라면 가능한 만큼만.
 */
export function autoFillTeammates(
	confirmed: SessionPlayer[],
	pool: SessionPlayer[],
	ctx: RecommendContext,
	count: number,
	weights: RecommendWeights = RECOMMEND_WEIGHTS,
): SessionPlayer[] {
	const picks: SessionPlayer[] = [];
	const working = [...confirmed];
	let remaining = [...pool];
	for (let i = 0; i < count && remaining.length > 0; i++) {
		const ranked = recommendTeammates(working, remaining, ctx, weights);
		if (ranked.length === 0) break;
		const best = ranked[0].player;
		picks.push(best);
		working.push(best);
		remaining = remaining.filter((p) => p.id !== best.id);
	}
	return picks;
}
