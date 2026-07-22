"use client";
import { create } from "zustand";
import type { CartItem, MenuItem, ExtraOption } from "./types";

import { loadNormalizedCampaigns } from "@/lib/campaigns-compat";
import { priceWithCampaign } from "@/lib/catalog";
import type { Campaign, Category } from "@/lib/catalog";
import { getPricingOverrides, readSettings } from "@/lib/settings";
import { evaluateFreebieRules, parseFreebieCategory } from "@/lib/freebies";
import type { FreebieEvaluation, FreebieUnit } from "@/lib/freebies";
import { evaluateConditionalCartCampaign } from "@/lib/conditional-campaign";
import { computePfand } from "@/lib/pfand";

/* =========================================
   Tipler
========================================= */
export type CartItemFixed = CartItem & {
  category?: "burger" | "drinks" | "extras" | "sauces" | "vegan" | "hotdogs" | string;
  add?: ExtraOption[];
  rm?: string[];
  note?: string;
  __unitIds?: string[]; // freebie için birim izleme
};
export type AddPayload = {
  category?: CartItemFixed["category"];
  item: MenuItem;
  add?: ExtraOption[];
  rm?: string[];
  qty?: number;
  note?: string;
};
export type OrderMode = "pickup" | "delivery";

export type CartPricing = {
  merchandise: number;
  surcharges: number;
  subtotal: number;
  discount: number;
  total: number;
  pfand: number;
  pfandLines?: ReturnType<typeof computePfand>["lines"];
  meetsMin: boolean;
  requiredMin?: number;
  plzKnown: boolean;
  freebie?: FreebieEvaluation;
  conditionalCampaign?: ReturnType<typeof evaluateConditionalCartCampaign>;
};

export type CartState = {
  items: CartItemFixed[];
  orderMode: OrderMode;
  plz: string | null;

  addToCart: (p: AddPayload) => void;
  setQty: (id: string, qty: number) => void;
  remove: (id: string) => void;
  clear: () => void;

  setOrderMode: (mode: OrderMode) => void;
  setPLZ: (plz: string | null) => void;

  computePricing: () => CartPricing;

  getFreebies?: () => FreebieEvaluation;
};

