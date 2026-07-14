// app/ProductsSync.tsx
"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

const LS_PRODUCTS = "bb_products_v1";
const LS_CAMPAIGNS = "bb_campaigns_v1";
const PASSIVE_REFRESH_GAP_MS = 60_000;

type CatalogPayload = {
  ok?: boolean;
  products?: any[];
  campaigns?: any[];
  items?: any[];
  data?: {
    products?: any[];
    campaigns?: any[];
  };
};

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

function writeIfChanged(key: string, value: any[]) {
  const next = safeStringify(value);
  const previous = localStorage.getItem(key);

  if (previous === next) return false;

  localStorage.setItem(key, next);
  return true;
}

export default function ProductsSync() {
  const pathname = usePathname();
  const runningRef = useRef(false);
  const lastRefreshRef = useRef(0);

  useEffect(() => {
    if (isAdminRoute(pathname) || isCustomerCatalogRoute(pathname)) {
      return;
    }

    let stopped = false;

    const pullCatalogFromDb = async (force = false) => {
      if (stopped || runningRef.current || isAdminRoute(pathname)) return;

      const now = Date.now();

      if (
        !force &&
        now - lastRefreshRef.current < PASSIVE_REFRESH_GAP_MS
      ) {
        return;
      }

      lastRefreshRef.current = now;
      runningRef.current = true;

      try {
        const response = await fetch("/api/catalog", {
          method: "GET",
          cache: "no-store",
          headers: {
            accept: "application/json",
          },
        });

        const payload = (await response
          .json()
          .catch(() => ({}))) as CatalogPayload;

        if (!response.ok || payload?.ok === false) {
          throw new Error(`CATALOG_${response.status}`);
        }

        const products = asArray(
          payload?.products ??
            payload?.items ??
            payload?.data?.products ??
            [],
        );

        const campaigns = asArray(
          payload?.campaigns ??
            payload?.data?.campaigns ??
            [],
        );

        const productsChanged = writeIfChanged(
          LS_PRODUCTS,
          products,
        );
        const campaignsChanged = writeIfChanged(
          LS_CAMPAIGNS,
          campaigns,
        );

        if (productsChanged || campaignsChanged) {
          window.dispatchEvent(
            new CustomEvent("bb:catalog-sync", {
              detail: payload,
            }),
          );
        }
      } catch {
        // Son sağlam cache korunur.
      } finally {
        runningRef.current = false;
      }
    };

    const onFocus = () => {
      void pullCatalogFromDb();
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        void pullCatalogFromDb();
      }
    };

    const onManualRefresh = () => {
      void pullCatalogFromDb(true);
    };

    void pullCatalogFromDb();

    window.addEventListener("focus", onFocus);
    window.addEventListener(
      "bb:refresh-catalog",
      onManualRefresh as EventListener,
    );
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      stopped = true;
      window.removeEventListener("focus", onFocus);
      window.removeEventListener(
        "bb:refresh-catalog",
        onManualRefresh as EventListener,
      );
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [pathname]);

  return null;
}
