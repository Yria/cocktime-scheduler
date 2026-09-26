import { create } from "zustand";
import {
	createMatchAvoidGroup, deleteMatchAvoidGroup, fetchBoardSelectionRules, fetchMatchAvoidGroups, type MatchAvoidGroup,
} from "../lib/supabase/matchAvoid";
import { avoidGroupError, sameAvoidGroup } from "../lib/teamSelection/avoidGroups";
import { useAuthStore } from "./authStore";
import { toast } from "./toastStore";

/**
 * 같이 매칭하지 않기.
 * - rules: 자동편성에 쓰는 이번 회차 묶음(회원 id). 운영진 기기가 보드에서 불러온다. 화면에는 드러내지 않는다.
 * - owner/groups/names: 목록 주인 한 명만 쓰는 설정 화면용 전체 목록.
 */
export type MatchAvoidStatus = "idle" | "loading" | "ready" | "error";
interface MatchAvoidState {
	owner: boolean;
	rules: string[][];
	rulesStatus: MatchAvoidStatus;
	groups: MatchAvoidGroup[];
	/** members.id → 이름. 현재 회차에 없는 회원도 목록에 이름으로 보이게. */
	names: Map<string, string>;
	/** ready 전에는 저장을 막는다 — 빈 목록 기준 중복 검사를 믿을 수 없다. */
	status: MatchAvoidStatus;
	loadRules: (sessionId: number) => Promise<void>;
	load: () => Promise<void>;
	add: (memberIds: string[], names: ReadonlyMap<string, string>) => Promise<boolean>;
	remove: (id: string) => Promise<boolean>;
	reset: () => void;
}

// 저장·삭제가 끝난 뒤 도착한, 그 전에 시작된 불러오기 결과는 버린다. 같은 종류의 불러오기는 마지막 것이 이긴다.
let mutations = 0, rulesSeq = 0, listSeq = 0;
let rulesSession: number | null = null;
export const useMatchAvoidStore = create<MatchAvoidState>((set, get) => ({
	owner: false,
	rules: [],
	rulesStatus: "idle",
	groups: [],
	names: new Map(),
	status: "idle",
	loadRules: async (sessionId) => {
		const seq = ++rulesSeq, before = mutations;
		rulesSession = sessionId;
		const result = await fetchBoardSelectionRules(sessionId);
		if (seq !== rulesSeq || before !== mutations) return;
		// 실패하면 이전 규칙을 유지한다 — 빈 규칙으로 덮으면 제약이 조용히 풀린다.
		if (result) set({ owner: result.owner, rules: result.groups, rulesStatus: "ready" });
		else set({ rulesStatus: "error" });
	},
	load: async () => {
		const seq = ++listSeq, before = mutations;
		if (get().status !== "ready") set({ status: "loading" });
		const result = await fetchMatchAvoidGroups();
		if (seq !== listSeq || before !== mutations) return;
		if (result) set({ groups: result.groups, names: result.names, status: "ready" });
		else set({ status: "error" });
	},
	add: async (memberIds, names) => {
		if (get().status !== "ready") { toast("저장된 묶음을 먼저 불러와 주세요", { variant: "error" }); return false; }
		const error = avoidGroupError(memberIds, get().groups.map(group => group.memberIds));
		if (error) { toast(error, { variant: "error" }); return false; }
		const group = await createMatchAvoidGroup(memberIds);
		if (group === "duplicate") {
			toast("이미 같은 묶음이 있어요", { variant: "error" });
			void get().load();
			return false;
		}
		if (!group) { toast("저장하지 못했어요. 연결을 확인하고 다시 시도해 주세요", { variant: "error" }); return false; }
		mutations++;
		// 이번 회차에 없는 사람이 섞여 있어도 규칙에 넣어 둔다(선발은 이번 회차 선수만 본다).
		set(state => ({ groups: [...state.groups, group], names: new Map([...state.names, ...names]), rules: [...state.rules, group.memberIds] }));
		if (rulesSession != null) void get().loadRules(rulesSession);
		return true;
	},
	remove: async (id) => {
		const group = get().groups.find(item => item.id === id);
		if (!(await deleteMatchAvoidGroup(id))) { toast("삭제하지 못했어요. 연결을 확인하고 다시 시도해 주세요", { variant: "error" }); return false; }
		mutations++;
		set(state => {
			const remaining = state.groups.filter(item => item.id !== id);
			// 서버 규칙은 이번 회차 사람만 담으므로, 지운 묶음에 포함되고 남은 묶음에는 없는 규칙을 뺀다.
			const covered = (rule: string[]) => remaining.some(item => sameAvoidGroup(rule, item.memberIds, true));
			return { groups: remaining, rules: group ? state.rules.filter(rule => !sameAvoidGroup(rule, group.memberIds, true) || covered(rule)) : state.rules };
		});
		if (rulesSession != null) void get().loadRules(rulesSession);
		return true;
	},
	reset: () => {
		mutations++; rulesSeq++; listSeq++; rulesSession = null;
		set({ owner: false, rules: [], rulesStatus: "idle", groups: [], names: new Map(), status: "idle" });
	},
}));

/** 자동편성·추천 입력용 회원 id 묶음. */
export const matchAvoidGroups = () => useMatchAvoidStore.getState().rules;

// 계정이 바뀌면(로그아웃 포함) 묶음과 주인 표시를 메모리에서 바로 지운다.
useAuthStore.subscribe((next, previous) => {
	if (next.memberId !== previous.memberId || next.isAdmin !== previous.isAdmin) useMatchAvoidStore.getState().reset();
});