/* =========================================
   LS helpers
========================================= */
const LS_CART = "bb_cart_items_v1";
const LS_PREF = "bb_cart_prefs_v1";
const LS_PRODUCTS = "bb_products_v1";

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJsonUnknown(value: string | null): unknown {
  if (!value) return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function numberValue(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeExtraOption(value: unknown): ExtraOption | null {
  if (!isRecord(value)) return null;

  const idSource = value.id ?? value.name ?? value.label ?? value.price;
  const id = String(idSource ?? "").trim();
  if (!id) return null;

  return {
    id,
    name: typeof value.name === "string" ? value.name : undefined,
    label: typeof value.label === "string" ? value.label : undefined,
    price: numberValue(value.price, 0),
  };
}

function normalizeMenuItem(value: unknown): MenuItem | null {
  if (!isRecord(value)) return null;

  const id = String(value.id ?? value.sku ?? value.name ?? "").trim();
  const name = String(value.name ?? "").trim();
  if (!id || !name) return null;

  return {
    id,
    name,
    price: numberValue(value.price, 0),
    category: String(value.category ?? "burger"),
    desc: typeof value.desc === "string" ? value.desc : undefined,
    description:
      typeof value.description === "string" ? value.description : undefined,
    imageUrl: typeof value.imageUrl === "string" ? value.imageUrl : undefined,
    videoUrl: typeof value.videoUrl === "string" ? value.videoUrl : undefined,
    tags: Array.isArray(value.tags) ? value.tags.map(String) : undefined,
    removable: Array.isArray(value.removable)
      ? value.removable.map(String)
      : undefined,
    addable: Array.isArray(value.addable)
      ? value.addable
          .map(normalizeExtraOption)
          .filter((item): item is ExtraOption => item !== null)
      : undefined,
    sku: typeof value.sku === "string" ? value.sku : undefined,
  };
}

function normalizeCartItem(value: unknown): CartItemFixed | null {
  if (!isRecord(value)) return null;

  const item = normalizeMenuItem(value.item);
  if (!item) return null;

  const id = String(value.id ?? "").trim();
  if (!id) return null;

  return {
    id,
    item,
    qty: Math.max(1, Math.round(numberValue(value.qty, 1))),
    category:
      typeof value.category === "string" ? value.category : item.category,
    add: Array.isArray(value.add)
      ? value.add
          .map(normalizeExtraOption)
          .filter((extra): extra is ExtraOption => extra !== null)
      : [],
    rm: Array.isArray(value.rm) ? value.rm.map(String) : [],
    note: typeof value.note === "string" ? value.note : undefined,
    __unitIds: Array.isArray(value.__unitIds)
      ? value.__unitIds.map(String).filter(Boolean)
      : undefined,
  };
}

function loadItems(): CartItemFixed[] {
  if (typeof window === "undefined") return [];

  const parsed = parseJsonUnknown(localStorage.getItem(LS_CART));
  if (!Array.isArray(parsed)) return [];

  return parsed
    .map(normalizeCartItem)
    .filter((item): item is CartItemFixed => item !== null);
}
function saveItems(items: CartItemFixed[]) {
  try {
    if (typeof window === "undefined") return;
    localStorage.setItem(LS_CART, JSON.stringify(items));
  } catch {
    // Cart persistence is optional; the in-memory cart remains usable.
  }
}
function loadPrefs(): { orderMode: OrderMode; plz: string | null } {
  if (typeof window === "undefined") {
    return { orderMode: "pickup", plz: null };
  }

  const parsed = parseJsonUnknown(localStorage.getItem(LS_PREF));
  if (!isRecord(parsed)) return { orderMode: "pickup", plz: null };

  return {
    orderMode: parsed.orderMode === "delivery" ? "delivery" : "pickup",
    plz: typeof parsed.plz === "string" ? parsed.plz : null,
  };
}
function savePrefs(orderMode: OrderMode, plz: string | null) {
  try {
    if (typeof window === "undefined") return;
    localStorage.setItem(LS_PREF, JSON.stringify({ orderMode, plz }));
  } catch {
    // Preference persistence must never block cart interaction.
  }
}

/* =========================================
   Utils
========================================= */
function rid() {
  try {
    if (typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
  } catch {
    // Extremely old browsers may not expose randomUUID.
  }

  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}
function normAdd(add?: ExtraOption[]) {
  const arr =
    add?.map((a) => ({
      id: String(a?.id ?? a?.name ?? a?.label ?? String(a?.price ?? "")),
      label: String(a?.label ?? a?.name ?? a?.id ?? ""),
      price: Number(a?.price ?? 0),
    })) ?? [];
  return arr.sort((a, b) => (a.id + "|" + a.price).localeCompare(b.id + "|" + b.price));
}
function normRm(rm?: string[]) {
  return [...(rm ?? [])].map(String).sort((a, b) => a.localeCompare(b));
}

function roundToNearest10Cents(value: unknown) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;

  return +(Math.round((n + Number.EPSILON) * 10) / 10).toFixed(2);
}
function keyOf(p: {
  category?: string;
  item: MenuItem;
  add?: ExtraOption[];
  rm?: string[];
  note?: string;
}) {
  const cat = (p.category ?? "burger").toLowerCase();
  const sku = String(p.item.sku ?? p.item.name ?? "").toLowerCase();
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
  if (typeof window === "undefined") return [];

  const parsed = parseJsonUnknown(localStorage.getItem(LS_PRODUCTS));
  if (!Array.isArray(parsed)) return [];

  return parsed.flatMap((value): CatalogProduct[] => {
    if (!isRecord(value)) return [];

    const id = String(value.id ?? value.sku ?? value.code ?? value.name ?? "").trim();
    const name = String(value.name ?? "").trim();
    if (!id || !name) return [];

    return [{
      id,
      name,
      price: numberValue(value.price, 0),
      category: String(value.category ?? "burger") as Category,
    }];
  });
}

function resolveProductLike(ci: CartItemFixed, catalog: CatalogProduct[]) {
  const sku = String(ci.item.sku ?? ci.id ?? ci.item.name ?? "");
  const byId = catalog.find((p) => p.id === sku);
  if (byId) return byId;
  const byName = catalog.find((p) => p.name === ci.item.name);
  if (byName) return byName;
  const cat = (ci.category ?? ci.item.category ?? "burger") as Category;
  const base = Number(ci.item.price ?? 0);
  return {
    id: sku || String(ci.item.name ?? ""),
    name: String(ci.item.name ?? sku ?? "Produkt"),
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
  const extras = (ci.add ?? []).reduce((s, e) => s + Number(e?.price ?? 0), 0);
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
  const cat = (ci.category ?? ci.item.category ?? "burger")
    .toString()
    .toLowerCase();
  if (cat !== "burger" && cat !== "vegan") return 0;
  const qty = Number(ci?.qty ?? 1);
  const adds = ci?.add ?? [];
  let matches = 0;
  for (const a of adds) {
    const label = String(a.label ?? a.name ?? a.id ?? "").toLowerCase();
    if (EXTRA_SURCHARGE_MATCHERS.some((re) => re.test(label))) matches += 1;
  }
  return matches > 0 ? matches * EXTRA_SURCHARGE_AMOUNT * qty : 0;
}

/* =========================================
   Freebie: birim listesi (kampanya sonrası fiyat)
========================================= */
function collectFreebieUnits(
  items: CartItemFixed[],
  mode: OrderMode,
  campaigns: Campaign[],
  catalog: CatalogProduct[],
): FreebieUnit[] {
  const out: FreebieUnit[] = [];

  for (const ci of items) {
    const category = parseFreebieCategory(
      ci.category ?? ci.item.category ?? "",
    );

    if (!category) continue;

    const unitIds = Array.isArray(ci.__unitIds) ? ci.__unitIds : [];
    const base = resolveProductLike(ci, catalog);
    const applied = priceWithCampaign(base, campaigns, mode);
    const unitPrice = Math.max(0, Number(applied.final) || 0);
    const qty = Math.max(1, Number(ci?.qty ?? 1));

    for (let index = 0; index < qty; index += 1) {
      out.push({
        unitId: unitIds[index] || `${String(ci.id)}-${index}`,
        category,
        price: unitPrice,
      });
    }
  }

  return out;
}

/* =========================================
   Fiyat hesaplama
========================================= */
function computePricingRaw(items: CartItemFixed[], mode: OrderMode, plz: string | null): CartPricing {
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
      const cat = (ci.category ?? ci.item.category ?? "burger")
        .toString()
        .toLowerCase();
      const surchargePerUnit = Number(SUR[cat] ?? 0);
      surcharges += surchargePerUnit * qty;
      surcharges += extraSurchargeForItem(ci, mode);
    }

    // informatif kampanya delta (fiyata dahil, ikinci kez düşme!)
    const qty = Number(ci?.qty ?? 1);
    const delta = Math.max(0, unitOriginal - unitFinal) * qty;
    campaignDeltaSum += delta;
  }

  const subtotal = merchandise + surcharges;

  // --- Standart indirim veya net minimum şartlı sepet kampanyası
  const conditionalCampaign = evaluateConditionalCartCampaign({
    cartOffers: readSettings()?.cartOffers || [],
    mode,
    baseAmount: merchandise,
    standardRate: discountRate || 0,
  });

  const deliveryDiscount = conditionalCampaign.discountAmount;

  // --- Kümülatif Gratis-Artikel kuralları
  const freebieEvaluation = evaluateFreebieRules({
    config: freebiesConf,
    mode,
    merchandise,
    units: collectFreebieUnits(items, mode, campaigns, catalog),
  });

  const freebieDiscount = freebieEvaluation.discountedAmount;
  const discount = +(deliveryDiscount + freebieDiscount).toFixed(2);
  const pfandSummary = computePfand(items);
  const pfand = pfandSummary.amount;
  const total = roundToNearest10Cents(
    Math.max(0, subtotal - discount) + pfand,
  );

  // --- PLZ min (yalnız DELIVERY, indirim SONRASI)
  let meetsMin = true;
  let requiredMin: number | undefined;
  let plzKnown = false;

  if (mode === "delivery") {
    const key = (plz || "").replace(/\D/g, "");
    if (key.length >= 5) {
      const min = plzMin?.[key];
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
    pfand,
    pfandLines: pfandSummary.lines,
    meetsMin,
    requiredMin,
    plzKnown,
    freebie: freebieEvaluation,
    conditionalCampaign,
  };
}

/* =========================================
   Store
========================================= */
const initialItems = loadItems();
const initialPrefs = loadPrefs();

export const useCart = create<CartState>((set, get) => ({
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
    const campaigns = loadNormalizedCampaigns();
    const catalog = readCatalog();

    let merchandise = 0;

    for (const ci of items) {
      const { line } = lineTotalWithCampaign(ci, orderMode, campaigns, catalog);
      merchandise += line;
    }

    return evaluateFreebieRules({
      config: freebies,
      mode: orderMode,
      merchandise,
      units: collectFreebieUnits(items, orderMode, campaigns, catalog),
    });
  },
}));
