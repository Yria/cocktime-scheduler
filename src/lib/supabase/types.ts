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
	// 보드 동기화 v2 (마이그레이션 20260622000000): 서버 권위 편집 락 + 낙관적 버전.
	// 편집 락 — "보유자" = editor_client_id != null && editor_lease_until > now(). presence 파생 대체.
	editor_client_id: string | null;
	editor_name: string | null;
	editor_lease_until: string | null;
	// board_drafts 낙관적 동시성(쓰기 CAS) + 수신측 단조성 가드 기준. DB NOT NULL DEFAULT 0.
	board_drafts_version: number;
	// 코트 배정(matches) 동기화 단조 우산(마이그레이션 20260622130000). 모든 매치 변경 RPC가 ++.
	// 수신측은 이 값이 자신이 아는 것보다 크면 matches 를 권위 재조회(catch-up). DB NOT NULL DEFAULT 0.
	match_state_version: number;
	// Phase 4: 일정화 (일정 = 세션)
	title: string | null;
	scheduled_at: string | null;
	ends_at: string | null; // 종료 시각(마이그레이션 20260622120000). 기존 데이터는 시작+3h 백필.
	capacity: number | null;
	place_id: number | null;
	status: SessionStatus;
	created_by: string | null;
	carpool_enabled: boolean; // 카풀 노출 on/off. on이면 참석자가 카풀 가능/필요 선택(20260622120000)
	// 반복 일정(마이그레이션 20260622010000): 규칙↔회차 연결 + 개별 수정 플래그
	recurring_schedule_id: number | null;
	occurrence_date: string | null; // YYYY-MM-DD (Asia/Seoul 달력 날짜)
	is_overridden: boolean;
	// 카풀 편성(공지 빌더, 마이그레이션 20260629010000). null=미편성.
	carpool_groups: CarpoolGroups | null;
	// 정모(정기모임) + 회원 열람용 안내/대진표(마이그레이션 20260630010000)
	is_regular: boolean; // 이 회차가 정모인가
	notice_md: string | null; // 회원에게 보여줄 본문(마크다운, GFM 표). 운영진 수동 작성.
}

/** 반복 일정 규칙 (요일 + 주차패턴 + 시간 + 인원 + 장소). 회차(sessions)를 자동 생성. */
export interface RecurringScheduleRow {
	id: number;
	day_of_week: number; // 0=일 .. 6=토
	week_ordinals: number[]; // 발생 주차 (매주=[1,2,3,4,5])
	include_last: boolean; // '마지막주' 포함
	start_time: string; // "19:00:00"
	end_time: string | null; // "22:00:00" (마이그레이션 20260622120000). 회차 ends_at 산출 기준.
	carpool_enabled: boolean; // 이 규칙으로 깔린 회차의 카풀 노출 on/off(20260622120000)
	capacity: number | null; // NULL=무제한
	place_id: number | null;
	is_active: boolean;
	created_by: string | null;
	created_at: string;
	updated_at: string;
}

export interface PlaceRow {
	id: number;
	name: string;
	address: string | null;
	lat: number | null;
	lng: number | null;
	is_active: boolean;
	created_by: string | null;
	created_at: string;
	// 지도 공유 링크(네이버/카카오) — 미리보기/길찾기 버튼용(마이그레이션 20260622020000)
	map_url: string | null;
}

export type AttendanceStatus = "confirmed" | "waitlisted" | "cancelled";
export type CarpoolRole = "none" | "can_drive" | "need_ride";

/** 카풀 편성(공지 빌더). sessions.carpool_groups jsonb. 탑승자 id는 한 그룹에만. */
export interface CarpoolGroup {
	driver_member_id: string;
	rider_member_ids: string[];
}
/** 마이그레이션 20260629010000. null=미편성. */
export interface CarpoolGroups {
	v: 1;
	groups: CarpoolGroup[];
	/** 공지 헤더 override(운영자 수정 시). null이면 세션정보로 자동 생성. */
	header?: string | null;
	/** 고정 안내문 override. null이면 기본 템플릿. */
	footer?: string | null;
}

export interface AttendanceRow {
	session_id: number;
	member_id: string;
	status: AttendanceStatus;
	position: number;
	carpool_role: CarpoolRole;
	carpool_seats: number | null;
	requested_at: string;
	confirmed_at: string | null;
	cancelled_at: string | null;
	updated_at: string;
	/** 게스트를 데려온 회원 id. 본인 참석은 null, null 아니면 그 회원이 신청한 게스트 행. */
	invited_by: string | null;
	/** fetchAttendances의 members 임베드(이름/게스트 여부/성별 표시용). */
	member?: { name: string; is_guest: boolean; gender: Gender | null } | null;
}

export interface NotificationRow {
	id: string;
	recipient_member_id: string;
	type: string;
	session_id: number | null;
	payload: Record<string, unknown> | null;
	read_at: string | null;
	sent: boolean;
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
	/** 경기 시작(편성)한 편집자 실명(마이그레이션 20260630020000). 구 매치/미전달은 null. */
	assigned_by: string | null;
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
	/** board_drafts 낙관적 동시성 버전(쓰기 CAS base + 수신 단조 가드). */
	boardDraftsVersion: number;
	/** 코트 배정(matches) 동기화 단조 버전(수신 단조 가드 + 갭 시 refetch 기준). */
	matchStateVersion: number;
	/** 콕 체크 모드 on/off(세션 설정). */
	cockCheckEnabled: boolean;
}
