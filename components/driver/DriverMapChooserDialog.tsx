"use client";

import type {
  DriverMapOption,
  DriverMapProvider,
  DriverMapRequest,
} from "@/types/driver";

export function DriverMapChooserDialog({
  open,
  options,
  request,
  currentPreference,
  onSelect,
  onCancel,
}: {
  open: boolean;
  options: DriverMapOption[];
  request: DriverMapRequest | null;
  currentPreference: DriverMapProvider | null;
  onSelect: (provider: DriverMapProvider) => void;
  onCancel: () => void;
}) {
  if (!open) return null;

  const isSettings = request?.source === "settings";
  const stopCount = request?.addresses.length || 0;

  return (
    <div className="fixed inset-0 z-[90] flex items-end justify-center bg-black/75 p-3 backdrop-blur-sm sm:items-center">
      <div className="w-full max-w-lg rounded-[1.75rem] border border-white/15 bg-stone-950 p-5 text-stone-100 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-xs font-extrabold uppercase tracking-[0.18em] text-sky-200">
              Karten-App
            </div>
            <h2 className="mt-1 text-xl font-black">
              {isSettings
                ? "Karten-App auswählen"
                : "Womit möchten Sie die Route öffnen?"}
            </h2>
          </div>

          <button
            type="button"
            onClick={onCancel}
            className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-white/15 bg-white/[0.05] text-xl text-stone-300"
            aria-label="Schließen"
          >
            ×
          </button>
        </div>

        <p className="mt-3 text-sm leading-relaxed text-stone-300">
          Die Route wird nur als Vorschau geöffnet. Die Navigation startet
          erst, wenn der Fahrer in der Karten-App selbst auf
          <b className="text-stone-100"> Start</b> tippt.
        </p>

        {!isSettings && stopCount > 0 ? (
          <div className="mt-3 rounded-xl border border-sky-300/20 bg-sky-400/10 px-3 py-2 text-xs text-sky-100">
            {stopCount === 1
              ? "Ein Lieferziel"
              : `${stopCount} Lieferziele in einer Route`}
          </div>
        ) : null}

        <div className="mt-4 space-y-3">
          {options.map((option) => {
            const selected = currentPreference === option.id;

            return (
              <button
                key={option.id}
                type="button"
                onClick={() => onSelect(option.id)}
                className={`flex w-full items-center gap-3 rounded-2xl border p-4 text-left transition active:scale-[0.99] ${
                  selected
                    ? "border-emerald-300/50 bg-emerald-400/15"
                    : "border-white/12 bg-white/[0.04] hover:bg-white/[0.08]"
                }`}
              >
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl border border-white/10 bg-white/[0.06] text-lg font-black">
                  {option.icon}
                </span>

                <span className="min-w-0 flex-1">
                  <span className="block font-extrabold text-stone-100">
                    {option.label}
                  </span>
                  <span className="mt-1 block text-xs leading-relaxed text-stone-400">
                    {option.description}
                  </span>
                </span>

                {selected ? (
                  <span className="shrink-0 text-emerald-300">✓</span>
                ) : null}
              </button>
            );
          })}
        </div>

        <div className="mt-4 rounded-xl border border-amber-300/20 bg-amber-400/10 px-3 py-2 text-xs leading-relaxed text-amber-100">
          Das Telefon kann beim ersten Öffnen zusätzlich um Erlaubnis bitten,
          eine externe Karten-App zu starten. Diese Sicherheitsabfrage wird
          vom Browser oder Betriebssystem gesteuert.
        </div>
      </div>
    </div>
  );
}
