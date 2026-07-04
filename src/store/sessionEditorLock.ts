import {
	computeLockFromRow,
	detectEditorLoss,
	type EditorCache,
} from "../lib/editLock";
import { dbBoardClaimEditor, dbBoardReleaseEditor } from "../lib/supabase";
import { getSessionId, type GetFn, type SetFn } from "./sessionStoreState";

// ── 서버 권위 편집 락 생명주기 (presence 파생 폐기 — 원인2) ──────────────
// 편집 보유자는 sessions.editor_* 단일 row가 결정한다. 클라는 그 row를 cachedEditor에 캐시하고
// computeLockFromRow로 isEditor/holder/lockFree를 산정한다. heartbeat가 lease를 연장하고,
// reeval 타이머가 lease 만료(보유자 crash)를 로컬에서 감지해 lockFree로 떨군다.
export const LEASE_SECONDS = 20;
const HEARTBEAT_MS = 7000;
const REEVAL_MS = 4000;

let cachedEditor: EditorCache = { clientId: null, name: null, leaseUntilMs: 0 };
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let reevalTimer: ReturnType<typeof setInterval> | null = null;
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

/** 락 캐시 초기화(세션 경계/리셋) — lockEpoch 증가 포함. stopHeartbeat 호출은 호출부 책임. */
export function resetEditorCache() {
	lockEpoch++;
	cachedEditor = { clientId: null, name: null, leaseUntilMs: 0 };
}

/**
 * cachedEditor + 현재 시각으로 락 상태 재산정 + heartbeat 시작/정지 관리.
 * 편집자였다가 다른 사람에게 뺏긴 전이면 editorTakenBy(다이얼로그용)를 세팅한다.
 * suppressLossNotice=true(자발적 양도)면 그 알림을 띄우지 않는다.
 */
export function recomputeLock(get: GetFn, set: SetFn, opts?: { suppressLossNotice?: boolean }) {
	const myClientId = get()._clientId;
	const prevIsEditor = get().isEditor;
	const info = computeLockFromRow(cachedEditor, myClientId, Date.now());
	set(info);
	if (info.isEditor) startHeartbeat(get, set);
	else stopHeartbeat();
	if (info.isEditor) {
		// 내가 (다시) 편집자가 되면 떠 있던 뺏김 알림은 닫는다.
		if (get().editorTakenBy) set({ editorTakenBy: null });
	} else if (!opts?.suppressLossNotice) {
		const takenBy = detectEditorLoss(prevIsEditor, info, myClientId);
		if (takenBy) set({ editorTakenBy: takenBy });
	}
}

function startHeartbeat(get: GetFn, set: SetFn) {
	if (heartbeatTimer) return; // 이미 동작 중
	heartbeatTimer = setInterval(() => heartbeatTick(get, set), HEARTBEAT_MS);
	heartbeatTick(get, set); // 즉시 1회 — 실제 서버 락 획득/연장
}

export function stopHeartbeat() {
	if (heartbeatTimer) {
		clearInterval(heartbeatTimer);
		heartbeatTimer = null;
	}
}

