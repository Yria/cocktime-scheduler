/**
 * scatter.ts
 *
 * 드롭 지점 기준 BFS 방사형 흩어짐(scatterFromSource).
 * 드롭한 소스(자석=원 / 그룹=사각형)와 겹친 자유 자석을 "소스 반대 방향(방사형)"으로 밀어내고,
 * 밀려난 자석이 다시 소스가 되어 자기와 겹친 자석을 밀어내는 연쇄(BFS).
 * 안전장치: 연산 상한(종료 보장) · 좌표 일치 시 결정적 각도 · 화면 경계 클램프 · 막히면 빈자리 탐색.
 *
 * 반복 안정화(settle)는 settle.ts 참고.
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

export type ScatterShape =
	| { kind: "magnet"; id: string; x: number; y: number }
	| { kind: "rect"; x: number; y: number };

interface Pusher {
	kind: "circle" | "rect";
	x: number;
	y: number;
	id?: string; // circle(자석)일 때 자기 자신 제외용
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
	if (!inTeamKeepOut(m.x, m.y, { x: O.x, y: O.y })) return null;
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
	const tx = nx > 0.001 ? (KEEPOUT_X - rx) / nx : nx < -0.001 ? (-KEEPOUT_X - rx) / nx : Infinity;
	const ty = ny > 0.001 ? (KEEPOUT_DOWN - ry) / ny : ny < -0.001 ? (-KEEPOUT_UP - ry) / ny : Infinity;
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
	return obstacles.some((o) => inTeamKeepOut(p.x, p.y, o));
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
			if (obstacles.some((o) => inTeamKeepOut(cx, cy, o))) continue;
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
	const free = freeMagnets(magnets, excludeIds);
	if (free.length === 0) return;

	const bounds = computeBounds(viewportW, viewportH, topMargin);

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
