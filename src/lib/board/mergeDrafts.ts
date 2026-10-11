/**
 * mergeDrafts.ts
 *
 * 운영진 동시 편집(multiEditor)의 board_drafts 3-way 머지 순수 로직.
 * CAS 충돌 시 base(내 로컬이 마지막으로 반영한 서버 버전)·mine(지금 로컬)·theirs(서버 최신)를 합친다.
 *
 * 단위는 팀 객체가 아니라 "선수 배치(placement)"다. 팀 객체를 통째로 LWW 하면 정상적인 이동·해체가
 * 되돌아가거나(I1 이 오래된 팀을 남김) 같은 팀의 다른 선수 추가가 한쪽만 남는다.
 *  · 선수별 anchor 소속(팀 id | 자유): mine 에서 바뀐 선수만 mine 값, 나머지는 theirs 값.
 *    양쪽이 같은 선수를 다른 곳으로 옮기면 mine(재시도하는 쪽)이 이긴다 — 배치가 단일 값이라 중복은 생기지 않는다.
 *  · 슬롯: (팀, 선수) 키별 3-way. 같은 칸을 두 명이 잡으면 theirs 쪽을 남기고 mine 쪽 칸 지정을 지운다(빈 칸 자동 채움).
 *  · 팀 스칼라 메타(courtId·createdMs·createdBy·confirmedMs·waitForCompletion): 팀 키·필드별 3-way.
 *  · 팀 존재: 객체 삭제를 LWW 하지 않고 결과 유효 인원으로 판정한다(reconcile I3 와 같은 규칙 — 2명 미만이면
 *    코트 그룹이 아닌 한 버린다). 그래서 해체된 팀을 상대가 수정해도 남은 선수가 다른 팀으로 갔으면 부활하지 않는다.
 *  · 예약(ghost): id 키별 3-way, 같은 (선수, 팀) 중복과 anchor 확정 선수의 예약은 제거(reconcile 과 같은 규칙).
 *  · layout: undefined 는 빈 맵으로 정규화, 좌표 키별 3-way. 결과 layout 은 셋 중 하나라도 있으면 존재.
 * 결과는 중복 배치가 없고 팀 정원(4명)을 넘지 않는다. reconcileMembership 의 I1/I2 는 최후 방어로 남는다.
 */
import type { BoardDraftsPayload, BoardLayoutPayload, StagePoint } from "../../types/board";
import { canonicalizeDrafts } from "./remoteDrafts";

type TeamRow = BoardDraftsPayload["teams"][number];
type ResRow = BoardDraftsPayload["reservations"][number];
type Meta = Pick<TeamRow, "courtId" | "createdMs" | "createdBy" | "confirmedMs" | "waitForCompletion">;

const TEAM_CAP = 4;
const META_FIELDS = ["courtId", "createdMs", "createdBy", "confirmedMs", "waitForCompletion"] as const;

interface Parsed {
	/** 선수 → anchor 소속 팀(없으면 키 없음 = 자유). 한 payload 안의 중복은 I1 순서(createdMs↑, id↑)로 하나만. */
	anchor: Map<string, string>;
	meta: Map<string, Meta>;
	/** `${teamId}\u0000${playerId}` → 슬롯 */
	slots: Map<string, number>;
	res: Map<string, ResRow>;
	/** 팀 안 memberIds 순서(결과 순서 안정화용) */
	order: Map<string, string[]>;
	layout: { teams: Map<string, StagePoint>; courts: Map<string, StagePoint>; magnets: Map<string, StagePoint> };
	hasLayout: boolean;
}

const slotKey = (teamId: string, playerId: string) => `${teamId}\u0000${playerId}`;
const pointMap = (rec: Record<string, StagePoint> | undefined) =>
	new Map(Object.entries(rec ?? {}).map(([k, p]) => [k, { x: p.x, y: p.y }]));

