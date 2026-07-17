import {
	computeLockFromRow,
	detectEditorLoss,
	type EditorCache,
} from "../lib/editLock";
import { dbBoardClaimEditor, dbBoardReleaseEditor } from "../lib/supabase";
import { getSessionId, type GetFn, type SetFn } from "./sessionStoreState";

// ── 서버 권위 편집 락 생명주기 (presence 파생 폐기 — 원인2 / 하트비트·침묵 점유 폐기 — Realtime 감축) ──
// 편집 보유자는 sessions.editor_* 단일 row가 결정한다. 클라는 그 row를 cachedEditor에 캐시하고
// computeLockFromRow로 isEditor/holder/lockFree를 산정한다(신원만 — sticky 소유).
// 하트비트(주기적 lease 연장 UPDATE) 제거: 락은 만료로 자동 해제되지 않고 명시적 takeover/handoff
// (또는 이탈 시 release)로만 이동하므로 연장이 불필요 → claimNow가 1회성 점유 RPC를 발사한다.
// "혼자라는 이유만의 자동 점유"(구 maybeClaimIfAlone/reeval 타이머)도 제거 — 편집 권한은 오직
// 편집 의도(드래그 편집 시 claimEdit→claimEditingIfFree, 또는 '편집 권한 가져오기' 버튼)로만 획득한다.
// 즉 연결만 하고 편집 안 하는 클라(상시 데스크탑 등)는 편집자가 되지 않는다(호깅/플래핑 방지).
export const LEASE_SECONDS = 20;

let cachedEditor: EditorCache = { clientId: null, name: null, leaseUntilMs: 0 };
let visibilityHandler: (() => void) | null = null;
let pageHideHandler: (() => void) | null = null;
// 락 세대(epoch) — 권위적 락 변경(claim/handoff/resync/row/세션경계)마다 증가. in-flight heartbeat RPC의
// 늦은 .then이 그 사이 바뀐 상태를 덮어쓰지 않게(handoff/크로스세션 stale 콜백) 가드한다.
let lockEpoch = 0;

/** 현재 cachedEditor 스냅샷 — computeLockFromRow 재산정 등 읽기 전용 접근자. */
export function getCachedEditor(): EditorCache {
	return cachedEditor;
}

/** 권위적 락 변경 반영 — lockEpoch 증가(in-flight heartbeat .then 무효화) 후 cachedEditor 교체. */
export function setEditorCache(next: EditorCache) {
	lockEpoch++;
	cachedEditor = next;
}

/** 락 캐시 초기화(세션 경계/리셋) — lockEpoch 증가 포함(in-flight 점유 콜백 무효화). */
export function resetEditorCache() {
	lockEpoch++;
	cachedEditor = { clientId: null, name: null, leaseUntilMs: 0 };
}

/**
 * cachedEditor + 현재 시각으로 락 상태 재산정.
 * 편집자였다가 다른 사람에게 뺏긴 전이면 editorTakenBy(다이얼로그용)를 세팅한다.
 * suppressLossNotice=true(자발적 양도)면 그 알림을 띄우지 않는다.
 */
export function recomputeLock(get: GetFn, set: SetFn, opts?: { suppressLossNotice?: boolean }) {
	const myClientId = get()._clientId;
	const prevIsEditor = get().isEditor;
	const info = computeLockFromRow(cachedEditor, myClientId);
	set(info);
	if (info.isEditor) {
		// 내가 (다시) 편집자가 되면 떠 있던 뺏김 알림은 닫는다.
		if (get().editorTakenBy) set({ editorTakenBy: null });
	} else if (!opts?.suppressLossNotice) {
		const takenBy = detectEditorLoss(prevIsEditor, info, myClientId);
		if (takenBy) set({ editorTakenBy: takenBy });
	}
}

