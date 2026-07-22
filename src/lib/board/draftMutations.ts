import type { DraftTeam, MagnetPosition, Reservation } from "../../types/board";
import { computeSlotOffset } from "./geometry";
import { isMemberOf, teamMemberCount, teamMembers } from "./membership";
import { randomId } from "../randomId";

/** 멤버십 변형 헬퍼가 받는 최소 상태 — 실제 호출부는 boardStore의 full immer 드래프트. */
export type Draft = { magnets: Map<string, MagnetPosition>; drafts: Map<string, DraftTeam>; reservations: Map<string, Reservation> };

export function newId(): string {
	return randomId();
}

export function nowMs(): number {
	return Date.now();
}

/**
 * 팀의 "우선배치(그룹 지정)한 멤버" 중 현재 멤버(anchor + ghost)에 남아있는 것만. 2명 이상이면 의도적 그룹(순수 시각 표시).
 * memberIds = 현재 유효 멤버 id 집합(anchor + 예약 ghost) — 4명+예약 잠금 시 ghost도 포함되므로 anchor만으로 거르지 않는다.
 */
export function effectiveForcedIds(t: DraftTeam, memberIds: ReadonlySet<string>): string[] {
	if (!t.forcedIds?.length) return [];
	return t.forcedIds.filter((id) => memberIds.has(id));
}

// ── 내부 헬퍼 (immer draft 상태를 직접 변형) ───────────────

export function dissolveDraft(s: Draft, teamId: string) {
	const team = s.drafts.get(teamId);
	if (team) {
		for (const id of team.anchorMemberIds) {
			const m = s.magnets.get(id);
			if (m) {
				m.teamId = null;
				m.x = team.anchor.x;
				m.y = team.anchor.y;
			}
		}
	}
	s.drafts.delete(teamId);
	// 이 팀을 가리키던 모든 예약(ghost) cascade 삭제
	for (const [rid, r] of [...s.reservations]) {
		if (r.teamId === teamId) s.reservations.delete(rid);
	}
}

/**
 * 경기시작 성공 후: 예비팀을 제거하고 멤버 4명을 팀이 있던 자리(슬롯)로 안착시킨다.
 * (경기완료로 free가 되어 다시 나타날 때 이전 팀 위치 근처에 보이도록.)
 */
export function dissolveDraftAfterAssign(s: Draft, teamId: string) {
	const team = s.drafts.get(teamId);
	if (team) {
		const members = teamMembers(teamId, s.drafts, s.reservations);
		for (const mem of members) {
			const m = s.magnets.get(mem.playerId);
			if (!m) continue;
			m.teamId = null;
			const off = computeSlotOffset(mem.slot);
			m.x = team.anchor.x + off.x;
			m.y = team.anchor.y + off.y;
		}
	}
	s.drafts.delete(teamId);
	for (const [rid, r] of [...s.reservations]) {
		if (r.teamId === teamId) s.reservations.delete(rid);
	}
}

export function detachAnchor(s: Draft, playerId: string) {
	const mag = s.magnets.get(playerId);
	if (!mag || mag.teamId === null) return;
	const teamId = mag.teamId;
	const team = s.drafts.get(teamId);
	mag.teamId = null;
	if (!team) return;
	team.anchorMemberIds = team.anchorMemberIds.filter((id) => id !== playerId);
	// 그룹에서 빠진 사람은 우선배치(forcedIds 그룹 표시)에서도 제거 → 다시 넣으면 표시 리셋
	if (team.forcedIds?.length) {
		team.forcedIds = team.forcedIds.filter((id) => id !== playerId);
	}
	// 슬롯 매핑에서도 제거 → 그 칸이 빈 슬롯으로 (다시 넣으면 새로 배치)
	if (team.slots && playerId in team.slots) delete team.slots[playerId];
	// 남은 인원이 너무 적으면(원본 0명 또는 총 2명 미만) 팀 해체
	if (team.anchorMemberIds.length === 0 || teamMemberCount(teamId, s.drafts, s.reservations) < 2) {
		dissolveDraft(s, teamId);
	}
}

export function attachAnchor(s: Draft, playerId: string, teamId: string, slot?: number) {
	const mag = s.magnets.get(playerId);
	const team = s.drafts.get(teamId);
	if (!mag || !team) return;
	// anchor로 확정되면 이 선수는 어느 팀에서도 빌려질(ghost) 수 없다(anchor xor ghost). 모든 예약(타 팀 포함) 정제.
	// — 원본(선수)이 anchor로 바뀌는데 복사본(ghost)이 다른 팀에 남는 구조적 결함 방지. ghost 승격도 이 경로로 처리.
	for (const [rid, r] of [...s.reservations]) {
		if (r.playerId === playerId) s.reservations.delete(rid);
	}
	const setSlot = () => {
		if (slot === undefined) return; // 미지정 → teamMembers fallback(빈칸 순서대로)
		team.slots = team.slots ?? {};
		team.slots[playerId] = slot;
	};
	if (team.anchorMemberIds.includes(playerId)) {
		mag.teamId = teamId;
		setSlot();
		return;
	}
	if (teamMemberCount(teamId, s.drafts, s.reservations) >= 4) return;
	if (mag.teamId && mag.teamId !== teamId) detachAnchor(s, playerId);
	team.anchorMemberIds.push(playerId);
	mag.teamId = teamId;
	setSlot();
}

export function addReservation(s: Draft, playerId: string, teamId: string) {
	if (!s.drafts.get(teamId)) return;
	if (isMemberOf(playerId, teamId, s.drafts, s.reservations)) return;
	if (teamMemberCount(teamId, s.drafts, s.reservations) >= 4) return;
	const id = newId();
	s.reservations.set(id, { id, playerId, teamId, createdAt: nowMs() });
}

/**
 * 경기 종료/로스터 제외로 "자유가 된" 선수의 예약(ghost)을 해소한다 — 빌려뒀던 팀의 정식 멤버(anchor)로 승격.
 * 원본(선수)이 경기중→자유로 바뀔 때 복사본(ghost)이 한 곳으로 수렴되게 하는 공통 처리. completeMatch/setMatchRoster 공용.
 * 승격 대상은 가장 오래된 예약(우선배치는 순수 그룹 표시라 승격 우선권 없음). attachAnchor가 그 선수의 모든 예약을
 * 정제하므로 다중 예약도 한 번에 정리된다. 대상 팀이 사라졌으면 고아 예약만 제거.
 */
export function resolveFreedReservations(s: Draft, playerIds: readonly string[]) {
	for (const pid of playerIds) {
		const mag = s.magnets.get(pid);
		if (!mag || mag.teamId !== null) continue; // 이미 어느 팀 anchor면 스킵
		const myRes = [...s.reservations.values()].filter((r) => r.playerId === pid);
		if (myRes.length === 0) continue;
		myRes.sort((a, b) => a.createdAt - b.createdAt);
		const target = myRes[0];
		if (!s.drafts.get(target.teamId)) {
			for (const [rid, r] of [...s.reservations]) if (r.playerId === pid) s.reservations.delete(rid);
			continue;
		}
		attachAnchor(s, pid, target.teamId, s.drafts.get(target.teamId)?.slots?.[pid]); // 모든 예약 정제 + anchor 합류
	}
}
