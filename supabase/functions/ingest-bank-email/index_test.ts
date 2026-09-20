import { deepStrictEqual, equal } from "node:assert/strict";

const originalServe = Deno.serve;
const originalFetch = globalThis.fetch;
let handler: (req: Request) => Promise<Response>;
Deno.env.set("SUPABASE_URL", "https://bank-test.invalid");
Deno.env.set("SUPABASE_ANON_KEY", "test-anon");
Deno.env.set("APPS_SCRIPT_URL", "https://script-test.invalid");
Deno.env.set("INGEST_SECRET", "test-secret");
// 실제 서버를 열지 않고 요청 처리 함수를 받아 통합 흐름을 검증한다.
Deno.serve = ((callback: typeof handler) => { handler = callback; }) as typeof Deno.serve;
await import("./index.ts");
Deno.serve = originalServe;

const message = (id: string, attachments: string[]) => ({
  messageId: id, subject: "테스트 거래내역", from: "test@example.invalid",
  date: "2026-09-14T00:00:00Z",
  attachments: attachments.map((bytesBase64) => ({
    name: `${bytesBase64}.xlsx`, bytesBase64,
  })),
});

Deno.test("separate attachment requests preserve failed mail and finish status only after inserts", async () => {
  const parsed: string[] = [];
  const trashed: string[] = [];
  const events: string[] = [];
  let rawId = 0;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    if (url.includes("/rpc/is_admin")) return Response.json(true);
    if (url === "https://script-test.invalid") {
      if (body.action === "trash") {
        trashed.push(...body.messageIds);
        return Response.json({ ok: true, trashed: body.messageIds.length });
      }
      return Response.json({ ok: true, messages: [message("good", ["a", "b"]), message("bad", ["c"])] });
    }
    if (url.includes("/parse-bank-attachment")) {
      equal(new Headers(init?.headers).get("Authorization"), "Bearer caller");
      parsed.push(body.bytesBase64);
      if (body.bytesBase64 === "c") return Response.json({ message: "Worker exceeded resource limit" }, { status: 546 });
      return Response.json({ transactions: [{
        occurredAt: "2026-09-14T09:00:00+09:00", counterpartyName: "테스트", direction: "in",
        amount: 6000, balanceAfter: 10000, memo: "", dedupKey: body.bytesBase64,
      }] });
    }
    if (url.includes("/raw_bank_emails")) {
      events.push(body.parse_status);
      return Response.json(init?.method === "PATCH" ? null : [{ id: ++rawId }]);
    }
    if (url.includes("/bank_transactions")) {
      events.push("insert");
      equal(new URL(url).searchParams.get("on_conflict"), "dedup_key");
      equal(new Headers(init?.headers).get("Prefer")?.includes("resolution=ignore-duplicates"), true);
      return Response.json([{ id: 1, ...body[0] }]);
    }
    throw new Error(`Unexpected request: ${url}`);
  };
  try {
    const response = await handler(new Request("https://bank-test.invalid", {
      method: "POST", headers: { Authorization: "Bearer caller" },
    }));
    equal(response.status, 502);
    const result = await response.json();
    equal(result.ok, false);
    equal(result.error.includes("새 거래 2건을 저장"), true);
    equal(result.inserted, 2);
    equal(result.errors.length, 1);
    deepStrictEqual(parsed, ["a", "b", "c"]);
    deepStrictEqual(trashed, ["good"]);
    deepStrictEqual(events, ["pending", "insert", "insert", "parsed", "pending", "error"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("a non-admin cannot fetch Gmail or process attachments", async () => {
  const urls: string[] = [];
  globalThis.fetch = async (input) => { urls.push(String(input)); return Response.json(false); };
  try {
    const response = await handler(new Request("https://bank-test.invalid", { method: "POST" }));
    equal(response.status, 403);
    equal(urls.length, 1);
    equal(urls[0].endsWith("/rpc/is_admin"), true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
