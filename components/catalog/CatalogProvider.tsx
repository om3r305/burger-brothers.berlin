"use client";

import { useEffect } from "react";
import {
  installPublicDataFetchCache,
  invalidatePublicData,
  refreshPublicData,
  seedPublicData,
  warmCategoryData,
  warmPublicData,
} from "@/lib/public-data-cache";

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

export default function CatalogProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  /*
   * Parent render sırasında kurulur; böylece kategori sayfalarının useEffect
   * fetch çağrıları başlamadan merkezi cache hazır olur.
   */
  if (typeof window !== "undefined") {
    installPublicDataFetchCache();
  }

  useEffect(() => {
    let stopped = false;

    const warmInitialData = async () => {
      if (!isCustomerCatalogPath()) return;

      await warmPublicData(["catalog", "groups", "settings"]);

      if (!stopped) {
        void warmCategoryData("burger");
      }
    };

    const onFocus = () => {
      if (isCustomerCatalogPath()) {
        void warmPublicData(["catalog", "groups", "settings"]);
      }
    };

    const onVisibility = () => {
      if (
        document.visibilityState === "visible" &&
        isCustomerCatalogPath()
      ) {
        void warmPublicData(["catalog", "groups", "settings"]);
      }
    };

    const onCatalogRefresh = () => {
      invalidatePublicData("catalog");
      invalidatePublicData("products");
      invalidatePublicData("groups");

      void Promise.all([
        refreshPublicData("catalog", { force: true }),
        refreshPublicData("groups", { force: true }),
      ]);
    };

    const onSettingsChanged = (event: Event) => {
      const custom = event as CustomEvent<any>;

      if (custom?.detail && typeof custom.detail === "object") {
        seedPublicData("settings", custom.detail);
      } else {
        invalidatePublicData("settings");
        void refreshPublicData("settings", { force: true });
      }
    };

    const onStorage = (event: StorageEvent) => {
      if (
        event.key === "bb_products_v1" ||
        event.key === "bb_campaigns_v1"
      ) {
        invalidatePublicData("catalog");
      }

      if (event.key === "bb_settings_v6") {
        invalidatePublicData("settings");
      }
    };

    void warmInitialData();

    window.addEventListener("focus", onFocus);
    window.addEventListener(
      "bb:refresh-catalog",
      onCatalogRefresh as EventListener,
    );
    window.addEventListener(
      "bb_settings_changed",
      onSettingsChanged as EventListener,
    );
    window.addEventListener(
      "bb:settings-sync",
      onSettingsChanged as EventListener,
    );
    window.addEventListener("storage", onStorage);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      stopped = true;
      window.removeEventListener("focus", onFocus);
      window.removeEventListener(
        "bb:refresh-catalog",
        onCatalogRefresh as EventListener,
      );
      window.removeEventListener(
        "bb_settings_changed",
        onSettingsChanged as EventListener,
      );
      window.removeEventListener(
        "bb:settings-sync",
        onSettingsChanged as EventListener,
      );
      window.removeEventListener("storage", onStorage);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return <>{children}</>;
}
