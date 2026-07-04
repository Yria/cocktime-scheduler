import type { SessionPlayer } from "../../types";
import type { BoardDraftsPayload, DraftTeam, ForcedPair, MagnetPosition, Reservation, StagePoint } from "../../types/board";

/** 드래그-엔드 소스: 무엇을 놓았는지(자석/팀/코트). 흩어짐의 시작점이 된다. */
export type DragSource = { magnetId: string } | { teamId: string } | { courtId: number };

export type SettleState = {
	magnets: Map<string, MagnetPosition>;
	drafts: Map<string, DraftTeam>;
	courtAnchors: Map<number, StagePoint>;
	stageW: number;
	stageH: number;
};

export interface BoardState {
	magnets: Map<string, MagnetPosition>;
	drafts: Map<string, DraftTeam>;
	reservations: Map<string, Reservation>;
	/** 의도적 그룹(드래그로 묶음)이 경기 시작 시 기록하는 재편성 회피 쌍. board_drafts jsonb로 동기·영속(컬럼 추가 없음). */
	forcedPairs: ForcedPair[];
	assigningTeamIds: Set<string>;
	courtAnchors: Map<number, StagePoint>;
	/**
	 * 편집자가 직접 드래그로 자석/팀/코트를 배치했는지. true가 되면 자동 정렬을 멈춘다(수동 배치가 진실).
	 * false인 동안에는 뷰어와 동일하게 입력(자석 수·멤버십·뷰포트) 변화마다 재정렬 → 첫 접근 시 "정렬 버튼"
	 * 결과로 수렴한다. 세션 진입마다 reset(false). 추천 다이얼로그 편성(commitTeammates)은 위치 선택이 아니라
	 * 멤버십 변경이므로 manual로 치지 않는다(새 팀도 자동 정렬에 맡겨 그리드로 정돈).
	 */
	manualLayout: boolean;
	/** 실제 stage(보드 캔버스) 크기 — 흩어짐 바운더리 클램프용. SessionBoard가 갱신. */
	stageW: number;
	stageH: number;
	/** 휴식존(하단 패널) 표시 여부 — 플로팅 버튼으로 토글. */
	restZoneOpen: boolean;
	/** 드래그 중인 자석이 휴식 필드 위에 있는지(액티베이트 하이라이트용). */
	restFieldHot: boolean;
	/** 접속자/편집권한 모달 표시 — 헤더 칩 또는 보기전용 칩에서 연다. */
	presenceModalOpen: boolean;
	/**
	 * 드래그 중인 자석 정보(드롭존 표시·하이라이트용). null이면 드래그 안 함.
	 * - detachable=팀 소속(anchor/ghost) → 상단 '팀에서 빼기' 밴드 노출.
	 * - restable=휴식 가능(편집자의 free/anchor 대기 자석) → 하단 '휴식하기' 밴드 노출.
	 * - from=드래그 시작 논리좌표 → 출발 존(빼기/휴식)에서 같은 존으로의 드롭을 무효화하는 가드용.
	 */
	dragInfo: { playerId: string; detachable: boolean; restable: boolean; from: StagePoint } | null;
	/** 드래그 중 현재 겹침 대상(하이라이트). slot=팀의 특정 칸(빈칸/교체), magnet=페어 상대. */
	hoverTarget: { kind: "slot"; teamId: string; slotIndex: number } | { kind: "magnet"; id: string } | null;
	/** 드래그가 상단 '팀에서 빼기' 드롭존 위에 있는지(hot). */
	detachHot: boolean;

