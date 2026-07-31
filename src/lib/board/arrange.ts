/**
 * arrange.ts
 *
 * 보드 전체 자동 정렬(rearrangeAll) 순수 로직.
 * 그룹(경기중 코트 → 4명 팀 → 나머지 팀)을 격자로 배치하고, 자유 자석을 그 아래에 배치한 뒤 겹침 정리.
 * 전달된 Map(immer draft)들을 in-place로 변경한다.
 */
import type { Court, SessionPlayer } from "../../types";
import type {
	DraftTeam,
	MagnetPosition,
	Reservation,
	StagePoint,
} from "../../types/board";
import { MAGNET_SIZE, TEAM_BOX_ABOVE, TEAM_BOX_BELOW, TEAM_W } from "./constants";
import { teamMemberCount } from "./membership";
import { settleFreeMagnets } from "./settle";

// 레이아웃 상수 — arrangeBoard 배치와 requiredBoardHeight(fit 계산)가 공유한다. 반드시 동기 유지.
const PAD_X = 12; // 좌우 패딩
const GAP_X = 16; // 그룹 가로 간격
const GAP_Y = 16; // 그룹 세로 간격
const GROUP_TOP = 10; // 그룹 격자 상단 시작 y
const MAG_GAP = 10; // 자유 자석 간격
const FREE_TOP_PAD = 8; // 그룹 영역 아래 자유 자석 시작 여백
const GROUP_ROW_H = TEAM_BOX_ABOVE + TEAM_BOX_BELOW + GAP_Y;

export interface ArrangeInput {
	magnets: Map<string, MagnetPosition>;
	drafts: Map<string, DraftTeam>;
	reservations: Map<string, Reservation>;
	courtAnchors: Map<number, StagePoint>;
	courts: Court[];
	sessionPlayers: Map<string, SessionPlayer>;
	playingIds: Set<string>;
	restingIds: Set<string>;
	cockPendingIds: Set<string>; // 콕 미제출(cock_checked=false) 선수 — 자유 자석 정렬에서 맨 뒤로
	viewW: number;
	viewH: number;
}

export function arrangeBoard(input: ArrangeInput): void {
	const {
		magnets,
		drafts,
		reservations,
		courtAnchors,
		courts,
		sessionPlayers,
		playingIds,
		restingIds,
		cockPendingIds,
		viewW,
		viewH,
	} = input;

	const halfW = TEAM_W / 2;

	const cols = Math.max(1, Math.floor((viewW - PAD_X * 2 + GAP_X) / (TEAM_W + GAP_X)));
	const rowH = GROUP_ROW_H;
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
	const occupied = courts.filter((c) => c.match);
	const teams = [...drafts.values()].sort((a, b) => {
		const ca = teamMemberCount(a.id, drafts, reservations);
		const cb = teamMemberCount(b.id, drafts, reservations);
		const fa = ca === 4 ? 1 : 0;
		const fb = cb === 4 ? 1 : 0;
		if (fa !== fb) return fb - fa; // 4명 찬 그룹 먼저
		if (cb !== ca) return cb - ca; // 그 외: 멤버 많은 순
		return a.createdAt - b.createdAt;
	});
	let gi = 0;
	for (const c of occupied) courtAnchors.set(c.id, gridAnchor(gi++, GROUP_TOP));
	for (const t of teams) t.anchor = gridAnchor(gi++, GROUP_TOP);
	const groupCount = occupied.length + teams.length;
	const groupRows = groupCount > 0 ? Math.ceil(groupCount / cols) : 0;
	// 그룹이 없으면 상단 공백 없이 맨 위부터(코트 전용 영역 개념 없음)
	const groupAreaBottom = groupRows > 0 ? GROUP_TOP + groupRows * rowH : GROUP_TOP;

	// 2) 나머지 자유 자석을 그룹 영역 아래에 격자 배치 — 매칭 대기가 앞, 콕 미제출자 뒤, 휴식자 맨 뒤.
	//    그 안에서 경기수 적은 사람 먼저.
	//    휴식 선수도 "휴식" 딱지를 달고 보드에 남는다(2026-07: 구 휴식 패널 폐지) — 보드에서 사라지면 운영진이
	//    "버그로 없어졌다"고 오인해 게스트를 중복 추가하는 사고가 있었다. 정렬 순서만 맨 뒤로 밀어 구분한다.
	const freeMagnets = [...magnets.values()]
		.filter((m) => m.teamId === null && !playingIds.has(m.playerId))
		.sort((a, b) => {
			const ra = restingIds.has(a.playerId) ? 1 : 0;
			const rb = restingIds.has(b.playerId) ? 1 : 0;
			if (ra !== rb) return ra - rb; // 휴식자(1) 맨 뒤로
			const pa = cockPendingIds.has(a.playerId) ? 1 : 0;
			const pb = cockPendingIds.has(b.playerId) ? 1 : 0;
			if (pa !== pb) return pa - pb; // 콕 미제출자(1) 뒤로
			const ga = sessionPlayers.get(a.playerId)?.gameCount ?? 0;
			const gb = sessionPlayers.get(b.playerId)?.gameCount ?? 0;
			return ga - gb;
		});
	const magCols = Math.max(1, Math.floor(viewW / (MAGNET_SIZE + MAG_GAP)));
	// 그룹이 많아 밴드가 화면을 넘겨도 자유 자석 줄은 화면 안에서 시작해야 한다 — 안 그러면 대기 선수가
	// 전원 Stage 밖으로 배치돼 통째로 안 보인다(자동 fit 이 축소로 구제하지만 manualLayout=true 인 편집자는
	// 그 경로를 안 탄다). 좁으면 그룹과 겹치더라도 "보이는 쪽"을 택한다.
	const freeTop = Math.min(groupAreaBottom, Math.max(0, viewH - MAGNET_SIZE - 8));
	const freeStartY = freeTop + MAGNET_SIZE / 2 + FREE_TOP_PAD;
	freeMagnets.forEach((m, i) => {
		const col = i % magCols;
		const row = Math.floor(i / magCols);
		m.x = MAGNET_SIZE / 2 + FREE_TOP_PAD + col * (MAGNET_SIZE + MAG_GAP);
		m.y = freeStartY + row * (MAGNET_SIZE + MAG_GAP);
	});

	// 3) 남은 겹침 정리 + 화면 바운더리 클램프 (그룹 영역 아래로)
	settleFreeMagnets(magnets, drafts, viewW, viewH, playingIds, freeTop);
}

