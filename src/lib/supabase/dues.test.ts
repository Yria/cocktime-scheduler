import { beforeEach, expect, it, vi } from "vitest";
import { accountingMode, sessionDeletionInfo } from "./dues";
import { supabase } from "./client";
vi.mock("./client", () => ({ supabase: { rpc: vi.fn() } }));
beforeEach(() => {
	vi.resetAllMocks();
});
it("reports an unavailable promoted endpoint instead of falling back to the retired ledger", async () => {
	const error = { code: "PGRST202", message: "missing endpoint" };
	vi.mocked(supabase.rpc).mockResolvedValueOnce({ data: null, error } as never);
	await expect(accountingMode()).rejects.toEqual(error);
	expect(supabase.rpc).toHaveBeenCalledExactlyOnceWith("dues_mode");
});
it("rejects a disabled server mode rather than opening an obsolete financial UI", async () => {
	vi.mocked(supabase.rpc).mockResolvedValueOnce({
		data: { enabled: false },
		error: null,
	} as never);
	await expect(accountingMode()).rejects.toThrow(/회계 사용 상태/);
});
it("does not allow deletion after the preservation lookup fails", async () => {
	const error = { message: "offline" };
	vi.mocked(supabase.rpc).mockResolvedValueOnce({ data: null, error } as never);
	await expect(sessionDeletionInfo(10)).rejects.toEqual(error);
	expect(supabase.rpc).toHaveBeenCalledExactlyOnceWith(
		"dues_session_deletion",
		{ p_session_id: 10 },
	);
});
