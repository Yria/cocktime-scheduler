import { useMemo } from "react";
import type { SessionPlayer } from "../types";
import { useSessionStore } from "../store/sessionStore";
import { getPlayingPlayers } from "../lib/sessionUtils";
import { rankCandidates } from "../lib/teamSelection";
import type { RankedCandidate } from "../lib/teamSelection";

export type { RankedCandidate };

/**
 * usePickerCandidates
 *
 * rankCandidates 원자 함수를 UI에서 소비하기 위한 훅.
 * ManualMatchDialog(수동 조합)와 PlayerReplaceDialog(선수 교체) 양쪽에서 사용한다.
 *
 * 풀 구성 정책:
 *   - waiting 선수 + 경기중 선수를 포함 (곧 가용 예정이므로)
 *   - 대기열(matchQueue)에 이미 예약된 선수는 제외
 *
 * @param confirmedIds - 이미 확정된 선수 ID 목록 (0~3개).
 *   수동 조합: 사용자가 선택한 선수들
 *   선수 교체: [파트너, 상대1, 상대2] — 호출자가 구성해서 넘김
 */
export function usePickerCandidates(confirmedIds: string[]): RankedCandidate[] {
	const sessionPlayers = useSessionStore((s) => s.sessionPlayers);
	const waitingIds = useSessionStore((s) => s.waitingIds);
	const courts = useSessionStore((s) => s.courts);
	const matchQueue = useSessionStore((s) => s.matchQueue);
	const pairHistory = useSessionStore((s) => s.pairHistory);
	const lastCoPlayers = useSessionStore((s) => s.lastCoPlayers);

	// 대기열에 예약된 선수 ID 집합
	const queueMemberIds = useMemo(
		() => new Set(matchQueue.flatMap((t) => [...t.teamA, ...t.teamB])),
		[matchQueue],
	);

	// waiting 선수 목록
	const waitingPlayers = useMemo(
		() =>
			waitingIds
				.map((id) => sessionPlayers.get(id))
				.filter((p): p is SessionPlayer => p !== undefined),
		[waitingIds, sessionPlayers],
	);

	// 경기중 선수 목록
	const playingPlayers = useMemo(
		() => getPlayingPlayers(courts, sessionPlayers),
		[courts, sessionPlayers],
	);

	// confirmed ID 집합 (풀에서 제외용)
	const confirmedIdSet = useMemo(() => new Set(confirmedIds), [confirmedIds]);

	// 풀: (waiting + playing) - 대기열 예약자 - confirmed
	const pool = useMemo(() => {
		const seen = new Set<string>();
		const result: SessionPlayer[] = [];
		for (const p of [...waitingPlayers, ...playingPlayers]) {
			if (!seen.has(p.id) && !queueMemberIds.has(p.id) && !confirmedIdSet.has(p.id)) {
				seen.add(p.id);
				result.push(p);
			}
		}
		return result;
	}, [waitingPlayers, playingPlayers, queueMemberIds, confirmedIdSet]);

	// confirmed 선수 객체 목록 (풀 바깥의 선수도 포함될 수 있으므로 sessionPlayers에서 조회)
	const confirmed = useMemo(
		() =>
			confirmedIds
				.map((id) => sessionPlayers.get(id))
				.filter((p): p is SessionPlayer => p !== undefined),
		[confirmedIds, sessionPlayers],
	);

	return useMemo(
		() => rankCandidates(confirmed, pool, { pairHistory, lastCoPlayers }),
		[confirmed, pool, pairHistory, lastCoPlayers],
	);
}
