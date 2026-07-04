import type { RealtimeChannel } from "@supabase/supabase-js";
import type { BroadcastPayload, ClientSessionState } from "../lib/supabase";
import type {
	Court,
	GameType,
	GeneratedTeam,
	GroupSettings,
	PairHistory,
	SessionPlayer,
} from "../types";
import type { BoardDraftsPayload } from "../types/board";
import { useAppStore } from "./appStore";

export function getSessionId(): number {
	return useAppStore.getState().sessionMeta?.sessionId ?? 0;
}

// ── Broadcast 핸들러 타입 ────────────────────────────────────
export type SetFn = (partial: Partial<SessionState> | ((state: SessionState) => Partial<SessionState>)) => void;
export type GetFn = () => SessionState;
// BroadcastPayload는 union 타입이라 ["payload"]로 직접 접근 불가 — unknown 사용
export type BroadcastPayloadData = Record<string, unknown>;

export interface SessionState {
	courts: Court[];
	sessionPlayers: Map<string, SessionPlayer>;
	waitingIds: string[];
	restingIds: string[];
	pairHistory: PairHistory;
	lastGameType: Record<string, GameType>;
	matchAssignCount: number;
	/** 보드 drafts/예약 멤버십(공유). 스냅샷에서 복원해 boardStore가 적용. */
	boardDrafts: BoardDraftsPayload;
	/** board_drafts 낙관적 동시성 버전 — 쓰기 CAS base + 수신 단조 가드 기준(원인3). */
	boardDraftsVersion: number;
	/** 코트 배정(matches) 동기화 단조 버전 — 수신 단조 가드 + 갭이면 refetchMatches 트리거. */
	matchStateVersion: number;
	/** 콕 체크 모드 on/off(세션 설정, 공유). on이면 cockChecked=false 선수는 매칭 대기 아님. */
	cockCheckEnabled: boolean;
	/** 클럽 전역 설정(콕 쿼터/월 지원량). 콕체크 모달의 지원 안내에 사용. 미로딩 시 null. */
	groupSettings: GroupSettings | null;

	// ── 편집 락(서버 권위 — sessions.editor_* row 기반, 원인2) ──────────────
	/** 편집 가능 여부(= 내가 유효 lease 보유자). false면 보기 전용. */
	isEditor: boolean;
	/** 현재 접속 기기 수. */
	presenceCount: number;
	/** 접속 기기 목록(이름) — 접속자 모달용. */
	presenceList: { clientId: string; name: string }[];
	/** 편집 권한 보유자 clientId(아무도 점유 안 했으면 null=자유). */
	holderClientId: string | null;
	/** 보유자 기기 이름. */
	holderName: string | null;
	/** 락이 비어있는지(아무도 점유 안 함). */
	lockFree: boolean;
	/** 편집권을 다른 사람에게 뺏겼을 때 그 사람 이름(다이얼로그 표시용). null=알림 없음. */
	editorTakenBy: string | null;

	/** 서버 권위 재동기화(resyncFromServer) 진행 중 — 포어그라운드 복귀/재연결 시 "동기화 중" 표시용. */
	boardSyncing: boolean;

	// Internal channel reference (not reactive)
	_channel: RealtimeChannel | null;
	_metaChannel: RealtimeChannel | null;
	/** 이 클라이언트의 presence 식별자. */
	_clientId: string | null;
	/** 이 기기 이름. */
	_myName: string | null;

	initialize: (initial: ClientSessionState) => void;
	reset: () => void;

	// DB Actions
	handleAssign: (team: GeneratedTeam, courtId: number) => Promise<void>;
	handleComplete: (courtId: number) => Promise<void>;
	/** 휴식 토글. resting=true 휴식 진입 / false 복귀(평균 판수 보정). player_updated 브로드캐스트. */
	setResting: (playerId: string, resting: boolean) => Promise<void>;
	/** 콕 제출 확인 — cock_checked=true로 매칭 대기 상태로 전환(공유, 편집자만). */
	confirmCock: (playerId: string) => Promise<void>;
	/** 경기 수정: 진행중 매치의 최종 로스터 설정(직접 DB 반영, 동기화 없음, 로컬만 갱신). */
	handleSetMatchRoster: (
		courtId: number,
		teamA: [string, string],
		teamB: [string, string],
	) => Promise<void>;
	handleEndSession: (onEnd: () => void) => Promise<void>;

	notifySessionRefresh: () => void;

	// 편집 락 — 명시적 점유(권한 가져오기) / 첫 편집 시 자유면 점유 / 보유자 본인의 명시 양도
	claimEditor: () => void;
	claimEditingIfFree: () => void;
	handoffEditor: (toClientId: string, toName: string) => Promise<void>;
	/** 편집권 뺏김 다이얼로그 닫기(editorTakenBy=null). */
	dismissEditorTakenNotice: () => void;
	/** board_drafts를 단조(새 버전만) 반영 — boardStore 저장 성공/충돌 복구에서 호출. */
	applyDraftsIfNewer: (drafts: BoardDraftsPayload, version: number) => void;
	/** 서버에서 board_drafts+버전+편집 락을 다시 읽어 수렴(충돌 복구·재구독 catch-up). */
	resyncFromServer: (opts?: { indicate?: boolean }) => Promise<void>;
	/**
	 * 진행중 matches 를 권위 재조회해 courts 를 수렴시킨다(코트 배정 catch-up).
	 * targetVersion 이 현재 matchStateVersion 이하면 멱등 skip(force=true 면 강제 — 재연결 복구용).
	 */
	refetchMatches: (targetVersion: number, force?: boolean) => Promise<void>;

	/** 선수 정보(성별/스킬 등) 변경을 로컬 반영 + 다른 클라이언트로 브로드캐스트. */
	broadcastPlayerUpdated: (player: SessionPlayer) => void;

	// Channel management
	subscribe: (sessionId: number, onEnd: () => void) => void;
	unsubscribe: () => void;
	applyBroadcast: (ev: BroadcastPayload) => void;
}

export const initialState = {
	courts: [] as Court[],
	sessionPlayers: new Map<string, SessionPlayer>(),
	waitingIds: [] as string[],
	restingIds: [] as string[],
	pairHistory: {} as PairHistory,
	lastGameType: {} as Record<string, GameType>,
	matchAssignCount: 0,
	boardDrafts: { teams: [], reservations: [] } as BoardDraftsPayload,
	boardDraftsVersion: 0,
	matchStateVersion: 0,
	cockCheckEnabled: true,
	groupSettings: null as GroupSettings | null,
	isEditor: false,
	presenceCount: 0,
	presenceList: [] as { clientId: string; name: string }[],
	holderClientId: null as string | null,
	holderName: null as string | null,
	lockFree: true,
	editorTakenBy: null as string | null,
	boardSyncing: false,
	_channel: null as RealtimeChannel | null,
	_metaChannel: null as RealtimeChannel | null,
	_clientId: null as string | null,
	_myName: null as string | null,
};
