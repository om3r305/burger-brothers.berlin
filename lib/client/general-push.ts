"use client";

import { readLastCustomerTracking } from "@/lib/customer-tracking";
import {
  isIOSLikeDevice,
  isPwaStepTimeoutError,
  isStandaloneDisplayMode,
  PwaStepTimeoutError,
  withPwaStepTimeout,
} from "@/lib/client/pwa-compat";

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

export type GeneralPushActivationStage =
  | "permission"
  | "config"
  | "service_worker"
  | "subscription"
  | "server"
  | "done";

export type GeneralPushActivationOptions = {
  onStage?: (stage: GeneralPushActivationStage) => void;
  permissionTimeoutMs?: number;
  technicalTimeoutMs?: number;
};

export type GeneralPushFailureCode =
  | "unsupported"
  | "ios_home_screen_required"
  | "disabled"
  | "not_configured"
  | "permission_denied"
  | "permission_default"
  | "permission_timeout"
  | "config_timeout"
  | "service_worker_failed"
  | "service_worker_timeout"
  | "subscription_failed"
  | "subscription_timeout"
  | "server_failed"
  | "server_timeout";

export type GeneralPushActivationResult =
  | {
      ok: true;
      code: "subscribed";
      permission: NotificationPermission;
      state: GeneralPushState;
    }
  | {
      ok: false;
      code: GeneralPushFailureCode;
      permission: NotificationPermission;
    };

const DEFAULT_PERMISSION_TIMEOUT_MS = 30_000;
const DEFAULT_TECHNICAL_TIMEOUT_MS = 12_000;
const SERVER_ATTEMPT_TIMEOUT_MS = 8_000;

function supportsPush() {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "Notification" in window &&
    "PushManager" in window
  );
}

export function isIOSDevice() {
  return isIOSLikeDevice();
}

export function isStandaloneApp() {
  return isStandaloneDisplayMode();
}

function base64UrlToUint8Array(value: string) {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  return Uint8Array.from(raw, (character) => character.charCodeAt(0));
}

async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMs: number,
  timeoutCode: string,
) {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(
    () => controller.abort(),
    Math.max(1_000, timeoutMs),
  );

  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new PwaStepTimeoutError(timeoutCode);
    }
    throw error;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

async function registration(timeoutMs = DEFAULT_TECHNICAL_TIMEOUT_MS) {
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
}

async function parseJson(response: Response) {
  return response.json().catch(() => ({}));
}

function delay(milliseconds: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, Math.max(0, milliseconds));
  });
}

export async function loadGeneralPushState(
  timeoutMs = DEFAULT_TECHNICAL_TIMEOUT_MS,
): Promise<GeneralPushState> {
  if (!supportsPush()) return { ok: false, enabled: false, configured: false };

  const response = await fetchWithTimeout(
    "/api/push",
    {
      credentials: "same-origin",
      cache: "no-store",
      headers: { accept: "application/json" },
    },
    timeoutMs,
    "config_timeout",
  );

  return parseJson(response);
}

async function currentSubscription(
  worker: ServiceWorkerRegistration,
  publicKey: string,
  timeoutMs: number,
): Promise<PushSubscription> {
  if (!worker.pushManager) {
    throw new Error("push_manager_unavailable");
  }

  const existing = await withPwaStepTimeout(
    worker.pushManager.getSubscription(),
    timeoutMs,
    "subscription_timeout",
  );

  if (existing) return existing;

  try {
    return await withPwaStepTimeout(
      worker.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: base64UrlToUint8Array(publicKey),
      }),
      timeoutMs,
      "subscription_timeout",
    );
  } catch (error) {
    /*
      Some Android browsers finish subscribe() after the JS promise has already
      rejected or timed out. Check once more before reporting failure. This
      repairs a half-created browser subscription without removing a working
      subscription that Schnellbestellung may also use.
    */
    const recovered = await withPwaStepTimeout(
      worker.pushManager.getSubscription(),
      Math.min(4_000, timeoutMs),
      "subscription_timeout",
    ).catch(() => null);

    if (recovered) return recovered;
    throw error;
  }
}

async function saveSubscription(
  subscription: PushSubscription,
  preferences: GeneralPushPreferences,
  timeoutMs = DEFAULT_TECHNICAL_TIMEOUT_MS,
) {
  const requestBody = JSON.stringify({
    subscription: subscription.toJSON(),
    preferences,
  });

  let lastError: unknown = new Error("push_save_failed");

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetchWithTimeout(
        "/api/push",
        {
          method: "POST",
          credentials: "same-origin",
          keepalive: true,
          cache: "no-store",
          headers: {
            "content-type": "application/json",
            accept: "application/json",
          },
          body: requestBody,
        },
        Math.min(timeoutMs, SERVER_ATTEMPT_TIMEOUT_MS),
        "server_timeout",
      );

      const data = await parseJson(response);

      if (!response.ok || data?.ok === false) {
        throw new Error(
          String(data?.error || `push_http_${response.status}`),
        );
      }

      return data as GeneralPushState;
    } catch (error) {
      lastError = error;

      if (attempt < 1 && !isPwaStepTimeoutError(error)) {
        await delay(450);
      } else if (attempt < 1 && isPwaStepTimeoutError(error)) {
        await delay(250);
      }
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("push_save_failed");
}

function activationFailure(
  code: GeneralPushFailureCode,
  permission: NotificationPermission,
): GeneralPushActivationResult {
  return { ok: false, code, permission };
}

