export type SkillLevel = "O" | "V" | "X";
export type Gender = "M" | "F";
export type GameType = "혼복" | "남복" | "여복" | "혼합";

export interface PlayerSkills {
	클리어: SkillLevel;
	스매시: SkillLevel;
	로테이션: SkillLevel;
	드랍: SkillLevel;
	헤어핀: SkillLevel;
	드라이브: SkillLevel;
	백핸드: SkillLevel;
}

export interface Player {
	id: string;
	name: string;
	gender: Gender;
	skills: PlayerSkills;
}

export interface GeneratedTeam {
	teamA: [Player, Player];
	teamB: [Player, Player];
	gameType: GameType;
}

export interface Court {
	id: number;
	team: GeneratedTeam | null;
}

export interface PairHistory {
	[playerId: string]: Set<string>;
}

/** 혼복 출전 횟수 추적 — 남자 선수의 혼복 경험 균등 분배에 사용 */
export interface MixedHistory {
	[playerId: string]: number;
}

/** 경기 참여 횟수 추적 — 전체 경기수 균등 분배에 사용 */
export interface GameCountHistory {
	[playerId: string]: number;
}

export interface SessionSettings {
	courtCount: number;
	singleWomanIds: string[];
}

export interface ReservedGroup {
	id: string;
	players: Player[]; // 2-4 pre-selected players (waiting or on-court)
	readyIds: string[]; // player IDs currently in waiting (not on court)
}

export interface MatchRecord {
	id: string;
	courtId: number;
	team: GeneratedTeam;
	startTime: string;
	endTime?: string;
	status: "playing" | "completed";
}
