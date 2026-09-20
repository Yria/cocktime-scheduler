import { useEffect } from "react";
import { create } from "zustand";
import type {
	AccountingCommand,
	AccountingData,
	AccountingMode,
} from "../lib/dues/types";
import { applyAccountingPatch } from "../lib/dues/accountingPatch";
import {
	accountingError,
	accountingMode,
	commitAccounting,
	readAccounting,
} from "../lib/supabase/dues";
import { useAuthStore } from "./authStore";
import { entryAlertActions } from "./entryAlertStore";

interface State {
	mode: AccountingMode | null;
	modeError: string | null;
	data: AccountingData | null;
	owner: string | null;
	loading: boolean;
	error: string | null;
}
export const useDuesStore = create<State>(() => ({
	mode: null,
	modeError: null,
	data: null,
	owner: null,
	loading: false,
	error: null,
}));
let modeRequest: Promise<void> | null = null;
let modeSeq = 0;
let dataSeq = 0;
let identitySeq = 0;
let dataRequest: { key: string; promise: Promise<void> } | null = null;
const dataKey = () => {
	const mode = useDuesStore.getState().mode;
	return `${useAuthStore.getState().memberId}:${mode?.epoch}:${mode?.revision}`;
};

export const duesActions = {
	async commit(
		payload: AccountingCommand,
		requestId: string,
		revision: number,
	) {
		const identity = identitySeq;
		const epoch = useDuesStore.getState().data?.mode.epoch;
		const result = await commitAccounting(payload, requestId, revision);
		const state = useDuesStore.getState();
		if (identity !== identitySeq || state.data?.mode.epoch !== epoch)
			return result;
		const data = state.data && applyAccountingPatch(state.data, result);
		if (!data) {
			// Older servers or an intervening snapshot need one authoritative read.
			await duesActions.load();
			return result;
		}
		if (data !== state.data) {
			// Discard a read started before the commit; it must not undo this delta.
			dataSeq++;
			dataRequest = null;
			useDuesStore.setState({
				data,
				mode:
					state.mode && state.mode.revision > data.mode.revision
						? state.mode
						: { ...data.mode, available: true },
				loading: false,
				error: null,
			});
			if (state.mode && state.mode.revision > data.mode.revision)
				await duesActions.ensure();
		}
		return result;
	},
	async mode() {
		if (modeRequest) return modeRequest;
		const member = useAuthStore.getState().memberId;
		if (!member) return;
		const seq = ++modeSeq;
		modeRequest = (async () => {
			try {
				const mode = await accountingMode();
				if (seq !== modeSeq || useAuthStore.getState().memberId !== member)
					return;
				const old = useDuesStore.getState().mode;
				if (old?.epoch === mode.epoch && old.revision > mode.revision) return;
				useDuesStore.setState({
					mode,
					modeError: null,
					...(old?.epoch !== mode.epoch || !mode.enabled ? { data: null } : {}),
				});
			} catch (e) {
				if (seq === modeSeq && useAuthStore.getState().memberId === member)
					useDuesStore.setState({ modeError: accountingError(e) });
			} finally {
				if (seq === modeSeq) modeRequest = null;
			}
		})();
		return modeRequest;
	},
	async ensure() {
		const { data, mode, owner } = useDuesStore.getState();
		if (
			owner === useAuthStore.getState().memberId &&
			data &&
			mode &&
			data.mode.epoch === mode.epoch &&
			data.mode.revision === mode.revision
		)
			return;
		if (dataRequest?.key === dataKey()) return dataRequest.promise;
		return duesActions.load();
	},
	load() {
		const promise = duesActions.fetchData();
		const request = { key: dataKey(), promise };
		dataRequest = request;
		void promise.finally(() => {
			if (dataRequest === request) dataRequest = null;
		});
		return promise;
	},
	async fetchData() {
		const member = useAuthStore.getState().memberId;
		if (!member) return;
		const seq = ++dataSeq;
		useDuesStore.setState({ loading: true, error: null });
		try {
			const data = await readAccounting();
			if (seq !== dataSeq || useAuthStore.getState().memberId !== member)
				return;
			useDuesStore.setState({
				mode: { ...data.mode, available: true },
				data: data.mode.enabled ? data : null,
				owner: member,
				loading: false,
			});
		} catch (e) {
			if (seq === dataSeq && useAuthStore.getState().memberId === member)
				useDuesStore.setState({
					loading: false,
					error: accountingError(e),
				});
		}
	},
	reset() {
		identitySeq++;
		dataSeq++;
		dataRequest = null;
		modeSeq++;
		modeRequest = null;
		useDuesStore.setState({
			mode: null,
			modeError: null,
			data: null,
			owner: null,
			loading: false,
			error: null,
		});
	},
};

// Clear private snapshots synchronously when identity changes, including logout.
useAuthStore.subscribe((next, previous) => {
	if (next.memberId !== previous.memberId) entryAlertActions.reset();
	if (next.memberId !== previous.memberId || next.isAdmin !== previous.isAdmin)
		duesActions.reset();
});

let modeConsumers = 0;
let stopModePolling: (() => void) | null = null;
function watchMode() {
	if (modeConsumers++ === 0) {
		void duesActions.mode();
		const update = () => {
			if (document.visibilityState === "visible") void duesActions.mode();
		};
		const timer = window.setInterval(update, 15_000);
		window.addEventListener("focus", update);
		stopModePolling = () => {
			window.clearInterval(timer);
			window.removeEventListener("focus", update);
		};
	}
	return () => {
		if (--modeConsumers === 0) {
			stopModePolling?.();
			stopModePolling = null;
		}
	};
}
export function useDuesMode() {
	const member = useAuthStore((s) => s.memberId);
	const isAdmin = useAuthStore((s) => s.isAdmin);
	const mode = useDuesStore((s) => s.mode);
	const error = useDuesStore((s) => s.modeError);
	useEffect(() => {
		if (member) return watchMode();
	}, [member, isAdmin]);
	return { mode, error };
}

export function useDuesData() {
	const member = useAuthStore((s) => s.memberId);
	const epoch = useDuesStore((s) => s.mode?.epoch);
	const enabled = useDuesStore((s) => s.mode?.enabled);
	const revision = useDuesStore((s) => s.mode?.revision);
	const data = useDuesStore((s) => (s.owner === member ? s.data : null));
	const error = useDuesStore((s) => s.error);
	const loading = useDuesStore((s) => s.loading);
	useEffect(() => {
		if (member && enabled) void duesActions.ensure();
	}, [member, epoch, enabled, revision]);
	return { data, error, loading, refresh: duesActions.load };
}
