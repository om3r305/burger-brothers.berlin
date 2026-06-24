// lib/pricing/applyAdjustments.ts
"use client";

import type { CartItem } from "@/components/types";
import type { Category } from "@/lib/catalog";
import type { OrderMode } from "@/lib/types";
import type { PricingSummary } from "./types";

import { readSettings } from "@/lib/settings";     // ✅ loadSettings → readSettings
import { getAllCoupons } from "@/lib/coupons";     // ✅ loadCoupons  → getAllCoupons
import { allocateFreebies } from "@/lib/freebies";

const EUR = (n: number) => +n.toFixed(2);
const sumExtras = (arr?: Array<{ price?: number }>) =>
  (arr ?? []).reduce((s: number, x) => s + Number(x?.price ?? 0), 0);

/** Sepet ara toplamlarını hesapla (indirimler hariç) */
export function computeBase(
  items: CartItem[]
): Omit<PricingSummary, "discount" | "total" | "freebie" | "meetsMin" | "requiredMin" | "plzKnown"> {
  const merchandise = EUR(
    items.reduce((sum: number, ci: CartItem) => {
      const add = sumExtras(ci.add);
      return sum + (Number(ci.item.price) + add) * Number(ci.qty ?? 1);
    }, 0)
  );
  return { merchandise, surcharges: 0, subtotal: merchandise };
}

/** Kuponu doğrula + indirim tutarını hesapla */
export function applyCoupon(items: CartItem[], code: string | undefined | null): number {
  if (!code) return 0;

  const coupons = getAllCoupons() as any[]; // şema esnek
  const now = Date.now();
  const c = coupons.find(
    (x: any) =>
      x?.enabled &&
      String(x.code).toLowerCase() === String(code).trim().toLowerCase() &&
      (!x.startAt || now >= Date.parse(x.startAt)) &&
      (!x.endAt || now <= Date.parse(x.endAt))
  );
  if (!c) return 0;

  let base = 0;

  if (c.scope === "all") {
    base = items.reduce((s: number, ci: CartItem) => {
      const add = sumExtras(ci.add);
      return s + (Number(ci.item.price) + add) * Number(ci.qty ?? 1);
    }, 0);
  } else if (c.scope === "category") {
    base = items
      .filter((ci) => c.categories?.includes(ci.item.category))
      .reduce((s: number, ci: CartItem) => {
        const add = sumExtras(ci.add);
        return s + (Number(ci.item.price) + add) * Number(ci.qty ?? 1);
      }, 0);
  } else {
    // product scope
    base = items
      .filter((ci) => {
        const sku = (ci.item as any).id ?? (ci.item as any).sku ?? "";
        return c.productSkus?.includes(sku);
      })
      .reduce((s: number, ci: CartItem) => {
        const add = sumExtras(ci.add);
        return s + (Number(ci.item.price) + add) * Number(ci.qty ?? 1);
      }, 0);
  }

  if (base <= 0) return 0;
  return c.kind === "percent" ? EUR(base * (c.value / 100)) : EUR(Math.min(c.value, base));
}

/** Settings → surcharges + lifa + freebies */
export function applySettingsAdjustments(
  items: CartItem[],
  mode: OrderMode,
  couponCode?: string
): Pick<PricingSummary, "discount" | "total" | "freebie" | "surcharges" | "subtotal"> {
  // settings şeması projede değişken; type sıkılığını esnetelim
  const settings = readSettings() as any;

  // 1) Surcharges (kategori başına sabit ek)
  let surcharges = 0;
  const catsInCart = new Set<Category>();
  items.forEach((ci) => {
    if (ci.item?.category) catsInCart.add(ci.item.category as Category);
  });

  // Hem yeni (delivery.surcharges) hem eski (pricing.categorySurcharges) şemalarını destekle
  const categoryFees: Record<string, number> = {
    ...(settings?.pricing?.categorySurcharges || {}),
    ...(settings?.delivery?.surcharges || {}),
  };

  for (const [cat, fee] of Object.entries(categoryFees)) {
    if (catsInCart.has(cat as Category)) surcharges += Number(fee) || 0;
  }
  surcharges = EUR(surcharges);

  // 2) Merchandise + subtotal
  const merchandise = EUR(
    items.reduce((sum: number, ci: CartItem) => {
      const add = sumExtras(ci.add);
      return sum + (Number(ci.item.price) + add) * Number(ci.qty ?? 1);
    }, 0)
  );
  const subtotal = EUR(merchandise + surcharges);

  // 3) Freebies (esnek şema – varsa uygula)
  let freebieDiscount = 0;
  let freebie:
    | {
        allowed: number;
        used: number;
        discountedAmount: number;
      }
    | undefined;

  // Eski şema: settings.freebies.enabled + minOrder/freeCount/targetCategory
  const fbCfg = settings?.freebies || {};
  const hasLegacyFreebie =
    fbCfg?.enabled && (fbCfg?.minOrder != null || fbCfg?.freeCount != null || fbCfg?.targetCategory);

  if (hasLegacyFreebie && merchandise >= Number(fbCfg.minOrder ?? 0)) {
    const fb: any = allocateFreebies(
      items.map((ci) => ({
        id: ci.id,
        qty: Number(ci.qty ?? 1),
        item: {
          price: Number(ci.item.price),
          name: String(ci.item.name),
          category: String(ci.item.category),
        },
      })),
      {
        qualifyingCategories: ["burger", "vegan", "hotdogs"],
        sauceCategory: fbCfg.targetCategory,
        rewardPerItem: 0,
      }
    );

    const sauceUnits = Number(fb?.sauceUnits ?? 0);
    const used = Math.min(Number(fbCfg.freeCount || 0), sauceUnits);

    if (used > 0) {
      const sauceLines = items
        .filter((ci) => ci.item.category === fbCfg.targetCategory && Number(ci.qty ?? 0) > 0)
        .map((ci) => ({ unitPrice: Number(ci.item.price), qty: Number(ci.qty ?? 0) }))
        .sort((a, b) => a.unitPrice - b.unitPrice);

      let remain = used;
      let disc = 0;
      for (const line of sauceLines) {
        if (remain <= 0) break;
        const take = Math.min(remain, line.qty);
        disc += take * line.unitPrice;
        remain -= take;
      }
      freebieDiscount = EUR(disc);
      freebie = { allowed: Number(fbCfg.freeCount || 0), used, discountedAmount: freebieDiscount };
    }
  }

  // 4) Gutschein
  const couponDiscount = EUR(applyCoupon(items, couponCode));

  // 5) Lifa (sadece delivery) — yeni/eskı şemaya uyum
  const lifaPercent =
    (settings?.pricing?.lifaPercent as number | undefined) ??
    (typeof settings?.lifa?.discountRate === "number" ? settings.lifa.discountRate * 100 : 0);
  const lifaDiscount = mode === "delivery" ? EUR(merchandise * (Number(lifaPercent || 0) / 100)) : 0;

  const discount = EUR(freebieDiscount + couponDiscount + lifaDiscount);
  const total = EUR(subtotal - discount);

  return { surcharges, subtotal, discount, total, freebie };
}
