/**
 * recommendTeammates.ts
 *
 * 보드의 "팀 구성 중" 그룹에서 빈 슬롯(+)을 눌렀을 때 보여줄 추천 팀원 순위를 계산한다.
 *
 * 기존 rankCandidates(실력 스프레드·그룹 재결성 회피·참여수·대기)를 기반(base cost)으로 두고,
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
import { rankCandidates, type RankContext, type RankedCandidate, type Weights } from "./rankCandidates";

export interface RecommendContext extends RankContext {
	/** session_player.id → 직전(또는 현재 진행중) 경기의 게임 타입 */
	lastGameType: Record<string, GameType>;
	/** 현재 코트에서 경기중인 session_player.id */
	playingIds: ReadonlySet<string>;
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
}

export const RECOMMEND_WEIGHTS: RecommendWeights = {
	// ── 선발 핵심 3축: 경기수(W_GAME) ↔ 재결성 회피(W_GROUP2<3<4 에스컬레이션) ↔ 실력(W_SKILL) ──
	// 이 서비스는 "같은 경기를 할 4명"을 뽑는 것이고, 그 4명의 2v2 실력 균형은 페어 편성(pairPlayers)이
	// interDiff/intraDiff로 따로 잡는다. 재결성 회피(2026-07 개편)는 쌍 누적이 아니라 "과거 경기 4인과의
	// 겹침 수" 단위: 2명 겹침은 경기수(1판=10)를 못 뒤집는 타이브레이크, 3명 겹침은 1판을 넘어서고,
	// 4명 완전 재결성은 사실상 금지 수준 — 경기중 선수 ghost 페널티(W_PLAYING 30)보다도 커서
	// "재결성될 바엔 경기중에서 데려오는" 선택이 성립한다.
	W_GAME: 10.0, // 경기수 최우선 — 적게 뛴 사람부터(절대 판수 gameCount)
	W_GROUP2: 8.0, // 과거 그룹과 2명 겹침(2명 유지+2명 교체) — 경기수 1판(10)을 못 뒤집는 최대값(구 Σc² 1회 동반과 등가)
	W_GROUP3: 24.0, // 과거 그룹과 3명 겹침(3명 유지+1명 교체) — 경기수 1판을 훌쩍 넘는 회피
	W_GROUP4: 60.0, // 과거 그룹 4명 완전 재결성 — 사실상 금지(W_PLAYING 30·W_GENDER 50보다 크게)
	W_SKILL: 1.5, // 실력 — 스프레드 증가분(밴드 확장)에만 작동
	// 확장폭의 제곱(1.5·k²): k=2는 6으로 경기수 1판(10)에 밀리고 k=3(13.5)부터 넘어선다. 구 선형 3.0k는
	// 큰 확장(k=6 → 18)도 2판 차이에 밀려, 남녀 등급 분포가 어긋난 로스터의 혼복에서 벌어진 팀이 그대로
	// 편성되는 원인이었다(2026-07-28 세션 73 감사). 근거·스윕: rankCandidates.ts DEFAULT_WEIGHTS 주석.
	W_SKILL_EXP: 2,
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

			return {
				player,
				score: s,
				breakdown: breakdown ? { ...breakdown, rotate, gender, playing } : undefined,
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
 * @param pool 후보 풀(호출자가 휴식/타팀소속 등 필터 완료. 경기중 선수 포함 가능 — maxPlaying으로 상한).
 * @param count 채울 인원 수(보통 4 − confirmed.length).
 * @param opts.maxPlaying 이번 호출에서 뽑을 경기중(ghost 예약) 선수 상한. 기본 0(대기 선수만).
 *   "팀당 1명" 불변식은 호출자 책임 — confirmed에 이미 있는 경기중 멤버(기존 ghost 예약·수동 선택)를
 *   차감해 전달해야 한다(autoFillTarget 참조). ghost는 그 선수의 현재 경기가 끝나야 합류하므로(코트
 *   대기 비용), 시뮬레이션 근거로 팀당 1명이 권장 상한 — 상한 없이 열면 "같은 진행중 경기의 2명"을
 *   함께 뽑아 방금 뛴 둘이 곧바로 또 뭉치는 역효과가 난다.
 * @returns 뽑힌 후보를 추천된 순서대로 반환. 풀이 모자라면 가능한 만큼만.
 */
export function autoFillTeammates(
	confirmed: SessionPlayer[],
	pool: SessionPlayer[],
	ctx: RecommendContext,
	count: number,
	weights: RecommendWeights = RECOMMEND_WEIGHTS,
	opts: { maxPlaying?: number } = {},
): SessionPlayer[] {
	const maxPlaying = opts.maxPlaying ?? 0;
	const picks: SessionPlayer[] = [];
	const working = [...confirmed];
	let remaining = [...pool];
	let playingPicked = 0;
	for (let i = 0; i < count && remaining.length > 0; i++) {
		const ranked = recommendTeammates(working, remaining, ctx, weights);
		// 경기중 선발 상한 도달 시 비경기중 후보 중 최상위로 — 상한 안에서는 순수 추천순(W_PLAYING 페널티 반영).
		const pick = ranked.find(
			(r) => playingPicked < maxPlaying || !ctx.playingIds.has(r.player.id),
		);
		if (!pick) break;
		const best = pick.player;
		if (ctx.playingIds.has(best.id)) playingPicked++;
		picks.push(best);
		working.push(best);
		remaining = remaining.filter((p) => p.id !== best.id);
	}
	return picks;
}
