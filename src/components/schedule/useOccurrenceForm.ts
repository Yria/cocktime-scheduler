import { useMemo, useRef, useState } from "react";
import {
	dateStrDow,
	isoToDateKST,
	isoToTimeKST,
	kstEndWallClockToISO,
	kstWallClockToISO,
} from "../../lib/schedule/calendar";
import {
	parseCourtFee,
	resetTouchesCharges,
} from "../../lib/schedule/courtFee";
import { sessionDeletionInfo } from "../../lib/supabase/dues";
import type {
	OccurrencePatch,
	OneOffInput,
	OccurrenceEditResult,
} from "../../lib/supabase/recurring";
import type { SessionRow } from "../../lib/supabase/types";

interface Handlers {
	onCreateOneOff: (input: OneOffInput) => Promise<void>;
	onDelete: (occurrence: SessionRow) => Promise<void>;
	/** 기존 회차 저장(정원 재조정·부과 재계산 포함). 실패는 throw. */
	onEdit: (sessionId: number, patch: OccurrencePatch) => Promise<void>;
	/** 위 저장을 서버에서 돌려 본 결과(롤백). 확인창 숫자용. */
	onPreviewEdit: (
		sessionId: number,
		patch: OccurrencePatch,
	) => Promise<OccurrenceEditResult>;
}

