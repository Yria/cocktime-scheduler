import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App.tsx";
import { initErudaDebug } from "./lib/debug/eruda"; // ⚠️ 임시 디버그 — 진단 끝나면 제거
import "./index.css";

const basename = import.meta.env.VITE_BASE_PATH || "/";

initErudaDebug(); // ⚠️ 임시 디버그

createRoot(document.getElementById("root")!).render(
	<StrictMode>
		<BrowserRouter basename={basename}>
			<App />
		</BrowserRouter>
	</StrictMode>,
);
