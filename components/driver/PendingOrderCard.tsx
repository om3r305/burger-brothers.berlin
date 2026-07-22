"use client";

import { DrinkOrderNotice } from "@/components/driver/DrinkOrderNotice";
import { DriverPaymentBadge } from "@/components/driver/DriverPaymentBadge";
import { TimeBadge } from "@/components/driver/TimeBadge";
import { glass, prettyDeliveryLine } from "@/lib/driver/domain";
import type { DriverOrder } from "@/types/driver";

export function PendingOrderCard({
  order,
  selected,
  busy,
  avgPickup,
  avgDelivery,
  timezone,
  nowMs,
  onToggleSelected,
  onClaim,
}: {
  order: DriverOrder;
  selected: boolean;
  busy: boolean;
  avgPickup: number;
  avgDelivery: number;
  timezone: string;
  nowMs: number;
  onToggleSelected: (id: string | number) => void;
  onClaim: (order: DriverOrder) => void;
}) {
  return (
    <div className={`rounded-2xl p-3 sm:p-4 ${glass}`}>
      <div className="flex flex-col gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-start gap-2">
            <div className="break-all text-[15px] font-extrabold sm:text-base">
              #{order.id}
            </div>
            <span className="rounded-full border border-orange-400/50 bg-orange-500/15 px-2 py-0.5 text-xs text-orange-100">
              Lieferung
            </span>
            <div className="ml-auto shrink-0">
              <DriverPaymentBadge order={order} />
            </div>
          </div>

          <div className="mt-1.5 text-sm">
            {order.customer.name || "-"} · {order.customer.phone || "-"}
          </div>

          <div className="mt-0.5 text-sm font-semibold text-stone-200">
            {prettyDeliveryLine(order)}
          </div>

          <DrinkOrderNotice order={order} />

          <TimeBadge
            order={order}
            avgPickup={avgPickup}
            avgDelivery={avgDelivery}
            timezone={timezone}
            nowMs={nowMs}
          />
        </div>

        <div className="grid grid-cols-[auto_1fr] items-center gap-2">
          <label className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-semibold text-stone-200">
            <input
              type="checkbox"
              checked={selected}
              onChange={() => onToggleSelected(order.id)}
            />
            Auswahl
          </label>

          <button
            className="rounded-xl border border-amber-300/45 bg-gradient-to-b from-amber-300 to-orange-500 px-4 py-2 text-sm font-extrabold text-black shadow-[0_0_18px_rgba(251,146,60,.18)] transition hover:from-amber-200 hover:to-orange-400 disabled:opacity-50"
            type="button"
            disabled={busy}
            onClick={() => onClaim(order)}
            title="Übernehmen"
          >
            {busy ? "Wird übernommen…" : "＋ Übernehmen"}
          </button>
        </div>
      </div>
    </div>
  );
}
