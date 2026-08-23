import { Settings } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { duesEnsureMonthly } from "../../../lib/supabase/dues";
import { useAuthStore } from "../../../store/authStore";
import { duesActions } from "../../../store/duesStore";
import AppScreen from "../../common/AppScreen";
import DuesSettingsModal from "./DuesSettingsModal";
import LedgerView from "./LedgerView";
import ManualChargeHome from "./ManualChargeHome";
import ReconcileInbox from "./ReconcileInbox";
import SessionsHome from "./SessionsHome";
import { currentYm, shiftYm, ymLabel } from "./duesText";

type Page = "home" | "inbox" | "ledger" | "charge";
const NAV: [Page, string][] = [
	["home", "현황"],
	["inbox", "정산함"],
	["ledger", "회계"],
	// 회식·공동구매 등 자동 트리거가 없는 부과. 데이터는 탭 진입 때만 로드한다(loadManual).
	["charge", "부과"],
];
const YM_RE = /^\d{4}-\d{2}$/;

// 회비 관리(운영진). ym·화면은 URL로: /dues/:ym(정모) · /dues/:ym/inbox(정산함) · /dues/:ym/ledger(회계)
// · /dues/:ym/charge(수동 부과).
// 월 공통 데이터는 여기서 loadMonth(ym) 한 번(캐시) — 화면 전환 시 재조회 없음(ACCOUNTING_SPEC §11).
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
	// 이번 달 첫 진입 시 회비 부과 자동 생성(멱등·no-op after first) 후 로드 — 대관비는 세션 종료 트리거가 담당.
	const load = useCallback(async () => {
		if (ym === currentYm()) await duesEnsureMonthly(ym);
		await duesActions.loadMonth(ym);
	}, [ym]);
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

			{/* 화면 전환(세그먼티드 컨트롤) */}
			<div className="flex" style={{ gap: 3, marginBottom: 14, background: "rgba(120,120,128,0.14)", borderRadius: 11, padding: 3 }}>
				{NAV.map(([key, label]) => {
					const on = page === key;
					return (
						<button
							key={key}
							type="button"
							onClick={() => goPage(key)}
							aria-current={on ? "page" : undefined}
							className={on ? "bg-white dark:bg-[rgba(72,72,78,0.9)] text-strong" : "text-muted"}
							style={{ flex: 1, padding: "7px 0", fontSize: 13.5, fontWeight: on ? 800 : 600, borderRadius: 8, cursor: "pointer", border: "none", background: on ? undefined : "transparent", boxShadow: on ? "0 1px 3px rgba(0,0,0,0.12)" : undefined, transition: "font-weight 0.1s" }}
						>
							{label}
						</button>
					);
				})}
			</div>

			{page === "home" && <SessionsHome ym={ym} />}
			{page === "inbox" && <ReconcileInbox ym={ym} />}
			{page === "ledger" && <LedgerView ym={ym} />}
			{page === "charge" && <ManualChargeHome ym={ym} />}

			{showSettings && <DuesSettingsModal onClose={() => setShowSettings(false)} />}
		</AppScreen>
	);
}
