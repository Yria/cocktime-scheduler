import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import { devtools } from "zustand/middleware";
import { enableMapSet } from "immer";

import type { SessionPlayer } from "../types";
import type { BoardDraftsPayload, DraftTeam, ForcedPair, MagnetPosition, Reservation, StagePoint } from "../types/board";
import {
	clampAnchor,
	computeSlotOffset,
	DEFAULT_VIEWPORT,
	isInsideTeamBounds,
	slotIndexAt,
} from "../lib/board/geometry";
import { MAGNET_SIZE, TEAM_BOX_BELOW } from "../lib/board/constants";
import { arrangeBoard } from "../lib/board/arrange";
import { canonicalizeDrafts, reconcileMembership } from "../lib/board/remoteDrafts";
import { scatterFromSource, type ScatterShape } from "../lib/board/scatter";
import { settleFreeMagnets } from "../lib/board/settle";
import { resolveDropTarget, nearestFreePartner } from "../lib/board/dropResolver";
import {
	cockPendingIds,
	findReservation,
	isMemberOf,
	isTeamStartable,
	matchPlayerIds,
	matchPlayerIdsFromCourt,
	playingIdsFromCourts,
	teamMemberCount,
	teamMembers,
} from "../lib/board/membership";
import { buildRecommendData } from "../lib/board/recommendPool";
import { randomId } from "../lib/randomId";
import { useSessionStore } from "./sessionStore";
import { useAppStore } from "./appStore";
import { autoFillTeammates, pairPlayers, FORCED_WINDOW } from "../lib/teamSelection";
import { toast } from "./toastStore";
import { dbBoardSaveDrafts, sendBroadcast } from "../lib/supabase";

enableMapSet();

// ── 보드 줌(축소 전용) 0.5~1배 ─────────────────────────
// 수동 줌(±·핀치)과 자동 fit 스케일이 공유하는 단일 상태. 이펙트에서 React setState 없이 store로 set하기 위해
// scale을 store에 둔다(자동정렬 이펙트의 set-state-in-effect 회피). SessionBoard가 읽고/조절한다.
export const ZOOM_MIN = 0.5;
export const ZOOM_MAX = 1;
export const ZOOM_STEP = 0.1;
const SCALE_KEY = "cocktime-board-scale";
const clampScale = (v: number) => Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Math.round(v * 100) / 100));
function loadScale(): number {
	try {
		const v = parseFloat(localStorage.getItem(SCALE_KEY) ?? "");
		return Number.isFinite(v) ? clampScale(v) : 1;
	} catch {
		return 1;
	}
}

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

/**
 * 복귀(그룹/휴식존에서 빠짐) 자석을 "정렬되는 위치"에 둔다.
 * 클론에 arrangeBoard를 적용해 이 선수의 정렬 좌표만 읽어 본문에 반영 — 다른 자석/팀의 수동 배치는 보존
 * (수동 레이아웃이라도 복귀 자석만은 자유 자석 격자의 제자리로 들어가게).
 */
function placeArranged(
	s: {
		magnets: Map<string, MagnetPosition>;
		drafts: Map<string, DraftTeam>;
		reservations: Map<string, Reservation>;
		courtAnchors: Map<number, StagePoint>;
		stageW: number;
		stageH: number;
		scale: number;
	},
	playerId: string,
) {
	const mag = s.magnets.get(playerId);
	if (!mag || mag.teamId !== null) return; // 자유 자석만 정렬 배치
	const ss = useSessionStore.getState();
	const playingIds = playingIdsFromCourts(ss.courts);
	const restingIds = new Set(ss.restingIds);
	restingIds.delete(playerId); // 휴식 복귀 직후 restingIds 갱신 지연 대비 — 이 선수는 자유로 취급
	const scale = s.scale || 1;
	const viewW = (s.stageW || DEFAULT_VIEWPORT.vw) / scale;
	const viewH = (s.stageH || DEFAULT_VIEWPORT.vh) / scale;
	const magClone = new Map<string, MagnetPosition>();
	for (const [k, v] of s.magnets) magClone.set(k, { ...v });
	const draftClone = new Map<string, DraftTeam>();
	for (const [k, v] of s.drafts) draftClone.set(k, { ...v, anchor: { ...v.anchor }, anchorMemberIds: [...v.anchorMemberIds] });
	const resClone = new Map<string, Reservation>();
	for (const [k, v] of s.reservations) resClone.set(k, { ...v });
	const courtClone = new Map<number, StagePoint>();
	for (const [k, v] of s.courtAnchors) courtClone.set(k, { ...v });
	arrangeBoard({
		magnets: magClone,
		drafts: draftClone,
		reservations: resClone,
		courtAnchors: courtClone,
		courts: ss.courts,
		sessionPlayers: ss.sessionPlayers,
		playingIds,
		restingIds,
		viewW,
		viewH,
	});
	const pos = magClone.get(playerId);
	if (pos) {
		mag.x = pos.x;
		mag.y = pos.y;
	}
	// 정렬 슬롯이 (수동 배치된) 실제 자석과 겹칠 수 있으므로 겹침 해소 — 이 자석을 소스로 겹친 자유 자석을 밀어낸다.
	// (clone-arrange는 클론 기준 비겹침이라 실제 레이아웃에선 보장 안 됨.)
	runSettle(s, { magnetId: playerId });
}

