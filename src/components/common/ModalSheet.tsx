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
				className={`lq-sheet w-full max-w-sm rounded-3xl overflow-hidden ${className}`}
				onClick={(e) => e.stopPropagation()}
			>
				{children}
			</div>
		</div>
	);
}
