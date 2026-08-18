"use client";

import { useState } from "react";
import { DrinkOrderNotice } from "@/components/driver/DrinkOrderNotice";
import { DriverPaymentBadge } from "@/components/driver/DriverPaymentBadge";
import { TimeBadge } from "@/components/driver/TimeBadge";
import {
  NOTE_PREVIEW_MAX,
  actionButtonClass,
  formatMoney,
  glass,
  num,
  orderItemsTotal,
  orderNote,
  prettyDeliveryLine,
  shortText,
} from "@/lib/driver/domain";
import type { DriverOrder } from "@/types/driver";
import { DRIVER_MESSAGE_TEMPLATES, type DriverMessageTemplateId } from "@/lib/server/driver-communication";

export function OrderWithDetails({
  order,
  busy,
  avgPickup,
  avgDelivery,
  timezone,
  nowMs,
  onCall,
  onMap,
  onFinish,
  onRelease,
}: {
  order: DriverOrder;
  busy: boolean;
  avgPickup: number;
  avgDelivery: number;
  timezone: string;
  nowMs: number;
  onCall: (order: DriverOrder) => void;
  onMap: (order: DriverOrder) => void;
  onFinish: (order: DriverOrder) => void;
  onRelease: (order: DriverOrder) => void;
}) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [messageOpen, setMessageOpen] = useState(false);
  const [messageBusy, setMessageBusy] = useState(false);
  const [messageFeedback, setMessageFeedback] = useState("");

  async function sendMessage(templateId: DriverMessageTemplateId) {
    setMessageBusy(true);
    setMessageFeedback("");
    try {
      const response = await fetch("/api/driver/notifications", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId: String(order.id), templateId }),
      });
      const payload = await response.json().catch(() => ({}));
      if (response.status === 429 && payload?.error === "cooldown") {
        setMessageFeedback("Bitte kurz warten – diese Nachricht wurde gerade gesendet.");
      } else if (!response.ok) {
        setMessageFeedback("Benachrichtigung konnte nicht gesendet werden.");
      } else if (!payload?.subscriptions) {
        setMessageFeedback("Kunde hat keine aktiven Push-Benachrichtigungen.");
      } else {
        const time = new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit", timeZone: timezone }).format(new Date());
        setMessageFeedback(`✓ Benachrichtigung gesendet · ${time}`);
      }
    } finally {
      setMessageBusy(false);
    }
  }

  const items = order.items;
  const sum = orderItemsTotal(order);
  const noteText = orderNote(order);
  const notePreview = shortText(noteText);
  const noteLong = noteText.trim().length > NOTE_PREVIEW_MAX;

  return (
    <div className={`rounded-2xl p-3 sm:p-4 ${glass}`}>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start gap-2">
            <div className="break-all text-[15px] font-extrabold sm:text-base">
              #{order.id}
            </div>

            <span className="rounded-full border border-orange-400/50 bg-orange-500/15 px-2 py-0.5 text-xs text-orange-100">
              Lieferung
            </span>

            <div className="ml-auto flex shrink-0 items-center gap-2">
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

          {noteText ? (
            <div className="mt-2 rounded-xl border border-amber-300/35 bg-amber-400/10 p-2.5 text-sm text-amber-50">
              <div className="mb-1 text-[11px] font-extrabold uppercase tracking-wide text-amber-200">
                Lieferhinweis
              </div>

              <div className="whitespace-pre-wrap leading-relaxed">
                {noteOpen ? noteText : notePreview}
              </div>

              {noteLong ? (
                <button
                  type="button"
                  className="mt-2 text-xs font-semibold text-amber-200 underline underline-offset-4"
                  onClick={() => setNoteOpen((current) => !current)}
                >
                  {noteOpen ? "Weniger anzeigen" : "Mehr anzeigen"}
                </button>
              ) : null}
            </div>
          ) : null}

          <TimeBadge
            order={order}
            avgPickup={avgPickup}
            avgDelivery={avgDelivery}
            timezone={timezone}
            nowMs={nowMs}
          />

          <button
            className="mt-2 text-sm underline underline-offset-4 opacity-90 hover:opacity-100"
            type="button"
            onClick={() => setDetailsOpen((current) => !current)}
          >
            {detailsOpen ? "Details verbergen" : "Details anzeigen"}
          </button>

          {detailsOpen ? (
            <div className="mt-3 space-y-3">
              <div className="overflow-hidden rounded-xl border border-white/10">
                <table className="w-full text-sm">
                  <thead className="bg-white/5">
                    <tr>
                      <th className="p-2 text-left">Artikel</th>
                      <th className="p-2 text-right">Menge</th>
                      <th className="p-2 text-right">Summe</th>
                    </tr>
                  </thead>

                  <tbody>
                    {items.map((item, index) => {
                      const qty = Math.max(1, num(item.qty, 1));
                      const extras = item.add || [];
                      const remove = item.rm || [];
                      const extrasTotal = extras.reduce(
                        (total, extra) => total + num(extra.price),
                        0,
                      );
                      const line = qty * (num(item.price) + extrasTotal);
                      const itemNote = item.note ? String(item.note) : "";

                      return (
                        <tr
                          key={`${item.id || item.sku || item.name || "item"}-${index}`}
                          className="border-t border-white/10 align-top"
                        >
                          <td className="p-2">
                            <div className="font-medium">{item.name}</div>

                            {itemNote ? (
                              <div className="mt-0.5 text-xs opacity-90">
                                Hinweis: {itemNote}
                              </div>
                            ) : null}

                            {extras.length > 0 ? (
                              <div className="text-xs opacity-70">
                                Extras:{" "}
                                {extras
                                  .map((extra) => extra.label || extra.name)
                                  .filter(Boolean)
                                  .join(", ")}
                              </div>
                            ) : null}

                            {remove.length > 0 ? (
                              <div className="text-xs opacity-70">
                                Ohne: {remove.join(", ")}
                              </div>
                            ) : null}
                          </td>

                          <td className="p-2 text-right">{qty}</td>
                          <td className="p-2 text-right">
                            {formatMoney(line)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>

                  <tfoot>
                    <tr className="border-t border-white/10">
                      <td className="p-2 text-right font-semibold" colSpan={2}>
                        Gesamt
                      </td>
                      <td className="p-2 text-right font-semibold">
                        {formatMoney(sum)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          ) : null}
        </div>

        <div className="grid shrink-0 grid-cols-2 gap-2 lg:min-w-[210px]">
          <button
            className={actionButtonClass("ghost")}
            type="button"
            onClick={() => onCall(order)}
          >
            📞 Anrufen
          </button>

          <button
            className={actionButtonClass("map")}
            type="button"
            onClick={() => onMap(order)}
          >
            🗺️ Karte
          </button>

          <button
            className={actionButtonClass("ghost")}
            type="button"
            onClick={() => setMessageOpen((open) => !open)}
          >
            🔔 Nachricht
          </button>

          <button
            className={actionButtonClass("finish")}
            type="button"
            disabled={busy}
            onClick={() => onFinish(order)}
          >
            {busy ? "Speichert…" : "✅ Fertig"}
          </button>

          <button
            className={actionButtonClass("danger")}
            type="button"
            disabled={busy}
            onClick={() => onRelease(order)}
          >
            {busy ? "Speichert…" : "↩ Zurück"}
          </button>
        </div>
      </div>

      {messageOpen ? (
        <div className="mt-3 rounded-xl border border-sky-300/20 bg-sky-500/10 p-3">
          <div className="mb-2 text-xs font-bold text-sky-100">Kundennachricht auswählen</div>
          <div className="grid gap-2 sm:grid-cols-2">
            {Object.entries(DRIVER_MESSAGE_TEMPLATES).map(([id, template]) => (
              <button key={id} type="button" disabled={messageBusy} onClick={() => void sendMessage(id as DriverMessageTemplateId)} className="rounded-xl border border-white/15 bg-black/20 px-3 py-2 text-left text-sm font-semibold text-white disabled:opacity-50">
                {template.label}
              </button>
            ))}
          </div>
          {messageFeedback ? <div className="mt-2 text-xs font-semibold text-sky-100">{messageFeedback}</div> : null}
        </div>
      ) : null}
    </div>
  );
}
