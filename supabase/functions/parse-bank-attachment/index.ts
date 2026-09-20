import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";
import { parseWorkbook } from "./xlsx.ts";

// ingest-bank-email에서 호출. 동일한 운영진 JWT로 권한을 확인한 뒤
// 엑셀 한 개만 처리한다. DB 저장과 Gmail 정리는 수집 함수에서 담당한다.
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
  try {
    const supa = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } },
    );
    const { data: isAdmin, error } = await supa.rpc("is_admin");
    if (error) return json({ error: "auth check failed" }, 401);
    if (isAdmin !== true) return json({ error: "forbidden" }, 403);

    const body = await req.json();
    if (typeof body?.bytesBase64 !== "string" || !body.bytesBase64) {
      return json({ error: "엑셀 첨부파일이 없습니다." }, 400);
    }
    const transactions = await parseWorkbook(
      body.bytesBase64,
      Deno.env.get("TOSS_XLSX_PASSWORD") ?? "",
    );
    return json({ transactions });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
