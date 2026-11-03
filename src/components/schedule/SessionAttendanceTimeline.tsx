import { useEffect, useMemo, useState } from "react";
import { useAttendanceLog } from "../../hooks/useAttendanceLog";
import {
	fetchMemberLabels,
	memberDisplayLabel,
} from "../../lib/supabase/members";
import type { AttendanceRow } from "../../lib/supabase/types";
import AttendanceTimeline from "../shared/AttendanceTimeline";

/**
 * 참가자 목록 모달 상단의 "시간별 확정 인원" 그래프 — **운영진 전용**(호출부가 isAdmin 으로 가린다.
 * 근거인 ops_audit 도 RLS 상 운영진만 읽힌다).
 *
 * 회비 관리 '자세히 보기'와 같은 AttendanceTimeline 을 쓰되, 진행 중인 회차라 캐시 없이 읽고
 * 참석 명단(상태)이 바뀔 때마다 다시 읽는다. 이름은 현재 참석 행에서 먼저 찾고, 이미 취소·제거돼
 * 행이 없는 사람만 members 에서 한 번 더 조회한다.
 */
export default function SessionAttendanceTimeline({
	sessionId,
	attendances,
}: {
	sessionId: number;
	attendances: AttendanceRow[];
}) {
	const refreshKey = useMemo(
		() =>
			attendances
				.map((a) => `${a.member_id}:${a.status}`)
				.sort()
				.join(","),
		[attendances],
	);
	const { log, error } = useAttendanceLog(sessionId, true, refreshKey);

	const known = useMemo(() => {
		const m = new Map<string, string>();
		for (const a of attendances)
			if (a.member)
				m.set(
					a.member_id,
					memberDisplayLabel(
						a.member.name,
						a.member.birth_year,
						a.member.is_guest,
					),
				);
		return m;
	}, [attendances]);

	// 그래프에 나오지만 현재 참석 행에 없는(취소·제거된) 사람 — 조회한 이름을 누적 보관한다.
	const [extra, setExtra] = useState<Map<string, string>>(() => new Map());
	const missingKey = useMemo(() => {
		if (!log) return "";
		const ids = new Set<string>();
		for (const e of log.events)
			if (!known.has(e.memberId) && !extra.has(e.memberId)) ids.add(e.memberId);
		return [...ids].sort().join(",");
	}, [log, known, extra]);
	useEffect(() => {
		if (!missingKey) return;
		let alive = true;
		void fetchMemberLabels(missingKey.split(",")).then((found) => {
			// 조회 실패(null)는 기록하지 않는다 — 다음 갱신 때 다시 조회된다.
			if (!alive || !found) return;
			setExtra((prev) => {
				const next = new Map(prev);
				// 못 찾은 id 도 표시해 두어 같은 id 를 계속 다시 조회하지 않게 한다.
				for (const id of missingKey.split(","))
					next.set(id, found.get(id) ?? "알 수 없음");
				return next;
			});
		});
		return () => {
			alive = false;
		};
	}, [missingKey]);

	if (!log)
		return (
			<p className="ac-tl-empty">{error || "참석 기록 불러오는 중…"}</p>
		);
	return (
		<AttendanceTimeline
			log={log}
			nameOf={(id) => known.get(id) ?? extra.get(id) ?? "…"}
		/>
	);
}
