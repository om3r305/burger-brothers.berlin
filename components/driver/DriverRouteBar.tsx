"use client";

import { glass } from "@/lib/driver/domain";

export function DriverRouteBar({
  selectedCount,
  onClear,
  onOpen,
}: {
  selectedCount: number;
  onClear: () => void;
  onOpen: () => void;
}) {
  return (
    <div className={`rounded-2xl p-3 ${glass}`}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-sm text-stone-200">
          <div className="font-extrabold">🗺️ Route planen</div>
          <div className="mt-0.5 text-xs text-stone-400">
            {selectedCount
              ? `${selectedCount} Lieferung(en) ausgewählt`
              : "Lieferungen markieren und gemeinsame Google-Route starten."}
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {selectedCount > 0 ? (
            <button
              type="button"
              onClick={onClear}
              className="rounded-xl border border-white/15 bg-white/[0.04] px-3 py-2 text-xs font-bold text-stone-200 transition hover:bg-white/10"
            >
              Auswahl löschen
            </button>
          ) : null}

          <button
            type="button"
            disabled={selectedCount === 0}
            onClick={onOpen}
            className="rounded-xl border border-sky-300/45 bg-sky-400/15 px-3 py-2 text-xs font-extrabold text-sky-100 transition hover:bg-sky-400/25 disabled:cursor-not-allowed disabled:opacity-50"
          >
            🗺️ Ausgewählte Route starten
          </button>
        </div>
      </div>
    </div>
  );
}
