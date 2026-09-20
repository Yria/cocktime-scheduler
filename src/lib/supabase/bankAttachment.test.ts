import { afterEach, expect, it, vi } from "vitest";
import { parseAttachment } from "../../../supabase/functions/ingest-bank-email/parseAttachment";

afterEach(() => vi.unstubAllGlobals());

it("delegates each workbook to a separate request using the caller's authorization", async () => {
	const transactions = [{ amount: 6000, dedupKey: "toss|example" }];
	const fetchMock = vi.fn().mockImplementation(() =>
		Promise.resolve(Response.json({ transactions })),
	);
	vi.stubGlobal("fetch", fetchMock);
	for (const attachment of ["first", "second", "third"]) {
		expect(await parseAttachment("https://example.invalid", "anon", "Bearer admin", attachment))
			.toEqual(transactions);
	}
	expect(fetchMock).toHaveBeenCalledTimes(3);
	expect(fetchMock.mock.calls.map(([, init]) => JSON.parse(init.body))).toEqual([
		{ bytesBase64: "first" }, { bytesBase64: "second" }, { bytesBase64: "third" },
	]);
	expect(fetchMock).toHaveBeenCalledWith(
		"https://example.invalid/functions/v1/parse-bank-attachment",
		expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer admin" }) }),
	);
});

it.each([
	[546, { code: "WORKER_LIMIT", message: "Worker exceeded resource limit" }, "서버 실행 한도를 초과"],
	[403, { error: "forbidden" }, "forbidden"],
	[200, { ok: true }, "결과를 확인할 수 없습니다"],
])("rejects failed or malformed parser responses (%s)", async (status, body, detail) => {
	vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(body, { status })));
	await expect(parseAttachment("https://example.invalid", "anon", "Bearer admin", "bytes"))
		.rejects.toThrow(detail);
});
