"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchAndApplyRemoteSettings, readSettings } from "@/lib/settings";
import type {
  ProductAvailabilityAction,
  ProductAvailabilityMap,
  TvProduct,
} from "@/types/tv";
import {
  endOfTodayIso,
  normalizeTvProducts,
  productAvailabilityKey,
} from "@/lib/tv/domain";

const TV_PRODUCTS_MIN_REFRESH_GAP_MS = 30_000;

export function useTvProducts({
  productAvailability,
  timezone,
  onSettingsChanged,
}: {
  productAvailability: ProductAvailabilityMap;
  timezone: string;
  onSettingsChanged: () => void;
}) {
  const [products, setProducts] = useState<TvProduct[]>([]);
  const [busyKey, setBusyKey] = useState("");
  const [error, setError] = useState("");
  const refreshRunningRef = useRef(false);
  const lastRefreshAtRef = useRef(0);

  const refreshProducts = useCallback(async (force = false) => {
    const now = Date.now();
    if (refreshRunningRef.current) return;
    if (
      !force &&
      now - lastRefreshAtRef.current < TV_PRODUCTS_MIN_REFRESH_GAP_MS
    ) {
      return;
    }

    refreshRunningRef.current = true;
    lastRefreshAtRef.current = now;

    try {
      const response = await fetch("/api/products", {
        method: "GET",
        cache: "no-store",
        headers: { accept: "application/json" },
      });

      if (!response.ok) throw new Error(`products_${response.status}`);

      const payload: unknown = await response.json();
      setProducts(normalizeTvProducts(payload));
      setError("");
    } catch (caught) {
      console.error("TV products load failed", caught);
      setError("Artikel konnten nicht geladen werden.");
    } finally {
      refreshRunningRef.current = false;
    }
  }, []);

  useEffect(() => {
    let active = true;

    const load = async () => {
      if (active) await refreshProducts();
    };

    void refreshProducts(true);

    const onFocus = () => void load();
    const onVisibility = () => {
      if (document.visibilityState === "visible") void load();
    };

    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      active = false;
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [refreshProducts]);

  const updateAvailability = useCallback(
    async (product: TvProduct, action: ProductAvailabilityAction) => {
      const key = productAvailabilityKey(product);
      if (!key) return;

      const nextEntry =
        action === "open"
          ? null
          : {
              disabled: true,
              mode: action === "today" ? "today" : "manual",
              until: action === "today" ? endOfTodayIso(timezone) : null,
              by: "tv",
              updatedAt: Date.now(),
              productId: key,
              name: product.name,
            };

      const nextAvailability: ProductAvailabilityMap = {
        ...productAvailability,
        [key]: nextEntry,
      };

      setBusyKey(key);
      setError("");

      try {
        const response = await fetch("/api/settings", {
          method: "POST",
          cache: "no-store",
          headers: {
            "Content-Type": "application/json",
            accept: "application/json",
          },
          body: JSON.stringify({
            productAvailability: nextAvailability,
          }),
        });

        if (!response.ok) {
          const payload = await response.json().catch(() => null);
          throw new Error(
            payload?.message ||
              payload?.error ||
              `settings_${response.status}`,
          );
        }

        await fetchAndApplyRemoteSettings();
        readSettings();
        onSettingsChanged();

        window.dispatchEvent(new Event("bb_settings_changed"));
        window.dispatchEvent(new Event("bb:settings-sync"));
      } catch (caught) {
        console.error("TV product availability update failed", caught);
        setError("Artikel-Status konnte nicht gespeichert werden.");
      } finally {
        setBusyKey("");
      }
    },
    [onSettingsChanged, productAvailability, timezone],
  );

  return {
    products,
    busyKey,
    error,
    refreshProducts,
    updateAvailability,
  };
}
