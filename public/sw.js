const PUSH_STATE_CACHE = "bb-push-state-v5";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil(
    Promise.all([
      self.clients.claim(),
      caches.keys().then((keys) =>
        Promise.all(
          keys
            .filter(
              (key) =>
                (key.startsWith("bb-push-state-") && key !== PUSH_STATE_CACHE) ||
                key.startsWith("bb-menu-images-"),
            )
            .map((key) => caches.delete(key)),
        ),
      ),
    ]),
  );
});

// Menü görsellerini tarayıcının HTTP cache'i yönetir. Service worker burada
// fetch yakalamaz; böylece her menü geçişinde arka plan ağ isteği oluşmaz.

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

async function fetchJsonWithTimeout(url, timeoutMs = 4_500) {
  const controller = new AbortController();
  const timeoutId = setTimeout(
    () => controller.abort(),
    Math.max(1_500, Number(timeoutMs) || 4_500),
  );

  try {
    const response = await fetch(url, {
      method: "GET",
      credentials: "include",
      cache: "no-store",
      headers: { accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) return null;
    return await response.json().catch(() => null);
  } finally {
    clearTimeout(timeoutId);
  }
}

async function loadGeneralEvents() {
  const data = await fetchJsonWithTimeout("/api/push/pending");
  return data && data.ok && Array.isArray(data.events) ? data.events : [];
}

async function loadSchnellReadyEvent() {
  const data = await fetchJsonWithTimeout(
    "/api/schnellbestellung/push?pending=1",
    3_500,
  );
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function showGeneralEvent(event) {
  const eventId = String(event && event.id ? event.id : "");
  const expiresAt = event && event.expiresAt ? Date.parse(String(event.expiresAt)) : NaN;
  if (Number.isFinite(expiresAt) && expiresAt <= Date.now()) return;
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
      customerNumber,
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
      // Schnellbestellung eski çalışan sürümde yalnız kendi pending endpoint'ini
      // bekliyordu. Genel bildirim endpoint'i yavaşlasa bile hazır sipariş
      // bildirimi artık onu beklemez; iki iş bağımsız çalışır.
      const schnellTask = (async () => {
        const schnellEvent = await loadSchnellReadyEvent().catch(() => null);
        if (schnellEvent) {
          await showSchnellReadyEvent(schnellEvent).catch(() => undefined);
        }
      })();

      const generalTask = (async () => {
        const generalEvents = await loadGeneralEvents().catch(() => []);
        for (const event of generalEvents.slice(0, 10)) {
          await showGeneralEvent(event).catch(() => undefined);
        }
      })();

      await Promise.allSettled([schnellTask, generalTask]);
    })(),
  );
});

self.addEventListener("notificationclick", (event) => {
  const notificationData = event.notification.data || {};
  event.notification.close();

  const target = new URL(notificationData.url || "/menu", self.location.origin);
  const isSchnellReady = notificationData.type === "schnell_ready";
  const readyEventId = String(notificationData.readyEventId || "").trim();
  const orderId = String(
    notificationData.orderId || target.searchParams.get("order") || "",
  ).trim();

  if (isSchnellReady) {
    target.searchParams.set("readyOpen", "1");
    target.searchParams.set("app", "schnell");
    if (readyEventId) target.searchParams.set("readyEventId", readyEventId);
    if (orderId && !target.searchParams.get("order")) {
      target.searchParams.set("order", orderId);
    }
  }

  const openMessage = {
    type: "BB_SCHNELL_NOTIFICATION_OPEN",
    readyEventId,
    event: {
      id: readyEventId,
      orderId,
      customerNumber: notificationData.customerNumber,
    },
  };

  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });

      if (isSchnellReady) {
        for (const client of windows) {
          if (!("focus" in client)) continue;
          let clientUrl;
          try {
            clientUrl = new URL(client.url);
          } catch {
            continue;
          }
          if (clientUrl.pathname !== "/schnellbestellung/success") continue;
          if (clientUrl.searchParams.get("app") !== "schnell") continue;
          const clientOrderId = String(
            clientUrl.searchParams.get("order") || "",
          ).trim();
          if (orderId && clientOrderId && clientOrderId !== orderId) continue;

          client.postMessage(openMessage);
          await client.focus();
          [50, 150, 350, 700].forEach((delay) => {
            setTimeout(() => client.postMessage(openMessage), delay);
          });
          return;
        }
      }

      const targetUrl = target.href;

      // Schnell bildirimi normal Safari sekmesini veya ana Burger Brothers
      // penceresini ele geçirmemeli. Uygun BB Schnell penceresi yukarıda
      // bulunmadıysa işletim sisteminden Schnell kapsamını açmasını isteriz.
      if (!isSchnellReady) {
        for (const client of windows) {
          if (!("focus" in client)) continue;
          let targetClient = client;
          if ("navigate" in client) {
            targetClient = (await client.navigate(targetUrl)) || client;
          }
          await targetClient.focus();
          return;
        }
      }

      if (self.clients.openWindow) {
        const targetClient = await self.clients.openWindow(targetUrl);
        if (isSchnellReady) targetClient?.postMessage(openMessage);
      }
    })(),
  );
});
