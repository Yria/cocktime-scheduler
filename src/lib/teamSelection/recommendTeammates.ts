/** Whole-group recommendation: availability, playable courts, fair participation,
 * repeated companions, then skill proximity with personal cross-band exchange debt.
 * The same search serves the picker and automatic fill, including fixed members. */
import type { GameType, SessionPlayer } from "../../types";
import type { RankContext } from "./rankCandidates";
import { skillScore } from "./rankCandidates";
import { allowedGameType, buildExchangeState, canCompleteComposition, exchangeCost, EXCHANGE_INTERVAL, groupCapacity, orderedGroupHistory } from "./groupPolicy";

export interface RecommendContext extends RankContext {
	lastGameType: Record<string, GameType>;
	playingIds: ReadonlySet<string>;
	/** Full session roster, including people reserved elsewhere, for historical skills. */
	players?: readonly SessionPlayer[];
	cockCheckEnabled?: boolean;
}

export interface RecommendWeights {
	W_GAME: number;
	W_WAIT: number;
	W_ROTATE: number;
	W_PLAYING: number;
	W_SKILL: number;
	EXCHANGE_INTERVAL: number;
}
export const RECOMMEND_WEIGHTS: RecommendWeights = {
	W_GAME: 10, W_WAIT: 1, W_ROTATE: 6, W_PLAYING: 30, W_SKILL: 1.5, EXCHANGE_INTERVAL,
};

/** Compared in this order, never summed across priorities. */
export interface GroupScore {
	playing: number;
	remainingCapacity: number;
	overplay: number;
	maximumOverlap: number;
	repeatedPairs: number;
	quality: number;
}
export interface RankedTeammate { player: SessionPlayer; priority: GroupScore }
interface GroupChoice { picks: SessionPlayer[]; priority: GroupScore }
interface SearchResult { best?: GroupChoice; ranked: RankedTeammate[] }

interface FillOptions {
	maxPlaying?: number;
	/** Deliberately leave the rest open in a waiting draft. */
	targetSize?: number;
	/** Preserve feasible completions for the other waiting drafts. */
	acceptCompletion?: (picks: readonly SessionPlayer[]) => boolean;
}

export function compareGroupScores(a: GroupScore, b: GroupScore): number {
	return a.playing - b.playing || b.remainingCapacity - a.remainingCapacity || a.overplay - b.overplay
		|| a.maximumOverlap - b.maximumOverlap || a.repeatedPairs - b.repeatedPairs
		|| (Math.abs(a.quality - b.quality) > 1e-9 ? a.quality - b.quality : 0);
}

function unique(players: readonly SessionPlayer[]) {
	return [...new Map(players.map(p => [p.id, p])).values()];
}

