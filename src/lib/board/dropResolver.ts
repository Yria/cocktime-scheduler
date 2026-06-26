/**
 * dropResolver.ts
 *
 * 드래그된 "자유 자석" 또는 "anchor 멤버"의 드롭 좌표를 받아 DragAction을 결정하는 순수 함수.
 * (ghost 드래그는 boardStore.handleGhostDrop에서 별도 처리한다.)
 *
 * 핵심 규칙:
 *   ① 자유자석끼리 겹치면        → createPair (둘 다 anchor 신규 팀)
 *   ② anchor 멤버를 빈 공간에    → detach (팀에서 빠짐)
 *   ③ anchor(팀구성중) 멤버를 다른 팀에 → attach(이동), 자유자석에 → createPair(이동+신규 페어)
 *      ※ 팀구성중 멤버 이동은 "예약(ghost)"이 아니라 실제 이동. 예약은 경기중 선수에만 적용
 *        (handlePlayingMagnetDrop에서 별도 처리).
 */
import type { DraftTeam, MagnetPosition, StagePoint } from "../../types/board";
import { distance, isInsideTeamBounds, slotIndexAt } from "./geometry";
import { PAIR_RADIUS } from "./constants";
import { isMemberOf, teamMembers } from "./membership";

export function statusForCount(n: number): "forming" | "ready" {
	return n >= 4 ? "ready" : "forming";
}

export type DropTarget =
	| { kind: "none" }
	| { kind: "move"; to: StagePoint }
	| { kind: "attach"; teamId: string; slot?: number } // 자유/이동 → 팀 빈 슬롯 합류(ghost면 승격). slot=놓은 칸.
	| { kind: "replace"; teamId: string; slot: number } // 팀의 점유된 슬롯에 드롭 → 그 자리 멤버 교체(R4)
	| { kind: "createPair"; partnerId: string; anchor: StagePoint } // 자유+자유 → 신규 팀
	| { kind: "detach"; to: StagePoint }; // anchor 멤버 → 빈 공간 (해제)

export function nearestFreePartner(
	playerId: string,
	drop: StagePoint,
	magnets: ReadonlyMap<string, MagnetPosition>,
	playingIds: ReadonlySet<string>,
	notReadyIds: ReadonlySet<string> = new Set(),
): { id: string; pos: StagePoint } | null {
	let bestDist = Number.POSITIVE_INFINITY;
	let bestId: string | null = null;
	let bestPos: StagePoint = { x: 0, y: 0 };
	for (const m of magnets.values()) {
		// 자기 자신 / 팀 소속 / 경기중 / 콕 미확인(매칭 대기 아님) 선수는 페어 대상에서 제외
		if (m.playerId === playerId || m.teamId !== null || playingIds.has(m.playerId) || notReadyIds.has(m.playerId)) continue;
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
	notReadyIds: ReadonlySet<string> = new Set(),
): DropTarget {
	const self = magnets.get(playerId);
	if (!self) return { kind: "none" };

	// ── anchor(팀구성중) 멤버를 끌어낸 경우 ──────────────────────────
	if (self.teamId !== null) {
		// 1) 어떤 팀이든(자기 팀 포함) 슬롯 위면 그 칸 하이라이트 + 드롭 동작:
		//    · 자기 슬롯 위 → 유지(attach, 같은 슬롯 재설정=no-op) — "이 그룹에 계속 들어감" 확인
		//    · 빈 칸 → 그 칸으로 이동(attach). 같은 팀이면 그 칸으로 재배치
		//    · 점유 칸 → 교체(replace). 같은 팀이면 두 멤버 슬롯 스왑(둘 다 유지)
		//    박스가 겹칠 수 있으므로 bounds 안 모든 팀을 보고 슬롯이 맞는 팀을 찾는다. 슬롯 아니면 아래서 none.
		let insideTeam = false;
		for (const d of drafts.values()) {
			if (!isInsideTeamBounds(drop, d.anchor)) continue;
			insideTeam = true;
			const slotIdx = slotIndexAt(drop, d.anchor);
			if (slotIdx < 0) continue;
			const occupant = teamMembers(d.id, drafts, reservations).find((m) => m.slot === slotIdx);
			if (occupant?.playerId === playerId) return { kind: "attach", teamId: d.id, slot: slotIdx }; // 자기 슬롯 — 유지
			if (occupant) return { kind: "replace", teamId: d.id, slot: slotIdx };
			return { kind: "attach", teamId: d.id, slot: slotIdx };
		}
		if (insideTeam) return { kind: "none" }; // 박스 안이지만 슬롯 아님 → 스냅백
		// 2) 자유 자석 근접 → 원본 팀에서 빠져 새 페어로 이동(createPair, ghost 예약 아님)
		const partner = nearestFreePartner(playerId, drop, magnets, playingIds, notReadyIds);
		if (partner) {
			return {
				kind: "createPair",
				partnerId: partner.id,
				anchor: { x: (drop.x + partner.pos.x) / 2, y: (drop.y + partner.pos.y) / 2 },
			};
		}
		// 3) 빈 공간 → 해제
		return { kind: "detach", to: drop };
	}

	// ── 자유 자석을 끌어낸 경우 ───────────────────────────
	// 1) 팀 슬롯 위: 빈 칸→합류(attach), 점유 칸→교체(replace). 이미 이 팀 멤버(ghost)면 승격.
	//    박스가 겹칠 수 있으므로 bounds 안 모든 팀을 보고 "슬롯이 맞는" 팀을 찾는다(첫 박스에서 멈추지 않음).
	let insideAnyTeam = false;
	for (const d of drafts.values()) {
		if (!isInsideTeamBounds(drop, d.anchor)) continue;
		insideAnyTeam = true;
		if (isMemberOf(playerId, d.id, drafts, reservations)) return { kind: "attach", teamId: d.id }; // ghost 승격(슬롯 무관)
		const slotIdx = slotIndexAt(drop, d.anchor);
		if (slotIdx < 0) continue;
		const occupant = teamMembers(d.id, drafts, reservations).find((m) => m.slot === slotIdx);
		if (occupant) return { kind: "replace", teamId: d.id, slot: slotIdx };
		return { kind: "attach", teamId: d.id, slot: slotIdx };
	}
	if (insideAnyTeam) return { kind: "none" }; // 박스 안이지만 슬롯 아님 → 원위치
	// 2) 다른 자유 자석 근접 → 신규 팀
	const partner = nearestFreePartner(playerId, drop, magnets, playingIds, notReadyIds);
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
