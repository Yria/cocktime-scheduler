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
import { dbEndSession } from "../lib/supabase/actions";
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

/** active 자동 종료 유예: 예정 종료(ends_at)를 넘겨 진행되는 세션을 조기 종료하지 않도록 1시간 여유. */
const ACTIVE_CLOSE_GRACE_MS = 60 * 60 * 1000;

/** 운영진이 일정 목록에 진입하면, 예정 종료(ends_at) + 유예(1h)가 지난 진행중(active) 세션을
 *  서버에 종료 요청한다. active 는 자동 종료 대상이 아니라(수동 종료/다음 세션 시작 때만
 *  닫힘) ends_at 이 지나도 "진행중"으로 목록에 남는데, cron 없이 운영진 로드 시점에 정리한다.
 *  - isAdmin 게이팅: 일반 회원 접속으로는 닫지 않는다(종료 권한은 운영진).
 *  - 종료분은 로컬 배열에서도 제거해 즉시 목록에서 사라지게 한다(fetchSchedules 는 open/active 만 반환). */
async function closeEndedActiveIfAdmin(
	schedules: SessionRow[],
): Promise<SessionRow[]> {
	if (!useAuthStore.getState().isAdmin) return schedules;
	const nowMs = Date.now();
	const stale = schedules.filter(
		(s) =>
			s.status === "active" &&
			s.ends_at != null &&
			Date.parse(s.ends_at) + ACTIVE_CLOSE_GRACE_MS <= nowMs,
	);
	if (stale.length === 0) return schedules;
	await Promise.all(stale.map((s) => dbEndSession(s.id)));
	const staleIds = new Set(stale.map((s) => s.id));
	return schedules.filter((s) => !staleIds.has(s.id));
}

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

/** 세션별 늦참 쓰기 직렬화 체인 — 디바운스 전송과 8시 경계 전환(applyLateTransition)의 순서 역전 방지.
 *  둘이 동시 in-flight면 늦게 커밋된 RPC가 이기는데, 같은존 오프셋 전송이 전환 뒤에 도착하면
 *  풀 전환이 조용히 되돌려진다(status=late_pool → confirmed 복귀). 큐잉으로 신청 순서대로 커밋. */
const lateChains = new Map<number, Promise<unknown>>();
function enqueueLate<T>(sessionId: number, fn: () => Promise<T>): Promise<T> {
	const prev = lateChains.get(sessionId) ?? Promise.resolve();
	const next = prev.then(fn, fn); // 이전 결과/실패와 무관하게 순차 실행
	lateChains.set(
		sessionId,
		next.catch(() => {}),
	); // 체인 꼬리는 rejection 을 삼켜 다음 enqueue 를 막지 않게
	return next;
}

export const scheduleActions = {
	async load() {
		useScheduleStore.setState({ loading: true });
		// 규칙→회차 동기화 + 노출(일요일 18:00 일괄 공개) 선반영 후 목록 조회
		await syncOccurrences();
		const [fetched, places] = await Promise.all([
			fetchSchedules(),
			fetchPlaces(),
		]);
		// 운영진 진입 시: 종료 시각(ends_at) 지난 진행중(active) 세션을 서버에 종료 요청 후 목록에서 제외
		const schedules = await closeEndedActiveIfAdmin(fetched);
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

	/** 늦참 오프셋(같은 존 내 이동, 상태 불변) — 화면은 즉시, 서버 전송은 마지막 조작 후 500ms 디바운스. */
	setLate(sessionId: number, minutes: number) {
		patchMine(sessionId, { late_minutes: minutes }); // 낙관적(매 조작 즉시)
		const pending = lateSendTimers.get(sessionId);
		if (pending) clearTimeout(pending);
		lateSendTimers.set(
			sessionId,
			setTimeout(() => {
				lateSendTimers.delete(sessionId);
				void enqueueLate(sessionId, () =>
					setLateMinutes(sessionId, minutes),
				).then((res) => {
					// 실패 시, 혹은 예상 밖 상태 전환(경계 오판정) 시 서버 권위값으로 재동기화.
					if (!res.ok) void reloadAttendances();
				});
			}, LATE_DEBOUNCE_MS),
		);
	},

	/** 8시 경계 전환(정원 외 늦참 진입/복귀) — 확인 다이얼로그 승인 후 호출.
	 *  디바운스 중이던 오프셋 전송을 취소하고, 직렬화 체인 뒤에 전환 RPC를 이어 붙여(순서 보장)
	 *  전송한 뒤, 상태 변화·자동 승급 반영 위해 재조회한다. */
	async applyLateTransition(sessionId: number, minutes: number) {
		const pending = lateSendTimers.get(sessionId);
		if (pending) {
			clearTimeout(pending);
			lateSendTimers.delete(sessionId);
		}
		patchMine(sessionId, { late_minutes: minutes }); // 오프셋 낙관적 선반영
		const res = await enqueueLate(sessionId, () =>
			setLateMinutes(sessionId, minutes),
		);
		// 성공/실패 무관 재조회 — 상태(late_pool ↔ confirmed/waitlisted)·정원·승급을 서버 권위로 맞춘다.
		await reloadAttendances();
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
