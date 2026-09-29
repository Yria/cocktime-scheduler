import { buildRecommendData, type RecommendPoolInputs, type RecommendPoolTarget } from "./recommendPool";
import { isTeamStartable, playingIdsFromCourts, teamMembers } from "./membership";
import { canCompleteComposition } from "../teamSelection/groupPolicy";
import { canCompleteFrom } from "../teamSelection/fillWaitingTeams";
import { autoFillTeammates } from "../teamSelection/recommendTeammates";

/** Keep immediate court replacements ready; prepare later teams with open places.
 * Also wait instead of reserving named playing people when the free players cannot complete an allowed four.
 */
export function prefersWaitingDraft(target: RecommendPoolTarget, inputs: RecommendPoolInputs, extraIds: string[] = [], unavailable: ReadonlySet<string> = new Set()): boolean {
	const playing = playingIdsFromCourts(inputs.courts);
	if (target.teamId) {
		const team = inputs.drafts.get(target.teamId);
		if (!team || team.courtId != null) return false;
		if (team.waitForCompletion) return true;
		// 이미 있는 일반 예비팀은 지금 네 명을 채우되, 대기자만으로 못 채울 때만 경기 중 선수 예약 대신 합류 대기로 돌린다.
		// 이미 특정 선수를 예약한 팀·경기 중 선수를 직접 고른 경우는 그 예약 방식을 이어 간다.
		if (!playing.size || extraIds.some(id => playing.has(id))
			|| [...inputs.reservations.values()].some(r => r.teamId === team.id)) return false;
		if (!needsReservation(target, inputs, extraIds, unavailable)) return false;
		// 예약으로도 못 채우는 팀을 대기로 돌리면 경기가 끝나도 영영 안 찬다 — 예약 경로가 채울 수 있을 때만 대기로 바꾼다.
		const all = buildRecommendData(target, extraIds, inputs, { excludeReserved: true });
		return !!all && completable(all.confirmed, all.pool.filter(p => !unavailable.has(p.id)), all.ctx);
	}
	if (!playing.size) return false;
	const ready = [...inputs.drafts.values()].filter(team =>
		isTeamStartable(team.id, inputs.drafts, inputs.reservations, inputs.magnets, playing)
		&& teamMembers(team.id, inputs.drafts, inputs.reservations).every(member => {
			const p = inputs.sessionPlayers.get(member.playerId);
			return p && p.status !== "resting" && (!inputs.cockCheckEnabled || p.cockChecked);
		}));
	if (ready.length >= Math.max(1, inputs.courts.filter(court => !court.match).length)) return true;
	return needsReservation(target, inputs, extraIds, unavailable);
}

/** Waiting players alone cannot complete this team, but two or more can hold it open until a match ends. */
function needsReservation(target: RecommendPoolTarget, inputs: RecommendPoolInputs, extraIds: string[], unavailable: ReadonlySet<string>): boolean {
	const built = buildRecommendData(target, extraIds, inputs, { excludePlaying: true, excludeReserved: true });
	const data = built && { ...built, pool: built.pool.filter(p => !unavailable.has(p.id)) };
	if (!data || data.confirmed.length >= 4 || !canCompleteComposition(data.confirmed)) return false;
	if (data.confirmed.some(p => p.status === "resting" || (inputs.cockCheckEnabled && !p.cockChecked))) return false;
	// Mirror the waiting fill: it tops up to two, and the team needs one member who is not playing.
	const added = Math.min(Math.max(0, 2 - data.confirmed.length), data.pool.length);
	const hasWaiting = added > 0 || data.confirmed.some(p => !data.playingIds.has(p.id));
	return data.confirmed.length + added >= 2 && hasWaiting && !completable(data.confirmed, data.pool, data.ctx);
}

type RecommendData = NonNullable<ReturnType<typeof buildRecommendData>>;

function completable(confirmed: RecommendData["confirmed"], pool: RecommendData["pool"], ctx: RecommendData["ctx"]): boolean {
	const slots = 4 - confirmed.length;
	// Avoided pairs make a composition-feasible pool infeasible; ask the same search the fill uses.
	return canCompleteFrom(confirmed, pool) && (!ctx.avoid || autoFillTeammates(confirmed, pool, ctx, slots).length === slots);
}
