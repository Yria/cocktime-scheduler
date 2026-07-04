import type { DraftTeam, MagnetPosition, Reservation, StagePoint } from "../../types/board";
import { clampAnchor, DEFAULT_VIEWPORT } from "../../lib/board/geometry";
import { MAGNET_SIZE } from "../../lib/board/constants";
import { arrangeBoard } from "../../lib/board/arrange";
import { scatterFromSource, type ScatterShape } from "../../lib/board/scatter";
import { findReservation, playingIdsFromCourts, teamMembers } from "../../lib/board/membership";
import { attachAnchor, detachAnchor, type Draft } from "../../lib/board/draftMutations";
import { useSessionStore } from "../sessionStore";
import type { DragSource, SettleState } from "./types";

// ── grid layout for initial pool ─────────────────────────

const POOL_COLS = 4;
const POOL_START_X = MAGNET_SIZE;
// 풀 그리드 시작 — 상단부터(코트 전용 영역 개념 없음). 첫 진입 시 rearrangeAll이 다시 정렬한다.
const POOL_START_Y = MAGNET_SIZE;
const POOL_GAP_X = MAGNET_SIZE + 10;
const POOL_GAP_Y = MAGNET_SIZE + 10;

export function gridPos(i: number): StagePoint {
	return {
		x: POOL_START_X + (i % POOL_COLS) * POOL_GAP_X,
		y: POOL_START_Y + Math.floor(i / POOL_COLS) * POOL_GAP_Y,
	};
}

/** 현재 stage 크기 기준으로 anchor를 화면 안에 클램프. stage 미설정 시 기본 뷰포트. */
export function clampToStage(s: { stageW: number; stageH: number }, p: StagePoint): StagePoint {
	return clampAnchor(p, s.stageW || DEFAULT_VIEWPORT.vw, s.stageH || DEFAULT_VIEWPORT.vh);
}

/**
 * 드롭 지점 기준 BFS 방사형 흩어짐. 소스(놓은 자석/그룹)에서 겹친 자유 자석을 밀어낸다.
 * 자석 소스는 화면 경계로 클램프(드롭한 자석도 화면 밖으로 안 나가게).
 */
export function runSettle(s: SettleState, src: DragSource) {
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
export function placeArranged(
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

/**
 * 점유된 슬롯에 다른 선수를 드롭 → 그 자리 멤버 교체(R4). 점유자는 자유 자석으로 흩어진다.
 * anchor 점유자는 in-place 스왑(인원수 불변 → 해체 트리거 없음, 슬롯 위치 보존),
 * ghost 점유자는 예약 취소 후 새 선수를 그 슬롯에 anchor로 합류.
 * 단, 끌어온 선수가 "같은 팀" 멤버면(팀 내 재배치) 점유자를 빼지 않고 둘의 슬롯만 스왑한다.
 */
// runSettle(geometry 필요)을 호출하므로 멤버십(Draft) + stage geometry(SettleState)를 함께 받는다.
// 실제 호출부는 full BoardState immer 드래프트라 두 조건을 모두 만족.
export function replaceAtSlot(
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
