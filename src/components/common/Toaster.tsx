/**
 * Toaster
 *
 * toastStore의 items를 화면 하단에 쌓아 렌더. 각 토스트는 duration 뒤 자동 dismiss.
 * 위치: 하단 중앙 고정, z-index 2000 (tldraw 캔버스 위).
 */
import { memo, useEffect } from "react";
import { useToastStore, type ToastItem } from "../../store/toastStore";

const VARIANT_STYLE = {
	info: { bg: "rgba(30,30,30,0.92)", color: "#fff" },
	success: { bg: "#34c759", color: "#fff" },
	error: { bg: "#ff3b30", color: "#fff" },
} as const;

function ToastRow({ item }: { item: ToastItem }) {
	const dismiss = useToastStore((s) => s.dismiss);

	useEffect(() => {
		if (item.duration <= 0) return;
		const t = window.setTimeout(() => dismiss(item.id), item.duration);
		return () => window.clearTimeout(t);
	}, [item.id, item.duration, dismiss]);

	const style = VARIANT_STYLE[item.variant];

	return (
		<button
			type="button"
			onClick={() => dismiss(item.id)}
			style={{
				background: style.bg,
				color: style.color,
				padding: "10px 16px",
				borderRadius: 12,
				fontSize: 14,
				fontWeight: 600,
				boxShadow: "0 6px 20px rgba(0,0,0,0.22)",
				border: "none",
				cursor: "pointer",
				maxWidth: 360,
				textAlign: "center",
				lineHeight: 1.4,
				pointerEvents: "auto",
			}}
		>
			{item.message}
		</button>
	);
}

const Toaster = memo(function Toaster() {
	const items = useToastStore((s) => s.items);

	if (items.length === 0) return null;

	return (
		<div
			style={{
				position: "fixed",
				left: 0,
				right: 0,
				bottom: "calc(env(safe-area-inset-bottom, 0px) + 24px)",
				display: "flex",
				flexDirection: "column",
				alignItems: "center",
				gap: 8,
				zIndex: 2000,
				pointerEvents: "none",
			}}
		>
			{items.map((item) => (
				<ToastRow key={item.id} item={item} />
			))}
		</div>
	);
});

export default Toaster;
