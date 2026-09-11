import type { Session } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
	signInWithPassword: vi.fn(), onAuthStateChange: vi.fn(), from: vi.fn(),
	upsert: vi.fn(), maybeSingle: vi.fn(), rpc: vi.fn(), update: vi.fn(),
}));
vi.mock("../lib/supabase/client", () => ({ supabase: {
	auth: { signInWithPassword: h.signInWithPassword, onAuthStateChange: h.onAuthStateChange },
	from: h.from, rpc: h.rpc,
} }));

import { authActions, useAuthStore } from "./authStore";

describe("authActions.signInWithPassword", () => {
	beforeEach(() => { h.signInWithPassword.mockReset(); });

	it("trims only email and delegates authentication without writing auth state", async () => {
		const before = useAuthStore.getState();
		const writes = vi.fn();
		const stop = useAuthStore.subscribe(writes);
		h.signInWithPassword.mockResolvedValue({ data: { user: { id: "test-user" } }, error: null });
		try {
			await authActions.signInWithPassword("  member@example.com  ", "  password with spaces  ");
			expect(h.signInWithPassword).toHaveBeenCalledExactlyOnceWith({
				email: "member@example.com", password: "  password with spaces  ",
			});
			// Existing onAuthStateChange remains the sole session/member initialization path.
			expect(useAuthStore.getState()).toBe(before);
			expect(writes).not.toHaveBeenCalled();
		} finally {
			stop();
		}
	});

	it("propagates a Supabase error for the form's Korean error mapping", async () => {
		const error = { code: "invalid_credentials", message: "Invalid login credentials" };
		h.signInWithPassword.mockResolvedValue({ data: { user: null, session: null }, error });
		await expect(authActions.signInWithPassword("member@example.com", "incorrect")).rejects.toBe(error);
	});

	it("propagates a rejected network request without retrying credentials", async () => {
		const error = new TypeError("Failed to fetch");
		h.signInWithPassword.mockRejectedValue(error);
		await expect(authActions.signInWithPassword("member@example.com", "password")).rejects.toBe(error);
		expect(h.signInWithPassword).toHaveBeenCalledTimes(1);
	});
});

function session(id: string): Session {
	return {
		access_token: "test-only-access-token", refresh_token: "test-only-refresh-token", expires_in: 3600, token_type: "bearer",
		user: { id, aud: "authenticated", app_metadata: {}, user_metadata: { name: id }, created_at: "2020-01-01T00:00:00Z" },
	};
}

function member(id: string) {
	return { id: `member-${id}`, name: id, gender: "F", birth_year: 1990, residence: "역삼동",
		membership_started_at: "2020-01-01", created_at: "2020-01-01T00:00:00Z" };
}

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason: unknown) => void;
	const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
	return { promise, resolve, reject };
}

