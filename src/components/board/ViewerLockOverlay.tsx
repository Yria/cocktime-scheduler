import { useSessionStore } from "../../store/sessionStore";
import { useBoardStore } from "../../store/boardStore";
import { TOOLBAR_H, COURT_BAR_H } from "../../lib/board/constants";

/**
 * 편집 잠금(보기 전용) 표시 — 다른 기기가 편집 권한 보유 중일 때만 노출.
 * 보드 콘텐츠 영역(헤더/푸터 제외) 둘레에 마젠타 글로우 프레임 + "보기 전용" 칩.
 * 색은 서비스에서 안 쓰는 마젠타/푸시아(경기중 주황·대기 초록·정렬 파랑·예약 보라·휴식 시안과 구분).
 *
 * 칩은 하단-중앙(코트 카드가 항상 차지하는 상단을 피해 겹침 방지)에 두고,
 * 누르면 헤더 칩과 동일한 편집권한 모달을 연다(presenceModalOpen 공유 플래그).
 * 프레임은 표시 전용(pointer-events:none), 칩 버튼만 클릭 가능.
 *
 * 패딩 상하좌우 균일(FRAME_PAD), 선 두께는 패딩에 비례(작은 패딩→얇은 선).
 */
const FRAME_PAD = 4; // 보드 가장자리에서 안쪽으로(콘텐츠 자석 가장자리 ~8px 보다 작게 둬 겹침 방지)
const BORDER = 2;
const FRAME_TOP = `calc(${TOOLBAR_H}px + env(safe-area-inset-top) + ${FRAME_PAD}px)`;
const FRAME_BOTTOM = `calc(${COURT_BAR_H}px + env(safe-area-inset-bottom, 0px) + ${FRAME_PAD}px)`;
const CHIP_BOTTOM = `calc(${COURT_BAR_H}px + env(safe-area-inset-bottom, 0px) + ${FRAME_PAD + 12}px)`;
const ACCENT = "217,70,239"; // #D946EF (fuchsia)

export default function ViewerLockOverlay() {
	const holderClientId = useSessionStore((s) => s.holderClientId);
	const myClientId = useSessionStore((s) => s._clientId);
	const openPresence = useBoardStore((s) => s.setPresenceModalOpen);

	// 다른 기기가 보유 중일 때만(자유/내가 보유 시 미노출, 초기 동기화 전 깜빡임 방지)
	const locked = holderClientId !== null && holderClientId !== myClientId;
	if (!locked) return null;

	return (
		<div style={{ position: "absolute", inset: 0, zIndex: 25, pointerEvents: "none" }}>
			{/* 보드 콘텐츠 영역(헤더/푸터 제외) 둘레 마젠타 글로우 프레임 — 상하좌우 균일 패딩 */}
			<div
				style={{
					position: "absolute",
					top: FRAME_TOP,
					bottom: FRAME_BOTTOM,
					left: FRAME_PAD,
					right: FRAME_PAD,
					borderRadius: 16,
					border: `${BORDER}px solid rgba(${ACCENT},0.9)`,
					boxShadow: `0 0 14px rgba(${ACCENT},0.45), inset 0 0 0 1px rgba(255,255,255,0.06)`,
					pointerEvents: "none",
				}}
			/>
			{/* 하단-중앙 "보기 전용" 칩 — 누르면 편집권한 모달(헤더 칩과 동일) */}
			<div
				style={{
					position: "absolute",
					bottom: CHIP_BOTTOM,
					left: 0,
					right: 0,
					display: "flex",
					justifyContent: "center",
					pointerEvents: "none",
				}}
			>
				<button
					type="button"
					onClick={() => openPresence(true)}
					style={{
						pointerEvents: "auto",
						display: "inline-flex",
						alignItems: "center",
						gap: 6,
						padding: "8px 15px",
						borderRadius: 999,
						border: "1px solid rgba(255,255,255,0.5)",
						background: "linear-gradient(180deg, #D946EF 0%, #A21CAF 100%)",
						color: "#fff",
						fontSize: 12,
						fontWeight: 800,
						whiteSpace: "nowrap",
						cursor: "pointer",
						boxShadow:
							"0 8px 20px rgba(140,20,150,0.5), inset 0 1px 0 rgba(255,255,255,0.55), inset 0 -1px 2px rgba(60,0,70,0.3)",
					}}
				>
					<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
						<rect x="3" y="11" width="18" height="10" rx="2" />
						<path d="M7 11V7a5 5 0 0 1 10 0v4" />
					</svg>
					<span>보기 전용</span>
				</button>
			</div>
		</div>
	);
}
