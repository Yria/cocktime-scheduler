/**
 * 결과 입력의 '같은 편' 단계 — 순수 로직 (docs/MATCH_RESULT_ELO_SPEC.md §3.3).
 *
 * 보드는 4명 그룹을 뽑을 뿐, 누가 누구와 한 편인지는 코트에서 정해진다. 그래서 결과를 넣을 때
 * 기준 선수(anchor) 한 명의 짝을 고르게 하고, 나머지 둘을 상대 편으로 둔다.
 *
 * 자리(인덱스): 보드 순서 [A1, A2, B1, B2] = 0,1,2,3.
 *  - anchor 는 보드에서 있던 쪽(A/B) 패널에 그대로 남는다 → 내가 anchor 면 '우리 팀' 표기가 흔들리지 않는다.
 *  - 각 편 안의 순서는 보드 순서(서버 _match_split 도 같은 규칙으로 정규화한다).
 *  - 짝 = 보드 짝이면 보드 나눔 그대로.
 */

export type Slot = 0 | 1 | 2 | 3;

export interface SlotSplit {
	a: [Slot, Slot];
	b: [Slot, Slot];
}

const SLOTS: readonly Slot[] = [0, 1, 2, 3];

/** 보드에서 anchor 와 같은 편이던 자리. */
export const boardPartner = (anchor: Slot): Slot => (anchor ^ 1) as Slot;

/** anchor 와 partner 가 한 편인 나눔. anchor === partner 면 보드 나눔. */
export function splitWithPartner(anchor: Slot, partner: Slot): SlotSplit {
	const p = anchor === partner ? boardPartner(anchor) : partner;
	const pair = SLOTS.filter((s) => s === anchor || s === p) as [Slot, Slot];
	const rest = SLOTS.filter((s) => s !== anchor && s !== p) as [Slot, Slot];
	return anchor < 2 ? { a: pair, b: rest } : { a: rest, b: pair };
}

/**
 * 기준 선수: 내가 뛰었으면 나, 아니면 보드 A편 첫 사람(운영진 입력 등).
 * myMemberId 가 없거나 로스터에 없으면 0.
 */
export function pickAnchor(
	players: readonly { memberId?: string | null }[],
	myMemberId: string | null | undefined,
): Slot {
	if (!myMemberId) return 0;
	const i = players.findIndex((p) => p.memberId != null && p.memberId === myMemberId);
	return i >= 0 && i < 4 ? (i as Slot) : 0;
}

/** 나눔을 실제 선수 배열로. */
export function applySplit<T>(
	players: readonly T[],
	split: SlotSplit,
): { teamA: T[]; teamB: T[] } {
	return {
		teamA: split.a.map((s) => players[s]),
		teamB: split.b.map((s) => players[s]),
	};
}

/** 보드 나눔(A=[0,1], B=[2,3]) 그대로인지. */
export const isBoardSplit = (split: SlotSplit): boolean =>
	split.a[0] === 0 && split.a[1] === 1;

/**
 * 서버에 보낼 실제 A편(session_players.id 두 개). 4명이 다 차 있고 모두 spId 가 있을 때만 —
 * 아니면 null(보드 나눔, 서버도 편을 고칠 수 없다).
 * 짝을 안 바꿨으면(보드 나눔 그대로) 역시 null 이다 — 서버가 그 순간의 로스터로 나누게 한다.
 * 다이얼로그의 spId 는 열 때 찍은 스냅샷이라, 그 사이 보드가 같은 경기 id 로 로스터를 바꾸면(set_match_roster)
 * 명시 spId 가 로스터 밖이 되어 22023 'invalid teams' 로 완료째 되돌려진다.
 */
export function teamAIds(
	players: readonly { spId?: string | null }[],
	split: SlotSplit,
): readonly [string, string] | null {
	if (!canEditTeams(players) || isBoardSplit(split)) return null;
	return [players[split.a[0]].spId!, players[split.a[1]].spId!];
}

/** 편 고치기를 열 수 있는지: 4명이 다 있고 서로 다른 spId 를 가졌다. */
export function canEditTeams(players: readonly { spId?: string | null }[]): boolean {
	if (players.length !== 4) return false;
	const ids = players.map((p) => p.spId);
	return ids.every((id) => !!id) && new Set(ids).size === 4;
}
