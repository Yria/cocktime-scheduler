import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Layer, Stage } from "react-konva";
import { useShallow } from "zustand/react/shallow";
import { useBoardDragHandlers } from "../../hooks/useBoardDragHandlers";
import { useBoardStageLayout } from "../../hooks/useBoardStageLayout";
import { useContainerSize } from "../../hooks/useContainerSize";
import { useSessionBoardEffects } from "../../hooks/useSessionBoardEffects";
import { useBoardStore } from "../../store/boardStore";
import { useSessionStore } from "../../store/sessionStore";
import { playingIdsFromCourts } from "../../lib/board/membership";
import { restZoneHeight } from "../../lib/board/geometry";
import {
	TOOLBAR_H,
	COURT_BAR_H,
	BG_BOARD,
	TEAM_W,
	TEAM_BOX_ABOVE,
} from "../../lib/board/constants";
import BoardToolbar from "./BoardToolbar";
import RestBar from "./RestBar";
import CourtMatchCard from "./CourtMatchCard";
import PlayerMagnet from "./PlayerMagnet";
import RestZonePanel from "./RestZonePanel";
import TeamBackground from "./TeamBackground";
import DetachZoneOverlay from "./DetachZoneOverlay";
import RestDropOverlay from "./RestDropOverlay";
import RecommendTeammateDialog from "./RecommendTeammateDialog";
import CockCheckModal from "./CockCheckModal";
import MatchEditModal from "./MatchEditModal";
import ViewerLockOverlay from "./ViewerLockOverlay";
import EditorTakenNotice from "./EditorTakenNotice";
import DebugMatchModal from "./DebugMatchModal";
import { ArrangeFab, BoardSyncingBadge, NewTeamFab, ZoomControls } from "./SessionBoardChrome";
import type { RecommendTarget } from "../../hooks/useTeammateRecommendations";

const COURT_CARD_GAP = 20;

// 보드 캔버스 좌우 안전 거터(화면 px). 모바일 브라우저 탭에서 화면 좌/우 가장자리는 OS의 '뒤로/앞으로'
// 스와이프 제스처 영역이라, 그 위에 놓인 자석을 잡으면 드래그 대신 페이지 네비게이션이 발동한다
// (touch-action:none 으로도 시스템 엣지 제스처는 못 막음). 캔버스를 가장자리에서 띄워 드래그 영역을
// 제스처 밴드 밖으로 보낸다. 거터 strip 은 같은 보드 배경색이라 시각적으로 이음매 없음. 줌과 무관(화면 px 고정).
const EDGE_GUTTER = 16;