	initializeFromPool: (players: SessionPlayer[]) => void;
	handleDrop: (playerId: string, drop: StagePoint) => void;
	handleGhostDrop: (resId: string, drop: StagePoint) => void;
	handlePlayingMagnetDrop: (playerId: string, drop: StagePoint) => void;
	/**
	 * 추천 다이얼로그에서 다중 선택한 선수들을 팀에 한 번에 추가(4명 상한).
	 * target.teamId가 있으면 그 팀에, target.seedId만 있으면 시드를 첫 멤버로 새 팀을 만들어 추가.
	 * 경기중 선수는 예약(ghost), 그 외는 정식 멤버(anchor).
	 */
	commitTeammates: (target: { teamId?: string; seedId?: string; newTeam?: boolean }, playerIds: string[]) => void;
	/**
	 * 자동편성 — 구성 중 팀(teamId)의 빈 슬롯을 추천도 높은순으로 채운다(대기 선수만, 4명 상한).
	 * 한 명 추가할 때마다 알고리즘을 다시 돌려 다음 추천 1명을 뽑는 greedy 방식.
	 */
	autoFillTeam: (teamId: string) => void;
	/** 추천 모달의 "자동편성" — 팀/시드/새팀 대상의 나머지를 대기 선수로 채워 commit. extraIds=사용자 직접 선택분. */
	autoFillTarget: (
		target: { teamId?: string; seedId?: string; newTeam?: boolean },
		extraIds?: string[],
	) => void;
	/** "고정배치" 토글 — 누르는 시점의 현재 멤버 전체를 🔒 잠금(재편성 회피 대상). 이미 잠겨있으면 해제. 시각/코스트만, 실제 락 아님(드래그로 빼서도 취소). */
	toggleForced: (teamId: string) => void;
	setTeamAnchor: (teamId: string, x: number, y: number) => void;
	setCourtAnchor: (courtId: number, x: number, y: number) => void;
	/** 실제 stage 크기 등록(흩어짐 바운더리용) */
	setStageSize: (w: number, h: number) => void;
	/** 보드 줌 배율(0.5~1). 수동 줌·자동 fit 공용. */
	scale: number;
	/** 줌 배율 설정(클램프 + localStorage 영속). 함수형 업데이트 지원. */
	setScale: (v: number | ((prev: number) => number)) => void;
	/** 드래그-엔드 후 소스(팀/코트)에서 겹친 자유 자석을 흩어지게 */
	settleBoard: (source: DragSource) => void;
	/** 공유된 보드 멤버십(payload)을 로컬에 적용(위치는 로컬에서 결정). 스냅샷/브로드캐스트 수신용. */
	applyRemoteDrafts: (payload: BoardDraftsPayload) => void;
	/**
	 * 불변식 I2 자가 치유(편집자 전용) — 경기중이 된 anchor를 모든 예비팀에서 제거하고, 그 결과 인원이
	 * 부족해진 팀은 해체한다. 코트 변화(courtSig) 시 SessionBoard가 호출한다. 변경이 생기면 subscribe가
	 * board_drafts로 영속화 → 모든 클라이언트가 수렴(유실된 dissolve / 로스터 편입 레이스 복구).
	 * assigning(경기시작 진행중) 팀은 startMatch가 직접 dissolve+위치 인계하므로 건드리지 않는다.
	 */
	healPlayingAnchors: () => void;
	/** 편집 권한 상실(편집→보기) 시 진행 중 편집 부수상태(드래그/배정중)를 일괄 취소. */
	cancelEditActions: () => void;
	/** 지정한 자석들을 소스로 방사형 흩어짐 + 정리(경기 완료로 그룹 해제된 자석용) */
	scatterMagnets: (ids: string[]) => void;
	rearrangeAll: (viewW: number, viewH: number) => void;
	/** 휴식존 표시 토글. */
	toggleRestZone: () => void;
	/** 휴식 패널 접기(멱등) — 보드 자석 드래그 시작 시 가림 해소용. */
	closeRestZone: () => void;
	/** 휴식 필드 액티베이트(hot) 상태 설정. */
	setRestFieldHot: (hot: boolean) => void;
	/** 드래그 시작/종료 시 드래그 정보 설정(null=종료). */
	setDragInfo: (info: { playerId: string; detachable: boolean; restable: boolean; from: StagePoint } | null) => void;
	/** 드래그 중 겹침 대상 하이라이트 설정(변화 시에만 반영). */
	setHoverTarget: (t: { kind: "slot"; teamId: string; slotIndex: number } | { kind: "magnet"; id: string } | null) => void;
	/** '팀에서 빼기' 드롭존 hot 설정(변화 시에만 반영). */
	setDetachHot: (hot: boolean) => void;
	/** 드래그 종료 — dragInfo/hoverTarget/detachHot 일괄 초기화. */
	clearDrag: () => void;
	/** 멤버를 팀에서 빼 자유 자석으로(드롭존). drop 위치에 두고 흩어짐. */
	detachMember: (playerId: string, drop: StagePoint) => void;
	/** 예약(ghost) 취소(드롭존). */
	cancelReservation: (resId: string) => void;
	/** 선수를 보드 그룹에서 제거(추천 모달 더블탭): ghost면 예약 취소, anchor면 팀에서 빼 자유 자석으로. */
	removeMemberFromBoard: (playerId: string) => void;
	/** 접속자/편집권한 모달 표시 토글. */
	setPresenceModalOpen: (open: boolean) => void;
	/** 선수를 휴식 처리(보드 멤버십에서 제거 + status='resting'). */
	restPlayer: (playerId: string) => void;
	/** 휴식 선수를 복귀(status='waiting', 평균 판수 보정) + 자유 자석으로 drop 위치에 배치. */
	unrestPlayer: (playerId: string, drop: StagePoint) => void;
	startMatch: (teamId: string) => Promise<void>;
	completeMatch: (courtId: number) => Promise<void>;
	/** 경기 수정: 진행중 매치의 최종 로스터 설정(빠진 선수는 자유 자석으로 흩어짐). */
	setMatchRoster: (
		courtId: number,
		teamA: [string, string],
		teamB: [string, string],
	) => Promise<void>;
	reset: () => void;
}
