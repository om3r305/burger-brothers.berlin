"use client";

import clsx from "clsx";
import type { StoredOrder } from "@/types/tv";
import {
  acceptanceSubtitle,
  acceptanceTitle,
  acceptanceZip,
  addMinutesToHHMM,
  chip,
  clampAcceptEta,
  extractOrderNote,
  getOrderTotals,
  getPaymentBadge,
  glass,
  isPlannedOrder,
  money,
  normalizePlannedHHMM,
  num,
  plannedAcceptLabel,
} from "@/lib/tv/domain";

export function AcceptOrderOverlay({
  order,
  etaValue,
  plannedValue,
  busy,
  onEtaChange,
  onPlannedChange,
  onAccept,
}: {
  order: StoredOrder;
  etaValue: number;
  plannedValue?: string;
  busy: boolean;
  onEtaChange: (value: number) => void;
  onPlannedChange?: (value: string) => void;
  onAccept: () => void | Promise<void>;
}) {
  const paymentBadge = getPaymentBadge(order);
  const zip = acceptanceZip(order);
  const title = acceptanceTitle(order);
  const subtitle = acceptanceSubtitle(order);
  const totals = getOrderTotals(order);
  const itemCount = order.items.reduce((sum, item) => sum + Math.max(1, num(item.qty || 1)), 0);
  const plannedMode = isPlannedOrder(order);
  const visiblePlannedValue = normalizePlannedHHMM(plannedValue || order.planned) || "00:00";

  const changeEta = (delta: number) => {
    if (plannedMode) {
      // Geplante Bestellungen dürfen im TV nur nach hinten verschoben werden.
      // So kann niemand versehentlich eine frühere Kundenzeit bestätigen.
      if (delta <= 0) return;

      onPlannedChange?.(addMinutesToHHMM(visiblePlannedValue, delta));
      return;
    }

    onEtaChange(clampAcceptEta(etaValue + delta));
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/80 p-3 backdrop-blur-md sm:p-6">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(900px_500px_at_50%_0%,rgba(251,146,60,.20),transparent),radial-gradient(800px_500px_at_80%_80%,rgba(16,185,129,.15),transparent)]" />

      <div className={`relative w-full max-w-5xl overflow-hidden rounded-[2rem] border-orange-300/35 p-5 shadow-2xl sm:p-7 ${glass}`}>
        <div className="absolute right-5 top-5 flex items-center gap-2">
          <span className="h-3.5 w-3.5 animate-pulse rounded-full bg-rose-400 shadow-[0_0_18px_rgba(251,113,133,.85)]" />
          <span className="text-xs font-bold uppercase tracking-[0.24em] text-rose-100">Neu</span>
        </div>

        <div className="pr-24">
          <div className="text-sm font-semibold uppercase tracking-[0.22em] text-orange-200/90">
            Neue Bestellung
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-3">
            <h1 className="text-4xl font-black tracking-tight text-white sm:text-6xl">
              {title}
            </h1>

            <span className={`${chip} ${paymentBadge.className}`}>
              <span className="mr-1" aria-hidden="true">{paymentBadge.icon}</span>
              {paymentBadge.label}
            </span>
          </div>
        </div>

        <div className="mt-6 grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="rounded-3xl border border-white/10 bg-black/25 p-5">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-400">
              Adresse / Kunde
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-3">
              {zip ? (
                <div className="rounded-2xl border border-orange-300/35 bg-orange-500/15 px-4 py-3 text-3xl font-black text-orange-100">
                  {zip}
                </div>
              ) : null}

              <div className="min-w-0 flex-1 text-2xl font-bold leading-tight text-white sm:text-3xl">
                {subtitle}
              </div>
            </div>

            {extractOrderNote(order) ? (
              <div className="mt-4 rounded-2xl border border-amber-300/25 bg-amber-400/10 p-3 text-amber-100">
                <div className="text-xs font-bold uppercase tracking-wider text-amber-200/80">
                  Hinweis
                </div>
                <div className="mt-1 whitespace-pre-wrap text-base font-semibold">
                  {extractOrderNote(order)}
                </div>
              </div>
            ) : null}

            <div className="mt-4 max-h-52 overflow-y-auto rounded-2xl border border-white/10 bg-white/[0.04] p-3">
              <div className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-stone-400">
                Artikel
              </div>
              <div className="space-y-2">
                {order.items.map((item, index) => (
                  <div key={`${item.name}-${index}`} className="flex gap-3 rounded-xl bg-black/20 px-3 py-2">
                    <div className="min-w-8 text-xl font-black text-orange-100">{item.qty}×</div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-base font-bold text-white">{item.name}</div>
                      {item.note ? <div className="text-xs text-amber-100">{item.note}</div> : null}
                      {Array.isArray(item.add) && item.add.length > 0 ? (
                        <div className="text-xs text-stone-300">
                          Extras: {item.add.map((extra) => extra?.label || extra?.name).filter(Boolean).join(", ")}
                        </div>
                      ) : null}
                      {Array.isArray(item.rm) && item.rm.length > 0 ? (
                        <div className="text-xs text-stone-400">Ohne: {item.rm.join(", ")}</div>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-4 grid grid-cols-3 gap-3 text-center text-sm">
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3">
                <div className="text-stone-400">Bestellung</div>
                <div className="mt-1 font-bold">#{order.id}</div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3">
                <div className="text-stone-400">Artikel</div>
                <div className="mt-1 font-bold">{itemCount}</div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3">
                <div className="text-stone-400">Gesamt</div>
                <div className="mt-1 font-bold">{money(totals.total)}</div>
              </div>
            </div>
          </div>

          <div className="rounded-3xl border border-emerald-300/20 bg-emerald-500/10 p-5">
            <div className="text-center text-xs font-semibold uppercase tracking-[0.2em] text-emerald-100/80">
              {plannedMode ? plannedAcceptLabel(order) : "Zeit bestätigen"}
            </div>

            <div className="mt-4 flex items-center justify-center gap-4">
              <button
                type="button"
                disabled={busy || plannedMode}
                onClick={() => changeEta(plannedMode ? -15 : -5)}
                className="h-20 w-20 rounded-3xl border border-white/15 bg-white/10 text-5xl font-black hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-25"
                aria-label="Zeit reduzieren"
                title={plannedMode ? "Geplante Zeiten können nur nach hinten verschoben werden." : "Zeit reduzieren"}
              >
                −
              </button>

              <div className="min-w-[210px] rounded-[2rem] border border-emerald-300/30 bg-black/35 px-6 py-5 text-center shadow-inner">
                <div className={`${plannedMode ? "text-6xl" : "text-7xl"} font-black leading-none text-white tabular-nums`}>
                  {plannedMode ? visiblePlannedValue : etaValue}
                </div>
                <div className="mt-1 text-lg font-bold uppercase tracking-wider text-emerald-100">
                  {plannedMode ? "Uhr" : "Min"}
                </div>
              </div>

              <button
                type="button"
                disabled={busy}
                onClick={() => changeEta(plannedMode ? 15 : 5)}
                className="h-20 w-20 rounded-3xl border border-white/15 bg-white/10 text-5xl font-black hover:bg-white/15 disabled:opacity-40"
                aria-label="Zeit erhöhen"
              >
                +
              </button>
            </div>

            <div className="mt-5 grid grid-cols-4 gap-2">
              {plannedMode
                ? [
                    { label: "+15′", delta: 15 },
                    { label: "+30′", delta: 30 },
                    { label: "+45′", delta: 45 },
                    { label: "+60′", delta: 60 },
                  ].map((item) => (
                    <button
                      key={item.label}
                      type="button"
                      disabled={busy}
                      onClick={() => changeEta(item.delta)}
                      className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm font-bold text-stone-200 transition hover:bg-white/10 disabled:opacity-40"
                    >
                      {item.label}
                    </button>
                  ))
                : [25, 35, 45, 60].map((minute) => (
                    <button
                      key={minute}
                      type="button"
                      disabled={busy}
                      onClick={() => onEtaChange(minute)}
                      className={clsx(
                        "rounded-2xl border px-3 py-2 text-sm font-bold transition disabled:opacity-40",
                        etaValue === minute
                          ? "border-emerald-300/60 bg-emerald-400/20 text-emerald-50"
                          : "border-white/10 bg-white/5 text-stone-200 hover:bg-white/10",
                      )}
                    >
                      {minute}′
                    </button>
                  ))}
            </div>

            <button
              type="button"
              disabled={busy}
              onClick={onAccept}
              className="mt-5 w-full rounded-3xl border border-emerald-300/50 bg-emerald-500 px-5 py-5 text-2xl font-black text-white shadow-[0_18px_45px_rgba(16,185,129,.25)] transition hover:bg-emerald-400 disabled:cursor-wait disabled:opacity-60"
            >
              {busy ? "Wird angenommen …" : "Annehmen & Drucken"}
            </button>

          </div>
        </div>

        <div className="mt-4 text-center text-sm text-stone-300/85">
          Der Ton wiederholt sich alle 4 Sekunden, bis die Bestellung angenommen wird.
        </div>
      </div>
    </div>
  );
}

/* ─────────────── Printing ─────────────── */
