import { useEffect } from "react";

/** OS 다크모드(prefers-color-scheme)를 <html>.dark 클래스에 동기화. */
export function useDarkMode() {
	useEffect(() => {
		const mq = window.matchMedia("(prefers-color-scheme: dark)");
		const apply = (dark: boolean) => {
			document.documentElement.classList.toggle("dark", dark);
		};
		apply(mq.matches);
		const handler = (e: MediaQueryListEvent) => apply(e.matches);
		mq.addEventListener("change", handler);
		return () => mq.removeEventListener("change", handler);
	}, []);
}
