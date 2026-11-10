import { useEffect, useMemo, useRef, useState } from "react";
import type { MyMatchRecord } from "../../lib/supabase/matchResults";
import { useAuthStore } from "../../store/authStore";
import { ratingActions, useRatingStore } from "../../store/ratingStore";
import { toast } from "../../store/toastStore";
import MatchResultDialog, {
	type MatchOutcome,
	type MatchResultPick,
} from "../match/MatchResultDialog";
import EmptyState from "../shared/EmptyState";
import Spinner from "../shared/Spinner";
import MatchRecordCard from "./MatchRecordCard";

const dayFmt = new Intl.DateTimeFormat("ko-KR", {
	timeZone: "Asia/Seoul",
	month: "long",
	day: "numeric",
	weekday: "short",
});
const ymdFmt = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" });

/** 같은 날(KST) 경기끼리 묶는다 — 한 모임에서 여러 판을 뛰므로 날짜를 카드마다 반복하지 않는다. */
function groupByDay(list: MyMatchRecord[]) {
	const out: { key: string; label: string; items: MyMatchRecord[] }[] = [];
	for (const r of list) {
		const d = r.endedAt ? new Date(r.endedAt) : null;
		const key = d ? ymdFmt.format(d) : "unknown";
		const last = out.at(-1);
		if (last?.key === key) last.items.push(r);
		else out.push({ key, label: d ? dayFmt.format(d) : "날짜 모름", items: [r] });
	}
	return out;
}

/** 서버 예외 메시지 → 회원에게 보일 문장. 코드가 아니라 무슨 일인지와 다음 행동을 말한다. */
function submitErrorText(e: unknown): string {
	const msg = String((e as { message?: string })?.message ?? "");
	if (msg.includes("window closed")) return "입력 기간(7일)이 지나 기록할 수 없어요.";
	if (msg.includes("not in match")) return "이 경기에 뛴 사람만 결과를 입력할 수 있어요.";
	return "결과를 기록하지 못했어요. 잠시 후 다시 시도해 주세요.";
}

/**
 * 기록 탭 — match_my_history 목록. [결과 입력]은 건너뛴 경기(결과 없음 ∧ 7일 이내)에만.
 * 진입할 때 첫 페이지를 새로 읽는다(폴링 없음, MATCH_RESULT_ELO_SPEC §3.2).
 */
export default function RecordTab() {
	const history = useRatingStore((s) => s.history);
	const loading = useRatingStore((s) => s.historyLoading);
	const loaded = useRatingStore((s) => s.historyLoaded);
	const hasMore = useRatingStore((s) => s.historyHasMore);
	const error = useRatingStore((s) => s.historyError);
	const submitting = useRatingStore((s) => s.submitting);
	const memberId = useAuthStore((s) => s.memberId);
	const myName = useAuthStore((s) => s.myName);
	const myGender = useAuthStore((s) => s.myGender);

	const [target, setTarget] = useState<MyMatchRecord | null>(null);
	const [outcome, setOutcome] = useState<MatchOutcome | null>(null);
	// 지금 열린 창의 경기 — 제출 응답이 늦게 오면 그 사이 창이 바뀌었는지 여기로 가린다(state 클로저는 옛 값이다).
	const openMatchId = useRef<string | null>(null);
	const busy = target != null && submitting === target.matchId;

	useEffect(() => {
		void ratingActions.loadHistory();
	}, []);

	const days = useMemo(() => groupByDay(history), [history]);

	// 기록 중엔 닫지 않는다(MatchCompleteFlow 와 같은 규칙). 닫힌 뒤 도착한 결과가 outcome 에 남으면
	// 다음 경기 창이 그 결과 화면으로 바로 열려 새 경기 결과를 넣을 수 없게 된다.
	const reset = () => {
		openMatchId.current = null;
		setTarget(null);
		setOutcome(null);
	};
	const close = () => {
		if (!busy) reset();
	};

	const open = (r: MyMatchRecord) => {
		openMatchId.current = r.matchId;
		setOutcome(null);
		setTarget(r);
	};

	// 고친 실제 편(teamA)도 함께 보낸다 — 기록의 teamA/teamB 는 서버가 준 spId 를 들고 있다.
	const submit = async ({ winner, teamA }: MatchResultPick) => {
		if (!target) return;
		const matchId = target.matchId;
		const stillOpen = () => openMatchId.current === matchId;
		try {
			const res = await ratingActions.submit(matchId, winner, teamA);
			if (!stillOpen()) return; // 그 사이 창이 닫혔거나 다른 경기 창이다 — 늦은 결과로 그 창을 덮지 않는다.
			// 다른 사람이 먼저 넣었으면 그 결과가 확정이다(첫 입력 우선) — 내가 고른 것과 다를 수 있음을 알린다.
			if (res.status === "exists") {
				toast("이미 다른 분이 결과를 입력했어요. 먼저 들어온 결과로 확정돼요.", {
					variant: "info",
				});
				reset();
				return;
			}
			if (res.outcome) setOutcome(res.outcome);
			else {
				toast("결과를 기록했어요", { variant: "success" });
				reset();
			}
		} catch (e) {
			toast(submitErrorText(e), { variant: "error" });
			if (stillOpen()) reset();
			// 창이 닫혔거나 권한이 바뀌었으면 목록의 [결과 입력]도 사라져야 한다.
			void ratingActions.loadHistory();
		}
	};

	if (!loaded && loading) return <EmptyState loading style={{ padding: "40px 0" }} />;

	if (error && history.length === 0) {
		return (
			<div className="me-notice" role="alert">
				<strong>기록을 불러오지 못했어요</strong>
				네트워크를 확인한 뒤 다시 시도해 주세요.
				<div style={{ marginTop: 12 }}>
					<button
						type="button"
						className="btn-lq-secondary"
						style={{ padding: "8px 18px" }}
						onClick={() => void ratingActions.loadHistory()}
					>
						다시 불러오기
					</button>
				</div>
			</div>
		);
	}

	if (loaded && history.length === 0) {
		return (
			<div className="me-notice">
				<strong>아직 기록된 경기가 없어요</strong>
				보드에서 경기를 마치고 이긴 팀을 고르면 여기에 쌓여요.
			</div>
		);
	}

	const pending = history.filter((r) => r.canSubmit).length;

	return (
		<div className="flex flex-col">
			{pending > 0 && (
				<p className="me-rec-pending" role="status">
					<strong>결과를 입력하지 않은 경기 {pending}개</strong>
					<span>경기 후 7일까지 입력할 수 있어요</span>
				</p>
			)}
			{days.map((d) => (
				<section className="me-rec-day" key={d.key} aria-label={d.label}>
					<h3>{d.label}</h3>
					{d.items.map((r) => (
						<MatchRecordCard
							key={r.matchId}
							record={r}
							busy={submitting === r.matchId}
							onSubmit={open}
						/>
					))}
				</section>
			))}
			{hasMore && (
				<button
					type="button"
					className="btn-lq-secondary me-more"
					disabled={loading}
					onClick={() => void ratingActions.loadHistory(true)}
				>
					{loading ? <Spinner size={16} /> : "이전 경기 더 보기"}
				</button>
			)}

			{target && (
				<MatchResultDialog
					teamA={target.teamA}
					teamB={target.teamB}
					mySide={target.mySide}
					busy={busy}
					outcome={outcome}
					me={
						memberId
							? { name: myName ?? "", gender: myGender, memberId }
							: undefined
					}
					onSubmit={(w) => void submit(w)}
					onSkip={close}
					onClose={close}
				/>
			)}
		</div>
	);
}
