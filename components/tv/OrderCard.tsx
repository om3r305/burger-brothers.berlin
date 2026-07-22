"use client";

import clsx from "clsx";
import type { OrderStatus, StoredOrder } from "@/types/tv";
import {
  chip,
  chipColor,
  doneLockTitle,
  etaFor,
  formatDeliveryLine,
  formatMinuteValue,
  getDriverName,
  getPaymentBadge,
  iconBtn,
  isDoneLocked,
  pad2,
  plannedStartMs,
  remainingMinutes,
  statusLabel,
} from "@/lib/tv/domain";

const LED_COLORS = {
  green: "#22c55e",
  red: "#ef4444",
  gray: "#94a3b8",
} as const;

function minuteClass(leftMin: number, plannedFuture: boolean, isFinal: boolean) {
  return clsx("tv-minutes", {
    "tv-minutes--crit": !plannedFuture && !isFinal && leftMin <= 10,
    "tv-minutes--warn":
      !plannedFuture && !isFinal && leftMin > 10 && leftMin <= 20,
  });
}

function modeChipClass(mode: StoredOrder["mode"]) {
  return mode === "pickup"
    ? "border-cyan-400/60 bg-cyan-500/15 text-cyan-200"
    : "border-orange-400/60 bg-orange-500/15 text-orange-200";
}

export type OrderCardDisplay = {
  avgPickup: number;
  avgDelivery: number;
  timezone: string;
  led: keyof typeof LED_COLORS;
  clusterDot?: string | null;
  etaOverride?: number | null;
  outSince?: number | null;
  leftMin?: number | null;
  etaBusy?: boolean;
  statusBusy?: boolean;
};

export type OrderCardActions = {
  open: () => void;
  changeStatus: (status: OrderStatus) => void | Promise<void>;
  adjustEta: (deltaMin: number) => void | Promise<void>;
  refresh: () => void;
};