/** lease 연장 RPC. 성공 시 cachedEditor 갱신, 실패(다른 사람이 유효 lease)면 서버 권위로 재동기화. */
function heartbeatTick(get: GetFn, set: SetFn) {
	const { _clientId, _myName } = get();
	if (!_clientId) return;
	const name = _myName ?? "기기";
	const epoch = lockEpoch; // 이 tick 발사 시점의 세대
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

/** 낙관적 점유 — cachedEditor를 나로 세팅 후 recomputeLock(→ heartbeat 즉시 실제 RPC). 충돌 시 heartbeat가 되돌림. */
export function claimNow(get: GetFn, set: SetFn) {
	const { _clientId, _myName } = get();
	if (!_clientId) return;
	// 권위적 변경 — in-flight heartbeat .then 무효화(setEditorCache가 lockEpoch 증가)
	setEditorCache({ clientId: _clientId, name: _myName ?? "기기", leaseUntilMs: Date.now() + LEASE_SECONDS * 1000 });
	recomputeLock(get, set);
}

/**
 * 혼자(접속자 ≤1) + 자유(아무도 편집 안 함) + 미편집이면 보기 전용 단계 없이 자동 점유.
 * lockFree 가드가 활성 편집자를 절대 안 뺏고(=남이 편집 중이면 점유 안 함), presenceCount 가드가
 * "혼자일 때만"을 보장한다. 멱등 — 이미 편집자/비자유면 no-op이라 반복 호출 안전.
 */
export function maybeClaimIfAlone(get: GetFn, set: SetFn) {
	const s = get();
	if (s.presenceCount <= 1 && s.lockFree && !s.isEditor && s._clientId) {
		claimNow(get, set);
	}
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

/** 편집 락 lifecycle 설치(서버 권위 락) — 매 구독(subscribe)마다 호출해 타이머/DOM 핸들러를 재배선한다. */
export function installLockLifecycle(get: GetFn, set: SetFn) {
	if (reevalTimer) clearInterval(reevalTimer);
	// lease 만료(보유자 crash, row update 없음)를 로컬 시계로 감지해 lockFree로 떨군다.
	// 떨군 직후 혼자뿐이면 자동 점유까지(직전 보유자가 나갔고 나 혼자 남은 경우 보기 전용 고착 방지).
	reevalTimer = setInterval(() => {
		recomputeLock(get, set);
		maybeClaimIfAlone(get, set);
	}, REEVAL_MS);
	// 백그라운드: heartbeat 멈춤(불필요 RPC 방지). 복귀 시에는 "낙관 선점" 대신 서버 권위로 먼저
	// 재동기화한다 — 백그라운드 동안 lease가 만료돼 다른 기기가 점유했을 수 있으므로, 무조건 claimNow하면
	// "두 명이 편집자"인 윈도우가 생긴다(직전 버그). resync 후 내가 여전히 보유자면 isEditor 유지(heartbeat
	// 재가동), 남이 점유했으면 보기 전용으로 정확히 떨어진다.
	if (visibilityHandler) document.removeEventListener("visibilitychange", visibilityHandler);
	visibilityHandler = () => {
		if (document.hidden) {
			stopHeartbeat();
			return;
		}
		// 복귀: 서버 권위로 재동기만. 자동 점유는 "혼자일 때만"(maybeClaimIfAlone, presenceCount<=1)으로 일원화한다.
		// 2명 이상이면 창 액티브만으로는 편집권을 자동으로 가져오지 않는다 — 인원수와 무관하게 자유 락을 낚아채
		// 다른 사람에게서 뺏기는 것처럼 보이던 재점유 경로 제거. 명시 점유(드래그 편집)/"편집 권한 가져오기"로만 편집자가 된다.
		void get().resyncFromServer({ indicate: true }).then(() => maybeClaimIfAlone(get, set));
	};
	document.addEventListener("visibilitychange", visibilityHandler);
	// 정상 이탈(탭 닫기/이동): 편집 락 즉시 해제 + heartbeat 정지(best-effort). crash/강제종료는 lease 만료가 백업.
	if (pageHideHandler) window.removeEventListener("pagehide", pageHideHandler);
	pageHideHandler = () => {
		const { _clientId, isEditor } = get();
		if (isEditor && _clientId) void dbBoardReleaseEditor(getSessionId(), _clientId);
		stopHeartbeat();
	};
	window.addEventListener("pagehide", pageHideHandler);
}

/** 편집 락 lifecycle 철거(unsubscribe) — reeval 타이머/DOM 핸들러 해제. stopHeartbeat 호출은 호출부 책임. */
export function teardownLockLifecycle() {
	if (reevalTimer) {
		clearInterval(reevalTimer);
		reevalTimer = null;
	}
	if (visibilityHandler) {
		document.removeEventListener("visibilitychange", visibilityHandler);
		visibilityHandler = null;
	}
	if (pageHideHandler) {
		window.removeEventListener("pagehide", pageHideHandler);
		pageHideHandler = null;
	}
}
