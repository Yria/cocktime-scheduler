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

// ── 내부 헬퍼 (immer draft 상태를 직접 변형) ───────────────

/**
 * 매칭확정 해제 가드 — 멤버가 빠져 4명 미만이 된 팀은 확정(confirmedMs)을 지운다.
 * 모든 "인원이 줄 수 있는" 뮤테이션(detach/예약삭제/heal) 끝에서 호출. 4명 유지되는 교체(스왑)는 순번 보존.
 */
export function clearConfirmIfBelowFull(s: Draft, teamId: string) {
	const team = s.drafts.get(teamId);
	if (!team || team.confirmedMs == null) return;
	if (teamMemberCount(teamId, s.drafts, s.reservations) < 4) delete team.confirmedMs;
}

/**
 * 인원 바닥 가드 — 유효 인원(anchor + 이 팀 ghost, 중복 제외)이 2명 미만인 팀은 해체한다.
 * 해체했으면 true(호출부는 확정 해제를 더 할 필요가 없다).
 *
 * **왜 필수인가**: 1인 팀을 남기면 그 선수가 화면에서 통째로 사라진다(2026-07-31 실제 사고).
 * 팀 박스는 렌더 게이팅(membership.wouldDissolveByPlaying: 유효 인원 < 2 → 안 그림)으로 사라지는데,
 * 남은 멤버 자석의 teamId 는 그 팀을 계속 가리켜 자유 자석 필터(teamId===null)에서도 빠지기 때문이다.
 * 정렬·새로고침·워치독 어느 것도 복구하지 못하고, 편집자면 그 상태가 서버 board_drafts 로 저장된다.
 *
 * 그래서 "인원이 줄 수 있는" 모든 뮤테이션은 clearConfirmIfBelowFull 대신/함께 이걸 호출해야 한다.
 * detachAnchor 에만 있던 규칙을 공용으로 올린 것 — anchor 가 빠지는 경로뿐 아니라 **ghost(예약)가
 * 빠지는 경로**(예약 취소·재예약·휴식·anchor 승격 시 타 팀 ghost 회수)도 같은 바닥을 지켜야 한다.
 * 경기중 anchor 때문에 유효 인원이 줄어드는 경우는 healPlayingAnchors 가 playingIds 로 판정해 담당한다.
 */
export function dissolveIfUnderTwo(s: Draft, teamId: string): boolean {
	if (!s.drafts.has(teamId)) return false;
	if (teamMemberCount(teamId, s.drafts, s.reservations) >= 2) return false;
	dissolveDraft(s, teamId);
	return true;
}

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
	// 슬롯 매핑에서도 제거 → 그 칸이 빈 슬롯으로 (다시 넣으면 새로 배치)
	if (team.slots && playerId in team.slots) delete team.slots[playerId];
	// 남은 인원이 너무 적으면(원본 0명 또는 총 2명 미만) 팀 해체
	if (team.anchorMemberIds.length === 0) {
		dissolveDraft(s, teamId);
		return;
	}
	if (dissolveIfUnderTwo(s, teamId)) return;
	clearConfirmIfBelowFull(s, teamId); // 4명 미만이 됐으면 매칭확정 해제
}

/**
 * 선수를 팀 정식 멤버(anchor)로 합류. by = 이 액션을 수행한 편집자 표시 이름 —
 * "새 인원"이 팀에 들어갈 때만 createdBy를 갱신한다(ghost 승격·팀내 재배치·자동 승격은 미갱신).
 */
export function attachAnchor(s: Draft, playerId: string, teamId: string, slot?: number, by?: string) {
	const mag = s.magnets.get(playerId);
	const team = s.drafts.get(teamId);
	if (!mag || !team) return;
	// createdBy 갱신 판정은 예약 정제 전에 — 이 팀의 ghost였다면(승격) "이미 그룹 안 사람"이라 갱신 대상 아님.
	const wasMember = isMemberOf(playerId, teamId, s.drafts, s.reservations);
	// anchor로 확정되면 이 선수는 어느 팀에서도 빌려질(ghost) 수 없다(anchor xor ghost). 모든 예약(타 팀 포함) 정제.
	// — 원본(선수)이 anchor로 바뀌는데 복사본(ghost)이 다른 팀에 남는 구조적 결함 방지. ghost 승격도 이 경로로 처리.
	const ghostLostTeamIds = new Set<string>();
	for (const [rid, r] of [...s.reservations]) {
		if (r.playerId !== playerId) continue;
		s.reservations.delete(rid);
		if (r.teamId !== teamId) ghostLostTeamIds.add(r.teamId);
	}
	// ghost를 잃은 다른 팀은 1명만 남으면 해체(실종 방지), 살아남았으면 4명 미만 시 확정 해제.
	// (경기완료 승격 resolveFreedReservations → attachAnchor 경로가 다중 예약 팀을 1인으로 만드는 실제 경로다.)
	for (const tid of ghostLostTeamIds) {
		if (!dissolveIfUnderTwo(s, tid)) clearConfirmIfBelowFull(s, tid);
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
	if (by && !wasMember) team.createdBy = by; // 새 인원을 넣은 편집자로 갱신
}

/** 예약(ghost) 추가. by = 수행 편집자 — ghost도 사각형에 보이는 인원 추가이므로 createdBy 갱신. */
export function addReservation(s: Draft, playerId: string, teamId: string, by?: string) {
	const team = s.drafts.get(teamId);
	if (!team) return;
	if (isMemberOf(playerId, teamId, s.drafts, s.reservations)) return;
	if (teamMemberCount(teamId, s.drafts, s.reservations) >= 4) return;
	const id = newId();
	s.reservations.set(id, { id, playerId, teamId, createdAt: nowMs() });
	if (by) team.createdBy = by;
}

/**
 * 경기 종료/로스터 제외로 "자유가 된" 선수의 예약(ghost)을 해소한다 — 빌려뒀던 팀의 정식 멤버(anchor)로 승격.
 * 원본(선수)이 경기중→자유로 바뀔 때 복사본(ghost)이 한 곳으로 수렴되게 하는 공통 처리. completeMatch/setMatchRoster 공용.
 * 승격 대상은 가장 오래된 예약. attachAnchor가 그 선수의 모든 예약을
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
