import type {
	Court,
	PairHistory,
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

export const setLastCoPlayers = (
	updater:
		| Record<string, string[]>
		| ((prev: Record<string, string[]>) => Record<string, string[]>),
) =>
	useSessionStore.setState((state) => ({
		lastCoPlayers:
			typeof updater === "function"
				? updater(state.lastCoPlayers)
				: updater,
	}));

export const setShowEndConfirm = (show: boolean) =>
	useSessionStore.setState({ showEndConfirm: show });
