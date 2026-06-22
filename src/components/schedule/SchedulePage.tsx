import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
	monthRangeISO,
	shiftMonth,
	todayKST,
} from "../../lib/schedule/calendar";
import type {
	OccurrencePatch,
	OneOffInput,
	RecurringRuleInput,
} from "../../lib/supabase/recurring";
import type { CreatePlaceInput } from "../../lib/supabase/schedule";
import type {
	PlaceRow,
	RecurringScheduleRow,
	SessionRow,
} from "../../lib/supabase/types";
import {
	adminScheduleActions,
	useAdminScheduleStore,
} from "../../store/adminScheduleStore";
import { useAuthStore } from "../../store/authStore";
import OccurrenceEditor from "./OccurrenceEditor";
import RecurringRulesPanel from "./RecurringRulesPanel";
import RuleEditor from "./ScheduleRuleEditor";
import ScheduleCalendar from "./ScheduleCalendar";

interface RuleModal {
	rule: RecurringScheduleRow | null; // null = 신규
}
interface OccModal {
	occurrence: SessionRow | null; // null = 신규 일회성
	date: string | null; // YYYY-MM-DD
}

export default function SchedulePage() {
	const navigate = useNavigate();
	const ready = useAuthStore((s) => s.ready);
	const isAdmin = useAuthStore((s) => s.isAdmin);
	const memberId = useAuthStore((s) => s.memberId);

	const rules = useAdminScheduleStore((s) => s.rules);
	const occurrences = useAdminScheduleStore((s) => s.occurrences);
	const places = useAdminScheduleStore((s) => s.places);
	const loading = useAdminScheduleStore((s) => s.loading);

	const today = todayKST();
	const [viewYear, setViewYear] = useState(() => Number(today.slice(0, 4)));
	const [viewMonth, setViewMonth] = useState(() => Number(today.slice(5, 7)) - 1);
	const [selectedDate, setSelectedDate] = useState<string | null>(today);

	const [ruleModal, setRuleModal] = useState<RuleModal | null>(null);
	const [occModal, setOccModal] = useState<OccModal | null>(null);

	// 운영진 전용
	useEffect(() => {
		if (ready && !isAdmin) navigate("/", { replace: true });
	}, [ready, isAdmin, navigate]);

	// 최초 진입: 동기화 + 현재 월 로드
	useEffect(() => {
		const { from, to } = monthRangeISO(viewYear, viewMonth);
		void adminScheduleActions.init(from, to);
		// 최초 1회만
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	const goMonth = useCallback((y: number, m: number) => {
		setViewYear(y);
		setViewMonth(m);
		setSelectedDate(null); // 월 이동 시 선택일 초기화(이전 달 날짜 상세가 남지 않게)
		const { from, to } = monthRangeISO(y, m);
		void adminScheduleActions.setRange(from, to);
	}, []);

	const handlePrev = useCallback(() => {
		const { year, month } = shiftMonth(viewYear, viewMonth, -1);
		goMonth(year, month);
	}, [viewYear, viewMonth, goMonth]);

	const handleNext = useCallback(() => {
		const { year, month } = shiftMonth(viewYear, viewMonth, 1);
		goMonth(year, month);
	}, [viewYear, viewMonth, goMonth]);

	const placeName = useCallback(
		(id: number | null) =>
			id == null ? null : (places.find((p) => p.id === id)?.name ?? null),
		[places],
	);

	const handleAddPlace = useCallback(
		(input: CreatePlaceInput): Promise<PlaceRow | null> =>
			adminScheduleActions.addPlace(input, memberId),
		[memberId],
	);

	// ── 규칙 핸들러 ──
	const handleSaveRule = useCallback(
		async (input: RecurringRuleInput) => {
			if (ruleModal?.rule) await adminScheduleActions.editRule(ruleModal.rule.id, input);
			else await adminScheduleActions.addRule(input, memberId);
			setRuleModal(null);
		},
		[ruleModal, memberId],
	);

	const handleToggleRule = useCallback((rule: RecurringScheduleRow) => {
		void adminScheduleActions.editRule(rule.id, { isActive: !rule.is_active });
	}, []);

	const handleDeleteRule = useCallback((rule: RecurringScheduleRow) => {
		if (!confirm("이 반복 규칙을 삭제할까요? (이미 만들어진 회차는 달력에서 개별 정리)"))
			return;
		void adminScheduleActions.removeRule(rule.id);
	}, []);

	// ── 회차 핸들러 ──
	const handleOverride = useCallback(
		async (sessionId: number, patch: OccurrencePatch) => {
			await adminScheduleActions.overrideOccurrence(sessionId, patch);
			setOccModal(null);
		},
		[],
	);

	const handleCreateOneOff = useCallback(
		async (input: OneOffInput) => {
			await adminScheduleActions.addOneOff(input, memberId);
			setOccModal(null);
		},
		[memberId],
	);

	const handleSkip = useCallback(async (sessionId: number) => {
		await adminScheduleActions.skipOccurrence(sessionId);
		setOccModal(null);
	}, []);

	const handleRestore = useCallback(
		async (sessionId: number, isRuleBased: boolean) => {
			await adminScheduleActions.restoreOcc(sessionId, isRuleBased);
			setOccModal(null);
		},
		[],
	);

	const handleDeleteOcc = useCallback(async (sessionId: number) => {
		await adminScheduleActions.deleteOcc(sessionId);
		setOccModal(null);
	}, []);

	const monthOccurrences = useMemo(() => occurrences, [occurrences]);

	if (!ready) return null;

	return (
		<div
			className="min-h-[100dvh] bg-[#fafbff] dark:bg-[#0f172a]"
			style={{
				padding: "1.25rem",
				paddingTop: "max(1.25rem, env(safe-area-inset-top))",
				paddingBottom: "max(1.25rem, env(safe-area-inset-bottom))",
			}}
		>
			<div className="w-full max-w-sm mx-auto flex flex-col gap-4">
				{/* 헤더 */}
				<div className="flex items-center justify-between">
					<h1
						className="text-[#0f1724] dark:text-white"
						style={{ fontSize: 20, fontWeight: 800 }}
					>
						일정 관리
					</h1>
					<button
						type="button"
						onClick={() => navigate("/")}
						className="text-[#98a0ab] dark:text-[rgba(235,235,245,0.4)]"
						style={{
							background: "none",
							border: "none",
							fontSize: 14,
							fontWeight: 600,
							cursor: "pointer",
						}}
					>
						닫기
					</button>
				</div>

				<RecurringRulesPanel
					rules={rules}
					placeName={placeName}
					onAdd={() => setRuleModal({ rule: null })}
					onEdit={(rule) => setRuleModal({ rule })}
					onToggle={handleToggleRule}
					onDelete={handleDeleteRule}
				/>

				<ScheduleCalendar
					year={viewYear}
					month={viewMonth}
					occurrences={monthOccurrences}
					placeName={placeName}
					selectedDate={selectedDate}
					loading={loading}
					onPrev={handlePrev}
					onNext={handleNext}
					onSelectDate={setSelectedDate}
					onSelectOccurrence={(occ) =>
						setOccModal({ occurrence: occ, date: null })
					}
					onAddOneOff={(date) => setOccModal({ occurrence: null, date })}
				/>
			</div>

			{ruleModal && (
				<RuleEditor
					initial={ruleModal.rule}
					places={places}
					onAddPlace={handleAddPlace}
					onSubmit={handleSaveRule}
					onClose={() => setRuleModal(null)}
				/>
			)}

			{occModal && (
				<OccurrenceEditor
					occurrence={occModal.occurrence}
					date={occModal.date}
					places={places}
					placeName={placeName}
					onAddPlace={handleAddPlace}
					onOverride={handleOverride}
					onCreateOneOff={handleCreateOneOff}
					onSkip={handleSkip}
					onRestore={handleRestore}
					onDelete={handleDeleteOcc}
					onClose={() => setOccModal(null)}
				/>
			)}
		</div>
	);
}
