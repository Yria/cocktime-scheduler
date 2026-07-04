import { create } from "zustand";
import { setCarpoolGroups } from "../lib/supabase/carpool";
import {
	addGuestAttendance,
	cancelAttendance,
	cancelGuestAttendance,
	deleteSchedule,
	fetchAttendances,
	fetchPlaces,
	fetchSchedules,
	joinSession,
	setCarpoolRole,
	syncOccurrences,
} from "../lib/supabase/schedule";
import type { Gender, PlayerSkills } from "../types";
import type {
	AttendanceRow,
	CarpoolGroups,
	CarpoolRole,
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

async function reloadAttendances() {
	const ids = useScheduleStore.getState().schedules.map((s) => s.id);
	const attendances = await fetchAttendances(ids);
	useScheduleStore.setState({ attendances });
}

export const scheduleActions = {
	async load() {
		useScheduleStore.setState({ loading: true });
		// 규칙→회차 동기화 + 노출(일요일 18:00 일괄 공개) 선반영 후 목록 조회
		await syncOccurrences();
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

	async setCarpool(sessionId: number, role: CarpoolRole) {
		const res = await setCarpoolRole(sessionId, role);
		if (res.ok) await reloadAttendances();
		return res;
	},

	/** 운영자: 카풀 편성 저장(공지 빌더). 저장 성공 시 스토어의 세션 carpool_groups 갱신. */
	async saveCarpoolGroups(sessionId: number, groups: CarpoolGroups) {
		const ok = await setCarpoolGroups(sessionId, groups);
		if (ok) {
			useScheduleStore.setState((s) => ({
				schedules: s.schedules.map((x) =>
					x.id === sessionId ? { ...x, carpool_groups: groups } : x,
				),
			}));
		}
		return ok;
	},

	async addGuest(
		sessionId: number,
		guest: { name: string; gender: Gender; skills: PlayerSkills },
	) {
		const res = await addGuestAttendance(sessionId, guest);
		if (res.ok) await reloadAttendances();
		return res;
	},

	async cancelGuest(sessionId: number, guestMemberId: string) {
		const res = await cancelGuestAttendance(sessionId, guestMemberId);
		if (res.ok) await reloadAttendances();
		return res;
	},
};
