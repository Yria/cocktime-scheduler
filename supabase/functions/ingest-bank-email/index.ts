import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";
import officeCrypto from "officecrypto-tool";
import * as XLSX from "xlsx";
import { type Cell, parseToss } from "./toss.ts";

// 회계 §4~5: 은행 입금메일 수집 Edge Function.
// [현재 = 3단계-a] 프론트(admin JWT) → is_admin 재검 → Apps Script(시크릿) → Gmail → 암호화 xlsx
//   → 복호화(TOSS_XLSX_PASSWORD) → 토스 파서 → raw_bank_emails/bank_transactions 멱등 적재.
//   ※ 회원 매칭 제안(§8)·확정 RPC 연결은 3단계-b. 적재는 "사실 기록"이라 자동확정 아님.
//
// 시크릿(Deno.env = supabase secrets set): APPS_SCRIPT_URL, INGEST_SECRET, TOSS_XLSX_PASSWORD.
// DB 쓰기는 admin JWT 클라이언트(supa)로 — bank_transactions/raw_bank_emails RLS(is_admin FOR ALL) 통과.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const APPS_SCRIPT_URL = Deno.env.get("APPS_SCRIPT_URL")!;
const INGEST_SECRET = Deno.env.get("INGEST_SECRET")!;
const TOSS_PW = Deno.env.get("TOSS_XLSX_PASSWORD") ?? "";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

interface AppsScriptAttachment {
  name: string;
  size: number;
  mimeType: string;
  bytesBase64: string;
}
interface AppsScriptMessage {
  messageId: string;
  subject: string;
  from: string;
  date: string;
  attachments: AppsScriptAttachment[];
}
interface AppsScriptResult {
  ok: boolean;
  error?: string;
  count?: number;
  messages?: AppsScriptMessage[];
  trashed?: number;
}

// Apps Script 웹앱 호출. POST → 302(googleusercontent echo)라 쿠키 전달하며 리다이렉트를 따라간다.
async function callAppsScript(payload: Record<string, unknown>): Promise<AppsScriptResult> {
  const body = JSON.stringify({ secret: INGEST_SECRET, ...payload });
  let res = await fetch(APPS_SCRIPT_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    redirect: "manual",
  });
  let hops = 0;
  while (res.status >= 300 && res.status < 400 && hops < 3) {
    const loc = res.headers.get("location");
    if (!loc) break;
    const cookie = res.headers.get("set-cookie") ?? "";
    res = await fetch(loc, { headers: cookie ? { cookie } : {}, redirect: "manual" });
    hops++;
  }
  const text = await res.text();
  try {
    return JSON.parse(text) as AppsScriptResult;
  } catch {
    throw new Error(`apps-script non-JSON (status ${res.status}): ${text.slice(0, 200)}`);
  }
}

const fetchFromGmail = (max: number) => callAppsScript({ max });
// 적재 성공(에러 없음)이 확정된 메일만 휴지통으로. 파싱 실패분은 남긴다(유실 방지). best-effort.
const trashInGmail = (messageIds: string[]) => callAppsScript({ action: "trash", messageIds });

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}

