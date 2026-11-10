import type { BoardDraftsPayload } from "../../types/board";
import { resolveFreedReservations } from "../../lib/board/draftMutations";
import { mergeDrafts } from "../../lib/board/mergeDrafts";
import { commitCompletionDrafts } from "../../lib/supabase/matchResults";
import { useAppStore } from "../appStore";
import { useSessionStore } from "../sessionStore";
import type { BoardState } from "./types";
import { getDraftsBase, runWithCompletionGrant, serializeBoardDrafts, setDraftsBase, syncState, withoutDraftSave } from "./draftsSync";

// 회원 경기완료 뒤의 '코트 그룹 편성 1회'(docs/MATCH_RESULT_ELO_SPEC.md §3.4).
// 편집자가 아닌 회원이 자기 경기를 끝냈을 때, 그 코트가 비어 운영진이 손댈 때까지 노는 것을 막는다.
// 편성 규칙은 새로 만들지 않고 편집자 경로의 액션(resolveFreedReservations·fillWaitingTeams·autoFillEmptyCourts)을
// 그대로 돌린다 — 준비된 예비팀이 있으면 그 팀을, 없으면 새 그룹을 자동 편성해 올린다.
// 회원 기기에는 '같이 매칭하지 않기' 규칙이 없다(숨은 설정, 운영진 기기에만 내려간다). 그래서 규칙 없이 짠 계획과
// 그 계획에서 새로 들어간 사람을 하나씩 뺀 대안 계획들, 마지막에 '예비팀 옮기기만' 안전 계획을 후보로 함께 보내고
// 서버(member_commit_completion_drafts)가 규칙을 어기지 않는 첫 후보만 저장한다. 규칙은 끝까지 회원에게 안 간다.
// 저장은 board_save_drafts(운영진 전용·편집락 self-claim)가 아니라 member_commit_completion_drafts(grant 1회 CAS)로만 한다.

type Get = () => BoardState;
type SetState = (fn: (s: BoardState) => void) => void;

/** stale 이면 서버 상태 재적재 후 재계산 — 첫 시도 + 최대 2회. 그 이상은 운영진이 바쁜 순간이라 양보한다. */
export const MEMBER_COMMIT_MAX_RETRIES = 2;
/** 한 번에 보내는 후보 수(안전 후보 포함). 서버 상한(6)보다 작게. */
export const MEMBER_CANDIDATES_MAX = 5;

/**
 * 편성 계획 전후의 로컬 직렬화 — 둘의 차이가 '이 계획이 바꾼 것'이다.
 * added: 편성 단계(합류 대기 채우기·자동 편성)가 새 조합에 넣은 선수 — 그 전엔 어느 그룹에도 없던 사람과
 *   다른 그룹에서 끌려와 예전 팀원과 떨어진 사람(자동 편성의 유연 풀이 합류 대기팀에서 빼 온 선수)을 번갈아.
 *   예비팀이 통째로 옮겨 가거나 제자리에 남은 사람은 새 조합이 아니라 넣지 않는다. 대안 후보는 이들을 하나씩 뺀다.
 */
export type MemberPlan = { before: BoardDraftsPayload; after: BoardDraftsPayload; added: string[] };

/** compose=false 면 안전 계획(예비팀 옮기기만). excludeIds 는 편성 풀에서 뺄 선수(대안 계획). */
export type MemberPlanOptions = { compose?: boolean; excludeIds?: readonly string[] };

type Placement = { teams: Set<string>; mates: Set<string> };

/** 그룹(anchor 또는 예약)에 든 선수마다 소속 팀 id 와 같은 팀 동료(유효 멤버) 전체. */
function placements(s: Pick<BoardState, "drafts" | "reservations">): Map<string, Placement> {
	const members = new Map<string, string[]>();
	for (const team of s.drafts.values()) members.set(team.id, [...team.anchorMemberIds]);
	for (const r of s.reservations.values()) members.get(r.teamId)?.push(r.playerId);
	const out = new Map<string, Placement>();
	for (const [teamId, ids] of members) for (const id of ids) {
		const p = out.get(id) ?? { teams: new Set<string>(), mates: new Set<string>() };
		p.teams.add(teamId);
		for (const other of ids) if (other !== id) p.mates.add(other);
		out.set(id, p);
	}
	return out;
}

