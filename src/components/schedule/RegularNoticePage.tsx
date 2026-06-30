import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Components } from "react-markdown";
import { fetchSessionById } from "../../lib/supabase/schedule";
import { fmtRange } from "../../lib/schedule/timeFmt";
import type { SessionWithPlace } from "../../lib/supabase/types";
import { useAuthStore } from "../../store/authStore";
import { useScheduleStore } from "../../store/scheduleStore";
import AppScreen from "../common/AppScreen";
import Spinner from "../shared/Spinner";

/**
 * 회원용 정모 안내·대진표 페이지. 일정(정모)에서 '들어가면' 보이는 화면.
 * 운영진이 OccurrenceEditor 에서 매번 수동 작성한 마크다운(notice_md)을 앱 테마로 렌더한다.
 * 로그인 회원이면 누구나 열람(참석 여부 무관). 비로그인은 홈으로.
 */
export default function RegularNoticePage() {
	const { sessionId } = useParams();
	const navigate = useNavigate();
	const id = Number(sessionId);

	const authReady = useAuthStore((s) => s.ready);
	const authUser = useAuthStore((s) => s.user);
	// 홈에서 진입 시 이미 로드된 목록을 즉시 사용(깜빡임 방지), 없으면 단건 조회.
	const fromStore = useScheduleStore((s) =>
		s.schedules.find((x) => x.id === id),
	);
	const places = useScheduleStore((s) => s.places);

	const [fetched, setFetched] = useState<SessionWithPlace | null>(null);
	const [fetchDone, setFetchDone] = useState(false);

	// 비로그인 차단
	useEffect(() => {
		if (authReady && !authUser) navigate("/", { replace: true });
	}, [authReady, authUser, navigate]);

	// 단건 조회(직접 진입·새로고침 대비). 스토어에 있으면 그것을 신뢰(조회 생략).
	useEffect(() => {
		if (fromStore || !Number.isFinite(id)) return;
		let alive = true;
		void fetchSessionById(id).then((row) => {
			if (!alive) return;
			setFetched(row);
			setFetchDone(true);
		});
		return () => {
			alive = false;
		};
	}, [id, fromStore]);

	const session = fromStore ?? fetched;
	const loading = !fromStore && !fetchDone && Number.isFinite(id);

	const placeName = useMemo(() => {
		if (!session?.place_id) return null;
		// 메인 경유 진입: 스토어 places 로 매핑.
		const byStore = places.find((p) => p.id === session.place_id)?.name;
		if (byStore) return byStore;
		// 직접 진입·새로고침: 단건 조회가 함께 가져온 장소명 사용(스토어가 비어 있을 때).
		return fetched?.place_name ?? null;
	}, [session, places, fetched]);

	const title = session ? fmtRange(session.scheduled_at, session.ends_at) : "대진표";
	const md = session?.notice_md?.trim() ?? "";

	return (
		<AppScreen title="대진표 · 안내" onBack={() => navigate(-1)}>
			<style>{NOTICE_CSS}</style>
			<div className="w-full max-w-md mx-auto flex flex-col gap-4">
				{/* 회차 헤더 */}
				<div className="flex flex-col gap-1">
					<div className="flex items-center gap-2">
						<span style={regularBadge}>정모</span>
						<h1
							className="text-[#0f1724] dark:text-white"
							style={{ fontSize: 19, fontWeight: 800, letterSpacing: "-0.01em" }}
						>
							{title}
						</h1>
					</div>
					<span
						className="text-[#64748b] dark:text-[rgba(235,235,245,0.55)]"
						style={{ fontSize: 13 }}
					>
						{placeName ?? "장소 미정"}
					</span>
				</div>

				{/* 본문 */}
				{loading ? (
					<div className="flex justify-center py-16">
						<Spinner size={22} />
					</div>
				) : !session ? (
					<EmptyNote text="일정을 찾을 수 없어요." />
				) : !session.is_regular ? (
					<EmptyNote text="이 일정에는 안내 페이지가 없어요." />
				) : !md ? (
					<EmptyNote text="대진표를 준비 중이에요. 잠시 후 다시 확인해 주세요." />
				) : (
					<div className="notice-md">
						<Markdown remarkPlugins={[remarkGfm]} components={mdComponents}>
							{md}
						</Markdown>
					</div>
				)}
			</div>
		</AppScreen>
	);
}

