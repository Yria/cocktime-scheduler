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
	force_hard_game: boolean;
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

export interface TeamCandidateRow {
	id: string;
	session_id: number;
	queue_position: number;
	game_type: GameType;
	team_a_p1: string;
	team_a_p2: string;
	team_b_p1: string;
	team_b_p2: string;
	reason: string | null;
	strategy: string | null;
	is_new: boolean;
}

export interface SessionSnapshot {
	session: SessionRow;
	players: SessionPlayer[];
	matches: MatchRow[];
	pairHistory: PairHistoryRow[];
	teamCandidates: TeamCandidateRow[];
}

export interface ClientSessionState {
	courts: Court[];
	players: SessionPlayer[];
	waitingIds: string[];
	restingIds: string[];
	pairHistory: PairHistory;
	candidateTeams: import("../../types").GeneratedTeam[];
	matchQueue: import("../../types").GeneratedTeam[];
}
