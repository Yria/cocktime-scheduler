import { useEffect, useState } from "react";
import type { SessionAttendanceLog } from "../lib/dues/attendanceLog";
import { readSessionAttendanceLog } from "../lib/supabase/dues";

/** 회차 참석 이력은 끝난 회차라 잘 안 바뀐다 — 펼칠 때마다 다시 읽지 않게 화면 수명 동안 캐시. */
const logCache = new Map<number, Promise<SessionAttendanceLog>>();

/**
 * 회차 참석 변경 이력(ops_audit — 운영진만 읽힌다).
 *
 * - 기본(회비 관리): 끝난 회차라 화면 수명 동안 캐시한다.
 * - `refreshKey` 지정(메인 참가자 목록 — 아직 진행 중인 회차): 캐시를 쓰지 않고, 키가 바뀔 때마다
 *   (= 참석 명단이 바뀔 때마다) 다시 읽는다. 다시 읽는 동안은 직전 그래프를 그대로 둔다.
 */
export function useAttendanceLog(
	sessionId: number | null,
	enabled: boolean,
	refreshKey?: string,
) {
	const [state, setState] = useState<{
		id: number | null;
		log: SessionAttendanceLog | null;
		error: string;
	}>({ id: null, log: null, error: "" });
	const live = refreshKey !== undefined;
	useEffect(() => {
		if (!enabled || sessionId === null) return;
		let alive = true;
		let p = live ? undefined : logCache.get(sessionId);
		if (!p) {
			p = readSessionAttendanceLog(sessionId);
			if (!live) {
				logCache.set(sessionId, p);
				p.catch(() => logCache.delete(sessionId));
			}
		}
		p.then(
			(log) => alive && setState({ id: sessionId, log, error: "" }),
			(e: unknown) =>
				alive &&
				// live 재조회 실패는 직전 그래프를 지우지 않는다(다음 명단 변경 때 다시 읽힌다).
				setState((prev) => ({
					id: sessionId,
					log: prev.id === sessionId ? prev.log : null,
					error: e instanceof Error ? e.message : "참석 기록을 못 읽었습니다.",
				})),
		);
		return () => {
			alive = false;
		};
	}, [sessionId, enabled, live, refreshKey]);
	return state.id === sessionId ? state : { id: null, log: null, error: "" };
}
