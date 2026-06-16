import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import { devtools } from "zustand/middleware";
import { enableMapSet } from "immer";

import type { SessionPlayer } from "../types";
import type { BoardDraftsPayload, DraftTeam, MagnetPosition, Reservation, StagePoint } from "../types/board";
import { computeSlotOffset, isInsideTeamBounds } from "../lib/board/geometry";
import {
	MAGNET_SIZE,
	TEAM_W,
	TEAM_BOX_ABOVE,
	TEAM_BOX_BELOW,
	TOOLBAR_H,
	COURT_BAR_H,
	COURT_LANE_H,
} from "../lib/board/constants";
import { settleFreeMagnets, scatterFromSource, type ScatterShape } from "../lib/board/collision";
import { resolveDropTarget, nearestFreePartner } from "../lib/board/dropResolver";
import {
	isMemberOf,
	isTeamStartable,
	playingIdsFromCourts,
	teamMemberCount,
	teamMembers,
} from "../lib/board/membership";
import { useSessionStore } from "./sessionStore";
import { useAppStore } from "./appStore";
import { pairPlayers } from "../lib/teamSelection";
import { toast } from "./toastStore";
import { dbSaveBoardDrafts, sendBroadcast } from "../lib/supabase";

enableMapSet();

// ── grid layout for initial pool ─────────────────────────

const POOL_COLS = 4;
const POOL_START_X = MAGNET_SIZE;
// 코트 레인 아래에서 풀 그리드 시작 (코트 카드와 겹치지 않도록)
const POOL_START_Y = COURT_LANE_H + MAGNET_SIZE / 2;
const POOL_GAP_X = MAGNET_SIZE + 10;
const POOL_GAP_Y = MAGNET_SIZE + 10;

function gridPos(i: number): StagePoint {
	return {
		x: POOL_START_X + (i % POOL_COLS) * POOL_GAP_X,
		y: POOL_START_Y + Math.floor(i / POOL_COLS) * POOL_GAP_Y,
	};
}

function clampAnchor(p: StagePoint): StagePoint {
	const vw = typeof window !== "undefined" ? window.innerWidth : 400;
	// stage 영역 = 화면 높이 − 툴바 − 코트바 (자석 좌표는 stage 기준)
	const vh = (typeof window !== "undefined" ? window.innerHeight : 800) - TOOLBAR_H - COURT_BAR_H;
	const halfW = TEAM_W / 2;
	// 예비팀은 코트 레인 아래에만 (팀 상단이 레인 밑으로)
	const minY = COURT_LANE_H + TEAM_BOX_ABOVE;
	const maxY = Math.max(minY, vh - TEAM_BOX_BELOW);
	return {
		x: Math.max(halfW, Math.min(vw - halfW, p.x)),
		y: Math.max(minY, Math.min(maxY, p.y)),
	};
}

function viewport(): { vw: number; vh: number } {
	const vw = typeof window !== "undefined" ? window.innerWidth : 400;
	const vh = (typeof window !== "undefined" ? window.innerHeight : 800) - TOOLBAR_H - COURT_BAR_H;
	return { vw, vh };
}

/** 드래그-엔드 소스: 무엇을 놓았는지(자석/팀/코트). 흩어짐의 시작점이 된다. */
type DragSource = { magnetId: string } | { teamId: string } | { courtId: number };

type SettleState = {
	magnets: Map<string, MagnetPosition>;
	drafts: Map<string, DraftTeam>;
	courtAnchors: Map<number, StagePoint>;
	stageW: number;
	stageH: number;
};

/**
 * 드롭 지점 기준 BFS 방사형 흩어짐. 소스(놓은 자석/그룹)에서 겹친 자유 자석을 밀어낸다.
 * 자석 소스는 화면 경계로 클램프(드롭한 자석도 화면 밖으로 안 나가게).
 */
function runSettle(s: SettleState, src: DragSource) {
	const playingIds = playingIdsFromCourts(useSessionStore.getState().courts);
	const vw = s.stageW || viewport().vw;
	const vh = s.stageH || viewport().vh;
	const r = MAGNET_SIZE / 2;

	let source: ScatterShape;
	if ("magnetId" in src) {
		const m = s.magnets.get(src.magnetId);
		if (!m || m.teamId !== null) return;
		// 드롭한 자석을 먼저 화면 안으로 클램프
		m.x = Math.max(r + 4, Math.min(vw - r - 4, m.x));
		m.y = Math.max(Math.max(r + 4, COURT_LANE_H + r), Math.min(vh - r - 4, m.y));
		source = { kind: "magnet", id: src.magnetId, x: m.x, y: m.y };
	} else if ("teamId" in src) {
		const t = s.drafts.get(src.teamId);
		if (!t) return;
		source = { kind: "rect", x: t.anchor.x, y: t.anchor.y };
	} else {
		const a = s.courtAnchors.get(src.courtId);
		if (!a) return; // 위치 미상(기본 레인) → 자석은 레인 아래라 겹침 없음
		source = { kind: "rect", x: a.x, y: a.y };
	}
	scatterFromSource(source, s.magnets, s.drafts, vw, vh, playingIds, COURT_LANE_H);
}