describe("auth identity generation", () => {
	let auth: typeof import("./authStore");
	let emit: (next: Session | null, event?: string) => void;

	beforeEach(async () => {
		vi.useFakeTimers();
		vi.resetModules();
		h.onAuthStateChange.mockReset();
		h.from.mockReset().mockReturnValue({
			upsert: h.upsert,
			select: () => ({ eq: () => ({ maybeSingle: h.maybeSingle }) }),
			update: () => ({ eq: h.update }),
		});
		h.upsert.mockReset().mockResolvedValue({ error: null });
		h.maybeSingle.mockReset().mockResolvedValue({ data: member("B"), error: null });
		h.rpc.mockReset().mockResolvedValue({ data: false, error: null });
		h.update.mockReset().mockResolvedValue({ error: null });
		auth = await import("./authStore");
		auth.authActions.init();
		const callback = h.onAuthStateChange.mock.calls[0][0] as (event: string, next: Session | null) => void;
		emit = (next, event = next ? "SIGNED_IN" : "SIGNED_OUT") => callback(event, next);
	});

	afterEach(() => {
		emit(null);
		vi.clearAllTimers();
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	it("clears all previous member fields atomically when switching accounts or signing out", async () => {
		h.maybeSingle.mockResolvedValueOnce({ data: member("A"), error: null });
		h.rpc.mockResolvedValueOnce({ data: true, error: null });
		emit(session("A"));
		await vi.runOnlyPendingTimersAsync();
		expect(auth.useAuthStore.getState()).toMatchObject({ memberId: "member-A", isAdmin: true, memberLoaded: true, myName: "A" });
		const seen: unknown[] = [];
		const stop = auth.useAuthStore.subscribe((state) => seen.push(state));
		try {
			emit(session("B"));
			expect(seen).toHaveLength(1);
			expect(seen[0]).toMatchObject({ user: { id: "B" }, memberLoaded: false, memberId: null, isAdmin: false,
				myName: null, myGender: null, myBirthYear: null, myResidence: null, myMembershipStartedAt: null, myCreatedAt: null });
			await vi.runOnlyPendingTimersAsync();
			emit(null);
			expect(auth.useAuthStore.getState()).toMatchObject({ user: null, session: null, memberLoaded: true, memberId: null,
				isAdmin: false, myName: null, myGender: null, myBirthYear: null, myResidence: null, myMembershipStartedAt: null, myCreatedAt: null });
		} finally { stop(); }
	});

	it("ignores a previous account's late admin result after logout and B login", async () => {
		const oldAdmin = deferred<{ data: boolean }>();
		h.maybeSingle.mockResolvedValueOnce({ data: member("A"), error: null });
		h.rpc.mockReturnValueOnce(oldAdmin.promise);
		emit(session("A"));
		await vi.runOnlyPendingTimersAsync();
		emit(null);
		emit(session("B"));
		await vi.runOnlyPendingTimersAsync();
		const before = auth.useAuthStore.getState();
		expect(before).toMatchObject({ memberId: "member-B", myName: "B", isAdmin: false });
		oldAdmin.resolve({ data: true });
		await vi.runOnlyPendingTimersAsync();
		expect(auth.useAuthStore.getState()).toBe(before);
	});

	it("stops stale work after upsert instead of selecting under a new identity", async () => {
		const oldUpsert = deferred<{ error: null }>();
		h.upsert.mockReturnValueOnce(oldUpsert.promise);
		emit(session("A"));
		await vi.runOnlyPendingTimersAsync();
		emit(null);
		emit(session("B"));
		await vi.runOnlyPendingTimersAsync();
		oldUpsert.resolve({ error: null });
		await vi.runOnlyPendingTimersAsync();
		expect(h.maybeSingle).toHaveBeenCalledTimes(1);
		expect(h.rpc).toHaveBeenCalledTimes(1);
		expect(auth.useAuthStore.getState().memberId).toBe("member-B");
	});

	it("stops stale work after member select before fetching the new identity's admin rights", async () => {
		const oldMember = deferred<{ data: ReturnType<typeof member> }>();
		h.maybeSingle.mockReturnValueOnce(oldMember.promise);
		emit(session("A"));
		await vi.runOnlyPendingTimersAsync();
		emit(null);
		emit(session("B"));
		await vi.runOnlyPendingTimersAsync();
		oldMember.resolve({ data: member("A") });
		await vi.runOnlyPendingTimersAsync();
		expect(h.rpc).toHaveBeenCalledTimes(1);
		expect(auth.useAuthStore.getState().memberId).toBe("member-B");
	});

	it("ignores old same-user generation failures without clearing the new login's dedup cache", async () => {
		const oldAdmin = deferred<{ data: boolean }>();
		const log = vi.spyOn(console, "error").mockImplementation(() => {});
		h.maybeSingle.mockResolvedValue({ data: member("A"), error: null });
		h.rpc.mockReturnValueOnce(oldAdmin.promise);
		emit(session("A"));
		await vi.runOnlyPendingTimersAsync();
		emit(null);
		emit(session("A"));
		await vi.runOnlyPendingTimersAsync();
		const before = auth.useAuthStore.getState();
		oldAdmin.reject(new Error("previous session expired"));
		await vi.runOnlyPendingTimersAsync();
		expect(auth.useAuthStore.getState()).toBe(before);
		expect(log).not.toHaveBeenCalled();
		emit(session("A"), "TOKEN_REFRESHED");
		await vi.runOnlyPendingTimersAsync();
		expect(h.upsert).toHaveBeenCalledTimes(2);
		expect(h.maybeSingle).toHaveBeenCalledTimes(2);
	});

	it("does not start a queued member request after logout", async () => {
		emit(session("A"));
		emit(null);
		await vi.runOnlyPendingTimersAsync();
		expect(h.from).not.toHaveBeenCalled();
	});

	it("retains deduplication for repeated initial-session and token-refresh events", async () => {
		emit(session("B"), "INITIAL_SESSION");
		emit(session("B"), "TOKEN_REFRESHED");
		await vi.runOnlyPendingTimersAsync();
		emit(session("B"), "TOKEN_REFRESHED");
		await vi.runOnlyPendingTimersAsync();
		expect(h.upsert).toHaveBeenCalledTimes(1);
		expect(h.maybeSingle).toHaveBeenCalledTimes(1);
		expect(h.rpc).toHaveBeenCalledTimes(1);
		expect(auth.useAuthStore.getState().memberLoaded).toBe(true);
	});

	it("preserves retry-on-next-event for a failure in the current identity", async () => {
		const log = vi.spyOn(console, "error").mockImplementation(() => {});
		h.rpc.mockRejectedValueOnce(new Error("temporary failure"));
		emit(session("B"));
		await vi.runOnlyPendingTimersAsync();
		expect(auth.useAuthStore.getState().memberLoaded).toBe(false);
		expect(log).toHaveBeenCalledTimes(1);
		emit(session("B"), "TOKEN_REFRESHED");
		await vi.runOnlyPendingTimersAsync();
		expect(h.upsert).toHaveBeenCalledTimes(1);
		expect(h.maybeSingle).toHaveBeenCalledTimes(2);
		expect(auth.useAuthStore.getState()).toMatchObject({ memberLoaded: true, memberId: "member-B" });
	});

	it("does not apply a late profile update to the next account", async () => {
		emit(session("A"));
		await vi.runOnlyPendingTimersAsync();
		const oldUpdate = deferred<{ error: null }>();
		h.update.mockReturnValueOnce(oldUpdate.promise);
		const updating = auth.authActions.updateProfile({ name: "Updated A", gender: "M", birthYear: 1980, residence: "서초동" });
		emit(null);
		emit(session("B"));
		await vi.runOnlyPendingTimersAsync();
		const before = auth.useAuthStore.getState();
		oldUpdate.resolve({ error: null });
		expect(await updating).toBe(false);
		expect(auth.useAuthStore.getState()).toBe(before);
		expect(before.myName).toBe("B");
	});
});
