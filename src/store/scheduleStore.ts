import { create } from "zustand";
import { setCarpoolGroups } from "../lib/supabase/carpool";
import {
	addGuestAttendance,
	adminCancelAttendance,
	cancelAttendance,
	cancelGuestAttendance,
	deleteSchedule,
	fetchAttendances,
	fetchPlaces,
	fetchSchedules,
	joinSession,
	setCarpoolRole,
	setLateMinutes,
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
import { useAuthStore } from "./authStore";

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

/** 내 참석 행(취소 제외) — 낙관적 업데이트 기준. */
function findMine(sessionId: number): AttendanceRow | undefined {
	const memberId = useAuthStore.getState().memberId;
	if (!memberId) return undefined;
	return useScheduleStore
		.getState()
		.attendances.find(
			(a) => a.session_id === sessionId && a.member_id === memberId,
		);
}

/** 내 참석 행을 즉시 in-place 패치(화면 선반영). memberId 없으면 no-op. */
function patchMine(sessionId: number, patch: Partial<AttendanceRow>) {
	const memberId = useAuthStore.getState().memberId;
	if (!memberId) return;
	useScheduleStore.setState((s) => ({
		attendances: s.attendances.map((a) =>
			a.session_id === sessionId && a.member_id === memberId
				? { ...a, ...patch }
				: a,
		),
	}));
}

/** 늦참 슬라이더 세션별 디바운스 타이머(마지막 조작 후 500ms에 서버 전송). */
const lateSendTimers = new Map<number, ReturnType<typeof setTimeout>>();
const LATE_DEBOUNCE_MS = 500;

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

	/** 운영진: 참여목록에서 임의 참석자(회원/게스트) 제거. 성공 시 참석 목록 재조회. */
	async adminRemove(sessionId: number, memberId: string) {
		const res = await adminCancelAttendance(sessionId, memberId);
		if (res.ok) await reloadAttendances();
		return res;
	},

	/** 카풀 의향 — 화면 선반영 후 즉시 서버 전송. 실패 시 이전 값으로 롤백. */
	async setCarpool(sessionId: number, role: CarpoolRole) {
		const prev = findMine(sessionId)?.carpool_role ?? "none";
		if (prev === role) return { ok: true };
		patchMine(sessionId, { carpool_role: role }); // 낙관적
		const res = await setCarpoolRole(sessionId, role);
		if (!res.ok) patchMine(sessionId, { carpool_role: prev }); // 롤백
		return res;
	},

	/** 늦참 오프셋 — 화면은 즉시, 서버 전송은 마지막 조작 후 500ms 디바운스(자주 끄는 조작 고려). */
	setLate(sessionId: number, minutes: number) {
		patchMine(sessionId, { late_minutes: minutes }); // 낙관적(매 조작 즉시)
		const pending = lateSendTimers.get(sessionId);
		if (pending) clearTimeout(pending);
		lateSendTimers.set(
			sessionId,
			setTimeout(() => {
				lateSendTimers.delete(sessionId);
				void setLateMinutes(sessionId, minutes).then((res) => {
					// 실패 시 서버 권위값으로 재동기화(낙관적 값 되돌림)
					if (!res.ok) void reloadAttendances();
				});
			}, LATE_DEBOUNCE_MS),
		);
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