// ── 보드 멤버십 공유(drafts/reservations) ────────────────────
// 원격 멤버십 적용 중에는 자체 브로드캐스트/저장을 막기 위한 플래그.
let applyingRemoteDrafts = false;
// 마지막으로 동기화한 멤버십 JSON — 위치만 바뀐 변경(정렬 등)은 재브로드캐스트하지 않기 위함.
let lastSyncedDraftsJson = "";

/** drafts/reservations 멤버십만 직렬화(위치 제외). */
function serializeBoardDrafts(s: { drafts: Map<string, DraftTeam>; reservations: Map<string, Reservation> }): BoardDraftsPayload {
	return {
		teams: [...s.drafts.values()].map((t) => ({
			id: t.id,
			memberIds: [...t.anchorMemberIds],
			createdMs: t.createdAt,
		})),
		reservations: [...s.reservations.values()].map((r) => ({
			id: r.id,
			playerId: r.playerId,
			teamId: r.teamId,
			createdMs: r.createdAt,
		})),
	};
}

/** 멤버 자석들의 중심(새 팀의 로컬 위치 추정). */
function centroidAnchor(memberIds: string[], magnets: Map<string, MagnetPosition>): StagePoint {
	let sx = 0;
	let sy = 0;
	let n = 0;
	for (const id of memberIds) {
		const m = magnets.get(id);
		if (m) {
			sx += m.x;
			sy += m.y;
			n++;
		}
	}
	return n > 0 ? { x: sx / n, y: sy / n } : { x: 200, y: COURT_LANE_H + 60 };
}

/** 편집 가능하면 true + 자유 상태면 자동 점유(양도형 락). 보기 전용이면 false. */
function claimEdit(): boolean {
	const s = useSessionStore.getState();
	if (!s.isEditor) return false;
	s.claimEditingIfFree?.();
	return true;
}

/** 로컬 멤버십 변경을 DB 저장 + 브로드캐스트(원격 적용 중에는 생략). */
function pushDraftsToRemote(payload: BoardDraftsPayload) {
	if (!useSessionStore.getState().isEditor) return; // 보기 전용은 보드 드래프트를 공유하지 않음
	const sessionId = useAppStore.getState().sessionMeta?.sessionId;
	if (!sessionId) return;
	void dbSaveBoardDrafts(sessionId, payload);
	const channel = useSessionStore.getState()._channel;
	if (channel) sendBroadcast(channel, { event: "board_drafts_updated", payload });
}

function newId(): string {
	return crypto.randomUUID();
}

function nowMs(): number {
	return Date.now();
}

// ── store ────────────────────────────────────────────────

type Draft = { magnets: Map<string, MagnetPosition>; drafts: Map<string, DraftTeam>; reservations: Map<string, Reservation> };

export interface BoardState {
	magnets: Map<string, MagnetPosition>;
	drafts: Map<string, DraftTeam>;
	reservations: Map<string, Reservation>;
	assigningTeamIds: Set<string>;
	courtAnchors: Map<number, StagePoint>;
	/** 보드 진입 후 정렬(자동/수동)이 한 번이라도 수행됐는지 — 첫 진입 자동 정렬 1회용 */
	hasArranged: boolean;
	/** 실제 stage(보드 캔버스) 크기 — 흩어짐 바운더리 클램프용. SessionBoard가 갱신. */
	stageW: number;
	stageH: number;
	/** 휴식존(하단 패널) 표시 여부 — 플로팅 버튼으로 토글. */
	restZoneOpen: boolean;
	/** 드래그 중인 자석이 휴식 필드 위에 있는지(액티베이트 하이라이트용). */
	restFieldHot: boolean;
	/** 접속자/편집권한 모달 표시 — 헤더 칩 또는 보기전용 칩에서 연다. */
	presenceModalOpen: boolean;

	initializeFromPool: (players: SessionPlayer[]) => void;
	handleDrop: (playerId: string, drop: StagePoint) => void;
	handleGhostDrop: (resId: string, drop: StagePoint) => void;
	handlePlayingMagnetDrop: (playerId: string, drop: StagePoint) => void;
	/**
	 * 추천 다이얼로그에서 다중 선택한 선수들을 팀에 한 번에 추가(4명 상한).
	 * target.teamId가 있으면 그 팀에, target.seedId만 있으면 시드를 첫 멤버로 새 팀을 만들어 추가.
	 * 경기중 선수는 예약(ghost), 그 외는 정식 멤버(anchor).
	 */
	commitTeammates: (target: { teamId?: string; seedId?: string }, playerIds: string[]) => void;
	setTeamAnchor: (teamId: string, x: number, y: number) => void;
	setCourtAnchor: (courtId: number, x: number, y: number) => void;
	/** 실제 stage 크기 등록(흩어짐 바운더리용) */
	setStageSize: (w: number, h: number) => void;
	/** 드래그-엔드 후 소스(팀/코트)에서 겹친 자유 자석을 흩어지게 */
	settleBoard: (source: DragSource) => void;
	/** 공유된 보드 멤버십(payload)을 로컬에 적용(위치는 로컬에서 결정). 스냅샷/브로드캐스트 수신용. */
	applyRemoteDrafts: (payload: BoardDraftsPayload) => void;
	pushAwayFreeMagnets: (viewW?: number, viewH?: number) => void;
	/** 지정한 자석들을 소스로 방사형 흩어짐 + 정리(경기 완료로 그룹 해제된 자석용) */
	scatterMagnets: (ids: string[]) => void;
	rearrangeAll: (viewW: number, viewH: number) => void;
	/** 휴식존 표시 토글. */
	toggleRestZone: () => void;
	/** 휴식 필드 액티베이트(hot) 상태 설정. */
	setRestFieldHot: (hot: boolean) => void;
	/** 접속자/편집권한 모달 표시 토글. */
	setPresenceModalOpen: (open: boolean) => void;
	/** 선수를 휴식 처리(보드 멤버십에서 제거 + status='resting'). */
	restPlayer: (playerId: string) => void;
	/** 휴식 선수를 복귀(status='waiting', deficit 보정) + 자유 자석으로 drop 위치에 배치. */
	unrestPlayer: (playerId: string, drop: StagePoint) => void;
	startMatch: (teamId: string) => Promise<void>;
	completeMatch: (courtId: number) => Promise<void>;
	/** 경기 수정: 진행중 매치의 최종 로스터 설정(빠진 선수는 자유 자석으로 흩어짐). */
	setMatchRoster: (
		courtId: number,
		teamA: [string, string],
		teamB: [string, string],
	) => Promise<void>;
	reset: () => void;
}

