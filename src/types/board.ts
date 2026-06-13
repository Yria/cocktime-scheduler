export type StagePoint = { x: number; y: number };

/**
 * 자석 = 선수 1명의 물리적 토큰. teamId는 "원본(anchor) 소속" 단일 팀만 가리킨다.
 * 다중 예약(한 선수 여러 팀 동시 소속)은 여기에 담지 않고 Reservation으로 분리한다.
 */
export type MagnetPosition = {
	playerId: string; // === SessionPlayer.id (UUID)
	x: number;
	y: number;
	teamId: string | null; // 원본(anchor) 소속 팀 1개. null이면 자유 자석.
};

/**
 * 예비팀(보드 로컬). "경기중/대기" 상태는 보드가 소유하지 않고 sessionStore.courts에서 derive한다.
 * 따라서 DraftTeam에는 playing/queued/courtId/matchId가 없다.
 */
export interface DraftTeam {
	id: string;
	anchorMemberIds: string[]; // 이 팀을 원본 소속으로 가진 멤버 (magnet.teamId === this.id)
	anchor: StagePoint;
	createdAt: number;
}

/** 예약(ghost) — "이 선수를 이 예비팀에 빌려줌". 한 선수가 여러 개 가질 수 있다. */
export interface Reservation {
	id: string;
	playerId: string; // === SessionPlayer.id
	teamId: string; // ghost로 들어간 예비팀
	createdAt: number;
}

/**
 * 보드 drafts/reservations의 "멤버십"만 직렬화한 형태(위치 제외).
 * DB(sessions.board_drafts) 저장 + Realtime 브로드캐스트로 클라이언트 간 공유한다.
 * 위치(anchor x/y)는 각 클라이언트 로컬이므로 포함하지 않는다.
 */
export interface BoardDraftsPayload {
	teams: { id: string; memberIds: string[]; createdMs: number }[];
	reservations: { id: string; playerId: string; teamId: string; createdMs: number }[];
}

/** 선수 상태(파생). playing=코트 배치 / anchored=예비팀 원본 소속 / free=자유. */
export type PlayerLifecycle = "playing" | "anchored" | "free";

export type TeamMemberKind = "anchor" | "ghost";

/** 예비팀의 유효 멤버 1명 (anchor + 그 팀 향한 ghost를 합쳐 derive). */
export interface TeamMember {
	playerId: string;
	kind: TeamMemberKind;
	slot: number; // 0..3
}
