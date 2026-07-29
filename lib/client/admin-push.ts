"use client";

export type AdminPushState = {
  ok?: boolean;
  enabled?: boolean;
  configured?: boolean;
  publicKey?: string;
  subscribed?: boolean;
};

export type AdminPushActivationResult =
  | { ok: true; code: "subscribed"; state: AdminPushState }
  | {
      ok: false;
      code:
        | "unsupported"
        | "ios_home_screen_required"
        | "permission_denied"
        | "permission_default"
        | "not_configured"
        | "service_worker_failed"
        | "subscription_failed"
        | "server_failed";
    };

type IOSNavigator = Navigator & { standalone?: boolean };

function supportsAdminPush() {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "Notification" in window &&
    "PushManager" in window
  );
}

export function isAdminStandalone() {
  if (typeof window === "undefined") return false;
  const nav = navigator as IOSNavigator;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    window.matchMedia("(display-mode: fullscreen)").matches ||
    nav.standalone === true
  );
}

export function isAdminIOS() {
  if (typeof window === "undefined") return false;
  const nav = navigator as IOSNavigator;
  const ua = nav.userAgent || "";
  return (
    /iphone|ipad|ipod/i.test(ua) ||
    (nav.platform === "MacIntel" && Number(nav.maxTouchPoints || 0) > 1)
  );
}

function base64UrlToUint8Array(value: string) {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  return Uint8Array.from(raw, (character) => character.charCodeAt(0));
}

async function parseJson(response: Response) {
  return response.json().catch(() => ({}));
}

async function adminRegistration() {
  const registration = await navigator.serviceWorker.register("/admin-sw.js", {
    scope: "/admin/",
    updateViaCache: "none",
  });
  await registration.update().catch(() => undefined);
  return registration;
}

export async function loadAdminPushState(): Promise<AdminPushState> {
  if (!supportsAdminPush()) {
    return { ok: false, enabled: false, configured: false };
  }

  const response = await fetch("/api/admin/push", {
    credentials: "same-origin",
    cache: "no-store",
    headers: { accept: "application/json" },
  });
  return parseJson(response);
}

async function currentSubscription(publicKey: string) {
  const registration = await adminRegistration();
  const existing = await registration.pushManager.getSubscription();
  if (existing) return existing;

  return registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: base64UrlToUint8Array(publicKey),
  });
}

async function saveSubscription(subscription: PushSubscription) {
  const response = await fetch("/api/admin/push", {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    keepalive: true,
    headers: {
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({ subscription: subscription.toJSON() }),
  });
  const data = await parseJson(response);
  if (!response.ok || data?.ok === false) {
    throw new Error(String(data?.error || `push_http_${response.status}`));
  }
  return data as AdminPushState;
}

export async function activateAdminPushFromGesture(): Promise<AdminPushActivationResult> {
  if (!supportsAdminPush()) return { ok: false, code: "unsupported" };
  if (isAdminIOS() && !isAdminStandalone()) {
    return { ok: false, code: "ios_home_screen_required" };
  }

  let permission = Notification.permission;
  if (permission === "default") {
    try {
      permission = await Notification.requestPermission();
    } catch {
      permission = Notification.permission;
    }
  }

  if (permission === "denied") {
    return { ok: false, code: "permission_denied" };
  }
  if (permission !== "granted") {
    return { ok: false, code: "permission_default" };
  }

  let config: AdminPushState;
  try {
    config = await loadAdminPushState();
  } catch {
    return { ok: false, code: "server_failed" };
  }

  if (!config.configured || !config.publicKey) {
    return { ok: false, code: "not_configured" };
  }

  let subscription: PushSubscription;
  try {
    subscription = await currentSubscription(config.publicKey);
  } catch {
    return { ok: false, code: "subscription_failed" };
  }

  try {
    const state = await saveSubscription(subscription);
    localStorage.setItem("bb_admin_push_enabled_v1", "1");
    return { ok: true, code: "subscribed", state };
  } catch {
    return { ok: false, code: "server_failed" };
  }
}

export async function ensureAdminPushRegistration() {
  if (!supportsAdminPush() || Notification.permission !== "granted") return false;
  if (localStorage.getItem("bb_admin_push_enabled_v1") !== "1") return false;

  try {
    const config = await loadAdminPushState();
    if (!config.configured || !config.publicKey) return false;
    const subscription = await currentSubscription(config.publicKey);
    await saveSubscription(subscription);
    return true;
  } catch {
    return false;
  }
}

export async function disableAdminPush() {
  try {
    const registration = await navigator.serviceWorker.getRegistration("/admin/");
    const subscription = await registration?.pushManager.getSubscription();
    await subscription?.unsubscribe().catch(() => false);
  } catch {}

  localStorage.removeItem("bb_admin_push_enabled_v1");
  const response = await fetch("/api/admin/push", {
    method: "DELETE",
    credentials: "same-origin",
    headers: { accept: "application/json" },
  });
  return response.ok;
}
