import { useMemo } from "react";
import type { SessionPlayer } from "../types";
import { useSessionStore } from "../store/sessionStore";
import { useBoardStore } from "../store/boardStore";
import { buildRecommendData } from "../lib/board/recommendPool";
import { recommendTeammates, RECOMMEND_WEIGHTS } from "../lib/teamSelection";
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
 *         경기중 선수만 recommendTeammates에서 페널티로 하위 처리)
 * 점수 기준: 실력 유사 > 미동반 > 게임타입 로테이션 + 성별 균형 + 대기 우선
 */
export function useTeammateRecommendations(
	target: RecommendTarget | null,
	selectedIds: string[] = [],
): TeammateRecommendations {
	const drafts = useBoardStore((s) => s.drafts);
	const reservations = useBoardStore((s) => s.reservations);
	const magnets = useBoardStore((s) => s.magnets);

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
		);
		if (!data) return empty;
		const { confirmed, members, pool, ctx, playingIds } = data;

		// 기본: 경기중 페널티(W_PLAYING) 적용 → 경기중이 뒤로 정렬되는 순위
		const baseRanked = recommendTeammates(confirmed, pool, ctx);

		// 적합도 %(전체 상대값: 최고=100%, 최악=0%) 기준으로 "정렬에서" 경기중 페널티 적용 여부만 결정한다.
		// 비경기중 후보 중 10% 이상이 하나도 없으면(좋은 후보가 경기중에 몰림) 페널티 해제 →
		// 경기중 후보라도 순수 추천순으로 상위 노출한다. (경기중 배지 표시는 이 값과 무관 — playingIds로 항상 표시)
		// (비경기중 후보가 0명이어도 some=false → 해제)
		const scores = baseRanked.map((r) => r.score);
		const min = Math.min(...scores);
		const max = Math.max(...scores);
		const pctOf = (s: number) => (max === min ? 100 : ((max - s) / (max - min)) * 100);
		// "경기중"은 courts 기반 playingIds로 판별(status는 경기 시작 직후 갱신이 지연됨)
		const deprioritizePlaying = baseRanked.some(
			(r) => !playingIds.has(r.player.id) && pctOf(r.score) >= 10,
		);

		// 해제 시 경기중 페널티 없이 순수 추천순으로 재정렬
		const ranked = deprioritizePlaying
			? baseRanked
			: recommendTeammates(confirmed, pool, ctx, { ...RECOMMEND_WEIGHTS, W_PLAYING: 0 });

		return { ranked, members, playingIds };
	}, [teamId, seedId, newTeam, selectedIds, drafts, reservations, magnets, sessionPlayers, courts, groupHistory, lastGameType, cockCheckEnabled]);
}
