"use client";

import {
  getOrderCreatedMs,
  pad2,
  plannedStartMs,
  remainingMinutes,
} from "@/lib/driver/domain";
import type { DriverOrder } from "@/types/driver";

function remainingClass(left: number) {
  if (left <= 5) {
    return "border-rose-400/50 bg-rose-500/15 text-rose-100";
  }

  if (left <= 15) {
    return "border-amber-400/50 bg-amber-500/15 text-amber-100";
  }

  return "border-sky-400/40 bg-sky-500/15 text-sky-100";
}

export function TimeBadge({
  order,
  avgPickup,
  avgDelivery,
  timezone,
  nowMs,
}: {
  order: DriverOrder;
  avgPickup: number;
  avgDelivery: number;
  timezone: string;
  nowMs: number;
}) {
  const left = remainingMinutes(
    order,
    avgPickup,
    avgDelivery,
    timezone,
    nowMs,
  );
  const plannedMs = plannedStartMs(order, timezone);
  const plannedFuture = Boolean(plannedMs && plannedMs > nowMs);
  const createdMs = getOrderCreatedMs(order) ?? order.ts;
  const created = createdMs
    ? new Date(createdMs).toLocaleTimeString("de-DE", {
        hour: "2-digit",
        minute: "2-digit",
      })
    : "-";

  return (
    <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] text-stone-300/90">
      {plannedFuture ? (
        <span className="rounded-full border border-amber-400/40 bg-amber-500/15 px-2 py-0.5">
          Geplant: <b>{String(order.planned)}</b>
        </span>
      ) : (
        <span
          className={`rounded-full border px-2 py-0.5 ${remainingClass(left)}`}
        >
          Rest: <b>{pad2(left)}′</b>
        </span>
      )}

      <span className="rounded-full border border-stone-500/40 bg-stone-500/10 px-2 py-0.5">
        Erstellt: {created}
      </span>
    </div>
  );
}
