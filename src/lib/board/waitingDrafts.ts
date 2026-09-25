import { buildRecommendData, type RecommendPoolInputs, type RecommendPoolTarget } from "./recommendPool";
import { isTeamStartable, playingIdsFromCourts, teamMembers } from "./membership";
import { canCompleteComposition } from "../teamSelection/groupPolicy";
import { canCompleteFrom } from "../teamSelection/fillWaitingTeams";

/** Keep immediate court replacements ready; prepare later teams with open places.
 * Also wait instead of reserving named playing people when the free players cannot complete an allowed four.
 */
export function prefersWaitingDraft(target: RecommendPoolTarget, inputs: RecommendPoolInputs, extraIds: string[] = [], unavailable: ReadonlySet<string> = new Set()): boolean {
	if (target.teamId) {
		const team = inputs.drafts.get(target.teamId);
		// 이미 있는 팀은 제 상태를 따른다 — 일반 팀은 지금 네 명을 채운다(카드 자동매칭과 같다).
		return !!team && team.courtId == null && team.waitForCompletion === true;
	}
	const playing = playingIdsFromCourts(inputs.courts);
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
	return data.confirmed.length + added >= 2 && hasWaiting && !canCompleteFrom(data.confirmed, data.pool);
}