// ── 내부 헬퍼 (immer draft 상태를 직접 변형) ───────────────

function dissolveDraft(s: Draft, teamId: string) {
	const team = s.drafts.get(teamId);
	if (team) {
		for (const id of team.anchorMemberIds) {
			const m = s.magnets.get(id);
			if (m) {
				m.teamId = null;
				m.x = team.anchor.x;
				m.y = team.anchor.y;
			}
		}
	}
	s.drafts.delete(teamId);
	// 이 팀을 가리키던 모든 예약(ghost) cascade 삭제
	for (const [rid, r] of [...s.reservations]) {
		if (r.teamId === teamId) s.reservations.delete(rid);
	}
}

/**
 * 경기시작 성공 후: 예비팀을 제거하고 멤버 4명을 팀이 있던 자리(슬롯)로 안착시킨다.
 * (경기완료로 free가 되어 다시 나타날 때 이전 팀 위치 근처에 보이도록.)
 */
function dissolveDraftAfterAssign(s: Draft, teamId: string) {
	const team = s.drafts.get(teamId);
	if (team) {
		const members = teamMembers(teamId, s.drafts, s.reservations);
		for (const mem of members) {
			const m = s.magnets.get(mem.playerId);
			if (!m) continue;
			m.teamId = null;
			const off = computeSlotOffset(mem.slot, members.length);
			m.x = team.anchor.x + off.x;
			m.y = team.anchor.y + off.y;
		}
	}
	s.drafts.delete(teamId);
	for (const [rid, r] of [...s.reservations]) {
		if (r.teamId === teamId) s.reservations.delete(rid);
	}
}

function detachAnchor(s: Draft, playerId: string) {
	const mag = s.magnets.get(playerId);
	if (!mag || mag.teamId === null) return;
	const teamId = mag.teamId;
	const team = s.drafts.get(teamId);
	mag.teamId = null;
	if (!team) return;
	team.anchorMemberIds = team.anchorMemberIds.filter((id) => id !== playerId);
	// 남은 인원이 너무 적으면(원본 0명 또는 총 2명 미만) 팀 해체
	if (team.anchorMemberIds.length === 0 || teamMemberCount(teamId, s.drafts, s.reservations) < 2) {
		dissolveDraft(s, teamId);
	}
}

function attachAnchor(s: Draft, playerId: string, teamId: string) {
	const mag = s.magnets.get(playerId);
	const team = s.drafts.get(teamId);
	if (!mag || !team) return;
	// ghost로 들어와 있던 예약이 있으면 승격(삭제 후 anchor로)
	for (const [rid, r] of [...s.reservations]) {
		if (r.playerId === playerId && r.teamId === teamId) s.reservations.delete(rid);
	}
	if (team.anchorMemberIds.includes(playerId)) {
		mag.teamId = teamId;
		return;
	}
	if (teamMemberCount(teamId, s.drafts, s.reservations) >= 4) return;
	if (mag.teamId && mag.teamId !== teamId) detachAnchor(s, playerId);
	team.anchorMemberIds.push(playerId);
	mag.teamId = teamId;
}

function addReservation(s: Draft, playerId: string, teamId: string) {
	if (!s.drafts.get(teamId)) return;
	if (isMemberOf(playerId, teamId, s.drafts, s.reservations)) return;
	if (teamMemberCount(teamId, s.drafts, s.reservations) >= 4) return;
	const id = newId();
	s.reservations.set(id, { id, playerId, teamId, createdAt: nowMs() });
}

