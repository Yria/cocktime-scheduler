import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useAppStore } from "../store/appStore";
import { useBoardStore } from "../store/boardStore";
import { useSessionStore } from "../store/sessionStore";
import { useBoardPlayerPool } from "./useBoardPlayerPool";
import { useCourtSig } from "./useBoardStageLayout";

// SessionBoard의 세션 동기화/편집권 부수효과 묶음(반환값 없음) — 풀 초기화, 원격 보드 멤버십 적용,
// 세션 Realtime 구독, 자동 편집권 점유, 불변식 I2 자가치유. 스토어 값은 훅 내부에서 직접 구독한다.
export function useSessionBoardEffects() {
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

	// (자동 점유 제거) 보드에 들어와도 편집자가 되지 않는다 — 보기 전용으로 시작하고, 편집은 직접
	// 드래그 편집(boardStore→claimEdit→claimEditingIfFree, 자유 락만) 또는 '편집 권한 가져오기'로만.
	// 연결만 하고 편집 안 하는 클라(상시 데스크탑 등)는 편집자가 되지 않는다(호깅/플래핑 방지).

	// ── 불변식 I2 자가 치유(편집자) — 코트 변화 시 경기중이 된 anchor를 예비팀에서 제거 + 영속화 ──
	// 경기 시작/로스터 편입으로 코트에 올라간 선수가 동시편집 레이스(유실된 dissolve)나 setMatchRoster
	// 경로(board_drafts 미변경)로 예비팀에 anchor로 남는 "팀에 있는데 게임중" 중복을 코트 변화 시점에 정리한다.
	// (뷰어는 applyRemoteDrafts→reconcile이 화면을 정제하므로 편집자만 호출 → 영속화로 모두 수렴.)
	const healPlayingAnchors = useBoardStore((s) => s.healPlayingAnchors);
	const courtSig = useCourtSig();
	useEffect(() => {
		if (isEditor) healPlayingAnchors();
	}, [courtSig, isEditor, healPlayingAnchors]);
}
