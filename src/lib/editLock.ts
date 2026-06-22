/**
 * editLock.ts
 *
 * 보드 편집 락 + presence 순수 로직.
 * - 편집 락(누가 편집자인가)은 **서버 권위**(sessions.editor_* 컬럼)로 결정한다 → computeLockFromRow.
 *   presence 다수결이 아니라 단일 DB row가 진실이므로, presence 부분 동기화로 인한 이중 편집권(원인2)이 없다.
 * - presence는 "현재 접속자 목록" 표시 전용 → computePresenceList (편집권 election에 쓰지 않는다).
 * 채널 track()/RPC/store set()은 sessionStore가 담당(여기는 부수효과 없는 순수 함수).
 */

/** Supabase presenceState() 형태(키별 presence 항목 배열). */
export type PresenceState = Record<string, Array<Record<string, unknown>>>;

export type PresenceEntry = { clientId: string; name: string };

/** presence 상태 → 접속자 수/목록. 편집권과 무관(모달 표시·핸드오프 대상 선택용). */
export function computePresenceList(state: PresenceState): {
	presenceCount: number;
	presenceList: PresenceEntry[];
} {
	const byId = new Map<string, string>();
	for (const arr of Object.values(state)) {
		for (const p of arr) {
			const cid = p?.clientId;
			if (typeof cid !== "string") continue;
			const name = typeof p?.name === "string" ? (p.name as string) : "기기";
			if (!byId.has(cid)) byId.set(cid, name);
		}
	}
	return {
		presenceCount: byId.size,
		presenceList: [...byId.entries()].map(([clientId, name]) => ({ clientId, name })),
	};
}

/** sessions.editor_* 캐시 — leaseUntilMs는 Date.parse(editor_lease_until)(없으면 0). */
export interface EditorCache {
	clientId: string | null;
	name: string | null;
	leaseUntilMs: number;
}

export interface LockInfo {
	holderClientId: string | null;
	holderName: string | null;
	lockFree: boolean;
	isEditor: boolean;
}

/**
 * 서버 권위 편집 락 상태 산정. 보유자 = editor_client_id 존재 AND lease가 아직 유효(leaseUntilMs > now).
 * lease 만료(보유자 crash 등)면 lockFree=true로 떨어져 누구나 다시 점유 가능.
 */
export function computeLockFromRow(
	editor: EditorCache,
	myClientId: string | null,
	nowMs: number,
): LockInfo {
	const active = !!editor.clientId && editor.leaseUntilMs > nowMs;
	const holderClientId = active ? editor.clientId : null;
	return {
		holderClientId,
		holderName: active ? editor.name : null,
		lockFree: !active,
		isEditor: active && editor.clientId === myClientId,
	};
}
