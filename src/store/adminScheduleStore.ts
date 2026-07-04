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
	updateOccurrence,
	updateRecurringRule,
} from "../lib/supabase/recurring";
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

export const adminScheduleActions = {
	/** 최초 진입: 동기화 → 규칙·장소·해당 기간 회차 로드. */
	async init(fromISO: string, toISO: string) {
		useAdminScheduleStore.setState({
			loading: true,
			range: { from: fromISO, to: toISO },
		});
		await syncOccurrences();
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
		await syncOccurrences();
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
		await syncOccurrences();
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
		const row = await updateOccurrence(sessionId, patch);
		if (row) await reloadOccurrences();
		return row;
	},

	async addOneOff(input: OneOffInput, createdBy: string | null) {
		const row = await createOneOffOccurrence(input, createdBy);
		if (row) {
			await syncOccurrences(); // draft → 공개 창(~다음 일요일) 이내면 open 승격(open 시 전 회원 'session_open' 알림)
			await reloadOccurrences();
		}
		return row;
	},

	/**
	 * 회차 삭제. 반복 규칙 회차는 그냥 delete 하면 sync 가 재생성하므로 tombstone(cancelled)으로
	 * 남기고, 일회성 회차는 완전 삭제한다. 어느 쪽이든 fetchOccurrences 가 제외해 달력에서 사라진다.
	 */
	async removeOccurrence(occ: SessionRow) {
		const ok =
			occ.recurring_schedule_id != null
				? (await cancelOccurrence(occ.id)) != null
				: await deleteSchedule(occ.id);
		if (ok) await reloadOccurrences();
		return ok;
	},
};
