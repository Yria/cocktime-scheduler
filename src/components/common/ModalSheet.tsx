import { useEffect } from "react";

interface ModalSheetProps {
	position?: "center" | "bottom";
	onClose?: () => void;
	className?: string;
	children: React.ReactNode;
}

export default function ModalSheet({
	position = "bottom",
	onClose,
	className = "",
	children,
}: ModalSheetProps) {
	// 모달 열림 동안 배경(body) 스크롤 잠금 — iOS PWA에서 모달 위 상하 드래그가 모달이 아니라 뒤 페이지를
	// 스크롤하던 문제 방지(position:fixed 트릭 + 닫을 때 스크롤 위치 복원). 시트엔 overscroll-contain으로 체이닝 차단.
	useEffect(() => {
		const { body } = document;
		const scrollY = window.scrollY;
		const prev = {
			position: body.style.position,
			top: body.style.top,
			left: body.style.left,
			right: body.style.right,
			width: body.style.width,
			overflow: body.style.overflow,
		};
		body.style.position = "fixed";
		body.style.top = `-${scrollY}px`;
		body.style.left = "0";
		body.style.right = "0";
		body.style.width = "100%";
		body.style.overflow = "hidden";
		return () => {
			body.style.position = prev.position;
			body.style.top = prev.top;
			body.style.left = prev.left;
			body.style.right = prev.right;
			body.style.width = prev.width;
			body.style.overflow = prev.overflow;
			window.scrollTo(0, scrollY);
		};
	}, []);

	const posClass =
		position === "center"
			? "items-center justify-center px-6"
			: "items-end justify-center px-4 pb-6";

	return (
		<div
			className={`fixed inset-0 lq-overlay flex z-50 ${posClass}`}
			onClick={onClose}
		>
			<div
				className={`lq-sheet w-full max-w-sm rounded-3xl overflow-y-auto overscroll-contain no-sb ${className}`}
				style={{ maxHeight: "90dvh" }}
				onClick={(e) => e.stopPropagation()}
			>
				{children}
			</div>
		</div>
	);
}
