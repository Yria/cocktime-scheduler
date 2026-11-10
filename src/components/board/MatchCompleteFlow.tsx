import { useEffect, useState } from "react";
import MatchResultDialog, { type MatchOutcome, type MatchResultPick } from "../match/MatchResultDialog";
import { submitMatchResult, type MatchTeamA, type MatchWinner } from "../../lib/supabase/matchResults";
import { useAuthStore } from "../../store/authStore";
import { useBoardStore } from "../../store/boardStore";
import { claimEdit } from "../../store/board/draftsSync";
import type { CompleteRequest } from "../../store/board/types";
import { useRatingStore } from "../../store/ratingStore";
import { useSessionStore } from "../../store/sessionStore";
import { toast } from "../../store/toastStore";
import type { SessionPlayer } from "../../types";

/**
 * 보드 코트 카드 [경기완료] → 승패 입력 → 완료 (docs/MATCH_RESULT_ELO_SPEC.md §3.4).
 *
 * 창을 먼저 띄우는 이유: 완료 직후엔 코트가 비고 네 명이 흩어져 '누가 이겼지'를 물을 기회가 사라진다.
 * 그래서 완료 버튼을 누른 그 사람에게, 완료하기 전에 묻는다. [건너뛰기]도 완료다(결과만 비운 채).
 * 배경·Esc 로 닫으면 완료하지 않는다 — 잘못 누른 탭을 되돌릴 길.
 *
 *  · 편집자: 기존 completeMatch 그대로 → 이긴 팀을 골랐으면 그 뒤에 결과 제출.
 *  · 회원(편집자 아닌 자기 코트 선수, 운영진 포함): member_complete_match 한 번에 완료+결과 → 그 코트 그룹 편성 1회.
 *  · 이미 완료(동시 탭): 안내 후 고른 결과만 제출(첫 입력이 확정 — 서버가 판정).
 * 창에서 고친 실제 편(teamA = A편 session_players.id 두 개)은 세 경로 모두 결과와 함께 서버로 간다 —
 * winner 는 그 실제 A편 기준이고, 보드 로스터(matches)는 바뀌지 않는다.
 */
export default function MatchCompleteFlow() {
	const request = useBoardStore((s) => s.completeRequest);
	if (!request) return null;
	return <CompleteDialog key={request.matchId} request={request} />;
}

type DialogPlayer = SessionPlayer & { spId: string };

interface Snapshot {
	teamA: DialogPlayer[];
	teamB: DialogPlayer[];
	mySide?: MatchWinner;
	me?: SessionPlayer;
}

/** 창을 연 순간의 로스터 — 완료 뒤 코트가 비어도 결과 단계까지 같은 네 명을 보여준다.
 *  SessionPlayer.id 가 곧 session_players.id 라 창의 '같은 편' 단계(spId)에 그대로 쓴다. */
function readSnapshot(request: CompleteRequest): Snapshot | null {
	const ss = useSessionStore.getState();
	const match = ss.courts.find((c) => c.id === request.courtId)?.match;
	if (!match || match.id !== request.matchId) return null;
	const pick = (ids: readonly string[]) =>
		ids.map((id) => ss.sessionPlayers.get(id)).filter((p): p is SessionPlayer => !!p);
	const teamA = pick(match.teamA).map((p) => ({ ...p, spId: p.id }));
	const teamB = pick(match.teamB).map((p) => ({ ...p, spId: p.id }));
	const memberId = useAuthStore.getState().memberId;
	const me = memberId ? [...teamA, ...teamB].find((p) => p.memberId === memberId) : undefined;
	const mySide: MatchWinner | undefined = !me ? undefined : teamA.includes(me) ? "A" : "B";
	return { teamA, teamB, mySide, me };
}

