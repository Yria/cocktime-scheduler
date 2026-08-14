import { supabase } from "./client";
import type { Gender } from "../../types";
import type { CarpoolGroups } from "./types";

// 카풀 공지 빌더 데이터 레이어.
// 편성 명단은 attendances.carpool_role 위에 얹는 레이어 — 의향을 바꾸지 않는다.

/** 카풀 편성 대상 1명(운전자 또는 탑승필요). residence 는 지도 동 중심점·동별 그룹핑용. */
export interface CarpoolMember {
	member_id: string;
	name: string;
	gender: Gender | null;
	is_guest: boolean;
	/** 거주 동(예: "강남구 역삼동"). 지도/그룹핑 키. 없으면 '위치 미상'. */
	residence: string | null;
	/** 이름 뒤 년생 표기용(동명이인 구분). 게스트·미입력은 null. */
	birthYear: number | null;
	role: "can_drive" | "need_ride";
	/** 운전자 제공 좌석(참고 표시용, 강제 아님). */
	seats: number | null;
}

/**
 * 카풀 편성 대상 명단 — confirmed 이고 carpool_role 이 can_drive/need_ride 인 참석자.
 * residence 는 members 임베드로 가져온다(운영자가 빌더를 열 때만 조회 → 데이터 최소화).
 */
export async function fetchCarpoolRoster(
	sessionId: number,
): Promise<CarpoolMember[]> {
	const { data, error } = await supabase
		.from("attendances")
		.select(
			"member_id, carpool_role, carpool_seats, member:member_id(name, is_guest, gender, residence, birth_year)",
		)
		.eq("session_id", sessionId)
		.eq("status", "confirmed")
		.in("carpool_role", ["can_drive", "need_ride"]);
	if (error) {
		console.error("fetchCarpoolRoster:", error);
		return [];
	}
	// member 임베드(to-one)의 supabase 타입 추론이 약해 명시 캐스팅(unknown 경유).
	type RosterRow = {
		member_id: string;
		carpool_role: "can_drive" | "need_ride";
		carpool_seats: number | null;
		member: {
			name: string | null;
			is_guest: boolean | null;
			gender: Gender | null;
			residence: string | null;
			birth_year: number | null;
		} | null;
	};
	return ((data ?? []) as unknown as RosterRow[]).map((r) => ({
		member_id: r.member_id,
		name: r.member?.name ?? "회원",
		gender: r.member?.gender ?? null,
		is_guest: r.member?.is_guest ?? false,
		residence: r.member?.residence ?? null,
		birthYear: r.member?.birth_year ?? null,
		role: r.carpool_role,
		seats: r.carpool_seats ?? null,
	}));
}

/** 편성 저장(운영자 전용 RPC). */
export async function setCarpoolGroups(
	sessionId: number,
	groups: CarpoolGroups,
): Promise<boolean> {
	const { error } = await supabase.rpc("set_carpool_groups", {
		p_session_id: sessionId,
		p_groups: groups,
	});
	if (error) {
		console.error("setCarpoolGroups:", error);
		return false;
	}
	return true;
}
