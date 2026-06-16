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

export interface ArrangeInput {
	magnets: Map<string, MagnetPosition>;
	drafts: Map<string, DraftTeam>;
	reservations: Map<string, Reservation>;
	courtAnchors: Map<number, StagePoint>;
	courts: Court[];
	sessionPlayers: Map<string, SessionPlayer>;
	playingIds: Set<string>;
	restingIds: Set<string>;
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
		viewW,
		viewH,
	} = input;

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
	const GROUP_TOP = 10;
	let gi = 0;
	for (const c of occupied) courtAnchors.set(c.id, gridAnchor(gi++, GROUP_TOP));
	for (const t of teams) t.anchor = gridAnchor(gi++, GROUP_TOP);
	const groupCount = occupied.length + teams.length;
	const groupRows = groupCount > 0 ? Math.ceil(groupCount / cols) : 0;
	// 그룹이 없으면 상단 공백 없이 맨 위부터(코트 전용 영역 개념 없음)
	const groupAreaBottom = groupRows > 0 ? GROUP_TOP + groupRows * rowH : GROUP_TOP;

	// 2) 나머지 자유 자석을 그룹 영역 아래에 격자 배치 — 경기수 적은 사람 먼저
	//    (휴식 선수는 휴식존으로 분리되므로 메인 보드 배치에서 제외)
	const freeMagnets = [...magnets.values()]
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
	settleFreeMagnets(magnets, drafts, viewW, viewH, playingIds, groupAreaBottom);
}
