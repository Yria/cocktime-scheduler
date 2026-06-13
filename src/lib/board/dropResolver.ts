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
import { distance, isInsideTeamBounds } from "./geometry";
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
		// 1) 다른 팀 박스 안 → 예약(reserve)
		for (const d of drafts.values()) {
			if (d.id === self.teamId) continue;
			if (!isInsideTeamBounds(drop, d.anchor)) continue;
			if (isMemberOf(playerId, d.id, drafts, reservations)) return { kind: "none" };
			if (teamMemberCount(d.id, drafts, reservations) >= 4) return { kind: "none" };
			return { kind: "reserve", toTeamId: d.id };
		}
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
	// 1) 팀 박스 안 → 합류(attach). 이미 ghost면 승격(정원 무관).
	for (const d of drafts.values()) {
		if (!isInsideTeamBounds(drop, d.anchor)) continue;
		if (isMemberOf(playerId, d.id, drafts, reservations)) return { kind: "attach", teamId: d.id };
		if (teamMemberCount(d.id, drafts, reservations) < 4) return { kind: "attach", teamId: d.id };
		// 정원 꽉 참 & 비멤버 → 이 팀은 패스, 다음 후보 탐색
	}
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
