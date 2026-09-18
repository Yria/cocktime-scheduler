import { create } from "zustand";
import type { ProposalComposerSnapshot, ProposalGroup } from "../lib/board/matchProposals";
import type { MatchProposal } from "../lib/supabase/matchProposals";

interface MatchProposalState extends ProposalComposerSnapshot {
	scope: string | null;
	proposals: MatchProposal[];
	loading: boolean;
	error: string | null;
	revision: number;
	setGroups: (groups: ProposalGroup[]) => void;
	reset: (scope?: string, enabled?: boolean) => void;
}

const empty = () => ({ groups: [], proposals: [], sendingIds: new Set<string>(), loading: false, error: null, revision: 0 });

/** Deliberately separate from boardStore and its shared-draft persistence subscription. */
export const useMatchProposalStore = create<MatchProposalState>((set) => ({
	...empty(), scope: null, enabled: false,
	setGroups: (groups) => set({ groups }),
	reset: (scope, enabled = false) => set({ ...empty(), scope: scope ?? null, enabled }),
}));
