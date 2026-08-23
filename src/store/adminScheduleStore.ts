import { create } from "zustand";
import {
	type OccurrencePatch,
	type OneOffInput,
	type RecurringRuleInput,
	cancelOccurrence,
	createOneOffOccurrence,
	createRecurringRule,
	deleteRecurringRule,
	fetchOccurrences,
	fetchRecurringRules,
	reopenOccurrence,
	setSessionCapacity,
	updateOccurrence,
	updateRecurringRule,
} from "../lib/supabase/recurring";
import { toast } from "./toastStore";
import { setSessionCourtFee } from "../lib/supabase/dues";
import {
	type CreatePlaceInput,
	createPlace,
	deleteSchedule,
	fetchPlaces,
	syncOccurrences,
} from "../lib/supabase/schedule";
import type {
	PlaceRow,
	RecurringScheduleRow,
	SessionRow,
} from "../lib/supabase/types";

interface AdminScheduleState {
	rules: RecurringScheduleRow[];
	occurrences: SessionRow[];
	places: PlaceRow[];
	range: { from: string; to: string } | null;
	loading: boolean;
	loaded: boolean;
}

export const useAdminScheduleStore = create<AdminScheduleState>(() => ({
	rules: [],
	occurrences: [],
	places: [],
	range: null,
	loading: false,
	loaded: false,
}));

async function reloadOccurrences() {
	const range = useAdminScheduleStore.getState().range;
	if (!range) return;
	const occurrences = await fetchOccurrences(range.from, range.to);
	useAdminScheduleStore.setState({ occurrences });
}

async function reloadRules() {
	const rules = await fetchRecurringRules();
	useAdminScheduleStore.setState({ rules });
}

/** 재설정 결과를 한 줄로 — 무엇이 지워지고 무엇이 새로 났는지 숨기지 않는다. */
function courtResetToast(res: {
	freed: number;
	removed: number;
	issued: number;
	held: number;
}): string {
	const parts: string[] = [];
	if (res.removed > 0) parts.push(`부과 ${res.removed}건 정리`);
	if (res.issued > 0) parts.push(`${res.issued}명에게 재발행`);
	if (res.held > 0) parts.push(`${res.held}명은 발행 대기 (금액 확인 필요)`);
	if (res.freed > 0) parts.push(`입금 ${res.freed}건이 정산함으로 — 다시 확인해주세요`);
	return parts.length > 0 ? parts.join(" · ") : "총액을 저장했어요 (정리할 부과 없음)";
}

