/**
 * editLock.ts
 *
 * 양도형 편집 락의 순수 로직 — presence 상태에서 보유자 산정 + claim 값 계산.
 * 채널 track()/store set()은 sessionStore가 담당(여기는 부수효과 없음).
 *
 * 양도형 락: presenceState에서 "현재 접속자 중 가장 최근에 점유(claim)한 기기"를 보유자로 산정.
 * 아무도 claim 안 했으면 lockFree=true(자유, 누구나 편집 가능, 첫 편집이 자동 점유).
 * 모든 클라이언트가 동일 presence 집합을 보므로 결정이 일치. 보유자 이탈 시 자동 자유/인계.
 */

/** Supabase presenceState() 형태(키별 presence 항목 배열). */
export type PresenceState = Record<string, Array<Record<string, unknown>>>;

export type PresenceEntry = { clientId: string; name: string };

export interface PresenceInfo {
	presenceCount: number;
	presenceList: PresenceEntry[];
	holderClientId: string | null;
	holderName: string | null;
	lockFree: boolean;
	isEditor: boolean;
}

export function computePresence(
	state: PresenceState,
	myClientId: string,
	myClaimAt: number,
): PresenceInfo {
	const byId = new Map<string, { name: string; claimAt: number }>();
	for (const arr of Object.values(state)) {
		for (const p of arr) {
			const cid = p?.clientId;
			if (typeof cid !== "string") continue;
			const claimAt = typeof p?.claimAt === "number" ? (p.claimAt as number) : 0;
			const name = typeof p?.name === "string" ? (p.name as string) : "기기";
			const ex = byId.get(cid);
			if (!ex || claimAt > ex.claimAt) byId.set(cid, { name, claimAt });
		}
	}
	// 내 최신 claim이 presence에 아직 반영 안 됐을 수 있어 로컬 값으로 보정(깜빡임 방지)
	const mine = byId.get(myClientId);
	if (mine && myClaimAt > mine.claimAt) mine.claimAt = myClaimAt;

	const claimants = [...byId.entries()]
		.filter(([, v]) => v.claimAt > 0)
		.sort((a, b) => b[1].claimAt - a[1].claimAt || a[0].localeCompare(b[0]));
	const holder = claimants[0];
	const holderClientId = holder?.[0] ?? null;
	const holderName = holder?.[1].name ?? null;
	const lockFree = holderClientId === null;
	return {
		presenceCount: byId.size,
		presenceList: [...byId.entries()].map(([cid, v]) => ({ clientId: cid, name: v.name })),
		holderClientId,
		holderName,
		lockFree,
		isEditor: lockFree || holderClientId === myClientId,
	};
}

/**
 * presence 전체에서 가장 큰 claimAt + 1 — 현재 보유자를 이기는 최소 claim 값.
 * (실제 claim은 호출자가 Date.now()와 max를 취해 시계 오차를 흡수한다.)
 */
export function nextClaimAt(state: PresenceState, myClaimAt: number): number {
	let max = myClaimAt;
	for (const arr of Object.values(state)) {
		for (const p of arr) {
			const c = p?.claimAt;
			if (typeof c === "number" && c > max) max = c;
		}
	}
	return max + 1;
}
