import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AccountingData, AccountingMode } from "../lib/dues/types";
import { accountingMode, readAccounting } from "../lib/supabase/dues";
import { duesActions, useDuesStore } from "./duesStore";
import { useAuthStore } from "./authStore";
import { entryAlertActions, useEntryAlertStore } from "./entryAlertStore";
vi.mock("../lib/supabase/dues", () => ({
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
	duesActions.reset();
});
describe("accounting identity and rollout state", () => {
	it("discards a private in-flight response when the account changes", async () => {
		const pending = deferred<AccountingData>();
		vi.mocked(readAccounting).mockReturnValueOnce(pending.promise);
		const loading = duesActions.load();
		useAuthStore.setState({ memberId: "B" });
		pending.resolve(snapshot());
		await loading;
		expect(useDuesStore.getState().data).toBeNull();
		expect(useDuesStore.getState().owner).toBeNull();
		expect(useDuesStore.getState().loading).toBe(false);
	});
	it("does not let an earlier refresh overwrite the latest response", async () => {
		const old = deferred<AccountingData>();
		vi.mocked(readAccounting)
			.mockReturnValueOnce(old.promise)
			.mockResolvedValueOnce(snapshot({ ...active, revision: 2 }));
		const loading = duesActions.load();
		await duesActions.load();
		old.resolve(snapshot());
		await loading;
		expect(useDuesStore.getState().mode?.revision).toBe(2);
	});
	it("shares an in-flight read and skips reads already satisfied by a refreshed revision", async () => {
		useDuesStore.setState({ mode: active });
		const pending = deferred<AccountingData>();
		vi.mocked(readAccounting).mockReturnValueOnce(pending.promise);
		const first = duesActions.ensure();
		const second = duesActions.ensure();
		expect(readAccounting).toHaveBeenCalledTimes(1);
		pending.resolve(snapshot());
		await Promise.all([first, second]);
		await duesActions.ensure();
		expect(readAccounting).toHaveBeenCalledTimes(1);
		vi.mocked(readAccounting).mockResolvedValueOnce(
			snapshot({ ...active, revision: 2 }),
		);
		await duesActions.load(); // explicit post-commit refresh
		await duesActions.ensure(); // React sees revision 2
		expect(readAccounting).toHaveBeenCalledTimes(2);
	});
	it("does not regress to a mode response started before a successful refresh", async () => {
		useDuesStore.setState({ mode: active });
		const pending = deferred<AccountingMode>();
		vi.mocked(accountingMode).mockReturnValueOnce(pending.promise);
		const poll = duesActions.mode();
		vi.mocked(readAccounting).mockResolvedValueOnce(
			snapshot({ ...active, revision: 2 }),
		);
		await duesActions.load();
		pending.resolve(active);
		await poll;
		expect(useDuesStore.getState().mode?.revision).toBe(2);
	});
	it("retains the server mode on a network failure and reports the error", async () => {
		useDuesStore.setState({ mode: active });
		vi.mocked(accountingMode).mockRejectedValueOnce(new Error("offline"));
		await duesActions.mode();
		expect(useDuesStore.getState().mode?.enabled).toBe(true);
		expect(useDuesStore.getState().modeError).toBe("offline");
	});
	it("clears dismissed reminders and private data on logout or role changes", () => {
		entryAlertActions.close("unpaidDues");
		useDuesStore.setState({ data: snapshot(), owner: "A", mode: active });
		useAuthStore.setState({ isAdmin: true });
		expect(useDuesStore.getState().data).toBeNull();
		useAuthStore.setState({ memberId: null });
		expect(useEntryAlertStore.getState().closed).toEqual({});
	});
});