export const adminScheduleActions = {
	/** 최초 진입: 동기화 → 규칙·장소·해당 기간 회차 로드. */
	async init(fromISO: string, toISO: string) {
		useAdminScheduleStore.setState({
			loading: true,
			range: { from: fromISO, to: toISO },
		});
		await syncOccurrences({ force: true });
		const [rules, places, occurrences] = await Promise.all([
			fetchRecurringRules(),
			fetchPlaces(),
			fetchOccurrences(fromISO, toISO),
		]);
		useAdminScheduleStore.setState({
			rules,
			places,
			occurrences,
			loading: false,
			loaded: true,
		});
	},

	/** 달력 월 이동 시 표시 범위만 갱신. */
	async setRange(fromISO: string, toISO: string) {
		useAdminScheduleStore.setState({ range: { from: fromISO, to: toISO } });
		await reloadOccurrences();
	},

	/** 당겨서 새로고침: 현재 범위 기준 규칙·회차를 재조회(loading 토글 없이 조용히). */
	async refresh() {
		await Promise.all([reloadRules(), reloadOccurrences()]);
	},

	// ── 반복 규칙 ──
	async addRule(input: RecurringRuleInput, createdBy: string | null) {
		const row = await createRecurringRule(input, createdBy);
		if (!row) return null;
		await syncOccurrences({ force: true });
		await Promise.all([reloadRules(), reloadOccurrences()]);
		// 회원 알림은 sync 의 E단계(draft→open)에서 'session_open' 으로 일원화됨.
		return row;
	},

	async editRule(
		id: number,
		patch: Partial<RecurringRuleInput> & { isActive?: boolean },
	) {
		const row = await updateRecurringRule(id, patch);
		if (!row) return null;
		await syncOccurrences({ force: true });
		await Promise.all([reloadRules(), reloadOccurrences()]);
		return row;
	},

	async removeRule(id: number) {
		const ok = await deleteRecurringRule(id);
		if (!ok) return false;
		// 규칙 삭제 → FK on delete set null 로 회차의 rule_id 가 NULL 이 됨.
		// 남은 미노출 draft 는 더는 규칙이 없으니 정리(취소 대신 삭제)하지 않고 그대로 두되,
		// sync 의 D 단계는 rule_id 가 NULL 이라 건드리지 않음 → 운영진이 달력에서 개별 처리.
		await Promise.all([reloadRules(), reloadOccurrences()]);
		return true;
	},

	// ── 장소 ──
	async addPlace(input: CreatePlaceInput, createdBy: string | null) {
		const place = await createPlace(input, createdBy);
		if (place) {
			useAdminScheduleStore.setState((s) => ({
				places: [...s.places, place],
			}));
		}
		return place;
	},

	// ── 회차 개별 편집 ──
	async overrideOccurrence(sessionId: number, patch: OccurrencePatch) {
		// 정원 실변경 여부는 UPDATE 전 값과 비교(useOccurrenceForm 은 매번 capacity 를 patch 에 담는다).
		const prev = useAdminScheduleStore
			.getState()
			.occurrences.find((o) => o.id === sessionId);
		const prevCapacity = prev?.capacity;
		const capacityChanged =
			patch.capacity !== undefined && patch.capacity !== prevCapacity;
		// 대관 총액도 정원과 같은 모양: 값의 소유자가 전용 RPC 다. 일반 PATCH 로 넣으면 총액만 바뀌고
		// 이미 발행된 부과 금액은 그대로 남는다(2026-08-23 이전의 실제 갭).
		const courtFeeChanged =
			patch.courtFee !== undefined && patch.courtFee !== (prev?.court_fee ?? null);
		// 정원 외 필드는 일반 PATCH. 정원이 바뀌었으면 capacity 는 아래 원자 RPC 가 소유하므로 제외.
		const patchForUpdate = { ...patch };
		if (capacityChanged) delete patchForUpdate.capacity;
		if (courtFeeChanged) delete patchForUpdate.courtFee;
		const row = await updateOccurrence(sessionId, patchForUpdate);
		// 정원이 실제로 바뀐 경우: 정원 변경 + 참석/대기 재조정 + 알림을 한 트랜잭션(원자)으로.
		// 실패하면 setSessionCapacity 가 throw → 폼이 에러를 노출하고 부분 적용을 성공으로 위장하지 않는다.
		if (row && capacityChanged) {
			const { promoted, demoted } = await setSessionCapacity(
				sessionId,
				patch.capacity ?? null,
			);
			const parts: string[] = [];
			if (promoted > 0) parts.push(`대기 ${promoted}명 참석 승격`);
			if (demoted > 0) parts.push(`참석 ${demoted}명 대기 강등`);
			if (parts.length > 0) {
				toast(`${parts.join(" · ")} — 해당 인원에 알림을 보냈어요`, {
					variant: "success",
				});
			}
		}
		// 총액 변경 = 그 회차 정산 재시작(배분 해제 → 부과 삭제 → 재발행).
		if (row && courtFeeChanged) {
			const res = await setSessionCourtFee(sessionId, patch.courtFee ?? null);
			toast(courtResetToast(res), { variant: "success" });
		}
		if (row) await reloadOccurrences();
		return row;
	},

	/**
	 * 종료·진행 회차의 대관 총액 변경 = **그 회차 정산 재시작**(20260823080000).
	 * 배분 해제(→ 그 입금이 정산함으로) → 부과 삭제 → 새 금액으로 재발행. 종전의 "미납분만 정정"은
	 * 완납된 회차에서 아무 일도 못 했다(세션 147: 7명 완납 → fixed=0/locked=7).
	 * 정보 뷰에서 부르는 이유: 대관비는 세션 종료 시점에 발행되고 "끝나고 실제 총액을 알게 됐다"가
	 * 정상 흐름이라 그때 고칠 자리가 필요하다.
	 */
	async fixCourtFee(sessionId: number, amount: number | null) {
		const res = await setSessionCourtFee(sessionId, amount);
		await reloadOccurrences();
		toast(courtResetToast(res), { variant: "success" });
		return res;
	},

	async addOneOff(input: OneOffInput, createdBy: string | null) {
		const row = await createOneOffOccurrence(input, createdBy);
		if (row) {
			await syncOccurrences({ force: true }); // 일회성은 공개 창과 무관하게 draft → open 즉시 승격(전 회원 'session_open' 알림)
			await reloadOccurrences();
		}
		return row;
	},

	/**
	 * 회차 삭제. 반복 규칙 회차는 그냥 delete 하면 sync 가 재생성하므로 tombstone(cancelled)으로
	 * 남기고(달력 점에선 숨되 선택일 목록에 '취소됨' 으로 남아 되살리기 가능), 일회성 회차는
	 * 규칙이 없어 완전 삭제한다(달력에서 완전히 사라짐).
	 */
	async removeOccurrence(occ: SessionRow) {
		const ok =
			occ.recurring_schedule_id != null
				? (await cancelOccurrence(occ.id)) != null
				: await deleteSchedule(occ.id);
		if (ok) await reloadOccurrences();
		return ok;
	},

	/**
	 * 취소된 회차 되살리기(취소 취소). tombstone(cancelled)을 draft 로 되돌린 뒤 sync 를 돌려
	 * 노출 판정을 맡긴다(일회성은 즉시, 규칙 회차는 공개 창 안이면 open 승격 +'session_open' 알림)
	 * — addOneOff 와 동일 패턴.
	 * (본문 reopenOccurrence 는 lib import; 객체 메서드명은 스코프 바인딩이 아니라 재귀 아님)
	 */
	async reopenOccurrence(occ: SessionRow) {
		const row = await reopenOccurrence(occ.id);
		if (row) {
			await syncOccurrences({ force: true });
			await reloadOccurrences();
		}
		return row;
	},
};