// ── 보드 멤버십 공유(drafts/reservations) ────────────────────
// 원격 멤버십 적용 중에는 자체 브로드캐스트/저장을 막기 위한 플래그.
let applyingRemoteDrafts = false;
// 마지막으로 동기화한 멤버십 JSON — 위치만 바뀐 변경(정렬 등)은 재브로드캐스트하지 않기 위함.
let lastSyncedDraftsJson = "";

/**
 * 팀의 "의도적(고정배치로 묶은) 멤버" 중 현재 멤버(anchor + ghost)에 남아있는 것만. 2명 이상이면 의도적 그룹.
 * memberIds = 현재 유효 멤버 id 집합(anchor + 예약 ghost) — 4명+예약 잠금 시 ghost도 포함되므로 anchor만으로 거르지 않는다.
 */
function effectiveForcedIds(t: DraftTeam, memberIds: ReadonlySet<string>): string[] {
	if (!t.forcedIds?.length) return [];
	return t.forcedIds.filter((id) => memberIds.has(id));
}

/** 의도적 그룹 경기 시작 시 재편성 회피 쌍 추가(같은 쌍은 최신 fromCount로 갱신). */
function addForcedPair(s: { forcedPairs: ForcedPair[] }, a: string, b: string, fromCount: number) {
	const f = s.forcedPairs.find((p) => (p.a === a && p.b === b) || (p.a === b && p.b === a));
	if (f) f.fromCount = Math.max(f.fromCount, fromCount);
	else s.forcedPairs.push({ a, b, fromCount });
}

/** decay 끝난(경과 ≥ FORCED_WINDOW) 쌍 제거 — 무한 증식 방지. */
function pruneForcedPairs(s: { forcedPairs: ForcedPair[] }, currentCount: number) {
	s.forcedPairs = s.forcedPairs.filter((p) => currentCount - p.fromCount < FORCED_WINDOW);
}