// 자동 스케일(렌더 없이 계산) — fit 판정의 하단 여백(settle 클램프 maxY ≈ viewH−MAG_R−4와 정합).
const FIT_BOTTOM_MARGIN = 6;

/**
 * 렌더 없이(순수) 현재 구성이 차지하는 보드 세로 높이(px)를 계산한다 — arrangeBoard의 배치 공식과 동일.
 * 그룹 격자 + 그 아래 자유 자석 격자의 최하단(자연 배치, settle 클램프 전 기준).
 * @param groupCount 경기중 코트 + 팀(draft) 수 (arrangeBoard의 그룹 격자 항목 수와 동일)
 * @param freeCount  자유 자석 수 (teamId=null·비경기중 — 휴식자 포함, arrangeBoard freeMagnets와 동일 기준)
 * @param viewW      보이는 논리 가로(=stageW/scale) — 줄바꿈 열 수를 결정
 */
export function requiredBoardHeight(groupCount: number, freeCount: number, viewW: number): number {
	const cols = Math.max(1, Math.floor((viewW - PAD_X * 2 + GAP_X) / (TEAM_W + GAP_X)));
	const groupRows = groupCount > 0 ? Math.ceil(groupCount / cols) : 0;
	// 마지막 그룹 줄의 박스 하단 = 상단 시작 + 위여백 + (줄−1)·행높이 + 아래여백
	const groupExtent =
		groupRows > 0 ? GROUP_TOP + TEAM_BOX_ABOVE + (groupRows - 1) * GROUP_ROW_H + TEAM_BOX_BELOW : 0;
	if (freeCount <= 0) return groupExtent;
	const groupAreaBottom = groupRows > 0 ? GROUP_TOP + groupRows * GROUP_ROW_H : GROUP_TOP;
	const magCols = Math.max(1, Math.floor(viewW / (MAGNET_SIZE + MAG_GAP)));
	const freeRows = Math.ceil(freeCount / magCols);
	const freeStartY = groupAreaBottom + MAGNET_SIZE / 2 + FREE_TOP_PAD;
	const freeBottom = freeStartY + (freeRows - 1) * (MAGNET_SIZE + MAG_GAP) + MAGNET_SIZE / 2;
	return Math.max(groupExtent, freeBottom);
}

/**
 * 렌더 없이 "모든 자석이 다 들어가는 가장 큰 배율"을 계산한다(min~max, 보통 0.5~1.0).
 * scale↓ → 보이는 영역(view=stage/scale)↑ → 더 잘 들어간다. 큰 배율부터 step씩 내려가며
 * requiredBoardHeight ≤ viewH(하단 여백 보정)인 첫(=가장 큰) 배율을 반환. 끝까지 안 들어가면 min.
 */
export function computeFitScale(
	stageW: number,
	stageH: number,
	groupCount: number,
	freeCount: number,
	opts: { min: number; max: number; step?: number },
): number {
	const step = opts.step ?? 0.05;
	for (let s = opts.max; s >= opts.min - 1e-9; s -= step) {
		const scale = Math.round(s * 100) / 100;
		const viewW = stageW / scale;
		const viewH = stageH / scale;
		if (requiredBoardHeight(groupCount, freeCount, viewW) <= viewH - FIT_BOTTOM_MARGIN) return scale;
	}
	return opts.min;
}
