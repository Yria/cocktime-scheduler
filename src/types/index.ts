export type Gender = "M" | "F";
export type GameType = "혼복" | "남복" | "여복" | "혼합";
export type PlayerStatus = "waiting" | "playing" | "resting";

/** 선수 실력 등급 (1~10 정수, 10이 가장 강함). */
export type SkillGrade = number;

/**
 * 선수 실력 — 단일 등급(1~10). 구 6종 스킬(클리어/스매시/…의 O·V·X) 모델을 대체.
 * DB에는 skills jsonb 로 `{ "grade": 7 }` 형태로 저장된다.
 */
export interface PlayerSkills {
	grade: SkillGrade;
}

/** 회원(members) 기반 선수 데이터. id = members.id(UUID), 세션 셋업 게스트는 guest-* id. */
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
	memberId: string | null; // 회원 링크(members.id). 세션 셋업 게스트는 null.
	name: string;
	gender: Gender;
	skills: PlayerSkills;
	allowMixedSingle: boolean;
	status: PlayerStatus;
	gameCount: number;
	mixedCount: number;
	waitSince: string | null;
	joinedAtMatch: number;
	/** 콕(셔틀콕) 제출 확인 여부. 콕체크 on일 때 false면 매칭 대기 아님(비활성). */
	cockChecked: boolean;
}

/** 코트 내 현재 경기 — teamA/B는 session_players.id 참조 */
export interface ActiveMatch {
	id: string; // UUID (matches.id)
	courtId: number;
	gameType: GameType;
	teamA: [string, string];
	teamB: [string, string];
	startedAt: string;
}

export interface Court {
	id: number;
	match: ActiveMatch | null;
}

/** 팀 구성 알고리즘 결과 — teamA/B는 session_players.id 참조 */
export interface GeneratedTeam {
	teamA: [string, string];
	teamB: [string, string];
	gameType: GameType;
	reason?: string;
}

/**
 * 동반 그룹 이력 항목 — 완료된 경기 1건의 4인 묶음.
 * matchId는 append 중복 방지(broadcast ↔ resync 레이스)와 resync 병합의 기준 키다.
 * members는 선수 삭제(FK SET NULL) 시 4명 미만일 수 있다.
 */
export interface GroupHistoryEntry {
	matchId: string;
	members: readonly string[];
}

/**
 * 동반 그룹 이력 — 완료된 경기 1건당 한 항목(순서 무관).
 * 완료된 matches 에서 파생되며(스냅샷 로드 + match_completed 누적 + resync 병합), 쌍 단위 누적(구 pair_history)을 대체한다.
 * 회피 단위는 "과거 경기 4인과 새 팀의 겹침 수": 2명(약) < 3명(중) < 4명 재결성(강) 순으로 벌점이 커진다.
 */
export type GroupHistory = readonly GroupHistoryEntry[];

export interface SessionSettings {
	courtCount: number;
	singleWomanIds: string[]; // Player.id (members.id 기반), 세션 시작 시 사용
	/** 콕 체크 모드 — on이면 선수가 콕 제출 확인을 받아야 매칭 대기 상태가 된다. 디폴트 on. */
	cockCheckEnabled: boolean;
}

/** 클럽 전역 설정(group_settings 싱글톤, 마이그레이션 20260630030000). 회원관리에서 편집. */
export interface GroupSettings {
	/** 세션 콕체크 1회당 남자가 내는 콕 수. */
	cockQuotaMale: number;
	/** 세션 콕체크 1회당 여자가 내는 콕 수. */
	cockQuotaFemale: number;
	/** 회원당 매달 콕 지원 수(그 달 첫 콕체크에서 차감). */
	cockSupportPerMonth: number;
}

/** group_settings 미로딩/부재 시 폴백 기본값(남2/여1/지원1). */
export const DEFAULT_GROUP_SETTINGS: GroupSettings = {
	cockQuotaMale: 2,
	cockQuotaFemale: 1,
	cockSupportPerMonth: 1,
};