/** drafts/reservations 멤버십(+forcedIds/forcedPairs)만 직렬화(위치 제외). */
function serializeBoardDrafts(s: {
	drafts: Map<string, DraftTeam>;
	reservations: Map<string, Reservation>;
	forcedPairs: ForcedPair[];
}): BoardDraftsPayload {
	return {
		teams: [...s.drafts.values()].map((t) => {
			const memberIds = new Set(teamMembers(t.id, s.drafts, s.reservations).map((m) => m.playerId));
			const forcedIds = effectiveForcedIds(t, memberIds);
			// 슬롯은 현재 멤버(anchor+ghost) 것만 동기화 — 취소된 예약 등 스테일 키 제거.
			let slots: Record<string, number> | undefined;
			if (t.slots && Object.keys(t.slots).length) {
				const entries = Object.entries(t.slots).filter(([pid]) => memberIds.has(pid));
				if (entries.length) slots = Object.fromEntries(entries);
			}
			return {
				id: t.id,
				memberIds: [...t.anchorMemberIds],
				createdMs: t.createdAt,
				...(forcedIds.length ? { forcedIds } : {}),
				...(slots ? { slots } : {}),
			};
		}),
		reservations: [...s.reservations.values()].filter((r) => s.drafts.has(r.teamId)).map((r) => ({
			id: r.id,
			playerId: r.playerId,
			teamId: r.teamId,
			createdMs: r.createdAt,
		})),
		...(s.forcedPairs.length ? { forcedPairs: s.forcedPairs } : {}),
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
	return randomId();
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
	/** 의도적 그룹(드래그로 묶음)이 경기 시작 시 기록하는 재편성 회피 쌍. board_drafts jsonb로 동기·영속(컬럼 추가 없음). */
	forcedPairs: ForcedPair[];
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
	/** 드래그 중 현재 겹침 대상(하이라이트). slot=팀의 특정 칸(빈칸/교체), magnet=페어 상대. */
	hoverTarget: { kind: "slot"; teamId: string; slotIndex: number } | { kind: "magnet"; id: string } | null;
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
	/** 추천 모달의 "자동편성" — 팀/시드/새팀 대상의 나머지를 대기 선수로 채워 commit. extraIds=사용자 직접 선택분. */
	autoFillTarget: (
		target: { teamId?: string; seedId?: string; newTeam?: boolean },
		extraIds?: string[],
	) => void;
	/** "고정배치" 토글 — 누르는 시점의 현재 멤버 전체를 🔒 잠금(재편성 회피 대상). 이미 잠겨있으면 해제. 시각/코스트만, 실제 락 아님(드래그로 빼서도 취소). */
	toggleForced: (teamId: string) => void;
	setTeamAnchor: (teamId: string, x: number, y: number) => void;
	setCourtAnchor: (courtId: number, x: number, y: number) => void;
	/** 실제 stage 크기 등록(흩어짐 바운더리용) */
	setStageSize: (w: number, h: number) => void;
	/** 보드 줌 배율(0.5~1). 수동 줌·자동 fit 공용. */
	scale: number;
	/** 줌 배율 설정(클램프 + localStorage 영속). 함수형 업데이트 지원. */
	setScale: (v: number | ((prev: number) => number)) => void;
	/** 드래그-엔드 후 소스(팀/코트)에서 겹친 자유 자석을 흩어지게 */
	settleBoard: (source: DragSource) => void;
	/** 공유된 보드 멤버십(payload)을 로컬에 적용(위치는 로컬에서 결정). 스냅샷/브로드캐스트 수신용. */
	applyRemoteDrafts: (payload: BoardDraftsPayload) => void;
	/**
	 * 불변식 I2 자가 치유(편집자 전용) — 경기중이 된 anchor를 모든 예비팀에서 제거하고, 그 결과 인원이
	 * 부족해진 팀은 해체한다. 코트 변화(courtSig) 시 SessionBoard가 호출한다. 변경이 생기면 subscribe가
	 * board_drafts로 영속화 → 모든 클라이언트가 수렴(유실된 dissolve / 로스터 편입 레이스 복구).
	 * assigning(경기시작 진행중) 팀은 startMatch가 직접 dissolve+위치 인계하므로 건드리지 않는다.
	 */
	healPlayingAnchors: () => void;
	/** 편집 권한 상실(편집→보기) 시 진행 중 편집 부수상태(드래그/배정중)를 일괄 취소. */
	cancelEditActions: () => void;
	/** 지정한 자석들을 소스로 방사형 흩어짐 + 정리(경기 완료로 그룹 해제된 자석용) */
	scatterMagnets: (ids: string[]) => void;
	rearrangeAll: (viewW: number, viewH: number) => void;
	/** 휴식존 표시 토글. */
	toggleRestZone: () => void;
	/** 휴식 패널 접기(멱등) — 보드 자석 드래그 시작 시 가림 해소용. */
	closeRestZone: () => void;
	/** 휴식 필드 액티베이트(hot) 상태 설정. */
	setRestFieldHot: (hot: boolean) => void;
	/** 드래그 시작/종료 시 드래그 정보 설정(null=종료). */
	setDragInfo: (info: { playerId: string; detachable: boolean; restable: boolean; from: StagePoint } | null) => void;
	/** 드래그 중 겹침 대상 하이라이트 설정(변화 시에만 반영). */
	setHoverTarget: (t: { kind: "slot"; teamId: string; slotIndex: number } | { kind: "magnet"; id: string } | null) => void;
	/** '팀에서 빼기' 드롭존 hot 설정(변화 시에만 반영). */
	setDetachHot: (hot: boolean) => void;
	/** 드래그 종료 — dragInfo/hoverTarget/detachHot 일괄 초기화. */
	clearDrag: () => void;
	/** 멤버를 팀에서 빼 자유 자석으로(드롭존). drop 위치에 두고 흩어짐. */
	detachMember: (playerId: string, drop: StagePoint) => void;
	/** 예약(ghost) 취소(드롭존). */
	cancelReservation: (resId: string) => void;
	/** 선수를 보드 그룹에서 제거(추천 모달 더블탭): ghost면 예약 취소, anchor면 팀에서 빼 자유 자석으로. */
	removeMemberFromBoard: (playerId: string) => void;
	/** 접속자/편집권한 모달 표시 토글. */
	setPresenceModalOpen: (open: boolean) => void;
	/** 선수를 휴식 처리(보드 멤버십에서 제거 + status='resting'). */
	restPlayer: (playerId: string) => void;
	/** 휴식 선수를 복귀(status='waiting', 평균 판수 보정) + 자유 자석으로 drop 위치에 배치. */
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
			const off = computeSlotOffset(mem.slot);
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
	// 그룹에서 빠진 사람은 고정배치(forced)에서도 제거 → 다시 넣으면 잠금 리셋(고정 아님)
	if (team.forcedIds?.length) {
		team.forcedIds = team.forcedIds.filter((id) => id !== playerId);
	}
	// 슬롯 매핑에서도 제거 → 그 칸이 빈 슬롯으로 (다시 넣으면 새로 배치)
	if (team.slots && playerId in team.slots) delete team.slots[playerId];
	// 남은 인원이 너무 적으면(원본 0명 또는 총 2명 미만) 팀 해체
	if (team.anchorMemberIds.length === 0 || teamMemberCount(teamId, s.drafts, s.reservations) < 2) {
		dissolveDraft(s, teamId);
	}
}

function attachAnchor(s: Draft, playerId: string, teamId: string, slot?: number) {
	const mag = s.magnets.get(playerId);
	const team = s.drafts.get(teamId);
	if (!mag || !team) return;
	// anchor로 확정되면 이 선수는 어느 팀에서도 빌려질(ghost) 수 없다(anchor xor ghost). 모든 예약(타 팀 포함) 정제.
	// — 원본(선수)이 anchor로 바뀌는데 복사본(ghost)이 다른 팀에 남는 구조적 결함 방지. ghost 승격도 이 경로로 처리.
	for (const [rid, r] of [...s.reservations]) {
		if (r.playerId === playerId) s.reservations.delete(rid);
	}
	const setSlot = () => {
		if (slot === undefined) return; // 미지정 → teamMembers fallback(빈칸 순서대로)
		team.slots = team.slots ?? {};
		team.slots[playerId] = slot;
	};
	if (team.anchorMemberIds.includes(playerId)) {
		mag.teamId = teamId;
		setSlot();
		return;
	}
	if (teamMemberCount(teamId, s.drafts, s.reservations) >= 4) return;
	if (mag.teamId && mag.teamId !== teamId) detachAnchor(s, playerId);
	team.anchorMemberIds.push(playerId);
	mag.teamId = teamId;
	setSlot();
}

/**
 * 점유된 슬롯에 다른 선수를 드롭 → 그 자리 멤버 교체(R4). 점유자는 자유 자석으로 흩어진다.
 * anchor 점유자는 in-place 스왑(인원수 불변 → 해체 트리거 없음, 슬롯 위치 보존),
 * ghost 점유자는 예약 취소 후 새 선수를 그 슬롯에 anchor로 합류.
 * 단, 끌어온 선수가 "같은 팀" 멤버면(팀 내 재배치) 점유자를 빼지 않고 둘의 슬롯만 스왑한다.
 */
// runSettle(geometry 필요)을 호출하므로 멤버십(Draft) + stage geometry(SettleState)를 함께 받는다.
// 실제 호출부는 full BoardState immer 드래프트라 두 조건을 모두 만족.
function replaceAtSlot(
	s: Draft & SettleState,
	playerId: string,
	teamId: string,
	slotIndex: number,
) {
	const team = s.drafts.get(teamId);
	if (!team) return;
	const members = teamMembers(teamId, s.drafts, s.reservations);
	const occupant = members.find((m) => m.slot === slotIndex);
	if (!occupant || occupant.playerId === playerId) return;
	// 같은 팀 내 이동 — 두 멤버 슬롯 스왑(둘 다 그대로 유지). "이 그룹에 계속 들어감" 보장.
	if (s.magnets.get(playerId)?.teamId === teamId) {
		const selfSlot = members.find((m) => m.playerId === playerId)?.slot ?? slotIndex;
		team.slots = team.slots ?? {};
		team.slots[playerId] = slotIndex;
		team.slots[occupant.playerId] = selfSlot;
		return;
	}
	if (occupant.kind === "ghost") {
		const r = findReservation(occupant.playerId, teamId, s.reservations);
		if (r) s.reservations.delete(r.id);
		if (team.slots && occupant.playerId in team.slots) delete team.slots[occupant.playerId];
		attachAnchor(s, playerId, teamId, slotIndex); // 새 선수 합류(이동 시 기존 팀 자동 제거)
		runSettle(s, { magnetId: occupant.playerId });
		return;
	}
	// anchor 점유자 — in-place 스왑
	const pmag = s.magnets.get(playerId);
	if (pmag && pmag.teamId && pmag.teamId !== teamId) detachAnchor(s, playerId); // 새 선수를 기존 팀에서 빼냄(이동)
	const idx = team.anchorMemberIds.indexOf(occupant.playerId);
	if (idx >= 0) team.anchorMemberIds[idx] = playerId;
	else team.anchorMemberIds.push(playerId);
	const omag = s.magnets.get(occupant.playerId);
	if (omag) omag.teamId = null;
	if (pmag) pmag.teamId = teamId;
	if (team.forcedIds?.length) team.forcedIds = team.forcedIds.filter((id) => id !== occupant.playerId);
	team.slots = team.slots ?? {};
	if (occupant.playerId in team.slots) delete team.slots[occupant.playerId];
	team.slots[playerId] = slotIndex;
	runSettle(s, { magnetId: occupant.playerId });
}

function addReservation(s: Draft, playerId: string, teamId: string) {
	if (!s.drafts.get(teamId)) return;
	if (isMemberOf(playerId, teamId, s.drafts, s.reservations)) return;
	if (teamMemberCount(teamId, s.drafts, s.reservations) >= 4) return;
	const id = newId();
	s.reservations.set(id, { id, playerId, teamId, createdAt: nowMs() });
}

/**
 * 경기 종료/로스터 제외로 "자유가 된" 선수의 예약(ghost)을 해소한다 — 빌려뒀던 팀의 정식 멤버(anchor)로 승격.
 * 원본(선수)이 경기중→자유로 바뀔 때 복사본(ghost)이 한 곳으로 수렴되게 하는 공통 처리. completeMatch/setMatchRoster 공용.
 * 승격 대상은 잠금(forcedIds)된 팀 우선, 없으면 가장 오래된 예약. attachAnchor가 그 선수의 모든 예약을 정제하므로
 * 다중 예약도 한 번에 정리된다. 대상 팀이 사라졌으면 고아 예약만 제거.
 */
function resolveFreedReservations(s: Draft, playerIds: readonly string[]) {
	for (const pid of playerIds) {
		const mag = s.magnets.get(pid);
		if (!mag || mag.teamId !== null) continue; // 이미 어느 팀 anchor면 스킵
		const myRes = [...s.reservations.values()].filter((r) => r.playerId === pid);
		if (myRes.length === 0) continue;
		myRes.sort((a, b) => a.createdAt - b.createdAt);
		const target = myRes.find((r) => s.drafts.get(r.teamId)?.forcedIds?.includes(pid)) ?? myRes[0];
		if (!s.drafts.get(target.teamId)) {
			for (const [rid, r] of [...s.reservations]) if (r.playerId === pid) s.reservations.delete(rid);
			continue;
		}
		attachAnchor(s, pid, target.teamId, s.drafts.get(target.teamId)?.slots?.[pid]); // 모든 예약 정제 + anchor 합류
	}
}

const creator = immer<BoardState>((set, get) => ({
	magnets: new Map<string, MagnetPosition>(),
	drafts: new Map<string, DraftTeam>(),
	reservations: new Map<string, Reservation>(),
	forcedPairs: [],
	assigningTeamIds: new Set<string>(),
	courtAnchors: new Map<number, StagePoint>(),
	manualLayout: false,
	stageW: 0,
	stageH: 0,
	scale: loadScale(),
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
		// (혼자뿐이면 자동 점유로 isEditor=true가 되고, 첫 편집 액션에서도 자유면 자동 점유한다 → 여기 분기는 '남이 편집 중인' 읽기 모드 사용자만 탄다.)
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
					attachAnchor(s, playerId, target.teamId, target.slot);
					source = { teamId: target.teamId };
					break;
				case "replace":
					replaceAtSlot(s, playerId, target.teamId, target.slot);
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
				case "createPair": {
					const a = s.magnets.get(playerId);
					const b = s.magnets.get(target.partnerId);
					// 파트너(b)는 자유 자석이어야 한다. 끌어낸 a는 자유이거나 팀구성중(이동)일 수 있다.
					if (!a || !b || b.teamId !== null) return;
					if (a.teamId !== null) detachAnchor(s, playerId); // 팀구성중 멤버 → 원본 팀에서 빠져 새 페어로 이동
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
				if (isMemberOf(playerId, d.id, s.drafts, s.reservations)) break;
				const slotIdx = slotIndexAt(drop, d.anchor);
				if (slotIdx < 0) break; // 박스 안이지만 슬롯 아님 → 복귀(no-op)
				// 빈 슬롯에만 예약(점유 칸엔 경기중 선수 끼워넣기 안 함 — 복귀). 슬롯 위치 기록.
				const occupied = teamMembers(d.id, s.drafts, s.reservations).some((m) => m.slot === slotIdx);
				if (!occupied && teamMemberCount(d.id, s.drafts, s.reservations) < 4) {
					addReservation(s, playerId, d.id);
					d.slots = d.slots ?? {};
					d.slots[playerId] = slotIdx;
					source = { teamId: d.id };
				}
				break; // 슬롯 판정 끝 → 종료(겹친 다른 팀 탐색 안 함: bounds 안이면 done)
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

	toggleForced: (teamId) => {
		if (!claimEdit()) return; // 보기 전용 차단
		set((s) => {
			const team = s.drafts.get(teamId);
			if (!team) return;
			// 현재 멤버(anchor + ghost) 전체 — 4명+예약 잠금 시 예약(ghost)도 함께 락한다("4명 다 락").
			const memberIds = teamMembers(teamId, s.drafts, s.reservations).map((m) => m.playerId);
			const effective = (team.forcedIds ?? []).filter((id) => memberIds.includes(id));
			// 이미 잠금(유효 2+)이면 해제, 아니면 "지금 그룹에 포함된 멤버" 전체를 잠금(이후 추가/제거는 효과 ∩ 또는 재토글).
			team.forcedIds = effective.length >= 2 ? [] : memberIds;
		});
	},

	autoFillTeam: (teamId) => get().autoFillTarget({ teamId }, []),

	// 추천 모달의 "자동편성" 버튼 공용 — 팀/시드/새팀 어디서나 대기 선수로 나머지를 채워 commit.
	// extraIds = 모달에서 사용자가 직접 고른 선수(고정으로 먼저 포함하고 나머지를 자동 채움).
	autoFillTarget: (target, extraIds = []) => {
		if (!claimEdit()) return; // 보기 전용 차단
		const { drafts, reservations, magnets, forcedPairs } = get();
		const ss = useSessionStore.getState();
		const data = buildRecommendData(
			target,
			extraIds,
			{
				drafts,
				reservations,
				magnets,
				sessionPlayers: ss.sessionPlayers,
				courts: ss.courts,
				pairHistory: ss.pairHistory,
				lastGameType: ss.lastGameType,
				matchAssignCount: ss.matchAssignCount,
				forcedPairs,
				cockCheckEnabled: ss.cockCheckEnabled,
			},
			{ excludePlaying: true }, // 자동편성은 대기 선수만으로 채운다(경기중 제외)
		);
		if (!data) return;
		const slotsToFill = 4 - data.confirmed.length; // confirmed = 기존 멤버 + extraIds
		const picks = slotsToFill > 0 ? autoFillTeammates(data.confirmed, data.pool, data.ctx, slotsToFill) : [];
		const ids = [...extraIds, ...picks.map((p) => p.id)];
		if (ids.length === 0) {
			toast("자동편성할 대기 선수가 없어요", { variant: "error" });
			return;
		}
		get().commitTeammates(target, ids);
		if (picks.length < slotsToFill) {
			toast(`대기 선수가 부족해 ${picks.length + extraIds.length}명만 채웠어요`);
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

	setScale: (v) => {
		const next = clampScale(typeof v === "function" ? v(get().scale) : v);
		if (next === get().scale) return;
		set((s) => {
			s.scale = next;
		});
		try {
			localStorage.setItem(SCALE_KEY, String(next));
		} catch {
			// localStorage 불가(시크릿 등) — 영속 생략
		}
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
		// 불변식 I2(경기중 anchor 제거)·I1(중복 제거) 강제를 위해 reconcile에 넘긴다.
		const playingIds = playingIdsFromCourts(useSessionStore.getState().courts);
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
				const { drafts, reservations } = reconcileMembership(payload, s.magnets, oldAnchors, vw, vh, playingIds);
				s.drafts = drafts;
				s.reservations = reservations;

				// 의도적 그룹 재편성 회피 쌍 동기 + decay 끝난 것 정리(읽기 시점에도 정리해 무한 보존 방지).
				s.forcedPairs = payload.forcedPairs ? [...payload.forcedPairs] : [];
				pruneForcedPairs(s, useSessionStore.getState().matchAssignCount);

				// 원격 변경으로 "새로 필드에 들어온" 자석(팀/예약 → 자유): 내가 드래그하지 않았어도
				// 드롭과 동일하게 흩어짐을 적용 — 각 자석을 소스로 BFS 방사형으로 주변을 밀어낸다.
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
		// 편집자: reconcile이 불변식 위반(경기중 anchor·중복)을 정제해 로컬이 수신 payload와 달라졌다면
		// 그 정제 결과를 서버로 영속화한다 — 동시편집 레이스로 유실된 dissolve가 서버 board_drafts에 남아 있어도
		// (화면은 위에서 이미 정제됨) 서버까지 수렴시켜 새로고침/재구독 시 "유령 팀" 부활을 막는다. 뷰어는 화면만 정제.
		const ss = useSessionStore.getState();
		if (ss.isEditor) {
			const healed = serializeBoardDrafts(get());
			if (canonicalizeDrafts(healed) !== canonicalizeDrafts(payload)) {
				pushDraftsToRemote(healed);
			}
		}
	},

	healPlayingAnchors: () => {
		// 편집자만 영속화(뷰어는 reconcile 파생으로 화면만 정제하므로 불필요 + CAS 충돌 방지).
		if (!useSessionStore.getState().isEditor) return;
		const playingIds = playingIdsFromCourts(useSessionStore.getState().courts);
		if (playingIds.size === 0) return;
		set((s) => {
			for (const [teamId, team] of [...s.drafts]) {
				if (s.assigningTeamIds.has(teamId)) continue; // 경기시작 진행중 팀은 startMatch가 직접 처리
				if (!team.anchorMemberIds.some((id) => playingIds.has(id))) continue; // 변경 없음 → 건드리지 않음(멱등)
				// 경기중이 된 anchor를 팀에서 제거(자석 teamId 해제). ghost(예약)는 유지.
				for (const id of team.anchorMemberIds) {
					if (!playingIds.has(id)) continue;
					const m = s.magnets.get(id);
					if (m && m.teamId === teamId) m.teamId = null;
					if (team.slots && id in team.slots) delete team.slots[id]; // 슬롯 매핑도 정리
				}
				team.anchorMemberIds = team.anchorMemberIds.filter((id) => !playingIds.has(id));
				// 제거 후 인원이 부족하면(원본 0명 또는 총 2명 미만) 팀 해체(남은 멤버는 자유 자석으로)
				if (team.anchorMemberIds.length === 0 || teamMemberCount(teamId, s.drafts, s.reservations) < 2) {
					dissolveDraft(s, teamId);
				}
			}
		});
	},

	cancelEditActions: () => {
		set((s) => {
			s.dragInfo = null;
			s.hoverTarget = null;
			s.detachHot = false;
			s.restFieldHot = false;
			s.assigningTeamIds = new Set();
		});
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

	closeRestZone: () => {
		set((s) => {
			if (s.restZoneOpen) s.restZoneOpen = false;
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
		if (cur && t && cur.kind === t.kind) {
			if (cur.kind === "magnet" && t.kind === "magnet" && cur.id === t.id) return;
			if (cur.kind === "slot" && t.kind === "slot" && cur.teamId === t.teamId && cur.slotIndex === t.slotIndex) return;
		}
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

	detachMember: (playerId) => {
		if (!claimEdit()) return; // 보기 전용 차단
		set((s) => {
			const mag = s.magnets.get(playerId);
			if (!mag || mag.teamId === null) return;
			detachAnchor(s, playerId); // 팀에서 제거(+남은 인원 부족 시 팀 해체)
			placeArranged(s, playerId); // 복귀 자석은 정렬되는 위치로(드롭 지점 무시)
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

	removeMemberFromBoard: (playerId) => {
		if (!claimEdit()) return; // 보기 전용 차단
		set((s) => {
			// ghost(예약)면 예약 취소
			for (const [rid, r] of [...s.reservations]) {
				if (r.playerId === playerId) {
					const teamId = r.teamId;
					s.reservations.delete(rid);
					if (s.drafts.get(teamId)) runSettle(s, { teamId });
					return;
				}
			}
			// anchor면 팀에서 빼 자유 자석으로 → 정렬되는 위치로 복귀
			const mag = s.magnets.get(playerId);
			if (mag && mag.teamId !== null) {
				detachAnchor(s, playerId);
				placeArranged(s, playerId);
			}
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
		// status='resting' (휴식 진입). 다른 클라이언트에 player_updated 전파.
		void useSessionStore.getState().setResting(playerId, true);
	},

	unrestPlayer: (playerId) => {
		if (!claimEdit()) return; // 보기 전용 차단(자유면 자동 점유)
		// status='waiting' 복귀(평균 판수 보정). 복귀 자석은 정렬되는 위치로 배치(드롭 지점 무시).
		void useSessionStore.getState().setResting(playerId, false);
		set((s) => {
			const m = s.magnets.get(playerId);
			if (!m) return;
			m.teamId = null;
			placeArranged(s, playerId);
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
				// 의도적 그룹(드래그로 2명+ 묶음)이 경기 시작 → 묶인 멤버들끼리 쌍을 재편성 회피로 기록.
				const team = drafts.get(teamId);
				const fourIds = new Set(members.map((m) => m.playerId));
				const forced = team ? effectiveForcedIds(team, fourIds) : [];
				const fromCount = useSessionStore.getState().matchAssignCount; // 이 경기 배정 후 값(decay 기준점)
				set((s) => {
					if (forced.length >= 2) {
						for (let i = 0; i < forced.length; i++) {
							for (let j = i + 1; j < forced.length; j++) addForcedPair(s, forced[i], forced[j], fromCount);
						}
					}
					pruneForcedPairs(s, fromCount); // decay 끝난 오래된 쌍 정리
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
		// 경기 끝나 자유가 된 선수가 다른 팀에 예약(ghost)으로 잡혀 있었으면 → 그 팀의 정식 멤버(anchor)로 승격.
		// (예: 경기중인 4번을 abc 팀에 끌어 abc4 예약·고정 → 4번 경기 끝나면 abc4가 4명 정식 팀이 되어 매칭확정 가능.)
		set((s) => resolveFreedReservations(s, endedIds));
		// 그룹 해제로 자유 자석이 된 선수에 흩어짐 적용(승격된 선수는 anchor라 scatterMagnets가 건드리지 않음)
		get().scatterMagnets(endedIds);
	},

	setMatchRoster: async (courtId, teamA, teamB) => {
		if (!claimEdit()) return; // 보기 전용 차단(자유면 자동 점유)
		const court = useSessionStore.getState().courts.find((c) => c.id === courtId);
		const oldIds = matchPlayerIdsFromCourt(court);
		const newIds = matchPlayerIds({ teamA, teamB });
		const removed = oldIds.filter((id) => !newIds.includes(id));
		await useSessionStore.getState().handleSetMatchRoster(courtId, teamA, teamB);
		// 빠진 선수가 다른 팀 예약(ghost)이었으면 그 팀 정식 멤버로 승격(completeMatch와 동일 처리), 그 외엔 흩어뜨림.
		if (removed.length > 0) {
			set((s) => resolveFreedReservations(s, removed));
			get().scatterMagnets(removed);
		}
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
	if (
		state.drafts === prev.drafts &&
		state.reservations === prev.reservations &&
		state.forcedPairs === prev.forcedPairs
	)
		return;
	const payload = serializeBoardDrafts(state);
	const json = JSON.stringify(payload);
	if (json === lastSyncedDraftsJson) return; // 멤버십 동일(위치만 변경) → 생략
	lastSyncedDraftsJson = json;
	pushDraftsToRemote(payload);
});
