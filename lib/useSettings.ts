// lib/useSettings.ts
"use client";

import { useEffect, useState } from "react";
import {
  LS_SETTINGS,
  readSettings,
  writeSettings,
  type SettingsV6,
} from "./settings";

/** React tarafında ayarları okuma/yazma hook’u (LS senkron + storage olayı) */
export function useSettings() {
  const [settings, setSettingsState] = useState<SettingsV6>(readSettings());
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    // İlk yüklemede normalleştirilmiş ayarı çek
    setSettingsState(readSettings());
    setLoaded(true);

    // Diğer sekmelerden/değişikliklerden haberdar ol
    const onStorage = (e: StorageEvent) => {
      if (!e || e.key === LS_SETTINGS) {
        setSettingsState(readSettings());
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  /** setSettings(prev => next) veya setSettings(patch) şeklinde kullanım */
  function setSettings(
    updater:
      | Partial<SettingsV6>
      | ((prev: SettingsV6) => Partial<SettingsV6> | SettingsV6)
  ) {
    setSettingsState((prev) => {
      const patch =
        typeof updater === "function" ? (updater as any)(prev) : updater;
      return writeSettings(patch) as SettingsV6;
    });
  }

  return { settings, setSettings, loaded } as const;
}