const subsetOf = (a: ReadonlySet<string>, b: ReadonlySet<string>) => [...a].every((x) => b.has(x));

/** 계획 전→후에서 새 조합에 들어간 선수(MemberPlan.added 의 정의). 새로 그룹에 든 사람과 옮겨진 사람을 번갈아. */
function newlyCombined(before: Map<string, Placement>, after: Map<string, Placement>): string[] {
	const fresh: string[] = [], moved: string[] = [];
	for (const [id, now] of after) {
		const was = before.get(id);
		if (!was) fresh.push(id);
		// 소속 팀이 바뀌었고 예전 팀원 중 누군가와 떨어졌다 = 다른 그룹에서 빼 와 새 사람들과 묶였다.
		else if (!(subsetOf(now.teams, was.teams) && subsetOf(was.teams, now.teams)) && !subsetOf(was.mates, now.mates)) moved.push(id);
	}
	// 번갈아 둔다 — 대안 후보 수가 제한돼 있어(MEMBER_CANDIDATES_MAX) 한쪽만 앞에 두면 다른 쪽이 기회를 못 얻는다.
	const out: string[] = [];
	for (let i = 0; i < Math.max(fresh.length, moved.length); i++) {
		if (i < fresh.length) out.push(fresh[i]);
		if (i < moved.length) out.push(moved[i]);
	}
	return out;
}

/**
 * 후보가 지금 서버 보드(raw)에 올라 있는 사람을 내리는지 — member_commit_completion_drafts 의 '얹기 전용' 가드와 같은 판정.
 * 서버는 그런 후보를 건너뛰므로 보내 봐야 자리만 차지한다. 예: 자동 편성이 2인 합류 대기팀에서 한 명을 빼 오면
 * 남은 한 명이 해체로 풀려 내려간다.
 */
export function removesBoardMembers(raw: BoardDraftsPayload, payload: BoardDraftsPayload): boolean {
	const anchors = new Set(payload.teams.flatMap((t) => t.memberIds));
	const reservationIds = new Set(payload.reservations.map((r) => r.id));
	return raw.teams.some((t) => t.memberIds.some((id) => !anchors.has(id)))
		|| raw.reservations.some((r) => !reservationIds.has(r.id) && !anchors.has(r.playerId));
}

/**
 * 지금 로컬 보드 위에 편성 계획을 적용한다. claimEdit() 게이트는 이 동기 구간에서만 열린다.
 * 순서는 편집자 completeMatch 와 같고(예약 승격 → 합류 대기 채우기 → 흩기) 그 코트 그룹 채우기
 * (준비된 예비팀 우선, 없으면 자동 편성)를 더한다.
 * 코트 그룹이 이 기기에 아직 없을 수 있어(코트 정합은 이펙트가 늦게 돈다) 먼저 맞춘다 — 그건 로컬 정제라 before 에 든다.
 */
export function planMemberArrangement(
	get: Get,
	set: SetState,
	courtId: number,
	endedIds: readonly string[],
	opts: MemberPlanOptions = {},
): MemberPlan {
	const compose = opts.compose ?? true;
	const exclude = opts.excludeIds?.length ? { excludeIds: opts.excludeIds } : undefined;
	return runWithCompletionGrant(() => {
		get().ensureCourtGroups();
		const before = serializeBoardDrafts(get());
		set((s) => resolveFreedReservations(s, endedIds));
		const placed = placements(get());
		if (compose) {
			get().fillWaitingTeams(exclude);
			get().autoFillEmptyCourts(courtId, exclude);
		} else {
			get().autoFillEmptyCourts(courtId, { queuedOnly: true });
		}
		const added = newlyCombined(placed, placements(get()));
		get().scatterMagnets([...endedIds]);
		return { before, after: serializeBoardDrafts(get()), added };
	});
}

