// 콕타임 Service Worker — 웹푸시 전용 (오프라인 캐싱 없음).
// 페이로드 계약(send-push Edge Function): { title, body, url, tag, type }
// SW에는 import.meta.env가 없으므로 base 경로는 self.registration.scope에서 유도한다.

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) =>
  event.waitUntil(self.clients.claim()),
);

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }

  const scope = self.registration.scope; // 예: https://user.github.io/cocktime-scheduler/
  const title = data.title || "콕타임";
  const options = {
    body: data.body || "",
    icon: new URL("icon-192.png", scope).href,
    badge: new URL("icon-192.png", scope).href,
    tag: data.tag || data.type || "cocktime",
    renotify: true,
    data: {
      // scope 기준 상대경로(url) → 절대 URL로 정규화. 클릭 시 열 위치.
      url: new URL(data.url || "", scope).href,
    },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const scope = self.registration.scope;
  const targetUrl = (event.notification.data && event.notification.data.url) || scope;

  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      // 이미 앱이 열려 있으면 포커스 + in-app 라우팅 메시지 전달(SPA reload 회피)
      for (const client of all) {
        if (client.url.startsWith(scope)) {
          await client.focus();
          client.postMessage({ type: "push-navigate", url: targetUrl });
          return;
        }
      }
      // 열린 창이 없으면 새로 연다.
      await self.clients.openWindow(targetUrl);
    })(),
  );
});