export function OrderCard({
  order,
  display,
  actions,
}: {
  order: StoredOrder;
  display: OrderCardDisplay;
  actions: OrderCardActions;
}) {
  const {
    avgPickup,
    avgDelivery,
    timezone,
    led,
    clusterDot,
    etaOverride,
    outSince,
    leftMin: displayLeftMin,
    etaBusy = false,
    statusBusy = false,
  } = display;

  const effectiveEta = etaOverride ?? etaFor(order, avgPickup, avgDelivery);
  const rawLeftMin = remainingMinutes(order, effectiveEta, timezone);
  const leftMin = displayLeftMin ?? rawLeftMin;
  const plannedMs = plannedStartMs(order, timezone);
  const plannedFuture = Boolean(plannedMs && plannedMs > Date.now());
  const driverName = getDriverName(order);
  const isFinal = order.status === "done" || order.status === "cancelled";
  const doneLocked = isDoneLocked(order);
  const lockedTitle = statusBusy
    ? "Status wird gespeichert …"
    : doneLockTitle(order);
  const actionDisabled = doneLocked || statusBusy;
  const paymentBadge = getPaymentBadge(order);
  const addressLine = order.mode === "delivery" ? formatDeliveryLine(order) : "";
  const startTime = outSince ?? order.ts;

  return (
    <div className="relative rounded-2xl border border-white/15 bg-white/[0.06] p-4 shadow-[inset_0_1px_0_0_rgba(255,255,255,.20)] ring-1 ring-black/10 backdrop-blur-xl">
      <span
        className="absolute right-2 top-2 h-5 w-5 rounded-full ring-2 ring-stone-900"
        style={{ backgroundColor: LED_COLORS[led] }}
        title={led.toUpperCase()}
      />

      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className={`${chip} ${modeChipClass(order.mode)}`}>
            {order.mode === "pickup" ? "Abholung" : "Lieferung"}
          </span>

          {plannedFuture && (
            <span
              className={`${chip} border-amber-400/60 bg-amber-500/15 text-amber-100`}
            >
              Geplant {order.planned}
            </span>
          )}
        </div>

        {order.status === "out_for_delivery" && startTime ? (
          <div className="ml-auto mt-1 text-[11px] font-medium text-stone-400">
            {(() => {
              const since = Math.floor((Date.now() - startTime) / 60_000);
              if (since < 1) return "Gerade eben";
              if (since < 60) return `vor ${since} Min`;
              const hours = Math.floor(since / 60);
              const minutes = since % 60;
              return minutes > 0
                ? `vor ${hours} Std ${minutes} Min`
                : `vor ${hours} Std`;
            })()}
          </div>
        ) : null}

        <div className="flex items-center gap-2">
          {driverName &&
          (order.status === "out_for_delivery" || order.status === "done") ? (
            <span
              className={`${chip} border-indigo-300/60 bg-indigo-400/15 text-indigo-100`}
            >
              Fahrer: {driverName}
            </span>
          ) : null}

          <span className={`${chip} ${chipColor(order.status)}`}>
            {statusLabel[order.status]}
          </span>
        </div>
      </div>

      {!isFinal ? (
        <div className="mt-3 flex items-end justify-between">
          <div
            className={minuteClass(leftMin, plannedFuture, isFinal)}
            aria-live="polite"
          >
            {plannedFuture ? (
              <span>
                {String(order.planned)
                  .split(":")
                  .map((value) => pad2(Number(value) || 0))
                  .join(":")}
              </span>
            ) : (
              <span>{formatMinuteValue(leftMin)}</span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              className={clsx(iconBtn, etaBusy && "cursor-wait opacity-50")}
              disabled={etaBusy}
              onClick={() => actions.adjustEta(-5)}
              title={etaBusy ? "ETA wird gespeichert" : "-5 Min"}
            >
              −5′
            </button>
            <button
              className={clsx(iconBtn, etaBusy && "cursor-wait opacity-50")}
              disabled={etaBusy}
              onClick={() => actions.adjustEta(5)}
              title={etaBusy ? "ETA wird gespeichert" : "+5 Min"}
            >
              +5′
            </button>
          </div>
        </div>
      ) : null}

      {order.mode === "delivery" && addressLine ? (
        <div className="mt-3 flex items-center gap-2 text-lg font-semibold">
          {addressLine}
          {clusterDot ? (
            <span
              className="inline-block h-3.5 w-3.5 rounded-full"
              style={{ backgroundColor: clusterDot }}
              title="Brian group"
            />
          ) : null}
        </div>
      ) : null}

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <span className={`${chip} ${paymentBadge.className}`}>
          <span className="mr-1" aria-hidden="true">
            {paymentBadge.icon}
          </span>
          {paymentBadge.label}
        </span>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {order.mode === "pickup" ? (
          <>
            <button
              className={clsx(
                "btn-ghost",
                actionDisabled &&
                  "cursor-not-allowed opacity-40 hover:bg-transparent",
              )}
              disabled={actionDisabled}
              title={lockedTitle}
              onClick={() => !actionDisabled && actions.changeStatus("preparing")}
            >
              In Vorbereitung
            </button>
            <button
              className={clsx(
                "btn-ghost",
                actionDisabled &&
                  "cursor-not-allowed opacity-40 hover:bg-transparent",
              )}
              disabled={actionDisabled}
              title={lockedTitle}
              onClick={() => !actionDisabled && actions.changeStatus("ready")}
            >
              Abholbereit
            </button>
            <button
              className={clsx(
                "card-cta",
                actionDisabled &&
                  "cursor-not-allowed opacity-40 hover:bg-transparent",
              )}
              disabled={actionDisabled}
              title={lockedTitle}
              onClick={() => !actionDisabled && actions.changeStatus("done")}
            >
              Abgeschlossen
            </button>
          </>
        ) : (
          <>
            <button
              className={clsx(
                "btn-ghost",
                actionDisabled &&
                  "cursor-not-allowed opacity-40 hover:bg-transparent",
              )}
              disabled={actionDisabled}
              title={lockedTitle}
              onClick={() => !actionDisabled && actions.changeStatus("preparing")}
            >
              In Vorbereitung
            </button>
            <button
              className={clsx(
                "btn-ghost",
                actionDisabled &&
                  "cursor-not-allowed opacity-40 hover:bg-transparent",
              )}
              disabled={actionDisabled}
              title={lockedTitle || "Wird nach Fahrer-QR genutzt"}
              onClick={() =>
                !actionDisabled && actions.changeStatus("out_for_delivery")
              }
            >
              Unterwegs
            </button>
            <button
              className={clsx(
                "card-cta",
                actionDisabled &&
                  "cursor-not-allowed opacity-40 hover:bg-transparent",
              )}
              disabled={actionDisabled}
              title={lockedTitle}
              onClick={() => !actionDisabled && actions.changeStatus("done")}
            >
              Abgeschlossen
            </button>
          </>
        )}

        {order.status === "out_for_delivery" && driverName ? (
          <button
            className="btn-ghost"
            onClick={async () => {
              await actions.changeStatus("preparing");
              actions.refresh();
            }}
            title="Fahrer entfernen"
          >
            Fahrer entfernen
          </button>
        ) : null}

        <button className="btn-ghost ml-auto" onClick={actions.open}>
          Details
        </button>
      </div>
    </div>
  );
}
