import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App.tsx";
// beforeinstallprompt/appinstalled 는 컴포넌트 마운트 전에 발생할 수 있어, 앱 시작 시 전역 리스너 등록.
import "./store/installPromptStore";
import "./index.css";

const basename = import.meta.env.VITE_BASE_PATH || "/";

createRoot(document.getElementById("root")!).render(
	<StrictMode>
		<BrowserRouter basename={basename}>
			<App />
		</BrowserRouter>
	</StrictMode>,
);
