"use client";

import { orderIsOnlinePaid } from "@/lib/driver/domain";
import type { DriverOrder } from "@/types/driver";

export function DriverPaymentBadge({ order }: { order: DriverOrder }) {
  if (orderIsOnlinePaid(order)) {
    return (
      <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-emerald-300/45 bg-emerald-400/15 px-2.5 py-1 text-[11px] font-extrabold uppercase tracking-wide text-emerald-100 shadow-[0_0_16px_rgba(52,211,153,.12)]">
        <span aria-hidden="true">💶</span>
        Online
      </span>
    );
  }

  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-rose-300/45 bg-rose-500/15 px-2.5 py-1 text-[11px] font-extrabold uppercase tracking-wide text-rose-100 shadow-[0_0_16px_rgba(244,63,94,.12)]">
      <span>Bar</span>
      <span className="rounded-full bg-rose-300/20 px-1.5 py-0.5 text-[9px] leading-none text-rose-100">
        offen
      </span>
    </span>
  );
}
