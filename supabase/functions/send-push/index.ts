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
    case "wait_ticket_ready":
      // 대기 포인트가 상한(7)에 닿은 순간 1건만. 회차 정보는 붙이지 않는다 — 어느 회차에서
      // 채워졌는지가 아니라 "이제 쓸 수 있다"가 알릴 내용이다.
      return "대기 포인트가 다 모였어요! 만석인 일정에 우선참여권을 쓸 수 있어요 🎟";
    case "session_cancelled":
      return sess ? `${sess} 일정이 취소됐어요` : "참석 예정 일정이 취소되었어요";
    case "session_closed":
      return sess ? `${sess} 모집이 마감됐어요` : "일정 모집이 마감되었어요";
    case "session_open":
      return sess
        ? `${sess} 일정이 열렸어요. 참석 신청하세요!`
        : "새 일정이 열렸어요. 참석 신청하세요!";
    case "sessions_opened": {
      // 여러 회차가 한번에 열렸을 때(주말 일괄 공개 등) 합친 알림. 세션별 개별 푸시 대신 1건.
      const count =
        payload && typeof payload.count === "number" ? payload.count : null;
      return count
        ? `새 일정 ${count}개가 열렸어요. 참석 신청하세요!`
        : "새 일정이 여러 개 열렸어요. 참석 신청하세요!";
    }
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
    case "removed": {
      // 운영진이 참석을 취소함. 누가 취소했는지(by_name) 표기. 게스트면 초대 회원에게 게스트 이름과 함께.
      const by =
        payload && typeof payload.by_name === "string" ? payload.by_name : null;
      const guest =
        payload && typeof payload.guest_name === "string"
          ? payload.guest_name
          : null;
      const actor = by ? `${by} 운영진` : "운영진";
      if (guest)
        return sess
          ? `${sess} 게스트 '${guest}'님 참석을 ${actor}이 취소했어요`
          : `게스트 '${guest}'님 참석을 ${actor}이 취소했어요`;
      return sess
        ? `${sess} ${actor}이 참석을 취소했어요`
        : `${actor}이 참석을 취소했어요`;
    }
    case "payment_confirmed":
      // 금액/입금자 미표기(§11 잠금화면 노출 방지) — 확인 사실만.
      return "회비 입금이 확인됐어요 👍";
    case "dues_unpaid": {
      // 선택 발송(dues_notify_selected)은 커스텀 문구(msg)를 담아 옴 — 대관비 등 회비 외 항목 포함.
      const msg = payload && typeof payload.msg === "string" ? payload.msg : null;
      if (msg) return msg;
      const ymv = payload && typeof payload.ym === "string" ? payload.ym : null;
      return ymv
        ? `${ymv} 회비가 아직 미납이에요. 확인 부탁드려요`
        : "이번 달 회비가 아직 미납이에요";
    }
    default:
      return "새 알림이 있어요";
  }
}

/** 알림 1건의 딥링크(scope 상대경로). */
function deepLink(n: NotificationPayload): string {
  // 회비 알림 → /my-dues, 세션 알림 → /session.
  // 우선참여권 알림은 session_id 를 provenance 로만 달고 있다 — 보드가 아니라 홈(일정 목록)으로
  // 보내야 바로 쓸 수 있으므로 세션 분기보다 먼저 걸러낸다.
  if (n.type === "payment_confirmed" || n.type === "dues_unpaid") return "my-dues";
  if (n.type === "wait_ticket_ready") return "";
  return n.session_id ? "session" : "";
}

/** 웹푸시 동시 전송 상한. 정기 공개 묶음(50건 × 기기 수)을 한꺼번에 열지 않는다. */
const SEND_CONCURRENCY = 20;

async function runPool<T>(items: T[], limit: number, fn: (x: T) => Promise<void>) {
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) await fn(items[i++]);
  });
  await Promise.all(workers);
}

