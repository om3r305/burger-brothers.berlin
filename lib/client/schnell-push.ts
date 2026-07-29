"use client";

import {
  isPwaStepTimeoutError,
  PwaStepTimeoutError,
  withPwaStepTimeout,
} from "@/lib/client/pwa-compat";

type PushConfig = {
  ok?: boolean;
  enabled?: boolean;
  configured?: boolean;
  publicKey?: string;
};

export type SchnellPushActivationStage =
  | "permission"
  | "config"
  | "service_worker"
  | "subscription"
  | "done";

type SchnellPushWindow = Window &
  typeof globalThis & {
    __bbSchnellPushConfig?: PushConfig;
    __bbSchnellPushConfigPromise?: Promise<PushConfig>;
    __bbSchnellPushRegistrationPromise?: Promise<ServiceWorkerRegistration>;
    __bbSchnellPushPermissionPromise?: Promise<NotificationPermission>;
    __bbSchnellPushBindPromises?: Record<string, Promise<boolean>>;
  };

const PERMISSION_TIMEOUT_MS = 30_000;
const TECHNICAL_TIMEOUT_MS = 12_000;
const SERVER_TIMEOUT_MS = 8_000;

function browserSupportsPush() {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "Notification" in window &&
    "PushManager" in window
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

async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMs: number,
  code: string,
) {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(
    () => controller.abort(),
    Math.max(1_000, timeoutMs),
  );

  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted) throw new PwaStepTimeoutError(code);
    throw error;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

async function loadConfig(timeoutMs = TECHNICAL_TIMEOUT_MS) {
  if (!browserSupportsPush()) return {};

  const currentWindow = pushWindow();

  if (!currentWindow.__bbSchnellPushConfigPromise) {
    currentWindow.__bbSchnellPushConfigPromise = fetchWithTimeout(
      "/api/schnellbestellung/push",
      {
        credentials: "same-origin",
        cache: "no-store",
      },
      timeoutMs,
      "config_timeout",
    )
      .then((response) => response.json().catch(() => ({})))
      .then((config) => {
        currentWindow.__bbSchnellPushConfig = config;
        return config;
      })
      .catch((error) => {
        delete currentWindow.__bbSchnellPushConfigPromise;
        throw error;
      });
  }

  return currentWindow.__bbSchnellPushConfigPromise;
}

async function registerWorker(timeoutMs = TECHNICAL_TIMEOUT_MS) {
  if (!browserSupportsPush()) throw new Error("push_not_supported");

  const currentWindow = pushWindow();

  if (!currentWindow.__bbSchnellPushRegistrationPromise) {
    currentWindow.__bbSchnellPushRegistrationPromise = (async () => {
      const registered = await withPwaStepTimeout(
        navigator.serviceWorker.register("/sw.js", {
          scope: "/",
          updateViaCache: "none",
        }),
        timeoutMs,
        "service_worker_timeout",
      );

      await registered.update().catch(() => undefined);

      return withPwaStepTimeout(
        navigator.serviceWorker.ready,
        timeoutMs,
        "service_worker_timeout",
      );
    })().catch((error) => {
      delete currentWindow.__bbSchnellPushRegistrationPromise;
      throw error;
    });
  }

  return currentWindow.__bbSchnellPushRegistrationPromise;
}

async function getOrCreateSubscription(
  registration: ServiceWorkerRegistration,
  publicKey: string,
  timeoutMs = TECHNICAL_TIMEOUT_MS,
) {
  if (!registration.pushManager) throw new Error("push_manager_unavailable");

  const existing = await withPwaStepTimeout(
    registration.pushManager.getSubscription(),
    timeoutMs,
    "subscription_timeout",
  );

  if (existing) return existing;

  try {
    return await withPwaStepTimeout(
      registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: base64UrlToUint8Array(publicKey),
      }),
      timeoutMs,
      "subscription_timeout",
    );
  } catch (error) {
    const recovered = await withPwaStepTimeout(
      registration.pushManager.getSubscription(),
      Math.min(timeoutMs, 4_000),
      "subscription_timeout",
    ).catch(() => null);

    if (recovered) return recovered;
    throw error;
  }
}

export function prewarmSchnellPush() {
  if (!browserSupportsPush()) return;
  void loadConfig().catch(() => undefined);
  void registerWorker().catch(() => undefined);
}

