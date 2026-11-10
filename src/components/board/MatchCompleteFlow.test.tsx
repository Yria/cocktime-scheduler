import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MatchResultPick } from "../match/MatchResultDialog";

// MatchCompleteFlow 가 결과 창에서 고친 실제 편(teamA)을 세 경로(회원·편집자·이미 완료) 모두 서버까지 넘기는지.
// DOM 없이 서버 렌더로 한 번 그려 MatchResultDialog 에 넘긴 props 를 잡고, onSubmit 을 직접 부른다.
interface DialogProps {
	teamA: { spId?: string; name: string }[];
	teamB: { spId?: string }[];
	mySide?: string;
	onSubmit: (p: MatchResultPick) => void;
	onSkip: () => void;
}
const h = vi.hoisted(() => ({
	dialogProps: null as unknown,
	board: {} as Record<string, unknown>,
	session: {} as Record<string, unknown>,
	claim: true,
	ratingSubmit: vi.fn(),
	submitMatchResult: vi.fn(),
	toast: vi.fn(),
}));

vi.mock("../match/MatchResultDialog", () => ({
	default: (props: unknown) => {
		h.dialogProps = props;
		return null;
	},
}));
vi.mock("../../store/boardStore", () => {
	const useBoardStore = (sel: (s: unknown) => unknown) => sel(h.board);
	useBoardStore.getState = () => h.board;
	return { useBoardStore };
});
vi.mock("../../store/sessionStore", () => ({ useSessionStore: { getState: () => h.session } }));
vi.mock("../../store/authStore", () => ({ useAuthStore: { getState: () => ({ memberId: "m-c" }) } }));
vi.mock("../../store/board/draftsSync", () => ({ claimEdit: () => h.claim }));
vi.mock("../../store/ratingStore", () => ({
	useRatingStore: { getState: () => ({ submit: h.ratingSubmit, loadMy: vi.fn(async () => {}), my: null }) },
}));
vi.mock("../../lib/supabase/matchResults", () => ({ submitMatchResult: h.submitMatchResult }));
vi.mock("../../store/toastStore", () => ({ toast: h.toast }));

import MatchCompleteFlow from "./MatchCompleteFlow";

const sp = (id: string) => ({ id, playerId: id, memberId: `m-${id}`, name: id, gender: "M" });
const match = { id: "M1", courtId: 1, teamA: ["a", "b"], teamB: ["c", "d"] };
const flush = () => new Promise((r) => setTimeout(r, 0));

function open(mode: "member" | "editor") {
	h.dialogProps = null;
	h.board = {
		completeRequest: { courtId: 1, matchId: "M1", mode },
		closeCompleteRequest: vi.fn(),
		completeMatchAsMember: vi.fn(async () => ({ status: "completed", arrange: "ok", result: null })),
		completeMatch: vi.fn(async () => {
			h.session.courts = [{ id: 1, match: null }];
		}),
	};
	h.session = {
		courts: [{ id: 1, match }],
		sessionPlayers: new Map(["a", "b", "c", "d"].map((id) => [id, sp(id)])),
	};
	renderToString(createElement(MatchCompleteFlow));
	const props = h.dialogProps as DialogProps | null;
	if (!props) throw new Error("dialog not rendered");
	return props;
}

beforeEach(() => {
	vi.clearAllMocks();
	h.claim = true;
	h.ratingSubmit.mockResolvedValue({ status: "recorded", outcome: null });
	h.submitMatchResult.mockResolvedValue({ status: "recorded", result: null });
});

describe("MatchCompleteFlow — 실제 편 전달", () => {
	it("창에 session_players.id 를 spId 로 넘기고 내 쪽(보드 B)을 알려 준다", () => {
		h.claim = false;
		const props = open("member");
		expect(props.teamA.map((p) => p.spId)).toEqual(["a", "b"]);
		expect(props.teamB.map((p) => p.spId)).toEqual(["c", "d"]);
		expect(props.mySide).toBe("B");
	});

	it("회원 경로: completeMatchAsMember 에 winner 와 teamA 를 그대로", async () => {
		h.claim = false;
		const props = open("member");
		const pick: MatchResultPick = { winner: "A", teamA: ["b", "d"] };
		props.onSubmit(pick);
		await flush();
		expect(h.board.completeMatchAsMember).toHaveBeenCalledExactlyOnceWith(1, "M1", "A", ["b", "d"]);
	});

	it("회원 경로 건너뛰기: winner·teamA 없이 완료", async () => {
		h.claim = false;
		const props = open("member");
		props.onSkip();
		await flush();
		expect(h.board.completeMatchAsMember).toHaveBeenCalledExactlyOnceWith(1, "M1", null, null);
	});

	it("편집자 경로(내가 뛴 경기): 완료 뒤 ratingStore.submit 에 teamA", async () => {
		const props = open("editor");
		props.onSubmit({ winner: "B", teamA: ["a", "c"] } satisfies MatchResultPick);
		await flush();
		expect(h.board.completeMatch).toHaveBeenCalledOnce();
		expect(h.ratingSubmit).toHaveBeenCalledExactlyOnceWith("M1", "B", ["a", "c"]);
	});

	it("이미 완료(동시 탭): 결과만 제출할 때도 teamA", async () => {
		const props = open("editor");
		h.session.courts = [{ id: 1, match: null }];
		props.onSubmit({ winner: "A", teamA: ["a", "d"] } satisfies MatchResultPick);
		await flush();
		expect(h.board.completeMatch).not.toHaveBeenCalled();
		expect(h.ratingSubmit).toHaveBeenCalledExactlyOnceWith("M1", "A", ["a", "d"]);
	});
});