/**
 * 낙관적 점유 — cachedEditor를 나로 세팅 후 서버 점유 RPC를 1회 발사(하트비트 없음, 연장 불필요).
 * 성공: 서버가 돌려준 값으로 확정. 실패(남이 보유 — sticky라 claim으론 못 뺏음): 서버 권위로 되돌림.
 */
export function claimNow(get: GetFn, set: SetFn) {
	const { _clientId, _myName } = get();
	if (!_clientId) return;
	const name = _myName ?? "기기";
	// 권위적 변경 — in-flight 콜백 무효화(setEditorCache가 lockEpoch 증가)
	setEditorCache({ clientId: _clientId, name, leaseUntilMs: Date.now() + LEASE_SECONDS * 1000 });
	recomputeLock(get, set); // 낙관적 isEditor=true
	const epoch = lockEpoch;
	void dbBoardClaimEditor(getSessionId(), _clientId, name, LEASE_SECONDS).then((res) => {
		// 그 사이 handoff/resync/세션전환 등 권위적 변경이 있었으면 이 늦은 결과는 폐기(stale).
		if (epoch !== lockEpoch) return;
		if (res) {
			cachedEditor = {
				clientId: _clientId,
				name,
				leaseUntilMs: res.leaseUntil ? Date.parse(res.leaseUntil) : Date.now() + LEASE_SECONDS * 1000,
			};
			recomputeLock(get, set);
		} else {
			void get().resyncFromServer(); // 점유 실패 — 진짜 보유자/자유를 서버에서 다시 읽음
		}
	});
}

export function setCachedEditorFromRow(row: {
	editor_client_id?: string | null;
	editor_name?: string | null;
	editor_lease_until?: string | null;
}) {
	// 서버 row가 권위 — in-flight heartbeat .then 무효화(setEditorCache가 lockEpoch 증가)
	setEditorCache({
		clientId: row.editor_client_id ?? null,
		name: row.editor_name ?? null,
		leaseUntilMs: row.editor_lease_until ? Date.parse(row.editor_lease_until) : 0,
	});
}

/** 편집 락 lifecycle 설치(서버 권위 락) — 매 구독(subscribe)마다 호출해 DOM 핸들러를 재배선한다. */
export function installLockLifecycle(get: GetFn) {
	// sticky 소유 + 침묵 점유 폐기라 주기적 reeval 타이머는 불필요(자동 점유 없음).
	// 복귀(visible): 서버 권위로 재동기만 한다(놓친 broadcast/UPDATE 보정). 자동 점유는 하지 않는다 —
	// 편집자가 되려면 편집 동작(드래그)이나 '편집 권한 가져오기' 버튼이 필요하다.
	if (visibilityHandler) document.removeEventListener("visibilitychange", visibilityHandler);
	visibilityHandler = () => {
		if (document.hidden) return;
		void get().resyncFromServer({ indicate: true });
	};
	document.addEventListener("visibilitychange", visibilityHandler);
	// 정상 이탈(탭 닫기/이동): 편집 락 즉시 해제(editor_client_id=null → 남은 클라가 자유로 인식).
	// crash/강제종료면 해제가 안 나가 락이 붙잡히지만 "편집 권한 가져오기"(takeover)로 항상 회수 가능.
	if (pageHideHandler) window.removeEventListener("pagehide", pageHideHandler);
	pageHideHandler = () => {
		const { _clientId, isEditor } = get();
		if (isEditor && _clientId) void dbBoardReleaseEditor(getSessionId(), _clientId);
	};
	window.addEventListener("pagehide", pageHideHandler);
}

/** 편집 락 lifecycle 철거(unsubscribe) — DOM 핸들러 해제. */
export function teardownLockLifecycle() {
	if (visibilityHandler) {
		document.removeEventListener("visibilitychange", visibilityHandler);
		visibilityHandler = null;
	}
	if (pageHideHandler) {
		window.removeEventListener("pagehide", pageHideHandler);
		pageHideHandler = null;
	}
}
