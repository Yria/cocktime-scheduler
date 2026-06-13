import { useMemo } from "react";
import type { SessionPlayer } from "../types";
import { useSessionStore } from "../store/sessionStore";
import { useBoardStore } from "../store/boardStore";
import { teamMembers, playingIdsFromCourts } from "../lib/board/membership";
import { recommendTeammates, RECOMMEND_WEIGHTS } from "../lib/teamSelection";
import type { RankedCandidate } from "../lib/teamSelection";

export type { RankedCandidate };

/** 추천 대상: 기존 팀(teamId) 또는 단일 시드 선수(seedId). 둘 중 하나만 지정. */
export interface RecommendTarget {
	teamId?: string | null;
	seedId?: string | null;
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
 * pool = 보드의 가용 선수 − 확정 멤버 − 다른 보드 팀에 묶인 선수
 *        (보드는 상태 무관 전원을 자석으로 노출. 경기중 선수만 recommendTeammates에서 페널티로 하위 처리)
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
	const pairHistory = useSessionStore((s) => s.pairHistory);
	const lastGameType = useSessionStore((s) => s.lastGameType);
	const matchAssignCount = useSessionStore((s) => s.matchAssignCount);

	const teamId = target?.teamId ?? null;
	const seedId = target?.seedId ?? null;

	return useMemo((): TeammateRecommendations => {
		const empty: TeammateRecommendations = { ranked: [], members: [], playingIds: new Set() };

		// 확정 멤버(팀 멤버 또는 시드) + 풀에서 제외할 ID 집합 결정
		let members: SessionPlayer[];
		const memberIds = new Set<string>();
		if (teamId) {
			if (!drafts.get(teamId)) return empty;
			const tm = teamMembers(teamId, drafts, reservations);
			tm.forEach((m) => memberIds.add(m.playerId));
			members = tm
				.map((m) => sessionPlayers.get(m.playerId))
				.filter((p): p is SessionPlayer => p !== undefined);
		} else if (seedId) {
			const seed = sessionPlayers.get(seedId);
			if (!seed) return empty;
			memberIds.add(seedId);
			members = [seed];
		} else {
			return empty;
		}

		// 진행 중 다중선택분도 확정 멤버처럼 취급(점수 재계산 + 풀에서 제외)
		const selectedPlayers = selectedIds
			.map((id) => sessionPlayers.get(id))
			.filter((p): p is SessionPlayer => p !== undefined);
		selectedIds.forEach((id) => memberIds.add(id));
		const confirmed = [...members, ...selectedPlayers];

		const playingIds = playingIdsFromCourts(courts);

		const pool: SessionPlayer[] = [];
		for (const p of sessionPlayers.values()) {
			if (memberIds.has(p.id)) continue;
			// 다른 보드 팀에 anchor로 묶인 선수는 제외(경기중 선수는 magnet.teamId=null이라 포함됨)
			const mag = magnets.get(p.id);
			if (mag && mag.teamId && mag.teamId !== teamId) continue;
			pool.push(p);
		}

		const allSessionPlayers = [...sessionPlayers.values()];

		const ctx = {
			pairHistory,
			totalMatchCount: matchAssignCount,
			allSessionPlayers,
			lastGameType,
			playingIds,
		};

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
	}, [teamId, seedId, selectedIds, drafts, reservations, magnets, sessionPlayers, courts, pairHistory, lastGameType, matchAssignCount]);
}
