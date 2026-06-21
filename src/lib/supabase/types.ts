import type {
	Court,
	GameType,
	Gender,
	PairHistory,
	PlayerSkills,
	PlayerStatus,
	SessionPlayer,
} from "../../types";

export type SessionStatus =
	| "draft"
	| "open"
	| "active"
	| "closed"
	| "cancelled";

export interface SessionRow {
	id: number;
	is_active: boolean;
	court_count: number;
	started_at: string;
	ended_at: string | null;
	match_assign_count: number;
	board_drafts: import("../../types/board").BoardDraftsPayload | null;
	cock_check_enabled: boolean;
	// Phase 4: 일정화 (일정 = 세션)
	title: string | null;
	scheduled_at: string | null;
	capacity: number | null;
	place_id: number | null;
	status: SessionStatus;
	created_by: string | null;
	carpool_muster_place_id: number | null;
	carpool_muster_at: string | null;
}

export interface PlaceRow {
	id: number;
	name: string;
	address: string | null;
	lat: number | null;
	lng: number | null;
	default_court_count: number | null;
	is_active: boolean;
	created_by: string | null;
	created_at: string;
}

export interface SessionPlayerRow {
	id: string;
	session_id: number;
	player_id: string;
	name: string;
	gender: Gender;
	skills: PlayerSkills;
	allow_mixed_single: boolean;
	status: PlayerStatus;
	game_count: number;
	mixed_count: number;
	wait_since: string | null;
	joined_at: string;
	joined_at_match: number;
	cock_checked: boolean;
}

/** 경기 시점 선수 스냅샷(이름/성별/스킬) — matches.player_snapshot 배열 요소. 삭제된 선수 위치는 null. */
export interface PlayerSnapshotEntry {
	id: string;
	name: string;
	gender: Gender;
	skills: PlayerSkills;
}

export interface MatchRow {
	id: string;
	session_id: number;
	court_id: number;
	game_type: GameType;
	team_a_p1: string;
	team_a_p2: string;
	team_b_p1: string;
	team_b_p2: string;
	status: "playing" | "completed";
	started_at: string;
	ended_at: string | null;
	/** [team_a_p1, team_a_p2, team_b_p1, team_b_p2] 순서의 시점 스냅샷. 구 매치는 null. */
	player_snapshot: (PlayerSnapshotEntry | null)[] | null;
}

export interface PairHistoryRow {
	session_id: number;
	player_a: string;
	player_b: string;
	count: number;
}

export interface SessionSnapshot {
	session: SessionRow;
	players: SessionPlayer[];
	matches: MatchRow[];
	pairHistory: PairHistoryRow[];
}

export interface ClientSessionState {
	courts: Court[];
	players: SessionPlayer[];
	waitingIds: string[];
	restingIds: string[];
	pairHistory: PairHistory;
	matchAssignCount: number;
	/** session_player.id → 직전(또는 진행중) 경기의 게임 타입. 추천 로테이션 점수용. */
	lastGameType: Record<string, import("../../types").GameType>;
	/** 보드 "팀 구성중"/예약 멤버십(공유). 위치는 클라이언트 로컬에서 결정. */
	boardDrafts: import("../../types/board").BoardDraftsPayload;
	/** 콕 체크 모드 on/off(세션 설정). */
	cockCheckEnabled: boolean;
}
