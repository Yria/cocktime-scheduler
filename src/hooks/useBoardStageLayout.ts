import { useCallback, useEffect, useRef } from "react";
import { useBoardStore, ZOOM_MIN, ZOOM_MAX } from "../store/boardStore";
import { useSessionStore } from "../store/sessionStore";
import { playingIdsFromCourts } from "../lib/board/membership";
import { computeFitScale } from "../lib/board/arrange";
import { TEAM_W, TEAM_BOX_BELOW, MAGNET_SIZE } from "../lib/board/constants";
import { flushBoardCamera } from "../lib/board/pixi/cameraBridge";
import { clampScale, initialBoardScale } from "../store/board/zoom";
import { readBoardLayout } from "../lib/board/savedLayout";

// 줌(축소 전용) — 0.4~1배. 상태/클램프/영속은 boardStore(scale·setScale)로 일원화(수동 줌·자동 fit 공용).
// arrange/drop·자석 이동범위는 보이는 논리영역(viewW×viewH=stage/scale) 기준이라 축소하면 그 범위도 비례 확대.

// 코트별 경기 선수 구성 — 경기 시작/완료로 매치가 바뀔 때만 달라진다(코트 위치는 미포함).
// 아래 자동정렬 effect와 불변식 I2 자가치유 effect(useSessionBoardEffects)가 공유하는 변화 감지 키.
export function useCourtSig() {
	return useSessionStore((s) =>
		s.courts
			.map((c) => (c.match ? `${c.id}:${c.match.teamA.join("")}/${c.match.teamB.join("")}` : `${c.id}:-`))
			.join("|"),
	);
}

