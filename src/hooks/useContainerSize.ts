import { useEffect, useState } from "react";
import type { RefObject } from "react";

export function useContainerSize(ref: RefObject<HTMLDivElement | null>) {
	const [size, setSize] = useState({ w: 0, h: 0 });
	useEffect(() => {
		const el = ref.current;
		if (!el) return;
		const ro = new ResizeObserver(([entry]) => {
			const { width, height } = entry.contentRect;
			setSize({ w: Math.round(width), h: Math.round(height) });
		});
		ro.observe(el);
		return () => ro.disconnect();
	}, [ref]);
	return size;
}
