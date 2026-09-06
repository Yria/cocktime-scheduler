import type { SessionPlayer } from "../../types";
import { autoFillTeammates, pairPlayers } from "../teamSelection";
import { buildRecommendData, type RecommendPoolInputs } from "./recommendPool";

/** Display and selection share the same free, waiting member pool. */
export function getMemberPartyCandidates(inputs: RecommendPoolInputs): SessionPlayer[] {
	const data = buildRecommendData({ newTeam: true }, [], inputs, {
		excludePlaying: true,
		excludeReserved: true,
	});
	const assigned = new Set([...inputs.drafts.values()].flatMap((team) => team.anchorMemberIds));
	return data?.pool.filter((player) => player.status === "waiting" && player.memberId != null && !assigned.has(player.id)) ?? [];
}

/**
 * 회원 파티의 현재 홀드 참가자 중 가용한 4명을 기존 추천 순서로 선발한다.
 * 첫 참가자도 일반 후보이며, 경기중 선수나 홀드하지 않은 선수로 보충하지 않는다.
 * 반환 순서는 teamA 2명 + teamB 2명. 설정·운영진 상태·홀드 유효성은 서버가 검증한다.
 */
export function selectMemberParty(
	participantIds: readonly string[],
	inputs: RecommendPoolInputs,
): string[] | null {
	const holders = new Set(participantIds);
	if (holders.size < 4) return null;

	const data = buildRecommendData({ newTeam: true }, [], inputs, {
		excludePlaying: true,
		excludeReserved: true,
	});
	if (!data) return null;

	const pool = getMemberPartyCandidates(inputs).filter((player) => holders.has(player.id));
	if (pool.length < 4) return null;

	const selected = autoFillTeammates([], pool, data.ctx, 4, undefined, { maxPlaying: 0 });
	if (selected.length !== 4) return null;
	const paired = pairPlayers(
		selected as [SessionPlayer, SessionPlayer, SessionPlayer, SessionPlayer],
		[],
		"회원 파티",
	);
	return [...paired.teamA, ...paired.teamB];
}
