import type { GameType, GroupHistory, SessionPlayer } from "../../types";
import { skillScore } from "./rankCandidates";

export const EXCHANGE_INTERVAL = 3;

/** Four participants only; partner/opponent assignments are deliberately separate. */
export function allowedGameType(members: readonly SessionPlayer[]): GameType | null {
	if (members.length !== 4) return null;
	const women = members.filter(p => p.gender === "F");
	if (women.length === 0) return "남복";
	if (women.length === 4) return "여복";
	if (women.length === 2) return "혼복";
	return women.length === 1 && skillScore(women[0]) >= 4 ? "혼합" : null;
}

/** Incomplete drafts are allowed only when some future fourth member could make them legal. */
export function canCompleteComposition(members: readonly SessionPlayer[]): boolean {
	const women = members.filter(p => p.gender === "F"), men = members.length - women.length;
	return members.length <= 4 && ((women.length === 0 && men <= 4) || (men === 0 && women.length <= 4)
		|| (men <= 2 && women.length <= 2) || (men <= 3 && women.length <= 1 && women.every(p => skillScore(p) >= 4)));
}

/** Maximum disjoint legal foursomes; no roster-size/32-bit mask limit. */
export function groupCapacity(men: number, lowWomen: number, highWomen: number, memo = new Map<string, number>()): number {
	const key = `${men},${lowWomen},${highWomen}`;
	const cached = memo.get(key);
	if (cached !== undefined) return cached;
	let best = 0;
	const patterns = [[4, 0, 0], [3, 0, 1], ...Array.from({ length: 3 }, (_, high) => [2, 2 - high, high]), ...Array.from({ length: 5 }, (_, high) => [0, 4 - high, high])];
	for (const [m, low, high] of patterns) if (men >= m && lowWomen >= low && highWomen >= high)
		best = Math.max(best, 1 + groupCapacity(men - m, lowWomen - low, highWomen - high, memo));
	memo.set(key, best);
	return best;
}

export function skillBand(grade: number): number {
	return grade <= 0 || !Number.isFinite(grade) ? -1 : grade <= 3 ? 0 : grade <= 6 ? 1 : 2;
}

/** Server completion time makes reloads and out-of-order broadcasts reproducible.
 * Older entries without a timestamp retain their supplied order, before dated entries. */
export function orderedGroupHistory(history: GroupHistory): GroupHistory {
	const unique = new Map(history.map(g => [g.matchId, g]));
	return [...unique.values()].sort((a, b) => {
		const aTime = Date.parse(a.completedAt ?? ""), bTime = Date.parse(b.completedAt ?? "");
		if (!Number.isFinite(aTime) && !Number.isFinite(bTime)) return 0;
		return (Number.isFinite(aTime) ? aTime : -Infinity) - (Number.isFinite(bTime) ? bTime : -Infinity) || a.matchId.localeCompare(b.matchId);
	});
}

export interface ExchangeState { bands: Map<string, number>; targets: Map<string, number[]>; gaps: Map<string, number> }

/** Rebuild personal completed-game streaks; corrected gameCount never creates history.
 * Use the session roster (including people outside the recommendation pool) for grades,
 * and currently active players' known join times for available target bands.
 * Historical rest/check transitions are not stored; current eligibility is authoritative. */
export function buildExchangeState(
	players: readonly SessionPlayer[], history: GroupHistory, activeIds: ReadonlySet<string>, now: number,
): ExchangeState {
	const state: ExchangeState = { bands: new Map(players.map(p => [p.id, skillBand(skillScore(p))])), targets: new Map(), gaps: new Map() };
	function updateTargets(at: number, inclusive: boolean) {
		const active = players.filter(p => {
			const joined = Date.parse(p.joinedAt ?? "");
			return activeIds.has(p.id) && (!Number.isFinite(joined) || (inclusive ? joined <= at : joined < at));
		});
		const present = [...new Set(active.map(p => state.bands.get(p.id)!).filter(b => b >= 0))].sort();
		const ids = new Set(active.map(p => p.id));
		for (const p of players) {
			const band = state.bands.get(p.id)!;
			const targets = !ids.has(p.id) || band < 0 ? [] : band !== 1 && present.includes(2 - band) ? [2 - band] : present.filter(b => b !== band);
			if (targets.join() !== state.targets.get(p.id)?.join()) state.gaps.set(p.id, 0);
			state.targets.set(p.id, targets);
		}
	}
	for (const group of orderedGroupHistory(history)) {
		const completed = Date.parse(group.completedAt ?? "");
		updateTargets(Number.isFinite(completed) ? completed : now, !Number.isFinite(completed));
		for (const id of new Set(group.members)) {
			const targets = state.targets.get(id) ?? [];
			if (!targets.length) continue;
			const met = group.members.some(other => targets.includes(state.bands.get(other) ?? -1));
			state.gaps.set(id, met ? 0 : (state.gaps.get(id) ?? 0) + 1);
		}
	}
	updateTargets(now, true);
	return state;
}

export function exchangeCost(ids: readonly string[], state: ExchangeState, interval = EXCHANGE_INTERVAL): number {
	return 81 * ids.reduce((sum, id) => {
		const targets = state.targets.get(id) ?? [];
		if (!targets.length) return sum;
		const before = state.gaps.get(id) ?? 0;
		const after = ids.some(other => targets.includes(state.bands.get(other) ?? -1)) ? 0 : before + 1;
		return sum + (after ** 2 - before ** 2) / interval ** 2;
	}, 0);
}
