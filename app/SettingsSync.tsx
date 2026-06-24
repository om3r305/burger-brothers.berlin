// app/SettingsSync.tsx
"use client";

import { useEffect, useRef } from "react";
import {
  LS_SETTINGS,
  applyRemoteSettings,
  fetchServerSettings,
  readSettings,
  type SettingsV6,
} from "@/lib/settings";

/** Admin route mu? Admin’deyken sync kapalı; düzenlenen formu ezmesin. */
function isAdminRoute() {
  try {
    const path = window.location.pathname || "/";
    return path === "/admin" || path.startsWith("/admin/");
  } catch {
    return false;
  }
}

function isPlainObject(value: any): value is Record<string, any> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isSafeKey(key: string) {
  if (!key) return false;
  if (key === "__proto__") return false;
  if (key === "prototype") return false;
  if (key === "constructor") return false;
  return true;
}

function deepMerge(base: any, override: any): any {
  if (override === undefined) return base;

  if (Array.isArray(base) || Array.isArray(override)) {
    return override;
  }

  if (!isPlainObject(base) || !isPlainObject(override)) {
    return override;
  }

  const out: Record<string, any> = { ...base };

  for (const [key, value] of Object.entries(override)) {
    if (!isSafeKey(key)) continue;

    if (isPlainObject(out[key]) && isPlainObject(value)) {
      out[key] = deepMerge(out[key], value);
    } else {
      out[key] = value;
    }
  }

  return out;
}

function stripResponseMeta(payload: any) {
  if (!isPlainObject(payload)) return null;

  const raw = isPlainObject(payload.settings) ? payload.settings : payload;
  const out: Record<string, any> = {};

  const ignoredKeys = new Set([
    "ok",
    "source",
    "tenant",
    "count",
    "counts",
    "saved",
    "keys",
    "replace",
    "createdAt",
    "updatedAt",
  ]);

  for (const [key, value] of Object.entries(raw)) {
    if (ignoredKeys.has(key)) continue;
    if (!isSafeKey(key)) continue;
    if (value === undefined) continue;

    out[key] = value;
  }

  return Object.keys(out).length ? out : null;
}

/**
 * Server → Local:
 * - DB ana kaynak.
 * - Local sadece eksik alanları doldurur.
 * - Çakışmada server kazanır.
 */
function mergeSettings(localSettings: any, serverSettings: any): SettingsV6 {
  const local = isPlainObject(localSettings) ? localSettings : {};
  const remote = stripResponseMeta(serverSettings);

  if (!remote) {
    return local as SettingsV6;
  }

  return deepMerge(local, remote) as SettingsV6;
}

async function syncSettingsOnce(reason: string) {
  if (typeof window === "undefined") return null;
  if (isAdminRoute()) return null;

  try {
    const server = await fetchServerSettings();

    if (!server) {
      return readSettings();
    }

    const localNow = readSettings();
    const merged = mergeSettings(localNow, server);

    return applyRemoteSettings(merged);
  } catch (error) {
    console.warn(`[SettingsSync] sync failed (${reason}):`, error);
    return readSettings();
  }
}

export default function SettingsSync() {
  const syncingRef = useRef(false);

  useEffect(() => {
    if (typeof window === "undefined") return;

    if (isAdminRoute()) {
      return;
    }

    let stopped = false;

    const runSync = async (reason: string) => {
      if (stopped) return;
      if (syncingRef.current) return;
      if (isAdminRoute()) return;

      syncingRef.current = true;

      try {
        await syncSettingsOnce(reason);
      } finally {
        syncingRef.current = false;
      }
    };

    runSync("initial");

    const onVisibilityChange = () => {
      if (document.visibilityState !== "visible") return;
      runSync("visibility");
    };

    const onFocus = () => {
      runSync("focus");
    };

    const onManualSync = () => {
      runSync("manual-event");
    };

    const onStorage = (event: StorageEvent) => {
      if (event.key !== LS_SETTINGS) return;
      /*
        Başka sekmede local cache değişti.
        Burada ekstra işlem yapmıyoruz; component'ler storage/custom event dinliyorsa zaten güncellenir.
      */
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("focus", onFocus);
    window.addEventListener("storage", onStorage);
    window.addEventListener("bb:settings-sync-now", onManualSync as EventListener);

    const intervalId = window.setInterval(() => {
      runSync("interval");
    }, 30_000);

    return () => {
      stopped = true;
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("bb:settings-sync-now", onManualSync as EventListener);
    };
  }, []);

  return null;
}