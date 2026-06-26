/**
 * recommendPool.ts
 *
 * 보드 추천(다이얼로그/자동편성)의 입력 데이터를 만드는 순수 헬퍼.
 * - confirmed(확정 멤버 + 진행 중 다중선택), members(표시용), pool(후보), ctx(점수 컨텍스트)를 derive.
 * - React/스토어 의존 없음 — 훅(useTeammateRecommendations)과 store 액션(autoFillTeam)이 공유한다.
 *
 * pool = 보드 가용 선수 − 확정 멤버 − 휴식(resting) − 다른 보드 팀에 묶인 선수
 *        (옵션 excludePlaying=true면 경기중 선수도 제외 — 자동편성은 대기 선수만으로 채운다.)
 */
import type { Court, GameType, PairHistory, SessionPlayer } from "../../types";
import type { DraftTeam, ForcedPair, MagnetPosition, Reservation } from "../../types/board";
import { playingIdsFromCourts, teamMembers } from "./membership";
import type { RecommendContext } from "../teamSelection";

export interface RecommendPoolInputs {
	drafts: ReadonlyMap<string, DraftTeam>;
	reservations: ReadonlyMap<string, Reservation>;
	magnets: ReadonlyMap<string, MagnetPosition>;
	sessionPlayers: ReadonlyMap<string, SessionPlayer>;
	courts: Court[];
	pairHistory: PairHistory;
	lastGameType: Record<string, GameType>;
	matchAssignCount: number;
	/** 의도적 그룹 재편성 회피 쌍(decay 적용). */
	forcedPairs: ForcedPair[];
	/** 콕 체크 on이면 cockChecked=false 선수는 매칭 대기 아님 → 풀에서 제외. */
	cockCheckEnabled: boolean;
}

export interface RecommendData {
	/** 점수 재계산용 확정 멤버(팀/시드 멤버 + 진행 중 다중선택). */
	confirmed: SessionPlayer[];
	/** 표시용 확정 멤버(팀 멤버 또는 시드 1명) — 다중선택분은 제외. */
	members: SessionPlayer[];
	/** 후보 풀(필터 완료). */
	pool: SessionPlayer[];
	ctx: RecommendContext;
	/** 코트 기반 경기중 id(status보다 신뢰). */
	playingIds: ReadonlySet<string>;
}

/** 추천 대상: 기존 팀(teamId) · 단일 시드 선수(seedId) · 빈 새 팀(newTeam). 하나만 지정. */
export interface RecommendPoolTarget {
	teamId?: string | null;
	seedId?: string | null;
	/** 확정 멤버 0명에서 시작하는 새 팀 모드(좌상단 + 버튼). */
	newTeam?: boolean;
}

/**
 * 추천 입력(confirmed/members/pool/ctx)을 만든다. 대상이 유효하지 않으면 null.
 *
 * @param extraConfirmedIds 진행 중 다중선택분(다이얼로그). 확정 멤버처럼 점수 재계산 + 풀에서 제외.
 * @param options.excludePlaying true면 경기중 선수를 풀에서 제외(자동편성용).
 */
export function buildRecommendData(
	target: RecommendPoolTarget,
	extraConfirmedIds: string[],
	inputs: RecommendPoolInputs,
	options: { excludePlaying?: boolean } = {},
): RecommendData | null {
	const { drafts, reservations, magnets, sessionPlayers, courts, pairHistory, lastGameType, matchAssignCount, forcedPairs, cockCheckEnabled } = inputs;
	const teamId = target.teamId ?? null;
	const seedId = target.seedId ?? null;

	// 확정 멤버(팀 멤버 또는 시드) + 풀에서 제외할 ID 집합 결정
	let members: SessionPlayer[];
	const memberIds = new Set<string>();
	if (teamId) {
		if (!drafts.get(teamId)) return null;
		const tm = teamMembers(teamId, drafts, reservations);
		tm.forEach((m) => memberIds.add(m.playerId));
		members = tm
			.map((m) => sessionPlayers.get(m.playerId))
			.filter((p): p is SessionPlayer => p !== undefined);
	} else if (seedId) {
		const seed = sessionPlayers.get(seedId);
		if (!seed) return null;
		memberIds.add(seedId);
		members = [seed];
	} else if (target.newTeam) {
		// 새 팀: 확정 멤버 0명에서 시작(선택분은 extraConfirmedIds로 합쳐짐)
		members = [];
	} else {
		return null;
	}

	// 진행 중 다중선택분도 확정 멤버처럼 취급(점수 재계산 + 풀에서 제외)
	const extraPlayers = extraConfirmedIds
		.map((id) => sessionPlayers.get(id))
		.filter((p): p is SessionPlayer => p !== undefined);
	extraConfirmedIds.forEach((id) => memberIds.add(id));
	const confirmed = [...members, ...extraPlayers];

	const playingIds = playingIdsFromCourts(courts);

	const pool: SessionPlayer[] = [];
	for (const p of sessionPlayers.values()) {
		if (memberIds.has(p.id)) continue;
		// 휴식(resting) 선택한 선수는 어떤 추천에서도 제외한다.
		if (p.status === "resting") continue;
		// 콕 미확인(매칭 대기 아님) 선수 제외.
		if (cockCheckEnabled && !p.cockChecked) continue;
		// 자동편성: 경기중 선수 제외(대기 선수만으로 채운다)
		if (options.excludePlaying && playingIds.has(p.id)) continue;
		// 보드에 자석이 없는 선수는 제외 — 멤버십 commit은 자석을 전제로 한다
		// (attachAnchor가 자석 없으면 no-op이라, 풀에 두면 picks 수와 실제 멤버 수가 어긋난다).
		const mag = magnets.get(p.id);
		if (!mag) continue;
		// 다른 보드 팀에 anchor로 묶인 선수는 제외(경기중 선수는 magnet.teamId=null이라 포함됨)
		if (mag.teamId && mag.teamId !== teamId) continue;
		pool.push(p);
	}

	const ctx: RecommendContext = {
		pairHistory,
		lastGameType,
		playingIds,
		forcedPairs,
		matchAssignCount,
	};

	return { confirmed, members, pool, ctx, playingIds };
}
