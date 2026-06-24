import { siteConfig } from "@/config/site.config";
import type { ItemLine } from "@/components/cart/cart.store";

export function buildWhatsAppText(lines: ItemLine[]) {
  const sub = lines.reduce((a, l) =>
    a + (l.price + (l.extras?.reduce((x, e) => x + e.price, 0) || 0)) * l.qty, 0);
  const disc = sub >= siteConfig.rules.discountThreshold ? sub * siteConfig.rules.discountRate : 0;
  const tot = sub - disc;

  const items = lines.map((l) => {
    const ex = l.extras?.length ? ` | Extras: ${l.extras.map(e=>e.label).join(", ")}` : "";
    const rm = l.removes?.length ? ` | Ohne: ${l.removes.join(", ")}` : "";
    const nt = l.note ? ` | Hinweisiz: ${l.note}` : "";
    return `• ${l.name} x${l.qty} (${l.price.toFixed(2)}€)${ex}${rm}${nt}`;
  }).join("%0A");

  return `Bestellung:%0A${items}%0A---%0ASumme: ${sub.toFixed(2)}€%0ARabatt: -${disc.toFixed(2)}€%0AGesamt: ${tot.toFixed(2)}€`;
}
