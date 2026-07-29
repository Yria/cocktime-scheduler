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
	/**
	 * 운영진이 "드래그로 직접 묶은" 멤버 id (자동편성·추천 픽 제외). 2명 이상이면 "의도적 그룹".
	 * 실효값은 항상 현재 멤버와의 교집합으로 해석(멤버가 빠지면 자동 제외 — serialize/reconcile에서 필터).
	 */
	forcedIds?: string[];
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
	teams: { id: string; memberIds: string[]; createdMs: number; forcedIds?: string[]; slots?: Record<string, number>; createdBy?: string; confirmedMs?: number }[];
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
