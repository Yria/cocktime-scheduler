import { useMemo, useState } from "react";
import {
	dateStrDow,
	isoToDateKST,
	isoToTimeKST,
	kstEndWallClockToISO,
	kstWallClockToISO,
} from "../../lib/schedule/calendar";
import type {
	OccurrencePatch,
	OneOffInput,
} from "../../lib/supabase/recurring";
import type { SessionRow } from "../../lib/supabase/types";

interface Handlers {
	onOverride: (sessionId: number, patch: OccurrencePatch) => Promise<void>;
	onCreateOneOff: (input: OneOffInput) => Promise<void>;
	onDelete: (occurrence: SessionRow) => Promise<void>;
}

export function useOccurrenceForm(
	occurrence: SessionRow | null,
	date: string | null,
	{ onOverride, onCreateOneOff, onDelete }: Handlers,
) {
	const isRuleBased = occurrence?.recurring_schedule_id != null;
	const status = occurrence?.status ?? null;

	// 대상 날짜: 기존 회차면 scheduled_at(KST), 아니면 신규 대상일
	const occDate = useMemo(() => {
		if (occurrence?.scheduled_at) return isoToDateKST(occurrence.scheduled_at);
		return date;
	}, [occurrence, date]);

	// 폼 상태 prefill
	const [time, setTime] = useState<string>(() => {
		if (occurrence?.scheduled_at) return isoToTimeKST(occurrence.scheduled_at);
		return "19:00";
	});
	const [endTime, setEndTime] = useState<string>(() => {
		if (occurrence?.ends_at) return isoToTimeKST(occurrence.ends_at);
		return "22:00";
	});
	const [carpoolEnabled, setCarpoolEnabled] = useState<boolean>(() => {
		if (occurrence) return occurrence.carpool_enabled;
		// 신규 일회성: 대상일이 주말(토/일)이면 카풀 기본 on
		const dow = occDate ? dateStrDow(occDate) : -1;
		return dow === 0 || dow === 6;
	});
	const [capacity, setCapacity] = useState<string>(() =>
		occurrence?.capacity != null ? String(occurrence.capacity) : "",
	);
	const [placeId, setPlaceId] = useState<number | null>(
		occurrence?.place_id ?? null,
	);
	const [isRegular, setIsRegular] = useState<boolean>(
		() => occurrence?.is_regular ?? false,
	);
	const [noticeMd, setNoticeMd] = useState<string>(
		() => occurrence?.notice_md ?? "",
	);

	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	// 편집 가능 여부 (draft/open 만 편집)
	const editable =
		occurrence == null || status === "draft" || status === "open";

	function parseCapacity(): number | null {
		const v = capacity.trim();
		return v ? Number(v) : null;
	}

	async function run(fn: () => Promise<void>) {
		if (busy) return;
		setBusy(true);
		setError(null);
		try {
			await fn();
		} catch (e) {
			setError(e instanceof Error ? e.message : "처리에 실패했어요.");
			setBusy(false);
		}
	}

	function validTimes(): boolean {
		if (!time || !endTime) {
			setError("시작·종료 시간을 입력하세요.");
			return false;
		}
		if (time === endTime) {
			setError("종료 시간이 시작 시간과 같아요.");
			return false;
		}
		return true;
	}

	// 저장: 신규 일회성 생성
	function handleCreate() {
		if (!occDate) {
			setError("대상 날짜가 없어요.");
			return;
		}
		if (!validTimes()) return;
		void run(async () => {
			await onCreateOneOff({
				scheduledAt: kstWallClockToISO(occDate, time),
				endsAt: kstEndWallClockToISO(occDate, time, endTime),
				carpoolEnabled,
				occurrenceDate: occDate,
				placeId,
				capacity: parseCapacity(),
				isRegular,
				noticeMd: noticeMd.trim() ? noticeMd : null,
			});
		});
	}

	// 저장: 기존 회차 수정
	function handleOverride() {
		if (!occurrence || !occDate) return;
		if (!validTimes()) return;
		void run(async () => {
			await onOverride(occurrence.id, {
				scheduledAt: kstWallClockToISO(occDate, time),
				endsAt: kstEndWallClockToISO(occDate, time, endTime),
				carpoolEnabled,
				placeId,
				capacity: parseCapacity(),
				isRegular,
				noticeMd: noticeMd.trim() ? noticeMd : null,
			});
		});
	}

	function handleDelete() {
		if (!occurrence) return;
		if (!confirm("이 회차를 삭제할까요? 되돌릴 수 없어요.")) return;
		void run(async () => {
			await onDelete(occurrence);
		});
	}

	return {
		isRuleBased,
		status,
		editable,
		occDate,
		time,
		setTime,
		endTime,
		setEndTime,
		carpoolEnabled,
		setCarpoolEnabled,
		capacity,
		setCapacity,
		placeId,
		setPlaceId,
		isRegular,
		setIsRegular,
		noticeMd,
		setNoticeMd,
		busy,
		error,
		handleCreate,
		handleOverride,
		handleDelete,
	};
}
