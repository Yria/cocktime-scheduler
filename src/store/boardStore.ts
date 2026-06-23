import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import { devtools } from "zustand/middleware";
import { enableMapSet } from "immer";

import type { SessionPlayer } from "../types";
import type { BoardDraftsPayload, DraftTeam, MagnetPosition, Reservation, StagePoint } from "../types/board";
import {
	clampAnchor,
	computeSlotOffset,
	DEFAULT_VIEWPORT,
	isInsideTeamBounds,
	isOnEmptySlot,
} from "../lib/board/geometry";
import { MAGNET_SIZE, TEAM_BOX_BELOW } from "../lib/board/constants";
import { arrangeBoard } from "../lib/board/arrange";
import { canonicalizeDrafts, reconcileMembership } from "../lib/board/remoteDrafts";
import { scatterFromSource, type ScatterShape } from "../lib/board/scatter";
import { settleFreeMagnets } from "../lib/board/settle";
import { resolveDropTarget, nearestFreePartner } from "../lib/board/dropResolver";
import {
	cockPendingIds,
	isMemberOf,
	isTeamStartable,
	matchPlayerIds,
	matchPlayerIdsFromCourt,
	playingIdsFromCourts,
	teamMemberCount,
	teamMembers,
} from "../lib/board/membership";
import { buildRecommendData } from "../lib/board/recommendPool";
import { useSessionStore } from "./sessionStore";
import { useAppStore } from "./appStore";
import { autoFillTeammates, pairPlayers } from "../lib/teamSelection";
import { toast } from "./toastStore";
import { dbBoardSaveDrafts, sendBroadcast } from "../lib/supabase";

enableMapSet();

// ── grid layout for initial pool ─────────────────────────

const POOL_COLS = 4;
const POOL_START_X = MAGNET_SIZE;
// 풀 그리드 시작 — 상단부터(코트 전용 영역 개념 없음). 첫 진입 시 rearrangeAll이 다시 정렬한다.
const POOL_START_Y = MAGNET_SIZE;
const POOL_GAP_X = MAGNET_SIZE + 10;
const POOL_GAP_Y = MAGNET_SIZE + 10;

function gridPos(i: number): StagePoint {
	return {
		x: POOL_START_X + (i % POOL_COLS) * POOL_GAP_X,
		y: POOL_START_Y + Math.floor(i / POOL_COLS) * POOL_GAP_Y,
	};
}

