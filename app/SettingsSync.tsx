// app/SettingsSync.tsx
"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import {
  applyRemoteSettings,
  fetchServerSettings,
  readSettings,
} from "@/lib/settings";

const PASSIVE_REFRESH_GAP_MS = 15_000;

function isAdminRoute(path: string) {
  return path === "/admin" || path.startsWith("/admin/");
}

function isDedicatedOperationalRoute(path: string) {
  return ["/tv", "/driver", "/showcase"].some(
    (route) => path === route || path.startsWith(`${route}/`),
  );
}

async function fetchPublicRuntimeSettings() {
  try {
    const res = await fetch(`/api/settings/runtime?ts=${Date.now()}`, {
      method: "GET",
      cache: "no-store",
      headers: { accept: "application/json" },
    });
    if (!res.ok) return null;
    const json = await res.json().catch(() => null);
    return json && typeof json === "object" ? json : null;
  } catch {
    return null;
  }
}

async function syncSettingsOnce() {
  try {
    const [server, runtime] = await Promise.all([
      fetchServerSettings(),
      fetchPublicRuntimeSettings(),
    ]);

    if (!server && !runtime) return readSettings();

    return applyRemoteSettings({
      ...(server || {}),
      ...(runtime || {}),
    });
  } catch {
    return readSettings();
  }
}

export default function SettingsSync() {
  const pathname = usePathname();
  const syncingRef = useRef(false);
  const lastRefreshRef = useRef(0);

  useEffect(() => {
    if (isAdminRoute(pathname) || isDedicatedOperationalRoute(pathname)) {
      return;
    }

    let stopped = false;

    const runSync = async (force = false) => {
      if (stopped || syncingRef.current || isAdminRoute(pathname)) return;

      const now = Date.now();

      if (
        !force &&
        now - lastRefreshRef.current < PASSIVE_REFRESH_GAP_MS
      ) {
        return;
      }

      lastRefreshRef.current = now;
      syncingRef.current = true;

      try {
        await syncSettingsOnce();
      } finally {
        syncingRef.current = false;
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        void runSync();
      }
    };

    const onFocus = () => {
      void runSync();
    };

    const onManualSync = () => {
      void runSync(true);
    };

    void runSync();

    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void runSync();
      }
    }, PASSIVE_REFRESH_GAP_MS);

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onFocus);
    window.addEventListener(
      "bb:settings-sync-now",
      onManualSync as EventListener,
    );

    return () => {
      stopped = true;
      window.clearInterval(interval);
      document.removeEventListener(
        "visibilitychange",
        onVisibility,
      );
      window.removeEventListener("focus", onFocus);
      window.removeEventListener(
        "bb:settings-sync-now",
        onManualSync as EventListener,
      );
    };
  }, [pathname]);

  return null;
}