function parse(p: BoardDraftsPayload): Parsed {
	const anchor = new Map<string, string>();
	const meta = new Map<string, Meta>();
	const slots = new Map<string, number>();
	const order = new Map<string, string[]>();
	const teams = [...p.teams].sort((a, b) => a.createdMs - b.createdMs || a.id.localeCompare(b.id));
	for (const t of teams) {
		meta.set(t.id, {
			courtId: t.courtId ?? undefined,
			createdMs: t.createdMs,
			createdBy: t.createdBy ?? undefined,
			confirmedMs: t.confirmedMs ?? undefined,
			waitForCompletion: t.waitForCompletion === true ? true : undefined,
		});
		order.set(t.id, [...t.memberIds]);
		for (const id of t.memberIds) if (!anchor.has(id)) anchor.set(id, t.id);
		for (const [pid, s] of Object.entries(t.slots ?? {})) slots.set(slotKey(t.id, pid), s);
	}
	const res = new Map<string, ResRow>();
	for (const r of p.reservations) res.set(r.id, { id: r.id, playerId: r.playerId, teamId: r.teamId, createdMs: r.createdMs });
	return {
		anchor, meta, slots, res, order,
		layout: { teams: pointMap(p.layout?.teams), courts: pointMap(p.layout?.courts), magnets: pointMap(p.layout?.magnets) },
		hasLayout: p.layout != null,
	};
}

const samePoint = (a?: StagePoint, b?: StagePoint) => a === b || (!!a && !!b && a.x === b.x && a.y === b.y);
const sameRes = (a?: ResRow, b?: ResRow) => a === b
	|| (!!a && !!b && a.playerId === b.playerId && a.teamId === b.teamId && a.createdMs === b.createdMs);

/** 키별 3-way: mine 이 base 와 다르면 mine(삭제 포함), 아니면 theirs. */
function pick3<T>(base: T | undefined, mine: T | undefined, theirs: T | undefined, eq: (a?: T, b?: T) => boolean): T | undefined {
	return eq(mine, base) ? theirs : mine;
}
function mergeMap<T>(b: Map<string, T>, m: Map<string, T>, t: Map<string, T>, eq: (a?: T, b?: T) => boolean): Map<string, T> {
	const out = new Map<string, T>();
	for (const k of new Set([...b.keys(), ...m.keys(), ...t.keys()])) {
		const v = pick3(b.get(k), m.get(k), t.get(k), eq);
		if (v !== undefined) out.set(k, v);
	}
	return out;
}

export interface MergeResult {
	payload: BoardDraftsPayload;
	/** 결과가 theirs 와 다르면 true — false 면 저장할 필요가 없다(theirs 를 그대로 적용). */
	changed: boolean;
}

/** layout 까지 포함한 비교 문자열 — undefined layout 은 빈 맵과 같다. */
export function draftsFingerprint(p: BoardDraftsPayload): string {
	const pts = (rec?: Record<string, StagePoint>) =>
		Object.entries(rec ?? {}).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, v.x, v.y]);
	return canonicalizeDrafts(p) + JSON.stringify(p.layout
		? [pts(p.layout.teams), pts(p.layout.courts), pts(p.layout.magnets)]
		: [[], [], []]);
}

