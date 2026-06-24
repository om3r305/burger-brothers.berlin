// app/DriversSync.tsx
"use client";

import { useEffect, useRef } from "react";

const LS = "bb_drivers_v1";
const REFRESH_MS = 15_000;

function hash(value: string) {
  let h = 0;
  for (let i = 0; i < value.length; i += 1) {
    h = (h * 31 + value.charCodeAt(i)) | 0;
  }
  return String(h >>> 0);
}

function safeStringify(value: any) {
  try {
    return JSON.stringify(value ?? []);
  } catch {
    return "[]";
  }
}

function readDrivers(payload: any): any[] {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.drivers)) return payload.drivers;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.data?.items)) return payload.data.items;
  if (Array.isArray(payload?.data?.drivers)) return payload.data.drivers;
  return [];
}

function dispatchDriversCache(next: string, oldValue: string | null) {
  try {
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: LS,
        oldValue,
        newValue: next,
        storageArea: window.localStorage,
      })
    );
  } catch {
    try {
      window.dispatchEvent(new Event("storage"));
    } catch {}
  }

  try {
    window.dispatchEvent(
      new CustomEvent("bb:drivers-sync", {
        detail: {
          source: "db",
          drivers: JSON.parse(next),
        },
      })
    );
  } catch {}
}

export default function DriversSync() {
  const runningRef = useRef(false);
  const lastHashRef = useRef("");

  useEffect(() => {
    let alive = true;
    let intervalId: ReturnType<typeof setInterval> | null = null;

    const pullFromDb = async () => {
      if (!alive || runningRef.current) return;

      runningRef.current = true;

      try {
        const res = await fetch("/api/drivers", {
          method: "GET",
          cache: "no-store",
          headers: {
            accept: "application/json",
          },
        });

        if (!res.ok) throw new Error(`DRIVERS_GET_${res.status}`);

        const payload = await res.json().catch(() => ({}));
        const drivers = readDrivers(payload);
        const next = safeStringify(drivers);
        const nextHash = hash(next);

        if (nextHash === lastHashRef.current) return;

        lastHashRef.current = nextHash;

        const oldValue = localStorage.getItem(LS);

        if (hash(oldValue || "[]") !== nextHash) {
          localStorage.setItem(LS, next);
          dispatchDriversCache(next, oldValue);
        }
      } catch {
        /*
          DB-first kuralı:
          - API başarısızsa localStorage DB'ye basılmaz.
          - Mevcut cache silinmez.
          - Driver ana kaynak DB olarak kalır.
        */
      } finally {
        runningRef.current = false;
      }
    };

    void pullFromDb();

    const onFocus = () => {
      void pullFromDb();
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        void pullFromDb();
      }
    };

    const onManualRefresh = () => {
      void pullFromDb();
    };

    const onStorage = (event: StorageEvent) => {
      if (!event.key || event.key === LS) {
        void pullFromDb();
      }
    };

    window.addEventListener("focus", onFocus);
    window.addEventListener("storage", onStorage);
    window.addEventListener("bb:refresh-drivers", onManualRefresh as EventListener);
    document.addEventListener("visibilitychange", onVisibility);

    intervalId = setInterval(pullFromDb, REFRESH_MS);

    return () => {
      alive = false;

      if (intervalId) {
        clearInterval(intervalId);
      }

      window.removeEventListener("focus", onFocus);
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("bb:refresh-drivers", onManualRefresh as EventListener);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return null;
}