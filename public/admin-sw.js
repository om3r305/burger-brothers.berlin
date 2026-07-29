self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {});

const CACHE_NAME = "bb-admin-push-seen-v1";

function seenKey(id) {
  return `/admin/__push_seen__/${encodeURIComponent(String(id || ""))}`;
}

async function wasSeen(id) {
  if (!id) return false;
  const cache = await caches.open(CACHE_NAME);
  return Boolean(await cache.match(seenKey(id)));
}

async function markSeen(id) {
  if (!id) return;
  const cache = await caches.open(CACHE_NAME);
  await cache.put(
    seenKey(id),
    new Response(String(Date.now()), {
      headers: { "content-type": "text/plain; charset=utf-8" },
    }),
  );
}

async function loadPending() {
  const response = await fetch("/api/admin/push/pending", {
    method: "GET",
    credentials: "include",
    cache: "no-store",
    headers: { accept: "application/json" },
  });
  if (!response.ok) return [];
  const data = await response.json().catch(() => ({}));
  return data && data.ok && Array.isArray(data.items) ? data.items : [];
}

async function notifyOpenClients(item) {
  const windows = await self.clients.matchAll({
    type: "window",
    includeUncontrolled: true,
  });
  for (const client of windows) {
    client.postMessage({ type: "BB_ADMIN_PUSH", item });
  }
}

function safeAdminUrl(value) {
  try {
    const url = new URL(String(value || "/admin"), self.location.origin);
    if (url.origin !== self.location.origin) return "/admin";
    if (url.pathname !== "/admin" && !url.pathname.startsWith("/admin/")) {
      return "/admin";
    }
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return "/admin";
  }
}

async function showItem(item) {
  const id = String(item && item.id ? item.id : "");
  if (!id || (await wasSeen(id))) return;
  await markSeen(id).catch(() => undefined);

  const type = String(item.type || "admin_attention");
  const url = safeAdminUrl(item.url);
  await notifyOpenClients(item).catch(() => undefined);

  await self.registration.showNotification(
    String(item.title || "Burger Brothers Admin"),
    {
      body: String(item.body || "Yeni bir admin işlemi bekliyor."),
      icon: "/admin/icons/admin-192.png?v=1",
      badge: "/admin/icons/admin-badge-96.png?v=1",
      tag: `bb-admin-${type}-${id}`,
      renotify: true,
      requireInteraction:
        type === "winner_photo_approval" ||
        type === "google_review_approval",
      silent: false,
      vibrate: [300, 100, 450, 120, 650],
      timestamp: item.createdAt ? Date.parse(String(item.createdAt)) : Date.now(),
      data: { url, id, type },
      actions: [{ action: "open", title: "Admin’de aç" }],
    },
  );
}

self.addEventListener("push", (event) => {
  event.waitUntil(
    (async () => {
      const items = await loadPending().catch(() => []);
      for (const item of items.slice().reverse()) {
        await showItem(item).catch(() => undefined);
      }
    })(),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = new URL(
    safeAdminUrl(event.notification.data && event.notification.data.url),
    self.location.origin,
  ).href;

  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });

      for (const client of windows) {
        if ("navigate" in client) await client.navigate(targetUrl);
        if ("focus" in client) await client.focus();
        return;
      }

      if (self.clients.openWindow) {
        await self.clients.openWindow(targetUrl);
      }
    })(),
  );
});
