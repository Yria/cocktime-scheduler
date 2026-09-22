import { useAdminCoverageStore } from "../../store/adminCoverageStore";
import { useBoardStore } from "../../store/boardStore";
import { useSessionStore } from "../../store/sessionStore";
import { useMatchProposalStore } from "../../store/matchProposalStore";
import { toast } from "../../store/toastStore";
import { adminCoverageDecision, type CoverageInputs } from "./adminCoverage";

export function currentCoverageInputs(): CoverageInputs {
	const coverage = useAdminCoverageStore.getState();
	return { ...useBoardStore.getState(), ...useSessionStore.getState(), adminMemberIds: coverage.memberIds,
		startingIds: new Set([...coverage.starting.values()].flat()), proposals: useMatchProposalStore.getState().proposals };
}

/** Confirmation applies only to the roster the editor saw; every retry rechecks current state. */
export function acquireAdminCoverage(key: string, ids: string[], onConfirm: () => Promise<void>, approvedIds?: readonly string[]): boolean {
	const state = useAdminCoverageStore.getState();
	if (state.starting.has(key)) return false;
	if ([...state.starting.values()].some(group => group.some(id => ids.includes(id)))) {
		toast("같은 회원이 포함된 경기의 시작을 처리하고 있어요.", { variant: "error" }); return false;
	}
	if (!state.loaded) { toast("운영진 정보를 확인하고 있어요. 잠시 후 다시 눌러주세요.", { variant: "error" }); return false; }
	const { held, alternative } = adminCoverageDecision(ids, currentCoverageInputs());
	const approved = approvedIds?.length === ids.length && ids.every(id => approvedIds.includes(id));
	if (held && !approved) {
		useAdminCoverageStore.setState({ prompt: {
			key, names: ids.map(id => useSessionStore.getState().sessionPlayers.get(id)?.name ?? "").join(" · "), alternative, onConfirm,
		} });
		return false;
	}
	useAdminCoverageStore.setState({ starting: new Map(state.starting).set(key, [...ids]), prompt: null });
	return true;
}

export function releaseAdminCoverage(key: string) {
	useAdminCoverageStore.setState(state => {
		const starting = new Map(state.starting); starting.delete(key); return { starting };
	});
}
