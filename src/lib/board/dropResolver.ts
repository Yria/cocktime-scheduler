/**
 * dropResolver.ts
 *
 * 드래그된 "자유 자석" 또는 "anchor 멤버"의 드롭 좌표를 받아 DragAction을 결정하는 순수 함수.
 * (ghost 드래그는 boardStore.handleGhostDrop에서 별도 처리한다.)
 *
 * 핵심 3규칙:
 *   ① 자유자석끼리 겹치면      → createPair (둘 다 anchor 신규 팀)
 *   ② anchor 멤버를 빈 공간에  → detach (팀에서 빠짐, 요구2)
 *   ③ anchor 멤버를 다른 팀/선수에 겹치면 → reserve / reservePair (원본 유지 + ghost, 요구5)
 */
import type { DraftTeam, MagnetPosition, StagePoint } from "../../types/board";
import { distance, isInsideTeamBounds, isOnEmptySlot } from "./geometry";
import { PAIR_RADIUS } from "./constants";
import { isMemberOf, teamMemberCount } from "./membership";

export function statusForCount(n: number): "forming" | "ready" {
	return n >= 4 ? "ready" : "forming";
}

export type DropTarget =
	| { kind: "none" }
	| { kind: "move"; to: StagePoint }
	| { kind: "attach"; teamId: string } // 자유 자석 → 팀 (anchor 합류, ghost면 승격)
	| { kind: "createPair"; partnerId: string; anchor: StagePoint } // 자유+자유 → 신규 팀
	| { kind: "detach"; to: StagePoint } // anchor 멤버 → 빈 공간 (해제)
	| { kind: "reserve"; toTeamId: string } // anchor 멤버 → 다른 팀 (ghost 예약)
	| { kind: "reservePair"; partnerId: string; anchor: StagePoint }; // anchor 멤버 → 자유자석 (신규 예비팀, 멤버는 ghost)

export function nearestFreePartner(
	playerId: string,
	drop: StagePoint,
	magnets: ReadonlyMap<string, MagnetPosition>,
	playingIds: ReadonlySet<string>,
): { id: string; pos: StagePoint } | null {
	let bestDist = Number.POSITIVE_INFINITY;
	let bestId: string | null = null;
	let bestPos: StagePoint = { x: 0, y: 0 };
	for (const m of magnets.values()) {
		// 자기 자신 / 팀 소속 / 경기중 선수는 페어 대상에서 제외
		if (m.playerId === playerId || m.teamId !== null || playingIds.has(m.playerId)) continue;
		const d = distance(drop, { x: m.x, y: m.y });
		if (d <= PAIR_RADIUS && d < bestDist) {
			bestDist = d;
			bestId = m.playerId;
			bestPos = { x: m.x, y: m.y };
		}
	}
	return bestId ? { id: bestId, pos: bestPos } : null;
}

export function resolveDropTarget(
	playerId: string,
	drop: StagePoint,
	magnets: ReadonlyMap<string, MagnetPosition>,
	drafts: ReadonlyMap<string, DraftTeam>,
	reservations: ReadonlyMap<string, import("../../types/board").Reservation>,
	playingIds: ReadonlySet<string> = new Set(),
): DropTarget {
	const self = magnets.get(playerId);
	if (!self) return { kind: "none" };

	// ── anchor 멤버를 끌어낸 경우 ──────────────────────────
	if (self.teamId !== null) {
		// 1) 다른 팀의 빈 슬롯(구멍)에 정확히 놓을 때만 예약(reserve).
		//    박스가 겹칠 수 있으므로 bounds 안 모든 팀을 보고 "슬롯이 맞는" 팀을 찾는다(첫 박스에서 멈추지 않음).
		//    bounds 안이지만 어떤 슬롯에도 안 맞으면 스냅백(none).
		let insideOtherTeam = false;
		for (const d of drafts.values()) {
			if (d.id === self.teamId) continue;
			if (!isInsideTeamBounds(drop, d.anchor)) continue;
			insideOtherTeam = true;
			if (isMemberOf(playerId, d.id, drafts, reservations)) continue; // 이미 그 팀 멤버 → 패스(겹친 다른 팀 탐색)
			const count = teamMemberCount(d.id, drafts, reservations);
			if (count < 4 && isOnEmptySlot(drop, d.anchor, count)) return { kind: "reserve", toTeamId: d.id };
		}
		if (insideOtherTeam) return { kind: "none" }; // 박스 안이지만 슬롯 아님/정원 초과 → 원위치
		// 2) 자기 팀 박스 안 → 스냅백 (슬롯 고정)
		const own = drafts.get(self.teamId);
		if (own && isInsideTeamBounds(drop, own.anchor)) return { kind: "none" };
		// 3) 자유 자석 근접 → 신규 예비팀 예약
		const partner = nearestFreePartner(playerId, drop, magnets, playingIds);
		if (partner) {
			return {
				kind: "reservePair",
				partnerId: partner.id,
				anchor: { x: (drop.x + partner.pos.x) / 2, y: (drop.y + partner.pos.y) / 2 },
			};
		}
		// 4) 빈 공간 → 해제
		return { kind: "detach", to: drop };
	}

	// ── 자유 자석을 끌어낸 경우 ───────────────────────────
	// 1) 팀의 빈 슬롯(구멍)에 정확히 놓을 때만 합류(attach).
	//    박스가 겹칠 수 있으므로 bounds 안 모든 팀을 보고 "슬롯이 맞는" 팀을 찾는다(첫 박스에서 멈추지 않음).
	//    bounds 안이지만 어떤 슬롯에도 안 맞으면 스냅백(none).
	let insideAnyTeam = false;
	for (const d of drafts.values()) {
		if (!isInsideTeamBounds(drop, d.anchor)) continue;
		insideAnyTeam = true;
		// 이미 이 팀의 멤버(ghost)면 승격(슬롯 무관, 정원 무관).
		if (isMemberOf(playerId, d.id, drafts, reservations)) return { kind: "attach", teamId: d.id };
		const count = teamMemberCount(d.id, drafts, reservations);
		if (count < 4 && isOnEmptySlot(drop, d.anchor, count)) return { kind: "attach", teamId: d.id };
	}
	if (insideAnyTeam) return { kind: "none" }; // 박스 안이지만 슬롯 아님/정원 초과 → 원위치
	// 2) 다른 자유 자석 근접 → 신규 팀
	const partner = nearestFreePartner(playerId, drop, magnets, playingIds);
	if (partner) {
		return {
			kind: "createPair",
			partnerId: partner.id,
			anchor: { x: (drop.x + partner.pos.x) / 2, y: (drop.y + partner.pos.y) / 2 },
		};
	}
	// 3) 그 외 → 이동
	return { kind: "move", to: drop };
}
