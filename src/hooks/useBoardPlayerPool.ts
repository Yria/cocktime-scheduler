/**
 * useBoardPlayerPool
 *
 * 보드에 표시할 "후보 선수 풀"을 계산한다.
 * - 현재는 세션 참여자 전체(sessionPlayers 전부)를 풀로 사용한다.
 *   로컬 시뮬레이션 단계라 경기 상태(waiting/playing/resting)와 관계없이 모두 자석으로 노출.
 * - 추후 DB 연동 시 필터링(예: 경기중 선수 제외)을 다시 넣을 수 있도록 options를 유지한다.
 */
import { useMemo } from "react";
import type { SessionPlayer } from "../types";
import { useSessionStore } from "../store/sessionStore";

export function useBoardPlayerPool(): SessionPlayer[] {
	const sessionPlayers = useSessionStore((s) => s.sessionPlayers);

	return useMemo(
		() => Array.from(sessionPlayers.values()),
		[sessionPlayers],
	);
}
