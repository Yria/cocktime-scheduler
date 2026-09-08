import { useEffect, useId, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import ModalSheet from "../common/ModalSheet";

/** Reuses the app sheet with dialog focus containment and return to its trigger. */
export default function AccountingDetailModal({
	title,
	subtitle,
	onClose,
	children,
}: {
	title: string;
	subtitle: string;
	onClose: () => void;
	children: ReactNode;
}) {
	const headingId = useId();
	const dialog = useRef<HTMLDivElement>(null);
	const close = useRef<HTMLButtonElement>(null);
	useEffect(() => {
		const trigger = document.activeElement as HTMLElement | null;
		const root = document.getElementById("root");
		const wasInert = root?.inert ?? false;
		if (root) root.inert = true;
		close.current?.focus({ preventScroll: true });
		return () => {
			if (root) root.inert = wasInert;
			if (trigger?.isConnected) trigger.focus({ preventScroll: true });
		};
	}, []);
	return (
		<ModalSheet
			position="center"
			closeOnEscape
			onClose={onClose}
			className="ac-detail-sheet"
		>
			<div
				ref={dialog}
				className="accounting-screen ac-layout-v2 ac-detail-content"
				role="dialog"
				aria-modal="true"
				aria-labelledby={headingId}
				onKeyDown={(event) => {
					if (event.key !== "Tab") return;
					const items = [
						...(dialog.current?.querySelectorAll<HTMLElement>(
							'button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),[tabindex="0"]',
						) ?? []),
					];
					const first = items[0],
						last = items.at(-1);
					if (event.shiftKey && document.activeElement === first) {
						event.preventDefault();
						last?.focus();
					} else if (!event.shiftKey && document.activeElement === last) {
						event.preventDefault();
						first?.focus();
					}
				}}
			>
				<div className="ac-detail-heading">
					<div>
						<h2 id={headingId}>{title}</h2>
						<p className="ac-caption">{subtitle}</p>
					</div>
					<button
						ref={close}
						type="button"
						className="ac-detail-close"
						aria-label="닫기"
						onClick={onClose}
					>
						<X size={18} aria-hidden="true" />
					</button>
				</div>
				<div
					className="ac-detail-body"
					tabIndex={0}
					role="region"
					aria-label="상세 명단"
				>
					{children}
				</div>
			</div>
		</ModalSheet>
	);
}
