import "./me.css";
import { useEffect } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { isPlacement, tierOf } from "../../lib/rating/tier";
import { authDisplayName, useAuthStore } from "../../store/authStore";
import { duesActions } from "../../store/duesStore";
import { ratingActions, useRatingStore } from "../../store/ratingStore";
import { waitPointActions } from "../../store/waitPointStore";
import AppScreen from "../common/AppScreen";
import DuesTab from "./DuesTab";
import MyHero from "./MyHero";
import ProfileTab from "./ProfileTab";
import RecordTab from "./RecordTab";

/**
 * 내 정보(/me, /me/:tab) — 내 승패 기록 · 내 회비 · 클럽 회계 · 정보 수정을 한 화면에 모았다
 * (docs/MATCH_RESULT_ELO_SPEC.md §3.5). 예전엔 '내 정보'는 모달, '내 회비'는 /my-dues 따로였다.
 *
 * - 셸은 AppScreen(body 자연 스크롤 + sticky 헤더). 고정 높이 앱셸·내부 스크롤을 만들지 않는다(iOS PWA 하단 잘림).
 * - 탭 이동은 replace — 헤더 뒤로가기·브라우저 뒤로가기가 탭을 거슬러 돌지 않고 바로 홈으로 간다.
 * - 진입할 때 내 점수를 한 번 다시 읽는다(앱 진입 때 읽은 값이 다른 기기에서 제출한 결과로 낡았을 수 있다).
 */

const TABS = [
	{ key: "record", label: "기록" },
	{ key: "dues", label: "회비" },
	{ key: "ledger", label: "클럽 회계" },
	{ key: "profile", label: "정보 수정" },
] as const;
type TabKey = (typeof TABS)[number]["key"];
const isTab = (v: string | undefined): v is TabKey =>
	TABS.some((t) => t.key === v);

export default function MyPage() {
	const navigate = useNavigate();
	const { tab: tabParam } = useParams<{ tab: string }>();
	const ready = useAuthStore((s) => s.ready && s.memberLoaded);
	const memberId = useAuthStore((s) => s.memberId);
	const user = useAuthStore((s) => s.user);
	const myName = useAuthStore((s) => s.myName);
	const myGender = useAuthStore((s) => s.myGender);
	const my = useRatingStore((s) => s.my);
	const myLoading = useRatingStore((s) => s.myLoading);

	useEffect(() => {
		if (memberId) void ratingActions.loadMy();
	}, [memberId]);

	if (!ready) return null;
	if (!memberId) return <Navigate to="/" replace />;
	// 모르는 탭 주소(오타·옛 링크)는 기본 탭으로 정리한다.
	if (tabParam !== undefined && !isTab(tabParam)) return <Navigate to="/me" replace />;
	const tab: TabKey = tabParam ?? "record";

	const refresh = (): Promise<unknown> => {
		switch (tab) {
			case "record":
				return Promise.all([ratingActions.loadMy(), ratingActions.loadHistory()]);
			case "dues":
			case "ledger":
				return Promise.all([ratingActions.loadMy(), duesActions.load()]);
			case "profile":
				return Promise.all([ratingActions.loadMy(), waitPointActions.loadLedger(true)]);
		}
	};

	const name = myName || authDisplayName(user);

	return (
		<AppScreen
			title="내 정보"
			onBack={() => navigate("/")}
			onRefresh={() => refresh().then(() => {})}
		>
			<div
				className="app-card me-page"
				data-tier={my && !isPlacement(my.games) ? tierOf(my.rating) : undefined}
			>
				<MyHero
					name={name}
					gender={myGender}
					memberId={memberId}
					my={my}
					myLoading={myLoading}
				/>

				<nav className="me-tabs" aria-label="내 정보 메뉴">
					{TABS.map((t) => (
						<button
							key={t.key}
							type="button"
							aria-current={tab === t.key ? "page" : undefined}
							onClick={() =>
								navigate(t.key === "record" ? "/me" : `/me/${t.key}`, {
									replace: true,
								})
							}
						>
							{t.label}
						</button>
					))}
				</nav>

				{tab === "record" && <RecordTab />}
				{/* 회비·클럽 회계는 한 자리(같은 인스턴스)에 둔다 — 탭을 오가도 각 탭에서 넘겨 본 달이 유지된다 */}
				{(tab === "dues" || tab === "ledger") && (
					<DuesTab page={tab === "ledger" ? "ledger" : "mine"} />
				)}
				{tab === "profile" && <ProfileTab />}
			</div>
		</AppScreen>
	);
}
