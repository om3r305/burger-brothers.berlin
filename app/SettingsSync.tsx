// app/SettingsSync.tsx
"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import {
  LS_SETTINGS,
  applyRemoteSettings,
  fetchServerSettings,
  readSettings,
} from "@/lib/settings";

const PASSIVE_REFRESH_GAP_MS = 60_000;
const SHOP_STATUS_REFRESH_MS = 5_000;

function isAdminRoute(path: string) {
  return path === "/admin" || path.startsWith("/admin/");
}

function isDedicatedOperationalRoute(path: string) {
  return ["/tv", "/driver", "/showcase"].some(
    (route) => path === route || path.startsWith(`${route}/`),
  );
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

function publishShopStatus(status: any) {
  const current = readSettings();
  const next = {
    ...current,
    site: {
      ...(current.site || {}),
      closed: status?.closed === true,
      message: String(status?.message || ""),
      maintenanceStart: String(status?.maintenanceStart || ""),
      maintenanceEnd: String(status?.maintenanceEnd || ""),
    },
  };

  try {
    localStorage.setItem(LS_SETTINGS, JSON.stringify(next));
  } catch {}

  try {
    window.dispatchEvent(
      new CustomEvent("bb_settings_changed", {
        detail: next,
      }),
    );
  } catch {}
}

export default function SettingsSync() {
  const pathname = usePathname();
  const syncingRef = useRef(false);
  const shopStatusSyncingRef = useRef(false);
  const lastRefreshRef = useRef(0);

  // Shop-Status is intentionally independent from the normal settings sync.
  // Customer catalog + TV/driver/showcase routes skip the heavy settings pull,
  // but the emergency stop must still reach every open client quickly.
  useEffect(() => {
    if (isAdminRoute(pathname)) return;

    let stopped = false;

    const runShopStatusSync = async () => {
      if (stopped || shopStatusSyncingRef.current) return;
      shopStatusSyncingRef.current = true;

      try {
        const response = await fetch(`/api/shop-status?ts=${Date.now()}`, {
          method: "GET",
          cache: "no-store",
          credentials: "same-origin",
          headers: {
            accept: "application/json",
          },
        });
        const payload = await response.json().catch(() => null);

        if (payload && typeof payload.closed === "boolean") {
          publishShopStatus(payload);
        }
      } catch {
        // Keep the last authoritative state during a transient network error.
        // New requests are still protected by middleware/server validation.
      } finally {
        shopStatusSyncingRef.current = false;
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        void runShopStatusSync();
      }
    };

    const onFocus = () => {
      void runShopStatusSync();
    };

    void runShopStatusSync();
    const intervalId = window.setInterval(
      runShopStatusSync,
      SHOP_STATUS_REFRESH_MS,
    );

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onFocus);

    return () => {
      stopped = true;
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onFocus);
    };
  }, [pathname]);

  useEffect(() => {
    if (
      isAdminRoute(pathname) ||
      isCustomerCatalogRoute(pathname) ||
      isDedicatedOperationalRoute(pathname)
    ) {
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
