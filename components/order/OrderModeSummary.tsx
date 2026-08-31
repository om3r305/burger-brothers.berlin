"use client";

import { useCart, type OrderMode } from "@/components/store";
import { etaLabelForMode, useSmartEta } from "@/lib/client/smart-eta";
import { getPricingOverrides } from "@/lib/settings";

function fmtMoney(value: number) {
  return new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: "EUR",
  }).format(value);
}

export function OrderModeSummary({
  mode,
  onChange,
  eyebrow,
  compact = false,
}: {
  mode: OrderMode;
  onChange: () => void;
  eyebrow?: string;
  compact?: boolean;
}) {
  const eta = useSmartEta();
  const delivery = mode === "delivery";
  const plz = useCart((state) => state.plz);

  let deliveryMinimum: number | null = null;
  if (delivery) {
    const code = String(plz || "").replace(/\D/g, "").slice(0, 5);
    if (code.length === 5) {
      try {
        const minimum = getPricingOverrides("delivery").plzMin?.[code];
        if (typeof minimum === "number" && Number.isFinite(minimum)) {
          deliveryMinimum = minimum;
        }
      } catch {
        deliveryMinimum = null;
      }
    }
  }

  return (
    <div className={`rounded-2xl border border-amber-400/30 bg-gradient-to-br from-amber-400/10 to-black/30 ${compact ? "p-3" : "p-4"}`}>
      {eyebrow ? (
        <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.2em] text-amber-300/80">
          {eyebrow}
        </div>
      ) : null}
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="font-semibold text-white">
            <span aria-hidden="true">{delivery ? "🛵" : "🥡"}</span>{" "}
            {delivery ? "Lieferung" : "Abholung"}
          </div>
          <div className="mt-0.5 text-sm text-amber-200">
            {etaLabelForMode(eta, mode)}
          </div>
          {deliveryMinimum !== null ? (
            <div className="mt-1 text-xs font-semibold text-amber-100/90">
              Mindestbestellwert: {fmtMoney(deliveryMinimum)}
            </div>
          ) : null}
        </div>
        <button
          type="button"
          onClick={onChange}
          className="shrink-0 rounded-full border border-amber-400/40 px-3 py-1.5 text-xs font-semibold text-amber-200 transition-colors hover:bg-amber-400/10"
        >
          Ändern
        </button>
      </div>
    </div>
  );
}

export function OrderModeChoice({
  onChoose,
  title = "Wie möchten Sie bestellen?",
  disabledModes = [],
}: {
  onChoose: (mode: OrderMode) => void;
  title?: string;
  disabledModes?: OrderMode[];
}) {
  const eta = useSmartEta();

  return (
    <div>
      <div className="mb-4 text-center">
        <div className="text-xs font-bold uppercase tracking-[0.2em] text-amber-300">Burger Brothers</div>
        <h2 className="mt-2 text-xl font-semibold text-white">{title}</h2>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {(["delivery", "pickup"] as const).map((mode) => (
          <button
            key={mode}
            type="button"
            onClick={() => onChoose(mode)}
            disabled={disabledModes.includes(mode)}
            className="rounded-2xl border border-amber-400/30 bg-black/40 p-4 text-left transition hover:border-amber-300 hover:bg-amber-400/10 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <div className="text-lg font-semibold text-white">
              <span aria-hidden="true">{mode === "delivery" ? "🛵" : "🥡"}</span>{" "}
              {mode === "delivery" ? "Lieferung" : "Abholung"}
            </div>
            <div className="mt-1 text-sm text-amber-200">{etaLabelForMode(eta, mode)}</div>
            {disabledModes.includes(mode) ? (
              <div className="mt-1 text-xs text-stone-400">Aktuell pausiert</div>
            ) : null}
          </button>
        ))}
      </div>
    </div>
  );
}
