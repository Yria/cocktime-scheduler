import { useEffect } from "react";
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

// body 스크롤 잠금 참조 카운트 — 중첩 시트(에디터 시트 위 PlaceLocationPicker 등)에서 인스턴스마다
// 개별 잠금/복원하면, 동시 언마운트 시 나중 cleanup이 "부모의 잠금 스타일"을 prev로 복원해
// 잠금이 영구 잔존한다. 첫 마운트만 잠그고 마지막 언마운트만 원본을 복원해 순서와 무관하게 안전.
let bodyLockCount = 0;
let bodyLockSnapshot: {
	scrollY: number;
	position: string;
	top: string;
	left: string;
	right: string;
	width: string;
	overflow: string;
} | null = null;

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
	// 모달 열림 동안 배경(body) 스크롤 잠금 — iOS PWA에서 모달 위 상하 드래그가 모달이 아니라 뒤 페이지를
	// 스크롤하던 문제 방지(position:fixed 트릭 + 닫을 때 스크롤 위치 복원). 시트엔 overscroll-contain으로 체이닝 차단.
	useEffect(() => {
		const { body } = document;
		if (bodyLockCount === 0) {
			bodyLockSnapshot = {
				scrollY: window.scrollY,
				position: body.style.position,
				top: body.style.top,
				left: body.style.left,
				right: body.style.right,
				width: body.style.width,
				overflow: body.style.overflow,
			};
			body.style.position = "fixed";
			body.style.top = `-${bodyLockSnapshot.scrollY}px`;
			body.style.left = "0";
			body.style.right = "0";
			body.style.width = "100%";
			body.style.overflow = "hidden";
		}
		bodyLockCount++;
		return () => {
			bodyLockCount--;
			if (bodyLockCount === 0 && bodyLockSnapshot) {
				body.style.position = bodyLockSnapshot.position;
				body.style.top = bodyLockSnapshot.top;
				body.style.left = bodyLockSnapshot.left;
				body.style.right = bodyLockSnapshot.right;
				body.style.width = bodyLockSnapshot.width;
				body.style.overflow = bodyLockSnapshot.overflow;
				window.scrollTo(0, bodyLockSnapshot.scrollY);
				bodyLockSnapshot = null;
			}
		};
	}, []);

	// Escape 닫기 — opt-in(closeOnEscape). 시트 내부에 포커스가 없어도 동작하도록 window 리스너 사용.
	// (기존 인라인 센터 모달들의 onKeyDown Escape 처리를 흡수하기 위한 것 — 기본 off 라 기존 사용처 불변)
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

	return (
		<div
			className={`fixed inset-0 lq-overlay flex ${posClass}`}
			style={{ zIndex }}
			onClick={onClose}
		>
			<div
				className={`lq-sheet w-full ${widthClass} rounded-3xl overflow-y-auto overscroll-contain no-sb ${className}`}
				style={{ maxHeight: "90dvh" }}
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
	);
}