/**
 * 서버에 보낼 payload — 서버 원본(raw) 위에 계획의 차이(before→after)만 얹는다.
 * 로컬 보드를 통째로 보내면 이 기기가 못 그린 것(자석이 아직 없는 선수의 배치, 오래된 코트 때문에 빠진 anchor)이
 * 서버에서 지워지고, 관전자가 로컬로 옮긴 자석 좌표(미동기화)와 이 화면 크기 기준 흩기 좌표가 모두의 layout 을 덮는다.
 */
export function memberPayload(plan: Pick<MemberPlan, "before" | "after">, raw: BoardDraftsPayload): BoardDraftsPayload {
	return mergeDrafts(plan.before, plan.after, raw).payload;
}

/** 계획이 건드리는 보드 상태 — 후보마다 같은 출발점에서 다시 계획하고, 서버가 고른 후보로 되돌리는 데 쓴다. */
type BoardSnapshot = Pick<BoardState, "drafts" | "reservations" | "magnets" | "courtAnchors" | "manualLayout">;
const snapshotBoard = (s: BoardState): BoardSnapshot => ({
	drafts: s.drafts, reservations: s.reservations, magnets: s.magnets, courtAnchors: s.courtAnchors, manualLayout: s.manualLayout,
});
function restoreBoard(set: SetState, snap: BoardSnapshot) {
	set((s) => {
		s.drafts = snap.drafts;
		s.reservations = snap.reservations;
		s.magnets = snap.magnets;
		s.courtAnchors = snap.courtAnchors;
		s.manualLayout = snap.manualLayout;
	});
}
const sameSnapshot = (a: BoardSnapshot, b: BoardSnapshot) =>
	a.drafts === b.drafts && a.reservations === b.reservations && a.magnets === b.magnets
	&& a.courtAnchors === b.courtAnchors && a.manualLayout === b.manualLayout;

export type MemberCandidate = { plan: MemberPlan; payload: BoardDraftsPayload; board: BoardSnapshot };

/**
 * 서버에 보낼 후보 목록(우선순위 순, 최대 MEMBER_CANDIDATES_MAX).
 *   0: 편집자와 같은 전체 계획(준비된 예비팀 → 없으면 새 그룹 자동 편성).
 *   1..: 0번이 새 조합에 넣은 선수(added)를 하나씩 풀에서 뺀 대안 계획 — 규칙에 걸린 사람이 빠진 편성이 나오도록.
 *   마지막: 안전 계획(합류 대기 채우기·자동 편성 없이 준비된 예비팀 옮기기만) — 새 조합을 만들지 않으므로 늘 통과한다.
 * 같은 payload 는 한 번만 둔다(안전 계획과 같으면 안전 계획 자리 하나만). 서버 보드의 사람을 내리는 편성 후보는
 * 서버가 건너뛰므로 보내지 않는다. 각 계획은 같은 출발 상태에서 돈다.
 * 끝나면 로컬 보드는 첫 후보 상태다(가장 유력 — 서버가 다른 걸 고르면 commit 쪽이 바꾼다).
 * 계획 중 상태 변화는 저장 구독(boardStore subscribe → board_save_drafts)에 태우지 않는다(withoutDraftSave) —
 * 운영진 기기라도 규칙 검사 전 후보가 편집자 저장 경로로 새어 나가면 안 된다.
 */
export function planMemberCandidates(
	get: Get,
	set: SetState,
	courtId: number,
	endedIds: readonly string[],
	raw: BoardDraftsPayload,
): MemberCandidate[] {
	return withoutDraftSave(() => {
		const start = snapshotBoard(get());
		const run = (opts: MemberPlanOptions): MemberCandidate & { json: string } => {
			restoreBoard(set, start);
			const plan = planMemberArrangement(get, set, courtId, endedIds, opts);
			const payload = memberPayload(plan, raw);
			return { plan, payload, board: snapshotBoard(get()), json: JSON.stringify(payload) };
		};
		try {
			const composed: (MemberCandidate & { json: string })[] = [];
			const keep = (c: MemberCandidate & { json: string }) => {
				if (!removesBoardMembers(raw, c.payload) && !composed.some((x) => x.json === c.json)) composed.push(c);
			};
			const primary = run({});
			keep(primary);
			for (const id of primary.plan.added) {
				if (composed.length >= MEMBER_CANDIDATES_MAX - 1) break;
				keep(run({ excludeIds: [id] }));
			}
			const safe = run({ compose: false });
			const list = [...composed.filter((c) => c.json !== safe.json), safe];
			restoreBoard(set, list[0].board);
			return list.map(({ plan, payload, board }) => ({ plan, payload, board }));
		} catch (error) {
			restoreBoard(set, start);
			throw error;
		}
	});
}

