import { create } from "zustand";
import {
	type CreateScheduleInput,
	createPlace,
	createSchedule,
	deleteSchedule,
	fetchPlaces,
	fetchSchedules,
} from "../lib/supabase/schedule";
import type { PlaceRow, SessionRow } from "../lib/supabase/types";

interface ScheduleState {
	schedules: SessionRow[];
	places: PlaceRow[];
	loading: boolean;
	loaded: boolean;
}

export const useScheduleStore = create<ScheduleState>(() => ({
	schedules: [],
	places: [],
	loading: false,
	loaded: false,
}));

function byScheduled(a: SessionRow, b: SessionRow): number {
	return (a.scheduled_at ?? "").localeCompare(b.scheduled_at ?? "");
}

export const scheduleActions = {
	async load() {
		useScheduleStore.setState({ loading: true });
		const [schedules, places] = await Promise.all([
			fetchSchedules(),
			fetchPlaces(),
		]);
		useScheduleStore.setState({
			schedules,
			places,
			loading: false,
			loaded: true,
		});
	},

	async create(input: CreateScheduleInput, createdBy: string | null) {
		const row = await createSchedule(input, createdBy);
		if (row) {
			useScheduleStore.setState((s) => ({
				schedules: [...s.schedules, row].sort(byScheduled),
			}));
		}
		return row;
	},

	async remove(sessionId: number) {
		const ok = await deleteSchedule(sessionId);
		if (ok) {
			useScheduleStore.setState((s) => ({
				schedules: s.schedules.filter((x) => x.id !== sessionId),
			}));
		}
		return ok;
	},

	async addPlace(
		name: string,
		address: string | null,
		defaultCourtCount: number | null,
		createdBy: string | null,
	) {
		const place = await createPlace(
			name,
			address,
			defaultCourtCount,
			createdBy,
		);
		if (place) {
			useScheduleStore.setState((s) => ({ places: [...s.places, place] }));
		}
		return place;
	},
};
