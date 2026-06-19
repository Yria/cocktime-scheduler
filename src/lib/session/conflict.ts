/**
 * conflict.ts
 *
 * 세션 설정(코트수/참가자/단식여성) 로컬↔서버 충돌 판정 순수 함수.
 * SessionSetup(충돌 발생 여부)과 SessionConflictDialog(항목별 강조)가 공유.
 */

export interface SessionSettingsSnapshot {
	courtCount: number;
	playerIds: string[];
	singleWomanIds: string[];
	cockCheckEnabled: boolean;
}

export interface SessionSettingsDiff {
	courtChanged: boolean;
	playersChanged: boolean;
	singleChanged: boolean;
	cockCheckChanged: boolean;
	/** 하나라도 다르면 true. */
	any: boolean;
}

/** 두 id 목록이 집합으로서 다른지(순서·중복 무시). */
export function idSetsDiffer(a: string[], b: string[]): boolean {
	const setA = new Set(a);
	const setB = new Set(b);
	if (setA.size !== setB.size) return true;
	for (const id of setA) if (!setB.has(id)) return true;
	return false;
}

/** 로컬 세션 설정과 서버 설정의 차이를 항목별로 계산. */
export function diffSessionSettings(
	local: SessionSettingsSnapshot,
	server: SessionSettingsSnapshot,
): SessionSettingsDiff {
	const courtChanged = local.courtCount !== server.courtCount;
	const playersChanged = idSetsDiffer(local.playerIds, server.playerIds);
	const singleChanged = idSetsDiffer(local.singleWomanIds, server.singleWomanIds);
	const cockCheckChanged = local.cockCheckEnabled !== server.cockCheckEnabled;
	return {
		courtChanged,
		playersChanged,
		singleChanged,
		cockCheckChanged,
		any: courtChanged || playersChanged || singleChanged || cockCheckChanged,
	};
}