export type SchnellPushActivationResult =
  | { ok: true; code: "subscribed"; permission: NotificationPermission }
  | {
      ok: false;
      code:
        | "unsupported"
        | "disabled"
        | "not_configured"
        | "permission_denied"
        | "permission_default"
        | "permission_timeout"
        | "config_timeout"
        | "service_worker_failed"
        | "service_worker_timeout"
        | "subscription_failed"
        | "subscription_timeout";
      permission: NotificationPermission;
    };

export async function activateSchnellPushFromGesture(
  onStage?: (stage: SchnellPushActivationStage) => void,
): Promise<SchnellPushActivationResult> {
  if (!browserSupportsPush()) {
    return {
      ok: false,
      code: "unsupported",
      permission: "default",
    };
  }

  const currentWindow = pushWindow();
  const configPromise = loadConfig()
    .then((value) => ({ ok: true as const, value }))
    .catch((error) => ({ ok: false as const, error }));
  const registrationPromise = registerWorker()
    .then((value) => ({ ok: true as const, value }))
    .catch((error) => ({ ok: false as const, error }));

  onStage?.("permission");

  let permission = Notification.permission;
  if (permission === "default") {
    try {
      currentWindow.__bbSchnellPushPermissionPromise = withPwaStepTimeout(
        Notification.requestPermission(),
        PERMISSION_TIMEOUT_MS,
        "permission_timeout",
      );
      permission = await currentWindow.__bbSchnellPushPermissionPromise;
    } catch (error) {
      if (isPwaStepTimeoutError(error)) {
        delete currentWindow.__bbSchnellPushPermissionPromise;
        return {
          ok: false,
          code: "permission_timeout",
          permission: Notification.permission,
        };
      }
      permission = Notification.permission;
    }
  } else {
    currentWindow.__bbSchnellPushPermissionPromise =
      Promise.resolve(permission);
  }

  if (permission === "denied") {
    return { ok: false, code: "permission_denied", permission };
  }
  if (permission !== "granted") {
    return { ok: false, code: "permission_default", permission };
  }

  onStage?.("config");
  const configResult = await configPromise;

  if (!configResult.ok) {
    return {
      ok: false,
      code: isPwaStepTimeoutError(configResult.error)
        ? "config_timeout"
        : "not_configured",
      permission,
    };
  }

  const config = configResult.value;
  if (!config.enabled) {
    return { ok: false, code: "disabled", permission };
  }
  if (!config.configured || !config.publicKey) {
    return { ok: false, code: "not_configured", permission };
  }

  onStage?.("service_worker");
  const registrationResult = await registrationPromise;

  if (!registrationResult.ok) {
    return {
      ok: false,
      code: isPwaStepTimeoutError(registrationResult.error)
        ? "service_worker_timeout"
        : "service_worker_failed",
      permission,
    };
  }

  onStage?.("subscription");

  try {
    await getOrCreateSubscription(
      registrationResult.value,
      config.publicKey,
      TECHNICAL_TIMEOUT_MS,
    );

    try {
      window.localStorage.setItem(
        "bb_schnell_push_activated_v1",
        String(Date.now()),
      );
    } catch {}

    onStage?.("done");
    return { ok: true, code: "subscribed", permission };
  } catch (error) {
    return {
      ok: false,
      code: isPwaStepTimeoutError(error)
        ? "subscription_timeout"
        : "subscription_failed",
      permission,
    };
  }
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

  try {
    currentWindow.__bbSchnellPushPermissionPromise = withPwaStepTimeout(
      Notification.requestPermission(),
      PERMISSION_TIMEOUT_MS,
      "permission_timeout",
    ).catch(() => Notification.permission);
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
        ? await withPwaStepTimeout(
            currentWindow.__bbSchnellPushPermissionPromise,
            PERMISSION_TIMEOUT_MS,
            "permission_timeout",
          )
        : Notification.permission;

      if (permission !== "granted") return false;

      const registration = await registerWorker();
      const subscription = await getOrCreateSubscription(
        registration,
        config.publicKey,
        TECHNICAL_TIMEOUT_MS,
      );

      const response = await fetchWithTimeout(
        "/api/schnellbestellung/push",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          credentials: "same-origin",
          cache: "no-store",
          keepalive: true,
          body: JSON.stringify({
            orderId,
            subscription: subscription.toJSON(),
          }),
        },
        SERVER_TIMEOUT_MS,
        "server_timeout",
      );

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