function stillHere(sessionId: number) {
	return useAppStore.getState().sessionMeta?.sessionId === sessionId;
}

/**
 * 후보 계획 → CAS 커밋. stale 이면 서버 스냅샷 전체(경기·선수·drafts)를 다시 받아 그 위에서 다시 계획한다 —
 * drafts 만 다시 받으면 방금 시작된 경기를 모르는 낡은 코트 위에서 그 코트를 다시 채운다.
 * 실패(error·rejected·재시도 소진)면 로컬에 그려 둔 계획을 버리고 서버 상태로 되돌린다 — 저장 안 된 편성이 이 기기에만
 * 남아 있으면 회원은 '올라갔다'고 믿는데 다른 기기에는 없다.
 */
export async function commitMemberArrangement(
	get: Get,
	set: SetState,
	sessionId: number,
	matchId: string,
	courtId: number,
	endedIds: readonly string[],
): Promise<"ok" | "stale" | "rejected" | "error" | "skipped"> {
	// 머지 기준(applyRemoteDrafts 가 기록) — 이 기기가 실제로 그린 서버 버전과 그 원본. 없으면 먼저 받아 온다.
	let reload = !getDraftsBase(sessionId);
	for (let attempt = 0; attempt <= MEMBER_COMMIT_MAX_RETRIES; attempt++) {
		if (reload) {
			const ok = await useSessionStore.getState().resyncFromServer({ force: true });
			if (!stillHere(sessionId)) return "skipped";
			if (!ok) return "error";
			const ss = useSessionStore.getState();
			get().applyRemoteDrafts(ss.boardDrafts, ss.boardDraftsVersion);
		}
		reload = true;
		const base = getDraftsBase(sessionId);
		if (!base) return "error";
		const candidates = planMemberCandidates(get, set, courtId, endedIds, base.raw);
		const drawn = candidates[0].board;
		const res = await commitCompletionDrafts(sessionId, matchId, base.version, candidates.map((c) => c.payload));
		if (!stillHere(sessionId)) return "skipped";
		if (res.status === "ok") {
			const chosen = candidates[res.chosen];
			if (sameSnapshot(snapshotBoard(get()), drawn)) {
				// 기다리는 동안 로컬이 그대로면 서버가 고른 후보의 로컬 상태로 맞춘다(0번이면 그대로).
				if (res.chosen !== 0) withoutDraftSave(() => restoreBoard(set, chosen.board));
				// 내가 쓴 값이 곧 서버 값 — 기준선을 옮겨 이어지는 행 이벤트·이펙트가 같은 버전을 다시 그리지 않게 한다.
				syncState.lastSyncedDraftsJson = JSON.stringify(chosen.plan.after);
				setDraftsBase(sessionId, res.version, chosen.plan.after, chosen.payload);
			} else {
				// 그 사이 로컬이 바뀌었다(원격 적용 등) — 저장된 payload 를 서버 값으로 그린다.
				get().applyRemoteDrafts(chosen.payload, res.version);
			}
			useSessionStore.getState().applyDraftsIfNewer(chosen.payload, res.version);
			return "ok";
		}
		if (res.status === "error" || res.status === "rejected") {
			await useSessionStore.getState().resyncFromServer({ force: true });
			return res.status;
		}
	}
	if (stillHere(sessionId)) await useSessionStore.getState().resyncFromServer({ force: true });
	return "stale";
}
