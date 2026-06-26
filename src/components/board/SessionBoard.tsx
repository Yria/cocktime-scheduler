import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Layer, Stage } from "react-konva";
import type Konva from "konva";
import { useShallow } from "zustand/react/shallow";
import { useBoardDragHandlers } from "../../hooks/useBoardDragHandlers";
import { useBoardPlayerPool } from "../../hooks/useBoardPlayerPool";
import { useContainerSize } from "../../hooks/useContainerSize";
import { useAppStore } from "../../store/appStore";
import { useBoardStore, ZOOM_MIN, ZOOM_MAX, ZOOM_STEP } from "../../store/boardStore";
import { useSessionStore } from "../../store/sessionStore";
import { playingIdsFromCourts } from "../../lib/board/membership";
import { computeFitScale } from "../../lib/board/arrange";
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
import ModalSheet from "../common/ModalSheet";
import Spinner from "../shared/Spinner";
import MatchEditModal from "./MatchEditModal";
import ViewerLockOverlay from "./ViewerLockOverlay";
import DebugMatchModal from "./DebugMatchModal";
import type { RecommendTarget } from "../../hooks/useTeammateRecommendations";

const COURT_CARD_GAP = 20;

// 줌(축소 전용) — 0.5~1배. 상태/클램프/영속은 boardStore(scale·setScale)로 일원화(수동 줌·자동 fit 공용).
// arrange/drop·자석 이동범위는 보이는 논리영역(viewW×viewH=stage/scale) 기준이라 축소하면 그 범위도 비례 확대.

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

	// ── 줌 배율 + 보이는 논리 영역 ───────────────────────────
	// scale 0.5~1배 축소(Stage scale). 좌상단(0,0) 고정이라 보이는 논리 영역 = stage/scale.
	// 정렬(rearrange)은 이 viewW×viewH를 기준으로 좌상단부터 하단 한계까지 채운다(아래 정렬 effect·버튼 공용).
	// 줌 배율 — boardStore 공용 상태(수동 줌·자동 fit). viewW/viewH = stage/scale(보이는 논리 영역).
	const scale = useBoardStore((s) => s.scale);
	const setScale = useBoardStore((s) => s.setScale);
	const viewW = stageW / scale;
	const viewH = stageH / scale;

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

	// 보이는 논리 영역(viewW×viewH = stage/scale)을 store에 등록 — 흩어짐/드롭 클램프 범위가
	// 줌(축소)에 따라 비율대로 커지도록(축소하면 보이는 영역이 넓어지고 자석 이동 가능 범위도 함께 넓어짐).
	const setStageSize = useBoardStore((s) => s.setStageSize);
	useEffect(() => {
		if (cw > 0 && ch > 0) setStageSize(viewW, viewH);
	}, [cw, ch, viewW, viewH, setStageSize]);

	const rearrangeAll = useBoardStore((s) => s.rearrangeAll);
	// 편집자가 직접 드래그로 배치를 시작했는지 — 그 전(첫 접근 포함)까지는 뷰어와 동일하게 자동 정렬한다.
	const manualLayout = useBoardStore((s) => s.manualLayout);

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

	// 세션 연 사람을 자동으로 편집자로 — 자유 상태(아무도 편집 중이 아님)면 즉시 점유한다.
	// 남이 편집 중이면 claimEditingIfFree가 동작하지 않아(lockFree일 때만 점유) 읽기 모드로 시작.
	// 편집자가 이탈해 락이 풀리면(lockFree) 남은 클라가 다시 점유 → "아무도 편집하지 않는 상태"가 지속되지 않는다.
	// (서버 lease CAS가 진실 — 동시 점유 시 한쪽만 성공, 나머지는 resync로 읽기 모드 복귀.)
	const lockFree = useSessionStore((s) => s.lockFree);
	const clientId = useSessionStore((s) => s._clientId);
	const claimEditingIfFree = useSessionStore((s) => s.claimEditingIfFree);
	useEffect(() => {
		if (clientId && lockFree && !isEditor) claimEditingIfFree();
	}, [clientId, lockFree, isEditor, claimEditingIfFree]);

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
	// 자동 스케일 + 정렬 — 렌더 없이 "다 들어가는 최대 배율"을 계산해 적용한 뒤 그 배율의 뷰로 정렬한다.
	// (자석이 화면을 넘치면 자동 축소, 여유 있으면 1배까지 키움 — "최대가 베스트"). 자동정렬 effect와 정렬 버튼 공용.
	// 카운트는 arrangeBoard와 동일 기준(그룹=경기중 코트+팀, 자유=teamId null·비경기중·비휴식)으로 fresh 계산.
	const fitAndArrange = useCallback(() => {
		if (stageW <= 0 || stageH <= 0) return;
		const bs = useBoardStore.getState();
		const ss = useSessionStore.getState();
		const playing = playingIdsFromCourts(ss.courts);
		const resting = new Set(ss.restingIds);
		let freeCount = 0;
		for (const m of bs.magnets.values()) {
			if (m.teamId === null && !playing.has(m.playerId) && !resting.has(m.playerId)) freeCount++;
		}
		const groupCount = ss.courts.filter((c) => c.match).length + bs.drafts.size;
		const fit = computeFitScale(stageW, stageH, groupCount, freeCount, {
			min: ZOOM_MIN,
			max: ZOOM_MAX,
			step: 0.05,
		});
		setScale(fit); // store가 클램프·영속
		rearrangeAll(stageW / fit, stageH / fit);
	}, [stageW, stageH, rearrangeAll, setScale]);

	useEffect(() => {
		// 편집자가 직접 드래그 배치를 시작하기 전까지는 자동 정렬(뷰어는 manualLayout이 늘 false → 항상 자동).
		// 멤버십/코트/자석수/뷰포트가 바뀔 때마다 자동 스케일+정렬로 수렴. scale은 fitAndArrange가 직접 set하므로
		// deps에서 viewW/viewH(=stage/scale)를 빼 자기 set으로 인한 재실행 루프를 막는다(수동 줌도 여기서 안 건드림).
		if (manualLayout) return;
		if (stageW <= 0 || stageH <= 0) return;
		if (magnetCount === 0) return; // 자석이 store에 채워진 뒤 — 빈 정렬 방지
		fitAndArrange();
	}, [manualLayout, membershipSig, courtSig, magnetCount, stageW, stageH, fitAndArrange]);

	// ── 불변식 I2 자가 치유(편집자) — 코트 변화 시 경기중이 된 anchor를 예비팀에서 제거 + 영속화 ──
	// 경기 시작/로스터 편입으로 코트에 올라간 선수가 동시편집 레이스(유실된 dissolve)나 setMatchRoster
	// 경로(board_drafts 미변경)로 예비팀에 anchor로 남는 "팀에 있는데 게임중" 중복을 코트 변화 시점에 정리한다.
	// (뷰어는 applyRemoteDrafts→reconcile이 화면을 정제하므로 편집자만 호출 → 영속화로 모두 수렴.)
	const healPlayingAnchors = useBoardStore((s) => s.healPlayingAnchors);
	useEffect(() => {
		if (isEditor) healPlayingAnchors();
	}, [courtSig, isEditor, healPlayingAnchors]);

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

	// ── 줌 핸들러(휠/핀치) ───────────────────────────────────
	// Stage scale로 콘텐츠를 좌상단(0,0) 기준으로 축소(중앙 정렬 안 함 → 좌상단 좌표 고정). 논리 좌표는
	// 그대로라 정렬·드롭·휴식 판정은 기존과 동일(드래그 좌표는 PlayerMagnet의 absToStage로 복원). scale은 위에서 정의.
	const stageX = 0;
	const stageY = 0;
	const pinchDist = useRef(0);
	const onStageWheel = useCallback((e: Konva.KonvaEventObject<WheelEvent>) => {
		e.evt.preventDefault();
		setScale((s) => s + (e.evt.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP));
	}, [setScale]);
	const onStageTouchMove = useCallback((e: Konva.KonvaEventObject<TouchEvent>) => {
		const t = e.evt.touches;
		if (t.length !== 2) return; // 두 손가락 핀치만(한 손가락은 드래그)
		e.evt.preventDefault();
		const dist = Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
		if (pinchDist.current > 0) {
			const ratio = dist / pinchDist.current;
			setScale((s) => s * ratio);
		}
		pinchDist.current = dist;
	}, [setScale]);
	const onStageTouchEnd = useCallback(() => {
		pinchDist.current = 0;
	}, []);

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
			{boardSyncing && (
				<div
					style={{
						position: "absolute",
						top: `calc(${TOOLBAR_H}px + env(safe-area-inset-top) + 10px)`,
						left: "50%",
						transform: "translateX(-50%)",
						display: "inline-flex",
						alignItems: "center",
						gap: 7,
						padding: "6px 12px",
						borderRadius: 999,
						background: "rgba(15,23,42,0.82)",
						color: "#fff",
						fontSize: 12,
						fontWeight: 600,
						boxShadow: "0 4px 14px rgba(0,0,0,0.3)",
						zIndex: 30,
						pointerEvents: "none",
					}}
				>
					<Spinner size={13} />
					<span>동기화 중…</span>
				</div>
			)}
			{/* 드롭존 오버레이(칠판 밖 DOM) — 상단 '팀에서 빼기'는 네비 영역, 하단 '휴식하기'는 바텀 바 영역에 점선 박스+문구로 표시. */}
			{showDetach && <DetachZoneOverlay />}
			{showRest && <RestDropOverlay />}
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
				<button type="button" onClick={() => setScale((s) => s + ZOOM_STEP)} aria-label="확대" style={zoomBtnStyle}>＋</button>
				<button type="button" onClick={() => setScale((s) => s - ZOOM_STEP)} aria-label="축소" style={zoomBtnStyle}>－</button>
			</div>
				{/* 우하단 플로팅 정렬 버튼 — 휴식 패널 열림 시 숨김(겹침 방지) */}
			{!restZoneOpen && (
			<button
				type="button"
				onClick={fitAndArrange}
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