// 암호화 xlsx 바이트 → 복호화 → 첫 시트 행 배열.
async function decryptToRows(b64: string): Promise<Cell[][]> {
  const enc = base64ToBytes(b64);
  const dec = await officeCrypto.decrypt(enc, { password: TOSS_PW });
  const wb = XLSX.read(new Uint8Array(dec as ArrayBufferLike), { type: "array" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json<Cell[]>(ws, {
    header: 1,
    blankrows: false,
    defval: "",
    raw: true,
  });
}

// deno-lint-ignore no-explicit-any
type Sb = any;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return jsonResponse({ error: "method not allowed" }, 405);

  try {
    // ① 운영진 재검(호출자 JWT).
    const authHeader = req.headers.get("Authorization") ?? "";
    const supa: Sb = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: isAdmin, error: adminErr } = await supa.rpc("is_admin");
    if (adminErr) return jsonResponse({ error: "auth check failed" }, 401);
    if (isAdmin !== true) return jsonResponse({ error: "forbidden" }, 403);

    // 부과 생성은 이벤트 시점에서 처리(회비=월 첫 진입 ensure, 대관=세션 종료 트리거) — 여기선 은행내역만 적재.
    // Apps Script → Gmail.
    const fetched = await fetchFromGmail(20);
    if (!fetched.ok) {
      return jsonResponse({ error: `apps-script: ${fetched.error ?? "unknown"}` }, 502);
    }

    // ④ 복호화 → 파싱 → 멱등 적재.
    let parsed = 0;
    let inserted = 0;
    let skipped = 0;
    const deposits: { occurredAt: string; name: string; amount: number }[] = [];
    const errors: string[] = [];
    // 적재 성공(에러 없음)이 확정된 메일 id — 처리 후 휴지통 이동 대상. 에러 난 메일은 남긴다(유실 방지).
    const trashIds: string[] = [];

    for (const m of fetched.messages ?? []) {
      let msgOk = true;
      // 이메일 원문 메타(멱등: message_id UNIQUE).
      const { data: rawRows, error: rawErr } = await supa
        .from("raw_bank_emails")
        .upsert(
          {
            message_id: m.messageId,
            bank_code: "toss",
            subject: m.subject,
            from_addr: m.from,
            received_at: m.date,
            parse_status: "parsed",
          },
          { onConflict: "message_id" },
        )
        .select("id");
      if (rawErr) { errors.push(`raw(${m.subject}): ${rawErr.message}`); msgOk = false; }
      const rawId = rawRows?.[0]?.id ?? null;

      for (const a of m.attachments ?? []) {
        try {
          const rows = await decryptToRows(a.bytesBase64);
          const txns = parseToss(rows);
          parsed += txns.length;
          if (txns.length === 0) continue;

          const insertRows = txns.map((t) => ({
            raw_email_id: rawId,
            bank_code: "toss",
            direction: t.direction,
            amount: t.amount,
            counterparty_name: t.counterpartyName,
            occurred_at: t.occurredAt,
            balance_after: t.balanceAfter,
            memo: t.memo, // 파서가 이미 [거래유형·기관·메모]로 구성
            dedup_key: t.dedupKey,
          }));

          const { data: ins, error: insErr } = await supa
            .from("bank_transactions")
            .upsert(insertRows, { onConflict: "dedup_key", ignoreDuplicates: true })
            .select("id, direction, occurred_at, counterparty_name, amount");
          if (insErr) {
            errors.push(`tx(${a.name}): ${insErr.message}`);
            msgOk = false;
            continue;
          }
          const insCount = ins?.length ?? 0;
          inserted += insCount;
          skipped += txns.length - insCount;
          for (const row of ins ?? []) {
            if (row.direction === "in") {
              deposits.push({
                occurredAt: row.occurred_at,
                name: row.counterparty_name,
                amount: row.amount,
              });
            }
          }
        } catch (e) {
          errors.push(`${a.name}: ${e instanceof Error ? e.message : String(e)}`);
          msgOk = false;
        }
      }
      // 이 메일의 원문·거래가 모두 에러 없이 적재됐으면(중복 skip 포함) 휴지통 대상. 하나라도 실패면 보존.
      if (msgOk) trashIds.push(m.messageId);
    }

    // 적재 성공 확정 메일만 휴지통으로(best-effort — 실패해도 적재 결과엔 영향 없음).
    let trashed = 0;
    if (trashIds.length > 0) {
      try {
        const t = await trashInGmail(trashIds);
        trashed = t.trashed ?? 0;
        if (!t.ok && t.error) errors.push(`trash: ${t.error}`);
      } catch (e) {
        errors.push(`trash: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    deposits.sort((a, b) => (a.occurredAt < b.occurredAt ? 1 : -1));
    return jsonResponse({
      ok: true,
      fetched: (fetched.messages ?? []).length,
      parsed,
      inserted,
      skipped,
      trashed,
      deposits: deposits.slice(0, 30),
      errors: errors.length ? errors : undefined,
    });
  } catch (e) {
    return jsonResponse({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
