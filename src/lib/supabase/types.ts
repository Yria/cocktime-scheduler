import type {
	Court,
	GameType,
	Gender,
	PairHistory,
	PlayerSkills,
	PlayerStatus,
	ReservedGroup,
	SessionPlayer,
} from "../../types";

export interface SessionRow {
	id: number;
	is_active: boolean;
	court_count: number;
	script_url: string | null;
	started_at: string;
	ended_at: string | null;
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
	force_mixed: boolean;
	game_count: number;
	mixed_count: number;
	wait_since: string | null;
	joined_at: string;
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

export interface ReservedGroupRow {
	id: string;
	session_id: number;
	member_ids: string[];
	ready_ids: string[];
	created_at: string;
}

export interface SessionSnapshot {
	session: SessionRow;
	players: SessionPlayer[];
	matches: MatchRow[];
	pairHistory: PairHistoryRow[];
	reservedGroups: ReservedGroupRow[];
}

export interface ClientSessionState {
	courts: Court[];
	waiting: SessionPlayer[];
	resting: SessionPlayer[];
	reservedGroups: ReservedGroup[];
	pairHistory: PairHistory;
}
