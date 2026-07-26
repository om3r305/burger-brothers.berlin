self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

// Checkout/session verileri uygulamanın kendi cache katmanında yönetilir.
// Service Worker bilinçli olarak fetch cevabı cache'lemez.
self.addEventListener("fetch", () => {});

const PUSH_STATE_CACHE = "bb-push-state-v2";

function stateKey(eventId) {
  return `/__bb_push_seen__/${encodeURIComponent(String(eventId || ""))}`;
}

async function wasSeen(eventId) {
  if (!eventId) return false;
  const cache = await caches.open(PUSH_STATE_CACHE);
  return Boolean(await cache.match(stateKey(eventId)));
}

async function markSeen(eventId) {
  if (!eventId) return;
  const cache = await caches.open(PUSH_STATE_CACHE);
  await cache.put(
    stateKey(eventId),
    new Response(String(Date.now()), {
      headers: { "content-type": "text/plain; charset=utf-8" },
    }),
  );
}

async function loadGeneralEvents() {
  const response = await fetch("/api/push/pending", {
    method: "GET",
    credentials: "include",
    cache: "no-store",
    headers: { accept: "application/json" },
  });

  if (!response.ok) return [];
  const data = await response.json().catch(() => ({}));
  return data && data.ok && Array.isArray(data.events) ? data.events : [];
}

async function loadSchnellReadyEvent() {
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

async function notifyOpenClients(type, event) {
  const windows = await self.clients.matchAll({
    type: "window",
    includeUncontrolled: true,
  });

  for (const client of windows) {
    client.postMessage({ type, event });
  }
}

function isOrderType(type) {
  return String(type || "").startsWith("order_") || type === "schnell_ready";
}

async function showGeneralEvent(event) {
  const eventId = String(event && event.id ? event.id : "");
  if (!eventId || (await wasSeen(eventId))) return;
  await markSeen(eventId).catch(() => undefined);

  const type = String(event.type || "general");
  const title = String(event.title || "Burger Brothers Berlin");
  const body = String(event.body || "Es gibt Neuigkeiten für Sie.");
  const url = String(event.url || "/menu");
  const imageUrl = event.imageUrl ? String(event.imageUrl) : undefined;

  await notifyOpenClients("BB_GENERAL_PUSH", event).catch(() => undefined);
  await self.registration.showNotification(title, {
    body,
    icon: "/icon-kurier-192.png?v=6",
    badge: "/icon-kurier-192.png?v=6",
    image: imageUrl,
    tag: String(event.tag || `bb-${type}-${eventId}`),
    renotify: true,
    requireInteraction: isOrderType(type),
    silent: false,
    vibrate: isOrderType(type)
      ? [500, 120, 700, 150, 900]
      : [250, 100, 250],
    timestamp: Date.now(),
    data: {
      url,
      eventId,
      type,
      payload: event.payload || {},
    },
    actions: [
      {
        action: "open",
        title: isOrderType(type) ? "Bestellung öffnen" : "Jetzt öffnen",
      },
    ],
  });
}

async function showSchnellReadyEvent(readyEvent) {
  const eventId = String(
    readyEvent && readyEvent.id ? readyEvent.id : "bb-schnell-ready",
  );
  const dedupeId = `schnell:${eventId}`;
  if (await wasSeen(dedupeId)) return;
  await markSeen(dedupeId).catch(() => undefined);

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

  await notifyOpenClients("BB_SCHNELL_READY_PUSH", readyEvent).catch(
    () => undefined,
  );
  await self.registration.showNotification(title, {
    body,
    icon: "/schnell-icon-192.png?v=1",
    badge: "/icon-kurier-192.png?v=6",
    tag: `bb-schnell-ready-${eventId}`,
    renotify: true,
    requireInteraction: true,
    silent: false,
    vibrate: [700, 120, 700, 160, 1100, 260, 700, 120, 1200],
    timestamp: Date.now(),
    data: {
      url,
      type: "schnell_ready",
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
}

self.addEventListener("push", (pushEvent) => {
  pushEvent.waitUntil(
    (async () => {
      // Genel bildirim ve Schnellbestellung aynı VAPID altyapısını paylaşır.
      // Her ikisi de kontrol edilir; dedupe cache aynı olayı iki kez göstermez.
      const [generalEvents, schnellEvent] = await Promise.all([
        loadGeneralEvents().catch(() => []),
        loadSchnellReadyEvent().catch(() => null),
      ]);

      for (const event of generalEvents.slice(0, 10)) {
        await showGeneralEvent(event).catch(() => undefined);
      }

      if (schnellEvent) {
        await showSchnellReadyEvent(schnellEvent).catch(() => undefined);
      }
    })(),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = new URL(
    (event.notification.data && event.notification.data.url) || "/menu",
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
