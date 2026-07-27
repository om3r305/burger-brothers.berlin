"use client";

export type GeneralPushPreferences = {
  allNotifications: boolean;
  orderUpdates: boolean;
  campaigns: boolean;
  coupons: boolean;
  nearbyDelivery: boolean;
};

export const ALL_GENERAL_PUSH_PREFERENCES: GeneralPushPreferences = {
  allNotifications: true,
  orderUpdates: true,
  campaigns: true,
  coupons: true,
  nearbyDelivery: true,
};

export type GeneralPushState = {
  ok?: boolean;
  enabled?: boolean;
  configured?: boolean;
  publicKey?: string;
  subscribed?: boolean;
  platform?: string | null;
  preferences?: GeneralPushPreferences;
};

export type GeneralPushActivationResult =
  | {
      ok: true;
      code: "subscribed";
      permission: NotificationPermission;
      state: GeneralPushState;
    }
  | {
      ok: false;
      code:
        | "unsupported"
        | "ios_home_screen_required"
        | "disabled"
        | "not_configured"
        | "permission_denied"
        | "permission_default"
        | "service_worker_failed"
        | "subscription_failed"
        | "server_failed";
      permission: NotificationPermission;
    };

type BeforeInstallNavigator = Navigator & { standalone?: boolean };

function supportsPush() {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "Notification" in window
  );
}

export function isIOSDevice() {
  if (typeof window === "undefined") return false;
  const nav = navigator as BeforeInstallNavigator;
  const ua = nav.userAgent || "";
  return (
    /iphone|ipad|ipod/i.test(ua) ||
    (nav.platform === "MacIntel" && Number(nav.maxTouchPoints || 0) > 1)
  );
}

export function isStandaloneApp() {
  if (typeof window === "undefined") return false;
  const nav = navigator as BeforeInstallNavigator;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    window.matchMedia("(display-mode: fullscreen)").matches ||
    nav.standalone === true
  );
}

function base64UrlToUint8Array(value: string) {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  return Uint8Array.from(raw, (character) => character.charCodeAt(0));
}

async function registration() {
  await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  return navigator.serviceWorker.ready;
}

async function parseJson(response: Response) {
  return response.json().catch(() => ({}));
}

export async function loadGeneralPushState(): Promise<GeneralPushState> {
  if (!supportsPush()) return { ok: false, enabled: false, configured: false };

  const response = await fetch("/api/push", {
    credentials: "same-origin",
    cache: "no-store",
    headers: { accept: "application/json" },
  });
  return parseJson(response);
}

async function currentSubscription(
  publicKey: string,
): Promise<PushSubscription> {
  const worker = await registration();
  const existing = await worker.pushManager.getSubscription();
  if (existing) return existing;

  return worker.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: base64UrlToUint8Array(publicKey),
  });
}

async function saveSubscription(
  subscription: PushSubscription,
  preferences: GeneralPushPreferences,
) {
  const response = await fetch("/api/push", {
    method: "POST",
    credentials: "same-origin",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({
      subscription: subscription.toJSON(),
      preferences,
    }),
  });
  const data = await parseJson(response);
  if (!response.ok || data?.ok === false) {
    throw new Error(String(data?.error || `push_http_${response.status}`));
  }
  return data as GeneralPushState;
}

export async function activateGeneralPushFromGesture(
  preferences: GeneralPushPreferences = ALL_GENERAL_PUSH_PREFERENCES,
): Promise<GeneralPushActivationResult> {
  if (!supportsPush()) {
    return { ok: false, code: "unsupported", permission: "default" };
  }

  if (isIOSDevice() && !isStandaloneApp()) {
    return {
      ok: false,
      code: "ios_home_screen_required",
      permission: Notification.permission,
    };
  }

  const configPromise = loadGeneralPushState();
  let permission = Notification.permission;

  if (permission === "default") {
    try {
      permission = await Notification.requestPermission();
    } catch {
      permission = Notification.permission;
    }
  }

  if (permission === "denied") {
    return { ok: false, code: "permission_denied", permission };
  }
  if (permission !== "granted") {
    return { ok: false, code: "permission_default", permission };
  }

  let config: GeneralPushState;
  try {
    config = await configPromise;
  } catch {
    return { ok: false, code: "server_failed", permission };
  }

  if (!config.enabled) {
    return { ok: false, code: "disabled", permission };
  }
  if (!config.configured || !config.publicKey) {
    return { ok: false, code: "not_configured", permission };
  }

  let subscription: PushSubscription;
  try {
    subscription = await currentSubscription(config.publicKey);
  } catch (error) {
    const code =
      error instanceof Error && /service worker/i.test(error.message)
        ? "service_worker_failed"
        : "subscription_failed";
    return { ok: false, code, permission };
  }

  try {
    const state = await saveSubscription(subscription, preferences);
    try {
      localStorage.setItem("bb_general_push_activated_v1", String(Date.now()));
    } catch {}
    return { ok: true, code: "subscribed", permission, state };
  } catch {
    return { ok: false, code: "server_failed", permission };
  }
}


export async function ensureCustomerAppPushRegistration(): Promise<boolean> {
  if (!supportsPush() || Notification.permission !== "granted") return false;

  try {
    const config = await loadGeneralPushState();
    if (!config.enabled || !config.configured || !config.publicKey) return false;

    const subscription = await currentSubscription(config.publicKey);
    await saveSubscription(subscription, ALL_GENERAL_PUSH_PREFERENCES);

    try {
      localStorage.setItem("bb_general_push_activated_v1", String(Date.now()));
    } catch {}

    return true;
  } catch {
    return false;
  }
}


export async function updateGeneralPushPreferences(
  preferences: GeneralPushPreferences,
) {
  if (!supportsPush() || Notification.permission !== "granted") {
    throw new Error("push_not_active");
  }

  const config = await loadGeneralPushState();
  if (!config.publicKey) throw new Error("push_not_configured");
  const subscription = await currentSubscription(config.publicKey);
  return saveSubscription(subscription, preferences);
}

export async function bindGeneralPushToOrder(
  orderId: string,
  trackingToken: string,
) {
  if (!orderId || !trackingToken || !supportsPush()) return false;
  if (Notification.permission !== "granted") return false;

  try {
    const response = await fetch("/api/push/order", {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({ orderId, trackingToken }),
      keepalive: true,
    });
    const data = await parseJson(response);
    return response.ok && data?.ok === true;
  } catch {
    return false;
  }
}

export async function disableGeneralPush() {
  // PushSubscription aynı origin üzerindeki Schnellbestellung tarafından da
  // kullanılabilir. Tarayıcı aboneliğini unsubscribe ederek çalışan Fertig
  // bildirimini bozma; yalnız genel bildirim kaydını sunucuda pasifleştir.
  const response = await fetch("/api/push", {
    method: "DELETE",
    credentials: "same-origin",
    headers: { accept: "application/json" },
  });
  return response.ok;
}