// SessionBoard의 줌·자동정렬 레이아웃 훅. stageW/stageH는 기본값 보정된 캔버스 크기,
// cw/ch는 useContainerSize 원시 측정값(측정 전 0 — setStageSize 등록 가드에 사용).
export function useBoardStageLayout(stageW: number, stageH: number, cw: number, ch: number) {
	const initialViewApplied = useRef(false);
	// ── 줌 배율 + 보이는 논리 영역 ───────────────────────────
	// scale 0.4~1배 축소(Stage scale). 좌상단(0,0) 고정이라 보이는 논리 영역 = stage/scale.
	// 정렬(rearrange)은 이 viewW×viewH를 기준으로 좌상단부터 하단 한계까지 채운다(아래 정렬 effect·버튼 공용).
	// 줌 배율 — boardStore 공용 상태(수동 줌·자동 fit). viewW/viewH = stage/scale(보이는 논리 영역).
	const setScale = useCallback((value: number | ((prev: number) => number)) => {
		flushBoardCamera();
		const bs = useBoardStore.getState();
		const next = clampScale(typeof value === "function" ? value(bs.scale) : value);
		bs.commitBoardView({ scale: next, cssWidth: stageW, cssHeight: stageH, userChanged: next !== bs.scale });
	}, [stageW, stageH]);

	// 보이는 논리 영역(viewW×viewH = stage/scale)을 store에 등록 — 흩어짐/드롭 클램프 범위가
	// 줌(축소)에 따라 비율대로 커지도록(축소하면 보이는 영역이 넓어지고 자석 이동 가능 범위도 함께 넓어짐).
	useEffect(() => {
		if (cw <= 0 || ch <= 0) return;
		flushBoardCamera();
		const bs = useBoardStore.getState();
		const scale = !initialViewApplied.current && bs.userScale == null ? initialBoardScale(stageW) : bs.scale;
		initialViewApplied.current = true;
		// 기본 배율은 사용자 설정으로 저장하지 않는다. 직접 조정한 배율이 있으면 그것을 우선한다.
		bs.commitBoardView({ scale, cssWidth: stageW, cssHeight: stageH });
	}, [cw, ch, stageW, stageH]);

	const rearrangeAll = useBoardStore((s) => s.rearrangeAll);
	// 편집자가 직접 드래그로 배치를 시작했는지 — 그 전(첫 접근 포함)까지는 뷰어와 동일하게 자동 정렬한다.
	const manualLayout = useBoardStore((s) => s.manualLayout);
	const savedLayout = useSessionStore(s => s.boardDrafts.layout);
	useEffect(() => {
		const layout = readBoardLayout(savedLayout);
		if (!layout || cw <= 0 || ch <= 0) return;
		// 다른 화면에서 복원할 때는 좌표를 재배치하지 않고 배율만 줄인다.
		const groups = [...Object.values(layout.teams), ...Object.values(layout.courts)];
		const magnets = Object.values(layout.magnets);
		const extentX = Math.max(1, ...groups.map(point => point.x + TEAM_W / 2 + 12), ...magnets.map(point => point.x + MAGNET_SIZE / 2 + 8));
		const extentY = Math.max(1, ...groups.map(point => point.y + TEAM_BOX_BELOW + 12), ...magnets.map(point => point.y + MAGNET_SIZE / 2 + 8));
		flushBoardCamera();
		const bs = useBoardStore.getState();
		const scale = clampScale(Math.floor(Math.min(bs.scale, stageW / extentX, stageH / extentY) * 100) / 100);
		bs.commitBoardView({ scale, cssWidth: stageW, cssHeight: stageH });
	}, [savedLayout, stageW, stageH, cw, ch]);

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
	const courtSig = useCourtSig();
	// 자석 수 — 자동정렬 가드/트리거(원격 드래프트 적용 effect의 magnetCount와 별도 구독, zustand 셀렉터라 무해).
	const magnetCount = useBoardStore((s) => s.magnets.size);
	const previousGroupIds = useRef(new Set<string>());
	useEffect(() => {
		const bs = useBoardStore.getState();
		const added = [...bs.drafts.keys()].some(id => !previousGroupIds.current.has(id));
		previousGroupIds.current = new Set(bs.drafts.keys());
		if (!added || !bs.manualLayout || cw <= 0 || ch <= 0) return;
		// 정렬 후 새 행이 생겨도 그룹을 화면 밖에 숨기지 않는다. 기존 좌표는 유지하고 카메라만 축소한다.
		const groups = [...bs.drafts.values()];
		const width = Math.max(1, ...groups.map(team => team.anchor.x + TEAM_W / 2 + 12));
		const height = Math.max(1, ...groups.map(team => team.anchor.y + TEAM_BOX_BELOW + 12));
		const scale = clampScale(Math.floor(Math.min(bs.scale, stageW / width, stageH / height) * 100) / 100);
		if (scale >= bs.scale) return;
		flushBoardCamera();
		bs.commitBoardView({ scale, cssWidth: stageW, cssHeight: stageH });
	}, [membershipSig, cw, ch, stageW, stageH]);

	// 자동 스케일 + 정렬 — 렌더 없이 "다 들어가는 최대 배율"을 계산해 적용한 뒤 그 배율의 뷰로 정렬한다.
	// (자석이 화면을 넘치면 자동 축소, 여유 있으면 1배까지 키움 — "최대가 베스트"). 자동정렬 effect와 정렬 버튼 공용.
	// 카운트는 arrangeBoard와 동일 기준(그룹=경기중 코트+팀, 자유=teamId null·비경기중 — 휴식자도 보드에 남으므로 포함)으로 fresh 계산.
	const fitAndArrange = useCallback(() => {
		if (cw <= 0 || ch <= 0) return;
		flushBoardCamera();
		const bs = useBoardStore.getState();
		const ss = useSessionStore.getState();
		const playing = playingIdsFromCourts(ss.courts);
		let freeCount = 0;
		for (const m of bs.magnets.values()) {
			if (m.teamId === null && !playing.has(m.playerId)) freeCount++;
		}
		const groupCount = ss.courts.filter(c => c.match && ![...bs.drafts.values()].some(t => t.courtId === c.id)).length + bs.drafts.size;
		const fit = computeFitScale(stageW, stageH, groupCount, freeCount, {
			min: ZOOM_MIN,
			max: ZOOM_MAX,
			step: 0.05,
		});
		// 사용자가 맞춘 배율(userScale)은 **상한**으로만 존중한다 — 자동 확대는 하지 않고(맞춰둔 배율이
		// 매번 풀리던 문제), 내용이 그 배율에 안 들어가면 축소는 한다. 고정해 버리면 자유 자석이
		// 그룹 밴드 아래로 밀려 화면(stage) 밖으로 나가 통째로 안 보인다(실측: y=744 > stageH=700).
		// userScale 은 setAutoScale 이 건드리지 않으므로, 여유가 생기면 다시 그 배율로 복귀한다.
		const hasCourtGroups = [...bs.drafts.values()].some(team => team.courtId != null);
		const extentX = Math.max(1, ...[...bs.drafts.values()].map(team => team.anchor.x + TEAM_W / 2 + 12));
		const extentY = Math.max(1, ...[...bs.drafts.values()].map(team => team.anchor.y + TEAM_BOX_BELOW + 16))
			+ (freeCount ? (MAGNET_SIZE + 10) * Math.ceil(freeCount / Math.max(1, Math.floor(bs.stageW / (MAGNET_SIZE + 10)))) : 0);
		// 이미 놓인 코트의 실제 범위를 맞춘다. 격자로 다시 배치한다고 가정하면 아래쪽 코트가 잘린다.
		const preferredScale = bs.userScale ?? initialBoardScale(stageW);
		const target = hasCourtGroups ? Math.max(ZOOM_MIN, Math.min(bs.scale, preferredScale, fit, stageW / extentX, stageH / extentY))
			: Math.min(preferredScale, fit);
		bs.commitBoardView({ scale: target, cssWidth: stageW, cssHeight: stageH });
		rearrangeAll(stageW / target, stageH / target);
	}, [stageW, stageH, cw, ch, rearrangeAll]);

	// 정렬 버튼은 수동 줌을 초기화하고 3열 기본 배율로 정렬한다. 세로로 넘칠 때만 추가 축소한다.
	const arrangeAtCurrentScale = useCallback(() => {
		if (stageW <= 0 || stageH <= 0) return;
		flushBoardCamera();
		const bs = useBoardStore.getState();
		const ss = useSessionStore.getState();
		const playing = playingIdsFromCourts(ss.courts);
		const freeCount = [...bs.magnets.values()].filter(m => m.teamId === null && !playing.has(m.playerId)).length;
		const groupCount = bs.drafts.size + ss.courts.filter(c => c.match && ![...bs.drafts.values()].some(t => t.courtId === c.id)).length;
		const scale = computeFitScale(stageW, stageH, groupCount, freeCount, {
			min: ZOOM_MIN, max: initialBoardScale(stageW), step: 0.01,
		});
		bs.commitBoardView({ scale, cssWidth: stageW, cssHeight: stageH, userChanged: true });
		rearrangeAll(stageW / scale, stageH / scale, true);
	}, [stageW, stageH, rearrangeAll]);

	useEffect(() => {
		// 편집자가 직접 드래그 배치를 시작하기 전까지는 자동 정렬(뷰어는 manualLayout이 늘 false → 항상 자동).
		// 멤버십/코트/자석수/뷰포트가 바뀔 때마다 자동 스케일+정렬로 수렴. scale은 fitAndArrange가 직접 set하므로
		// deps에서 viewW/viewH(=stage/scale)를 빼 자기 set으로 인한 재실행 루프를 막는다(수동 줌도 여기서 안 건드림).
		// 복원 effect보다 먼저 실행되는 첫 렌더도 저장된 배치를 재정렬하지 않는다.
		if (manualLayout || useBoardStore.getState().manualLayout || readBoardLayout(useSessionStore.getState().boardDrafts.layout)) return;
		if (stageW <= 0 || stageH <= 0) return;
		if (magnetCount === 0 && !useBoardStore.getState().drafts.size) return; // 자석이 store에 채워진 뒤 — 빈 정렬 방지
		fitAndArrange();
	}, [manualLayout, membershipSig, courtSig, magnetCount, stageW, stageH, fitAndArrange]);

	return { setScale, arrangeAtCurrentScale };
}
