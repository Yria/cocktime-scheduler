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
 * courtId가 있으면 해당 코트에 고정된 그룹이며, 경기 상태와 경기 ID는 sessionStore에서 파생한다.
 */
export interface DraftTeam {
	id: string;
	/** 코트에 고정된 그룹. 명단이 비거나 경기를 시작해도 유지한다. */
	courtId?: number;
	anchorMemberIds: string[]; // 이 팀을 원본 소속으로 가진 멤버 (magnet.teamId === this.id)
	anchor: StagePoint;
	createdAt: number;
	/**
	 * 멤버의 슬롯 위치(playerId → 0..3). 드롭한 칸에 정확히 배치(가운데 빈칸 허용)하기 위한 맵.
	 * 멤버십(anchorMemberIds)과 분리 — 없거나 매핑 안 된 멤버는 빈 슬롯을 순서대로 채움(하위호환).
	 */
	slots?: Record<string, number>;
	/**
	 * 이 그룹을 "만든" 편집자 표시 이름(sessionStore._myName 스냅샷). 기획상 "만든 시점"은 2명 이상이
	 * 사각형으로 묶이는 순간이며, 이후 다른 편집자가 새 멤버를 넣으면 그 사람으로 갱신된다
	 * (A가 2명 묶음 → by A, B가 1명 추가 → by B). 멤버 제거·팀내 슬롯 이동·ghost 승격은 갱신하지 않는다.
	 */
	createdBy?: string;
	/**
	 * 매칭확정 시각(epoch ms). undefined면 미확정. 확정 순서 = confirmedMs 오름차순(동률 시 id).
	 * 4명 미만으로 줄어들면 해제(clearConfirmIfBelowFull). 멤버 교체(스왑 등)로 4명이 유지되면 순번 보존.
	 */
	confirmedMs?: number;
	/** 빈 슬롯을 경기 완료 후 자동으로 채우는 예비팀. 특정 선수 예약과 별개다. */
	waitForCompletion?: boolean;
}

/** 예약(ghost) — "이 선수를 이 예비팀에 빌려줌". 한 선수가 여러 개 가질 수 있다. */
export interface Reservation {
	id: string;
	playerId: string; // === SessionPlayer.id
	teamId: string; // ghost로 들어간 예비팀
	createdAt: number;
}

/** 편집자가 확정한 보드 논리 좌표. 배율은 화면마다 다르므로 이 저장에 포함하지 않는다. */
export interface BoardLayoutPayload {
	version: 1;
	teams: Record<string, StagePoint>;
	courts: Record<string, StagePoint>;
	magnets: Record<string, StagePoint>;
}

/** 팀 명단·예약·배치를 sessions.board_drafts에 함께 저장한다. 구버전에는 layout이 없다. */
export interface BoardDraftsPayload {
	teams: { id: string; courtId?: number; memberIds: string[]; createdMs: number; slots?: Record<string, number>; createdBy?: string; confirmedMs?: number; waitForCompletion?: boolean }[];
	reservations: { id: string; playerId: string; teamId: string; createdMs: number }[];
	layout?: BoardLayoutPayload;
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
