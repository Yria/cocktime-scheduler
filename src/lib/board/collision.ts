import type { DraftTeam, MagnetPosition, StagePoint } from "../../types/board";
import {
	MAGNET_SIZE,
	TEAM_W,
	TEAM_BOX_ABOVE,
	TEAM_BOX_BELOW,
} from "./constants";

const MAG_R = MAGNET_SIZE / 2;
// 흩어짐: 눈에 보이는 원이 "딱 맞닿을 때까지"만 밀어냄(여유 간격 0 = 지름).
const MIN_MAG_DIST = MAGNET_SIZE;
const TEAM_HALF_W = TEAM_W / 2;
// 그룹 박스와도 여유 없이 딱 맞닿게.
const PAD = 0;
const MAX_ITER = 8;

interface Bounds {
	minX: number;
	minY: number;
	maxX: number;
	maxY: number;
}

function pushMagnetFromTeam(m: MagnetPosition, t: DraftTeam, bounds: Bounds): boolean {
	const dx = m.x - t.anchor.x;
	const dy = m.y - t.anchor.y;

	const extentX = TEAM_HALF_W + MAG_R + PAD;
	const extentUp = TEAM_BOX_ABOVE + MAG_R + PAD;
	const extentDown = TEAM_BOX_BELOW + MAG_R + PAD;

	const overlapX = extentX - Math.abs(dx);
	const overlapY = dy >= 0 ? extentDown - dy : extentUp + dy;
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
		const angle = ((a.playerId.charCodeAt(0) * 7 + b.playerId.charCodeAt(0) * 13) % 360) * (Math.PI / 180);
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
		const dx = m.x - t.anchor.x;
		const dy = m.y - t.anchor.y;
		const overlapX = TEAM_HALF_W + MAG_R - Math.abs(dx);
		const overlapY = dy >= 0
			? TEAM_BOX_BELOW + MAG_R - dy
			: TEAM_BOX_ABOVE + MAG_R + dy;
		if (overlapX > 0 && overlapY > 0) return true;
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
				const tdx = candidate.x - t.anchor.x;
				const tdy = candidate.y - t.anchor.y;
				const ox = TEAM_HALF_W + MAG_R - Math.abs(tdx);
				const oy = tdy >= 0
					? TEAM_BOX_BELOW + MAG_R - tdy
					: TEAM_BOX_ABOVE + MAG_R + tdy;
				if (ox > 0 && oy > 0) { blocked = true; break; }
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
	const free = [...magnets.values()].filter(
		(m) => m.teamId === null && !excludeIds?.has(m.playerId),
	);
	if (free.length === 0) return;

	const bounds: Bounds = {
		minX: MAG_R + 4,
		minY: Math.max(MAG_R + 4, topMargin + MAG_R),
		maxX: viewportW - MAG_R - 4,
		maxY: viewportH - MAG_R - 4,
	};

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

// ─────────────────────────────────────────────
// 드롭 지점 기준 BFS 방사형 흩어짐 (scatterFromSource)
// ─────────────────────────────────────────────
// 드롭한 소스(자석=원 / 그룹=사각형)와 겹친 자유 자석을 "소스 반대 방향(방사형)"으로 밀어내고,
// 밀려난 자석이 다시 소스가 되어 자기와 겹친 자석을 밀어내는 연쇄(BFS).
// 안전장치: 연산 상한(종료 보장) · 좌표 일치 시 결정적 각도 · 화면 경계 클램프 · 막히면 빈자리 탐색.

const RECT_EX_W = TEAM_HALF_W + MAG_R + PAD;
const RECT_EX_UP = TEAM_BOX_ABOVE + MAG_R + PAD;
const RECT_EX_DOWN = TEAM_BOX_BELOW + MAG_R + PAD;

export type ScatterShape =
	| { kind: "magnet"; id: string; x: number; y: number }
	| { kind: "rect"; x: number; y: number };

interface Pusher {
	kind: "circle" | "rect";
	x: number;
	y: number;
	id?: string; // circle(자석)일 때 자기 자신 제외용
}

function tieAngle(a: string, b: string): number {
	return ((((a.charCodeAt(0) || 1) * 7 + (b.charCodeAt(0) || 1) * 13) % 360) * Math.PI) / 180;
}

/** 자석 중심이 사각형(중심 cx,cy) keep-out 안에 있는가 */
function inRect(px: number, py: number, cx: number, cy: number): boolean {
	const rx = px - cx;
	const ry = py - cy;
	return Math.abs(rx) < RECT_EX_W && ry > -RECT_EX_UP && ry < RECT_EX_DOWN;
}

/** O가 자석 m을 미는 새 목표 위치. 겹치지 않으면 null. */
function pushTarget(m: MagnetPosition, O: Pusher): StagePoint | null {
	if (O.kind === "circle") {
		let dx = m.x - O.x;
		let dy = m.y - O.y;
		let dist = Math.sqrt(dx * dx + dy * dy);
		if (dist >= MIN_MAG_DIST) return null;
		if (dist < 0.1) {
			const a = tieAngle(m.playerId, O.id ?? "");
			dx = Math.cos(a);
			dy = Math.sin(a);
			dist = 1;
		}
		return { x: O.x + (dx / dist) * MIN_MAG_DIST, y: O.y + (dy / dist) * MIN_MAG_DIST };
	}
	// rect: 방사형으로 사각형 밖까지 밀어냄
	const rx = m.x - O.x;
	const ry = m.y - O.y;
	if (!(Math.abs(rx) < RECT_EX_W && ry > -RECT_EX_UP && ry < RECT_EX_DOWN)) return null;
	let dx = rx;
	let dy = ry;
	let len = Math.sqrt(dx * dx + dy * dy);
	if (len < 0.1) {
		const a = tieAngle(m.playerId, "rect");
		dx = Math.cos(a);
		dy = Math.sin(a);
		len = 1;
	}
	const nx = dx / len;
	const ny = dy / len;
	const tx = nx > 0.001 ? (RECT_EX_W - rx) / nx : nx < -0.001 ? (-RECT_EX_W - rx) / nx : Infinity;
	const ty = ny > 0.001 ? (RECT_EX_DOWN - ry) / ny : ny < -0.001 ? (-RECT_EX_UP - ry) / ny : Infinity;
	const t = Math.min(tx, ty);
	return { x: m.x + nx * (t + 1), y: m.y + ny * (t + 1) };
}

function blockedAt(p: StagePoint, O: Pusher, obstacles: StagePoint[]): boolean {
	// 원 소스로 밀었는데 클램프로 다시 그 안이거나, 어떤 사각형(팀/소스그룹) 안이면 막힘
	if (O.kind === "circle") {
		const dx = p.x - O.x;
		const dy = p.y - O.y;
		if (dx * dx + dy * dy < MIN_MAG_DIST * MIN_MAG_DIST - 1) return true;
	}
	return obstacles.some((o) => inRect(p.x, p.y, o.x, o.y));
}

function freeSpotAround(
	origin: StagePoint,
	obstacles: StagePoint[],
	free: MagnetPosition[],
	selfId: string,
	bounds: Bounds,
): StagePoint {
	for (let radius = MIN_MAG_DIST; radius < 800; radius += MAG_R) {
		for (let angle = 0; angle < 360; angle += 30) {
			const rad = (angle * Math.PI) / 180;
			const cx = Math.max(bounds.minX, Math.min(bounds.maxX, origin.x + Math.cos(rad) * radius));
			const cy = Math.max(bounds.minY, Math.min(bounds.maxY, origin.y + Math.sin(rad) * radius));
			if (obstacles.some((o) => inRect(cx, cy, o.x, o.y))) continue;
			let blocked = false;
			for (const f of free) {
				if (f.playerId === selfId) continue;
				const d = (cx - f.x) ** 2 + (cy - f.y) ** 2;
				if (d < MIN_MAG_DIST * MIN_MAG_DIST) {
					blocked = true;
					break;
				}
			}
			if (!blocked) return { x: cx, y: cy };
		}
	}
	return origin;
}

export function scatterFromSource(
	source: ScatterShape,
	magnets: Map<string, MagnetPosition>,
	drafts: Map<string, DraftTeam>,
	viewportW: number,
	viewportH: number,
	excludeIds?: ReadonlySet<string>,
	topMargin = 0,
): void {
	const free = [...magnets.values()].filter(
		(m) => m.teamId === null && !excludeIds?.has(m.playerId),
	);
	if (free.length === 0) return;

	const bounds: Bounds = {
		minX: MAG_R + 4,
		minY: Math.max(MAG_R + 4, topMargin + MAG_R),
		maxX: viewportW - MAG_R - 4,
		maxY: viewportH - MAG_R - 4,
	};

	// 장애물(빈자리 탐색·재진입 방지용): 모든 예비팀 + 소스 그룹(rect)
	const obstacles: StagePoint[] = [...drafts.values()].map((t) => ({ x: t.anchor.x, y: t.anchor.y }));
	if (source.kind === "rect") obstacles.push({ x: source.x, y: source.y });

	const queue: Pusher[] = [
		source.kind === "magnet"
			? { kind: "circle", x: source.x, y: source.y, id: source.id }
			: { kind: "rect", x: source.x, y: source.y },
	];

	let ops = 0;
	const CAP = free.length * 16 + 64; // 종료 보장 상한

	while (queue.length > 0 && ops < CAP) {
		const O = queue.shift() as Pusher;
		for (const m of free) {
			if (ops++ >= CAP) break;
			if (O.id && m.playerId === O.id) continue; // 소스 자신은 안 밀림
			const target = pushTarget(m, O);
			if (!target) continue; // 안 겹침
			let nx = Math.max(bounds.minX, Math.min(bounds.maxX, target.x));
			let ny = Math.max(bounds.minY, Math.min(bounds.maxY, target.y));
			if (blockedAt({ x: nx, y: ny }, O, obstacles)) {
				const spot = freeSpotAround({ x: nx, y: ny }, obstacles, free, m.playerId, bounds);
				nx = spot.x;
				ny = spot.y;
			}
			if (Math.abs(nx - m.x) > 0.5 || Math.abs(ny - m.y) > 0.5) {
				m.x = nx;
				m.y = ny;
				queue.push({ kind: "circle", x: nx, y: ny, id: m.playerId }); // 밀려난 자석이 새 소스
			}
		}
	}
}
