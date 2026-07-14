// app/SettingsSync.tsx
"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import {
  applyRemoteSettings,
  fetchServerSettings,
  readSettings,
} from "@/lib/settings";

const PASSIVE_REFRESH_GAP_MS = 60_000;

function isAdminRoute(path: string) {
  return path === "/admin" || path.startsWith("/admin/");
}

function isCustomerCatalogRoute(path: string) {
  return [
    "/",
    "/menu",
    "/extras",
    "/drinks",
    "/sauces",
    "/hotdogs",
    "/donuts",
    "/bubble-tea",
  ].includes(path);
}

async function syncSettingsOnce() {
  try {
    const server = await fetchServerSettings();

    if (!server) return readSettings();

    return applyRemoteSettings(server);
  } catch {
    return readSettings();
  }
}

export default function SettingsSync() {
  const pathname = usePathname();
  const syncingRef = useRef(false);
  const lastRefreshRef = useRef(0);

  useEffect(() => {
    if (isAdminRoute(pathname) || isCustomerCatalogRoute(pathname)) {
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

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onFocus);
    window.addEventListener(
      "bb:settings-sync-now",
      onManualSync as EventListener,
    );

    return () => {
      stopped = true;
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
