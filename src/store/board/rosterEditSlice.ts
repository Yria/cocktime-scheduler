import type { StateCreator } from "zustand";
import { canUseMatchPlayer, currentMatchEdit, rosterSaveKey, sameRoster } from "../../lib/board/matchRosterEdit";
import { useSessionStore } from "../sessionStore";
import { toast } from "../toastStore";
import type { BoardState } from "./types";

type RosterEditSlice = Pick<BoardState, "matchEdits" | "stageMatchPlayer" | "cancelMatchEdit" | "applyMatchEdit" | "reconcileMatchEdits">;

export const createRosterEditSlice: StateCreator<BoardState, [["zustand/devtools", never], ["zustand/immer", never]], [], RosterEditSlice> = (set, get) => ({
	matchEdits: new Map(),
	stageMatchPlayer: (courtId, slot, playerId) => {
		const session = useSessionStore.getState();
		const court = session.courts.find(c => c.id === courtId);
		const linked = [...get().drafts.values()].find(team => team.courtId === courtId);
		if (!session.isEditor || !court?.match || slot < 0 || slot > 3 || !Number.isInteger(slot)
			|| get().assigningTeamIds.has(rosterSaveKey(courtId)) || get().assigningTeamIds.has(linked?.id ?? `complete:${courtId}`)) return;
		if (!canUseMatchPlayer(playerId, courtId, session, get().matchEdits)) return;
		const original = [...court.match.teamA, ...court.match.teamB];
		const current = currentMatchEdit(get().matchEdits.get(courtId), court);
		const roster = [...(current?.roster ?? original)];
		if (roster[slot] === playerId) return;
		const from = roster.indexOf(playerId);
		if (from >= 0) roster[from] = roster[slot];
		roster[slot] = playerId;
		set(s => {
			if (sameRoster(original, roster)) s.matchEdits.delete(courtId);
			else s.matchEdits.set(courtId, { matchId: court.match!.id, original, roster });
		});
	},
	cancelMatchEdit: courtId => {
		if (get().assigningTeamIds.has(rosterSaveKey(courtId))) return;
		set(s => { s.matchEdits.delete(courtId); });
	},
	reconcileMatchEdits: () => {
		const session = useSessionStore.getState();
		set(s => {
			for (const [courtId, edit] of s.matchEdits) {
				if (!session.isEditor || (!s.assigningTeamIds.has(rosterSaveKey(courtId))
					&& (!currentMatchEdit(edit, session.courts.find(c => c.id === courtId))
						|| edit.roster.some(id => !canUseMatchPlayer(id, courtId, session, s.matchEdits))))) s.matchEdits.delete(courtId);
			}
		});
	},
	applyMatchEdit: async courtId => {
		const key = rosterSaveKey(courtId);
		if (!useSessionStore.getState().isEditor || get().assigningTeamIds.has(key)) return;
		get().reconcileMatchEdits();
		const edit = get().matchEdits.get(courtId);
		if (!edit) return;
		const sessionId = get().sessionId;
		get().markManualLayout(); // 명단 저장 후에도 현재 코트/자석 위치를 유지한다.
		set(s => { s.assigningTeamIds.add(key); });
		try {
			const [a, b, c, d] = edit.roster;
			await get().setMatchRoster(courtId, [a, b], [c, d]);
			if (get().sessionId !== sessionId || get().matchEdits.get(courtId) !== edit) return;
			const match = useSessionStore.getState().courts.find(court => court.id === courtId)?.match;
			if (match?.id === edit.matchId && sameRoster([...match.teamA, ...match.teamB], edit.roster)) {
				get().healPlayingAnchors();
				set(s => { s.matchEdits.delete(courtId); });
			} else if (get().matchEdits.get(courtId) === edit) {
				toast("선수 변경을 저장하지 못했어요. 다시 눌러 주세요", { variant: "error" });
			}
		} catch {
			if (get().sessionId === sessionId && get().matchEdits.get(courtId) === edit) toast("선수 변경을 저장하지 못했어요. 다시 눌러 주세요", { variant: "error" });
		} finally {
			if (get().sessionId === sessionId && (!get().matchEdits.has(courtId) || get().matchEdits.get(courtId) === edit)) {
				set(s => { s.assigningTeamIds.delete(key); });
				get().reconcileMatchEdits();
			}
		}
	},
});
