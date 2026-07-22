"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  fetchAndApplyRemoteSettings,
  readSettings,
} from "@/lib/settings";
import type { SettingsV6 } from "@/lib/settings";
import {
  appTZ,
  normalizeProductAvailabilityMap,
} from "@/lib/tv/domain";

export function useTvSettings() {
  const [settings, setSettings] = useState<SettingsV6>(() => readSettings());

  const refreshSettings = useCallback(async () => {
    try {
      await fetchAndApplyRemoteSettings();
    } catch {
      // Son bilinen güvenli local settings kullanılmaya devam eder.
    }

    setSettings(readSettings());
  }, []);

  useEffect(() => {
    let active = true;

    const refreshIfActive = async () => {
      if (!active) return;
      await refreshSettings();
    };

    void refreshIfActive();

    const onFocus = () => void refreshIfActive();
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        void refreshIfActive();
      }
    };
    const onSettings = () => {
      if (active) setSettings(readSettings());
    };

    window.addEventListener("focus", onFocus);
    window.addEventListener("bb_settings_changed", onSettings as EventListener);
    window.addEventListener("bb:settings-sync", onSettings as EventListener);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      active = false;
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("bb_settings_changed", onSettings as EventListener);
      window.removeEventListener("bb:settings-sync", onSettings as EventListener);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [refreshSettings]);

  const productAvailability = useMemo(
    () => normalizeProductAvailabilityMap(settings.productAvailability),
    [settings.productAvailability],
  );

  const timezone = appTZ(settings);
  const avgPickup = Number(settings.hours?.avgPickupMinutes ?? 15);
  const avgDelivery = Number(settings.hours?.avgDeliveryMinutes ?? 35);
  const newGraceMin = Math.max(
    0,
    Number(settings.hours?.newGraceMinutes ?? 5),
  );

  return {
    settings,
    setSettings,
    refreshSettings,
    productAvailability,
    timezone,
    avgPickup,
    avgDelivery,
    newGraceMin,
  };
}
