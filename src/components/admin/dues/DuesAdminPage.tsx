import { Settings } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useAuthStore } from "../../../store/authStore";
import { duesActions } from "../../../store/duesStore";
import AppScreen from "../../common/AppScreen";
import DuesSettingsModal from "./DuesSettingsModal";
import LedgerView from "./LedgerView";
import ReconcileInbox from "./ReconcileInbox";
import SessionsHome from "./SessionsHome";
import { currentYm, shiftYm, ymLabel } from "./duesText";

type Page = "home" | "inbox" | "ledger";
const NAV: [Page, string][] = [
	["home", "정모"],
	["inbox", "정산함"],
	["ledger", "회계"],
];
const YM_RE = /^\d{4}-\d{2}$/;

// 회비 관리(운영진). ym·화면은 URL로: /dues/:ym(정모) · /dues/:ym/inbox(정산함) · /dues/:ym/ledger(회계).
// 월 공통 데이터는 여기서 loadMonth(ym) 한 번(캐시) — 화면 전환 시 재조회 없음(ACCOUNTING_SPEC §10.2).
export default function DuesAdminPage() {
	const navigate = useNavigate();
	const params = useParams<{ ym?: string; page?: string }>();
	const ready = useAuthStore((s) => s.ready);
	const memberLoaded = useAuthStore((s) => s.memberLoaded);
	const isAdmin = useAuthStore((s) => s.isAdmin);
	const [showSettings, setShowSettings] = useState(false);

	const ym = params.ym && YM_RE.test(params.ym) ? params.ym : currentYm();
	const page: Page = NAV.some(([k]) => k === params.page) ? (params.page as Page) : "home";

	// URL 정규화(ym 누락/오류 → 현재 월).
	useEffect(() => {
		if (!params.ym || !YM_RE.test(params.ym)) {
			const suffix = page === "home" ? "" : `/${page}`;
			navigate(`/dues/${ym}${suffix}`, { replace: true });
		}
	}, [params.ym, ym, page, navigate]);

	const goYm = (delta: number) => navigate(`/dues/${shiftYm(ym, delta)}${page === "home" ? "" : `/${page}`}`);
	const goPage = (p: Page) => navigate(`/dues/${ym}${p === "home" ? "" : `/${p}`}`);

	// 운영진 전용.
	useEffect(() => {
		if (ready && memberLoaded && !isAdmin) navigate("/", { replace: true });
	}, [ready, memberLoaded, isAdmin, navigate]);

	// 월 공통 데이터 로드(ym 캐시 가드는 스토어가 처리).
	const load = useCallback(() => duesActions.loadMonth(ym), [ym]);
	const refresh = useCallback(() => duesActions.loadMonth(ym, true), [ym]);
	useEffect(() => {
		void load();
	}, [load]);

	if (!ready || !memberLoaded) return null;

	return (
		<AppScreen
			title="회비 관리"
			onBack={() => navigate("/")}
			onRefresh={refresh}
			right={
				<button type="button" onClick={() => setShowSettings(true)} aria-label="회비 설정" className="flex items-center justify-center text-muted" style={{ width: 38, height: 38, background: "none", cursor: "pointer" }}>
					<Settings size={20} strokeWidth={2} />
				</button>
			}
		>
			{/* 월 선택기 */}
			<div className="flex items-center justify-center gap-4" style={{ marginBottom: 12 }}>
				<button type="button" onClick={() => goYm(-1)} className="text-muted" style={{ background: "none", cursor: "pointer", fontSize: 22, lineHeight: 1, padding: 4 }} aria-label="이전 달">‹</button>
				<span className="text-strong" style={{ fontSize: 17, fontWeight: 800, minWidth: 120, textAlign: "center" }}>{ymLabel(ym)}</span>
				<button type="button" onClick={() => goYm(1)} className="text-muted" style={{ background: "none", cursor: "pointer", fontSize: 22, lineHeight: 1, padding: 4 }} aria-label="다음 달">›</button>
			</div>

			{/* 화면 전환 */}
			<div className="flex gap-1.5" style={{ marginBottom: 14 }}>
				{NAV.map(([key, label]) => (
					<button
						key={key}
						type="button"
						onClick={() => goPage(key)}
						className={page === key ? "text-strong" : "text-faint"}
						style={{ flex: 1, padding: "7px 0", fontSize: 13, fontWeight: 700, borderRadius: 999, cursor: "pointer", border: "none", background: page === key ? "rgba(11,132,255,0.14)" : "rgba(120,120,128,0.1)" }}
					>
						{label}
					</button>
				))}
			</div>

			{page === "home" && <SessionsHome ym={ym} />}
			{page === "inbox" && <ReconcileInbox ym={ym} />}
			{page === "ledger" && <LedgerView ym={ym} />}

			{showSettings && <DuesSettingsModal onClose={() => setShowSettings(false)} />}
		</AppScreen>
	);
}
