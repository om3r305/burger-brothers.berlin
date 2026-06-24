// app/ProductsSync.tsx
"use client";

import { useEffect, useRef } from "react";

const LS_PRODUCTS = "bb_products_v1";
const LS_CAMPAIGNS = "bb_campaigns_v1";

const REFRESH_MS = 15_000;

type CatalogPayload = {
  ok?: boolean;
  source?: string;
  products?: any[];
  campaigns?: any[];
  items?: any[];
  data?: {
    products?: any[];
    campaigns?: any[];
  };
};

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

function asArray(value: any): any[] {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.items)) return value.items;
  if (Array.isArray(value?.data)) return value.data;
  if (Array.isArray(value?.products)) return value.products;
  if (Array.isArray(value?.campaigns)) return value.campaigns;

  return [];
}

function readCatalogArrays(payload: CatalogPayload | null | undefined) {
  const products = asArray(
    payload?.products ?? payload?.items ?? payload?.data?.products ?? [],
  );

  const campaigns = asArray(payload?.campaigns ?? payload?.data?.campaigns ?? []);

  return {
    products,
    campaigns,
  };
}

function dispatchLocalStorageUpdate(key: string, oldValue: string | null, newValue: string) {
  try {
    window.dispatchEvent(
      new StorageEvent("storage", {
        key,
        oldValue,
        newValue,
        storageArea: window.localStorage,
      }),
    );
  } catch {
    try {
      window.dispatchEvent(new Event("storage"));
    } catch {}
  }
}

function writeCacheIfChanged(key: string, value: any[]) {
  const next = safeStringify(value);
  const prev = localStorage.getItem(key);

  if (hash(prev || "[]") === hash(next)) return false;

  localStorage.setItem(key, next);
  dispatchLocalStorageUpdate(key, prev, next);

  return true;
}

export default function ProductsSync() {
  const runningRef = useRef(false);
  const lastCatalogHashRef = useRef("");

  useEffect(() => {
    let alive = true;
    let intervalId: ReturnType<typeof setInterval> | null = null;

    const pullCatalogFromDb = async () => {
      if (!alive) return;
      if (runningRef.current) return;

      runningRef.current = true;

      try {
        const res = await fetch("/api/catalog", {
          method: "GET",
          cache: "no-store",
          headers: {
            accept: "application/json",
          },
        });

        const payload = (await res.json().catch(() => ({}))) as CatalogPayload;

        if (!res.ok || payload?.ok === false) {
          throw new Error(`CATALOG_${res.status}`);
        }

        const { products, campaigns } = readCatalogArrays(payload);

        const catalogHash = hash(
          safeStringify({
            products,
            campaigns,
          }),
        );

        if (catalogHash === lastCatalogHashRef.current) {
          return;
        }

        lastCatalogHashRef.current = catalogHash;

        const productsChanged = writeCacheIfChanged(LS_PRODUCTS, products);
        const campaignsChanged = writeCacheIfChanged(LS_CAMPAIGNS, campaigns);

        if (productsChanged || campaignsChanged) {
          try {
            window.dispatchEvent(
              new CustomEvent("bb:catalog-sync", {
                detail: {
                  source: "db",
                  products,
                  campaigns,
                },
              }),
            );
          } catch {}
        }
      } catch {
        /*
          DB-first kuralı:
          - API başarısızsa local cache'i DB'ye basmıyoruz.
          - Mevcut local cache'i silmiyoruz.
          - Eski /api/products fallback yapmıyoruz.
        */
      } finally {
        runningRef.current = false;
      }
    };

    pullCatalogFromDb();

    const onFocus = () => {
      pullCatalogFromDb();
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        pullCatalogFromDb();
      }
    };

    const onManualRefresh = () => {
      pullCatalogFromDb();
    };

    window.addEventListener("focus", onFocus);
    window.addEventListener("bb:refresh-catalog", onManualRefresh as EventListener);
    document.addEventListener("visibilitychange", onVisibility);

    intervalId = setInterval(pullCatalogFromDb, REFRESH_MS);

    return () => {
      alive = false;

      if (intervalId) {
        clearInterval(intervalId);
      }

      window.removeEventListener("focus", onFocus);
      window.removeEventListener("bb:refresh-catalog", onManualRefresh as EventListener);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return null;
}