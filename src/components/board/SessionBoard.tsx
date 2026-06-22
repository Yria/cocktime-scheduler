import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Layer, Stage } from "react-konva";
import type Konva from "konva";
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
import DetachZone from "./DetachZone";
import RecommendTeammateDialog from "./RecommendTeammateDialog";
import ModalSheet from "../common/ModalSheet";
import MatchEditModal from "./MatchEditModal";
import ViewerLockOverlay from "./ViewerLockOverlay";
import DebugMatchModal from "./DebugMatchModal";
import type { RecommendTarget } from "../../hooks/useTeammateRecommendations";

const COURT_CARD_GAP = 20;

// 줌(축소 전용) — 0.5~1배. arrange/drop은 논리 좌표(stageW×stageH 기준)라 줌과 무관하게 동작한다.
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 1;
const ZOOM_STEP = 0.1;
const clampScale = (v: number) => Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Math.round(v * 100) / 100));

const zoomBtnStyle: React.CSSProperties = {
	width: 36,
	height: 36,
	padding: 0,
	borderRadius: 18,
	border: "none",
	background: "rgba(30,41,59,0.85)",
	color: "#fff",
	fontSize: 20,
	fontWeight: 700,
	lineHeight: 1,
	display: "inline-flex",
	alignItems: "center",
	justifyContent: "center",
	cursor: "pointer",
	boxShadow: "0 2px 8px rgba(0,0,0,0.35)",
};

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

	// 공유된 보드 멤버십(스냅샷/원격) → 로컬 적용(위치는 로컬).
	const boardDrafts = useSessionStore((s) => s.boardDrafts);
	const applyRemoteDrafts = useBoardStore((s) => s.applyRemoteDrafts);
	const isEditor = useSessionStore((s) => s.isEditor);
	// 원인4 수정: 자석은 sessionPlayers에서 파생돼(useBoardPlayerPool→initializeFromPool) boardDrafts보다
	// 늦게 로드될 수 있다. 과거엔 magnets.size===0이면 영구 bail + deps=[boardDrafts]라, 자석이 뒤늦게
	// 채워져도 이 effect가 재실행되지 않아 관전자가 DB의 팀을 영영 못 그렸다(하드 새로고침해도 동일 — 원인4).
	// magnetCount를 deps에 넣어 자석 로드/증감(누락 멤버 합류 포함) 시점에 마지막 boardDrafts를 재적용한다.
	// (applyRemoteDrafts는 자석을 add/remove 안 하므로 magnetCount를 안 바꿔 재실행 루프 없음.)
	//
	// 편집자 보호(중요): broadcast self:false라 편집자의 sessionStore.boardDrafts는 자기 로컬 편집을 못 따라잡는
	// STALE 값이다(자기 변경은 자기에게 안 돌아옴). 따라서 magnetCount만 바뀐 재적용(선수 합류/이탈)을 편집자에게
	// 그대로 돌리면 방금 만든 팀이 STALE boardDrafts로 원복된다(데이터 손실). 그래서 "boardDrafts가 실제로 바뀐
	// 경우"(로드/원격 수신)는 모두에게 적용하되, "magnetCount만 바뀐 수렴 재적용"은 관전자에게만 한다.
	const magnetCount = useBoardStore((s) => s.magnets.size);
	const lastAppliedDraftsRef = useRef<typeof boardDrafts | null>(null);
	useEffect(() => {
		if (magnetCount === 0) return; // 자석 준비 전이면 보류 — 자석 로드 시 magnetCount 변화로 재실행되어 적용됨
		const draftsChanged = lastAppliedDraftsRef.current !== boardDrafts;
		if (!draftsChanged && isEditor) return; // 편집자: 멤버십 미수신 + magnetCount만 변한 재적용은 STALE 원복 위험 → 스킵
		lastAppliedDraftsRef.current = boardDrafts;
		applyRemoteDrafts(boardDrafts);
	}, [boardDrafts, applyRemoteDrafts, magnetCount, isEditor]);

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
	// isEditor는 위(보드 멤버십 적용 effect)에서 이미 구독 — 여기선 추천 다이얼로그 차단 등에 재사용.

	// ── 보기 전용 자동 정렬 ──────────────────────────────────
	// 뷰어는 직접 드래그/정렬을 못 하므로, 멤버십(팀·예약)이나 코트가 바뀔 때마다 rearrangeAll로
	// 레이아웃을 스스로 정돈한다. (편집자는 수동 배치가 진실의 원천이라 제외.)
	//
	// membershipSig/courtSig는 값을 "쓰는" 게 아니라 아래 useEffect의 의존성 배열에 넣는
	// **변화 감지용 트리거 키**다. 이 문자열이 달라질 때만 effect가 재실행 → rearrangeAll 호출.
	//
	// 왜 drafts/courts Map을 직접 의존성에 안 넣고 시그니처를 쓰나(중요 — 무한 루프 방지):
	//   rearrangeAll(→arrangeBoard)은 "위치"(magnet x/y, 팀 anchor, courtAnchors)만 바꾼다.
	//   drafts/magnets Map을 직접 의존성에 넣으면 정렬이 위치를 바꿔 ref가 새로 생기고 → effect 재실행
	//   → 또 정렬 → 무한 루프. 그래서 arrangeBoard가 건드리지 않는 값(멤버 구성 + 코트 매치)만으로
	//   시그니처를 만든다. 위치가 바뀌어도 이 문자열은 그대로라 "진짜 멤버십·코트 변경" 때만 정렬된다.
	const membershipSig = useBoardStore((s) => {
		// 팀별 멤버(anchorMemberIds) + 예약(playerId>teamId)만 — 위치(anchor.x/y)는 포함하지 않는다.
		let sig = "";
		for (const d of s.drafts.values()) sig += `${d.id}:${d.anchorMemberIds.join(",")}|`;
		sig += "#";
		for (const r of s.reservations.values()) sig += `${r.playerId}>${r.teamId},`;
		return sig;
	});
	// 코트별 경기 선수 구성 — 경기 시작/완료로 매치가 바뀔 때만 달라진다(코트 위치는 미포함).
	const courtSig = useSessionStore((s) =>
		s.courts
			.map((c) => (c.match ? `${c.id}:${c.match.teamA.join("")}/${c.match.teamB.join("")}` : `${c.id}:-`))
			.join("|"),
	);
	useEffect(() => {
		if (isEditor) return; // 편집자는 수동 배치가 진실의 원천 — 자동 정렬 안 함
		if (stageW <= 0 || stageH <= 0) return;
		rearrangeAll(stageW, stageH);
		// deps의 membershipSig/courtSig가 바로 위에서 설명한 "트리거 키"다.
	}, [isEditor, membershipSig, courtSig, stageW, stageH, rearrangeAll]);

	// 휴식 필드(하단 바) — 바 탭으로 패널 열고 닫음. 자석을 끌어 내리면 휴식, 빼면 복귀.
	const restZoneOpen = useBoardStore((s) => s.restZoneOpen);
	const restFieldHot = useBoardStore((s) => s.restFieldHot);
	// 팀 소속 자석을 드래그하는 동안에만 상단 '팀에서 빼기' 드롭존 노출
	const showDetach = useBoardStore((s) => s.dragInfo?.detachable ?? false);
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

	// 콕 제출 확인 다이얼로그 대상(편집자만). 자유 자석 비활성(콕 미확인) 탭 → 여기로.
	const confirmCock = useSessionStore((s) => s.confirmCock);
	const [cockTarget, setCockTarget] = useState<string | null>(null);
	const onCockCheck = useCallback(
		(playerId: string) => {
			if (!isEditor) return; // 보기 전용 차단(공유 변경)
			setCockTarget(playerId);
		},
		[isEditor],
	);

	// 드래그/드롭 핸들러(휴식 hot 하이라이트·휴식 처리·자유 배치·예약 드롭)
	const { onMagnetDragMove, onMagnetDragEnd, onRestingDragEnd, onGhostDragEnd } =
		useBoardDragHandlers(stageH, restZoneOpen);

	// ── 줌(0.5~1배 축소) ─────────────────────────────────────
	// Stage scale로 콘텐츠를 화면 중앙 기준 축소. 논리 좌표는 그대로라 정렬·드롭·휴식 판정은 기존과 동일
	// (드래그 좌표는 PlayerMagnet에서 absToStage로 논리 좌표 복원). 핀치(2손가락)·휠·버튼 지원.
	const [scale, setScale] = useState(1);
	const stageX = (stageW * (1 - scale)) / 2;
	const stageY = (stageH * (1 - scale)) / 2;
	const pinchDist = useRef(0);
	const onStageWheel = useCallback((e: Konva.KonvaEventObject<WheelEvent>) => {
		e.evt.preventDefault();
		setScale((s) => clampScale(s + (e.evt.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP)));
	}, []);
	const onStageTouchMove = useCallback((e: Konva.KonvaEventObject<TouchEvent>) => {
		const t = e.evt.touches;
		if (t.length !== 2) return; // 두 손가락 핀치만(한 손가락은 드래그)
		e.evt.preventDefault();
		const dist = Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
		if (pinchDist.current > 0) {
			const ratio = dist / pinchDist.current;
			setScale((s) => clampScale(s * ratio));
		}
		pinchDist.current = dist;
	}, []);
	const onStageTouchEnd = useCallback(() => {
		pinchDist.current = 0;
	}, []);

	const halfW = TEAM_W / 2;
	const courtCardY = TEAM_BOX_ABOVE + 8;

	return (
		<div style={{ position: "relative", width: "100%", height: "100dvh", overflow: "hidden", background: BG_BOARD }}>
			<BoardToolbar />
			<div ref={stageContainerRef} style={{ position: "absolute", top: `calc(${TOOLBAR_H}px + env(safe-area-inset-top))`, left: 0, right: 0, bottom: `calc(${COURT_BAR_H}px + env(safe-area-inset-bottom, 0px))`, touchAction: "none" }}>
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
						{/* '팀에서 빼기' 드롭존 — 배경 밴드(드래그 자석이 항상 위로). 드래그 중에만 노출 */}
						{showDetach && <DetachZone stageW={stageW} />}
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
			{/* 좌하단 + 버튼 — 빈 추천 모달을 열어 새 팀을 만든다(편집자만, 정렬 버튼과 대칭·동일 크기) */}
			{isEditor && !restZoneOpen && (
				<button
					type="button"
					onClick={() => setRecommendTarget({ newTeam: true })}
					aria-label="새 팀"
					style={{
						position: "absolute",
						left: 16,
						bottom: `calc(${COURT_BAR_H}px + env(safe-area-inset-bottom, 0px) + 16px)`,
						display: "inline-flex",
						alignItems: "center",
						justifyContent: "center",
						width: 44,
						height: 44,
						padding: 0,
						borderRadius: 22,
						border: "none",
						background: "var(--ios-green)",
						color: "#fff",
						boxShadow: "0 6px 16px rgba(52, 199, 89, 0.4)",
						cursor: "pointer",
						zIndex: 20,
					}}
				>
					<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
						<line x1="12" y1="5" x2="12" y2="19" />
						<line x1="5" y1="12" x2="19" y2="12" />
					</svg>
				</button>
			)}
			<RestBar />
			{/* 줌 컨트롤(우상단) — 0.5~1배 축소(편집/보기 공통) */}
			<div
				style={{
					position: "absolute",
					right: 16,
					top: `calc(${TOOLBAR_H}px + env(safe-area-inset-top) + 12px)`,
					display: "flex",
					flexDirection: "column",
					gap: 6,
					zIndex: 20,
				}}
			>
				<button type="button" onClick={() => setScale((s) => clampScale(s + ZOOM_STEP))} aria-label="확대" style={zoomBtnStyle}>＋</button>
				<button type="button" onClick={() => setScale((s) => clampScale(s - ZOOM_STEP))} aria-label="축소" style={zoomBtnStyle}>－</button>
			</div>
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
					newTeam={recommendTarget.newTeam}
					onClose={() => setRecommendTarget(null)}
				/>
			)}
			{editMatchCourtId !== null && (
				<MatchEditModal courtId={editMatchCourtId} onClose={() => setEditMatchCourtId(null)} />
			)}
			{cockTarget && (
				<ModalSheet position="center" className="p-6" onClose={() => setCockTarget(null)}>
					<h3 className="font-bold text-gray-800 dark:text-white text-lg mb-1.5">콕 제출 확인</h3>
					<p className="text-sm text-gray-600 dark:text-gray-300 mb-5">
						<b>{useSessionStore.getState().sessionPlayers.get(cockTarget)?.name ?? "이 선수"}</b> 님의 콕 제출을 확인했나요? 확인하면 매칭 대기 상태가 됩니다.
					</p>
					<div className="flex gap-3">
						<button type="button" onClick={() => setCockTarget(null)} className="btn-lq-secondary flex-1 py-3 text-sm">
							취소
						</button>
						<button
							type="button"
							onClick={() => {
								void confirmCock(cockTarget);
								setCockTarget(null);
							}}
							className="btn-lq-primary flex-1 py-3 text-sm"
						>
							확인
						</button>
					</div>
				</ModalSheet>
			)}
			<ViewerLockOverlay />
			<DebugMatchModal />
		</div>
	);
}
