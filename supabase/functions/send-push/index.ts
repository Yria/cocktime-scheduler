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

// 콜드스타트(top-level await) 실패가 함수 전체를 WORKER_ERROR로 죽이지 않도록
// lazy 초기화 + 캐시. 초기화 오류는 요청 핸들러의 try/catch로 잡혀 응답에 노출된다.
let _appServer: webpush.ApplicationServer | null = null;
async function getAppServer(): Promise<webpush.ApplicationServer> {
  if (!_appServer) {
    _appServer = await webpush.ApplicationServer.new({
      contactInformation: VAPID_SUBJECT,
      vapidKeys: await webpush.importVapidKeys(JSON.parse(VAPID_KEYS), {
        extractable: false,
      }),
    });
  }
  return _appServer;
}

interface NotificationPayload {
  id: string;
  recipient_member_id: string;
  type: string;
  session_id: number | null;
  payload: Record<string, unknown> | null;
}

interface NotifCtx {
  sessionTitle?: string | null;
  scheduledAt?: string | null;
  placeName?: string | null; // 일정 장소(session.place_id)
  carpoolPlaceName?: string | null; // 카풀 집결지(payload.place_id)
}

/** ISO → "6월 25일 (목) 오후 7:00" (Asia/Seoul). */
function formatWhen(iso?: string | null): string {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "long",
    day: "numeric",
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(t));
}

// ⚠️ src/lib/supabase/notifications.ts 의 notificationMessage 와 반드시 동기화할 것.
function buildBody(
  type: string,
  payload: Record<string, unknown> | null,
  ctx: NotifCtx,
): string {
  const when = formatWhen(ctx.scheduledAt);
  // 일정엔 '제목'이 없으므로 제목(있으면) 또는 장소명 + 시각으로 식별.
  const head = ctx.sessionTitle ? `'${ctx.sessionTitle}'` : ctx.placeName;
  const sess = head ? `${head}${when ? ` (${when})` : ""}` : when;
  switch (type) {
    case "promoted": {
      // 게스트 승격이면 수신자(초대 회원)에게 "내 게스트가 확정" 으로 표기.
      const guest =
        payload && typeof payload.guest_name === "string"
          ? payload.guest_name
          : null;
      if (guest)
        return sess
          ? `${sess} 게스트 '${guest}'님이 대기자에서 참석 확정됐어요!`
          : `게스트 '${guest}'님이 대기자에서 참석 확정되었어요!`;
      return sess
        ? `${sess} 대기자에서 참석이 확정됐어요!`
        : "대기자에서 참석이 확정되었어요!";
    }
    case "demoted": {
      // 게스트 강등이면 수신자(초대 회원)에게 "내 게스트가 대기로" 로 표기(본인이 밀린 걸로 오인 방지).
      const guest =
        payload && typeof payload.guest_name === "string"
          ? payload.guest_name
          : null;
      if (guest)
        return sess
          ? `${sess} 정원이 조정되어 게스트 '${guest}'님이 대기로 변경됐어요`
          : `정원이 조정되어 게스트 '${guest}'님이 대기로 변경되었어요`;
      return sess
        ? `${sess} 정원이 조정되어 대기로 변경됐어요`
        : "정원이 조정되어 대기자로 변경되었어요";
    }
    case "session_cancelled":
      return sess ? `${sess} 일정이 취소됐어요` : "참석 예정 일정이 취소되었어요";
    case "session_closed":
      return sess ? `${sess} 모집이 마감됐어요` : "일정 모집이 마감되었어요";
    case "session_open":
      return sess
        ? `${sess} 일정이 열렸어요. 참석 신청하세요!`
        : "새 일정이 열렸어요. 참석 신청하세요!";
    case "carpool_muster": {
      const at = formatWhen(
        payload && typeof payload.at === "string" ? payload.at : null,
      );
      const place = ctx.carpoolPlaceName;
      if (place && at) return `카풀 안내: '${place}'(으)로 ${at}까지 모여주세요`;
      if (place) return `카풀 안내: '${place}' 집결 안내가 도착했어요`;
      return "카풀 집결 안내가 도착했어요";
    }
    case "schedule_added": {
      if (sess) return `새 일정이 추가됐어요: ${sess}`;
      const label =
        payload && typeof payload.label === "string" ? payload.label : null;
      return label ? `새 일정이 추가됐어요: ${label}` : "새 일정이 추가되었어요";
    }
    case "new_member": {
      const name =
        payload && typeof payload.name === "string" ? payload.name : null;
      return name ? `${name}님이 새로 가입했어요` : "새 회원이 가입했어요";
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

  try {
    const n = (await req.json()) as NotificationPayload;
    const sb = createClient(SUPABASE_URL, SERVICE_ROLE);

    // 수신자의 모든 기기 구독 조회 (service_role → RLS 우회)
    const { data: subs, error } = await sb
      .from("push_subscriptions")
      .select("endpoint, p256dh, auth")
      .eq("member_id", n.recipient_member_id);
    if (error) throw new Error(`push_subscriptions select: ${error.message}`);
    if (!subs || subs.length === 0) {
      return new Response(JSON.stringify({ sent: 0, reason: "no-subscriptions" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    // 메시지를 풍부하게: 세션 제목·시각·일정 장소 + 카풀 집결지 장소명 조회
    const ctx: NotifCtx = {};
    let sessionPlaceId: number | null = null;
    if (n.session_id != null) {
      const { data: s } = await sb
        .from("sessions")
        .select("title, scheduled_at, place_id")
        .eq("id", n.session_id)
        .maybeSingle();
      if (s) {
        ctx.sessionTitle = s.title;
        ctx.scheduledAt = s.scheduled_at;
        sessionPlaceId = s.place_id;
      }
    }
    const carpoolPlaceId =
      n.payload && typeof n.payload.place_id === "number"
        ? n.payload.place_id
        : null;
    const placeIds = [sessionPlaceId, carpoolPlaceId].filter(
      (x): x is number => x != null,
    );
    if (placeIds.length > 0) {
      const { data: pls } = await sb
        .from("places")
        .select("id, name")
        .in("id", placeIds);
      const byId = new Map((pls ?? []).map((p) => [p.id, p.name]));
      if (sessionPlaceId != null)
        ctx.placeName = byId.get(sessionPlaceId) ?? null;
      if (carpoolPlaceId != null)
        ctx.carpoolPlaceName = byId.get(carpoolPlaceId) ?? null;
    }

    const appServer = await getAppServer();
    const msg = JSON.stringify({
      title: "콕타임",
      body: buildBody(n.type, n.payload, ctx),
      url: n.session_id ? "session" : "",
      tag: `notif-${n.id}`,
      type: n.type,
    });

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
  } catch (e) {
    // 어떤 오류든 응답 본문에 노출 → net._http_response.content 로 진단 가능
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : String(e) }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
});
