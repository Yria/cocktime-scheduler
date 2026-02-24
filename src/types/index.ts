export type SkillLevel = "O" | "V" | "X";
export type Gender = "M" | "F";
export type GameType = "혼복" | "남복" | "여복" | "혼합";
export type PlayerStatus = "waiting" | "playing" | "resting" | "reserved";

export interface PlayerSkills {
	클리어: SkillLevel;
	스매시: SkillLevel;
	로테이션: SkillLevel;
	드랍: SkillLevel;
	헤어핀: SkillLevel;
	드라이브: SkillLevel;
	백핸드: SkillLevel;
}

/** 구글 시트에서 로드한 원본 선수 데이터 */
export interface Player {
	id: string;
	name: string;
	gender: Gender;
	skills: PlayerSkills;
}

/** 세션 내 참여 선수 (DB session_players 행) */
export interface SessionPlayer {
	id: string; // UUID (session_players.id)
	playerId: string; // 원본 player_id (Player.id)
	name: string;
	gender: Gender;
	skills: PlayerSkills;
	allowMixedSingle: boolean;
	status: PlayerStatus;
	forceMixed: boolean;
	forceHardGame: boolean;
	gameCount: number;
	mixedCount: number;
	waitSince: string | null;
}

/** 코트 내 현재 경기 */
export interface ActiveMatch {
	id: string; // UUID (matches.id)
	courtId: number;
	gameType: GameType;
	teamA: [SessionPlayer, SessionPlayer];
	teamB: [SessionPlayer, SessionPlayer];
	startedAt: string;
}

export interface Court {
	id: number;
	match: ActiveMatch | null;
}

/** 팀 구성 알고리즘 결과 */
export interface GeneratedTeam {
	teamA: [SessionPlayer, SessionPlayer];
	teamB: [SessionPlayer, SessionPlayer];
	gameType: GameType;
}

/** 파트너 이력 — session_players.id (UUID) 기반 */
export interface PairHistory {
	[sessionPlayerId: string]: Set<string>;
}

export interface ReservedGroup {
	id: string;
	memberIds: string[]; // session_players.id UUID[]
	readyIds: string[]; // 현재 대기 완료된 session_players.id
	players: SessionPlayer[]; // 클라이언트 편의용
}

export interface SessionSettings {
	courtCount: number;
	singleWomanIds: string[]; // Player.id (구글 시트 기반), 세션 시작 시 사용
}
