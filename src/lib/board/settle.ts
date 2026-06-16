/**
 * settle.ts
 *
 * 자유 자석 겹침 정리(settleFreeMagnets) — 반복적으로 팀 박스/자석끼리 밀어 화면 안에 안정 배치.
 * 드롭 지점 기준 방사형 흩어짐은 scatter.ts 참고.
 */
import type { DraftTeam, MagnetPosition, StagePoint } from "../../types/board";
import {
	type Bounds,
	computeBounds,
	freeMagnets,
	inTeamKeepOut,
	KEEPOUT_DOWN,
	KEEPOUT_UP,
	KEEPOUT_X,
	MAG_R,
	MIN_MAG_DIST,
	tieAngle,
} from "./keepout";

const MAX_ITER = 8;

function pushMagnetFromTeam(m: MagnetPosition, t: DraftTeam, bounds: Bounds): boolean {
	const dx = m.x - t.anchor.x;
	const dy = m.y - t.anchor.y;

	const overlapX = KEEPOUT_X - Math.abs(dx);
	const overlapY = dy >= 0 ? KEEPOUT_DOWN - dy : KEEPOUT_UP + dy;
	if (overlapX <= 0 || overlapY <= 0) return false;

	const tryX = () => { m.x += (dx >= 0 ? 1 : -1) * overlapX; };
	const tryY = () => { m.y += (dy >= 0 ? 1 : -1) * overlapY; };

	if (overlapX < overlapY) {
		tryX();
		if (m.x < bounds.minX || m.x > bounds.maxX) {
			m.x -= (dx >= 0 ? 1 : -1) * overlapX;
			tryY();
		}
	} else {
		tryY();
		if (m.y < bounds.minY || m.y > bounds.maxY) {
			m.y -= (dy >= 0 ? 1 : -1) * overlapY;
			tryX();
		}
	}
	return true;
}

function pushMagnetPair(a: MagnetPosition, b: MagnetPosition): boolean {
	const dx = b.x - a.x;
	const dy = b.y - a.y;
	const dist = Math.sqrt(dx * dx + dy * dy);
	if (dist >= MIN_MAG_DIST) return false;

	if (dist < 0.1) {
		const angle = tieAngle(a.playerId, b.playerId);
		const push = MIN_MAG_DIST / 2;
		a.x -= Math.cos(angle) * push;
		a.y -= Math.sin(angle) * push;
		b.x += Math.cos(angle) * push;
		b.y += Math.sin(angle) * push;
		return true;
	}

	const overlap = MIN_MAG_DIST - dist;
	const nx = dx / dist;
	const ny = dy / dist;
	const half = overlap / 2 + 1;
	a.x -= nx * half;
	a.y -= ny * half;
	b.x += nx * half;
	b.y += ny * half;
	return true;
}

function isOverlappingAnyTeam(m: MagnetPosition, teams: DraftTeam[]): boolean {
	for (const t of teams) {
		if (m.teamId === t.id) continue;
		if (inTeamKeepOut(m.x, m.y, t.anchor)) return true;
	}
	return false;
}

function findFreeSpot(
	origin: StagePoint,
	teams: DraftTeam[],
	others: MagnetPosition[],
	selfId: string,
	bounds: Bounds,
): StagePoint {
	for (let radius = MIN_MAG_DIST; radius < 600; radius += MAG_R) {
		for (let angle = 0; angle < 360; angle += 30) {
			const rad = (angle * Math.PI) / 180;
			const cx = origin.x + Math.cos(rad) * radius;
			const cy = origin.y + Math.sin(rad) * radius;
			const candidate = {
				x: Math.max(bounds.minX, Math.min(bounds.maxX, cx)),
				y: Math.max(bounds.minY, Math.min(bounds.maxY, cy)),
			};

			let blocked = false;
			for (const t of teams) {
				if (inTeamKeepOut(candidate.x, candidate.y, t.anchor)) { blocked = true; break; }
			}
			if (blocked) continue;

			for (const o of others) {
				if (o.playerId === selfId) continue;
				const d = Math.sqrt((candidate.x - o.x) ** 2 + (candidate.y - o.y) ** 2);
				if (d < MIN_MAG_DIST) { blocked = true; break; }
			}
			if (blocked) continue;

			return candidate;
		}
	}
	return origin;
}

export function settleFreeMagnets(
	magnets: Map<string, MagnetPosition>,
	drafts: Map<string, DraftTeam>,
	viewportW: number,
	viewportH: number,
	excludeIds?: ReadonlySet<string>,
	topMargin = 0,
): void {
	const teams = [...drafts.values()];
	const free = freeMagnets(magnets, excludeIds);
	if (free.length === 0) return;

	const bounds = computeBounds(viewportW, viewportH, topMargin);

	for (let iter = 0; iter < MAX_ITER; iter++) {
		let moved = false;

		for (const m of free) {
			for (const t of teams) {
				if (pushMagnetFromTeam(m, t, bounds)) moved = true;
			}
		}

		for (let i = 0; i < free.length; i++) {
			for (let j = i + 1; j < free.length; j++) {
				if (pushMagnetPair(free[i], free[j])) moved = true;
			}
		}

		for (const m of free) {
			const cx = Math.max(bounds.minX, Math.min(bounds.maxX, m.x));
			const cy = Math.max(bounds.minY, Math.min(bounds.maxY, m.y));
			if (cx !== m.x || cy !== m.y) { m.x = cx; m.y = cy; moved = true; }
		}

		if (!moved) break;
	}

	for (const m of free) {
		if (isOverlappingAnyTeam(m, teams)) {
			const spot = findFreeSpot({ x: m.x, y: m.y }, teams, free, m.playerId, bounds);
			m.x = spot.x;
			m.y = spot.y;
		}
	}
}
