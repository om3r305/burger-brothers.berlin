"use client";

import clsx from "clsx";
import type { MouseEvent } from "react";
import type { StoredOrder } from "@/types/tv";
import {
  buildDiscountDetails,
  extractOrderNote,
  findTipAmountDeep,
  formatDeliveryLine,
  getDriverName,
  getOrderTotals,
  glass,
  money,
  num,
} from "@/lib/tv/domain";

export function OrderDetailsModal({
  order,
  startMs,
  doneLocked,
  doneLockTitle,
  printing,
  cancelling,
  onClose,
  onPrint,
  onCancel,
}: {
  order: StoredOrder;
  startMs: number;
  doneLocked: boolean;
  doneLockTitle?: string;
  printing: boolean;
  cancelling: boolean;
  onClose: () => void;
  onPrint: () => void | Promise<void>;
  onCancel: () => void | Promise<void>;
}) {
  const totals = getOrderTotals(order);
  const discountDetails = buildDiscountDetails(order, totals);
  const pickupTip =
    order.mode === "pickup" ? findTipAmountDeep(order) : 0;
  const orderNote = extractOrderNote(order);
  const addressLine =
    order.mode === "delivery" ? formatDeliveryLine(order) : "";
  const driverName = getDriverName(order);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onMouseDown={(event: MouseEvent<HTMLDivElement>) => {
        if (event.currentTarget === event.target && !cancelling) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="tv-order-details-title"
    >
      <div
        className={`max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl p-5 ${glass}`}
      >
        <div className="mb-3 flex items-center justify-between">
          <div id="tv-order-details-title" className="text-xl font-semibold">
            #{order.id} •{" "}
            {order.mode === "pickup" ? "Abholung" : "Lieferung"}
          </div>

          <button
            className="btn-ghost"
            disabled={cancelling}
            onClick={onClose}
          >
            Schließen
          </button>
        </div>

        <div className="space-y-1 text-sm text-stone-300/90">
          <div>
            <b>Zeit:</b>{" "}
            {new Date(startMs || order.ts).toLocaleString("de-DE")}
          </div>

          {order.planned ? (
            <div>
              <b>Geplant:</b> {order.planned} heute
            </div>
          ) : null}

          <div>
            <b>Kunde:</b> {order.customer?.name || "-"} •{" "}
            {order.customer?.phone || "-"}
          </div>

          {addressLine ? (
            <div>
              <b>Adresse:</b> {addressLine}
            </div>
          ) : null}

          {driverName ? (
            <div>
              <b>Fahrer:</b> {driverName}
            </div>
          ) : null}
        </div>

        <div className="mt-4">
          <div className="mb-1 font-medium">Artikel</div>

          <div className="overflow-hidden rounded-lg border border-white/10">
            <table className="w-full text-sm">
              <thead className="bg-white/5 text-stone-300">
                <tr>
                  <th className="p-2 text-left">Name</th>
                  <th className="p-2 text-right">Menge</th>
                  <th className="p-2 text-right">Summe</th>
                </tr>
              </thead>

              <tbody>
                {order.items.map((item, index) => {
                  const extras = Array.isArray(item.add)
                    ? item.add.reduce(
                        (total, extra) => total + num(extra.price),
                        0,
                      )
                    : 0;

                  return (
                    <tr
                      key={`${item.id || item.name}-${index}`}
                      className="border-t border-white/5 align-top"
                    >
                      <td className="p-2">
                        <div>{item.name}</div>

                        {item.note ? (
                          <div className="mt-0.5 text-xs text-stone-300">
                            {item.note}
                          </div>
                        ) : null}

                        {item.add?.length ? (
                          <div className="text-xs text-stone-400">
                            Extras:{" "}
                            {item.add
                              .map((extra) => extra.label || extra.name)
                              .filter(Boolean)
                              .join(", ")}
                          </div>
                        ) : null}

                        {item.rm?.length ? (
                          <div className="text-xs text-stone-400">
                            Ohne: {item.rm.join(", ")}
                          </div>
                        ) : null}
                      </td>

                      <td className="p-2 text-right">{item.qty}</td>
                      <td className="p-2 text-right">
                        {(
                          (num(item.price) + extras) *
                          num(item.qty || 1)
                        ).toFixed(2)}
                        €
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {orderNote ? (
          <div className="mt-4 rounded-xl border border-white/10 p-3 text-sm">
            <div className="mb-1 font-medium">Bestellhinweis</div>
            <div className="whitespace-pre-wrap text-stone-200">
              {orderNote}
            </div>
          </div>
        ) : null}

        <div className="mt-4 overflow-hidden rounded-xl border border-white/10">
          <table className="w-full text-sm">
            <tbody>
              <tr className="border-b border-white/10">
                <td className="p-2">Warenwert</td>
                <td className="p-2 text-right">
                  {money(totals.subtotal)}
                </td>
              </tr>

              {totals.deliveryFee ? (
                <tr className="border-b border-white/10">
                  <td className="p-2">Lieferaufschläge</td>
                  <td className="p-2 text-right">
                    {money(totals.deliveryFee)}
                  </td>
                </tr>
              ) : null}

              {totals.serviceFee ? (
                <tr className="border-b border-white/10">
                  <td className="p-2">Service</td>
                  <td className="p-2 text-right">
                    {money(totals.serviceFee)}
                  </td>
                </tr>
              ) : null}

              {totals.otherFee ? (
                <tr className="border-b border-white/10">
                  <td className="p-2">Sonstiges</td>
                  <td className="p-2 text-right">
                    {money(totals.otherFee)}
                  </td>
                </tr>
              ) : null}

              {discountDetails.length || totals.discountSum ? (
                <>
                  <tr className="border-b border-white/10">
                    <td className="p-2">Rabatte</td>
                    <td className="p-2 text-right">
                      -{money(totals.discountSum)}
                    </td>
                  </tr>

                  {discountDetails.map((discount, index) => (
                    <tr
                      key={`${discount.label}-${index}`}
                      className="border-b border-white/10 text-emerald-200/95"
                    >
                      <td className="p-2 pl-6">
                        <div className="font-medium">
                          - {discount.label}
                        </div>
                        <div className="mt-0.5 text-xs text-stone-400">
                          Grund der Ermäßigung
                        </div>
                      </td>
                      <td className="p-2 text-right">
                        -{money(discount.amount)}
                      </td>
                    </tr>
                  ))}
                </>
              ) : null}

              {pickupTip > 0 ? (
                <tr className="border-b border-white/10">
                  <td className="p-2">Trinkgeld</td>
                  <td className="p-2 text-right">
                    {money(pickupTip)}
                  </td>
                </tr>
              ) : null}

              <tr>
                <td className="p-2 font-semibold">Gesamt</td>
                <td className="p-2 text-right font-semibold">
                  {money(totals.total)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button
            className="card-cta"
            disabled={printing}
            onClick={onPrint}
            title="Über Print-Proxy drucken"
          >
            {printing ? "Druck läuft …" : "🖨️ Drucken"}
          </button>

          <a
            className="btn-ghost"
            href={`/print/barcode/${encodeURIComponent(order.id)}?print=1`}
            target="_blank"
            rel="noreferrer"
            title="PDF/Print-Seite öffnen"
          >
            PDF öffnen
          </a>

          <button
            className={clsx(
              "ml-auto rounded-md border border-rose-400/60 bg-rose-500/20 px-3 py-1.5 text-rose-100 hover:bg-rose-500/30",
              (doneLocked || cancelling) &&
                "cursor-not-allowed opacity-40 hover:bg-rose-500/20",
            )}
            disabled={doneLocked || cancelling}
            title={doneLockTitle}
            onClick={onCancel}
          >
            {cancelling ? "Stornierung läuft …" : "🛑 Stornieren"}
          </button>
        </div>
      </div>
    </div>
  );
}
