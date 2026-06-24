"use client";
import { create } from "zustand";
import type { CartItem, MenuItem, ExtraOption } from "./types";

import { loadNormalizedCampaigns } from "@/lib/campaigns-compat";
import { priceWithCampaign } from "@/lib/catalog";
import type { Campaign, Category } from "@/lib/catalog";
import { getPricingOverrides } from "@/lib/settings";

/* =========================================
   Tipler
========================================= */
type CartItemFixed = CartItem & {
  category?: "burger" | "drinks" | "extras" | "sauces" | "vegan" | "hotdogs" | string;
  add?: ExtraOption[];
  rm?: string[];
  note?: string;
  __unitIds?: string[]; // freebie için birim izleme
};
type AddPayload = {
  category?: CartItemFixed["category"];
  item: MenuItem;
  add?: ExtraOption[];
  rm?: string[];
  qty?: number;
  note?: string;
};
type OrderMode = "pickup" | "delivery";

type Pricing = {
  merchandise: number;
  surcharges: number;
  subtotal: number;
  discount: number;
  total: number;
  meetsMin: boolean;
  requiredMin?: number;
  plzKnown: boolean;
  freebie?: {
    allowed: number;
    used: number;
    discountedAmount: number;
    thresholds?: number[];
    category?: "sauces" | "drinks";
  };
};

type State = {
  items: CartItemFixed[];
  orderMode: OrderMode;
  plz: string | null;

  addToCart: (p: AddPayload) => void;
  setQty: (id: string, qty: number) => void;
  remove: (id: string) => void;
  clear: () => void;

  setOrderMode: (mode: OrderMode) => void;
  setPLZ: (plz: string | null) => void;

  computePricing: () => Pricing;

  getFreebies?: () => {
    allowed: number;
    used: number;
    remaining: number;
    thresholds: number[];
    category?: "sauces" | "drinks";
  };
};

/* =========================================
   LS helpers
========================================= */
const LS_CART = "bb_cart_items_v1";
const LS_PREF = "bb_cart_prefs_v1";
const LS_PRODUCTS = "bb_products_v1";

