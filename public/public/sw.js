self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

// The app uses its own HTTP/catalog caching. Keep fetch handling deliberately
// neutral so the service worker cannot serve stale checkout or session data.
self.addEventListener("fetch", () => {});

const PUSH_STATE_CACHE = "bb-schnell-push-state-v1";
const LAST_EVENT_KEY = "/__bb_schnell_last_ready_event__";

async function readLastEventId() {
  const cache = await caches.open(PUSH_STATE_CACHE);
  const response = await cache.match(LAST_EVENT_KEY);
  return response ? response.text() : "";
}

async function writeLastEventId(eventId) {
  const cache = await caches.open(PUSH_STATE_CACHE);
  await cache.put(
    LAST_EVENT_KEY,
    new Response(String(eventId || ""), {
      headers: { "content-type": "text/plain; charset=utf-8" },
    }),
  );
}

async function loadReadyEvent() {
  const response = await fetch("/api/schnellbestellung/push?pending=1", {
    method: "GET",
    credentials: "include",
    cache: "no-store",
    headers: { accept: "application/json" },
  });

  if (!response.ok) return null;
  const data = await response.json().catch(() => ({}));
  return data && data.ok ? data.event || null : null;
}

async function notifyOpenClients(event) {
  const windows = await self.clients.matchAll({
    type: "window",
    includeUncontrolled: true,
  });

  for (const client of windows) {
    client.postMessage({
      type: "BB_SCHNELL_READY_PUSH",
      event,
    });
  }
}

self.addEventListener("push", (pushEvent) => {
  pushEvent.waitUntil(
    (async () => {
      const readyEvent = await loadReadyEvent().catch(() => null);
      const eventId = String(readyEvent && readyEvent.id ? readyEvent.id : "");

      if (eventId) {
        const lastEventId = await readLastEventId().catch(() => "");
        if (lastEventId === eventId) return;
        await writeLastEventId(eventId).catch(() => undefined);
      }

      const customerNumber = Number(
        readyEvent && readyEvent.customerNumber
          ? readyEvent.customerNumber
          : 0,
      );
      const title =
        (readyEvent && readyEvent.title) || "Ihre Bestellung ist fertig!";
      const body =
        (readyEvent && readyEvent.body) ||
        (customerNumber > 0
          ? `Nummer ${customerNumber} kann abgeholt werden.`
          : "Bitte holen Sie Ihre Bestellung ab.");
      const url =
        (readyEvent && readyEvent.url) || "/schnellbestellung/success";
      const tag = eventId ? `bb-schnell-ready-${eventId}` : "bb-schnell-ready";

      await notifyOpenClients(readyEvent).catch(() => undefined);
      await self.registration.showNotification(title, {
        body,
        icon: "/schnell-icon-192.png?v=1",
        badge: "/favicon.ico",
        tag,
        renotify: true,
        requireInteraction: true,
        silent: false,
        vibrate: [700, 120, 700, 160, 1100, 260, 700, 120, 1200],
        timestamp: Date.now(),
        data: {
          url,
          orderId: readyEvent && readyEvent.orderId,
          readyEventId: eventId,
        },
        actions: [
          {
            action: "open",
            title: "Bestellung öffnen",
          },
        ],
      });
    })(),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = new URL(
    (event.notification.data && event.notification.data.url) ||
      "/schnellbestellung/success",
    self.location.origin,
  ).href;

  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });

      for (const client of windows) {
        if ("focus" in client) {
          if ("navigate" in client) await client.navigate(targetUrl);
          await client.focus();
          return;
        }
      }

      if (self.clients.openWindow) {
        await self.clients.openWindow(targetUrl);
      }
    })(),
  );
});
