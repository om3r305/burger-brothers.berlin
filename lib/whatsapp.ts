// lib/whatsapp.ts

import type { CartItem } from "@/components/types";
import { computeFreebies } from "@/lib/freebies";

/** Preis-Formatierung (de-DE, EUR) */
const fmt = (n: number) =>
  new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: "EUR",
  }).format(n);

/**
 * Erzeugt eine WhatsApp-Nachricht für die Bestellung.
 *
 * @param items Warenkorb-Artikel
 * @param total Gesamtpreis (berechnet vom Store)
 * @param orderMode "pickup" | "delivery"
 * @param geplanteZeit geplante Zeit (z. B. "18:30")
 * @param kunde optionale Kundendaten
 */
export function buildWhatsAppMessage(
  items: CartItem[],
  total: number,
  orderMode: "pickup" | "delivery",
  geplanteZeit?: string,
  kunde?: { name?: string; phone?: string; plz?: string }
): string {
  let lines: string[] = [];

  lines.push(`🍔 *Neue Bestellung* (${orderMode === "pickup" ? "Abholung" : "Lieferung"})`);

  if (geplanteZeit) {
    lines.push(`🕒 Geplante Zeit: ${geplanteZeit}`);
  }

  if (kunde?.name) {
    lines.push(`👤 Kunde: ${kunde.name}`);
  }
  if (kunde?.phone) {
    lines.push(`📞 Tel: ${kunde.phone}`);
  }
  if (orderMode === "delivery" && kunde?.plz) {
    lines.push(`📍 PLZ: ${kunde.plz}`);
  }

  lines.push("");
  lines.push("*Bestellung:*");

  for (const ci of items) {
    const qty = ci.qty || 1;
    const name = ci.item?.name ?? "Unbekannt";
    const desc = ci.item?.description ? ` (${ci.item.description})` : "";
    const baseLine = `• ${qty}× ${name}${desc}`;
    lines.push(baseLine);

    if (ci.add?.length) {
      lines.push(`   ➕ Extras: ${ci.add.map((a) => a.name).join(", ")}`);
    }
    if (ci.rm?.length) {
      lines.push(`   ➖ Ohne: ${ci.rm.join(", ")}`);
    }
    if (ci.note) {
      lines.push(`   📝 Hinweisiz: ${ci.note}`);
    }
  }

  // Gratis-Soßen berechnen
  const freebies = computeFreebies(items);
  if (freebies.count > 0) {
    lines.push("");
    lines.push(`🎁 Gratis-Soßen: ${freebies.count}x (automatisch berechnet)`);
  }

  lines.push("");
  lines.push(`💶 Gesamt: ${fmt(total)}`);

  lines.push("");
  lines.push("✅ Bitte bestätigen.");

  return lines.join("\n");
}
