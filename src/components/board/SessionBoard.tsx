import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Layer, Stage } from "react-konva";
import { useShallow } from "zustand/react/shallow";
import { useBoardPlayerPool } from "../../hooks/useBoardPlayerPool";
import { useContainerSize } from "../../hooks/useContainerSize";
import { useAppStore } from "../../store/appStore";
import { useBoardStore } from "../../store/boardStore";
import { useSessionStore } from "../../store/sessionStore";
import { playingIdsFromCourts } from "../../lib/board/membership";
import { TOOLBAR_H, COURT_BAR_H, BG_BOARD, TEAM_W, TEAM_BOX_ABOVE } from "../../lib/board/constants";
import BoardToolbar from "./BoardToolbar";
import CourtStatusBar from "./CourtStatusBar";
import CourtMatchCard from "./CourtMatchCard";
import PlayerMagnet from "./PlayerMagnet";
import TeamBackground from "./TeamBackground";
import RecommendTeammateDialog from "./RecommendTeammateDialog";
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
	const playingIds = useMemo(() => playingIdsFromCourts(courts), [courts]);
	const occupiedCourts = useMemo(() => courts.filter((c) => c.match), [courts]);
	const hasEmptyCourt = useMemo(() => courts.some((c) => !c.match), [courts]);

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
	const visibleFreeIds = useMemo(
		() => freeMagnetIds.filter((id) => !playingIds.has(id)),
		[freeMagnetIds, playingIds],
	);

	const draftIds = useBoardStore(useShallow((s) => Array.from(s.drafts.keys())));

	const handleDrop = useBoardStore((s) => s.handleDrop);
	const handleGhostDrop = useBoardStore((s) => s.handleGhostDrop);

	// 추천 팀원 다이얼로그 대상: 빈 슬롯(+) → {teamId}, 자유 자석 탭 → {seedId}
	const [recommendTarget, setRecommendTarget] = useState<RecommendTarget | null>(null);

	const openTeamRecommend = useCallback((teamId: string) => setRecommendTarget({ teamId }), []);
	const onMagnetClick = useCallback(
		(playerId: string) => {
			// 경기중 선수는 모달 없음(자유 자석은 비경기중이지만 안전하게 가드)
			if (playingIds.has(playerId)) return;
			setRecommendTarget({ seedId: playerId });
		},
		[playingIds],
	);

	// 자유 이동: 드롭한 자리에 그대로 둔다(자동 재배치/settle 없음). 정렬은 툴바 "정렬" 버튼으로만.
	const onMagnetDragEnd = useCallback(
		(playerId: string, cx: number, cy: number) => {
			handleDrop(playerId, { x: cx, y: cy });
		},
		[handleDrop],
	);

	const onGhostDragEnd = useCallback(
		(resId: string, cx: number, cy: number) => {
			handleGhostDrop(resId, { x: cx, y: cy });
		},
		[handleGhostDrop],
	);

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
							<PlayerMagnet key={id} playerId={id} onDragEnd={onMagnetDragEnd} onClick={onMagnetClick} />
						))}
						{/* 코트 카드는 상단 레인에 맨 위로 렌더 — 경기완료 버튼이 항상 클릭 가능하도록 */}
						{occupiedCourts.map((c, i) => (
							<CourtMatchCard
								key={c.id}
								court={c}
								x={halfW + 12 + i * (TEAM_W + COURT_CARD_GAP)}
								y={courtCardY}
							/>
						))}
					</Layer>
				</Stage>
			</div>
			<CourtStatusBar />
			{/* 우하단 플로팅 정렬 버튼 — 자석/팀을 화면에 재배치 */}
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
					gap: 6,
					height: 44,
					padding: "0 16px",
					borderRadius: 22,
					border: "none",
					background: "var(--ios-blue)",
					color: "#fff",
					fontSize: 13,
					fontWeight: 600,
					boxShadow: "0 6px 16px rgba(0, 122, 255, 0.4)",
					cursor: "pointer",
					zIndex: 20,
				}}
			>
				<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
					<path d="M3 6h18M3 12h12M3 18h6" />
				</svg>
				<span>정렬</span>
			</button>
			{recommendTarget && (
				<RecommendTeammateDialog
					teamId={recommendTarget.teamId ?? undefined}
					seedId={recommendTarget.seedId ?? undefined}
					onClose={() => setRecommendTarget(null)}
				/>
			)}
			<DebugMatchModal />
		</div>
	);
}