// 본문은 두 모양을 받는다:
//   { notifications: [...] } — 트리거(notify_push_send_batch)가 INSERT 문장 하나의 새 행을 묶어 보낸 것
//   { id, recipient_member_id, ... } — 단건(이전 행 트리거 형식, 수동 재발송)
// 묶음 하나에 대해 구독·회차·장소를 **한 번씩만** 조회한다. 2026-10-11 일요일 공개 때 알림마다 따로
//   실행·조회하던 것이 PostgREST 연결을 바닥내 앱 전체가 25초 멈췄다(마이그레이션 20261012030000).
Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }
  if (req.headers.get("x-push-secret") !== PUSH_SECRET) {
    return new Response("forbidden", { status: 401 });
  }

  try {
    const body = await req.json();
    const list: NotificationPayload[] = Array.isArray(body?.notifications)
      ? body.notifications
      : [body as NotificationPayload];
    if (list.length === 0) return json({ sent: 0 });
    const sb = createClient(SUPABASE_URL, SERVICE_ROLE);

    // 수신자들의 모든 기기 구독 (service_role → RLS 우회)
    const recipients = [...new Set(list.map((n) => n.recipient_member_id))];
    const { data: subs, error } = await sb
      .from("push_subscriptions")
      .select("member_id, endpoint, p256dh, auth")
      .in("member_id", recipients);
    if (error) throw new Error(`push_subscriptions select: ${error.message}`);
    const subsByMember = new Map<string, typeof subs>();
    for (const s of subs ?? []) {
      const arr = subsByMember.get(s.member_id) ?? [];
      arr.push(s);
      subsByMember.set(s.member_id, arr);
    }
    const targets = list.filter((n) => subsByMember.has(n.recipient_member_id));
    if (targets.length === 0) return json({ sent: 0, reason: "no-subscriptions" });

    // 메시지를 풍부하게: 세션 제목·시각·일정 장소 + 카풀 집결지 장소명 조회
    const sessionIds = [
      ...new Set(targets.map((n) => n.session_id).filter((x): x is number => x != null)),
    ];
    const sessById = new Map<
      number,
      { title: string | null; scheduled_at: string | null; place_id: number | null }
    >();
    if (sessionIds.length > 0) {
      const { data: ss } = await sb
        .from("sessions")
        .select("id, title, scheduled_at, place_id")
        .in("id", sessionIds);
      for (const s of ss ?? []) sessById.set(s.id, s);
    }
    const carpoolPlaceOf = (n: NotificationPayload) =>
      n.payload && typeof n.payload.place_id === "number" ? n.payload.place_id : null;
    const placeIds = [
      ...new Set(
        targets
          .flatMap((n) => [
            n.session_id != null ? sessById.get(n.session_id)?.place_id ?? null : null,
            carpoolPlaceOf(n),
          ])
          .filter((x): x is number => x != null),
      ),
    ];
    const placeName = new Map<number, string>();
    if (placeIds.length > 0) {
      const { data: pls } = await sb.from("places").select("id, name").in("id", placeIds);
      for (const p of pls ?? []) placeName.set(p.id, p.name);
    }

    const appServer = await getAppServer();
    const jobs: { endpoint: string; p256dh: string; auth: string; msg: string }[] = [];
    for (const n of targets) {
      const s = n.session_id != null ? sessById.get(n.session_id) : undefined;
      const carpoolPlaceId = carpoolPlaceOf(n);
      const ctx: NotifCtx = s
        ? {
            sessionTitle: s.title,
            scheduledAt: s.scheduled_at,
            placeName: s.place_id != null ? placeName.get(s.place_id) ?? null : null,
          }
        : {};
      if (carpoolPlaceId != null) ctx.carpoolPlaceName = placeName.get(carpoolPlaceId) ?? null;
      const msg = JSON.stringify({
        title: "콕타임",
        body: buildBody(n.type, n.payload, ctx),
        url: deepLink(n),
        tag: `notif-${n.id}`,
        type: n.type,
      });
      for (const sub of subsByMember.get(n.recipient_member_id)!) {
        jobs.push({ endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth, msg });
      }
    }

    const stale = new Set<string>();
    let sent = 0;
    await runPool(jobs, SEND_CONCURRENCY, async (j) => {
      try {
        const subscriber = appServer.subscribe({
          endpoint: j.endpoint,
          keys: { p256dh: j.p256dh, auth: j.auth },
        });
        await subscriber.pushTextMessage(j.msg, {});
        sent++;
      } catch (e) {
        if (
          e instanceof webpush.PushMessageError &&
          (e.isGone() || e.response.status === 404)
        ) {
          stale.add(j.endpoint);
        }
      }
    });
    if (stale.size > 0) {
      await sb.from("push_subscriptions").delete().in("endpoint", [...stale]);
    }

    await sb
      .from("notifications")
      .update({ sent: true })
      .in("id", targets.map((n) => n.id));

    return json({ sent, notifications: targets.length });
  } catch (e) {
    // 어떤 오류든 응답 본문에 노출 → net._http_response.content 로 진단 가능
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
