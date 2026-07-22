"use client";

import { DriverStatCard } from "@/components/driver/DriverStatCard";
import { glass } from "@/lib/driver/domain";
import type { DriverIdentity, DriverStats } from "@/types/driver";

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
  return (
    <div className={`rounded-2xl p-3 sm:p-4 ${glass}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-base font-extrabold sm:text-lg">
            Willkommen, {current.name}
          </div>

          <div className="mt-0.5 text-xs text-stone-300/90 sm:text-sm">
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

      <div className="mt-3 grid grid-cols-3 gap-2">
        <DriverStatCard
          icon="📅"
          label="Heute"
          value={stats.count}
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
    </div>
  );
}
