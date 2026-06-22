import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";
import * as webpush from "@negrel/webpush";

// notifications AFTER INSERT 트리거(net.http_post)가 호출하는 웹푸시 발송 함수.
// 호출자 검증은 x-push-secret 헤더로 한다(verify_jwt=false).
//
// 필요한 secret(supabase secrets set):
//   VAPID_KEYS       — @negrel/webpush exportVapidKeys JSON({publicKey, privateKey} JWK)
//   VAPID_SUBJECT    — "mailto:..."
//   PUSH_SEND_SECRET — 트리거(Vault push_send_secret)와 동일한 공유 시크릿
// 런타임 자동 주입: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

const PUSH_SECRET = Deno.env.get("PUSH_SEND_SECRET")!;
const VAPID_KEYS = Deno.env.get("VAPID_KEYS")!;
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") ?? "mailto:sam@dooub.com";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// ApplicationServer는 1회만 초기화(콜드스타트 시).
const appServer = await webpush.ApplicationServer.new({
  contactInformation: VAPID_SUBJECT,
  vapidKeys: await webpush.importVapidKeys(JSON.parse(VAPID_KEYS), {
    extractable: false,
  }),
});

interface NotificationPayload {
  id: string;
  recipient_member_id: string;
  type: string;
  session_id: number | null;
  payload: Record<string, unknown> | null;
}

// ⚠️ src/lib/supabase/notifications.ts 의 notificationMessage 와 반드시 동기화할 것.
// 알림 type 추가/문구 변경 시 양쪽을 같이 수정한다.
function buildBody(type: string, payload: Record<string, unknown> | null): string {
  switch (type) {
    case "promoted":
      return "대기자에서 참석이 확정되었어요!";
    case "session_cancelled":
      return "참석 예정 일정이 취소되었어요";
    case "session_closed":
      return "일정 모집이 마감되었어요";
    case "carpool_muster":
      return "카풀 집결 안내가 도착했어요";
    case "schedule_added": {
      const label =
        payload && typeof payload.label === "string" ? payload.label : null;
      return label ? `새 일정이 추가되었어요: ${label}` : "새 일정이 추가되었어요";
    }
    default:
      return "새 알림이 있어요";
  }
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }
  if (req.headers.get("x-push-secret") !== PUSH_SECRET) {
    return new Response("forbidden", { status: 401 });
  }

  const n = (await req.json()) as NotificationPayload;
  const sb = createClient(SUPABASE_URL, SERVICE_ROLE);

  // 수신자의 모든 기기 구독 조회 (service_role → RLS 우회)
  const { data: subs, error } = await sb
    .from("push_subscriptions")
    .select("endpoint, p256dh, auth")
    .eq("member_id", n.recipient_member_id);
  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (!subs || subs.length === 0) {
    return new Response(JSON.stringify({ sent: 0 }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  // SW가 그대로 showNotification에 사용할 payload.
  // url은 scope 기준 상대경로 — SW가 self.registration.scope로 절대화한다(base path 무관).
  const msg = JSON.stringify({
    title: "콕타임",
    body: buildBody(n.type, n.payload),
    url: n.session_id ? "session" : "",
    tag: `notif-${n.id}`,
    type: n.type,
  });

  // 각 구독에 전송 + 만료(404/410) 정리
  const stale: string[] = [];
  await Promise.allSettled(
    subs.map(async (s) => {
      try {
        const subscriber = appServer.subscribe({
          endpoint: s.endpoint,
          keys: { p256dh: s.p256dh, auth: s.auth },
        });
        await subscriber.pushTextMessage(msg, {});
      } catch (e) {
        if (
          e instanceof webpush.PushMessageError &&
          (e.isGone() || e.response.status === 404)
        ) {
          stale.push(s.endpoint);
        }
      }
    }),
  );
  if (stale.length > 0) {
    await sb.from("push_subscriptions").delete().in("endpoint", stale);
  }

  await sb.from("notifications").update({ sent: true }).eq("id", n.id);

  return new Response(
    JSON.stringify({ sent: subs.length - stale.length }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
});
