import { useEffect } from "react";
import { create } from "zustand";
import type { AccountingData, AccountingMode } from "../lib/dues/v2/types";
import {
	accountingError,
	accountingMode,
	readAccounting,
} from "../lib/supabase/accountingV2";
import { useAuthStore } from "./authStore";
import { entryAlertActions } from "./entryAlertStore";
import { duesActions, useDuesStore } from "./duesStore";

interface State {
	mode: AccountingMode | null;
	modeError: string | null;
	data: AccountingData | null;
	owner: string | null;
	loading: boolean;
	error: string | null;
}
export const useAccountingStore = create<State>(() => ({
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

export const accountingActions = {
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
				const old = useAccountingStore.getState().mode;
				if (old && old.enabled !== mode.enabled) {
					duesActions.invalidateMonth();
					duesActions.resetUnpaidAlert();
					useDuesStore.setState({ myLedgerYm: null, myLedger: null });
				}
				useAccountingStore.setState({
					mode,
					modeError: null,
					...(old?.epoch !== mode.epoch || !mode.enabled ? { data: null } : {}),
				});
			} catch (e) {
				if (seq === modeSeq && useAuthStore.getState().memberId === member)
					useAccountingStore.setState({ modeError: accountingError(e) });
			} finally {
				if (seq === modeSeq) modeRequest = null;
			}
		})();
		return modeRequest;
	},
	async load() {
		const member = useAuthStore.getState().memberId;
		if (!member) return;
		const seq = ++dataSeq;
		useAccountingStore.setState({ loading: true, error: null });
		try {
			const data = await readAccounting();
			if (seq !== dataSeq || useAuthStore.getState().memberId !== member)
				return;
			useAccountingStore.setState({
				mode: { ...data.mode, available: true },
				data: data.mode.enabled ? data : null,
				owner: member,
				loading: false,
			});
		} catch (e) {
			if (seq === dataSeq && useAuthStore.getState().memberId === member)
				useAccountingStore.setState({
					loading: false,
					error: accountingError(e),
				});
		}
	},
	reset() {
		dataSeq++;
		modeSeq++;
		modeRequest = null;
		useAccountingStore.setState({
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
		accountingActions.reset();
});

export function useAccountingMode() {
	const member = useAuthStore((s) => s.memberId);
	const mode = useAccountingStore((s) => s.mode);
	const error = useAccountingStore((s) => s.modeError);
	useEffect(() => {
		if (!member) return;
		void accountingActions.mode();
		const update = () => {
			if (document.visibilityState === "visible") void accountingActions.mode();
		};
		const timer = window.setInterval(update, 15_000);
		window.addEventListener("focus", update);
		return () => {
			window.clearInterval(timer);
			window.removeEventListener("focus", update);
		};
	}, [member]);
	return { mode, error };
}

export function useAccountingData() {
	const member = useAuthStore((s) => s.memberId);
	const epoch = useAccountingStore((s) => s.mode?.epoch);
	const enabled = useAccountingStore((s) => s.mode?.enabled);
	const revision = useAccountingStore((s) => s.mode?.revision);
	const data = useAccountingStore((s) => (s.owner === member ? s.data : null));
	const error = useAccountingStore((s) => s.error);
	const loading = useAccountingStore((s) => s.loading);
	useEffect(() => {
		if (member && enabled) void accountingActions.load();
	}, [member, epoch, enabled, revision]);
	return { data, error, loading, refresh: accountingActions.load };
}
