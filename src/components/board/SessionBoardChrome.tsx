import { ZOOM_STEP } from "../../store/boardStore";
import { TOOLBAR_H, COURT_BAR_H } from "../../lib/board/constants";
import Spinner from "../shared/Spinner";

// SessionBoard의 DOM 크롬(플로팅 버튼·배지) 프레젠테이셔널 컴포넌트 묶음.
// 렌더 조건(boardSyncing / isEditor)은 SessionBoard 호출부에 유지한다.

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

// 동기화 중 표시 pill — 포어그라운드 복귀/재연결 시 서버 권위 재동기화 동안 상단 중앙에 잠깐 노출.
export function BoardSyncingBadge() {
	return (
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
	);
}

// 좌하단 + 버튼 — 빈 추천 모달을 열어 새 팀을 만든다(편집자만, 정렬 버튼과 대칭·동일 크기)
export function NewTeamFab({ onClick }: { onClick: () => void }) {
	return (
		<button
			type="button"
			onClick={onClick}
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
	);
}

// 줌 컨트롤(우상단) — 0.5~1배 축소(편집/보기 공통)
export function ZoomControls({ setScale }: { setScale: (v: number | ((prev: number) => number)) => void }) {
	return (
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
	);
}

// 우하단 플로팅 정렬 버튼 — 휴식 패널 열림 시 숨김(겹침 방지)
export function ArrangeFab({ onClick }: { onClick: () => void }) {
	return (
		<button
			type="button"
			onClick={onClick}
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
	);
}
