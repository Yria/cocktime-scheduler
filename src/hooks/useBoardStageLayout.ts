import { useCallback, useEffect, useRef } from "react";
import type Konva from "konva";
import { useBoardStore, ZOOM_MIN, ZOOM_MAX, ZOOM_STEP } from "../store/boardStore";
import { useSessionStore } from "../store/sessionStore";
import { playingIdsFromCourts } from "../lib/board/membership";
import { computeFitScale } from "../lib/board/arrange";

// 줌(축소 전용) — 0.5~1배. 상태/클램프/영속은 boardStore(scale·setScale)로 일원화(수동 줌·자동 fit 공용).
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
	// ── 줌 배율 + 보이는 논리 영역 ───────────────────────────
	// scale 0.5~1배 축소(Stage scale). 좌상단(0,0) 고정이라 보이는 논리 영역 = stage/scale.
	// 정렬(rearrange)은 이 viewW×viewH를 기준으로 좌상단부터 하단 한계까지 채운다(아래 정렬 effect·버튼 공용).
	// 줌 배율 — boardStore 공용 상태(수동 줌·자동 fit). viewW/viewH = stage/scale(보이는 논리 영역).
	const scale = useBoardStore((s) => s.scale);
	const setScale = useBoardStore((s) => s.setScale);
	const viewW = stageW / scale;
	const viewH = stageH / scale;

	// 보이는 논리 영역(viewW×viewH = stage/scale)을 store에 등록 — 흩어짐/드롭 클램프 범위가
	// 줌(축소)에 따라 비율대로 커지도록(축소하면 보이는 영역이 넓어지고 자석 이동 가능 범위도 함께 넓어짐).
	const setStageSize = useBoardStore((s) => s.setStageSize);
	useEffect(() => {
		if (cw > 0 && ch > 0) setStageSize(viewW, viewH);
	}, [cw, ch, viewW, viewH, setStageSize]);

	const rearrangeAll = useBoardStore((s) => s.rearrangeAll);
	// 편집자가 직접 드래그로 배치를 시작했는지 — 그 전(첫 접근 포함)까지는 뷰어와 동일하게 자동 정렬한다.
	const manualLayout = useBoardStore((s) => s.manualLayout);

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

	// 자동 스케일 + 정렬 — 렌더 없이 "다 들어가는 최대 배율"을 계산해 적용한 뒤 그 배율의 뷰로 정렬한다.
	// (자석이 화면을 넘치면 자동 축소, 여유 있으면 1배까지 키움 — "최대가 베스트"). 자동정렬 effect와 정렬 버튼 공용.
	// 카운트는 arrangeBoard와 동일 기준(그룹=경기중 코트+팀, 자유=teamId null·비경기중 — 휴식자도 보드에 남으므로 포함)으로 fresh 계산.
	const fitAndArrange = useCallback(() => {
		if (stageW <= 0 || stageH <= 0) return;
		const bs = useBoardStore.getState();
		const ss = useSessionStore.getState();
		const playing = playingIdsFromCourts(ss.courts);
		let freeCount = 0;
		for (const m of bs.magnets.values()) {
			if (m.teamId === null && !playing.has(m.playerId)) freeCount++;
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

	// 정렬 버튼(수동): 현재 줌은 그대로 두고 지금 보이는 화면 크기(viewW×viewH = stage/scale) 기준으로만 정렬한다.
	// fitAndArrange처럼 줌을 '다 들어가는 최대 배율'로 바꾸지 않으므로, 축소해 둔 상태에서 정렬해도 확대되지 않는다.
	const arrangeAtCurrentScale = useCallback(() => {
		if (stageW <= 0 || stageH <= 0) return;
		rearrangeAll(viewW, viewH, true); // 편집자면 manualLayout 켜서 이후 자동 fit이 축소 비율을 되돌리지 않게(정렬 결과 고정)
	}, [stageW, stageH, viewW, viewH, rearrangeAll]);

	useEffect(() => {
		// 편집자가 직접 드래그 배치를 시작하기 전까지는 자동 정렬(뷰어는 manualLayout이 늘 false → 항상 자동).
		// 멤버십/코트/자석수/뷰포트가 바뀔 때마다 자동 스케일+정렬로 수렴. scale은 fitAndArrange가 직접 set하므로
		// deps에서 viewW/viewH(=stage/scale)를 빼 자기 set으로 인한 재실행 루프를 막는다(수동 줌도 여기서 안 건드림).
		if (manualLayout) return;
		if (stageW <= 0 || stageH <= 0) return;
		if (magnetCount === 0) return; // 자석이 store에 채워진 뒤 — 빈 정렬 방지
		fitAndArrange();
	}, [manualLayout, membershipSig, courtSig, magnetCount, stageW, stageH, fitAndArrange]);

	// ── 줌 핸들러(휠/핀치) ───────────────────────────────────
	// Stage scale로 콘텐츠를 좌상단(0,0) 기준으로 축소(중앙 정렬 안 함 → 좌상단 좌표 고정). 논리 좌표는
	// 그대로라 정렬·드롭·휴식 판정은 기존과 동일(드래그 좌표는 PlayerMagnet의 absToStage로 복원). scale은 위에서 정의.
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

	return { scale, setScale, viewW, viewH, arrangeAtCurrentScale, onStageWheel, onStageTouchMove, onStageTouchEnd };
}
