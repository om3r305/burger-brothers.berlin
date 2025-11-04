"use client";

import { useEffect } from "react";
import {
  LS_SETTINGS,
  fetchServerSettings,
  writeSettings,
  readSettings,
} from "@/lib/settings";

/** Admin route mu? Admin’deyken sync kapalı (local’i ezmesin) */
function isAdminRoute() {
  try {
    const p = window.location.pathname || "/";
    return p === "/admin" || p.startsWith("/admin/");
  } catch {
    return false;
  }
}

/** Server → Local merge: server boşsa local değerleri koru */
function mergeSettings(localAny: any, serverAny: any) {
  const local = localAny || {};
  const remote = serverAny || {};

  // Basit derin birleşim (alan bazlı)
  const out: any = { ...local, ...remote };

  // announcements: server boş/undefined ise local’i koru
  const srvAnn = remote?.announcements;
  const locAnn = local?.announcements;
  out.announcements = {
    enabled:
      srvAnn?.enabled ?? locAnn?.enabled ?? false,
    items:
      (Array.isArray(srvAnn?.items) && srvAnn.items.length > 0
        ? srvAnn.items
        : Array.isArray(locAnn?.items)
        ? locAnn.items
        : []),
  };

  // features: undefined gelirse local’i koru
  out.features = {
    bubbleTea: {
      enabled:
        remote?.features?.bubbleTea?.enabled ??
        local?.features?.bubbleTea?.enabled ??
        false,
    },
    donuts: {
      enabled:
        remote?.features?.donuts?.enabled ??
        local?.features?.donuts?.enabled ??
        false,
    },
  };

  // site (bakım): mevcut değilse local’i koru
  out.site = {
    closed: remote?.site?.closed ?? local?.site?.closed ?? false,
    message: remote?.site?.message ?? local?.site?.message ?? "",
  };

  return out;
}

export default function SettingsSync() {
  useEffect(() => {
    // Admin’de SEN düzenleme yapıyorsun → sync tamamen kapalı
    if (isAdminRoute()) {
      return;
    }

    let stop = false;

    // İlk yüklemede server’dan çek + local ile MERGE et
    (async () => {
      try {
        const server = await fetchServerSettings();
        if (stop) return;
        const localNow = readSettings() as any;
        const merged = mergeSettings(localNow, server);
        writeSettings(merged);
      } catch {
        // offline ise: local cache ile devam
      }
    })();

    // Görünürlük değişiminde güncelle (admin değilken)
    const onVis = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const server = await fetchServerSettings();
        const localNow = readSettings() as any;
        const merged = mergeSettings(localNow, server);
        writeSettings(merged);
      } catch {}
    };
    document.addEventListener("visibilitychange", onVis);

    // Periyodik: 30sn (admin değilken)
    const id = setInterval(async () => {
      try {
        const server = await fetchServerSettings();
        const localNow = readSettings() as any;
        const merged = mergeSettings(localNow, server);
        writeSettings(merged);
      } catch {}
    }, 30_000);

    // Local değişikliği algıla (sadece tetikleyici; iş yapmıyoruz)
    const onStorage = (e: StorageEvent) => {
      if (e.key !== LS_SETTINGS) return;
      // başka sekmede güncellendi bilgisini almış oluruz
    };
    window.addEventListener("storage", onStorage);

    return () => {
      stop = true;
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  return null;
}
