import { create } from "zustand";
import {
	fetchMyMatchHistory,
	fetchMyRating,
	type MatchResult,
	type MatchTeamA,
	type MatchWinner,
	type MyMatchRecord,
	type MyRating,
	type SubmitMatchResultResponse,
	submitMatchResult,
} from "../lib/supabase/matchResults";
import { useAuthStore } from "./authStore";

// 내 ELO 점수 · 내 승패 기록 스토어. waitPointStore 와 같은 결: 갱신 시점을 좁게 잡는다 —
// 앱 진입 1회(loadMy) + 결과 제출 직후(submit) + 내 정보(/me) 진입 때뿐이다.
// 폴링·구독 금지(무료 플랜 호출 폭주 이력, docs/MATCH_RESULT_ELO_SPEC.md §3.2). 점수는 결과가
// 입력돼야만 움직이고, 그건 대부분 이 기기에서 제출한 직후라 submit 이 직접 다시 읽는다.

const PAGE = 30;

interface RatingState {
	/** null = 아직 안 불러왔거나 조회 실패. 화면은 이때 등급 테두리를 감춘다. */
	my: MyRating | null;
	myLoading: boolean;
	history: MyMatchRecord[];
	historyLoading: boolean;
	historyLoaded: boolean;
	/** 마지막 페이지가 PAGE 만큼 꽉 찼으면 더 있을 수 있다. */
	historyHasMore: boolean;
	historyError: string | null;
	/** 결과 제출 RPC 왕복 중인 matchId(이중 제출 방지·버튼 busy) */
	submitting: string | null;

	loadMy: () => Promise<void>;
	loadHistory: (more?: boolean) => Promise<void>;
	/** teamA = 실제 A편 session_players.id 두 개(null = 보드 나눔). winner 는 그 A편 기준. */
	submit: (matchId: string, winner: MatchWinner, teamA?: MatchTeamA) => Promise<SubmitOutcome>;
	reset: () => void;
}

export interface SubmitOutcome {
	status: SubmitMatchResultResponse["status"];
	/** 갱신 후 그 경기의 내 기록(delta·ratingAfter 포함). 히스토리 첫 페이지에 없으면 null. */
	record: MyMatchRecord | null;
	/** 갱신 후 내 점수 */
	my: MyRating | null;
	/** 서버가 돌려준 확정 결과(나의 delta·ratingAfter·games 포함) */
	result: MatchResult | null;
	/** MatchResultDialog.showOutcome 에 그대로 넘길 값. 내 점수를 모르면 null */
	outcome: { delta: number | null; rating: number; games: number } | null;
}

const INITIAL = {
	my: null,
	myLoading: false,
	history: [] as MyMatchRecord[],
	historyLoading: false,
	historyLoaded: false,
	historyHasMore: false,
	historyError: null,
	submitting: null,
};

export const useRatingStore = create<RatingState>((set, get) => ({
	...INITIAL,

	async loadMy() {
		if (get().myLoading) return;
		set({ myLoading: true });
		const my = await fetchMyRating();
		set({ my, myLoading: false });
	},

	/**
	 * more=false → 첫 페이지부터 새로(내 정보 진입·제출 직후). more=true → 마지막 endedAt 이전 페이지 이어붙임.
	 * 인플라이트 가드로 중복 발사를 막는다(스크롤 끝 감지가 여러 번 불러도 한 번).
	 */
	async loadHistory(more = false) {
		const st = get();
		if (st.historyLoading) return;
		if (more && !st.historyHasMore) return;
		const before = more ? (st.history.at(-1)?.endedAt ?? null) : null;
		set({ historyLoading: true, historyError: null });
		try {
			const page = await fetchMyMatchHistory(PAGE, before);
			set((s) => {
				// 같은 endedAt 경계에서 겹칠 수 있어 matchId 로 중복 제거
				const base = more ? s.history : [];
				const seen = new Set(base.map((r) => r.matchId));
				return {
					history: [...base, ...page.filter((r) => !seen.has(r.matchId))],
					historyLoading: false,
					historyLoaded: true,
					historyHasMore: page.length >= PAGE,
				};
			});
		} catch (e) {
			set({
				historyLoading: false,
				historyLoaded: true,
				historyError:
					e instanceof Error
						? e.message
						: String((e as { message?: string })?.message ?? e),
			});
		}
	},

	/**
	 * 결과 제출 → 내 점수·기록을 다시 읽는다. 실패는 throw(호출부 토스트).
	 * status=exists(누가 먼저 입력)여도 다시 읽는다 — 화면이 그 확정 결과를 보여줘야 하므로.
	 */
	async submit(matchId, winner, teamA = null) {
		if (get().submitting === matchId) {
			return {
				status: "exists",
				record: findRecord(get().history, matchId),
				my: get().my,
				result: null,
				outcome: null,
			};
		}
		set({ submitting: matchId });
		try {
			const res = await submitMatchResult(matchId, winner, teamA);
			// 인플라이트 가드(loadMy/loadHistory)에 걸려 옛 값을 돌려주지 않도록 여기서 직접 읽는다.
			const [my, page] = await Promise.all([
				fetchMyRating(),
				fetchMyMatchHistory(PAGE, null).catch(() => null),
			]);
			set((s) => ({
				my: my ?? s.my,
				...(page
					? {
							history: page,
							historyLoaded: true,
							historyHasMore: page.length >= PAGE,
							historyError: null,
						}
					: {}),
			}));
			const st = get();
			const r = res.result;
			const rating = r?.ratingAfter ?? st.my?.rating ?? null;
			const games = r?.games ?? st.my?.games ?? null;
			return {
				status: res.status,
				record: findRecord(st.history, matchId),
				my: st.my,
				result: r,
				outcome:
					rating == null || games == null
						? null
						: { delta: r?.delta ?? null, rating, games },
			};
		} finally {
			set({ submitting: null });
		}
	},

	/** 로그아웃·회원 전환 시(다른 사람 점수가 남아 보이지 않게). */
	reset() {
		set({ ...INITIAL });
	},
}));

function findRecord(
	history: MyMatchRecord[],
	matchId: string,
): MyMatchRecord | null {
	return history.find((r) => r.matchId === matchId) ?? null;
}

/** waitPointActions 관례로 부르는 호출부용 별칭(같은 함수). */
export const ratingActions = {
	loadMy: () => useRatingStore.getState().loadMy(),
	loadHistory: (more?: boolean) => useRatingStore.getState().loadHistory(more),
	submit: (matchId: string, winner: MatchWinner, teamA: MatchTeamA = null) =>
		useRatingStore.getState().submit(matchId, winner, teamA),
	reset: () => useRatingStore.getState().reset(),
};

// 회원이 바뀌거나 로그아웃하면 즉시 비운다(duesStore 와 같은 결). Home 의 effect 만으로는
// Home 이 마운트돼 있지 않은 화면(/me 직행 등)에서 회원이 바뀌면 이전 사람의 기록 목록이 남는다.
useAuthStore.subscribe((next, previous) => {
	if (next.memberId !== previous.memberId) useRatingStore.getState().reset();
});