export function useOccurrenceForm(
	occurrence: SessionRow | null,
	date: string | null,
	{
		onCreateOneOff,
		onDelete,
		onEdit,
		onPreviewEdit,
	}: Handlers,
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
	const [courtFeeStr, setCourtFeeStr] = useState<string>(() =>
		occurrence?.court_fee != null ? String(occurrence.court_fee) : "",
	);
	const [isRegular, setIsRegular] = useState<boolean>(
		() => occurrence?.is_regular ?? false,
	);
	const [noticeMd, setNoticeMd] = useState<string>(
		() => occurrence?.notice_md ?? "",
	);
	const [mealEnabled, setMealEnabled] = useState<boolean>(
		() => occurrence?.meal_enabled ?? false,
	);
	const [mealPlace, setMealPlace] = useState<string>(
		() => occurrence?.meal_place ?? "",
	);
	// 카카오 검색으로 고른 좌표. 직접 타이핑으로 이름을 바꾸면 좌표가 그 이름과 어긋나므로 버린다
	// (좌표 없이 저장되면 지도는 이름 검색으로 폴백 — 엉뚱한 핀보다 낫다).
	const [mealCoords, setMealCoords] = useState<{
		lat: number;
		lng: number;
	} | null>(() =>
		occurrence?.meal_place_lat != null && occurrence?.meal_place_lng != null
			? { lat: occurrence.meal_place_lat, lng: occurrence.meal_place_lng }
			: null,
	);
	/** 가게명 직접 입력 — 검색 결과와 달라지므로 좌표를 해제. */
	function changeMealPlaceText(v: string) {
		setMealPlace(v);
		setMealCoords(null);
	}
	/** 카카오 검색 결과 선택 — 가게명 + 좌표를 함께 확정. */
	function pickMealPlace(name: string, lat: number, lng: number) {
		setMealPlace(name);
		setMealCoords({ lat, lng });
	}

	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	// 편집 가능 여부 — 취소 회차만 정보 보기(되살리기). 진행·종료 회차도 편집한다(날짜는 서버가 고정).
	const editable = occurrence == null || status !== "cancelled";
	const started = status === "active" || status === "closed";
	// 저장 전 확인창: 이 저장으로 대관비 부과가 바뀔 때만(미리보기 결과 + 확정할 patch).
	const [chargePreview, setChargePreview] = useState<{
		patch: OccurrencePatch;
		result: OccurrenceEditResult;
	} | null>(null);

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
				courtFee: parseCourtFee(courtFeeStr),
				isRegular,
				noticeMd: noticeMd.trim() ? noticeMd : null,
				// 정모가 아니면 식사 체크도 끈 상태로 저장(정모 off 회차에 유령 게이트가 남지 않게)
				mealEnabled: isRegular && mealEnabled,
				mealPlace: mealPlace.trim() ? mealPlace.trim() : null,
				// 가게명을 지우면 좌표도 함께 비운다(고아 좌표 방지)
				mealPlaceLat: mealPlace.trim() ? (mealCoords?.lat ?? null) : null,
				mealPlaceLng: mealPlace.trim() ? (mealCoords?.lng ?? null) : null,
			});
		});
	}

	// 저장: 기존 회차 수정
	function handleOverride() {
		if (!occurrence || !occDate) return;
		if (!validTimes()) return;
		const patch: OccurrencePatch = {
			scheduledAt: kstWallClockToISO(occDate, time),
			endsAt: kstEndWallClockToISO(occDate, time, endTime),
			carpoolEnabled,
			placeId,
			capacity: parseCapacity(),
			courtFee: parseCourtFee(courtFeeStr),
			isRegular,
			noticeMd: noticeMd.trim() ? noticeMd : null,
			mealEnabled: isRegular && mealEnabled,
			mealPlace: mealPlace.trim() ? mealPlace.trim() : null,
			// 가게명을 지우면 좌표도 함께 비운다(고아 좌표 방지)
			mealPlaceLat: mealPlace.trim() ? (mealCoords?.lat ?? null) : null,
			mealPlaceLng: mealPlace.trim() ? (mealCoords?.lng ?? null) : null,
		};
		// 서버에서 먼저 돌려 보고, 부과(발행분 취소·재발행 등)가 바뀌면 무엇이 바뀌는지 확인받는다.
		void run(async () => {
			const result = await onPreviewEdit(occurrence.id, patch);
			if (!resetTouchesCharges(result)) {
				await onEdit(occurrence.id, patch);
				return;
			}
			setChargePreview({ patch, result });
			setBusy(false);
		});
	}

	function confirmChargeEdit() {
		if (!occurrence || !chargePreview) return;
		const { patch } = chargePreview;
		void run(async () => {
			try {
				await onEdit(occurrence.id, patch);
			} finally {
				setChargePreview(null);
			}
		});
	}

	// 선납 조회~confirm 사이의 async 창(버튼이 아직 busy 아님) 중복 클릭 가드. setState 는 same-tick 재클릭을 못 막으므로 ref 로.
	const deletingRef = useRef(false);
	async function handleDelete() {
		if (!occurrence || busy || deletingRef.current) return;
		deletingRef.current = true;
		try {
			const info = await sessionDeletionInfo(occurrence.id);
			const msg = info.preserve
				? "이 회차를 취소할까요? 부과·납부 기록은 유지돼요. 부과 취소나 환불은 회비 관리에서 처리해 주세요."
				: "이 회차를 삭제할까요? 되돌릴 수 없어요.";
			if (!confirm(msg)) return;
			await run(async () => {
				await onDelete(occurrence);
			});
		} catch (e) {
			await run(async () => {
				throw e;
			});
		} finally {
			deletingRef.current = false;
		}
	}

	return {
		isRuleBased,
		status,
		editable,
		started,
		chargePreview,
		// 저장 중엔 닫지 않는다(실패 사유를 보여줄 폼이 남아 있어야 한다).
		dismissChargePreview: () => {
			if (!busy) setChargePreview(null);
		},
		confirmChargeEdit,
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
		courtFeeStr,
		setCourtFeeStr,
		isRegular,
		setIsRegular,
		noticeMd,
		setNoticeMd,
		mealEnabled,
		setMealEnabled,
		mealPlace,
		changeMealPlaceText,
		pickMealPlace,
		mealCoords,
		busy,
		error,
		handleCreate,
		handleOverride,
		handleDelete,
	};
}