export function mergeDrafts(base: BoardDraftsPayload, mine: BoardDraftsPayload, theirs: BoardDraftsPayload): MergeResult {
	const B = parse(base), M = parse(mine), T = parse(theirs);

	// ── 1) 선수 anchor 배치 ─────────────────────────────
	const anchor = mergeMap(B.anchor, M.anchor, T.anchor, (a, b) => a === b);
	/** mine 에서 바뀐 선수(정원 초과 시 먼저 밀려난다). */
	const mineChanged = (pid: string) => M.anchor.get(pid) !== B.anchor.get(pid);

	// ── 2) 팀 메타(필드별 3-way) ──────────────────────────
	const meta = new Map<string, Meta>();
	for (const id of new Set([...B.meta.keys(), ...M.meta.keys(), ...T.meta.keys()])) {
		const b = B.meta.get(id), m = M.meta.get(id), t = T.meta.get(id);
		const out: Meta = { createdMs: 0 };
		for (const f of META_FIELDS) {
			const v = pick3(b?.[f], m?.[f], t?.[f], (x, y) => x === y);
			if (v !== undefined) (out as Record<string, unknown>)[f] = v;
		}
		// createdMs 는 팀 정체성 — 어느 쪽에서든 살아 있는 값으로 채운다(I1 순서 결정에 쓰인다).
		if (out.createdMs === undefined || out.createdMs === 0) out.createdMs = t?.createdMs ?? m?.createdMs ?? b?.createdMs ?? 0;
		meta.set(id, out);
	}
	// 메타가 사라진 팀(양쪽 다 지움 등)을 가리키는 배치는 자유로.
	for (const [pid, teamId] of [...anchor]) if (!meta.has(teamId)) anchor.delete(pid);

	// ── 3) 예약(ghost) id 키별 3-way ──────────────────────
	let res = [...mergeMap(B.res, M.res, T.res, sameRes).values()];

	// ── 4) 팀 정원 보정 — 양쪽이 같은 팀에 서로 다른 선수를 넣어 4명을 넘으면 mine 쪽 추가분부터 되돌린다.
	const anchorsOf = (teamId: string) => [...anchor].filter(([, t]) => t === teamId).map(([pid]) => pid);
	const ghostsOf = (teamId: string) => res.filter((r) => r.teamId === teamId && anchor.get(r.playerId) == null);
	for (let guard = 0; guard < 8; guard++) {
		let moved = false;
		for (const teamId of meta.keys()) {
			const anchors = anchorsOf(teamId);
			const ghosts = ghostsOf(teamId);
			const count = new Set([...anchors, ...ghosts.map((r) => r.playerId)]).size;
			if (count <= TEAM_CAP) continue;
			let excess = count - TEAM_CAP;
			// mine 만 가진 예약부터 제거, 그다음 mine 에서 이 팀으로 옮긴 선수를 theirs 배치로(그 팀도 꽉 찼으면 자유로).
			for (const r of ghosts.filter((g) => !T.res.has(g.id)).sort((a, b) => b.createdMs - a.createdMs || b.id.localeCompare(a.id))) {
				if (excess <= 0) break;
				res = res.filter((x) => x.id !== r.id);
				excess--;
			}
			for (const pid of anchors.filter((p) => mineChanged(p) && T.anchor.get(p) !== teamId).sort().reverse()) {
				if (excess <= 0) break;
				const back = T.anchor.get(pid);
				if (back != null && meta.has(back) && anchorsOf(back).length < TEAM_CAP) anchor.set(pid, back);
				else anchor.delete(pid);
				excess--; moved = true;
			}
		}
		if (!moved) break;
	}

	// ── 5) 예약 정제(reconcile 과 같은 규칙) — anchor 확정 선수는 ghost 불가, 같은 (선수, 팀) 중복은 가장 오래된 것만.
	const seenPair = new Set<string>();
	res = res
		.filter((r) => meta.has(r.teamId) && anchor.get(r.playerId) == null)
		.sort((a, b) => a.createdMs - b.createdMs || a.id.localeCompare(b.id))
		.filter((r) => {
			const k = `${r.playerId}:${r.teamId}`;
			if (seenPair.has(k)) return false;
			seenPair.add(k);
			return true;
		});

	// ── 6) 팀 존재 판정(I3 규칙) — 유효 인원 2명 미만이면 코트 그룹이 아닌 한 버리고 멤버는 자유로.
	const alive = new Set<string>();
	for (const [teamId, m] of meta) {
		const count = new Set([...anchorsOf(teamId), ...res.filter((r) => r.teamId === teamId).map((r) => r.playerId)]).size;
		if (count >= 2 || m.courtId != null) alive.add(teamId);
	}
	for (const [pid, teamId] of [...anchor]) if (!alive.has(teamId)) anchor.delete(pid);
	res = res.filter((r) => alive.has(r.teamId));

	// ── 7) 슬롯 (팀, 선수) 키별 3-way → 결과 멤버 것만, 같은 칸 충돌은 theirs 우선.
	const slotMerged = mergeMap(B.slots, M.slots, T.slots, (a, b) => a === b);

	// ── 8) 조립 — 팀 순서는 theirs → mine → base, 멤버 순서는 theirs 순서 뒤에 새 멤버.
	const teamOrder = [...new Set([...theirs.teams.map((t) => t.id), ...mine.teams.map((t) => t.id), ...base.teams.map((t) => t.id)])]
		.filter((id) => alive.has(id));
	const teams: TeamRow[] = teamOrder.map((id) => {
		const m = meta.get(id)!;
		const anchors = anchorsOf(id);
		const hint = [...(T.order.get(id) ?? []), ...(M.order.get(id) ?? []), ...(B.order.get(id) ?? [])];
		const memberIds = [...new Set(hint.filter((pid) => anchors.includes(pid))), ...anchors.filter((pid) => !hint.includes(pid))];
		const members = new Set([...memberIds, ...res.filter((r) => r.teamId === id).map((r) => r.playerId)]);
		const used = new Map<number, string>();
		const slots: Record<string, number> = {};
		// theirs 에서 온 칸을 먼저 확정하고 나머지를 넣는다 — 같은 칸이면 나중 것(mine 쪽)의 지정을 버린다.
		const slotPids = [...members].sort((a, b) => {
			const ta = T.slots.get(slotKey(id, a)) === slotMerged.get(slotKey(id, a)) ? 0 : 1;
			const tb = T.slots.get(slotKey(id, b)) === slotMerged.get(slotKey(id, b)) ? 0 : 1;
			return ta - tb || a.localeCompare(b);
		});
		for (const pid of slotPids) {
			const s = slotMerged.get(slotKey(id, pid));
			if (typeof s !== "number" || used.has(s)) continue;
			used.set(s, pid);
			slots[pid] = s;
		}
		const count = members.size;
		return {
			id,
			...(m.courtId != null ? { courtId: m.courtId } : {}),
			memberIds,
			createdMs: m.createdMs,
			...(Object.keys(slots).length ? { slots: Object.fromEntries(Object.entries(slots).sort(([a], [b]) => a.localeCompare(b))) } : {}),
			...(m.createdBy ? { createdBy: m.createdBy } : {}),
			...(m.confirmedMs != null && count >= TEAM_CAP ? { confirmedMs: m.confirmedMs } : {}),
			...(m.waitForCompletion && m.courtId == null && count >= 2 && count < TEAM_CAP ? { waitForCompletion: true } : {}),
		};
	});

	// ── 9) layout
	let layout: BoardLayoutPayload | undefined;
	if (B.hasLayout || M.hasLayout || T.hasLayout) {
		const rec = (m: Map<string, StagePoint>, keep?: (k: string) => boolean) => Object.fromEntries(
			[...m].filter(([k]) => !keep || keep(k)).sort(([a], [b]) => a.localeCompare(b)));
		layout = {
			version: 1,
			teams: rec(mergeMap(B.layout.teams, M.layout.teams, T.layout.teams, samePoint), (k) => alive.has(k)),
			courts: rec(mergeMap(B.layout.courts, M.layout.courts, T.layout.courts, samePoint)),
			magnets: rec(mergeMap(B.layout.magnets, M.layout.magnets, T.layout.magnets, samePoint)),
		};
	}

	const payload: BoardDraftsPayload = { ...(layout ? { layout } : {}), teams, reservations: res };
	return { payload, changed: draftsFingerprint(payload) !== draftsFingerprint(theirs) };
}