function loadItems(): CartItemFixed[] {
  try {
    if (typeof window === "undefined") return [];
    const raw = localStorage.getItem(LS_CART);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}
function saveItems(items: CartItemFixed[]) {
  try {
    if (typeof window === "undefined") return;
    localStorage.setItem(LS_CART, JSON.stringify(items));
  } catch {}
}
function loadPrefs(): { orderMode: OrderMode; plz: string | null } {
  try {
    if (typeof window === "undefined") return { orderMode: "pickup", plz: null };
    const raw = localStorage.getItem(LS_PREF);
    if (!raw) return { orderMode: "pickup", plz: null };
    const obj = JSON.parse(raw) || {};
    return {
      orderMode: obj.orderMode === "delivery" ? "delivery" : "pickup",
      plz: obj.plz ?? null,
    };
  } catch {
    return { orderMode: "pickup", plz: null };
  }
}
function savePrefs(orderMode: OrderMode, plz: string | null) {
  try {
    if (typeof window === "undefined") return;
    localStorage.setItem(LS_PREF, JSON.stringify({ orderMode, plz }));
  } catch {}
}

/* =========================================
   Utils
========================================= */
function rid() {
  try {
    return (crypto as any).randomUUID();
  } catch {
    return String(Date.now() + Math.random());
  }
}
function normAdd(add?: ExtraOption[]) {
  const arr =
    add?.map((a: any) => ({
      id: String(a?.id ?? a?.name ?? a?.label ?? String(a?.price ?? "")),
      label: String(a?.label ?? a?.name ?? a?.id ?? ""),
      price: Number(a?.price ?? 0),
    })) ?? [];
  return arr.sort((a, b) => (a.id + "|" + a.price).localeCompare(b.id + "|" + b.price));
}
function normRm(rm?: string[]) {
  return [...(rm ?? [])].map(String).sort((a, b) => a.localeCompare(b));
}
function keyOf(p: {
  category?: string;
  item: MenuItem;
  add?: ExtraOption[];
  rm?: string[];
  note?: string;
}) {
  const cat = (p.category ?? "burger").toLowerCase();
  const sku = String((p as any).item?.sku ?? p.item?.name ?? "").toLowerCase();
  const addSig = normAdd(p.add)
    .map((x) => `${x.id}:${x.price}`)
    .join(",");
  const rmSig = normRm(p.rm).join(",");
  const noteSig = String(p.note ?? "").trim().toLowerCase();
  return `${cat}__${sku}__add:${addSig}__rm:${rmSig}__note:${noteSig}`;
}

/* =========================================
   Etagealog erişimi
========================================= */
type CatalogProduct = { id: string; name: string; price: number; category: Category };
function readCatalog(): CatalogProduct[] {
  try {
    if (typeof window === "undefined") return [];
    const raw = localStorage.getItem(LS_PRODUCTS);
    const arr = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((p: any) => p && (p.id || p.name))
      .map((p: any) => ({
        id: String(p.id ?? p.sku ?? p.code ?? p.name ?? ""),
        name: String(p.name ?? ""),
        price: Number(p.price) || 0,
        category: String(p.category ?? "burger") as Category,
      }));
  } catch {
    return [];
  }
}
function resolveProductLike(ci: CartItemFixed, catalog: CatalogProduct[]) {
  const sku = String((ci as any)?.item?.sku ?? ci?.id ?? ci?.item?.name ?? "");
  const byId = catalog.find((p) => p.id === sku);
  if (byId) return byId;
  const byName = catalog.find((p) => p.name === (ci?.item as any)?.name);
  if (byName) return byName;
  const cat = (ci?.category ?? (ci?.item as any)?.category ?? "burger") as Category;
  const base = Number((ci?.item as any)?.price ?? 0);
  return {
    id: sku || String((ci?.item as any)?.name ?? ""),
    name: String((ci?.item as any)?.name ?? sku ?? "Produkt"),
    price: base,
    category: cat,
  };
}

/* =========================================
   Kampanya + satır toplamı
========================================= */
function lineTotalWithCampaign(
  ci: CartItemFixed,
  mode: OrderMode,
  campaigns: Campaign[],
  catalog: CatalogProduct[]
) {
  const base = resolveProductLike(ci, catalog);
  const applied = priceWithCampaign(base, campaigns, mode);
  const extras = (ci?.add ?? []).reduce((s: number, e: any) => s + Number(e?.price ?? 0), 0);
  const qty = Number(ci?.qty ?? 1);
  const line = (applied.final + extras) * qty;
  return { line, unitFinal: applied.final, unitOriginal: base.price };
}

/* =========================================
   Extra sürşarjları (yalnız DELIVERY)
========================================= */
const EXTRA_SURCHARGE_MATCHERS = [
  /(^|\b)bac[oa]n\b/i,
  /(^|\b)käse\b/i,
  /(^|\b)kase\b/i,
  /cheddar/i,
  /jalape?ñ?o?s?/i,
];
const EXTRA_SURCHARGE_AMOUNT = 0.5;
function extraSurchargeForItem(ci: CartItemFixed, mode: OrderMode) {
  if (mode !== "delivery") return 0;
  const cat = (ci?.category ?? (ci?.item as any)?.category ?? "burger")
    .toString()
    .toLowerCase();
  if (cat !== "burger" && cat !== "vegan") return 0;
  const qty = Number(ci?.qty ?? 1);
  const adds = ci?.add ?? [];
  let matches = 0;
  for (const a of adds) {
    const label = String((a as any)?.label ?? (a as any)?.name ?? (a as any)?.id ?? "").toLowerCase();
    if (EXTRA_SURCHARGE_MATCHERS.some((re) => re.test(label))) matches += 1;
  }
  return matches > 0 ? matches * EXTRA_SURCHARGE_AMOUNT * qty : 0;
}

/* =========================================
   Freebie: birim listesi (kampanya sonrası fiyat)
========================================= */
function collectUnitsOrdered(
  items: CartItemFixed[],
  category: "sauces" | "drinks",
  mode: OrderMode,
  campaigns: Campaign[],
  catalog: CatalogProduct[]
) {
  const out: Array<{ unitId: string; price: number }> = [];
  for (const ci of items) {
    const cat = (ci?.category ?? (ci?.item as any)?.category ?? "")
      .toString()
      .toLowerCase();
    if (cat !== category) continue;

    const unitIds = Array.isArray(ci.__unitIds) ? ci.__unitIds : [];
    const base = resolveProductLike(ci, catalog);
    const applied = priceWithCampaign(base, campaigns, mode);
    const unitPrice = applied.final;

    const qty = Number(ci?.qty ?? 1);
    for (let i = 0; i < qty; i++) {
      const u = unitIds[i] || rid();
      out.push({ unitId: u, price: unitPrice });
    }
  }
  // Ücretsiz hakları en UCUZ birimlerden düş
  out.sort((a, b) => a.price - b.price);
  return out;
}

/* =========================================
   Fiyat hesaplama
========================================= */
function computePricingRaw(items: CartItemFixed[], mode: OrderMode, plz: string | null): Pricing {
  const campaigns = loadNormalizedCampaigns();
  const catalog = readCatalog();

  // Settings'ten override (mode’a göre)
  const { discountRate, surcharges: SUR, plzMin, freebies: freebiesConf } = getPricingOverrides(mode);

  let merchandise = 0,
    surcharges = 0,
    campaignDeltaSum = 0;

  for (const ci of items) {
    const { line, unitFinal, unitOriginal } = lineTotalWithCampaign(ci, mode, campaigns, catalog);
    merchandise += line;

    // --- SURCHARGE sadece DELIVERY’de!
    if (mode === "delivery") {
      const qty = Number(ci?.qty ?? 1);
      const cat = (ci?.category ?? (ci?.item as any)?.category ?? "burger")
        .toString()
        .toLowerCase();
      const surchargePerUnit = Number((SUR as any)[cat] ?? 0);
      surcharges += surchargePerUnit * qty;
      surcharges += extraSurchargeForItem(ci, mode);
    }

    // informatif kampanya delta (fiyata dahil, ikinci kez düşme!)
    const qty = Number(ci?.qty ?? 1);
    const delta = Math.max(0, unitOriginal - unitFinal) * qty;
    campaignDeltaSum += delta;
  }

  const subtotal = merchandise + surcharges;

  // --- Yüzde indirim de sadece DELIVERY’de
  const deliveryDiscount = mode === "delivery" ? +(subtotal * (discountRate || 0)).toFixed(2) : 0;

  // --- Freebie (mode filtresi: delivery/pickup/both)
  const freebiesEnabled = !!freebiesConf?.enabled && !!freebiesConf?.tiers?.length;
  const freebieCategory = (freebiesConf?.category ?? "sauces") as "sauces" | "drinks";
  const freebiesMode = (freebiesConf?.mode ?? "both") as "delivery" | "pickup" | "both";
  const freebieApplies = freebiesEnabled && (freebiesMode === "both" || freebiesMode === mode);

  let allowedFree = 0,
    freebieDiscount = 0,
    freebieUsed = 0;

  if (freebieApplies) {
    for (const t of freebiesConf!.tiers!) {
      const mt = Number(t?.minTotal) || 0;
      const fs = Number(t?.freeSauces) || 0;
      if (merchandise >= mt) allowedFree = fs;
    }
    if (allowedFree > 0) {
      const units = collectUnitsOrdered(items, freebieCategory, mode, campaigns, catalog);
      freebieUsed = Math.min(allowedFree, units.length);
      freebieDiscount = units.slice(0, freebieUsed).reduce((s, u) => s + (u.price || 0), 0);
    }
  }

  const discount = +(deliveryDiscount + freebieDiscount).toFixed(2);
  const total = +(subtotal - discount).toFixed(2);

  // --- PLZ min (yalnız DELIVERY, indirim SONRASI)
  let meetsMin = true;
  let requiredMin: number | undefined;
  let plzKnown = false;

  if (mode === "delivery") {
    const key = (plz || "").replace(/\D/g, "");
    if (key.length >= 5) {
      const min = (plzMin as any)?.[key];
      if (typeof min === "number") {
        plzKnown = true;
        requiredMin = min;
        meetsMin = total >= min;
      } else {
        plzKnown = false;
        meetsMin = false;
      }
    } else {
      plzKnown = false;
      meetsMin = false;
    }
  }

  return {
    merchandise,
    surcharges,
    subtotal,
    discount,
    total,
    meetsMin,
    requiredMin,
    plzKnown,
    freebie: freebieApplies
      ? {
          allowed: allowedFree,
          used: freebieUsed,
          discountedAmount: freebieDiscount,
          thresholds: (freebiesConf?.tiers || []).map((t) => Number(t.minTotal) || 0),
          category: freebieCategory,
        }
      : { allowed: 0, used: 0, discountedAmount: 0, thresholds: [], category: undefined },
  };
}

/* =========================================
   Store
========================================= */
const initialItems = loadItems();
const initialPrefs = loadPrefs();

export const useCart = create<State>((set, get) => ({
  items: initialItems,
  orderMode: initialPrefs.orderMode,
  plz: initialPrefs.plz,

  addToCart: ({ category, item, add = [], rm = [], qty = 1, note }) => {
    const items = get().items;

    const incoming = { category, item, add, rm, note };
    const sig = keyOf(incoming);

    const idx = items.findIndex(
      (ci) => keyOf({ category: ci.category, item: ci.item, add: ci.add, rm: ci.rm, note: ci.note }) === sig
    );

    if (idx >= 0) {
      const current = items[idx];
      const incQty = Math.max(1, qty || 1);
      const nextUnitIds = [...(current.__unitIds || [])];
      for (let i = 0; i < incQty; i++) nextUnitIds.push(rid());

      const next = [
        ...items.slice(0, idx),
        { ...current, qty: (current.qty ?? 1) + incQty, __unitIds: nextUnitIds },
        ...items.slice(idx + 1),
      ];
      set({ items: next });
      saveItems(next);
      return;
    }

    const incQty = Math.max(1, qty || 1);
    const unitIds: string[] = [];
    for (let i = 0; i < incQty; i++) unitIds.push(rid());

    const ci: CartItemFixed = {
      id: rid(),
      category,
      item,
      add: normAdd(add),
      rm: normRm(rm),
      qty: incQty,
      note,
      __unitIds: unitIds,
    };
    const next = [...items, ci];
    set({ items: next });
    saveItems(next);
  },

  setQty: (id, qty) => {
    const items = get().items;
    let next: CartItemFixed[];
    if (qty <= 0) {
      next = items.filter((i) => i.id !== id);
    } else {
      next = items.map((i) => {
        if (i.id !== id) return i;
        const newQty = Math.max(1, qty);
        const curQty = Number(i.qty ?? 1);
        let unitIds = Array.isArray(i.__unitIds) ? [...i.__unitIds] : [];
        if (newQty > curQty) {
          for (let k = 0; k < newQty - curQty; k++) unitIds.push(rid());
        } else if (newQty < curQty) {
          unitIds = unitIds.slice(0, newQty);
        }
        return { ...i, qty: newQty, __unitIds: unitIds };
      });
    }
    set({ items: next });
    saveItems(next);
  },

  remove: (id) => {
    const next = get().items.filter((i) => i.id !== id);
    set({ items: next });
    saveItems(next);
  },

  clear: () => {
    set({ items: [] });
    saveItems([]);
  },

  setOrderMode: (mode) => {
    set({ orderMode: mode });
    const { plz } = get();
    savePrefs(mode, plz ?? null);
  },

  setPLZ: (plz) => {
    set({ plz });
    const { orderMode } = get();
    savePrefs(orderMode, plz);
  },

  computePricing: () => {
    const { items, orderMode, plz } = get();
    return computePricingRaw(items, orderMode, plz);
  },

  getFreebies: () => {
    const { items, orderMode } = get();
    const { freebies } = getPricingOverrides(orderMode);

    const enabled = !!freebies?.enabled && !!freebies?.tiers?.length;
    const modeOk =
      enabled &&
      ((freebies?.mode as any) === "both" || (freebies?.mode as any) === orderMode);

    const category = (freebies?.category ?? "sauces") as "sauces" | "drinks";
    if (!modeOk) return { allowed: 0, used: 0, remaining: 0, thresholds: [], category };

    // merchandise (kampanya sonrası)
    const campaigns = loadNormalizedCampaigns();
    const catalog = readCatalog();
    let merchandise = 0;
    for (const ci of items) {
      const { line } = lineTotalWithCampaign(ci, orderMode, campaigns, catalog);
      merchandise += line;
    }

    // hak hesapla
    let allowed = 0;
    for (const t of freebies!.tiers!) {
      const mt = Number(t?.minTotal) || 0;
      const fs = Number(t?.freeSauces) || 0;
      if (merchandise >= mt) allowed = fs;
    }

    // en ucuz birimleri ücretsiz yap
    const units = collectUnitsOrdered(items, category, orderMode, campaigns, catalog);
    const used = Math.min(allowed, units.length);

    return {
      allowed,
      used,
      remaining: Math.max(0, allowed - used),
      thresholds: (freebies?.tiers || []).map((t) => Number(t?.minTotal) || 0),
      category,
    };
  },
}));
