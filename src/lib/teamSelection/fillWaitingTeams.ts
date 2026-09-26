import type { SessionPlayer } from "../../types";
import { allowedGameType } from "./groupPolicy";
import { autoFillTeammates, type RecommendContext } from "./recommendTeammates";
import { skillScore } from "./rankCandidates";

export interface WaitingTeam { id: string; members: SessionPlayer[] }
type Counts = [number, number, number];
const category = (p: SessionPlayer) => p.gender === "M" ? 0 : skillScore(p) >= 4 ? 2 : 1;
const countsOf = (players: readonly SessionPlayer[]): Counts => {
	const counts: Counts = [0, 0, 0];
	for (const player of players) counts[category(player)]++;
	return counts;
};
const subtract = (counts: Counts, used: Counts): Counts => counts.map((n, i) => n - used[i]) as Counts;
// Feasibility depends only on these three categories, not individual identity.
const representatives = [
	{ gender: "M", skills: { grade: 5 } },
	{ gender: "F", skills: { grade: 3 } },
	{ gender: "F", skills: { grade: 5 } },
] as SessionPlayer[];

/** Category counts (men, women below 4, women 4+) that complete `members` into an allowed four. */
function completionPatterns(members: readonly SessionPlayer[]): Counts[] {
	const slots = 4 - members.length, patterns: Counts[] = [];
	for (let men = 0; men <= slots; men++) for (let low = 0; low <= slots - men; low++) {
		const counts: Counts = [men, low, slots - men - low];
		const extras = counts.flatMap((count, i) => Array.from({ length: count }, () => representatives[i]));
		if (allowedGameType([...members, ...extras])) patterns.push(counts);
	}
	return patterns;
}

/** Whether some of `pool` can complete `members` into an allowed four. */
export function canCompleteFrom(members: readonly SessionPlayer[], pool: readonly SessionPlayer[]): boolean {
	const have = countsOf(pool);
	return completionPatterns(members).some(pattern => pattern.every((n, i) => n <= have[i]));
}

/** Complete as many waiting teams as possible, with older teams first on ties.
 * Composition lookahead prevents a flexible older team taking the only players
 * a later team needs. Within that constraint, use the ordinary repetition/fairness
 * policy. No player moves out of an existing team and no busy player is reserved.
 */
export function planWaitingTeamFills(teams: readonly WaitingTeam[], pool: readonly SessionPlayer[], ctx: RecommendContext, priorityCount = 0): Map<string, SessionPlayer[]> {
	const eligible = (p: SessionPlayer) => !ctx.playingIds.has(p.id) && p.status !== "resting" && (!ctx.cockCheckEnabled || p.cockChecked);
	const fixed = new Set(teams.flatMap(team => team.members.map(p => p.id)));
	let remaining = [...new Map(pool.filter(p => eligible(p) && !fixed.has(p.id)).map(p => [p.id, p])).values()];
	// Waiting drafts keep two or more; partly filled court groups may have one.
	const priority = new Set(teams.slice(0, priorityCount).map(team => team.id));
	const targets = teams.filter(team => team.members.length >= 1 && team.members.length < 4 && team.members.every(eligible));
	const requirements = targets.map(team => completionPatterns(team.members));
	// Priority teams (partly filled court groups) outrank any number of ordinary waiting teams.
	const weight = targets.map(team => priority.has(team.id) ? teams.length + 1 : 1);
	const memo = new Map<string, number>();
	function capacity(index: number, counts: Counts): number {
		if (index === targets.length) return 0;
		const key = `${index}:${counts.join(",")}`;
		const cached = memo.get(key);
		if (cached !== undefined) return cached;
		let best = capacity(index + 1, counts);
		for (const pattern of requirements[index]) {
			const after = subtract(counts, pattern);
			if (after.every(n => n >= 0)) best = Math.max(best, weight[index] + capacity(index + 1, after));
		}
		memo.set(key, best);
		return best;
	}
	const result = new Map<string, SessionPlayer[]>();
	targets.forEach((team, index) => {
		const counts = countsOf(remaining), possible = capacity(index, counts);
		if (!possible) return;
		const picks = autoFillTeammates(team.members, remaining, ctx, 4 - team.members.length, undefined, {
			acceptCompletion: candidates => candidates.length + team.members.length === 4
				&& capacity(index + 1, subtract(counts, countsOf(candidates))) === possible - weight[index],
		});
		if (picks.length + team.members.length !== 4) return;
		result.set(team.id, picks);
		const used = new Set(picks.map(p => p.id));
		remaining = remaining.filter(p => !used.has(p.id));
	});
	// The category lookahead cannot see avoided pairs: people it held for a team the
	// constraint blocks must not also leave an earlier, fillable team empty.
	if (ctx.avoid?.size) for (const team of targets) {
		if (result.has(team.id)) continue;
		const picks = autoFillTeammates(team.members, remaining, ctx, 4 - team.members.length);
		if (picks.length + team.members.length !== 4) continue;
		result.set(team.id, picks);
		const used = new Set(picks.map(p => p.id));
		remaining = remaining.filter(p => !used.has(p.id));
	}
	return result;
}
