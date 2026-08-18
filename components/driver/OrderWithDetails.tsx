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


const CUSTOMER_MESSAGE_TEMPLATES = [
  { id: "at_door", label: "Ich bin vor der Tür" },
  { id: "phone_unreachable", label: "Telefon nicht erreichbar" },
  { id: "no_answer", label: "Klingel / keine Antwort" },
  { id: "address_unclear", label: "Adresse nicht eindeutig" },
  { id: "come_to_entrance", label: "Bitte zum Hauseingang kommen" },
] as const;

function customerMessageFeedback(payload: any, status: number) {
  const code = String(payload?.error || "").trim();

  if (status === 401 || code === "unauthorized" || code === "driver_identity_missing") {
    return "Fahrer-Anmeldung ist nicht mehr gültig. Bitte neu anmelden.";
  }
  if (code === "order_assigned_to_other_driver") {
    return "Dieser Auftrag gehört einem anderen Fahrer.";
  }
  if (code === "order_not_operational") {
    return "Diese Bestellung ist nicht mehr aktiv.";
  }
  if (code === "delivery_required") {
    return "Diese Nachricht ist nur für Lieferungen verfügbar.";
  }
  if (code === "cooldown") {
    const seconds = Math.max(1, Math.ceil(Number(payload?.retryAfterMs || 0) / 1000));
    return `Bitte ${seconds} Sek. warten, bevor dieselbe Nachricht erneut gesendet wird.`;
  }
  if (code === "notification_send_failed") {
    return "Benachrichtigung konnte technisch nicht gesendet werden.";
  }

  return `Benachrichtigung konnte nicht gesendet werden${status ? ` (HTTP ${status})` : ""}.`;
}

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
  const [messageBusy, setMessageBusy] = useState("");
  const [messageFeedback, setMessageFeedback] = useState("");

  const items = order.items;
  const sum = orderItemsTotal(order);
  const noteText = orderNote(order);
  const notePreview = shortText(noteText);
  const noteLong = noteText.trim().length > NOTE_PREVIEW_MAX;

  const sendCustomerMessage = async (templateId: string) => {
    if (messageBusy) return;

    setMessageBusy(templateId);
    setMessageFeedback("");

    try {
      const response = await fetch("/api/orders/notification", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify({
          orderId: String(order.id),
          templateId,
        }),
      });

      const payload = await response.json().catch(() => ({}));

      if (!response.ok || payload?.ok === false) {
        setMessageFeedback(customerMessageFeedback(payload, response.status));
        return;
      }

      const subscriptions = Number(payload?.subscriptions || 0);
      const accepted = Number(payload?.accepted || 0);
      const queued = Number(payload?.queued || 0);

      if (subscriptions <= 0) {
        setMessageFeedback(
          "Für diesen Kunden ist keine aktive Bestell-Benachrichtigung registriert.",
        );
        return;
      }

      if (accepted > 0) {
        setMessageFeedback("✓ Benachrichtigung gesendet.");
        return;
      }

      if (queued > 0) {
        setMessageFeedback(
          "Benachrichtigung vorgemerkt – die Zustellung wird erneut versucht.",
        );
        return;
      }

      setMessageFeedback("✓ Benachrichtigung bereits gesendet.");
    } catch {
      setMessageFeedback("Benachrichtigung konnte nicht gesendet werden.");
    } finally {
      setMessageBusy("");
    }
  };

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
            className={`${actionButtonClass("ghost")} col-span-2`}
            type="button"
            onClick={() => {
              setMessageOpen((current) => !current);
              setMessageFeedback("");
            }}
          >
            🔔 Nachricht
          </button>

          {messageOpen ? (
            <div className="col-span-2 rounded-xl border border-sky-300/20 bg-sky-400/[0.06] p-2">
              <div className="grid gap-1.5">
                {CUSTOMER_MESSAGE_TEMPLATES.map((template) => (
                  <button
                    key={template.id}
                    type="button"
                    disabled={Boolean(messageBusy)}
                    className="rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-2 text-left text-xs font-semibold text-stone-100 transition hover:bg-white/[0.08] disabled:opacity-50"
                    onClick={() => void sendCustomerMessage(template.id)}
                  >
                    {messageBusy === template.id ? "Sendet…" : template.label}
                  </button>
                ))}
              </div>

              {messageFeedback ? (
                <div className="mt-2 text-[11px] leading-relaxed text-stone-300">
                  {messageFeedback}
                </div>
              ) : null}
            </div>
          ) : null}

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
    </div>
  );
}
