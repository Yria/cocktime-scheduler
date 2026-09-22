import { create } from "zustand";
import type { ProposalComposerSnapshot, ProposalGroup } from "../lib/board/matchProposals";
import type { MatchProposal } from "../lib/supabase/matchProposals";
import type { StagePoint } from "../types/board";

interface MatchProposalState extends ProposalComposerSnapshot {
	scope: string | null;
	proposals: MatchProposal[];
	loading: boolean;
	error: string | null;
	revision: number;
	targetProposalId: string | null;
	setGroups: (groups: ProposalGroup[]) => void;
	reset: (scope?: string, enabled?: boolean, viewerId?: string, isAdmin?: boolean) => void;
}

const empty = () => ({ groups: [], proposals: [], anchors: new Map<string, StagePoint>(), sendingIds: new Set<string>(),
	resolvingIds: new Set<string>(), viewerId: null, isAdmin: false, loading: false, error: null, revision: 0, targetProposalId: null });

/** Deliberately separate from boardStore and its shared-draft persistence subscription. */
export const useMatchProposalStore = create<MatchProposalState>((set) => ({
	...empty(), scope: null, enabled: false,
	setGroups: (groups) => set({ groups }),
	reset: (scope, enabled = false, viewerId, isAdmin = false) => set({ ...empty(), scope: scope ?? null, enabled, viewerId: viewerId ?? null, isAdmin }),
}));