export default function SessionBoard() {
	const stageContainerRef = useRef<HTMLDivElement | null>(null);
	const { w: cw, h: ch } = useContainerSize(stageContainerRef);
	const stageW = cw || 390;
	const stageH = ch || 600;

	// 줌·자동정렬 레이아웃(스케일/뷰포트/줌 핸들러/자동 fit) — useBoardStageLayout으로 분리.
	const { scale, setScale, viewW, viewH, arrangeAtCurrentScale, onStageWheel, onStageTouchMove, onStageTouchEnd } =
		useBoardStageLayout(stageW, stageH, cw, ch);
	// 세션 동기화/편집권 부수효과(풀 초기화·원격 멤버십 적용·Realtime 구독·자동 점유·I2 자가치유) — useSessionBoardEffects로 분리.
	useSessionBoardEffects();

	const courts = useSessionStore((s) => s.courts);
	const restingIds = useSessionStore((s) => s.restingIds);
	const playingIds = useMemo(() => playingIdsFromCourts(courts), [courts]);
	const occupiedCourts = useMemo(() => courts.filter((c) => c.match), [courts]);
	const hasEmptyCourt = useMemo(() => courts.some((c) => !c.match), [courts]);
	// isEditor — 추천 다이얼로그 차단 등에 사용(원격 멤버십 적용 effect는 useSessionBoardEffects에서 별도 구독).
	const isEditor = useSessionStore((s) => s.isEditor);

	// 휴식 필드(하단 바) — 바 탭으로 패널 열고 닫음. 자석을 끌어 내리면 휴식, 빼면 복귀.
	const restZoneOpen = useBoardStore((s) => s.restZoneOpen);
	const restFieldHot = useBoardStore((s) => s.restFieldHot);
	// 포어그라운드 복귀/재연결 시 서버 권위 재동기화 진행 표시.
	const boardSyncing = useSessionStore((s) => s.boardSyncing);
	// 팀 소속 자석을 드래그하는 동안에만 네비 영역 '팀에서 빼기' 드롭존 오버레이 노출
	const showDetach = useBoardStore((s) => s.dragInfo?.detachable ?? false);
	// 휴식 가능 자석을 드래그하는 동안에만 바텀 바 영역 '휴식하기' 드롭존 오버레이 노출(펼침 시엔 패널이 드롭존이라 제외)
	const showRest = useBoardStore((s) => s.dragInfo?.restable ?? false) && !restZoneOpen;
	const restingSet = useMemo(() => new Set(restingIds), [restingIds]);

	// 자유 자석: 팀 미소속(teamId null) && 경기중 아님
	const freeMagnetIds = useBoardStore(
		useShallow((s) => {
			const ids: string[] = [];
			for (const [id, m] of s.magnets) {
				if (m.teamId === null) ids.push(id);
			}
			return ids;
		}),
	);
	// 자유 자석: 경기중·휴식 제외(휴식 선수는 휴식존에만 노출, 추천·메인보드에서 안 보임)
	const visibleFreeIds = useMemo(
		() => freeMagnetIds.filter((id) => !playingIds.has(id) && !restingSet.has(id)),
		[freeMagnetIds, playingIds, restingSet],
	);

	const draftIds = useBoardStore(useShallow((s) => Array.from(s.drafts.keys())));

	// 추천 팀원 다이얼로그 대상: 빈 슬롯(+) → {teamId}, 자유 자석 탭 → {seedId}
	const [recommendTarget, setRecommendTarget] = useState<RecommendTarget | null>(null);
	// 경기 수정(선수 교체) 모달 대상 코트
	const [editMatchCourtId, setEditMatchCourtId] = useState<number | null>(null);
	const onEditMatch = useCallback(
		(courtId: number) => {
			if (!isEditor) return; // 보기 전용
			setEditMatchCourtId(courtId);
		},
		[isEditor],
	);

	const openTeamRecommend = useCallback(
		(teamId: string) => {
			if (!isEditor) return; // 읽기 모드 차단(opener는 진입 시 자동 점유로 editor)
			setRecommendTarget({ teamId });
		},
		[isEditor],
	);
	const onMagnetClick = useCallback(
		(playerId: string) => {
			if (!isEditor) return; // 읽기 모드 차단(opener는 진입 시 자동 점유로 editor)
			// 경기중 선수는 모달 없음(자유 자석은 비경기중이지만 안전하게 가드)
			if (playingIds.has(playerId)) return;
			setRecommendTarget({ seedId: playerId });
		},
		[playingIds, isEditor],
	);

	// 콕 제출 확인 다이얼로그 대상(편집자만). 자유 자석 비활성(콕 미확인) 탭 → 여기로(CockCheckModal).
	const [cockTarget, setCockTarget] = useState<string | null>(null);
	const onCockCheck = useCallback(
		(playerId: string) => {
			if (!isEditor) return; // 보기 전용 차단(공유 변경)
			setCockTarget(playerId);
		},
		[isEditor],
	);

	// ── 편집→보기 전환 시 진행 중 편집 액션 일괄 취소 ──────────────
	// 편집 권한을 잃으면(양도/탈취/lease 만료로 isEditor true→false) 띄워둔 편집 모달(추천/경기수정/콕확인)과
	// 드래그·배정중 부수상태를 모두 닫는다. prevIsEditor ref로 true→false 전이에서만 실행(마운트 false→false 무시).
	// (접속자 모달·휴식 패널은 뷰어도 쓰는 보기용이라 유지.)
	const cancelEditActions = useBoardStore((s) => s.cancelEditActions);
	const prevIsEditor = useRef(isEditor);
	useEffect(() => {
		if (prevIsEditor.current && !isEditor) {
			setRecommendTarget(null);
			setEditMatchCourtId(null);
			setCockTarget(null);
			cancelEditActions();
		}
		prevIsEditor.current = isEditor;
	}, [isEditor, cancelEditActions]);

	// 휴식 필드 높이 — 펼침이면 인원수만큼 여러 줄로 확장(패널과 동일 산식)해 패널 영역 전체가 드롭존,
	// 접힘이면 0 → 자석을 칠판 하단 경계 너머 바텀 바(RestBar)까지 내려야(논리 y ≥ viewH) 휴식한다.
	// 드롭 판정(useBoardDragHandlers)과 패널 렌더(RestZonePanel)가 같은 산식을 써 영역이 정확히 일치한다.
	const restFieldH = restZoneOpen ? restZoneHeight(restingIds.length, viewW, viewH) : 0;

	// 드래그/드롭 핸들러(휴식 hot 하이라이트·휴식 처리·자유 배치·예약 드롭)
	const { onMagnetDragMove, onMagnetDragEnd, onRestingDragEnd, onGhostDragEnd } =
		useBoardDragHandlers(viewH, restFieldH);

	// Stage 좌상단(0,0) 고정 — 줌 핸들러(휠/핀치)와 좌표 설명은 useBoardStageLayout 참조.
	const stageX = 0;
	const stageY = 0;

	const halfW = TEAM_W / 2;
	const courtCardY = TEAM_BOX_ABOVE + 8;

	// 풀스크린 셸: standalone PWA 에서 dvh/fixed 는 화면보다 짧으므로 .app-shell-h(lvh) 사용.
	// 자식이 position:absolute 라 positioned 조상으로 relative 를 둔다.
	return (
		<div
			className="app-shell-h"
			style={{ width: "100%", overflow: "hidden", background: BG_BOARD }}
		>
			<BoardToolbar />
			{/* 동기화 중 표시 — 포어그라운드 복귀/재연결 시 서버 권위 재동기화 동안 상단 중앙에 잠깐 노출. */}
			{boardSyncing && <BoardSyncingBadge />}
			{/* 드롭존 오버레이(칠판 밖 DOM) — 상단 '팀에서 빼기'는 네비 영역, 하단 '휴식하기'는 바텀 바 영역에 점선 박스+문구로 표시. */}
			{showDetach && <DetachZoneOverlay />}
			{showRest && <RestDropOverlay />}
			<div ref={stageContainerRef} style={{ position: "absolute", top: `calc(${TOOLBAR_H}px + env(safe-area-inset-top))`, left: `max(${EDGE_GUTTER}px, env(safe-area-inset-left))`, right: `max(${EDGE_GUTTER}px, env(safe-area-inset-right))`, bottom: `calc(${COURT_BAR_H}px + env(safe-area-inset-bottom, 0px))`, touchAction: "none" }}>
				<Stage
					width={stageW}
					height={stageH}
					scaleX={scale}
					scaleY={scale}
					x={stageX}
					y={stageY}
					onWheel={onStageWheel}
					onTouchMove={onStageTouchMove}
					onTouchEnd={onStageTouchEnd}
				>
					<Layer>
						{/* 드롭존 시각 표시는 칠판(Konva) 밖 DOM에서: 상단 '팀에서 빼기'는 네비 영역 오버레이
						    (DetachZoneOverlay), 하단 '휴식하기'는 바텀 바(RestBar) 점등. 칠판 안엔 밴드를 그리지 않는다. */}
						{draftIds.map((id) => (
							<TeamBackground
								key={id}
								teamId={id}
								hasEmptyCourt={hasEmptyCourt}
								playingIds={playingIds}
								onMagnetDragEnd={onMagnetDragEnd}
								onGhostDragEnd={onGhostDragEnd}
								onMagnetDragMove={onMagnetDragMove}
								onSlotClick={openTeamRecommend}
							/>
						))}
						{visibleFreeIds.map((id) => (
							<PlayerMagnet key={id} playerId={id} onDragEnd={onMagnetDragEnd} onDragMove={onMagnetDragMove} onClick={onMagnetClick} onCockCheck={onCockCheck} />
						))}
						{/* 코트 카드는 상단 레인에 맨 위로 렌더 — 경기완료 버튼이 항상 클릭 가능하도록 */}
						{occupiedCourts.map((c, i) => (
							<CourtMatchCard
								key={c.id}
								court={c}
								x={halfW + 12 + i * (TEAM_W + COURT_CARD_GAP)}
								y={courtCardY}
								onEditMatch={onEditMatch}
							/>
						))}
						{/* 휴식 패널 — 펼침(restZoneOpen) 시에만 stage에 렌더.
						    접힘 상태의 드래그 활성 피드백은 stage 밴드 없이 푸터(RestBar) 점등으로만 표현. */}
						{restZoneOpen && (
							<RestZonePanel
								stageW={viewW}
								stageH={viewH}
								restingIds={restingIds}
								restFieldHot={restFieldHot}
								onRestingDragEnd={onRestingDragEnd}
								onMagnetDragMove={onMagnetDragMove}
							/>
						)}
					</Layer>
				</Stage>
			</div>
			{/* 좌하단 + 버튼 — 빈 추천 모달을 열어 새 팀을 만든다(편집자만, 정렬 버튼과 대칭·동일 크기) */}
			{isEditor && !restZoneOpen && (
				<NewTeamFab onClick={() => setRecommendTarget({ newTeam: true })} />
			)}
			<RestBar />
			{/* 줌 컨트롤(우상단) — 0.5~1배 축소(편집/보기 공통) */}
			<ZoomControls setScale={setScale} />
			{/* 우하단 플로팅 정렬 버튼 — 휴식 패널 열림 시 숨김(겹침 방지) */}
			{!restZoneOpen && <ArrangeFab onClick={arrangeAtCurrentScale} />}
			{recommendTarget && (
				<RecommendTeammateDialog
					teamId={recommendTarget.teamId ?? undefined}
					seedId={recommendTarget.seedId ?? undefined}
					newTeam={recommendTarget.newTeam}
					onClose={() => setRecommendTarget(null)}
				/>
			)}
			{editMatchCourtId !== null && (
				<MatchEditModal courtId={editMatchCourtId} onClose={() => setEditMatchCourtId(null)} />
			)}
			{cockTarget && (
				<CockCheckModal playerId={cockTarget} onClose={() => setCockTarget(null)} />
			)}
			<ViewerLockOverlay />
			<EditorTakenNotice />
			<DebugMatchModal />
		</div>
	);
}