export async function activateGeneralPushFromGesture(
  preferences: GeneralPushPreferences = ALL_GENERAL_PUSH_PREFERENCES,
  options: GeneralPushActivationOptions = {},
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

  const permissionTimeoutMs =
    options.permissionTimeoutMs ?? DEFAULT_PERMISSION_TIMEOUT_MS;
  const technicalTimeoutMs =
    options.technicalTimeoutMs ?? DEFAULT_TECHNICAL_TIMEOUT_MS;

  const configPromise = loadGeneralPushState(technicalTimeoutMs)
    .then((value) => ({ ok: true as const, value }))
    .catch((error) => ({ ok: false as const, error }));

  options.onStage?.("permission");

  let permission = Notification.permission;
  if (permission === "default") {
    try {
      permission = await withPwaStepTimeout(
        Notification.requestPermission(),
        permissionTimeoutMs,
        "permission_timeout",
      );
    } catch (error) {
      if (isPwaStepTimeoutError(error)) {
        return activationFailure("permission_timeout", Notification.permission);
      }
      permission = Notification.permission;
    }
  }

  if (permission === "denied") {
    return activationFailure("permission_denied", permission);
  }
  if (permission !== "granted") {
    return activationFailure("permission_default", permission);
  }

  options.onStage?.("config");
  const configResult = await configPromise;

  if (!configResult.ok) {
    return activationFailure(
      isPwaStepTimeoutError(configResult.error)
        ? "config_timeout"
        : "server_failed",
      permission,
    );
  }

  const config = configResult.value;
  if (!config.enabled) {
    return activationFailure("disabled", permission);
  }
  if (!config.configured || !config.publicKey) {
    return activationFailure("not_configured", permission);
  }

  options.onStage?.("service_worker");

  let worker: ServiceWorkerRegistration;
  try {
    worker = await registration(technicalTimeoutMs);
  } catch (error) {
    return activationFailure(
      isPwaStepTimeoutError(error)
        ? "service_worker_timeout"
        : "service_worker_failed",
      permission,
    );
  }

  options.onStage?.("subscription");

  let subscription: PushSubscription;
  try {
    subscription = await currentSubscription(
      worker,
      config.publicKey,
      technicalTimeoutMs,
    );
  } catch (error) {
    return activationFailure(
      isPwaStepTimeoutError(error)
        ? "subscription_timeout"
        : "subscription_failed",
      permission,
    );
  }

  options.onStage?.("server");

  try {
    const state = await saveSubscription(
      subscription,
      preferences,
      technicalTimeoutMs,
    );

    try {
      localStorage.setItem("bb_general_push_activated_v1", String(Date.now()));
    } catch {}

    await repairGeneralPushOrderBindingFromLastOrder().catch(() => false);

    options.onStage?.("done");
    return { ok: true, code: "subscribed", permission, state };
  } catch (error) {
    return activationFailure(
      isPwaStepTimeoutError(error) ? "server_timeout" : "server_failed",
      permission,
    );
  }
}

export async function ensureCustomerAppPushRegistration(): Promise<boolean> {
  if (!supportsPush() || Notification.permission !== "granted") return false;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const config = await loadGeneralPushState();

      if (!config.enabled || !config.configured || !config.publicKey) {
        return false;
      }

      const worker = await registration();
      const subscription = await currentSubscription(
        worker,
        config.publicKey,
        DEFAULT_TECHNICAL_TIMEOUT_MS,
      );

      await saveSubscription(subscription, ALL_GENERAL_PUSH_PREFERENCES);

      try {
        localStorage.setItem(
          "bb_general_push_activated_v1",
          String(Date.now()),
        );
      } catch {}

      await repairGeneralPushOrderBindingFromLastOrder().catch(() => false);
      return true;
    } catch {
      if (attempt < 1) {
        await delay(650);
      }
    }
  }

  return false;
}

export async function updateGeneralPushPreferences(
  preferences: GeneralPushPreferences,
) {
  if (!supportsPush() || Notification.permission !== "granted") {
    throw new Error("push_not_active");
  }

  const config = await loadGeneralPushState();
  if (!config.publicKey) throw new Error("push_not_configured");

  const worker = await registration();
  const subscription = await currentSubscription(
    worker,
    config.publicKey,
    DEFAULT_TECHNICAL_TIMEOUT_MS,
  );

  return saveSubscription(
    subscription,
    preferences,
    DEFAULT_TECHNICAL_TIMEOUT_MS,
  );
}

export async function bindGeneralPushToOrder(
  orderId: string,
  trackingToken: string,
) {
  if (!orderId || !trackingToken || !supportsPush()) return false;
  if (Notification.permission !== "granted") return false;

  try {
    const response = await fetchWithTimeout(
      "/api/push/order",
      {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify({ orderId, trackingToken }),
        keepalive: true,
      },
      SERVER_ATTEMPT_TIMEOUT_MS,
      "server_timeout",
    );

    const data = await parseJson(response);
    return response.ok && data?.ok === true;
  } catch {
    return false;
  }
}

export async function repairGeneralPushOrderBindingFromLastOrder() {
  if (!supportsPush() || Notification.permission !== "granted") return false;

  const last = readLastCustomerTracking();
  if (!last.orderId || !last.trackingToken) return false;

  return bindGeneralPushToOrder(last.orderId, last.trackingToken);
}

export async function disableGeneralPush() {
  const response = await fetchWithTimeout(
    "/api/push",
    {
      method: "DELETE",
      credentials: "same-origin",
      headers: { accept: "application/json" },
    },
    SERVER_ATTEMPT_TIMEOUT_MS,
    "server_timeout",
  );

  return response.ok;
}
