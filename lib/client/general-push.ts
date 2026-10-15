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
  nativeConfigured?: boolean;
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

/*
  The Burger Brothers iOS app (WKWebView) has no Web Push. It exposes a native
  bridge instead and registers an APNs device token with the same /api/push
  endpoint. The user agent token is present from the first byte, before the
  bridge script has necessarily run.
*/
type NativePushBridge = {
  platform: string;
  pushToken?: string;
  requestNotifications: () => void;
};

const NATIVE_PERMISSION_KEY = "bb_native_push_permission_v1";

export function isNativeIOSApp() {
  return (
    typeof window !== "undefined" &&
    /\bBurgerBrothers-iOS\/main\b/.test(navigator.userAgent || "")
  );
}

function nativeBridge(): NativePushBridge | null {
  const bridge = (window as any).BurgerBrothersNative;
  return bridge?.platform === "ios" &&
    typeof bridge.requestNotifications === "function"
    ? bridge
    : null;
}

function readNativePermission(): NotificationPermission {
  try {
    const value = localStorage.getItem(NATIVE_PERMISSION_KEY);
    return value === "granted" || value === "denied" ? value : "default";
  } catch {
    return "default";
  }
}

function saveNativePermission(value: NotificationPermission) {
  try {
    localStorage.setItem(NATIVE_PERMISSION_KEY, value);
  } catch {}
}

function pushPermissionGranted() {
  if (isNativeIOSApp()) return readNativePermission() === "granted";
  return supportsPush() && Notification.permission === "granted";
}

function waitForWindowEvent<T>(
  name: string,
  timeoutMs: number,
  timeoutCode: string,
  pick: (detail: any) => T | null,
  current?: () => T | null,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      window.removeEventListener(name, listener);
      reject(new PwaStepTimeoutError(timeoutCode));
    }, Math.max(1_000, timeoutMs));

    function listener(event: Event) {
      const value = pick((event as CustomEvent).detail);
      if (value === null) return;
      window.clearTimeout(timeoutId);
      window.removeEventListener(name, listener);
      resolve(value);
    }

    window.addEventListener(name, listener);

    // The value may already be there (e.g. a token delivered before we listened).
    const existing = current?.() ?? null;
    if (existing !== null) {
      window.clearTimeout(timeoutId);
      window.removeEventListener(name, listener);
      resolve(existing);
    }
  });
}

function cleanNativeToken(value: unknown) {
  const token = String(value ?? "").trim().toLowerCase();
  return /^[0-9a-f]{64,200}$/.test(token) ? token : null;
}

async function waitForNativeBridge(timeoutMs: number) {
  const ready = nativeBridge();
  if (ready) return ready;
  return waitForWindowEvent(
    "bb:nativeReady",
    timeoutMs,
    "config_timeout",
    () => nativeBridge(),
    () => nativeBridge(),
  );
}

function nativePushToken(timeoutMs: number) {
  return waitForWindowEvent(
    "bb:nativePushToken",
    timeoutMs,
    "subscription_timeout",
    (detail) => cleanNativeToken(detail?.token),
    () => cleanNativeToken(nativeBridge()?.pushToken),
  );
}

