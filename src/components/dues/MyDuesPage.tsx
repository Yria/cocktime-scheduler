import { useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useAuthStore } from "../../store/authStore";
import { duesActions, useDuesStore } from "../../store/duesStore";
import AppScreen from "../common/AppScreen";
import { publicLedgerMaxYm } from "../admin/dues/duesText";
import MyDuesTab from "./MyDuesTab";
import MyLedgerTab from "./MyLedgerTab";

type Page = "home" | "ledger";
const NAV: [Page, string][] = [
	["home", "내 회비"],
	["ledger", "클럽 회계"],
];

// 회비(회원 본인). 탭으로 분리: 내 회비(납부·이력) / 클럽 회계(월별 공개). URL: /my-dues · /my-dues/ledger.
export default function MyDuesPage() {
	const navigate = useNavigate();
	const params = useParams<{ page?: string }>();
	const ready = useAuthStore((s) => s.ready);
	const memberLoaded = useAuthStore((s) => s.memberLoaded);
	const memberId = useAuthStore((s) => s.memberId);
	const page: Page = params.page === "ledger" ? "ledger" : "home";

	useEffect(() => {
		if (ready && memberLoaded && !memberId) navigate("/", { replace: true });
	}, [ready, memberLoaded, memberId, navigate]);

	if (!ready || !memberLoaded || !memberId) return null;

	const goPage = (p: Page) => navigate(p === "home" ? "/my-dues" : `/my-dues/${p}`);
	const refresh = () => {
		if (page === "home") void duesActions.loadMine(memberId);
		else void duesActions.loadMyLedger(useDuesStore.getState().myLedgerYm ?? publicLedgerMaxYm(), true);
	};

	return (
		<AppScreen title="회비" onBack={() => navigate("/")} onRefresh={refresh}>
			{/* 탭 전환(세그먼티드) */}
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
							style={{ flex: 1, padding: "7px 0", fontSize: 13.5, fontWeight: on ? 800 : 600, borderRadius: 8, cursor: "pointer", border: "none", background: on ? undefined : "transparent", boxShadow: on ? "0 1px 3px rgba(0,0,0,0.12)" : undefined }}
						>
							{label}
						</button>
					);
				})}
			</div>

			{page === "home" ? <MyDuesTab memberId={memberId} /> : <MyLedgerTab />}
		</AppScreen>
	);
}
