// Attendance/settlement presentation types; financial rows come from the canonical ledger.
export type ChargeStatus =
	| "unpaid"
	| "partial"
	| "paid"
	| "overpaid"
	| "waived"
	| "void";

export interface CourtChargeRow {
	id: number;
	memberId: string;
	sessionId: number;
	sessionTitle: string | null;
	scheduledAt: string | null;
	amountDue: number;
	amountPaid: number;
	status: ChargeStatus;
	payerHint: string | null;
	isDayCancel: boolean; // 정액 당일 확정취소로 부과된 건(현황서 별도 노출 + 부과삭제 대상)
	voidedBy: string | null; // 부과삭제(void)한 운영진 member_id (누가 삭제했는지)
}

export interface SessionAttendanceRow {
	memberId: string;
	status: string; // confirmed | late_pool | waitlisted | cancelled
	confirmedAt: string | null; // 마지막으로 자리를 잡은 시각(grace 기준, 대기는 null)
	cancelledAt: string | null;
}

export interface SessionFeeRow {
	id: number;
	title: string | null;
	status: "open" | "active" | "closed";
	scheduledAt: string | null;
	courtCount: number | null;
	hours: number | null;
	placeName: string | null;
	courtFee: number | null; // 실제 입력 지출(= 엔빵 총액)
	ruleCourtFee: number | null; // 반복 규칙 기본 총액 — 엔빵 총액 fallback(coalesce(세션,규칙), §1.1)
	attendeeIds: string[]; // 확정 참가자(confirmed/late_pool) member_id — 정산함 신규 세션 칩 참석 필터용
	attendances: SessionAttendanceRow[]; // 전체 참석행(취소 포함) — 정산 대조의 '부과 대상' 재현용
	/**
	 * 보드에 올라간 회원 id(session_players). 부과 대상은 **참석 명단 ∪ 보드 추가분**이라
	 * (서버 `dues_court_targets`) 명단에 없는 참여자를 재현하려면 이게 필요하다.
	 * 세션 셋업 게스트(member_id=null)는 부과 주체가 없어 빠진다.
	 */
	boardMemberIds: string[];
}