const creator = immer<BoardState>((set, get) => ({
	magnets: new Map<string, MagnetPosition>(),
	drafts: new Map<string, DraftTeam>(),
	reservations: new Map<string, Reservation>(),
	assigningTeamIds: new Set<string>(),
	courtAnchors: new Map<number, StagePoint>(),
	hasArranged: false,
	stageW: 0,
	stageH: 0,
	restZoneOpen: false,
	restFieldHot: false,
	presenceModalOpen: false,

	initializeFromPool: (players) => {
		const current = get().magnets;
		const ids = new Set(players.map((p) => p.id));
		if (current.size === ids.size && [...ids].every((id) => current.has(id))) return;

		set((s) => {
			let idx = s.magnets.size;
			for (const p of players) {
				if (s.magnets.has(p.id)) continue;
				const pos = gridPos(idx++);
				s.magnets.set(p.id, { playerId: p.id, x: pos.x, y: pos.y, teamId: null });
			}
			const toRemove: string[] = [];
			for (const id of s.magnets.keys()) {
				if (!ids.has(id)) toRemove.push(id);
			}
			for (const id of toRemove) {
				detachAnchor(s, id);
				// 이 선수를 가리키던 예약도 정리
				for (const [rid, r] of [...s.reservations]) {
					if (r.playerId === id) s.reservations.delete(rid);
				}
				s.magnets.delete(id);
			}
		});
	},

	handleDrop: (playerId, drop) => {
		if (!claimEdit()) return; // 보기 전용 차단(자유면 자동 점유)
		const playingIds = playingIdsFromCourts(useSessionStore.getState().courts);
		set((s) => {
			const target = resolveDropTarget(playerId, drop, s.magnets, s.drafts, s.reservations, playingIds);
			let source: DragSource | null = null;
			switch (target.kind) {
				case "none":
					return; // 변화 없음 → 흩어짐 불필요
				case "move": {
					const m = s.magnets.get(playerId);
					if (m && m.teamId === null) {
						m.x = target.to.x;
						m.y = target.to.y;
					}
					source = { magnetId: playerId };
					break;
				}
				case "attach":
					attachAnchor(s, playerId, target.teamId);
					source = { teamId: target.teamId };
					break;
				case "detach": {
					detachAnchor(s, playerId);
					const m = s.magnets.get(playerId);
					if (m) {
						m.x = target.to.x;
						m.y = target.to.y;
					}
					source = { magnetId: playerId };
					break;
				}
				case "reserve":
					addReservation(s, playerId, target.toTeamId);
					source = { teamId: target.toTeamId };
					break;
				case "createPair": {
					const a = s.magnets.get(playerId);
					const b = s.magnets.get(target.partnerId);
					if (!a || !b || a.teamId !== null || b.teamId !== null) return;
					const id = newId();
					s.drafts.set(id, {
						id,
						anchorMemberIds: [playerId, target.partnerId],
						anchor: clampAnchor(target.anchor),
						createdAt: nowMs(),
					});
					a.teamId = id;
					b.teamId = id;
					source = { teamId: id };
					break;
				}
				case "reservePair": {
					const dragged = s.magnets.get(playerId);
					const partner = s.magnets.get(target.partnerId);
					if (!dragged || !partner) return;
					if (partner.teamId !== null || dragged.teamId === null) return;
					const id = newId();
					s.drafts.set(id, {
						id,
						anchorMemberIds: [target.partnerId],
						anchor: clampAnchor(target.anchor),
						createdAt: nowMs(),
					});
					partner.teamId = id;
					// 끌어낸 선수는 원본 팀에 anchor로 남고, 새 팀에는 ghost로 예약
					const rid = newId();
					s.reservations.set(rid, { id: rid, playerId, teamId: id, createdAt: nowMs() });
					source = { teamId: id };
					break;
				}
			}
			// 드래그-엔드: 소스(놓은 자석/그룹)에서 겹친 자유 자석 흩어짐
			if (source) runSettle(s, source);
		});
	},

	handleGhostDrop: (resId, drop) => {
		if (!claimEdit()) return; // 보기 전용 차단(자유면 자동 점유)
		set((s) => {
			const r = s.reservations.get(resId);
			if (!r) return;
			// 다른 예비팀 위 → 예약 대상 변경(reReserve). 옮길 수 없으면 no-op(스냅백, 예약 유지).
			let done = false;
			for (const d of s.drafts.values()) {
				if (d.id === r.teamId) continue;
				if (!isInsideTeamBounds(drop, d.anchor)) continue;
				if (
					!isMemberOf(r.playerId, d.id, s.drafts, s.reservations) &&
					teamMemberCount(d.id, s.drafts, s.reservations) < 4
				) {
					r.teamId = d.id;
				}
				done = true;
				break;
			}
			if (!done) {
				// 원래 팀 위 → 스냅백(no-op), 빈 공간 → 예약 취소
				const own = s.drafts.get(r.teamId);
				if (!(own && isInsideTeamBounds(drop, own.anchor))) {
					s.reservations.delete(resId);
				}
			}
			// ghost가 속한(또는 속했던) 팀에서 흩어짐
			if (s.drafts.get(r.teamId)) runSettle(s, { teamId: r.teamId });
		});
	},

	// 경기중(코트 배치) 선수를 끌어내 다른 팀/선수에 겹치면 예약(ghost) 생성.
	// 원본은 코트에 그대로(자석은 슬롯 복귀), 빈 공간 드롭은 no-op.
	handlePlayingMagnetDrop: (playerId, drop) => {
		if (!claimEdit()) return; // 보기 전용 차단(자유면 자동 점유)
		const playingIds = playingIdsFromCourts(useSessionStore.getState().courts);
		set((s) => {
			let source: DragSource | null = null;
			// 1) forming/ready 팀 위 → 예약 추가
			let done = false;
			for (const d of s.drafts.values()) {
				if (!isInsideTeamBounds(drop, d.anchor)) continue;
				done = true;
				if (
					!isMemberOf(playerId, d.id, s.drafts, s.reservations) &&
					teamMemberCount(d.id, s.drafts, s.reservations) < 4
				) {
					addReservation(s, playerId, d.id);
				}
				source = { teamId: d.id };
				break;
			}
			// 2) 자유 자석 위 → 새 예비팀(파트너 anchor + 이 선수 ghost)
			if (!done) {
				const partner = nearestFreePartner(playerId, drop, s.magnets, playingIds);
				if (partner) {
					const pm = s.magnets.get(partner.id);
					if (pm && pm.teamId === null) {
						const id = newId();
						s.drafts.set(id, {
							id,
							anchorMemberIds: [partner.id],
							anchor: clampAnchor({ x: (drop.x + partner.pos.x) / 2, y: (drop.y + partner.pos.y) / 2 }),
							createdAt: nowMs(),
						});
						pm.teamId = id;
						const rid = newId();
						s.reservations.set(rid, { id: rid, playerId, teamId: id, createdAt: nowMs() });
						source = { teamId: id };
					}
				}
				// 3) else no-op (슬롯 복귀)
			}
			if (source) runSettle(s, source);
		});
	},

	commitTeammates: (target, playerIds) => {
		if (!claimEdit()) return; // 보기 전용 차단(자유면 자동 점유)
		if (playerIds.length === 0) return;
		const playingIds = playingIdsFromCourts(useSessionStore.getState().courts);
		set((s) => {
			let teamId = target.teamId ?? null;
			// 시드 모드: 자유 자석을 첫 멤버로 새 팀 생성
			if (!teamId && target.seedId) {
				const seed = s.magnets.get(target.seedId);
				if (!seed || seed.teamId !== null || playingIds.has(target.seedId)) return;
				teamId = newId();
				s.drafts.set(teamId, {
					id: teamId,
					anchorMemberIds: [target.seedId],
					anchor: clampAnchor({ x: seed.x, y: seed.y }),
					createdAt: nowMs(),
				});
				seed.teamId = teamId;
			}
			if (!teamId || !s.drafts.get(teamId)) return;
			for (const pid of playerIds) {
				if (isMemberOf(pid, teamId, s.drafts, s.reservations)) continue;
				if (teamMemberCount(teamId, s.drafts, s.reservations) >= 4) break;
				// 경기중 선수는 예약(ghost), 그 외는 정식 멤버(anchor)
				if (playingIds.has(pid)) addReservation(s, pid, teamId);
				else attachAnchor(s, pid, teamId);
			}
			// 그룹 생성/채움 후 겹친 자유 자석 흩어짐
			runSettle(s, { teamId });
		});
	},

	setTeamAnchor: (teamId, x, y) => {
		set((s) => {
			const t = s.drafts.get(teamId);
			if (t) t.anchor = { x, y };
		});
	},

	setCourtAnchor: (courtId, x, y) => {
		set((s) => {
			s.courtAnchors.set(courtId, { x, y });
		});
	},

	setStageSize: (w, h) => {
		set((s) => {
			s.stageW = w;
			s.stageH = h;
		});
	},

	settleBoard: (source) => {
		set((s) => {
			runSettle(s, source);
		});
	},

	applyRemoteDrafts: (payload) => {
		applyingRemoteDrafts = true;
		set((s) => {
			// 같은 id 팀은 기존 위치(anchor) 유지, 새 팀은 멤버 중심으로 배치(위치는 로컬)
			const oldAnchors = new Map<string, StagePoint>();
			for (const [id, t] of s.drafts) oldAnchors.set(id, { x: t.anchor.x, y: t.anchor.y });

			// 적용 전 "이미 필드에 있던" 자유 자석 — 원격 변경으로 새로 들어온 자석 판별용
			const prevFreeIds = new Set<string>();
			for (const [, m] of s.magnets) if (m.teamId === null) prevFreeIds.add(m.playerId);

			// 멤버십 초기화 후 payload로 재구성
			for (const m of s.magnets.values()) m.teamId = null;

			const newDrafts = new Map<string, DraftTeam>();
			for (const team of payload.teams) {
				const memberIds = team.memberIds.filter((id) => s.magnets.has(id));
				if (memberIds.length === 0) continue;
				const anchor = oldAnchors.get(team.id) ?? centroidAnchor(memberIds, s.magnets);
				newDrafts.set(team.id, {
					id: team.id,
					anchorMemberIds: memberIds,
					anchor: clampAnchor(anchor),
					createdAt: team.createdMs,
				});
				for (const id of memberIds) {
					const m = s.magnets.get(id);
					if (m) m.teamId = team.id;
				}
			}
			s.drafts = newDrafts;

			const newRes = new Map<string, Reservation>();
			for (const r of payload.reservations) {
				if (!newDrafts.has(r.teamId)) continue;
				if (!s.magnets.has(r.playerId)) continue;
				newRes.set(r.id, { id: r.id, playerId: r.playerId, teamId: r.teamId, createdAt: r.createdMs });
			}
			s.reservations = newRes;

			// 원격 변경으로 "새로 필드에 들어온" 자석(팀/예약 → 자유): 내가 드래그하지 않았어도
			// 드롭과 동일하게 흩어짐을 적용 — 각 자석을 소스로 BFS 방사형으로 주변을 밀어낸다.
			const playingIds = playingIdsFromCourts(useSessionStore.getState().courts);
			const vw = s.stageW || viewport().vw;
			const vh = s.stageH || viewport().vh;
			const r = MAGNET_SIZE / 2;
			for (const [, m] of s.magnets) {
				if (m.teamId !== null || playingIds.has(m.playerId)) continue;
				if (prevFreeIds.has(m.playerId)) continue; // 원래 필드에 있던 자석은 흩어짐 대상 아님
				// 들어온 자석을 화면(필드) 안으로 클램프 후 그 자리를 소스로 흩어짐
				m.x = Math.max(r + 4, Math.min(vw - r - 4, m.x));
				m.y = Math.max(Math.max(r + 4, COURT_LANE_H + r), Math.min(vh - r - 4, m.y));
				scatterFromSource(
					{ kind: "magnet", id: m.playerId, x: m.x, y: m.y },
					s.magnets,
					s.drafts,
					vw,
					vh,
					playingIds,
					COURT_LANE_H,
				);
			}
			// 잔여 겹침/팀 박스 침범 정리(들어온 자석이 팀 박스 안이면 빈자리로 이동)
			settleFreeMagnets(s.magnets, s.drafts, vw, vh, playingIds, COURT_LANE_H);
		});
		// 방금 적용한 멤버십을 기준선으로 — 이후 위치만 바뀌면 재브로드캐스트 안 함
		lastSyncedDraftsJson = JSON.stringify(serializeBoardDrafts(get()));
		applyingRemoteDrafts = false;
	},

	pushAwayFreeMagnets: (viewW, viewH) => {
		set((s) => {
			const vw = viewW ?? (typeof window !== "undefined" ? window.innerWidth : 400);
			const vh = viewH ?? (typeof window !== "undefined" ? window.innerHeight - 84 : 700);
			const playingIds = playingIdsFromCourts(useSessionStore.getState().courts);
			settleFreeMagnets(s.magnets, s.drafts, vw, vh, playingIds, COURT_LANE_H);
		});
	},

	scatterMagnets: (ids) => {
		set((s) => {
			const playingIds = playingIdsFromCourts(useSessionStore.getState().courts);
			const restingIds = new Set(useSessionStore.getState().restingIds);
			const vw = s.stageW || viewport().vw;
			const vh = s.stageH || viewport().vh;
			const r = MAGNET_SIZE / 2;

			// 흩어뜨릴 대상: 자유(teamId null)·비경기중·비휴식 자석만
			const targets: MagnetPosition[] = [];
			for (const id of ids) {
				const m = s.magnets.get(id);
				if (m && m.teamId === null && !playingIds.has(id) && !restingIds.has(id)) targets.push(m);
			}
			if (targets.length === 0) return;

			// 경기 완료된 자석은 "경기 시작 때 그룹이 있던 자리"에 그대로 남아 그룹과 겹쳐 가려진다.
			// → 그룹(팀) 영역의 최하단 아래(자유 자석 영역, 항상 보이는 곳)로 옮긴 뒤 흩어짐을 시작한다.
			let groupBottom = COURT_LANE_H;
			for (const t of s.drafts.values()) {
				groupBottom = Math.max(groupBottom, t.anchor.y + TEAM_BOX_BELOW);
			}
			const startY = Math.max(COURT_LANE_H + r, Math.min(vh - r - 4, groupBottom + r + 8));

			targets.forEach((m, i) => {
				m.x = Math.max(r + 4, Math.min(vw - r - 4, r + 8 + i * (MAGNET_SIZE + 10)));
				m.y = startY;
				scatterFromSource(
					{ kind: "magnet", id: m.playerId, x: m.x, y: m.y },
					s.magnets,
					s.drafts,
					vw,
					vh,
					playingIds,
					COURT_LANE_H,
				);
			});
			// 잔여 겹침/팀 박스 침범 정리 (완료 자석 + 기존 자유 자석 모두 겹침 해소)
			settleFreeMagnets(s.magnets, s.drafts, vw, vh, playingIds, COURT_LANE_H);
		});
	},

	rearrangeAll: (viewW, viewH) => {
		set((s) => {
			const sessionCourts = useSessionStore.getState().courts;
			const sessionPlayers = useSessionStore.getState().sessionPlayers;
			const playingIds = playingIdsFromCourts(sessionCourts);
			const restingIds = new Set(useSessionStore.getState().restingIds);
			const halfW = TEAM_W / 2;
			const PAD_X = 12;
			const GAP_X = 16;
			const GAP_Y = 16;

			const cols = Math.max(1, Math.floor((viewW - PAD_X * 2 + GAP_X) / (TEAM_W + GAP_X)));
			const rowH = TEAM_BOX_ABOVE + TEAM_BOX_BELOW + GAP_Y;
			// 그룹(코트 카드·팀) 박스는 anchor 기준 위 TEAM_BOX_ABOVE / 아래 TEAM_BOX_BELOW,
			// 좌우 halfW 만큼 뻗는다. 격자 좌표를 화면 경계 안으로 클램프해 어떤 그룹도 밖으로 넘지 않게 한다.
			const maxAnchorY = Math.max(TEAM_BOX_ABOVE, viewH - TEAM_BOX_BELOW);
			const gridAnchor = (idx: number, top: number) => {
				const col = idx % cols;
				const row = Math.floor(idx / cols);
				return {
					x: Math.max(halfW, Math.min(viewW - halfW, PAD_X + halfW + col * (TEAM_W + GAP_X))),
					y: Math.min(maxAnchorY, top + TEAM_BOX_ABOVE + row * rowH),
				};
			};

			// 1) 그룹을 하나의 연속 격자에 종류 순서대로 이어서 배치(같은 줄 공유).
			//    순서: 경기중(코트) → 4명 찬 팀 → 그 외 팀(멤버 많은 순)
			const occupied = sessionCourts.filter((c) => c.match);
			const teams = [...s.drafts.values()].sort((a, b) => {
				const ca = teamMemberCount(a.id, s.drafts, s.reservations);
				const cb = teamMemberCount(b.id, s.drafts, s.reservations);
				const fa = ca === 4 ? 1 : 0;
				const fb = cb === 4 ? 1 : 0;
				if (fa !== fb) return fb - fa; // 4명 찬 그룹 먼저
				if (cb !== ca) return cb - ca; // 그 외: 멤버 많은 순
				return a.createdAt - b.createdAt;
			});
			const GROUP_TOP = 10;
			let gi = 0;
			for (const c of occupied) s.courtAnchors.set(c.id, gridAnchor(gi++, GROUP_TOP));
			for (const t of teams) t.anchor = gridAnchor(gi++, GROUP_TOP);
			const groupCount = occupied.length + teams.length;
			const groupRows = groupCount > 0 ? Math.ceil(groupCount / cols) : 0;
			const groupAreaBottom = groupRows > 0 ? GROUP_TOP + groupRows * rowH : COURT_LANE_H;

			// 2) 나머지 자유 자석을 그룹 영역 아래에 격자 배치 — 경기수 적은 사람 먼저
			//    (휴식 선수는 휴식존으로 분리되므로 메인 보드 배치에서 제외)
			const freeMagnets = [...s.magnets.values()]
				.filter((m) => m.teamId === null && !playingIds.has(m.playerId) && !restingIds.has(m.playerId))
				.sort((a, b) => {
					const ga = sessionPlayers.get(a.playerId)?.gameCount ?? 0;
					const gb = sessionPlayers.get(b.playerId)?.gameCount ?? 0;
					return ga - gb;
				});
			const magCols = Math.max(1, Math.floor(viewW / (MAGNET_SIZE + 10)));
			const freeStartY = groupAreaBottom + MAGNET_SIZE / 2 + 8;
			freeMagnets.forEach((m, i) => {
				const col = i % magCols;
				const row = Math.floor(i / magCols);
				m.x = MAGNET_SIZE / 2 + 8 + col * (MAGNET_SIZE + 10);
				m.y = freeStartY + row * (MAGNET_SIZE + 10);
			});

			// 3) 남은 겹침 정리 + 화면 바운더리 클램프 (그룹 영역 아래로)
			settleFreeMagnets(s.magnets, s.drafts, viewW, viewH, playingIds, groupAreaBottom);
			s.hasArranged = true;
		});
	},

	toggleRestZone: () => {
		set((s) => {
			s.restZoneOpen = !s.restZoneOpen;
		});
	},

	setRestFieldHot: (hot) => {
		// 값이 같으면 immer가 동일 상태를 반환해 리렌더 없음(드래그 프레임마다 호출돼도 안전).
		set((s) => {
			s.restFieldHot = hot;
		});
	},

	setPresenceModalOpen: (open) => {
		set((s) => {
			s.presenceModalOpen = open;
		});
	},

	restPlayer: (playerId) => {
		if (!claimEdit()) return; // 보기 전용 차단(자유면 자동 점유)
		set((s) => {
			// 보드 멤버십에서 제거: 팀 anchor 해제 + 이 선수를 가리키는 예약(ghost) 삭제.
			detachAnchor(s, playerId);
			for (const [rid, r] of [...s.reservations]) {
				if (r.playerId === playerId) s.reservations.delete(rid);
			}
		});
		// status='resting' (휴식 진입 — deficit 기준점 기록). 다른 클라이언트에 player_updated 전파.
		void useSessionStore.getState().setResting(playerId, true);
	},

	unrestPlayer: (playerId, drop) => {
		if (!claimEdit()) return; // 보기 전용 차단(자유면 자동 점유)
		// status='waiting' 복귀(deficit 보정). 자유 자석으로 drop 위치에 배치.
		void useSessionStore.getState().setResting(playerId, false);
		set((s) => {
			const m = s.magnets.get(playerId);
			if (!m) return;
			m.teamId = null;
			m.x = drop.x;
			m.y = drop.y;
			runSettle(s, { magnetId: playerId });
		});
	},

	startMatch: async (teamId) => {
		if (!claimEdit()) return; // 보기 전용 차단(자유면 자동 점유)
		const { drafts, reservations, magnets, assigningTeamIds } = get();
		if (assigningTeamIds.has(teamId)) return;

		const session = useSessionStore.getState();
		const playingIds = playingIdsFromCourts(session.courts);
		if (!isTeamStartable(teamId, drafts, reservations, magnets, playingIds)) {
			toast("아직 경기를 시작할 수 없어요", { variant: "error" });
			return;
		}
		const empty = session.courts.find((c) => !c.match);
		if (!empty) {
			toast("빈 코트가 없어요", { variant: "error" });
			return;
		}
		const members = teamMembers(teamId, drafts, reservations);
		const four = members
			.map((m) => session.sessionPlayers.get(m.playerId))
			.filter((p): p is SessionPlayer => Boolean(p));
		if (four.length !== 4) return;

		// 경기시작 시 새 코트 카드가 좌상단 기본 위치로 튀지 않도록, 만들어진 그룹의 자리를 그대로 물려준다.
		const ta = drafts.get(teamId)?.anchor;
		const teamAnchor = ta ? { x: ta.x, y: ta.y } : null;

		const singleWomanIds = useAppStore.getState().sessionMeta?.singleWomanIds ?? [];
		const gen = pairPlayers(
			four as [SessionPlayer, SessionPlayer, SessionPlayer, SessionPlayer],
			singleWomanIds,
			"보드 수동 편성",
		);

		set((s) => {
			s.assigningTeamIds.add(teamId);
		});
		try {
			await session.handleAssign(gen, empty.id);
			// 성공 판정: 해당 코트의 match가 "우리 4명"으로 채워졌는지 확인(낙관적 dissolve 금지 + race 오판 방지)
			const court = useSessionStore.getState().courts.find((c) => c.id === empty.id);
			const ourIds = new Set(members.map((m) => m.playerId));
			const placedIds = court?.match ? [...court.match.teamA, ...court.match.teamB] : [];
			const ok = placedIds.length === 4 && placedIds.every((id) => ourIds.has(id));
			if (ok) {
				set((s) => {
					dissolveDraftAfterAssign(s, teamId);
					// 코트 카드를 방금 그 그룹이 있던 자리에 그대로 표시(좌상단 점프 X)
					if (teamAnchor) s.courtAnchors.set(empty.id, teamAnchor);
				});
			} else {
				toast("코트 배치에 실패했어요. 다시 시도하세요", { variant: "error" });
			}
		} finally {
			set((s) => {
				s.assigningTeamIds.delete(teamId);
			});
		}
	},

	completeMatch: async (courtId) => {
		if (!claimEdit()) return; // 보기 전용 차단(자유면 자동 점유)
		// 완료 처리 전에 끝난 4명 id를 확보(이후 court.match는 null이 됨)
		const court = useSessionStore.getState().courts.find((c) => c.id === courtId);
		const endedIds = court?.match ? [...court.match.teamA, ...court.match.teamB] : [];
		await useSessionStore.getState().handleComplete(courtId);
		// 그룹 해제로 자유 자석이 된 4명에 흩어짐 적용(방사형 + 겹침 정리)
		get().scatterMagnets(endedIds);
	},

	setMatchRoster: async (courtId, teamA, teamB) => {
		if (!claimEdit()) return; // 보기 전용 차단(자유면 자동 점유)
		const court = useSessionStore.getState().courts.find((c) => c.id === courtId);
		const oldIds = court?.match ? [...court.match.teamA, ...court.match.teamB] : [];
		const newIds = [...teamA, ...teamB];
		const removed = oldIds.filter((id) => !newIds.includes(id));
		await useSessionStore.getState().handleSetMatchRoster(courtId, teamA, teamB);
		// 빠진 선수는 자유 자석으로 보이게 흩어뜨림(들어온 선수는 playing→자동 숨김)
		if (removed.length > 0) get().scatterMagnets(removed);
	},

	reset: () => {
		set((s) => {
			s.magnets = new Map();
			s.drafts = new Map();
			s.reservations = new Map();
			s.assigningTeamIds = new Set();
			s.courtAnchors = new Map();
			s.hasArranged = false;
			s.stageW = 0;
			s.stageH = 0;
			s.restZoneOpen = false;
			s.restFieldHot = false;
			s.presenceModalOpen = false;
		});
	},
}));

export const useBoardStore = create<BoardState>()(
	devtools(creator, { name: "boardStore", enabled: import.meta.env.DEV }),
);

// 로컬 멤버십(drafts/reservations) 변경 시 DB 저장 + 브로드캐스트로 공유.
// 위치(자석/anchor) 변경은 무시(로컬). 원격 적용 중에는 생략(피드백 루프 방지).
useBoardStore.subscribe((state, prev) => {
	if (applyingRemoteDrafts) return;
	if (state.drafts === prev.drafts && state.reservations === prev.reservations) return;
	const payload = serializeBoardDrafts(state);
	const json = JSON.stringify(payload);
	if (json === lastSyncedDraftsJson) return; // 멤버십 동일(위치만 변경) → 생략
	lastSyncedDraftsJson = json;
	pushDraftsToRemote(payload);
});
