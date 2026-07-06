import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePreventScroll } from "@react-aria/overlays";
import SheetHeader from "./SheetHeader";

interface ModalSheetProps {
	position?: "center" | "bottom";
	onClose?: () => void;
	className?: string;
	/** 지정 시 시트 상단에 SheetHeader(제목 + onClose 시 ✕ 칩) 렌더. 미지정 시 기존과 동일(헤더 없음) */
	title?: React.ReactNode;
	/** SheetHeader.subtitle — title 지정 시에만 유효 */
	subtitle?: React.ReactNode;
	/** SheetHeader.action(닫기 옆 커스텀 버튼) — title 지정 시에만 유효 */
	headerAction?: React.ReactNode;
	/** 오버레이 z-index (기본 50). 중첩 모달(실력 편집 70 위 확인 80 등)·다른 UI 위 강제 노출용 */
	zIndex?: number;
	/** 시트 최대 폭 (기본 "sm" = max-w-sm). 소형 확인 다이얼로그는 "xs" */
	maxWidth?: "xs" | "sm";
	/** Escape 키로 닫기(onClose 호출). 기본 false — 기존 사용처 동작 불변 */
	closeOnEscape?: boolean;
	children: React.ReactNode;
}

// 백드롭(blur+dim)이 덮을 문서 전체 높이. iOS 26 Safari 는 position:fixed 를 inner viewport 로
// 클리핑해 하단 세이프에어리어/주소창 영역까지 못 그린다. 그래서 백드롭은 fixed 가 아니라
// position:absolute 로 "문서 전체 높이"만큼 깔아야 클리핑을 피하고 blur 가 스트립까지 이어진다.
// (설치형 PWA 는 lvh 가 물리 화면보다 짧게 보고되므로 screen.height 를 하한으로 둔다.)
function measureDocHeight(): number {
	return Math.max(
		document.documentElement.scrollHeight,
		document.body?.scrollHeight ?? 0,
		window.innerHeight,
		window.screen?.height ?? 0,
	);
}

export default function ModalSheet({
	position = "bottom",
	onClose,
	className = "",
	title,
	subtitle,
	headerAction,
	zIndex = 50,
	maxWidth = "sm",
	closeOnEscape = false,
	children,
}: ModalSheetProps) {
	const sheetRef = useRef<HTMLDivElement>(null);
	const [docHeight, setDocHeight] = useState(0);

	// 배경 스크롤 잠금 — react-aria usePreventScroll. iOS 는 html overflow:hidden + touchmove 차단 +
	// overscroll @layer 주입 + 입력 포커스 스크롤 억제까지 처리(문서를 들어내지 않아 absolute 백드롭 안전).
	// 모달이 열릴 때만 마운트되므로 무조건 호출로 잠그고, 내부 참조 카운트로 중첩 모달도 안전.
	usePreventScroll();

	// 백드롭 높이 측정 — useLayoutEffect 로 페인트 전에 잡아 첫 프레임 깜빡임을 막는다.
	useLayoutEffect(() => {
		setDocHeight(measureDocHeight());
		const onResize = () => setDocHeight(measureDocHeight());
		window.addEventListener("resize", onResize);
		window.visualViewport?.addEventListener("resize", onResize);
		return () => {
			window.removeEventListener("resize", onResize);
			window.visualViewport?.removeEventListener("resize", onResize);
		};
	}, []);

	// Escape 닫기 — opt-in(closeOnEscape). 시트 내부에 포커스가 없어도 동작하도록 window 리스너 사용.
	useEffect(() => {
		if (!closeOnEscape || !onClose) return;
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") onClose();
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [closeOnEscape, onClose]);

	const posClass =
		position === "center"
			? "items-center justify-center px-6"
			: "items-end justify-center px-4 pb-6";
	const widthClass = maxWidth === "xs" ? "max-w-xs" : "max-w-sm";

	return createPortal(
		<>
			{/* 백드롭: position:absolute + 문서 전체 높이 → iOS 26 fixed 클리핑을 피해 스트립까지
			    backdrop-filter blur 가 이어진다. 배경(딤 영역) 클릭 시 닫기. */}
			<div
				className="lq-overlay"
				onClick={onClose}
				style={{
					position: "absolute",
					top: 0,
					left: 0,
					width: "100%",
					height: docHeight || "100%",
					zIndex,
				}}
			/>
			{/* 시트 컨테이너: visual viewport 안에 시트를 배치(시트는 세이프에어리어 위에 위치, 스트립엔
			    백드롭 blur 만 보인다). pointer-events:none 으로 딤 영역 클릭은 아래 백드롭으로 통과. */}
			<div
				className={`fixed inset-0 flex ${posClass}`}
				style={{ zIndex: zIndex + 1, pointerEvents: "none" }}
			>
				<div
					ref={sheetRef}
					className={`lq-sheet w-full ${widthClass} rounded-3xl overflow-y-auto overscroll-contain no-sb ${className}`}
					style={{ maxHeight: "90dvh", pointerEvents: "auto" }}
					onClick={(e) => e.stopPropagation()}
				>
					{title != null && (
						<SheetHeader
							title={title}
							subtitle={subtitle}
							onClose={onClose}
							action={headerAction}
						/>
					)}
					{children}
				</div>
			</div>
		</>,
		document.body,
	);
}