function searchGroups(
	confirmed: SessionPlayer[], pool: SessionPlayer[], ctx: RecommendContext, weights: RecommendWeights,
	maxPlaying: number, options: FillOptions = {},
): SearchResult {
	const empty: SearchResult = { ranked: [] };
	confirmed = unique(confirmed);
	if (confirmed.length >= 4) return empty;
	const eligible = (p: SessionPlayer) => p.status !== "resting" && (!ctx.cockCheckEnabled || p.cockChecked);
	if (confirmed.some(p => !eligible(p)) || !canCompleteComposition(confirmed)) return empty;
	const fixedIds = new Set(confirmed.map(p => p.id));
	pool = unique(pool).filter(p => !fixedIds.has(p.id) && eligible(p) && (maxPlaying > 0 || !ctx.playingIds.has(p.id)));
	if (!pool.length) return empty;
	const slots = (options.targetSize ?? 4) - confirmed.length;
	if (slots <= 0) return empty;
	// A short pool can still form a partial draft. When four are available, an
	// illegal foursome must fail rather than disguising itself as a partial success.
	const size = Math.min(slots, pool.length);
	const now = Date.now();
	const roster = unique([...(ctx.players ?? []), ...confirmed, ...pool]);
	const active = new Set(roster.filter(eligible).map(p => p.id));
	const history = orderedGroupHistory(ctx.groupHistory);
	const exchange = buildExchangeState(roster, history, active, now);
	const all = [...confirmed, ...pool], ready = all.filter(p => !ctx.playingIds.has(p.id));
	const lowestCount = Math.min(...(ready.length ? ready : all).map(p => p.gameCount));
	const grades = new Map(all.map(p => [p.id, skillScore(p)]));
	const category = (p: SessionPlayer) => p.gender === "M" ? 0 : (grades.get(p.id) ?? 0) >= 4 ? 2 : 1;
	const readyCounts = [0, 0, 0];
	ready.forEach(p => readyCounts[category(p)]++);
	const capacityMemo = new Map<string, number>();
	const historySets = history.map(g => new Set(g.members));
	const pairs = new Map<string, Map<string, number>>();
	for (const group of historySets) {
		for (const a of group) for (const b of group) if (a !== b) {
			if (!pairs.has(a)) pairs.set(a, new Map());
			const row = pairs.get(a)!;
			row.set(b, (row.get(b) ?? 0) + 1);
		}
	}
	const costs = new Map(all.map(p => {
		const since = Date.parse(p.waitSince ?? "");
		const wait = !ctx.playingIds.has(p.id) && Number.isFinite(since) ? Math.max(0, now - since) / 60000 : 0;
		return [p.id, p.gameCount * weights.W_GAME - wait * weights.W_WAIT + (ctx.playingIds.has(p.id) ? weights.W_PLAYING : 0)];
	}));
	const overplay = new Map(all.map(p => [p.id, Math.max(0, p.gameCount - lowestCount - 1)]));
	let best: GroupChoice | undefined;
	const byCandidate = new Map<string, GroupScore>();

	function consider(picks: SessionPlayer[]) {
		if (options.acceptCompletion && !options.acceptCompletion(picks)) return;
		const members = [...confirmed, ...picks];
		const playing = members.filter(p => ctx.playingIds.has(p.id)).length;
		if (playing === members.length) return; // A draft requires a waiting anchor.
		if (picks.filter(p => ctx.playingIds.has(p.id)).length > maxPlaying) return;
		const type = allowedGameType(members);
		if (members.length === 4 ? !type : !canCompleteComposition(members)) return;
		const counts = [...readyCounts];
		for (const p of members) if (!ctx.playingIds.has(p.id)) counts[category(p)]--;
		const remainingCapacity = groupCapacity(counts[0], counts[1], counts[2], capacityMemo);
		const excess = members.reduce((sum, p) => sum + overplay.get(p.id)!, 0);
		let maximumOverlap = 0;
		for (const group of historySets) {
			let overlap = 0;
			for (const p of members) if (group.has(p.id)) overlap++;
			maximumOverlap = Math.max(maximumOverlap, overlap - 1);
		}
		let repeatedPairs = 0;
		for (let i = 0; i < members.length; i++) for (let j = i + 1; j < members.length; j++) repeatedPairs += pairs.get(members[i].id)?.get(members[j].id) ?? 0;
		const rated = members.map(p => grades.get(p.id)!).filter(g => Number.isFinite(g) && g > 0);
		const spread = rated.length ? Math.max(...rated) - Math.min(...rated) : 0;
		const mixed = members.some(p => p.gender === "M") && members.some(p => p.gender === "F");
		const rotation = members.reduce((sum, p) => {
			const last = ctx.lastGameType[p.id];
			return sum + (!last ? 0 : ((last === "혼복" || last === "혼합") === mixed ? weights.W_ROTATE : -weights.W_ROTATE));
		}, 0);
		const quality = members.reduce((sum, p) => sum + costs.get(p.id)!, 0) + rotation + weights.W_SKILL
			* (spread ** 2 + exchangeCost(members.map(p => p.id), exchange, weights.EXCHANGE_INTERVAL));
		const priority: GroupScore = { playing, remainingCapacity, overplay: excess, maximumOverlap, repeatedPairs, quality };
		if (!best || compareGroupScores(priority, best.priority) < 0) best = { picks: [...picks], priority };
		for (const p of picks) {
			const previous = byCandidate.get(p.id);
			if (!previous || compareGroupScores(priority, previous) < 0) byCandidate.set(p.id, priority);
		}
	}
	function enumerate(candidates: SessionPlayer[]) {
		const picks: SessionPlayer[] = [];
		function visit(start: number) {
			if (picks.length === size) { consider(picks); return; }
			for (let i = start; i <= candidates.length - (size - picks.length); i++) {
				picks.push(candidates[i]); visit(i + 1); picks.pop();
			}
		}
		visit(0);
	}
	// This separation is deliberate: no quality or repetition advantage can pull
	// a playing candidate into a team when the remaining slots can be filled now.
	enumerate(pool.filter(p => !ctx.playingIds.has(p.id)));
	if (!best && maxPlaying > 0) enumerate(pool);
	if (!best) return empty;
	const winner: GroupChoice = best;
	const ranked = pool.flatMap(player => {
		const priority = byCandidate.get(player.id);
		// Keep only candidates that can complete a group with minimum busy players
		// and maximum remaining ready capacity, respecting the user's fixed members.
		return priority && priority.playing === winner.priority.playing && priority.remainingCapacity === winner.priority.remainingCapacity ? [{ player, priority }] : [];
	}).sort((a, b) => compareGroupScores(a.priority, b.priority));
	return { best: winner, ranked };
}

/** Each candidate is ranked by its best feasible four-person completion. */
export function recommendTeammates(
	confirmed: SessionPlayer[], pool: SessionPlayer[], ctx: RecommendContext,
	weights: RecommendWeights = RECOMMEND_WEIGHTS,
): RankedTeammate[] {
	return searchGroups(confirmed, pool, ctx, weights, Math.max(0, 3 - confirmed.filter(p => ctx.playingIds.has(p.id)).length)).ranked;
}

/** Select the whole completion at once; fixed manual members are never replaced. */
export function autoFillTeammates(
	confirmed: SessionPlayer[], pool: SessionPlayer[], ctx: RecommendContext, count: number,
	weights: RecommendWeights = RECOMMEND_WEIGHTS, opts: FillOptions = {},
): SessionPlayer[] {
	if (!Number.isInteger(count) || count <= 0) return [];
	if (opts.targetSize != null && (!Number.isInteger(opts.targetSize) || opts.targetSize < 2 || opts.targetSize > 4)) return [];
	return searchGroups(confirmed, pool, ctx, weights, Math.max(0, opts.maxPlaying ?? 0), opts).best?.picks.slice(0, count) ?? [];
}