function EmptyNote({ text }: { text: string }) {
	return (
		<div
			className="text-[#98a0ab] dark:text-[rgba(235,235,245,0.45)] bg-white dark:bg-[rgba(30,30,35,0.6)] border border-[rgba(0,0,0,0.06)] dark:border-[rgba(255,255,255,0.1)]"
			style={{
				borderRadius: 12,
				padding: "28px 16px",
				textAlign: "center",
				fontSize: 13.5,
				fontWeight: 600,
			}}
		>
			{text}
		</div>
	);
}

const regularBadge: React.CSSProperties = {
	fontSize: 11,
	fontWeight: 800,
	color: "#fff",
	background: "#2c7a57",
	padding: "3px 9px",
	borderRadius: 7,
	letterSpacing: "0.02em",
	flex: "none",
};

// 표는 가로 스크롤 래퍼로 감싸 좁은 모바일 폭에서도 본문이 옆으로 밀리지 않게 한다.
const mdComponents: Components = {
	table({ node, ...rest }) {
		void node; // react-markdown 의 node prop 은 DOM <table> 로 넘기지 않는다
		return (
			<div className="nm-tbl">
				<table {...rest} />
			</div>
		);
	},
};

const NOTICE_CSS = `
.notice-md{font-size:14.5px;line-height:1.65;color:#243240;
	--nm-accent:#2c7a57;--nm-line:#e4ebe7;--nm-soft:#f4f8f6;--nm-muted:#6b7785;}
.dark .notice-md{color:rgba(235,235,245,0.86);
	--nm-accent:#5cc395;--nm-line:rgba(255,255,255,0.12);--nm-soft:rgba(255,255,255,0.045);--nm-muted:rgba(235,235,245,0.5);}
.notice-md>:first-child{margin-top:0;}
.notice-md h1,.notice-md h2,.notice-md h3,.notice-md h4{font-weight:800;letter-spacing:-0.01em;
	line-height:1.25;margin:22px 0 10px;color:var(--nm-accent);text-wrap:balance;}
.notice-md h1{font-size:20px;}
.notice-md h2{font-size:17px;}
.notice-md h3{font-size:15px;}
.notice-md h4{font-size:13.5px;}
.notice-md p{margin:10px 0;}
.notice-md strong{font-weight:700;color:inherit;}
.notice-md em{font-style:italic;}
.notice-md ul,.notice-md ol{margin:10px 0;padding-left:20px;}
.notice-md li{margin:3px 0;}
.notice-md li::marker{color:var(--nm-muted);}
.notice-md a{color:var(--nm-accent);text-decoration:underline;text-underline-offset:2px;}
.notice-md hr{border:none;border-top:1px solid var(--nm-line);margin:18px 0;}
.notice-md code{font-family:ui-monospace,"SF Mono",Menlo,monospace;font-size:0.88em;
	background:var(--nm-soft);padding:1px 5px;border-radius:5px;}
.notice-md pre{background:var(--nm-soft);padding:12px 14px;border-radius:10px;overflow-x:auto;margin:12px 0;}
.notice-md pre code{background:none;padding:0;}
.notice-md blockquote{margin:12px 0;padding:4px 14px;border-left:3px solid var(--nm-accent);color:var(--nm-muted);}
.notice-md .nm-tbl{overflow-x:auto;-webkit-overflow-scrolling:touch;margin:12px 0;
	border:1px solid var(--nm-line);border-radius:11px;background:#fff;}
.dark .notice-md .nm-tbl{background:rgba(30,30,35,0.5);}
.notice-md table{border-collapse:collapse;width:100%;font-size:13.5px;font-variant-numeric:tabular-nums;}
.notice-md th,.notice-md td{padding:8px 11px;text-align:left;border-bottom:1px solid var(--nm-line);white-space:nowrap;}
.notice-md thead th{background:var(--nm-soft);font-weight:700;font-size:11.5px;color:var(--nm-muted);
	letter-spacing:0.03em;}
.notice-md tbody tr:last-child td{border-bottom:none;}
.notice-md tbody tr:nth-child(even) td{background:var(--nm-soft);}
`;
