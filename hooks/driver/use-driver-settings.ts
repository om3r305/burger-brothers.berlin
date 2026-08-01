"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  fetchAndApplyRemoteSettings,
  readSettings,
  type SettingsV6,
} from "@/lib/settings";
import {
  DEFAULT_ACTIVE_UNKNOWN_GRACE_MS,
  DEFAULT_DRIVER_REFRESH_MS,
  cleanObj,
  normalizeRoutePriority,
  routePriorityFromSettings,
  storeOriginFromSettings,
} from "@/lib/driver/domain";

const DRIVER_SETTINGS_MIN_REFRESH_GAP_MS = 30_000;

export function useDriverSettings() {
  const [settings, setSettings] = useState<SettingsV6>(() => readSettings());
  const refreshRunningRef = useRef(false);
  const lastRefreshAtRef = useRef(0);

  const refreshSettings = useCallback(async (force = false) => {
    const now = Date.now();
    if (refreshRunningRef.current) return;
    if (
      !force &&
      now - lastRefreshAtRef.current < DRIVER_SETTINGS_MIN_REFRESH_GAP_MS
    ) {
      setSettings(readSettings());
      return;
    }

    refreshRunningRef.current = true;
    lastRefreshAtRef.current = now;

    try {
      await fetchAndApplyRemoteSettings();
    } catch {
      // Son bilinen sağlam local ayarlar kullanılmaya devam eder.
    } finally {
      refreshRunningRef.current = false;
    }

    setSettings(readSettings());
  }, []);

  useEffect(() => {
    let active = true;

    const refreshIfActive = async () => {
      if (!active) return;
      await refreshSettings();
    };

    void refreshSettings(true);

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
    window.addEventListener(
      "bb_settings_changed",
      onSettings as EventListener,
    );
    window.addEventListener(
      "bb:settings-sync",
      onSettings as EventListener,
    );
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      active = false;
      window.removeEventListener("focus", onFocus);
      window.removeEventListener(
        "bb_settings_changed",
        onSettings as EventListener,
      );
      window.removeEventListener(
        "bb:settings-sync",
        onSettings as EventListener,
      );
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [refreshSettings]);

  const computed = useMemo(() => {
    const root = cleanObj(settings);
    const hours = cleanObj(root.hours);
    const driver = cleanObj(root.driver);

    const timezone = String(
      hours.timezone || hours.tz || "Europe/Berlin",
    );

    const refreshSeconds = Number(
      driver.refreshSeconds ?? driver.autoRefreshSeconds,
    );
    const activeUnknownHours = Number(
      driver.activeUnknownGraceHours ??
        driver.unknownOrderGraceHours,
    );

    return {
      timezone,
      avgPickup: Number(hours.avgPickupMinutes ?? 15),
      avgDelivery: Number(hours.avgDeliveryMinutes ?? 35),
      refreshMs:
        Number.isFinite(refreshSeconds) && refreshSeconds >= 3
          ? Math.round(refreshSeconds * 1000)
          : DEFAULT_DRIVER_REFRESH_MS,
      activeUnknownGraceMs:
        Number.isFinite(activeUnknownHours) && activeUnknownHours > 0
          ? Math.round(activeUnknownHours * 60 * 60 * 1000)
          : DEFAULT_ACTIVE_UNKNOWN_GRACE_MS,
      routePlzPriority: normalizeRoutePriority(
        routePriorityFromSettings(settings),
      ),
      storeOrigin: storeOriginFromSettings(settings),
    };
  }, [settings]);

  return {
    settings,
    setSettings,
    refreshSettings,
    ...computed,
  };
}