export function isStandaloneApp() {
  return isNativeIOSApp() || isStandaloneDisplayMode();
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
  if (!supportsPush() && !isNativeIOSApp()) {
    return { ok: false, enabled: false, configured: false };
  }

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
  subscription: PushSubscription | { nativeToken: string },
  preferences: GeneralPushPreferences,
  timeoutMs = DEFAULT_TECHNICAL_TIMEOUT_MS,
) {
  const requestBody = JSON.stringify(
    "nativeToken" in subscription
      ? {
          native: {
            platform: "ios",
            appKind: "main",
            token: subscription.nativeToken,
          },
          preferences,
        }
      : {
          subscription: subscription.toJSON(),
          preferences,
        },
  );

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

function markGeneralPushActivated() {
  try {
    localStorage.setItem("bb_general_push_activated_v1", String(Date.now()));
  } catch {}
}

async function activateNativePush(
  preferences: GeneralPushPreferences,
  options: GeneralPushActivationOptions,
): Promise<GeneralPushActivationResult> {
  const permissionTimeoutMs =
    options.permissionTimeoutMs ?? DEFAULT_PERMISSION_TIMEOUT_MS;
  const technicalTimeoutMs =
    options.technicalTimeoutMs ?? DEFAULT_TECHNICAL_TIMEOUT_MS;

  const configPromise = loadGeneralPushState(technicalTimeoutMs)
    .then((value) => ({ ok: true as const, value }))
    .catch((error) => ({ ok: false as const, error }));

  options.onStage?.("permission");

  let bridge: NativePushBridge;
  try {
    bridge = await waitForNativeBridge(3_000);
  } catch {
    return activationFailure("unsupported", "default");
  }

  let granted: boolean;
  try {
    const answer = waitForWindowEvent(
      "bb:nativePushPermission",
      permissionTimeoutMs,
      "permission_timeout",
      (detail) => (typeof detail?.granted === "boolean" ? detail.granted : null),
    );
    bridge.requestNotifications();
    granted = await answer;
  } catch {
    return activationFailure("permission_timeout", readNativePermission());
  }

  saveNativePermission(granted ? "granted" : "denied");
  if (!granted) return activationFailure("permission_denied", "denied");

  options.onStage?.("config");
  const configResult = await configPromise;
  if (!configResult.ok) {
    return activationFailure(
      isPwaStepTimeoutError(configResult.error) ? "config_timeout" : "server_failed",
      "granted",
    );
  }
  if (!configResult.value.enabled) return activationFailure("disabled", "granted");
  if (!configResult.value.nativeConfigured) {
    return activationFailure("not_configured", "granted");
  }

  options.onStage?.("subscription");
  let token: string;
  try {
    token = await nativePushToken(technicalTimeoutMs);
  } catch {
    return activationFailure("subscription_timeout", "granted");
  }

  options.onStage?.("server");
  try {
    const state = await saveSubscription(
      { nativeToken: token },
      preferences,
      technicalTimeoutMs,
    );
    markGeneralPushActivated();
    await repairGeneralPushOrderBindingFromLastOrder().catch(() => false);
    options.onStage?.("done");
    return { ok: true, code: "subscribed", permission: "granted", state };
  } catch (error) {
    return activationFailure(
      isPwaStepTimeoutError(error) ? "server_timeout" : "server_failed",
      "granted",
    );
  }
}

export async function activateGeneralPushFromGesture(
  preferences: GeneralPushPreferences = ALL_GENERAL_PUSH_PREFERENCES,
  options: GeneralPushActivationOptions = {},
): Promise<GeneralPushActivationResult> {
  if (isNativeIOSApp()) {
    return activateNativePush(preferences, options);
  }

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

async function ensureNativePushRegistration(): Promise<boolean> {
  if (readNativePermission() !== "granted") return false;

  try {
    const config = await loadGeneralPushState();
    if (!config.enabled || !config.nativeConfigured) return false;

    const token = await nativePushToken(DEFAULT_TECHNICAL_TIMEOUT_MS);
    await saveSubscription(
      { nativeToken: token },
      config.subscribed && config.preferences
        ? config.preferences
        : ALL_GENERAL_PUSH_PREFERENCES,
    );
    markGeneralPushActivated();
    await repairGeneralPushOrderBindingFromLastOrder().catch(() => false);
    return true;
  } catch {
    return false;
  }
}

export async function ensureCustomerAppPushRegistration(): Promise<boolean> {
  if (isNativeIOSApp()) return ensureNativePushRegistration();
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
  if (isNativeIOSApp()) {
    if (readNativePermission() !== "granted") throw new Error("push_not_active");
    const token = await nativePushToken(DEFAULT_TECHNICAL_TIMEOUT_MS);
    return saveSubscription({ nativeToken: token }, preferences);
  }

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
  if (!orderId || !trackingToken || !pushPermissionGranted()) return false;

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
  if (!pushPermissionGranted()) return false;

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
