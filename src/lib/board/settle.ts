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

/**
 * 고정 자석(fixed) 위에 겹친 이동 가능 자석(m)만 밀어낸다 — 고정 쪽은 절대 움직이지 않는다.
 * pushMagnetPair 는 양쪽을 반씩 밀어 "위치 보존" 계약을 깨므로 고정 상대에는 쓸 수 없다.
 */
function pushMagnetOffFixed(m: MagnetPosition, fixed: MagnetPosition): boolean {
	let dx = m.x - fixed.x;
	let dy = m.y - fixed.y;
	let dist = Math.sqrt(dx * dx + dy * dy);
	if (dist >= MIN_MAG_DIST) return false;
	if (dist < 0.1) {
		// 좌표가 완전히 겹친 경우(팀 자리에 남은 자석 위로 다른 자석이 들어온 상황) 결정적 각도로 분리
		const angle = tieAngle(m.playerId, fixed.playerId);
		dx = Math.cos(angle);
		dy = Math.sin(angle);
		dist = 1;
	}
	m.x = fixed.x + (dx / dist) * MIN_MAG_DIST;
	m.y = fixed.y + (dy / dist) * MIN_MAG_DIST;
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
	/**
	 * 위치는 보존해야 하지만 **충돌 대상으로는 반드시 고려해야 하는** 자유 자석 id
	 * (= 사용자가 직접 배치해 둔 기존 자석). excludeIds 는 free 목록에서 아예 빠져 충돌 판정조차
	 * 되지 않으므로, 이걸 안 넘기면 새로 필드에 들어온 자석이 기존 자석과 **완전히 겹친 채** 남아
	 * 화면에서 가려진다(팀 박스 keep-out 이 우연히 밀어주던 경우만 살아났음).
	 * 여기 넣은 자석은 움직이지 않고, 겹친 이동 가능 자석만 비켜난다.
	 */
	fixedIds?: ReadonlySet<string>,
): void {
	const teams = [...drafts.values()];
	const free = freeMagnets(magnets, excludeIds);
	if (free.length === 0) return;

	// 고정(움직이지 않지만 충돌하는) 자유 자석 — 경기중 자석은 코트 카드에 그려지므로 대상이 아니다
	// (호출자가 playing 을 fixedIds 에 넣지 않는다).
	const fixed: MagnetPosition[] = [];
	if (fixedIds?.size) {
		for (const m of magnets.values()) {
			if (m.teamId === null && fixedIds.has(m.playerId)) fixed.push(m);
		}
	}

	const bounds = computeBounds(viewportW, viewportH, topMargin);

	for (let iter = 0; iter < MAX_ITER; iter++) {
		let moved = false;

		for (const m of free) {
			for (const t of teams) {
				if (pushMagnetFromTeam(m, t, bounds)) moved = true;
			}
			for (const f of fixed) {
				if (pushMagnetOffFixed(m, f)) moved = true;
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

	// 팀 박스 **또는 고정 자석** 위에 남은 자석은 빈자리로 재배치한다. 고정 자석 겹침을 여기서 안 잡으면,
	// 고정 자석이 촘촘할 때(정렬 격자 간격 74 < MIN_MAG_DIST*2=128) 밀어내기만으로는 원리적으로 해소가
	// 불가능해 겹친 채 끝난다 — 밀려난 자리가 곧 다른 고정 자석의 반경 안이라 매 반복 튕겨 다니기 때문이다.
	const obstacleMagnets = fixed.length ? [...free, ...fixed] : free;
	const overlapsFixed = (m: MagnetPosition) =>
		fixed.some(
			(f) =>
				f.playerId !== m.playerId &&
				(m.x - f.x) ** 2 + (m.y - f.y) ** 2 < MIN_MAG_DIST * MIN_MAG_DIST,
		);
	for (const m of free) {
		if (isOverlappingAnyTeam(m, teams) || overlapsFixed(m)) {
			const spot = findFreeSpot({ x: m.x, y: m.y }, teams, obstacleMagnets, m.playerId, bounds);
			m.x = spot.x;
			m.y = spot.y;
		}
	}
}