function CompleteDialog({ request }: { request: CompleteRequest }) {
	const [snap] = useState(() => readSnapshot(request));
	const [busy, setBusy] = useState(false);
	const [outcome, setOutcome] = useState<MatchOutcome | null>(null);
	const { courtId, matchId } = request;
	const close = () => useBoardStore.getState().closeCompleteRequest();
	// 창이 뜨기 전에 코트가 바뀌었다 — 빈 창을 띄우지 않고 요청을 닫는다.
	useEffect(() => {
		if (!snap) useBoardStore.getState().closeCompleteRequest();
	}, [snap]);

	if (!snap) return null;

	const stillOnCourt = () =>
		useSessionStore.getState().courts.find((c) => c.id === courtId)?.match?.id === matchId;

	/** 이미 완료된 경기의 결과만 제출. 내 경기면 내 점수까지 다시 읽어 결과 단계를 보여준다. */
	const submitOnly = async (winner: MatchWinner, teamA: MatchTeamA) => {
		try {
			if (snap.mySide) {
				const out = await useRatingStore.getState().submit(matchId, winner, teamA);
				if (out.status === "exists") {
					// 남이 먼저 넣은 결과가 내 선택과 다를 수 있다 — 내 선택 기준의 승패 연출을 보여주지 않는다.
					toast("이미 다른 분이 결과를 기록했어요");
					close();
					return;
				}
				if (out.outcome) {
					setOutcome(out.outcome);
					return;
				}
			} else {
				const res = await submitMatchResult(matchId, winner, teamA);
				if (res.status === "exists") {
					toast("이미 다른 분이 결과를 기록했어요");
					close();
					return;
				}
			}
			toast("결과를 기록했어요", { variant: "success" });
			close();
		} catch {
			toast("결과를 기록하지 못했어요. 7일 안에 내 정보에서 다시 입력할 수 있어요", { variant: "error" });
			close();
		}
	};

	const finishAsEditor = async (pick: MatchResultPick | null) => {
		if (!stillOnCourt()) {
			toast("이미 완료된 경기예요");
			if (pick) await submitOnly(pick.winner, pick.teamA);
			else close();
			return;
		}
		await useBoardStore.getState().completeMatch(courtId);
		if (stillOnCourt()) {
			// 편집락 상실·네트워크 등 — completeMatch 가 이미 서버 상태로 수렴시켰다.
			toast("경기를 완료하지 못했어요. 다시 시도해 주세요", { variant: "error" });
			close();
			return;
		}
		if (pick) await submitOnly(pick.winner, pick.teamA);
		else close();
	};

	const finishAsMember = async (pick: MatchResultPick | null) => {
		const res = await useBoardStore.getState().completeMatchAsMember(courtId, matchId, pick?.winner ?? null, pick?.teamA ?? null);
		switch (res.status) {
			case "completed": {
				// rejected(숨은 규칙에 걸림)는 따로 알리지 않는다 — 규칙의 존재가 드러나지 않게 평소 완료와 같게.
				toast(res.arrange === "ok" || res.arrange === "skipped" || res.arrange === "rejected"
					? "경기를 완료했어요"
					: "경기를 완료했어요. 다음 팀은 운영진이 올려 줄 거예요", { variant: "success" });
				if (!pick) {
					close();
					return;
				}
				// 결과는 완료와 같은 트랜잭션에서 기록됐다. 내 점수 표시는 다시 읽어 맞춘다(미반영 경기면 Δ 없음).
				await useRatingStore.getState().loadMy();
				const my = useRatingStore.getState().my;
				const r = res.result;
				const rating = r?.ratingAfter ?? my?.rating ?? null;
				const games = r?.games ?? my?.games ?? null;
				if (r && rating != null && games != null) setOutcome({ delta: r.delta, rating, games });
				else close();
				return;
			}
			case "already_completed":
				toast("이미 완료된 경기예요");
				if (pick) await submitOnly(pick.winner, pick.teamA);
				else close();
				return;
			case "not_in_match":
				toast("이 경기의 선수가 아니라 완료할 수 없어요", { variant: "error" });
				close();
				return;
			case "busy":
				return; // 앞선 요청이 진행 중 — 그 결과가 창을 닫는다
			default:
				// 네트워크·세션 비활성 — 창을 남겨 다시 누를 수 있게 한다.
				toast("경기를 완료하지 못했어요. 다시 시도해 주세요", { variant: "error" });
		}
	};

	const run = async (pick: MatchResultPick | null) => {
		if (busy) return;
		setBusy(true);
		try {
			// 창이 열린 사이 편집권을 잃었으면 자기 코트일 때만 회원 경로로 넘어간다.
			const mode = request.mode === "editor" && claimEdit() ? "editor" : snap.mySide ? "member" : null;
			if (!mode) {
				toast("편집 권한이 없어 경기를 완료하지 못했어요", { variant: "error" });
				close();
				return;
			}
			if (mode === "editor") await finishAsEditor(pick);
			else await finishAsMember(pick);
		} finally {
			setBusy(false);
		}
	};

	return (
		<MatchResultDialog
			teamA={snap.teamA}
			teamB={snap.teamB}
			mySide={snap.mySide}
			me={snap.me}
			busy={busy}
			outcome={outcome}
			title={`${courtId}번 코트 · 누가 이겼나요?`}
			onSubmit={(pick) => void run(pick)}
			onSkip={() => void run(null)}
			onClose={() => {
				if (!busy) close();
			}}
		/>
	);
}
