import { useEffect, useState } from "react";
import { ChevronRight } from "lucide-react";
import { splitConfirmedByCapacity } from "../../lib/schedule/waitStatus";
import { fetchAttendances } from "../../lib/supabase/schedule";
import type { AttendanceRow, SessionRow } from "../../lib/supabase/types";
import { useAuthStore } from "../../store/authStore";
import ParticipantStack from "../shared/ParticipantStack";
import SessionParticipantsModal from "./SessionParticipantsModal";

interface Props {
	occurrence: SessionRow;
	placeName: string | null;
}

/**
 * 회차 참가자 요약 — 일정 관리 달력의 회차 시트 상단 블록.
 *
 * 메인(홈)의 일정 카드는 스토어에 이미 담긴 참석 행으로 아바타 스택 → 참가자 목록 모달을 띄우지만,
 * 달력은 open/active 만 담는 scheduleStore 와 무관하게 종료·취소 회차까지 다루므로 여기서 그 회차의
 * 참석 행을 직접 조회한다(운영진이 시트를 열 때만 1회 — 읽기 경로 호출을 늘리지 않기 위해).
 *
 * 탭하면 메인과 **같은** SessionParticipantsModal 을 시트 위에 겹쳐 띄운다. 다만 지난 회차의 참석 행은
 * 대관비 엔빵·회비 부과의 근거라 여기선 읽기 전용(allowRemove=false) — 제거는 메인 일정 카드에서만.
 */
export default function OccurrenceParticipants({ occurrence: s, placeName }: Props) {
	const memberId = useAuthStore((st) => st.memberId);
	// 조회 결과는 회차 id 와 함께 담는다 — 효과 본문에서 setState 로 초기화하지 않고도(cascading render)
	// id 가 바뀐 순간 이전 회차의 명단이 잠깐 보이는 일을 막는다.
	const [loaded, setLoaded] = useState<{
		id: number;
		rows: AttendanceRow[];
	} | null>(null);
	const [showList, setShowList] = useState(false);

	useEffect(() => {
		let alive = true;
		void fetchAttendances([s.id]).then((r) => {
			if (alive) setLoaded({ id: s.id, rows: r });
		});
		return () => {
			alive = false;
		};
	}, [s.id]);

	const rows = loaded?.id === s.id ? loaded.rows : null;

	if (rows == null) {
		return (
			<Box>
				<span className="text-faint" style={{ fontSize: 12.5 }}>
					참가자 불러오는 중…
				</span>
			</Box>
		);
	}

	const confirmed = rows.filter((a) => a.status === "confirmed");
	const waiting = rows.filter((a) => a.status === "waitlisted");
	const latePool = rows.filter((a) => a.status === "late_pool");
	const { freepassOps } = splitConfirmedByCapacity(rows, s.capacity);
	// 스택 순서 = 메인 카드와 동일(확정 → 대기 → 정원 외 늦참).
	const roster = [...confirmed, ...waiting, ...latePool];

	// 카풀·식사 집계는 "실제 참석한 사람"(확정 + 정원 외 늦참) 기준 — 참여목록 모달 헤더의 식사 집계와 같다.
	const attended = [...confirmed, ...latePool];
	const drivers = attended.filter((a) => a.carpool_role === "can_drive").length;
	const riders = attended.filter((a) => a.carpool_role === "need_ride").length;
	const mealOn = s.is_regular && s.meal_enabled;
	const mealJoin = attended.filter((a) => a.meal_joining).length;

	if (roster.length === 0) {
		return (
			<Box>
				<span className="text-faint" style={{ fontSize: 12.5 }}>
					참가자 없음
				</span>
			</Box>
		);
	}

	const countLine =
		`확정 ${confirmed.length}${s.capacity != null ? `/${s.capacity}` : ""}명` +
		(freepassOps.length > 0 ? ` (운영진 ${freepassOps.length}명)` : "") +
		(waiting.length > 0 ? ` · 대기 ${waiting.length}` : "") +
		(latePool.length > 0 ? ` · 늦참 ${latePool.length}` : "");

	return (
		<>
			<button
				type="button"
				onClick={() => setShowList(true)}
				aria-label="참가자 목록 보기"
				className="w-full flex items-center gap-2.5 bg-[rgba(0,0,0,0.02)] dark:bg-[rgba(255,255,255,0.04)]"
				style={{
					border: "none",
					borderRadius: 10,
					padding: "10px 11px",
					textAlign: "left",
					cursor: "pointer",
				}}
			>
				<div className="flex flex-col gap-0.5 min-w-0 flex-1">
					<span
						className="text-strong"
						style={{ fontSize: 13.5, fontWeight: 700 }}
					>
						참가자 {roster.length}명
					</span>
					<span
						className="text-muted"
						style={{ fontSize: 11.5, fontWeight: 600 }}
					>
						{countLine}
					</span>
					{/* 카풀·식사 신청 집계 — 해당 회차에서 켰을 때만(끈 회차는 줄 자체를 감춘다) */}
					{(s.carpool_enabled || mealOn) && (
						<span
							className="flex items-center gap-2 flex-wrap"
							style={{ fontSize: 11.5, fontWeight: 700 }}
						>
							{s.carpool_enabled && (
								<>
									<span style={{ color: "#2c7a57" }}>🚗 운전 {drivers}</span>
									<span style={{ color: "#b4762b" }}>🙋 탑승 {riders}</span>
								</>
							)}
							{mealOn && (
								<span className="text-muted">🍽 식사 {mealJoin}명</span>
							)}
						</span>
					)}
				</div>
				<ParticipantStack roster={roster} max={4} />
				<ChevronRight
					size={16}
					className="flex-shrink-0 text-[#c0c6cf] dark:text-[rgba(235,235,245,0.35)]"
				/>
			</button>

			{showList && (
				<SessionParticipantsModal
					session={s}
					placeName={placeName}
					attendances={rows}
					memberId={memberId}
					// 회차 시트(z=50) 위에 겹쳐 띄운다. 장소 picker(60) 와 겹치는 일은 없다(동시에 열리지 않음).
					zIndex={60}
					allowRemove={false}
					onClose={() => setShowList(false)}
				/>
			)}
		</>
	);
}

/** 요약 줄이 없는 상태(로딩·참가자 없음)용 같은 크기의 자리 — 시트가 튀지 않게 같은 박스를 쓴다. */
function Box({ children }: { children: React.ReactNode }) {
	return (
		<div
			className="bg-[rgba(0,0,0,0.02)] dark:bg-[rgba(255,255,255,0.04)]"
			style={{ borderRadius: 10, padding: "10px 11px" }}
		>
			{children}
		</div>
	);
}
