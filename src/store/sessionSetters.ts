import type {
	Court,
	GeneratedTeam,
	PairHistory,
	ReservedGroup,
	SessionPlayer,
} from "../types";
import { useSessionStore } from "./sessionStore";

export const setCourts = (updater: Court[] | ((prev: Court[]) => Court[])) =>
	useSessionStore.setState((state) => ({
		courts: typeof updater === "function" ? updater(state.courts) : updater,
	}));

export const setWaiting = (
	updater: SessionPlayer[] | ((prev: SessionPlayer[]) => SessionPlayer[]),
) =>
	useSessionStore.setState((state) => ({
		waiting: typeof updater === "function" ? updater(state.waiting) : updater,
	}));

export const setResting = (
	updater: SessionPlayer[] | ((prev: SessionPlayer[]) => SessionPlayer[]),
) =>
	useSessionStore.setState((state) => ({
		resting: typeof updater === "function" ? updater(state.resting) : updater,
	}));

export const setReservedGroups = (
	updater: ReservedGroup[] | ((prev: ReservedGroup[]) => ReservedGroup[]),
) =>
	useSessionStore.setState((state) => ({
		reservedGroups:
			typeof updater === "function" ? updater(state.reservedGroups) : updater,
	}));

export const setPairHistory = (
	updater: PairHistory | ((prev: PairHistory) => PairHistory),
) =>
	useSessionStore.setState((state) => ({
		pairHistory:
			typeof updater === "function" ? updater(state.pairHistory) : updater,
	}));

export const setLastMixedPlayerIds = (
	updater: string[] | ((prev: string[]) => string[]),
) =>
	useSessionStore.setState((state) => ({
		lastMixedPlayerIds:
			typeof updater === "function"
				? updater(state.lastMixedPlayerIds)
				: updater,
	}));

export const setPendingTeam = (team: GeneratedTeam | null) =>
	useSessionStore.setState({ pendingTeam: team });

export const setPendingGroupId = (groupId: string | null) =>
	useSessionStore.setState({ pendingGroupId: groupId });

export const setShowEndConfirm = (show: boolean) =>
	useSessionStore.setState({ showEndConfirm: show });

export const setShowReserveModal = (show: boolean) =>
	useSessionStore.setState({ showReserveModal: show });

export const setReservingSelected = (
	updater: Set<string> | ((prev: Set<string>) => Set<string>),
) =>
	useSessionStore.setState((state) => ({
		reservingSelected:
			typeof updater === "function"
				? updater(state.reservingSelected)
				: updater,
	}));
