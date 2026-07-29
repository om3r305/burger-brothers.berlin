"use client";

import {
  isIOSLikeDevice,
  isPwaStepTimeoutError,
  isStandaloneDisplayMode,
  PwaStepTimeoutError,
  withPwaStepTimeout,
} from "@/lib/client/pwa-compat";

export type AdminPushState = {
  ok?: boolean;
  enabled?: boolean;
  configured?: boolean;
  publicKey?: string;
  subscribed?: boolean;
};

export type AdminPushActivationStage =
  | "permission"
  | "config"
  | "service_worker"
  | "subscription"
  | "server"
  | "done";

export type AdminPushActivationOptions = {
  onStage?: (stage: AdminPushActivationStage) => void;
  permissionTimeoutMs?: number;
  technicalTimeoutMs?: number;
};

export type AdminPushFailureCode =
  | "unsupported"
  | "ios_home_screen_required"
  | "permission_denied"
  | "permission_default"
  | "permission_timeout"
  | "config_timeout"
  | "not_configured"
  | "service_worker_failed"
  | "service_worker_timeout"
  | "subscription_failed"
  | "subscription_timeout"
  | "server_failed"
  | "server_timeout";

export type AdminPushActivationResult =
  | { ok: true; code: "subscribed"; state: AdminPushState }
  | { ok: false; code: AdminPushFailureCode };

const DEFAULT_PERMISSION_TIMEOUT_MS = 30_000;
const DEFAULT_TECHNICAL_TIMEOUT_MS = 12_000;
const SERVER_TIMEOUT_MS = 8_000;

function supportsAdminPush() {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "Notification" in window &&
    "PushManager" in window
  );
}

export function isAdminStandalone() {
  return isStandaloneDisplayMode();
}

export function isAdminIOS() {
  return isIOSLikeDevice();
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
    if (controller.signal.aborted) {
      throw new PwaStepTimeoutError(code);
    }
    throw error;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

async function adminRegistration(timeoutMs = DEFAULT_TECHNICAL_TIMEOUT_MS) {
  const registered = await withPwaStepTimeout(
    navigator.serviceWorker.register("/admin-sw.js", {
      scope: "/admin/",
      updateViaCache: "none",
    }),
    timeoutMs,
    "service_worker_timeout",
  );

  await registered.update().catch(() => undefined);

  return withPwaStepTimeout(
    navigator.serviceWorker.ready.then((ready) =>
      ready.scope.includes("/admin/") ? ready : registered,
    ),
    timeoutMs,
    "service_worker_timeout",
  );
}

export async function loadAdminPushState(
  timeoutMs = DEFAULT_TECHNICAL_TIMEOUT_MS,
): Promise<AdminPushState> {
  if (!supportsAdminPush()) {
    return { ok: false, enabled: false, configured: false };
  }

  const response = await fetchWithTimeout(
    "/api/admin/push",
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
  registration: ServiceWorkerRegistration,
  publicKey: string,
  timeoutMs: number,
) {
  if (!registration.pushManager) {
    throw new Error("push_manager_unavailable");
  }

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

async function saveSubscription(
  subscription: PushSubscription,
  timeoutMs = DEFAULT_TECHNICAL_TIMEOUT_MS,
) {
  const response = await fetchWithTimeout(
    "/api/admin/push",
    {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      keepalive: true,
      headers: {
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({ subscription: subscription.toJSON() }),
    },
    Math.min(timeoutMs, SERVER_TIMEOUT_MS),
    "server_timeout",
  );

  const data = await parseJson(response);
  if (!response.ok || data?.ok === false) {
    throw new Error(String(data?.error || `push_http_${response.status}`));
  }

  return data as AdminPushState;
}

export async function activateAdminPushFromGesture(
  options: AdminPushActivationOptions = {},
): Promise<AdminPushActivationResult> {
  if (!supportsAdminPush()) return { ok: false, code: "unsupported" };
  if (isAdminIOS() && !isAdminStandalone()) {
    return { ok: false, code: "ios_home_screen_required" };
  }

  const permissionTimeoutMs =
    options.permissionTimeoutMs ?? DEFAULT_PERMISSION_TIMEOUT_MS;
  const technicalTimeoutMs =
    options.technicalTimeoutMs ?? DEFAULT_TECHNICAL_TIMEOUT_MS;

  const configPromise = loadAdminPushState(technicalTimeoutMs)
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
        return { ok: false, code: "permission_timeout" };
      }
      permission = Notification.permission;
    }
  }

  if (permission === "denied") {
    return { ok: false, code: "permission_denied" };
  }
  if (permission !== "granted") {
    return { ok: false, code: "permission_default" };
  }

  options.onStage?.("config");
  const configResult = await configPromise;

  if (!configResult.ok) {
    return {
      ok: false,
      code: isPwaStepTimeoutError(configResult.error)
        ? "config_timeout"
        : "server_failed",
    };
  }

  const config = configResult.value;
  if (!config.configured || !config.publicKey) {
    return { ok: false, code: "not_configured" };
  }

  options.onStage?.("service_worker");

  let registration: ServiceWorkerRegistration;
  try {
    registration = await adminRegistration(technicalTimeoutMs);
  } catch (error) {
    return {
      ok: false,
      code: isPwaStepTimeoutError(error)
        ? "service_worker_timeout"
        : "service_worker_failed",
    };
  }

  options.onStage?.("subscription");

  let subscription: PushSubscription;
  try {
    subscription = await currentSubscription(
      registration,
      config.publicKey,
      technicalTimeoutMs,
    );
  } catch (error) {
    return {
      ok: false,
      code: isPwaStepTimeoutError(error)
        ? "subscription_timeout"
        : "subscription_failed",
    };
  }

  options.onStage?.("server");

  try {
    const state = await saveSubscription(subscription, technicalTimeoutMs);
    localStorage.setItem("bb_admin_push_enabled_v1", "1");
    options.onStage?.("done");
    return { ok: true, code: "subscribed", state };
  } catch (error) {
    return {
      ok: false,
      code: isPwaStepTimeoutError(error)
        ? "server_timeout"
        : "server_failed",
    };
  }
}

export async function ensureAdminPushRegistration() {
  if (!supportsAdminPush() || Notification.permission !== "granted") return false;
  if (localStorage.getItem("bb_admin_push_enabled_v1") !== "1") return false;

  try {
    const config = await loadAdminPushState();
    if (!config.configured || !config.publicKey) return false;

    const registration = await adminRegistration();
    const subscription = await currentSubscription(
      registration,
      config.publicKey,
      DEFAULT_TECHNICAL_TIMEOUT_MS,
    );

    await saveSubscription(subscription);
    return true;
  } catch {
    return false;
  }
}

export async function disableAdminPush() {
  try {
    const registration = await withPwaStepTimeout(
      navigator.serviceWorker.getRegistration("/admin/"),
      6_000,
      "service_worker_timeout",
    );
    const subscription = await withPwaStepTimeout(
      registration?.pushManager.getSubscription() ?? Promise.resolve(null),
      6_000,
      "subscription_timeout",
    );
    await subscription?.unsubscribe().catch(() => false);
  } catch {}

  localStorage.removeItem("bb_admin_push_enabled_v1");

  const response = await fetchWithTimeout(
    "/api/admin/push",
    {
      method: "DELETE",
      credentials: "same-origin",
      headers: { accept: "application/json" },
    },
    SERVER_TIMEOUT_MS,
    "server_timeout",
  );

  return response.ok;
}
