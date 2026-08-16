"use client";

import { useEffect, useState } from "react";
import { DriverStatCard } from "@/components/driver/DriverStatCard";
import { glass } from "@/lib/driver/domain";
import type { DriverIdentity, DriverStats } from "@/types/driver";

function safeDriverKey(value: unknown) {
  return (
    String(value || "driver")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, "-")
      .replace(/-+/g, "-")
      .slice(0, 64) || "driver"
  );
}

function berlinDayKey() {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Berlin",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date());

    const year = parts.find((part) => part.type === "year")?.value || "0000";
    const month = parts.find((part) => part.type === "month")?.value || "00";
    const day = parts.find((part) => part.type === "day")?.value || "00";
    return `${year}-${month}-${day}`;
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

function dailyKmKey(driver: DriverIdentity) {
  return `bb_driver_route_km_v1_${berlinDayKey()}_${safeDriverKey(
    driver.id || driver.name,
  )}`;
}

function readDailyKm(driver: DriverIdentity) {
  try {
    const raw = JSON.parse(localStorage.getItem(dailyKmKey(driver)) || "{}");
    const meters = Number(raw?.meters);
    return Number.isFinite(meters) && meters > 0 ? meters / 1000 : 0;
  } catch {
    return 0;
  }
}

export function DriverHeader({
  current,
  stats,
  lastRefreshAt,
  refreshing,
  onRefresh,
  onLogout,
}: {
  current: DriverIdentity;
  stats: DriverStats;
  lastRefreshAt: number | null;
  refreshing: boolean;
  onRefresh: () => void;
  onLogout: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [dailyKm, setDailyKm] = useState(0);

  useEffect(() => {
    const refreshKm = () => setDailyKm(readDailyKm(current));
    refreshKm();

    window.addEventListener("bb:driver-km-updated", refreshKm);
    return () => {
      window.removeEventListener("bb:driver-km-updated", refreshKm);
    };
  }, [current.id, current.name]);

  return (
    <div className={`rounded-2xl ${glass}`}>
      <button
        type="button"
        className="flex w-full items-center justify-between gap-3 px-3 py-3 text-left sm:px-4"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        <div className="min-w-0">
          <div className="truncate text-base font-extrabold sm:text-lg">
            Willkommen, {current.name}
          </div>
          <div className="mt-0.5 text-[11px] text-stone-400">
            {open ? "Fahrerübersicht schließen" : "Fahrerübersicht öffnen"}
          </div>
        </div>

        <span
          className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-white/15 bg-white/[0.05] text-lg font-black text-stone-200 transition-transform ${
            open ? "rotate-180" : ""
          }`}
          aria-hidden="true"
        >
          ⌄
        </span>
      </button>

      {open ? (
        <div className="border-t border-white/10 px-3 pb-3 pt-3 sm:px-4 sm:pb-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-xs text-stone-300/90 sm:text-sm">
                Nur Lieferaufträge von heute werden angezeigt.
              </div>

              <div className="mt-1 text-[11px] text-stone-500">
                {lastRefreshAt ? (
                  <>
                    Aktualisiert:{" "}
                    {new Date(lastRefreshAt).toLocaleTimeString("de-DE")}
                  </>
                ) : (
                  <>Wird geladen…</>
                )}
              </div>
            </div>

            <div className="flex shrink-0 gap-2">
              <button
                className="rounded-xl border border-amber-300/25 bg-amber-400/10 px-3 py-1.5 text-xs font-bold text-amber-100 transition hover:bg-amber-400/20 disabled:opacity-50"
                type="button"
                disabled={refreshing}
                onClick={onRefresh}
              >
                {refreshing ? "Lädt…" : "Aktualisieren"}
              </button>

              <button
                className="rounded-xl border border-white/15 bg-white/[0.04] px-3 py-1.5 text-xs font-bold text-stone-200 transition hover:bg-white/10"
                type="button"
                onClick={onLogout}
              >
                Abmelden
              </button>
            </div>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2">
            <DriverStatCard
              icon="📅"
              label="Heute"
              value={stats.count}
              tone="blue"
            />
            <DriverStatCard
              icon="🛣️"
              label="KM heute"
              value={`${dailyKm.toFixed(1).replace(".", ",")} km`}
              tone="blue"
            />
            <DriverStatCard
              icon="🪙"
              label="Umsatz"
              value={`${stats.total.toFixed(2)}€`}
              tone="gold"
            />
            <DriverStatCard
              icon="🤲"
              label="Trinkgeld"
              value={`${stats.tip.toFixed(2)}€`}
              tone="green"
            />
          </div>

          <div className="mt-2 text-[10px] leading-relaxed text-stone-500">
            KM heute = Google-Routen-km der heute gestarteten Touren. Das ist
            keine Fahrzeug-Tacho-Messung.
          </div>
        </div>
      ) : null}
    </div>
  );
}