/** 현재 stage 크기 기준으로 anchor를 화면 안에 클램프. stage 미설정 시 기본 뷰포트. */
function clampToStage(s: { stageW: number; stageH: number }, p: StagePoint): StagePoint {
	return clampAnchor(p, s.stageW || DEFAULT_VIEWPORT.vw, s.stageH || DEFAULT_VIEWPORT.vh);
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
	const vw = s.stageW || DEFAULT_VIEWPORT.vw;
	const vh = s.stageH || DEFAULT_VIEWPORT.vh;
	const r = MAGNET_SIZE / 2;

	let source: ScatterShape;
	if ("magnetId" in src) {
		const m = s.magnets.get(src.magnetId);
		if (!m || m.teamId !== null) return;
		// 드롭한 자석은 "놓은 자리에 그대로" — 화면 경계로만 클램프(상단 코트 레인 제한 없음).
		// (사용자가 의도적으로 둔 위치 보존 = "아무데나". 코트 카드는 위에 렌더되므로 겹쳐도 카드 버튼은 동작.)
		m.x = Math.max(r + 4, Math.min(vw - r - 4, m.x));
		m.y = Math.max(r + 4, Math.min(vh - r - 4, m.y));
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
	// 흩어짐도 화면 경계로만(레인 floor 없음) — 자유 배치 일관성
	scatterFromSource(source, s.magnets, s.drafts, vw, vh, playingIds, 0);
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

/**
 * 편집 가능하면 true. 이미 보유자면 통과, 남이 편집 중이면 차단, 자유면 낙관적으로 점유(서버 락은
 * 첫 저장 self-claim/heartbeat가 확정). claimEditingIfFree가 동기적으로 isEditor를 올리므로 즉시 반영.
 */
function claimEdit(): boolean {
	const s = useSessionStore.getState();
	if (s.isEditor) return true;
	if (!s.lockFree) return false; // 다른 기기가 편집 중 → 보기 전용
	s.claimEditingIfFree();
	return useSessionStore.getState().isEditor;
}

// board_drafts 저장 직렬화 — CAS(version) 자기충돌 방지. 진행 중이면 최신 payload만 큐잉(trailing).
let draftsSaveInFlight = false;
let pendingDraftsPayload: BoardDraftsPayload | null = null;

/**
 * 로컬 멤버십 변경을 board_save_drafts(낙관적 버전 CAS + self-claim)로 저장하고 broadcast.
 * - 성공: 새 version으로 sessionStore 갱신(연속 편집 base) + broadcast로 즉시성 제공.
 * - 충돌(null: version 불일치/락 상실): 서버 최신으로 resync(내 변경 폐기). 단일 편집자에선 드묾.
 * 원격 적용 중에는 호출 자체가 일어나지 않음(subscribe에서 applyingRemoteDrafts 가드).
 */
function pushDraftsToRemote(payload: BoardDraftsPayload) {
	const ss = useSessionStore.getState();
	if (!ss.isEditor) return; // 보기 전용은 보드 드래프트를 공유하지 않음
	const sessionId = useAppStore.getState().sessionMeta?.sessionId;
	const clientId = ss._clientId;
	if (!sessionId || !clientId) return;
	if (draftsSaveInFlight) {
		pendingDraftsPayload = payload; // 진행 중 — 최신만 보관(이전 base가 stale해 자기충돌하는 것 방지)
		return;
	}
	draftsSaveInFlight = true;
	const name = ss._myName ?? "기기";
	const base = ss.boardDraftsVersion;
	void dbBoardSaveDrafts(sessionId, clientId, name, payload, base).then((newVersion) => {
		draftsSaveInFlight = false;
		const sess = useSessionStore.getState();
		if (newVersion == null) {
			// 충돌(version 불일치/락 상실) — 서버 권위로 수렴(미저장 로컬 변경은 되돌려짐).
			// 단일 편집자 모델에선 드물지만(핸드오프/lease 만료 레이스) 조용한 유실 방지 위해 알린다.
			pendingDraftsPayload = null;
			void sess.resyncFromServer();
			toast("편집 권한 충돌로 마지막 변경이 취소되고 최신 상태로 동기화했어요", { variant: "error" });
			return;
		}
		sess.applyDraftsIfNewer(payload, newVersion); // 내 버전 즉시 갱신(다음 저장 base)
		const channel = sess._channel;
		if (channel) {
			sendBroadcast(channel, { event: "board_drafts_updated", payload: { drafts: payload, version: newVersion } });
		}
		if (pendingDraftsPayload) {
			const next = pendingDraftsPayload;
			pendingDraftsPayload = null;
			pushDraftsToRemote(next); // 큐잉된 최신 변경을 새 base로 이어 저장
		}
	});
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
	/**
	 * 편집자가 직접 드래그로 자석/팀/코트를 배치했는지. true가 되면 자동 정렬을 멈춘다(수동 배치가 진실).
	 * false인 동안에는 뷰어와 동일하게 입력(자석 수·멤버십·뷰포트) 변화마다 재정렬 → 첫 접근 시 "정렬 버튼"
	 * 결과로 수렴한다. 세션 진입마다 reset(false). 추천 다이얼로그 편성(commitTeammates)은 위치 선택이 아니라
	 * 멤버십 변경이므로 manual로 치지 않는다(새 팀도 자동 정렬에 맡겨 그리드로 정돈).
	 */
	manualLayout: boolean;
	/** 실제 stage(보드 캔버스) 크기 — 흩어짐 바운더리 클램프용. SessionBoard가 갱신. */
	stageW: number;
	stageH: number;
	/** 휴식존(하단 패널) 표시 여부 — 플로팅 버튼으로 토글. */
	restZoneOpen: boolean;
	/** 드래그 중인 자석이 휴식 필드 위에 있는지(액티베이트 하이라이트용). */
	restFieldHot: boolean;
	/** 접속자/편집권한 모달 표시 — 헤더 칩 또는 보기전용 칩에서 연다. */
	presenceModalOpen: boolean;
	/**
	 * 드래그 중인 자석 정보(드롭존 표시·하이라이트용). null이면 드래그 안 함.
	 * - detachable=팀 소속(anchor/ghost) → 상단 '팀에서 빼기' 밴드 노출.
	 * - restable=휴식 가능(편집자의 free/anchor 대기 자석) → 하단 '휴식하기' 밴드 노출.
	 * - from=드래그 시작 논리좌표 → 출발 존(빼기/휴식)에서 같은 존으로의 드롭을 무효화하는 가드용.
	 */
	dragInfo: { playerId: string; detachable: boolean; restable: boolean; from: StagePoint } | null;
	/** 드래그 중 현재 겹침 대상(하이라이트). team=그룹 박스, magnet=페어 상대. */
	hoverTarget: { kind: "team" | "magnet"; id: string } | null;
	/** 드래그가 상단 '팀에서 빼기' 드롭존 위에 있는지(hot). */
	detachHot: boolean;

	initializeFromPool: (players: SessionPlayer[]) => void;
	handleDrop: (playerId: string, drop: StagePoint) => void;
	handleGhostDrop: (resId: string, drop: StagePoint) => void;
	handlePlayingMagnetDrop: (playerId: string, drop: StagePoint) => void;
	/**
	 * 추천 다이얼로그에서 다중 선택한 선수들을 팀에 한 번에 추가(4명 상한).
	 * target.teamId가 있으면 그 팀에, target.seedId만 있으면 시드를 첫 멤버로 새 팀을 만들어 추가.
	 * 경기중 선수는 예약(ghost), 그 외는 정식 멤버(anchor).
	 */
	commitTeammates: (target: { teamId?: string; seedId?: string; newTeam?: boolean }, playerIds: string[]) => void;
	/**
	 * 자동편성 — 구성 중 팀(teamId)의 빈 슬롯을 추천도 높은순으로 채운다(대기 선수만, 4명 상한).
	 * 한 명 추가할 때마다 알고리즘을 다시 돌려 다음 추천 1명을 뽑는 greedy 방식.
	 */
	autoFillTeam: (teamId: string) => void;
	setTeamAnchor: (teamId: string, x: number, y: number) => void;
	setCourtAnchor: (courtId: number, x: number, y: number) => void;
	/** 실제 stage 크기 등록(흩어짐 바운더리용) */
	setStageSize: (w: number, h: number) => void;
	/** 드래그-엔드 후 소스(팀/코트)에서 겹친 자유 자석을 흩어지게 */
	settleBoard: (source: DragSource) => void;
	/** 공유된 보드 멤버십(payload)을 로컬에 적용(위치는 로컬에서 결정). 스냅샷/브로드캐스트 수신용. */
	applyRemoteDrafts: (payload: BoardDraftsPayload) => void;
	/** 지정한 자석들을 소스로 방사형 흩어짐 + 정리(경기 완료로 그룹 해제된 자석용) */
	scatterMagnets: (ids: string[]) => void;
	rearrangeAll: (viewW: number, viewH: number) => void;
	/** 휴식존 표시 토글. */
	toggleRestZone: () => void;
	/** 휴식 필드 액티베이트(hot) 상태 설정. */
	setRestFieldHot: (hot: boolean) => void;
	/** 드래그 시작/종료 시 드래그 정보 설정(null=종료). */
	setDragInfo: (info: { playerId: string; detachable: boolean; restable: boolean; from: StagePoint } | null) => void;
	/** 드래그 중 겹침 대상 하이라이트 설정(변화 시에만 반영). */
	setHoverTarget: (t: { kind: "team" | "magnet"; id: string } | null) => void;
	/** '팀에서 빼기' 드롭존 hot 설정(변화 시에만 반영). */
	setDetachHot: (hot: boolean) => void;
	/** 드래그 종료 — dragInfo/hoverTarget/detachHot 일괄 초기화. */
	clearDrag: () => void;
	/** 멤버를 팀에서 빼 자유 자석으로(드롭존). drop 위치에 두고 흩어짐. */
	detachMember: (playerId: string, drop: StagePoint) => void;
	/** 예약(ghost) 취소(드롭존). */
	cancelReservation: (resId: string) => void;
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
	manualLayout: false,
	stageW: 0,
	stageH: 0,
	restZoneOpen: false,
	restFieldHot: false,
	presenceModalOpen: false,
	dragInfo: null,
	hoverTarget: null,
	detachHot: false,

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
		// 보기 전용(읽기 모드): 공유 멤버십(팀/예약)은 못 바꾸지만, 자유 자석의 로컬 위치 이동은 허용(위치는 로컬 상태·미동기화).
		// 멤버(anchor)는 슬롯 고정이라 스냅백, 팀 합류/페어 등 공유 변경은 일어나지 않는다.
		// (세션 진입 시 자동 점유로 opener는 항상 isEditor=true → 여기 분기는 '남이 편집 중인' 읽기 모드 사용자만 탄다.)
		if (!useSessionStore.getState().isEditor) {
			set((s) => {
				const m = s.magnets.get(playerId);
				if (!m || m.teamId !== null) return;
				const p = clampToStage(s, drop);
				m.x = p.x;
				m.y = p.y;
				runSettle(s, { magnetId: playerId });
			});
			return;
		}
		const ss = useSessionStore.getState();
		const playingIds = playingIdsFromCourts(ss.courts);
		const notReadyIds = cockPendingIds(ss.sessionPlayers.values(), ss.cockCheckEnabled);
		set((s) => {
			s.manualLayout = true; // 편집자가 직접 드래그로 배치/편성 → 이후 자동 정렬 중단(수동이 진실)
			const target = resolveDropTarget(playerId, drop, s.magnets, s.drafts, s.reservations, playingIds, notReadyIds);
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
						anchor: clampToStage(s, target.anchor),
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
						anchor: clampToStage(s, target.anchor),
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
		const ss = useSessionStore.getState();
		const playingIds = playingIdsFromCourts(ss.courts);
		const notReadyIds = cockPendingIds(ss.sessionPlayers.values(), ss.cockCheckEnabled);
		set((s) => {
			let source: DragSource | null = null;
			// 1) forming/ready 팀의 빈 슬롯(구멍) 위 → 예약 추가. 박스 안 다른 곳이면 슬롯 복귀(no-op).
			//    박스가 겹칠 수 있으므로 bounds 안 모든 팀을 보고 슬롯이 맞는 팀에 예약(첫 박스에서 멈추지 않음).
			let done = false;
			for (const d of s.drafts.values()) {
				if (!isInsideTeamBounds(drop, d.anchor)) continue;
				done = true; // 박스 안이면 새 팀 생성(2단계)으로 넘어가지 않음
				const count = teamMemberCount(d.id, s.drafts, s.reservations);
				if (
					!isMemberOf(playerId, d.id, s.drafts, s.reservations) &&
					count < 4 &&
					isOnEmptySlot(drop, d.anchor, count)
				) {
					addReservation(s, playerId, d.id);
					source = { teamId: d.id };
					break; // 슬롯에 예약 성공 → 종료
				}
			}
			// 2) 자유 자석 위 → 새 예비팀(파트너 anchor + 이 선수 ghost)
			if (!done) {
				const partner = nearestFreePartner(playerId, drop, s.magnets, playingIds, notReadyIds);
				if (partner) {
					const pm = s.magnets.get(partner.id);
					if (pm && pm.teamId === null) {
						const id = newId();
						s.drafts.set(id, {
							id,
							anchorMemberIds: [partner.id],
							anchor: clampToStage(s, { x: (drop.x + partner.pos.x) / 2, y: (drop.y + partner.pos.y) / 2 }),
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
					anchor: clampToStage(s, { x: seed.x, y: seed.y }),
					createdAt: nowMs(),
				});
				seed.teamId = teamId;
			}
			// 새 팀 모드(+ 버튼): 선택분 중 첫 비경기중·자유 선수를 anchor로 새 팀 생성
			if (!teamId && target.newTeam) {
				const anchorId = playerIds.find((id) => {
					const m = s.magnets.get(id);
					return m && m.teamId === null && !playingIds.has(id);
				});
				if (!anchorId) return; // anchor 가능한 선수 없음
				const am = s.magnets.get(anchorId)!;
				teamId = newId();
				s.drafts.set(teamId, {
					id: teamId,
					anchorMemberIds: [anchorId],
					anchor: clampToStage(s, { x: am.x, y: am.y }),
					createdAt: nowMs(),
				});
				am.teamId = teamId;
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

	autoFillTeam: (teamId) => {
		if (!claimEdit()) return; // 보기 전용 차단
		const { drafts, reservations, magnets } = get();
		const ss = useSessionStore.getState();
		const data = buildRecommendData(
			{ teamId },
			[],
			{
				drafts,
				reservations,
				magnets,
				sessionPlayers: ss.sessionPlayers,
				courts: ss.courts,
				pairHistory: ss.pairHistory,
				lastGameType: ss.lastGameType,
				matchAssignCount: ss.matchAssignCount,
				cockCheckEnabled: ss.cockCheckEnabled,
			},
			{ excludePlaying: true }, // 자동편성은 대기 선수만으로 채운다(경기중 제외)
		);
		if (!data) return;
		const slotsToFill = 4 - data.members.length;
		if (slotsToFill <= 0) return; // 이미 가득 참
		const picks = autoFillTeammates(data.confirmed, data.pool, data.ctx, slotsToFill);
		if (picks.length === 0) {
			toast("자동편성할 대기 선수가 없어요", { variant: "error" });
			return;
		}
		get().commitTeammates({ teamId }, picks.map((p) => p.id));
		if (picks.length < slotsToFill) {
			toast(`대기 선수가 부족해 ${picks.length}명만 채웠어요`);
		}
	},

	setTeamAnchor: (teamId, x, y) => {
		const editing = useSessionStore.getState().isEditor;
		set((s) => {
			if (editing) s.manualLayout = true; // 편집자가 팀을 직접 옮기면 자동 정렬 중단(뷰어 로컬 이동은 자동 유지)
			const t = s.drafts.get(teamId);
			if (t) t.anchor = clampToStage(s, { x, y }); // 화면 안 어디든(코트 레인 제한 없음), 화면 밖만 방지
		});
	},

	setCourtAnchor: (courtId, x, y) => {
		const editing = useSessionStore.getState().isEditor;
		set((s) => {
			if (editing) s.manualLayout = true; // 편집자가 코트 카드를 직접 옮기면 자동 정렬 중단
			s.courtAnchors.set(courtId, clampToStage(s, { x, y })); // 코트 카드도 화면 안 어디든
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
		// 멤버십이 실제로 안 바뀐 재수신/스냅샷(handleBoardDraftsUpdated는 동일 멤버십도 매번 새 객체 set)이면
		// 자석 위치를 전혀 만지지 않는다 — 자유 자석 위치는 로컬 전용이므로 보존되어야 한다.
		if (canonicalizeDrafts(payload) === canonicalizeDrafts(serializeBoardDrafts(get()))) return;
		applyingRemoteDrafts = true;
		try {
			set((s) => {
				// 같은 id 팀은 기존 위치(anchor) 유지, 새 팀은 멤버 중심으로 배치(위치는 로컬)
				const oldAnchors = new Map<string, StagePoint>();
				for (const [id, t] of s.drafts) oldAnchors.set(id, { x: t.anchor.x, y: t.anchor.y });

				// 적용 전 "이미 필드에 있던" 자유 자석 — 원격 변경으로 새로 들어온 자석 판별용
				const prevFreeIds = new Set<string>();
				for (const [, m] of s.magnets) if (m.teamId === null) prevFreeIds.add(m.playerId);

				const vw = s.stageW || DEFAULT_VIEWPORT.vw;
				const vh = s.stageH || DEFAULT_VIEWPORT.vh;

				// 멤버십(drafts/reservations) 재구성 + 자석 teamId 재설정(위치는 아래에서 별도 처리)
				const { drafts, reservations } = reconcileMembership(payload, s.magnets, oldAnchors, vw, vh);
				s.drafts = drafts;
				s.reservations = reservations;

				// 원격 변경으로 "새로 필드에 들어온" 자석(팀/예약 → 자유): 내가 드래그하지 않았어도
				// 드롭과 동일하게 흩어짐을 적용 — 각 자석을 소스로 BFS 방사형으로 주변을 밀어낸다.
				const playingIds = playingIdsFromCourts(useSessionStore.getState().courts);
				const r = MAGNET_SIZE / 2;
				// 흩어짐/정리에서 "사용자가 직접 배치한(원래 필드에 있던) 자유 자석"은 제외해 위치를 보존한다.
				// 이게 빠지면 원격 멤버십 동기화가 내가 방금 드롭한 자석을 밀어내 "가끔 원래자리로" 되돌아오는 버그가 난다.
				// scatter 소스 제외(아래 continue)뿐 아니라 "밀리는 대상"·settle 대상에서도 빼야 하므로 excludeIds에 합친다.
				const settleExclude = new Set<string>([...playingIds, ...prevFreeIds]);
				for (const [, m] of s.magnets) {
					if (m.teamId !== null || playingIds.has(m.playerId)) continue;
					if (prevFreeIds.has(m.playerId)) continue; // 원래 필드에 있던 자석은 흩어짐 대상 아님
					// 들어온 자석을 화면 안으로만 클램프(레인 제한 없음) 후 그 자리를 소스로 흩어짐
					m.x = Math.max(r + 4, Math.min(vw - r - 4, m.x));
					m.y = Math.max(r + 4, Math.min(vh - r - 4, m.y));
					scatterFromSource(
						{ kind: "magnet", id: m.playerId, x: m.x, y: m.y },
						s.magnets,
						s.drafts,
						vw,
						vh,
						settleExclude,
						0,
					);
				}
				// 잔여 겹침 정리 — 새로 들어온 자석만 대상(기존 사용자 배치 자석은 보존), 화면 경계로만
				settleFreeMagnets(s.magnets, s.drafts, vw, vh, settleExclude, 0);
			});
			// 방금 적용한 멤버십을 기준선으로 — 이후 위치만 바뀌면 재브로드캐스트 안 함
			lastSyncedDraftsJson = JSON.stringify(serializeBoardDrafts(get()));
		} finally {
			applyingRemoteDrafts = false;
		}
	},

	scatterMagnets: (ids) => {
		set((s) => {
			const playingIds = playingIdsFromCourts(useSessionStore.getState().courts);
			const restingIds = new Set(useSessionStore.getState().restingIds);
			const vw = s.stageW || DEFAULT_VIEWPORT.vw;
			const vh = s.stageH || DEFAULT_VIEWPORT.vh;
			const r = MAGNET_SIZE / 2;

			// 흩어뜨릴 대상: 자유(teamId null)·비경기중·비휴식 자석만
			const targets: MagnetPosition[] = [];
			for (const id of ids) {
				const m = s.magnets.get(id);
				if (m && m.teamId === null && !playingIds.has(id) && !restingIds.has(id)) targets.push(m);
			}
			if (targets.length === 0) return;

			// 경기 완료된 자석은 "경기 시작 때 그룹이 있던 자리"에 그대로 남아 그룹과 겹쳐 가려진다.
			// → 그룹(팀) 영역의 최하단 아래(항상 보이는 곳)로 옮긴 뒤 흩어짐을 시작한다. 그룹이 없으면 상단부터.
			let groupBottom = 0;
			for (const t of s.drafts.values()) {
				groupBottom = Math.max(groupBottom, t.anchor.y + TEAM_BOX_BELOW);
			}
			const startY = Math.max(r + 4, Math.min(vh - r - 4, groupBottom + r + 8));

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
					0,
				);
			});
			// 잔여 겹침/팀 박스 침범 정리 (완료 자석 + 기존 자유 자석 모두 겹침 해소), 화면 경계로만
			settleFreeMagnets(s.magnets, s.drafts, vw, vh, playingIds, 0);
		});
	},

	rearrangeAll: (viewW, viewH) => {
		const sessionCourts = useSessionStore.getState().courts;
		const sessionPlayers = useSessionStore.getState().sessionPlayers;
		const playingIds = playingIdsFromCourts(sessionCourts);
		const restingIds = new Set(useSessionStore.getState().restingIds);
		set((s) => {
			arrangeBoard({
				magnets: s.magnets,
				drafts: s.drafts,
				reservations: s.reservations,
				courtAnchors: s.courtAnchors,
				courts: sessionCourts,
				sessionPlayers,
				playingIds,
				restingIds,
				viewW,
				viewH,
			});
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

	setDragInfo: (info) => {
		set((s) => {
			s.dragInfo = info;
		});
	},

	setHoverTarget: (t) => {
		// 객체는 immer가 내용 동일해도 새 참조면 리렌더하므로, 내용 비교로 무변경 시 스킵(드래그 프레임 다발 호출).
		const cur = get().hoverTarget;
		if (cur === t) return;
		if (cur && t && cur.kind === t.kind && cur.id === t.id) return;
		set((s) => {
			s.hoverTarget = t;
		});
	},

	setDetachHot: (hot) => {
		// boolean은 immer가 동일값이면 리렌더 없음.
		set((s) => {
			s.detachHot = hot;
		});
	},

	clearDrag: () => {
		set((s) => {
			s.dragInfo = null;
			s.hoverTarget = null;
			s.detachHot = false;
		});
	},

	detachMember: (playerId, drop) => {
		if (!claimEdit()) return; // 보기 전용 차단
		set((s) => {
			const mag = s.magnets.get(playerId);
			if (!mag || mag.teamId === null) return;
			detachAnchor(s, playerId); // 팀에서 제거(+남은 인원 부족 시 팀 해체)
			const p = clampToStage(s, drop);
			mag.x = p.x;
			mag.y = p.y;
			runSettle(s, { magnetId: playerId }); // 드롭존 아래로 흩어져 보이게
		});
	},

	cancelReservation: (resId) => {
		if (!claimEdit()) return; // 보기 전용 차단
		set((s) => {
			const r = s.reservations.get(resId);
			if (!r) return;
			const teamId = r.teamId;
			s.reservations.delete(resId);
			if (s.drafts.get(teamId)) runSettle(s, { teamId });
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
		const endedIds = matchPlayerIdsFromCourt(court);
		await useSessionStore.getState().handleComplete(courtId);
		// 그룹 해제로 자유 자석이 된 4명에 흩어짐 적용(방사형 + 겹침 정리)
		get().scatterMagnets(endedIds);
	},

	setMatchRoster: async (courtId, teamA, teamB) => {
		if (!claimEdit()) return; // 보기 전용 차단(자유면 자동 점유)
		const court = useSessionStore.getState().courts.find((c) => c.id === courtId);
		const oldIds = matchPlayerIdsFromCourt(court);
		const newIds = matchPlayerIds({ teamA, teamB });
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
			s.manualLayout = false;
			s.stageW = 0;
			s.stageH = 0;
			s.restZoneOpen = false;
			s.restFieldHot = false;
			s.presenceModalOpen = false;
			s.dragInfo = null;
			s.hoverTarget = null;
			s.detachHot = false;
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
