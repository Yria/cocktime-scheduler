import "@supabase/functions-js/edge-runtime.d.ts";

const SHEET_ID = Deno.env.get("SHEET_ID")!;
const API_KEY = Deno.env.get("API_KEY")!;
const SCRIPT_URL = Deno.env.get("SCRIPT_URL")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    if (req.method === "GET") {
      const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/A:I?key=${API_KEY}`;
      const res = await fetch(url);
      const data = await res.json();
      if (!res.ok) throw new Error(`시트 읽기 실패: ${res.status}`);
      return new Response(JSON.stringify(data), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (req.method === "POST") {
      const body = await req.json();
      const res = await fetch(SCRIPT_URL, {
        method: "POST",
        redirect: "follow",
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`수정 실패: ${res.status}`);
      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // OAuth 토큰으로 Google Sheets 직접 쓰기
    if (req.method === "PUT") {
      const accessToken = req.headers.get("X-Google-Token");
      if (!accessToken) throw new Error("인증 토큰이 없습니다");

      const { playerName, values } = await req.json();

      // 이름으로 행 탐색
      const findRes = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/A:A`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      if (!findRes.ok) throw new Error(`행 탐색 실패: ${findRes.status}`);
      const findData = await findRes.json();
      const nameCol: string[][] = findData.values ?? [];
      const rowIndex = nameCol.findIndex((row, i) => i > 0 && row[0]?.trim() === playerName);
      if (rowIndex === -1) throw new Error(`선수를 찾을 수 없습니다: ${playerName}`);

      const sheetRow = rowIndex + 1;
      const updateRes = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/A${sheetRow}:I${sheetRow}?valueInputOption=USER_ENTERED`,
        {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ values: [values] }),
        },
      );
      if (!updateRes.ok) throw new Error(`수정 실패: ${updateRes.status}`);
      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response("Method Not Allowed", { status: 405, headers: corsHeaders });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
