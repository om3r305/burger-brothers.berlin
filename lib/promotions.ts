// lib/promotions.ts
"use client";

import type { CartItem, MenuItem } from "@/components/types";
import type { PricingSummary } from "@/lib/pricing/types";

// Projedeki kategori union'unu tekrar kullanmak için:
type Category = MenuItem["category"];

/** Kampanya tipi (yerel & esnek) */
export type Promotion =
  | {
      type: "percentOffCategory";
      targetCategory: Category;
      percent: number;
      active?: boolean;
      startsAt?: string;
      endsAt?: string;
      badgeText?: string;
      badgeColor?: string;
    }
  | {
      type: "fixedOffItem";
      targetItemIds: string[]; // id/sku/name eşleşmesi yapılır
      amount: number;          // satır başına sabit indirim (€)
      active?: boolean;
      startsAt?: string;
      endsAt?: string;
      badgeText?: string;
      badgeColor?: string;
    }
  | {
      type: "bogo";            // 2 al 1 öde (qty/2 ücretsiz)
      targetItemIds: string[];
      active?: boolean;
      startsAt?: string;
      endsAt?: string;
      badgeText?: string;
      badgeColor?: string;
    }
  | {
      type: "badgeOnly";       // görsel rozet; fiyatı etkilemez
      targetItemIds?: string[];
      active?: boolean;
      startsAt?: string;
      endsAt?: string;
      badgeText?: string;
      badgeColor?: string;
    }
  | {
      // Ücretsiz sos eşiği store.computePricing tarafında uygulanıyor;
      // burada sadece tanım tutarlılığı için var.
      type: "freeSauceThreshold";
      active?: boolean;
      startsAt?: string;
      endsAt?: string;
    };

/** Promonun şu an aktif olup olmadığını kontrol et (active, startsAt, endsAt). */
function isPromoActive(p: Promotion, now = new Date()): boolean {
  if ((p as any).active === false) return false;
  const s = (p as any).startsAt ? new Date((p as any).startsAt) : null;
  if (s && isFinite(s.getTime()) && now < s) return false;
  const e = (p as any).endsAt ? new Date((p as any).endsAt) : null;
  if (e && isFinite(e.getTime()) && now > e) return false;
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

  for (const promo of promotions) {
    if (!isPromoActive(promo, now)) continue;

    switch (promo.type) {
      case "percentOffCategory": {
        const pct = Math.max(0, Math.min(100, (promo as any).percent || 0));
        const want = (promo as any).targetCategory as Category;
        if (pct <= 0 || !want) break;

        const catItems = items.filter(
          (ci) => ((ci.category as Category) ?? (ci.item.category as Category)) === want
        );
        if (catItems.length === 0) break;

        const catTotal = catItems.reduce((sum, ci) => {
          const basePrice = Number(ci.item.price || 0);
          const addSum =
            (ci.add || []).reduce((a: number, e: any) => a + Number(e?.price || 0), 0) || 0;
          const qty = Number(ci.qty || 1);
          return sum + (basePrice + addSum) * qty;
        }, 0);

        const d = +(catTotal * (pct / 100)).toFixed(2);
        if (d > 0) discount += d;
        break;
      }

      case "fixedOffItem": {
        const ids = (promo as any).targetItemIds as string[] | undefined;
        const amt = Math.max(0, Number((promo as any).amount || 0));
        if (!ids?.length || !amt) break;

        for (const ci of items) {
          if (!matchItemIds(ci, ids)) continue;
          const qty = Number(ci.qty || 1);
          const d = +(amt * qty).toFixed(2);
          if (d > 0) discount += d;
        }
        break;
      }

      case "bogo": {
        const ids = (promo as any).targetItemIds as string[] | undefined;
        if (!ids?.length) break;

        for (const ci of items) {
          if (!matchItemIds(ci, ids)) continue;
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
      case "freeSauceThreshold":
        // Görsel/harici hesaplanan; fiyata etkisi yok.
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
        if (!(p as any).targetItemIds?.length) return true; // global badge
        return (p as any).targetItemIds.includes(itemId);
      }
      if (p.type === "fixedOffItem") return (p as any).targetItemIds?.includes(itemId);
      if (p.type === "percentOffCategory") return true;
      return false;
    })
    .map((p: any) => ({
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
      (p as any).targetCategory === cat
  ) as any;
  if (!promo) return null;
  return {
    text: promo.badgeText ?? (promo.percent ? `${promo.percent}%` : "Aktion"),
    color: promo.badgeColor ?? "bg-emerald-500",
  };
}
