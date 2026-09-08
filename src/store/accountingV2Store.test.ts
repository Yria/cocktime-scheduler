import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AccountingData, AccountingMode } from "../lib/dues/v2/types";
import { accountingMode, readAccounting } from "../lib/supabase/accountingV2";
import { accountingActions, useAccountingStore } from "./accountingV2Store";
import { useAuthStore } from "./authStore";
import { useDuesStore } from "./duesStore";
import { entryAlertActions, useEntryAlertStore } from "./entryAlertStore";
vi.mock("../lib/supabase/accountingV2", () => ({
	accountingMode: vi.fn(),
	readAccounting: vi.fn(),
	accountingError: (e: Error) => e.message,
}));
const active: AccountingMode = {
	available: true,
	enabled: true,
	paused: false,
	revision: 1,
	epoch: "test",
};
const snapshot = (mode = active) =>
	({ mode, charges: [] }) as unknown as AccountingData;
function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((r) => {
		resolve = r;
	});
	return { resolve, promise };
}
beforeEach(() => {
	vi.resetAllMocks();
	useAuthStore.setState({ memberId: "A", isAdmin: false });
	accountingActions.reset();
});
describe("accounting identity and rollout state", () => {
	it("discards a private in-flight response when the account changes", async () => {
		const pending = deferred<AccountingData>();
		vi.mocked(readAccounting).mockReturnValueOnce(pending.promise);
		const loading = accountingActions.load();
		useAuthStore.setState({ memberId: "B" });
		pending.resolve(snapshot());
		await loading;
		expect(useAccountingStore.getState().data).toBeNull();
		expect(useAccountingStore.getState().owner).toBeNull();
		expect(useAccountingStore.getState().loading).toBe(false);
	});
	it("does not let an earlier refresh overwrite the latest response", async () => {
		const old = deferred<AccountingData>();
		vi.mocked(readAccounting)
			.mockReturnValueOnce(old.promise)
			.mockResolvedValueOnce(snapshot({ ...active, revision: 2 }));
		const loading = accountingActions.load();
		await accountingActions.load();
		old.resolve(snapshot());
		await loading;
		expect(useAccountingStore.getState().mode?.revision).toBe(2);
	});
	it("shares an in-flight read and skips reads already satisfied by a refreshed revision", async () => {
		useAccountingStore.setState({ mode: active });
		const pending = deferred<AccountingData>();
		vi.mocked(readAccounting).mockReturnValueOnce(pending.promise);
		const first = accountingActions.ensure();
		const second = accountingActions.ensure();
		expect(readAccounting).toHaveBeenCalledTimes(1);
		pending.resolve(snapshot());
		await Promise.all([first, second]);
		await accountingActions.ensure();
		expect(readAccounting).toHaveBeenCalledTimes(1);
		vi.mocked(readAccounting).mockResolvedValueOnce(
			snapshot({ ...active, revision: 2 }),
		);
		await accountingActions.load(); // explicit post-commit refresh
		await accountingActions.ensure(); // React sees revision 2
		expect(readAccounting).toHaveBeenCalledTimes(2);
	});
	it("does not regress to a mode response started before a successful refresh", async () => {
		useAccountingStore.setState({ mode: active });
		const pending = deferred<AccountingMode>();
		vi.mocked(accountingMode).mockReturnValueOnce(pending.promise);
		const poll = accountingActions.mode();
		vi.mocked(readAccounting).mockResolvedValueOnce(
			snapshot({ ...active, revision: 2 }),
		);
		await accountingActions.load();
		pending.resolve(active);
		await poll;
		expect(useAccountingStore.getState().mode?.revision).toBe(2);
	});
	it("retains the server mode on a network failure and reports the error", async () => {
		useAccountingStore.setState({ mode: active });
		vi.mocked(accountingMode).mockRejectedValueOnce(new Error("offline"));
		await accountingActions.mode();
		expect(useAccountingStore.getState().mode?.enabled).toBe(true);
		expect(useAccountingStore.getState().modeError).toBe("offline");
	});
	it("invalidates legacy caches on rollback and removes the V2 snapshot", async () => {
		useAccountingStore.setState({ mode: active, data: snapshot(), owner: "A" });
		useDuesStore.setState({
			loadedYm: "2026-08",
			manualLoadedYm: "2026-08",
			myLedgerYm: "2026-08",
			unpaidAlertCheckedFor: "A",
		});
		vi.mocked(accountingMode).mockResolvedValueOnce({
			...active,
			enabled: false,
			revision: 2,
		});
		await accountingActions.mode();
		expect(useAccountingStore.getState().data).toBeNull();
		expect(useDuesStore.getState().loadedYm).toBeNull();
		expect(useDuesStore.getState().manualLoadedYm).toBeNull();
		expect(useDuesStore.getState().myLedgerYm).toBeNull();
		expect(useDuesStore.getState().unpaidAlertCheckedFor).toBeNull();
	});
	it("clears dismissed reminders and private data on logout or role changes", () => {
		entryAlertActions.close("unpaidDues");
		useAccountingStore.setState({ data: snapshot(), owner: "A", mode: active });
		useAuthStore.setState({ isAdmin: true });
		expect(useAccountingStore.getState().data).toBeNull();
		useAuthStore.setState({ memberId: null });
		expect(useEntryAlertStore.getState().closed).toEqual({});
	});
});
