import { FunctionsHttpError } from "@supabase/supabase-js";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { supabase } from "./client";
import { ingestBankEmail } from "./duesSettings";

vi.mock("./client", () => ({ supabase: { functions: { invoke: vi.fn() } } }));
beforeEach(() => {
	vi.resetAllMocks();
	vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

it.each([
	[502, { error: "apps-script: 권한 확인 필요" }, "apps-script: 권한 확인 필요"],
	[401, { message: "Invalid JWT" }, "Invalid JWT"],
	[546, { code: "WORKER_LIMIT", message: "Worker exceeded resource limit" }, "서버 실행 한도를 초과"],
])("surfaces the response detail for HTTP %s", async (status, body, message) => {
	const response = new Response(JSON.stringify(body), { status });
	vi.mocked(supabase.functions.invoke).mockResolvedValueOnce({
		data: null,
		error: new FunctionsHttpError(response),
	});
	const result = await ingestBankEmail();
	expect(result).toEqual({ ok: false, error: expect.stringContaining(message) });
	expect(response.bodyUsed).toBe(false);
});

it("preserves the HTTP status when the platform returns a non-JSON error", async () => {
	vi.mocked(supabase.functions.invoke).mockResolvedValueOnce({
		data: null,
		error: new FunctionsHttpError(new Response("unavailable", { status: 503 })),
	});
	expect(await ingestBankEmail()).toEqual({
		ok: false,
		error: expect.stringContaining("HTTP 503"),
	});
});

it("keeps partial import counts and file errors available to the caller", async () => {
	const data = {
		fetched: 2, parsed: 3, inserted: 2, skipped: 1, trashed: 1,
		deposits: [], errors: ["statement.xlsx: 엑셀 처리 실패"],
	};
	vi.mocked(supabase.functions.invoke).mockResolvedValueOnce({ data, error: null });
	expect(await ingestBankEmail()).toEqual({ ok: true, data });
});
