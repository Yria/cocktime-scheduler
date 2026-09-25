import { useMemo } from "react";
import type { SessionPlayer } from "../types";
import { useSessionStore } from "../store/sessionStore";
import { useBoardStore } from "../store/boardStore";
import { buildRecommendData } from "../lib/board/recommendPool";
import { recommendTeammates } from "../lib/teamSelection";
import { editingRosterIds } from "../lib/board/matchRosterEdit";
import type { RankedCandidate } from "../lib/teamSelection";

export type { RankedCandidate };

/** 추천 대상: 기존 팀(teamId) · 단일 시드 선수(seedId) · 빈 새 팀(newTeam). 하나만 지정. */
export interface RecommendTarget {
	teamId?: string | null;
	seedId?: string | null;
	/** 아무도 확정 안 된 빈 상태에서 시작해 선택으로 새 팀을 만든다(좌상단 + 버튼). */
	newTeam?: boolean;
}

export interface TeammateRecommendations {
	ranked: RankedCandidate[];
	/** 현재 확정 멤버(팀 멤버 또는 시드 1명) — 다이얼로그 표시·실력 기준용 */
	members: SessionPlayer[];
	/** 코트에서 경기중인 후보 id(courts 기반 — status보다 신뢰). "경기중" 배지 표시 기준. */
	playingIds: ReadonlySet<string>;
}

/**
 * useTeammateRecommendations
 *
 * 보드 추천 팀원 순위를 계산하는 훅. 두 진입점을 지원한다.
 *  - teamId: "팀 구성 중" 그룹의 빈 슬롯(+) — 팀 멤버에 어울리는 후보
 *  - seedId: 자유 자석 탭 — 그 선수를 시드로 팀을 만들 때 어울리는 후보
 *
 * pool = 보드의 가용 선수 − 확정 멤버 − 휴식(resting) 선수 − 다른 보드 팀에 묶인 선수
 *        (보드는 상태 무관 전원을 자석으로 노출하되, 휴식 선수는 추천 후보에서 제외.
 *         경기중 후보는 대기자만으로 허용 팀을 완성할 수 없을 때만 추천)
 * 네 명을 완성할 수 있는 조합으로 추천하며 자동편성과 같은 우선순위를 사용한다.
 */
export function useTeammateRecommendations(
	target: RecommendTarget | null,
	selectedIds: string[] = [],
): TeammateRecommendations {
	const drafts = useBoardStore((s) => s.drafts);
	const reservations = useBoardStore((s) => s.reservations);
	const magnets = useBoardStore((s) => s.magnets);
	const matchEdits = useBoardStore((s) => s.matchEdits);

	const sessionPlayers = useSessionStore((s) => s.sessionPlayers);
	const courts = useSessionStore((s) => s.courts);
	const groupHistory = useSessionStore((s) => s.groupHistory);
	const lastGameType = useSessionStore((s) => s.lastGameType);
	const cockCheckEnabled = useSessionStore((s) => s.cockCheckEnabled);

	const teamId = target?.teamId ?? null;
	const seedId = target?.seedId ?? null;
	const newTeam = target?.newTeam ?? false;

	return useMemo((): TeammateRecommendations => {
		const empty: TeammateRecommendations = { ranked: [], members: [], playingIds: new Set() };

		const data = buildRecommendData(
			{ teamId, seedId, newTeam },
			selectedIds,
			{ drafts, reservations, magnets, sessionPlayers, courts, groupHistory, lastGameType, cockCheckEnabled },
			{ excludeReserved: true },
		);
		if (!data) return empty;
		const { confirmed, members, ctx, playingIds } = data;
		// 다른 코트의 선수 변경 명단에 있는 선수는 보드에서 숨겨져 있어 후보에서도 뺀다(자동 채움과 같은 기준).
		const editing = editingRosterIds(matchEdits);
		const pool = data.pool.filter(p => !editing.has(p.id));

		const ranked = recommendTeammates(confirmed, pool, ctx);

		return { ranked, members, playingIds };
	}, [teamId, seedId, newTeam, selectedIds, drafts, reservations, magnets, matchEdits, sessionPlayers, courts, groupHistory, lastGameType, cockCheckEnabled]);
}
