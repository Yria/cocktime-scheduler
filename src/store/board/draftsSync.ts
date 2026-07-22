import type { BoardDraftsPayload, DraftTeam, Reservation } from "../../types/board";
import { teamMembers } from "../../lib/board/membership";
import { effectiveForcedIds } from "../../lib/board/draftMutations";
import { dbBoardSaveDrafts } from "../../lib/supabase";
import { useSessionStore } from "../sessionStore";
import { useAppStore } from "../appStore";
import { toast } from "../toastStore";

/** draft 팀 createdBy 스탬프용 — 현재 편집자 표시 이름(sessionStore._myName). 미설정 시 폴백. */
export function currentEditorName(): string {
	return useSessionStore.getState()._myName ?? "익명";
}

// ── 보드 멤버십 공유(drafts/reservations) ────────────────────
// applyRemoteDrafts(matchSlice)와 boardStore.ts의 subscribe가 함께 읽고 쓰는 모듈 상태.
// ES 모듈 간에는 let 재대입이 공유되지 않으므로 객체 프로퍼티로 둔다.
export const syncState = {
	/** 원격 멤버십 적용 중에는 자체 브로드캐스트/저장을 막기 위한 플래그. */
	applyingRemoteDrafts: false,
	/** 마지막으로 동기화한 멤버십 JSON — 위치만 바뀐 변경(정렬 등)은 재브로드캐스트하지 않기 위함. */
	lastSyncedDraftsJson: "",
};

/** drafts/reservations 멤버십(+forcedIds 그룹표시·createdBy 생성자)만 직렬화(위치 제외). */
export function serializeBoardDrafts(s: {
	drafts: Map<string, DraftTeam>;
	reservations: Map<string, Reservation>;
}): BoardDraftsPayload {
	return {
		teams: [...s.drafts.values()].map((t) => {
			const memberIds = new Set(teamMembers(t.id, s.drafts, s.reservations).map((m) => m.playerId));
			const forcedIds = effectiveForcedIds(t, memberIds);
			// 슬롯은 현재 멤버(anchor+ghost) 것만 동기화 — 취소된 예약 등 스테일 키 제거.
			let slots: Record<string, number> | undefined;
			if (t.slots && Object.keys(t.slots).length) {
				const entries = Object.entries(t.slots).filter(([pid]) => memberIds.has(pid));
				if (entries.length) slots = Object.fromEntries(entries);
			}
			return {
				id: t.id,
				memberIds: [...t.anchorMemberIds],
				createdMs: t.createdAt,
				...(forcedIds.length ? { forcedIds } : {}),
				...(slots ? { slots } : {}),
				...(t.createdBy ? { createdBy: t.createdBy } : {}),
			};
		}),
		reservations: [...s.reservations.values()].filter((r) => s.drafts.has(r.teamId)).map((r) => ({
			id: r.id,
			playerId: r.playerId,
			teamId: r.teamId,
			createdMs: r.createdAt,
		})),
	};
}

/**
 * 편집 가능하면 true(= 내가 편집자). 자유(lockFree) 상태여도 드래그로 암묵 점유하지 않는다 — 편집권은
 * 오직 '편집 권한 가져오기' 버튼(자유면 다이얼로그 없이 즉시)이나 진입 1회 auto-claim(opener)으로만 획득한다.
 * 이래야 편집자가 나가 락이 free가 돼도 관전자가 드래그만으로 편집자가 되지 않는다.
 */
export function claimEdit(): boolean {
	return useSessionStore.getState().isEditor;
}

// board_drafts 저장 직렬화 — CAS(version) 자기충돌 방지. 진행 중이면 최신 payload만 큐잉(trailing).
let draftsSaveInFlight = false;
let pendingDraftsPayload: BoardDraftsPayload | null = null;

/**
 * 로컬 멤버십 변경을 board_save_drafts(낙관적 버전 CAS + self-claim)로 저장하고 broadcast.
 * - 성공: 새 version으로 sessionStore 갱신(연속 편집 base) + broadcast로 즉시성 제공.
 * - 충돌(null: version 불일치/락 상실): 서버 최신으로 resync(내 변경 폐기). 단일 편집자에선 드묾.
 * 원격 적용 중에는 호출 자체가 일어나지 않음(subscribe에서 applyingRemoteDrafts 가드).
 */
export function pushDraftsToRemote(payload: BoardDraftsPayload) {
	const ss = useSessionStore.getState();
	if (!ss.isEditor) return; // 보기 전용은 보드 드래프트를 공유하지 않음
	const sessionId = useAppStore.getState().sessionMeta?.sessionId;
	const clientId = ss._clientId;
	if (!sessionId || !clientId) return;
	if (draftsSaveInFlight) {
		pendingDraftsPayload = payload; // 진행 중 — 최신만 보관(이전 base가 stale해 자기충돌하는 것 방지)
		return;
	}
	draftsSaveInFlight = true;
	const name = ss._myName ?? "기기";
	const base = ss.boardDraftsVersion;
	void dbBoardSaveDrafts(sessionId, clientId, name, payload, base).then((newVersion) => {
		draftsSaveInFlight = false;
		const sess = useSessionStore.getState();
		if (newVersion == null) {
			// 충돌(version 불일치/락 상실) — 서버 권위로 수렴(미저장 로컬 변경은 되돌려짐).
			// force: resyncFromServer는 기본이 단조 게이팅(로컬 최신이면 안 덮음)이라, 롤백은 반드시 강제로
			// 서버값을 덮어야 한다(내 미저장 편집을 서버 최신으로 원복). 단일 편집자 모델에선 드물지만
			// (핸드오프/lease 만료 레이스) 조용한 유실 방지 위해 알린다.
			pendingDraftsPayload = null;
			void sess.resyncFromServer({ force: true });
			toast("편집 권한 충돌로 마지막 변경이 취소되고 최신 상태로 동기화했어요", { variant: "error" });
			return;
		}
		sess.applyDraftsIfNewer(payload, newVersion); // 내 버전 즉시 갱신(다음 저장 base)
		// board_drafts_updated broadcast 제거(Realtime 감축): 뷰어는 sessions-row UPDATE(postgres_changes,
		// board_drafts+version 동승)로 수렴 — broadcast는 그 권위 경로와 같은 버전 리듀서로 들어가던 중복 전송이었다.
		if (pendingDraftsPayload) {
			const next = pendingDraftsPayload;
			pendingDraftsPayload = null;
			pushDraftsToRemote(next); // 큐잉된 최신 변경을 새 base로 이어 저장
		}
	});
}
