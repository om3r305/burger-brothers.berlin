"use client";

type PushConfig = {
  ok?: boolean;
  enabled?: boolean;
  configured?: boolean;
  publicKey?: string;
};

type SchnellPushWindow = Window &
  typeof globalThis & {
    __bbSchnellPushConfig?: PushConfig;
    __bbSchnellPushConfigPromise?: Promise<PushConfig>;
    __bbSchnellPushRegistrationPromise?: Promise<ServiceWorkerRegistration>;
    __bbSchnellPushPermissionPromise?: Promise<NotificationPermission>;
    __bbSchnellPushBindPromises?: Record<string, Promise<boolean>>;
  };

function browserSupportsPush() {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

function base64UrlToUint8Array(value: string) {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  return Uint8Array.from(raw, (character) => character.charCodeAt(0));
}

function pushWindow() {
  return window as SchnellPushWindow;
}

async function loadConfig() {
  if (!browserSupportsPush()) return {};

  const currentWindow = pushWindow();
  currentWindow.__bbSchnellPushConfigPromise ||= fetch(
    "/api/schnellbestellung/push",
    {
      credentials: "same-origin",
      cache: "no-store",
    },
  )
    .then((response) => response.json().catch(() => ({})))
    .then((config) => {
      currentWindow.__bbSchnellPushConfig = config;
      return config;
    })
    .catch(() => ({}));

  return currentWindow.__bbSchnellPushConfigPromise;
}

async function registerWorker() {
  if (!browserSupportsPush()) throw new Error("push_not_supported");

  const currentWindow = pushWindow();
  currentWindow.__bbSchnellPushRegistrationPromise ||= navigator.serviceWorker
    .register("/sw.js", { scope: "/" })
    .then(() => navigator.serviceWorker.ready);

  return currentWindow.__bbSchnellPushRegistrationPromise;
}

export function prewarmSchnellPush() {
  if (!browserSupportsPush()) return;
  void loadConfig();
  void registerWorker().catch(() => undefined);
}

export function requestSchnellPushPermissionFromGesture() {
  if (!browserSupportsPush()) return;

  const currentWindow = pushWindow();
  const currentConfig = currentWindow.__bbSchnellPushConfig;
  if (currentConfig && (!currentConfig.enabled || !currentConfig.configured)) {
    return;
  }

  if (Notification.permission === "granted") {
    currentWindow.__bbSchnellPushPermissionPromise = Promise.resolve("granted");
    return;
  }
  if (Notification.permission === "denied") {
    currentWindow.__bbSchnellPushPermissionPromise = Promise.resolve("denied");
    return;
  }

  // This call intentionally happens directly inside the final order button's
  // click handler. Android Chrome requires a user gesture for the permission
  // prompt. No extra application modal or button is introduced.
  try {
    currentWindow.__bbSchnellPushPermissionPromise =
      Notification.requestPermission().catch(() => "denied");
  } catch {
    currentWindow.__bbSchnellPushPermissionPromise = Promise.resolve("denied");
  }
}

export async function bindSchnellPushToOrder(orderId: string) {
  if (!browserSupportsPush() || !orderId) return false;

  const currentWindow = pushWindow();
  currentWindow.__bbSchnellPushBindPromises ||= {};
  const existingBind = currentWindow.__bbSchnellPushBindPromises[orderId];
  if (existingBind) return existingBind;

  const bindPromise = (async () => {
    try {
      const config = await loadConfig();
      if (!config.enabled || !config.configured || !config.publicKey) {
        return false;
      }

      const permission = currentWindow.__bbSchnellPushPermissionPromise
        ? await currentWindow.__bbSchnellPushPermissionPromise
        : Notification.permission;
      if (permission !== "granted") return false;

      const registration = await registerWorker();
      const existing = await registration.pushManager.getSubscription();
      const subscription =
        existing ||
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: base64UrlToUint8Array(config.publicKey),
        }));

      const response = await fetch("/api/schnellbestellung/push", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        cache: "no-store",
        keepalive: true,
        body: JSON.stringify({
          orderId,
          subscription: subscription.toJSON(),
        }),
      });

      return response.ok;
    } catch {
      return false;
    }
  })();

  currentWindow.__bbSchnellPushBindPromises[orderId] = bindPromise;
  const result = await bindPromise;
  if (!result) delete currentWindow.__bbSchnellPushBindPromises[orderId];
  return result;
}
