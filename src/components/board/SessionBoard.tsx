import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Layer, Stage } from "react-konva";
import { useShallow } from "zustand/react/shallow";
import { useBoardDragHandlers } from "../../hooks/useBoardDragHandlers";
import { useBoardPlayerPool } from "../../hooks/useBoardPlayerPool";
import { useContainerSize } from "../../hooks/useContainerSize";
import { useAppStore } from "../../store/appStore";
import { useBoardStore } from "../../store/boardStore";
import { useSessionStore } from "../../store/sessionStore";
import { playingIdsFromCourts } from "../../lib/board/membership";
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
import RecommendTeammateDialog from "./RecommendTeammateDialog";
import MatchEditModal from "./MatchEditModal";
import ViewerLockOverlay from "./ViewerLockOverlay";
import DebugMatchModal from "./DebugMatchModal";
import type { RecommendTarget } from "../../hooks/useTeammateRecommendations";

const COURT_CARD_GAP = 20;

export default function SessionBoard() {
	const stageContainerRef = useRef<HTMLDivElement | null>(null);
	const { w: cw, h: ch } = useContainerSize(stageContainerRef);
	const stageW = cw || 390;
	const stageH = ch || 600;

	const pool = useBoardPlayerPool();
	const init = useBoardStore((s) => s.initializeFromPool);
	useEffect(() => {
		init(pool);
	}, [pool, init]);

	// 공유된 보드 멤버십(스냅샷/원격) → 로컬 적용(위치는 로컬). boardDrafts가 바뀔 때만(로컬 편집은 안 건드림).
	const boardDrafts = useSessionStore((s) => s.boardDrafts);
	const applyRemoteDrafts = useBoardStore((s) => s.applyRemoteDrafts);
	useEffect(() => {
		if (useBoardStore.getState().magnets.size === 0) return; // 자석 준비 후
		applyRemoteDrafts(boardDrafts);
	}, [boardDrafts, applyRemoteDrafts]);

	// 실제 stage 크기를 store에 등록 — 흩어짐 바운더리 클램프용
	const setStageSize = useBoardStore((s) => s.setStageSize);
	useEffect(() => {
		if (cw > 0 && ch > 0) setStageSize(cw, ch);
	}, [cw, ch, setStageSize]);

	// 첫 진입 시 자동 정렬 1회 — 풀이 로드되고 stage 크기가 측정된 뒤 한 번만.
	// (위치는 boardStore 로컬 상태라 DB 동기화 없음. 한 세션에 한 번: hasArranged 플래그)
	const rearrangeAll = useBoardStore((s) => s.rearrangeAll);
	const hasArranged = useBoardStore((s) => s.hasArranged);
	useEffect(() => {
		if (hasArranged) return;
		if (cw <= 0 || ch <= 0) return; // 실제 크기 측정 대기
		if (pool.length === 0) return; // 풀(자석) 로드 대기
		rearrangeAll(cw, ch);
	}, [cw, ch, pool.length, hasArranged, rearrangeAll]);

	// 세션 Realtime 채널 구독 — 보드는 SessionMain 없이 단독 마운트되므로 직접 구독해야
	// handleAssign/handleComplete가 동작한다(_channel 필요). 없으면 경기시작/완료가 무반응.
	const navigate = useNavigate();
	const sessionId = useAppStore((s) => s.sessionMeta?.sessionId) ?? 0;
	const subscribe = useSessionStore((s) => s.subscribe);
	const unsubscribe = useSessionStore((s) => s.unsubscribe);
	useEffect(() => {
		subscribe(sessionId, () => navigate("/"));
		return () => unsubscribe();
	}, [sessionId, subscribe, unsubscribe, navigate]);

	const courts = useSessionStore((s) => s.courts);
	const restingIds = useSessionStore((s) => s.restingIds);
	const playingIds = useMemo(() => playingIdsFromCourts(courts), [courts]);
	const occupiedCourts = useMemo(() => courts.filter((c) => c.match), [courts]);
	const hasEmptyCourt = useMemo(() => courts.some((c) => !c.match), [courts]);
	const isEditor = useSessionStore((s) => s.isEditor); // 보기 전용이면 추천 다이얼로그 차단

	// 휴식 필드(하단 바) — 바 탭으로 패널 열고 닫음. 자석을 끌어 내리면 휴식, 빼면 복귀.
	const restZoneOpen = useBoardStore((s) => s.restZoneOpen);
	const restFieldHot = useBoardStore((s) => s.restFieldHot);
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
			if (!isEditor) return; // 보기 전용
			setRecommendTarget({ teamId });
		},
		[isEditor],
	);
	const onMagnetClick = useCallback(
		(playerId: string) => {
			if (!isEditor) return; // 보기 전용
			// 경기중 선수는 모달 없음(자유 자석은 비경기중이지만 안전하게 가드)
			if (playingIds.has(playerId)) return;
			setRecommendTarget({ seedId: playerId });
		},
		[playingIds, isEditor],
	);

	// 드래그/드롭 핸들러(휴식 hot 하이라이트·휴식 처리·자유 배치·예약 드롭)
	const { onMagnetDragMove, onMagnetDragEnd, onRestingDragEnd, onGhostDragEnd } =
		useBoardDragHandlers(stageH, restZoneOpen);

	const halfW = TEAM_W / 2;
	const courtCardY = TEAM_BOX_ABOVE + 8;

	return (
		<div style={{ position: "relative", width: "100%", height: "100dvh", overflow: "hidden", background: BG_BOARD }}>
			<BoardToolbar />
			<div ref={stageContainerRef} style={{ position: "absolute", top: `calc(${TOOLBAR_H}px + env(safe-area-inset-top))`, left: 0, right: 0, bottom: `calc(${COURT_BAR_H}px + env(safe-area-inset-bottom, 0px))` }}>
				<Stage width={stageW} height={stageH}>
					<Layer>
						{draftIds.map((id) => (
							<TeamBackground
								key={id}
								teamId={id}
								hasEmptyCourt={hasEmptyCourt}
								playingIds={playingIds}
								onMagnetDragEnd={onMagnetDragEnd}
								onGhostDragEnd={onGhostDragEnd}
								onSlotClick={openTeamRecommend}
							/>
						))}
						{visibleFreeIds.map((id) => (
							<PlayerMagnet key={id} playerId={id} onDragEnd={onMagnetDragEnd} onDragMove={onMagnetDragMove} onClick={onMagnetClick} />
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
								stageW={stageW}
								stageH={stageH}
								restingIds={restingIds}
								restFieldHot={restFieldHot}
								onRestingDragEnd={onRestingDragEnd}
								onMagnetDragMove={onMagnetDragMove}
							/>
						)}
					</Layer>
				</Stage>
			</div>
			<RestBar />
				{/* 우하단 플로팅 정렬 버튼 — 휴식 패널 열림 시 숨김(겹침 방지) */}
			{!restZoneOpen && (
			<button
				type="button"
				onClick={() => rearrangeAll(stageW, stageH)}
				aria-label="정렬"
				style={{
					position: "absolute",
					right: 16,
					bottom: `calc(${COURT_BAR_H}px + env(safe-area-inset-bottom, 0px) + 16px)`,
					display: "inline-flex",
					alignItems: "center",
					justifyContent: "center",
					width: 44,
					height: 44,
					padding: 0,
					borderRadius: 22,
					border: "none",
					background: "var(--ios-blue)",
					color: "#fff",
					boxShadow: "0 6px 16px rgba(0, 122, 255, 0.4)",
					cursor: "pointer",
					zIndex: 20,
				}}
			>
				<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
					<path d="M3 6h18M3 12h12M3 18h6" />
				</svg>
			</button>
			)}
			{recommendTarget && (
				<RecommendTeammateDialog
					teamId={recommendTarget.teamId ?? undefined}
					seedId={recommendTarget.seedId ?? undefined}
					onClose={() => setRecommendTarget(null)}
				/>
			)}
			{editMatchCourtId !== null && (
				<MatchEditModal courtId={editMatchCourtId} onClose={() => setEditMatchCourtId(null)} />
			)}
			<ViewerLockOverlay />
			<DebugMatchModal />
		</div>
	);
}
