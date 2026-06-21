import { create } from "zustand";
import {
	type CreateScheduleInput,
	cancelAttendance,
	createPlace,
	createSchedule,
	deleteSchedule,
	fetchAttendances,
	fetchPlaces,
	fetchSchedules,
	joinSession,
} from "../lib/supabase/schedule";
import type {
	AttendanceRow,
	PlaceRow,
	SessionRow,
} from "../lib/supabase/types";

interface ScheduleState {
	schedules: SessionRow[];
	places: PlaceRow[];
	attendances: AttendanceRow[];
	loading: boolean;
	loaded: boolean;
}

export const useScheduleStore = create<ScheduleState>(() => ({
	schedules: [],
	places: [],
	attendances: [],
	loading: false,
	loaded: false,
}));

function byScheduled(a: SessionRow, b: SessionRow): number {
	return (a.scheduled_at ?? "").localeCompare(b.scheduled_at ?? "");
}

async function reloadAttendances() {
	const ids = useScheduleStore.getState().schedules.map((s) => s.id);
	const attendances = await fetchAttendances(ids);
	useScheduleStore.setState({ attendances });
}

export const scheduleActions = {
	async load() {
		useScheduleStore.setState({ loading: true });
		const [schedules, places] = await Promise.all([
			fetchSchedules(),
			fetchPlaces(),
		]);
		const attendances = await fetchAttendances(schedules.map((s) => s.id));
		useScheduleStore.setState({
			schedules,
			places,
			attendances,
			loading: false,
			loaded: true,
		});
	},

	reloadAttendances,

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
				attendances: s.attendances.filter((a) => a.session_id !== sessionId),
			}));
		}
		return ok;
	},

	async join(sessionId: number) {
		const res = await joinSession(sessionId);
		if (res.ok) await reloadAttendances();
		return res;
	},

	async cancel(sessionId: number) {
		const res = await cancelAttendance(sessionId);
		if (res.ok) await reloadAttendances();
		return res;
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
