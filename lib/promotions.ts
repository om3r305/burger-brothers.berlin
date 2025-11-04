// lib/promotions.ts
import type { CartItem, Promotion, PricingSummary, Category } from "@/components/types";

/* =========================================================
   Promosyon Motoru
   Hinweis:
   - ÜCRETSİZ SOS ve "delivery % ind." hesapları store.computePricing() içinde.
   - Burada SADECE ek kampanya indirimleri uygulanır (kategori/ürün/BuGO).
   - startsAt/endsAt penceresi ve active=false kontrolü eklendi.
   - Ürün eşlemede hem item.id hem de item.sku (varsa) dikkate alınır.
   ========================================================= */

/** Promonun şu an aktif olup olmadığını kontrol et (active, startsAt, endsAt). */
function isPromoActive(p: Promotion, now = new Date()): boolean {
  if (p.active === false) return false;
  if (p.startsAt) {
    const s = new Date(p.startsAt);
    if (isFinite(s.getTime()) && now < s) return false;
  }
  if (p.endsAt) {
    const e = new Date(p.endsAt);
    if (isFinite(e.getTime()) && now > e) return false;
  }
  return true;
}

/** Item kimliği: id || sku || name (son çare) */
function matchItemIds(ci: CartItem, ids?: string[]) {
  if (!ids?.length) return false;
  const cand = [
    (ci.item as any)?.id,
    (ci.item as any)?.sku,
    (ci.item?.name ?? "").toString(),
  ]
    .filter(Boolean)
    .map(String);
  return ids.some((x) => cand.includes(String(x)));
}

/** Verilen promosyon listesine göre indirimleri uygula. */
export function applyPromotions(
  items: CartItem[],
  base: Omit<PricingSummary, "discount" | "total" | "freebie">,
  promotions: Promotion[]
): Pick<PricingSummary, "discount" | "total" | "freebie"> {
  let discount = 0;
  const now = new Date();

  // —— 1) freeSauceThreshold burada YOK — store.computePricing zaten uyguluyor. ——

  // —— 2) Diğer promosyonlar ——
  for (const promo of promotions) {
    if (!isPromoActive(promo, now)) continue;

    switch (promo.type) {
      case "percentOffCategory": {
        if (!promo.targetCategory || !promo.percent) break;
        const pct = Math.max(0, Math.min(100, promo.percent));
        if (pct <= 0) break;

        // Yalnızca o kategorideki satırların ÜRÜN+EXTRA fiyatına yüzde uygula
        const catItems = items.filter((ci) => (ci.category as Category) === promo.targetCategory);
        if (catItems.length === 0) break;

        const catTotal = catItems.reduce((sum, ci) => {
          const basePrice = Number(ci.item.price || 0);
          const addSum =
            (ci.add || []).reduce((a, e: any) => a + Number(e?.price || 0), 0) || 0;
          const qty = Number(ci.qty || 1);
          return sum + (basePrice + addSum) * qty;
        }, 0);

        const d = +(catTotal * (pct / 100)).toFixed(2);
        if (d > 0) discount += d;
        break;
      }

      case "fixedOffItem": {
        if (!promo.targetItemIds?.length || !promo.amount) break;
        const amt = Math.max(0, promo.amount);

        for (const ci of items) {
          if (!matchItemIds(ci, promo.targetItemIds)) continue;
          const qty = Number(ci.qty || 1);
          const d = +(amt * qty).toFixed(2);
          if (d > 0) discount += d;
        }
        break;
      }

      case "bogo": {
        // 2 al 1 öde: her iki üründen biri ücretsiz (freeQty = floor(qty / 2))
        if (!promo.targetItemIds?.length) break;

        for (const ci of items) {
          if (!matchItemIds(ci, promo.targetItemIds)) continue;
          const qty = Math.max(0, Number(ci.qty || 0));
          const freeQty = Math.floor(qty / 2);
          if (freeQty > 0) {
            const unit = Number(ci.item.price || 0);
            const d = +(freeQty * unit).toFixed(2);
            if (d > 0) discount += d;
          }
        }
        break;
      }

      case "badgeOnly":
        // Görsel amaçlı; indirim yok.
        break;

      case "freeSauceThreshold":
        // Ücretsiz sos, store.computePricing içinde (çift uygulanmaması için pas geçiyoruz).
        break;
    }
  }

  const total = Math.max(0, +(base.subtotal - discount).toFixed(2));
  return { discount, total, freebie: undefined };
}

/** UI için ürünün promosyon rozetlerini getir. */
export function getBadgesForItem(itemId: string, promotions: Promotion[]) {
  const now = new Date();
  return promotions
    .filter((p) => isPromoActive(p, now))
    .filter((p) => {
      if (p.type === "badgeOnly") {
        // hedef belirtilmediyse global badge say
        if (!p.targetItemIds?.length) return true;
        return p.targetItemIds.includes(itemId);
      }
      if (p.type === "fixedOffItem") return p.targetItemIds?.includes(itemId);
      if (p.type === "percentOffCategory") {
        // Ürün kartı kategori bilgisini UI'da biliyor; burada yalnız rozet metnini sağlar.
        return true;
      }
      return false;
    })
    .map((p) => ({
      text: p.badgeText ?? (p.type === "percentOffCategory" && p.percent ? `${p.percent}%` : "Aktion"),
      color: p.badgeColor ?? "bg-red-500",
    }));
}

/** UI için kategori başlıklarında rozet. */
export function getBadgeForCategory(cat: Category, promotions: Promotion[]) {
  const now = new Date();
  const promo = promotions.find(
    (p) =>
      isPromoActive(p, now) &&
      p.type === "percentOffCategory" &&
      p.targetCategory === cat
  );
  if (!promo) return null;
  return {
    text: promo.badgeText ?? (promo.percent ? `${promo.percent}%` : "Aktion"),
    color: promo.badgeColor ?? "bg-emerald-500",
  };
}
