import { useEffect, useState } from "react";
import type { SessionAttendanceLog } from "../../lib/dues/attendanceLog";
import { readSessionAttendanceLog } from "../../lib/supabase/dues";

/** 회차 참석 이력은 끝난 회차라 잘 안 바뀐다 — 펼칠 때마다 다시 읽지 않게 화면 수명 동안 캐시. */
const logCache = new Map<number, Promise<SessionAttendanceLog>>();

export function useAttendanceLog(sessionId: number | null, enabled: boolean) {
	const [state, setState] = useState<{
		id: number | null;
		log: SessionAttendanceLog | null;
		error: string;
	}>({ id: null, log: null, error: "" });
	useEffect(() => {
		if (!enabled || sessionId === null) return;
		let alive = true;
		let p = logCache.get(sessionId);
		if (!p) {
			p = readSessionAttendanceLog(sessionId);
			logCache.set(sessionId, p);
			p.catch(() => logCache.delete(sessionId));
		}
		p.then(
			(log) => alive && setState({ id: sessionId, log, error: "" }),
			(e: unknown) =>
				alive &&
				setState({
					id: sessionId,
					log: null,
					error: e instanceof Error ? e.message : "참석 기록을 못 읽었습니다.",
				}),
		);
		return () => {
			alive = false;
		};
	}, [sessionId, enabled]);
	return state.id === sessionId ? state : { id: null, log: null, error: "" };
}
