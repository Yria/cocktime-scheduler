import type {
	Court,
	GameType,
	Gender,
	PairHistory,
	PlayerSkills,
	PlayerStatus,
	SessionPlayer,
} from "../../types";

export interface SessionRow {
	id: number;
	is_active: boolean;
	court_count: number;
	started_at: string;
	ended_at: string | null;
	match_assign_count: number;
	board_drafts: import("../../types/board").BoardDraftsPayload | null;
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
}
