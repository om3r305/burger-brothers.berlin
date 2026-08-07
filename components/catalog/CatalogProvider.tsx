"use client";

import { useEffect, useRef } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import {
  installPublicDataFetchCache,
  invalidatePublicData,
  refreshPublicData,
  seedPublicData,
  warmCategoryData,
  warmPublicData,
} from "@/lib/public-data-cache";
import {
  MENU_NAV_KEYS,
  type MenuNavKey,
} from "@/lib/menu-navigation";

const PASSIVE_REFRESH_GAP_MS = 60_000;

function isCustomerCatalogPath() {
  if (typeof window === "undefined") return false;

  return [
    "/",
    "/menu",
    "/extras",
    "/drinks",
    "/sauces",
    "/hotdogs",
    "/donuts",
    "/bubble-tea",
  ].includes(window.location.pathname || "/");
}

function safeParse(value: string | null) {
  if (!value) return null;

  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function categoryForLocation(
  pathname: string,
  searchParams: { get(name: string): string | null } | null,
): MenuNavKey | null {
  if (pathname === "/extras") return "extras";
  if (pathname === "/drinks") return "drinks";
  if (pathname === "/sauces") return "sauces";
  if (pathname === "/hotdogs") return "hotdogs";
  if (pathname === "/donuts") return "donuts";
  if (pathname === "/bubble-tea") return "bubbletea";
  if (pathname !== "/menu") return null;

  const raw = String(
    searchParams?.get("cat") || searchParams?.get("tab") || "burger",
  )
    .trim()
    .toLowerCase();

  return (MENU_NAV_KEYS as readonly string[]).includes(raw)
    ? (raw as MenuNavKey)
    : "burger";
}

export default function CatalogProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const activeCategory = categoryForLocation(pathname, searchParams);
  const lastPassiveRefreshRef = useRef(0);
  const externalRefreshTimerRef = useRef<number | null>(null);

  if (typeof window !== "undefined") {
    installPublicDataFetchCache();
  }

  useEffect(() => {
    let stopped = false;

    const passiveRefresh = async () => {
      if (stopped || !isCustomerCatalogPath()) return;

      const now = Date.now();

      if (
        now - lastPassiveRefreshRef.current <
        PASSIVE_REFRESH_GAP_MS
      ) {
        return;
      }

      lastPassiveRefreshRef.current = now;

      await warmPublicData(["catalog", "groups", "settings"]);

      if (!stopped) {
        void warmCategoryData("burger");
      }
    };

    const forceCatalogRefresh = () => {
      if (!isCustomerCatalogPath()) return;

      invalidatePublicData("catalog");
      invalidatePublicData("products");
      invalidatePublicData("groups");

      void Promise.all([
        refreshPublicData("catalog", { force: true }),
        refreshPublicData("groups", { force: true }),
      ]);
    };

    const onFocus = () => {
      void passiveRefresh();
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        void passiveRefresh();
      }
    };

    const onSettingsChanged = (event: Event) => {
      const detail = (event as CustomEvent<any>)?.detail;

      if (detail && typeof detail === "object") {
        seedPublicData("settings", detail);
      }
    };

    const onStorage = (event: StorageEvent) => {
      if (event.key === "bb_settings_v6") {
        const parsed = safeParse(event.newValue);

        if (parsed) {
          seedPublicData("settings", parsed);
        }

        return;
      }

      if (
        event.key !== "bb_products_v1" &&
        event.key !== "bb_campaigns_v1"
      ) {
        return;
      }

      invalidatePublicData("catalog");

      if (externalRefreshTimerRef.current) {
        window.clearTimeout(externalRefreshTimerRef.current);
      }

      externalRefreshTimerRef.current = window.setTimeout(() => {
        void refreshPublicData("catalog", { force: true });
      }, 250);
    };

    void passiveRefresh();

    window.addEventListener("focus", onFocus);
    window.addEventListener(
      "bb:refresh-catalog",
      forceCatalogRefresh as EventListener,
    );
    window.addEventListener(
      "bb_settings_changed",
      onSettingsChanged as EventListener,
    );
    window.addEventListener("storage", onStorage);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      stopped = true;

      if (externalRefreshTimerRef.current) {
        window.clearTimeout(externalRefreshTimerRef.current);
      }

      window.removeEventListener("focus", onFocus);
      window.removeEventListener(
        "bb:refresh-catalog",
        forceCatalogRefresh as EventListener,
      );
      window.removeEventListener(
        "bb_settings_changed",
        onSettingsChanged as EventListener,
      );
      window.removeEventListener("storage", onStorage);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  useEffect(() => {
    if (!activeCategory) return;

    const keys = MENU_NAV_KEYS as readonly MenuNavKey[];
    const currentIndex = keys.indexOf(activeCategory);
    if (currentIndex < 0) return;

    const neighbors = [keys[currentIndex - 1], keys[currentIndex + 1]].filter(
      (key): key is MenuNavKey => Boolean(key),
    );

    for (const key of neighbors) {
      void warmCategoryData(key);
    }
  }, [activeCategory]);

  return <>{children}</>;
}
