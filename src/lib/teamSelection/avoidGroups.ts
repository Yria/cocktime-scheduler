import type { SessionPlayer } from "../../types";

/** Smallest and largest group an operator can mark as never matched together. */
export const AVOID_GROUP_MIN = 2;
export const AVOID_GROUP_MAX = 4;

/** Every two members of a group avoid each other. Groups hold member ids; session players without one are skipped. */
export function buildAvoidMap(groups: readonly (readonly string[])[], players: Iterable<SessionPlayer>): Map<string, Set<string>> {
	const byMember = new Map<string, string[]>();
	for (const p of players) if (p.memberId) byMember.set(p.memberId, [...(byMember.get(p.memberId) ?? []), p.id]);
	const avoid = new Map<string, Set<string>>();
	for (const group of groups) {
		const ids = [...new Set(group)].flatMap(memberId => byMember.get(memberId) ?? []);
		for (const a of ids) for (const b of ids) if (a !== b) {
			if (!avoid.has(a)) avoid.set(a, new Set());
			avoid.get(a)!.add(b);
		}
	}
	return avoid;
}

/** A group is valid with 2-4 distinct members and differs from every existing group. */
export function avoidGroupError(memberIds: readonly string[], existing: readonly (readonly string[])[] = []): string | null {
	const ids = new Set(memberIds);
	if (ids.size !== memberIds.length) return "같은 사람을 두 번 고를 수 없어요";
	if (ids.size < AVOID_GROUP_MIN || ids.size > AVOID_GROUP_MAX) return `${AVOID_GROUP_MIN}~${AVOID_GROUP_MAX}명을 골라 주세요`;
	if (existing.some(group => group.length === ids.size && group.every(id => ids.has(id)))) return "이미 같은 묶음이 있어요";
	return null;
}

/** Same people regardless of order; with `subset`, every member of `rule` is in `group` (a session-filtered rule). */
export function sameAvoidGroup(rule: readonly string[], group: readonly string[], subset = false): boolean {
	const members = new Set(group);
	return rule.every(id => members.has(id)) && (subset || rule.length === group.length);
}
