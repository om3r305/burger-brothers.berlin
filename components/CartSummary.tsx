// components/CartSummary.tsx
"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useEffect } from "react";
import { useCart } from "@/components/store";

import { loadNormalizedCampaigns } from "@/lib/campaigns-compat";
import { priceWithCampaign } from "@/lib/catalog";
import type { Campaign, Category } from "@/lib/catalog";
import { getPricingOverrides, readSettings, LS_SETTINGS } from "@/lib/settings";
import * as Coupons from "@/lib/coupons";
import { fetchOrdersFromDb } from "@/lib/orders"; // 🆕 DB’den sipariş çekme

/* LS Keys */
const LS_CHECKOUT = "bb_checkout_info_v1";
const LS_PRODUCTS = "bb_products_v1";
const LS_ACTIVE_COUPON = "bb_active_coupon_code";
const LS_ORDERS = "bb_orders_v1"; // önceki siparişler (son siparişi bulmak için)

/* ───────── Pause (global) ───────── */
const LS_PAUSE = "bb_pause_v1";
type PauseState = { delivery: boolean; pickup: boolean };
function readPause(): PauseState {
  try {
    const raw = localStorage.getItem(LS_PAUSE) || "{}";
    const obj = JSON.parse(raw) || {};
    return { delivery: !!obj.delivery, pickup: !!obj.pickup };
  } catch {
    return { delivery: false, pickup: false };
  }
}

/* ───────── Akıllı Rota Fırsatı helpers ───────── */

type RouteDealBenefit = {
  deal: any | null;
  applied: boolean;
  unlocked: boolean;
  discountAmount: number;
  missingAmount: number;
  label: string;
  rewardType: string;
  expiresMs: number;
};

const RESPONSE_META_KEYS = new Set([
  "ok",
  "source",
  "tenant",
  "count",
  "counts",
  "saved",
  "keys",
  "error",
  "createdAt",
  "updatedAt",
]);

function isPlainObject(value: any): value is Record<string, any> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function stripResponseMetadata(raw: any) {
  const source =
    isPlainObject(raw?.settings)
      ? raw.settings
      : isPlainObject(raw?.data)
        ? raw.data
        : raw;

  if (!isPlainObject(source)) return source || {};

  const out: Record<string, any> = {};

  for (const [key, value] of Object.entries(source)) {
    if (RESPONSE_META_KEYS.has(key)) continue;
    if (!key || key === "__proto__" || key === "prototype" || key === "constructor") {
      continue;
    }

    out[key] = value;
  }

  return out;
}

function dispatchSettingsChangedFromCart(next: any) {
  try {
    localStorage.setItem(LS_SETTINGS, JSON.stringify(next));
  } catch {}

  try {
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: LS_SETTINGS,
        newValue: JSON.stringify(next),
        storageArea: window.localStorage,
      }),
    );
  } catch {
    try {
      window.dispatchEvent(new Event("storage"));
    } catch {}
  }

  try {
    window.dispatchEvent(new CustomEvent("bb_settings_changed", { detail: next }));
    window.dispatchEvent(new CustomEvent("bb:settings-sync", { detail: next }));
  } catch {}
}

function useSettingsRefreshTick() {
  const [settingsTick, setSettingsTick] = useState(0);

  useEffect(() => {
    let stop = false;

    const refreshRemoteSettings = async () => {
      try {
        const res = await fetch(`/api/settings?ts=${Date.now()}`, {
          method: "GET",
          cache: "no-store",
          headers: {
            accept: "application/json",
          },
        });

        const json = await res.json().catch(() => ({}));

        if (res.ok && json?.ok !== false) {
          const settings = stripResponseMetadata(json);
          dispatchSettingsChangedFromCart(settings);
        }
      } catch {
        // localStorage fallback devam eder
      } finally {
        if (!stop) setSettingsTick((tick) => tick + 1);
      }
    };

    refreshRemoteSettings();

    const onStorage = (event: StorageEvent) => {
      if (!event.key || event.key === LS_SETTINGS) {
        setSettingsTick((tick) => tick + 1);
      }
    };

    const onSettingsSync = () => setSettingsTick((tick) => tick + 1);

    const onFocus = () => refreshRemoteSettings();
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        refreshRemoteSettings();
      }
    };

    window.addEventListener("storage", onStorage);
    window.addEventListener("focus", onFocus);
    window.addEventListener("bb_settings_changed", onSettingsSync as EventListener);
    window.addEventListener("bb:settings-sync", onSettingsSync as EventListener);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      stop = true;
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("bb_settings_changed", onSettingsSync as EventListener);
      window.removeEventListener("bb:settings-sync", onSettingsSync as EventListener);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return settingsTick;
}

function normalizeRouteDealText(value: any) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/straße/g, "strasse")
    .replace(/\bstr\.?\b/g, "strasse")
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeRouteDealPlz(value: any) {
  return String(value || "").replace(/\D/g, "").slice(0, 5);
}

function routeDealList(value: any): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item ?? "").trim()).filter(Boolean);
  }

  if (typeof value === "string") {
    return value
      .split(/[;,\n]/g)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return [];
}

function routeDealExpiresMs(deal: any) {
  const ms = Date.parse(String(deal?.expiresAt || ""));
  return Number.isFinite(ms) ? ms : 0;
}

function formatRouteDealLeft(expiresMs: number, nowMs: number) {
  const totalSeconds = Math.max(0, Math.floor((expiresMs - nowMs) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${minutes < 10 ? `0${minutes}` : minutes}:${seconds < 10 ? `0${seconds}` : seconds}`;
}

function routeDealRewardLabel(reward: any) {
  const type = String(reward?.type || "percent");

  if (type === "fixed") return `${fmt(toNum(reward?.amount, 0))} Rabatt`;
  if (type === "free_delivery") return "Lieferaufschlag geschenkt";
  if (type === "free_sauce") return reward?.freeItemName ? `${reward.freeItemName} gratis` : "Gratis Soße";
  if (type === "free_drink") return reward?.freeItemName ? `${reward.freeItemName} gratis` : "Gratis Getränk";

  return `${Math.round(toNum(reward?.percent, 15))}% Rabatt`;
}

function findActiveRouteDealForCart(params: {
  routeDeals: any;
  mode: "pickup" | "delivery";
  zip: string;
  street?: string;
  nowMs: number;
}) {
  const { routeDeals, mode, zip, street, nowMs } = params;

  if (mode !== "delivery") return null;
  if (routeDeals?.enabled !== true) return null;

  const code = normalizeRouteDealPlz(zip);
  if (!code) return null;

  const streetKey = normalizeRouteDealText(street);
  const active = Array.isArray(routeDeals?.active) ? routeDeals.active : [];

  const matches = active
    .filter((deal: any) => {
      const expiresMs = routeDealExpiresMs(deal);
      if (!expiresMs || expiresMs <= nowMs) return false;

      const dealPlz = normalizeRouteDealPlz(deal?.plz);
      if (!dealPlz || dealPlz !== code) return false;

      const explicitStreets = routeDealList(deal?.streets);
      const mustMatchStreet =
        deal?.matchMode === "street" || deal?.requireStreet === true || explicitStreets.length > 0;

      if (!mustMatchStreet) return true;

      const allowed = explicitStreets.length > 0 ? explicitStreets : [deal?.street].filter(Boolean);

      if (!allowed.length) return true;

      /*
        Menüde müşteriden sadece PLZ alıyoruz.
        Sokak henüz bilinmiyorsa aynı PLZ'de fırsatı gösteriyoruz;
        checkout'ta sokak seçilince son kontrol zaten tekrar yapılır.
      */
      if (!streetKey) return true;

      return allowed.some((candidate) => normalizeRouteDealText(candidate) === streetKey);
    })
    .sort((a: any, b: any) => routeDealExpiresMs(a) - routeDealExpiresMs(b));

  return matches[0] || null;
}

function computeRouteDealBenefit(params: {
  deal: any | null;
  baseTotal: number;
  netMerchandise: number;
  deliverySurcharges: number;
  nowMs: number;
}): RouteDealBenefit {
  const { deal, baseTotal, netMerchandise, deliverySurcharges, nowMs } = params;

  if (!deal) {
    return {
      deal: null,
      applied: false,
      unlocked: false,
      discountAmount: 0,
      missingAmount: 0,
      label: "",
      rewardType: "",
      expiresMs: 0,
    };
  }

  const expiresMs = routeDealExpiresMs(deal);
  const minTotal = Math.max(0, toNum(deal?.minTotal, 0));
  const unlocked =
    expiresMs > nowMs &&
    Math.round(Math.max(0, baseTotal) * 100) >= Math.round(minTotal * 100);

  const reward = deal?.reward || {};
  const rewardType = String(reward?.type || "percent");
  let discountAmount = 0;

  if (unlocked) {
    if (rewardType === "fixed") {
      discountAmount = Math.min(baseTotal, Math.max(0, toNum(reward?.amount, 0)));
    } else if (rewardType === "free_delivery") {
      discountAmount = Math.min(baseTotal, Math.max(0, deliverySurcharges));
    } else if (rewardType === "percent") {
      discountAmount = Math.max(0, netMerchandise) * (toNum(reward?.percent, 15) / 100);
    }

    const maxDiscount = Math.max(0, toNum(reward?.maxDiscount, 0));
    if (maxDiscount > 0 && discountAmount > maxDiscount) {
      discountAmount = maxDiscount;
    }
  }

  discountAmount = +Math.min(baseTotal, Math.max(0, discountAmount)).toFixed(2);

  return {
    deal,
    applied: unlocked && (discountAmount > 0 || rewardType === "free_sauce" || rewardType === "free_drink"),
    unlocked,
    discountAmount,
    missingAmount: Math.max(0, minTotal - baseTotal),
    label: routeDealRewardLabel(reward),
    rewardType,
    expiresMs,
  };
}

function RouteDealMiniBanner({ benefit, nowMs }: { benefit: RouteDealBenefit; nowMs: number }) {
  if (!benefit.deal) return null;

  return (
    <div className="mb-3 rounded-xl border border-emerald-500/35 bg-emerald-500/10 p-3 text-sm text-emerald-100">
      <div className="flex items-start gap-3">
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-emerald-400 text-lg text-black">
          🚗
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
            <div className="font-semibold">{benefit.deal?.name || "Nachbarschafts-Angebot"}</div>
            <div className="rounded-full border border-emerald-400/40 bg-emerald-400/10 px-2 py-0.5 text-center text-xs font-bold">
              {formatRouteDealLeft(benefit.expiresMs, nowMs)}
            </div>
          </div>

          <div className="mt-1 text-xs leading-relaxed opacity-95">
            {benefit.deal?.message ||
              "Unser Fahrer ist gleich in Ihrer Nähe. Bestellen Sie jetzt und sichern Sie sich Ihr Nachbarschafts-Angebot."}
          </div>

          {benefit.unlocked ? (
            <div className="mt-1 text-xs font-semibold">
              Aktiviert: {benefit.label}
            </div>
          ) : (
            <div className="mt-1 text-xs">
              Noch <b>{fmt(benefit.missingAmount)}</b> bis zum Angebot.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ───────── helpers ───────── */

const fmt = (n: number) =>
  new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(n);

const titleMap: Record<string, string> = {
  burger: "BURGER",
  vegan: "VEGAN / VEGETARISCH",
  extras: "EXTRAS",
  sauces: "SOßEN",
  hotdogs: "HOT DOGS",
  drinks: "GETRÄNKE",
  donuts: "DONUTS",
  bubbletea: "BUBBLE TEA",
};

function groupItems(items: any[]) {
  const map = new Map<string, any[]>();
  const norm = (s?: string) => (s || "").toLowerCase().trim();

  for (const ci of items) {
    const item = ci?.item || {};
    const catRaw = norm((ci as any)?.category || (item as any)?.category);
    const sku = norm((item as any)?.sku);
    const name = norm(item?.name);
    const desc = norm(item?.description);
    const text = `${name} ${desc}`;
    const labelAddon = norm((ci as any)?.labelAddon);

    let key: string | null = null;

    if (catRaw) {
      if (catRaw.includes("vegan") || catRaw.includes("vegetar")) key = "vegan";
      else if (catRaw.startsWith("drink") || catRaw.includes("getränke")) key = "drinks";
      else if (catRaw.startsWith("sauce") || catRaw.includes("soß")) key = "sauces";
      else if (catRaw.includes("hot") && catRaw.includes("dog")) key = "hotdogs";
      else if (catRaw.includes("donut")) key = "donuts";
      else if (catRaw.includes("bubble") || catRaw.includes("boba") || catRaw.includes("milk tea") || catRaw.includes("bubbletea")) key = "bubbletea";
      else if (catRaw.startsWith("snack") || catRaw.startsWith("extras") || catRaw.includes("pommes")) key = "extras";
      else key = catRaw;
    }

    if (!key) {
      if (sku.startsWith("vegan-")) key = "vegan";
      else if (/^(drink|cola|fritz|jarritos|ayran|wasser|water|ice ?tea|fanta|sprite|mezzo)/.test(sku)) key = "drinks";
      else if (sku.startsWith("sauce-")) key = "sauces";
      else if (/^(hotdog|hot-dog|dog)-/.test(sku)) key = "hotdogs";
      else if (/^(donut|doughnut|dn-)/.test(sku)) key = "donuts";
      else if (/^(bubbletea|bubble-tea|btea|boba|milktea)-/.test(sku)) key = "bubbletea";
      else if (/^(extra|snack|fries|pommes|rings|nugget|country)/.test(sku)) key = "extras";
    }

    if (!key && (labelAddon === "vegan" || text.includes("vegan"))) key = "vegan";
    if (!key) {
      if (/(hot ?dog|hotdog)/.test(text)) key = "hotdogs";
      else if (/(donut|doughnut)/.test(text)) key = "donuts";
      else if (/(bubble ?tea|boba|milk ?tea|taro|matcha)/.test(text)) key = "bubbletea";
      else if (/(cola|fritz|jarritos|ayran|wasser|water|ice ?tea|fanta|sprite|mezzo)/.test(text)) key = "drinks";
      else if (/(ketchup|mayo|mayonna|aioli|bbq|barbecue|sauce|soß|dip|sour ?cream|chili)/.test(text)) key = "sauces";
      else if (/(snack|pommes|fries|country|nugget|mozzarella|onion ring|curly|süßkartoffel|coleslaw)/.test(text)) key = "extras";
    }

    if (key === "snack" || key === "snacks") key = "extras";
    if (!key) key = "burger";

    const arr = map.get(key) ?? [];
    arr.push(ci);
    map.set(key, arr);
  }

  const ORDER = ["burger", "vegan", "donuts", "bubbletea", "extras", "sauces", "hotdogs", "drinks"] as const;

  return ORDER
    .map((k) => (map.has(k) ? { key: k, title: titleMap[k] ?? k.toUpperCase(), lines: map.get(k)! } : null))
    .filter(Boolean) as Array<{ key: string; title: string; lines: any[] }>;
}

type CatalogProd = { id: string; name: string; price: number; category: Category };
function readCatalog(): CatalogProd[] {
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
        category: (String(p.category ?? "burger") as unknown as Category),
      }));
  } catch {
    return [];
  }
}
function resolveBase(ci: any, catalog: CatalogProd[]): CatalogProd {
  const sku = String(ci?.item?.sku ?? ci?.id ?? ci?.item?.name ?? "");
  const byId = catalog.find((p) => p.id === sku);
  if (byId) return byId;
  const byName = catalog.find((p) => p.name === (ci?.item?.name ?? ""));
  if (byName) return byName;
  return {
    id: sku || String(ci?.item?.name ?? ""),
    name: String(ci?.item?.name ?? "Produkt"),
    price: Number(ci?.item?.price ?? 0),
    category: (ci?.category ?? ci?.item?.category ?? "burger") as unknown as Category,
  };
}
function lineMerchDynamic(ci: any, mode: "pickup" | "delivery", campaigns: Campaign[], catalog: CatalogProd[]) {
  const base = resolveBase(ci, catalog);
  const applied = priceWithCampaign(base, campaigns, mode);
  const extras = (ci?.add || []).reduce((sum: number, a: any) => sum + (Number(a?.price) || 0), 0);
  const qty = Number(ci?.qty || 1);
  return (applied.final + extras) * qty;
}

/* ---- Free sauce banner ---- */
function FreeSauceBanner() {
  const getFreebies = useCart((s: any) => s.getFreebies);
  const pricing = useCart((s: any) => s.computePricing?.() ?? {});
  const merchandise = pricing?.merchandise ?? 0;

  if (typeof getFreebies !== "function") return null;

  let state: any = {};
  try { state = getFreebies(); } catch { return null; }

  const allowed = Number(state?.allowed ?? 0);
  const used = Number(state?.used ?? 0);
  const remaining = Math.max(0, Number(state?.remaining ?? allowed - used));
  const thresholds: number[] = Array.isArray(state?.thresholds) ? state.thresholds : [];

  const nextTh =
    thresholds.find((t) => merchandise < t) ??
    (thresholds.length ? thresholds[thresholds.length - 1] : null);

  const progress =
    typeof nextTh === "number" && nextTh > 0
      ? Math.min(100, Math.round((merchandise / nextTh) * 100))
      : null;

  if (allowed <= 0 && !nextTh) return null;

  return (
    <div className="mb-3 rounded-xl border border-emerald-400/30 bg-emerald-500/10 p-3 text-emerald-200 text-sm">
      <div className="flex items-center justify-between">
        <div className="font-medium">
          {remaining > 0
            ? `Gratis Soße: ${remaining} Stück verfügbar 🎁`
            : `Gratis Soßen: Limit erreicht (${allowed} / ${allowed})`}
        </div>
        {typeof nextTh === "number" && nextTh > 0 && (
          <div className="text-[11px] opacity-90">Nächster Vorteil bei {fmt(nextTh)}</div>
        )}
      </div>
      {progress !== null && (
        <div className="mt-2 h-2 w-full overflow-hidden rounded bg-stone-800/60">
          <div className="h-2 bg-emerald-400" style={{ width: `${progress}%` }} aria-hidden />
        </div>
      )}
      {used > 0 && (
        <div className="mt-2 text-xs">
          Bereits genutzt: <b>{used}</b> • Gesamt-Guthaben: <b>{allowed}</b>
        </div>
      )}
    </div>
  );
}

/* ───────── Pricing (Settings + Gutschein) ───────── */

function toNum(n: any, fb = 0) {
  const x = Number(String(n ?? "").replace(",", "."));
  return Number.isFinite(x) ? x : fb;
}
// ✅ Kampanya ve moda duyarlı merchandise toplamı
function sumCartMerchDynamic_CS(
  items: any[],
  mode: "pickup" | "delivery",
  campaigns: Campaign[],
  catalog: CatalogProd[]
) {
  const total = (items || []).reduce((acc: number, ci: any) => acc + lineMerchDynamic(ci, mode, campaigns, catalog), 0);
  return +total.toFixed(2);
}

function catKey(name?: string) {
  const t = (name || "").toLowerCase();
  if (t.includes("burger")) return "burger";
  if (t.includes("drink") || t.includes("getränk")) return "drinks";
  if (t.includes("sauce") || t.includes("soß") || t.includes("sos")) return "sauces";
  if (t.includes("donut")) return "donuts";
  if (t.includes("bubble") || t.includes("boba") || t.includes("milk tea") || t.includes("bubbletea")) return "bubbletea";
  if (t.includes("hotdog") || t.includes("hot dog")) return "hotdogs";
  if (t.includes("vegan")) return "vegan";
  if (t.includes("extra") || t.includes("snack") || t.includes("pommes")) return "extras";
  return t || "burger";
}

// ⬇️ merchandise artık kampanya-sonrası hesaplanıyor
function computePricingFromSettings_CS(
  items:any[],
  mode:"pickup"|"delivery",
  plz?: string|null,
  campaigns: Campaign[] = [],
  catalog: CatalogProd[] = []
) {
  const ovr = getPricingOverrides(mode);

  const merchandise = sumCartMerchDynamic_CS(items, mode, campaigns, catalog);
  const discount = +(merchandise * toNum(ovr.discountRate,0)).toFixed(2);

  let surcharges = 0;
  if (mode === "delivery" && ovr.surcharges) {
    const map = ovr.surcharges as Record<string, number>;
    for (const ci of items) {
      const key = catKey(ci?.item?.category || ci?.item?.name).toLowerCase();
      const s = toNum(map[key], 0);
      if (s > 0) surcharges += s * toNum(ci?.qty,1);
    }
  }

  const afterDiscount = merchandise - discount;
  const totalPreCoupon = +(afterDiscount + surcharges).toFixed(2);

  const minMap = (ovr.plzMin || {}) as Record<string, number>;
  const rec = plz ? minMap[String(plz)] : undefined;
  const plzKnown = typeof rec === "number";

  return { merchandise, discount, surcharges, afterDiscount, totalPreCoupon, plzKnown, requiredMin: rec };
}

function getCheckoutZipAndPhone(): { zip: string; phone: string; street: string } {
  try {
    const raw = localStorage.getItem(LS_CHECKOUT);
    if (!raw) return { zip: "", phone: "", street: "" };
    const obj = JSON.parse(raw);
    const zip = (obj?.addr?.zip || "").trim();
    const phone = String(obj?.addr?.phone || "").replace(/\D/g, "");
    const street = String(obj?.addr?.street || "").trim();
    return { zip, phone, street };
  } catch { return { zip: "", phone: "", street: "" }; }
}

function computeCouponDiscount(
  code: string | null,
  items: any,
  cartAfterOverride: number,
  customerPhone?: string | null
): { amount: number; message: string; code?: string; error?: string } {
  if (!code) return { amount: 0, message: "" };

  const codeUp = code.trim();
  if (!codeUp) return { amount: 0, message: "" };

  const issued = Coupons.findIssuedByCode(codeUp);
  const def =
    issued
      ? Coupons.getAllCoupons().find((c) => c.id === issued.couponId) || null
      : (Coupons.getAllCoupons().find((c) => (c.code || "").toLowerCase() === codeUp.toLowerCase()) || null);

  if (!def) {
    return { amount: 0, message: "", code: codeUp, error: "Ungültiger Gutschein" };
  }

  const cartItems: Coupons.CartItemForCoupon[] = (items || []).map((ci: any) => {
    const addSum = (Array.isArray(ci?.add) ? ci.add : []).reduce((a:number,b:any)=> a + toNum(b?.price,0), 0);
    const base = toNum(ci?.item?.price, 0);
    return {
      sku: String(ci?.item?.sku || ci?.item?.id || ci?.id || ""),
      name: String(ci?.item?.name || ""),
      category: String(ci?.item?.category || ""),
      qty: toNum(ci?.qty, 1),
      unitPrice: +(base + addSum).toFixed(2),
    };
  });

  const check = Coupons.canApply({
    def,
    issued: issued || undefined,
    cartTotal: Math.max(0, cartAfterOverride),
    cartItems,
    customerPhone: customerPhone || undefined,
  });

  if (!check.ok) {
    return { amount: 0, message: "", code: codeUp, error: check.message || "Gutschein nicht anwendbar" };
  }

  const amount = +check.discountAmount.toFixed(2);
  return { amount, message: check.message, code: codeUp };
}

/* ───────── Repeat last order (UI + action) ───────── */

// 🆕: DB + LS birleşik “last order” okuyucu
function useLastOrder() {
  const [lastOrder, setLastOrder] = useState<any | null>(null);

  useEffect(() => {
    let active = true;

    const load = async () => {
      // 1) Önce DB'den dene
      try {
        const fromDb = await fetchOrdersFromDb();
        if (!active) return;
        if (Array.isArray(fromDb) && fromDb.length) {
          const sorted = fromDb
            .slice()
            .sort((a: any, b: any) => Number(b.ts || 0) - Number(a.ts || 0));
          if (sorted[0]) {
            setLastOrder(sorted[0]);
            return;
          }
        }
      } catch {
        // DB hata verirse LS'e düş
      }

      // 2) Fallback: LocalStorage snapshot
      try {
        const raw = localStorage.getItem(LS_ORDERS);
        const arr = raw ? JSON.parse(raw) : [];
        if (Array.isArray(arr) && arr.length) {
          const sorted = arr
            .slice()
            .sort(
              (a: any, b: any) =>
                Number(b.ts || b.createdAt || 0) -
                Number(a.ts || a.createdAt || 0)
            );
          setLastOrder(sorted[0]);
        }
      } catch {
        // no-op
      }
    };

    load();

    // Siparişler değişince (başka tabda vs.) tekrar yükle
    const onStorage = (e: StorageEvent) => {
      if (!e.key || e.key === LS_ORDERS) load();
    };
    window.addEventListener("storage", onStorage);
    return () => {
      active = false;
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  return lastOrder;
}

function RepeatLastOrderCard({ onRepeat }: { onRepeat: () => void }) {
  return (
    <div className="mb-3 flex items-center justify-between rounded-xl border border-stone-700/60 bg-stone-900/60 p-3">
      <div className="flex items-center gap-3">
        <div className="grid h-9 w-9 place-items-center rounded-full bg-stone-800/80 text-stone-200">↻</div>
        <div className="leading-tight">
          <div className="text-sm font-medium">Letzte Bestellung wiederholen</div>
          <div className="text-xs text-stone-400">Alle Artikel und Mengen werden wiederhergestellt</div>
        </div>
      </div>
      <button className="card-cta px-3 py-1.5 text-sm" onClick={onRepeat}>
        Wiederholen
      </button>
    </div>
  );
}

/* ───────── desktop ───────── */

export default function CartSummary() {
  const router = useRouter();

  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  const items = useCart((s: any) => s.items);
  const setQty = useCart((s: any) => s.setQty);
  const remove = useCart((s: any) => s.remove);
  const clear = useCart((s: any) => s.clear);
  const addToCart = useCart((s:any)=> s.addToCart);

  const orderMode = useCart((s: any) => s.orderMode);
  const setOrderMode = useCart((s: any) => s.setOrderMode);
  const plz = useCart((s: any) => s.plz);
  const setPLZ = useCart((s: any) => s.setPLZ);

  const [lsTick, setLsTick] = useState(0);
  useEffect(() => {
    const onSt = (e: StorageEvent) => {
      if (!e.key || e.key === LS_CHECKOUT || e.key === "bb_settings_v6" || e.key === LS_ACTIVE_COUPON || e.key === LS_PAUSE) {
        setLsTick((t)=>t+1);
      }
    };
    window.addEventListener("storage", onSt);
    return () => window.removeEventListener("storage", onSt);
  }, []);

  const settingsTick = useSettingsRefreshTick();
  const settingsRaw = useMemo(() => {
    try {
      return readSettings() as any;
    } catch {
      return {};
    }
  }, [settingsTick, lsTick]);

  const [routeDealNowMs, setRouteDealNowMs] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => {
      setRouteDealNowMs(Date.now());
    }, 1000);

    return () => window.clearInterval(timer);
  }, []);

  const pause = useMemo<PauseState>(() => readPause(), [lsTick]);
  const pausedPickup = !!pause.pickup;
  const pausedDelivery = !!pause.delivery;

  const { zip: checkoutZip, phone: checkoutPhone, street: checkoutStreet } = useMemo(() => getCheckoutZipAndPhone(), [lsTick]);
  const plzEffective = (String(plz ?? "").trim().length === 5 ? plz : (checkoutZip || null));

  const groups = useMemo(() => groupItems(items), [items]);
  const campaigns = useMemo(() => loadNormalizedCampaigns(), [items, orderMode]);
  const catalog = useMemo(() => readCatalog(), [items]);

  const base = useMemo(
    () => computePricingFromSettings_CS(items, orderMode, plzEffective, campaigns, catalog),
    [items, orderMode, plzEffective, campaigns, catalog]
  );
  const { merchandise, discount, surcharges, afterDiscount, requiredMin, plzKnown } = base;

  const activeCode = useMemo(() => {
    try { return localStorage.getItem(LS_ACTIVE_COUPON) || ""; } catch { return ""; }
  }, [lsTick, items.length]);

  const coupon = useMemo(
    () => computeCouponDiscount(activeCode, items, afterDiscount, checkoutPhone || null),
    [activeCode, items, afterDiscount, checkoutPhone]
  );
  const couponAmount = Math.min(afterDiscount, Math.max(0, coupon.amount || 0));
  const routeDealBaseTotal = +((afterDiscount - couponAmount) + surcharges).toFixed(2);

  const activeRouteDeal = useMemo(
    () =>
      findActiveRouteDealForCart({
        routeDeals: settingsRaw?.routeDeals,
        mode: orderMode,
        zip: String(plzEffective || ""),
        street: checkoutStreet,
        nowMs: routeDealNowMs,
      }),
    [settingsRaw?.routeDeals, orderMode, plzEffective, checkoutStreet, routeDealNowMs],
  );

  const routeDealBenefit = useMemo(
    () =>
      computeRouteDealBenefit({
        deal: activeRouteDeal,
        baseTotal: routeDealBaseTotal,
        netMerchandise: +(afterDiscount - couponAmount).toFixed(2),
        deliverySurcharges: surcharges,
        nowMs: routeDealNowMs,
      }),
    [
      activeRouteDeal,
      routeDealBaseTotal,
      afterDiscount,
      couponAmount,
      surcharges,
      routeDealNowMs,
    ],
  );

  const routeDealDiscount = routeDealBenefit.discountAmount;
  const totalFinal = +Math.max(0, routeDealBaseTotal - routeDealDiscount).toFixed(2);

  const meetsMin =
    orderMode === "pickup"
      ? true
      : (plzKnown
          ? Math.round(totalFinal * 100) >= Math.round(Number(requiredMin || 0) * 100)
          : false);

  const isEmpty = items.length === 0;
  const isModePaused = (orderMode === "pickup" && pausedPickup) || (orderMode === "delivery" && pausedDelivery);
  const canCheckout =
    !isEmpty &&
    (orderMode === "pickup" ? true : (plzKnown && meetsMin)) &&
    !isModePaused;

  const onPLZChange = (v: string) => {
    const only = v.replace(/\D/g, "").slice(0, 5);
    setPLZ(only || null);
  };

  const clearCoupon = () => {
    try { localStorage.removeItem(LS_ACTIVE_COUPON); } catch {}
    setLsTick((t)=>t+1);
  };

  // repeat last order (fallback'lı mapping)
  const lastOrder = useLastOrder();
  const repeatLast = () => {
    if (!lastOrder) return;
    try {
      clear();
      const lines: any[] = Array.isArray(lastOrder?.items) ? lastOrder.items : [];
      for (const li of lines) {
        const baseItem = li?.item || li || {};
        addToCart({
          category: li?.category || baseItem?.category || "burger",
          item: {
            sku: String(baseItem?.sku ?? baseItem?.id ?? li?.id ?? ""),
            name: String(baseItem?.name ?? li?.name ?? "Produkt"),
            price: Number(baseItem?.price ?? li?.price ?? 0),
            category: (baseItem?.category ?? "burger") as any,
            description: baseItem?.description ?? li?.description,
            allergens: baseItem?.allergens ?? li?.allergens,
          },
          qty: Number(li?.qty ?? 1),
          add: Array.isArray(li?.add) ? li.add : [],
          rm: Array.isArray(li?.rm) ? li.rm : [],
          note: li?.note || undefined,
        });
      }
    } catch {}
  };

  if (!mounted) return null;

  return (
    <aside className="hidden lg:block lg:sticky lg:top-4 lg:h-[calc(100vh-2rem)]">
      <div className="rounded-2xl border border-stone-700/60 bg-stone-900/50 p-4">
        {/* Header */}
        <div className="mb-3 flex items-center justify-between">
          <div className="text-lg font-semibold">Bestellübersicht</div>
          {!isEmpty && (
            <button onClick={() => clear()} className="text-xs text-stone-300 hover:text-stone-100" title="Warenkorb leeren">
              Alles löschen
            </button>
          )}
        </div>

        {/* Pause uyarı bandı */}
        {(pausedDelivery || pausedPickup) && (
          <div className="mb-3 rounded-xl border border-amber-400/40 bg-amber-500/15 p-3 text-amber-100 text-sm">
            {pausedDelivery && <div>⚠️ <b>Lieferung</b> Wegen sehr hoher Nachfrage ist die Lieferung aktuell vorübergehend pausiert, damit wir alle Bestellungen in gewohnter Qualität vorbereiten können. Vielen Dank für Ihr Verständnis.</div>}
            {pausedPickup && <div>⚠️ <b>Abholung</b> Wegen sehr hoher Nachfrage ist die Abholung aktuell vorübergehend pausiert, damit wir alle Bestellungen in gewohnter Qualität vorbereiten können. Vielen Dank für Ihr Verständnis.</div>}
          </div>
        )}

        {/* Repeat last order (desktop) */}
        {lastOrder && <RepeatLastOrderCard onRepeat={repeatLast} />}

        {/* Mode */}
        <div className="mb-3 flex items-center gap-2">
          <ModeBtn
            active={orderMode === "pickup"}
            disabled={pausedPickup}
            onClick={() => !pausedPickup && setOrderMode("pickup")}
            title={pausedPickup ? "Abholung derzeit pausiert" : "Abholung"}
          >
            Abholung
          </ModeBtn>
          <ModeBtn
            active={orderMode === "delivery"}
            disabled={pausedDelivery}
            onClick={() => !pausedDelivery && setOrderMode("delivery")}
            title={pausedDelivery ? "Lieferung derzeit pausiert" : "Lieferung"}
          >
            Lieferung
          </ModeBtn>
        </div>

        {/* PLZ */}
        {orderMode === "delivery" && (
          <div className="mb-3">
            <label className="mb-1 block text-xs opacity-80" htmlFor="plz">Postleitzahl (5-stellig)</label>
            <input
              id="plz"
              inputMode="numeric"
              value={plz ?? ""}
              onChange={(e) => onPLZChange(e.target.value)}
              className="w-full rounded-md border border-stone-700/60 bg-stone-950 px-3 py-2 outline-none"
              placeholder="z. B. 13507"
              maxLength={5}
              disabled={pausedDelivery}
              title={pausedDelivery ? "Lieferung pausiert" : "PLZ eingeben"}
            />
            {!plzEffective && !pausedDelivery && (
              <div className="mt-1 text-xs text-amber-400">Bitte PLZ eingeben, um Mindestbestellwert zu prüfen.</div>
            )}
            {plzEffective && !plzKnown && !pausedDelivery && (
              <div className="mt-1 text-xs text-red-400">Diese PLZ liegt außerhalb unseres Liefergebiets.</div>
            )}
            {plzKnown && !meetsMin && typeof requiredMin === "number" && !pausedDelivery && (
              <div className="mt-1 text-xs text-amber-400">
                Mindestbestellwert {fmt(requiredMin)} (Endbetrag) – bitte weitere Artikel hinzufügen.
              </div>
            )}
            {pausedDelivery && (
              <div className="mt-1 text-xs text-amber-400">Lieferung ist derzeit pausiert.</div>
            )}
          </div>
        )}

        {/* Freebie */}
        <FreeSauceBanner />

        {/* Akıllı Rota Fırsatı */}
        <RouteDealMiniBanner benefit={routeDealBenefit} nowMs={routeDealNowMs} />

        {/* Lines */}
        <div className="max-h-[50vh] space-y-4 overflow-auto pr-1">
          {isEmpty && <div className="text-sm text-stone-400">Noch keine Artikel im Warenkorb.</div>}
          {groups.map((g) => (
            <div key={g.key}>
              <div className="mb-2 text-xs font-semibold tracking-wide text-stone-300/80">
                {g.title}
              </div>
              <div className="space-y-2">
                {g.lines.map((ci: any) => (
                  <div key={ci.id} className="rounded-xl border border-stone-700/40 bg-stone-900/60 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm font-medium">
                          {ci?.item?.name} {ci?.qty > 1 ? <span className="text-stone-400">× {ci.qty}</span> : null}
                        </div>
                        {ci?.item?.description && (
                          <div className="truncate text-xs text-stone-400">{ci.item.description}</div>
                        )}
                      </div>

                      <div className="flex items-center gap-2">
                        <button className="qty" onClick={() => (ci.qty > 1 ? setQty(ci.id, ci.qty - 1) : remove(ci.id))} aria-label="Menge verringern">−</button>
                        <span className="w-6 text-center text-sm">{ci.qty}</span>
                        <button className="qty" onClick={() => setQty(ci.id, ci.qty + 1)} aria-label="Menge erhöhen">+</button>
                      </div>

                      <div className="flex items-center gap-3">
                        <div className="text-sm font-semibold">
                          {fmt(lineMerchDynamic(ci, orderMode, campaigns, catalog))}
                        </div>
                        <button className="rounded-md border border-stone-700/60 bg-stone-800/60 px-2 py-1 text-xs" onClick={() => remove(ci.id)} title="Entfernen">🗑️</button>
                      </div>
                    </div>

                    <div className="mt-2 space-y-1 text-xs text-stone-300">
                      {!!ci?.add?.length && (
                        <div>
                          Extras:{" "}
                          {ci.add.map((a: any) => (a?.name ? a.name : a?.label ? a.label : String(a?.id ?? ""))).join(", ")}
                        </div>
                      )}
                      {!!ci?.rm?.length && <div>Ohne: {ci.rm.join(", ")}</div>}
                      {!!ci?.note && <div>Hinweis: {ci.note}</div>}
                      {Array.isArray(ci?.item?.allergens) && ci.item.allergens.length > 0 && (
                        <div className="text-stone-400">Allergene: {ci.item.allergens.join(", ")}</div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Totals */}
        <div className="mt-4 space-y-3 text-sm">
          <div className="flex justify-between"><span>Warenwert</span><span>{fmt(merchandise)}</span></div>

          {surcharges > 0 && (
            <div className="flex justify-between">
              <span>Lieferaufschläge</span><span>{fmt(surcharges)}</span>
            </div>
          )}

          {discount > 0 && (
            <div className="flex justify-between text-emerald-400">
              <span>Rabatte</span><span>-{fmt(discount)}</span>
            </div>
          )}

          {!!activeCode && couponAmount > 0 && (
            <div className="flex justify-between text-emerald-400">
              <span>Gutschein {coupon.code ? `(${coupon.code})` : ""}</span>
              <span>-{fmt(couponAmount)}</span>
            </div>
          )}

          {!!activeCode && couponAmount === 0 && coupon.error && (
            <div className="flex items-center justify-between text-rose-400">
              <span className="text-xs">{coupon.error}</span>
              <button onClick={clearCoupon} className="rounded-md border border-stone-700/60 px-2 py-0.5 text-xs">✕</button>
            </div>
          )}

          {routeDealBenefit.applied && routeDealDiscount > 0 && (
            <div className="flex justify-between text-emerald-400">
              <span>Nachbarschafts-Angebot</span><span>-{fmt(routeDealDiscount)}</span>
            </div>
          )}

          {routeDealBenefit.applied &&
            routeDealDiscount === 0 &&
            (routeDealBenefit.rewardType === "free_sauce" ||
              routeDealBenefit.rewardType === "free_drink") && (
              <div className="flex justify-between text-emerald-400">
                <span>Nachbarschafts-Angebot</span><span>{routeDealBenefit.label}</span>
              </div>
            )}

          <div className="flex items-center justify-between font-semibold">
            <span>Gesamt</span><span>{fmt(totalFinal)}</span>
          </div>

          <CheckoutButton canCheckout={canCheckout} />
        </div>
      </div>
    </aside>
  );
}

function ModeBtn({
  active,
  onClick,
  children,
  disabled,
  title,
}: {
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`nav-pill ${active ? "nav-pill--active" : ""} ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
    >
      {children}
    </button>
  );
}

function CheckoutButton({ canCheckout }: { canCheckout: boolean }) {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={() => router.push("/checkout")}
      disabled={!canCheckout}
      className={`mt-2 w-full card-cta card-cta--lg ${!canCheckout ? "opacity-50 cursor-not-allowed" : ""}`}
      title={!canCheckout ? "Bitte Anforderungen erfüllen" : "Zur Kasse"}
    >
      Zur Kasse
    </button>
  );
}

/* ───────── mobile drawer ───────── */

export function CartSummaryMobile() {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  const items = useCart((s: any) => s.items);
  const setQty = useCart((s: any) => s.setQty);
  const remove = useCart((s: any) => s.remove);
  const clear = useCart((s: any) => s.clear);
  const addToCart = useCart((s:any)=> s.addToCart);

  const orderMode = useCart((s: any) => s.orderMode);
  const setOrderMode = useCart((s: any) => s.setOrderMode);
  const plz = useCart((s: any) => s.plz);
  const setPLZ = useCart((s: any) => s.setPLZ);

  const [lsTick, setLsTick] = useState(0);
  useEffect(() => {
    const onSt = (e: StorageEvent) => {
      if (!e.key || e.key === LS_CHECKOUT || e.key === "bb_settings_v6" || e.key === LS_ACTIVE_COUPON || e.key === LS_PAUSE) setLsTick((t)=>t+1);
    };
    window.addEventListener("storage", onSt);
    return () => window.removeEventListener("storage", onSt);
  }, []);

  const settingsTick = useSettingsRefreshTick();
  const settingsRaw = useMemo(() => {
    try {
      return readSettings() as any;
    } catch {
      return {};
    }
  }, [settingsTick, lsTick]);

  const [routeDealNowMs, setRouteDealNowMs] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => {
      setRouteDealNowMs(Date.now());
    }, 1000);

    return () => window.clearInterval(timer);
  }, []);

  const pause = useMemo<PauseState>(() => readPause(), [lsTick]);
  const pausedPickup = !!pause.pickup;
  const pausedDelivery = !!pause.delivery;

  const { zip: checkoutZip, phone: checkoutPhone, street: checkoutStreet } = useMemo(() => getCheckoutZipAndPhone(), [lsTick]);
  const plzEffective =
    String(plz ?? "").trim().length === 5
      ? String(plz).trim()
      : checkoutZip || null;

  const groups = useMemo(() => groupItems(items), [items]);
  const campaigns = useMemo(() => loadNormalizedCampaigns(), [items, orderMode]);
  const catalog = useMemo(() => readCatalog(), [items]);

  const base = useMemo(
    () => computePricingFromSettings_CS(items, orderMode, plzEffective, campaigns, catalog),
    [items, orderMode, plzEffective, campaigns, catalog]
  );
  const { merchandise, discount, surcharges, afterDiscount, requiredMin, plzKnown } = base;

  const activeCode = useMemo(() => {
    try { return localStorage.getItem(LS_ACTIVE_COUPON) || ""; } catch { return ""; }
  }, [lsTick, items.length]);

  const coupon = useMemo(
    () => computeCouponDiscount(activeCode, items, afterDiscount, checkoutPhone || null),
    [activeCode, items, afterDiscount, checkoutPhone]
  );
  const couponAmount = Math.min(afterDiscount, Math.max(0, coupon.amount || 0));
  const routeDealBaseTotal = +((afterDiscount - couponAmount) + surcharges).toFixed(2);

  const activeRouteDeal = useMemo(
    () =>
      findActiveRouteDealForCart({
        routeDeals: settingsRaw?.routeDeals,
        mode: orderMode,
        zip: String(plzEffective || ""),
        street: checkoutStreet,
        nowMs: routeDealNowMs,
      }),
    [settingsRaw?.routeDeals, orderMode, plzEffective, checkoutStreet, routeDealNowMs],
  );

  const routeDealBenefit = useMemo(
    () =>
      computeRouteDealBenefit({
        deal: activeRouteDeal,
        baseTotal: routeDealBaseTotal,
        netMerchandise: +(afterDiscount - couponAmount).toFixed(2),
        deliverySurcharges: surcharges,
        nowMs: routeDealNowMs,
      }),
    [
      activeRouteDeal,
      routeDealBaseTotal,
      afterDiscount,
      couponAmount,
      surcharges,
      routeDealNowMs,
    ],
  );

  const routeDealDiscount = routeDealBenefit.discountAmount;
  const totalFinal = +Math.max(0, routeDealBaseTotal - routeDealDiscount).toFixed(2);

  const meetsMin =
    orderMode === "pickup"
      ? true
      : (plzKnown
          ? Math.round(totalFinal * 100) >= Math.round(Number(requiredMin || 0) * 100)
          : false);

  const isEmpty = items.length === 0;
  const isModePaused = (orderMode === "pickup" && pausedPickup) || (orderMode === "delivery" && pausedDelivery);
  const canCheckout =
    !isEmpty &&
    (orderMode === "pickup" ? true : (plzKnown && meetsMin)) &&
    !isModePaused;

  const onPLZChange = (v: string) => {
    const only = v.replace(/\D/g, "").slice(0, 5);
    setPLZ(only || null);
  };

  const clearCoupon = () => {
    try { localStorage.removeItem(LS_ACTIVE_COUPON); } catch {}
    setLsTick((t)=>t+1);
  };

  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  const safeBottom = mounted ? "calc(env(safe-area-inset-bottom) + 16px)" : undefined;

  // repeat last
  const lastOrder = useLastOrder();
  const repeatLast = () => {
    if (!lastOrder) return;
    try {
      clear();
      const lines: any[] = Array.isArray(lastOrder?.items) ? lastOrder.items : [];
      for (const li of lines) {
        const baseItem = li?.item || li || {};
        addToCart({
          category: li?.category || baseItem?.category || "burger",
          item: {
            sku: String(baseItem?.sku ?? baseItem?.id ?? li?.id ?? ""),
            name: String(baseItem?.name ?? li?.name ?? "Produkt"),
            price: Number(baseItem?.price ?? li?.price ?? 0),
            category: (baseItem?.category ?? "burger") as any,
            description: baseItem?.description ?? li?.description,
            allergens: baseItem?.allergens ?? li?.allergens,
          },
          qty: Number(li?.qty ?? 1),
          add: Array.isArray(li?.add) ? li.add : [],
          rm: Array.isArray(li?.rm) ? li.rm : [],
          note: li?.note || undefined,
        });
      }
    } catch {}
  };

  /* ── Modal/overlay açıkken sabit cart FAB’ı gizle ── */
  const [overlayOpen, setOverlayOpen] = useState(false);
  useEffect(() => {
    if (typeof document === "undefined") return;

    // Modal/drawer/select overlay’leri için geniş kapsamlı selector
    const SELECTOR = [
      "[data-product-modal]",
      ".product-modal",
      "[role='dialog']",
      ".ReactModal__Overlay--after-open",
      "[data-radix-portal] [data-state='open']",
      ".drawer-open",
      ".DialogOverlay",
      ".SheetOverlay",
    ].join(",");

    const check = () => setOverlayOpen(!!document.querySelector(SELECTOR));
    check();

    const mo = new MutationObserver(check);
    mo.observe(document.body, { childList: true, subtree: true, attributes: true });

    const onVis = () => check();
    document.addEventListener("visibilitychange", onVis);

    return () => {
      mo.disconnect();
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  return (
    <>
      {mounted && !open && !overlayOpen && (
        <button
          suppressHydrationWarning
          onClick={() => setOpen(true)}
          style={{ bottom: safeBottom }}
          className="fixed left-1/2 z-40 -translate-x-1/2 rounded-full bg-amber-600 px-5 py-3 text-black shadow-xl sm:hidden"
        >
          Warenkorb ansehen {routeDealBenefit.applied ? "🎁" : ""} • {fmt(totalFinal)}
        </button>
      )}

      {open && (
        <div className="fixed inset-0 z-50 sm:hidden">
          <div className="absolute inset-0 bg-black/60" onClick={() => setOpen(false)} />
          <div className="absolute bottom-0 left-0 right-0 max-h-[56vh] overflow-y-auto overflow-x-hidden rounded-t-2xl bg-stone-900 p-4">
            <div className="mb-3 flex items-center justify-between">
              <div className="text-lg font-semibold">Bestellübersicht</div>
              <div className="flex items-center gap-2">
                {!!items.length && (
                  <button
                    className="rounded-md bg-stone-800 px-3 py-1 text-xs"
                    onClick={() => clear()}
                    title="Warenkorb leeren"
                  >
                    Alles löschen
                  </button>
                )}
                <button className="rounded-md bg-stone-800 px-3 py-1" onClick={() => setOpen(false)}>
                  Schließen
                </button>
              </div>
            </div>

            {/* Pause uyarı bandı */}
            {(pausedDelivery || pausedPickup) && (
              <div className="mb-3 rounded-xl border border-amber-400/40 bg-amber-500/15 p-3 text-amber-100 text-sm">
                {pausedDelivery && <div>⚠️ <b>Lieferung</b> vorübergehend pausiert.</div>}
                {pausedPickup && <div>⚠️ <b>Abholung</b> vorübergehend pausiert.</div>}
              </div>
            )}

            {/* Repeat last order (mobile) */}
            {lastOrder && <RepeatLastOrderCard onRepeat={repeatLast} />}

            <div className="mb-3 flex items-center gap-2">
              <ModeBtn
                active={orderMode === "pickup"}
                disabled={pausedPickup}
                onClick={() => !pausedPickup && setOrderMode("pickup")}
                title={pausedPickup ? "Abholung derzeit pausiert" : "Abholung"}
              >
                Abholung
              </ModeBtn>
              <ModeBtn
                active={orderMode === "delivery"}
                disabled={pausedDelivery}
                onClick={() => !pausedDelivery && setOrderMode("delivery")}
                title={pausedDelivery ? "Lieferung derzeit pausiert" : "Lieferung"}
              >
                Lieferung
              </ModeBtn>
            </div>

            {orderMode === "delivery" && (
              <div className="mb-3">
                <label className="mb-1 block text-xs opacity-80" htmlFor="m-plz">Postleitzahl (5-stellig)</label>
                <input
                  id="m-plz"
                  inputMode="numeric"
                  value={plz ?? ""}
                  onChange={(e) => onPLZChange(e.target.value)}
                  className="w-full rounded-md border border-stone-700/60 bg-stone-950 px-3 py-2 outline-none"
                  placeholder="z. B. 13507"
                  maxLength={5}
                  disabled={pausedDelivery}
                  title={pausedDelivery ? "Lieferung pausiert" : "PLZ eingeben"}
                />
                {!plzEffective && !pausedDelivery && (
                  <div className="mt-1 text-xs text-amber-400">Bitte PLZ eingeben, um Mindestbestellwert zu prüfen.</div>
                )}
                {plzEffective && !plzKnown && !pausedDelivery && (
                  <div className="mt-1 text-xs text-red-400">Diese PLZ liegt außerhalb unseres Liefergebiets.</div>
                )}
                {plzKnown && !meetsMin && typeof requiredMin === "number" && !pausedDelivery && (
                  <div className="mt-1 text-xs text-amber-400">
                    Mindestbestellwert {fmt(requiredMin)} (Endbetrag) – bitte weitere Artikel hinzufügen.
                  </div>
                )}
                {pausedDelivery && (
                  <div className="mt-1 text-xs text-amber-400">Lieferung ist derzeit pausiert.</div>
                )}
              </div>
            )}

            {/* Freebie */}
            <FreeSauceBanner />

            {/* Akıllı Rota Fırsatı */}
            <RouteDealMiniBanner benefit={routeDealBenefit} nowMs={routeDealNowMs} />

            {/* Lines */}
            {isEmpty && <div className="mb-3 text-sm text-stone-400">Noch keine Artikel im Warenkorb.</div>}

            {groups.map((g) => (
              <div key={g.key} className="mb-3">
                <div className="mb-2 text-xs font-semibold tracking-wide text-stone-300/80">
                  {titleMap[g.key] ?? g.key.toUpperCase()}
                </div>
                <div className="space-y-2">
                  {g.lines.map((ci: any) => (
                    <div key={ci.id} className="rounded-xl border border-stone-700/40 bg-stone-900/60 p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-sm font-medium">
                            {ci?.item?.name} {ci?.qty > 1 ? <span className="text-stone-400">× {ci.qty}</span> : null}
                          </div>
                          {ci?.item?.description && (
                            <div className="truncate text-xs text-stone-400">{ci.item.description}</div>
                          )}
                        </div>
                        <div className="text-sm font-semibold">
                          {fmt(lineMerchDynamic(ci, orderMode, campaigns, catalog))}
                        </div>
                      </div>

                      <div className="mt-2 flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2">
                          <button className="qty" onClick={() => (ci.qty > 1 ? setQty(ci.id, ci.qty - 1) : remove(ci.id))} aria-label="Menge verringern">−</button>
                          <span className="w-6 text-center text-sm">{ci.qty}</span>
                          <button className="qty" onClick={() => setQty(ci.id, ci.qty + 1)} aria-label="Menge erhöhen">+</button>
                        </div>
                        <button
                          className="rounded-md border border-stone-700/60 bg-stone-800/60 px-2 py-1 text-xs"
                          onClick={() => remove(ci.id)}
                          title="Entfernen"
                        >
                          🗑️
                        </button>
                      </div>

                      <div className="mt-2 space-y-1 text-xs text-stone-300">
                        {!!ci?.add?.length && (
                          <div>
                            Extras:{" "}
                            {ci.add.map((a: any) => (a?.name ? a.name : a?.label ? a.label : String(a?.id ?? ""))).join(", ")}
                          </div>
                        )}
                        {!!ci?.rm?.length && <div>Ohne: {ci.rm.join(", ")}</div>}
                        {!!ci?.note && <div>Hinweis: {ci.note}</div>}
                        {Array.isArray(ci?.item?.allergens) && ci.item.allergens.length > 0 && (
                          <div className="text-stone-400">Allergene: {ci.item.allergens.join(", ")}</div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}

            {/* totals */}
            <div className="mt-3 space-y-2 text-sm">
              <div className="flex justify-between"><span>Warenwert</span><span>{fmt(merchandise)}</span></div>
              {surcharges > 0 && <div className="flex justify-between"><span>Lieferaufschläge</span><span>{fmt(surcharges)}</span></div>}
              {discount > 0 && <div className="flex justify-between text-emerald-400"><span>Rabatte</span><span>-{fmt(discount)}</span></div>}

              {!!activeCode && couponAmount > 0 && (
                <div className="flex justify-between text-emerald-400">
                  <span>Gutschein {coupon.code ? `(${coupon.code})` : ""}</span>
                  <span>-{fmt(couponAmount)}</span>
                </div>
              )}

              {!!activeCode && couponAmount === 0 && coupon.error && (
                <div className="flex items-center justify-between text-rose-400">
                  <span className="text-xs">{coupon.error}</span>
                  <button onClick={clearCoupon} className="rounded-md border border-stone-700/60 px-2 py-0.5 text-xs">✕</button>
                </div>
              )}

              {routeDealBenefit.applied && routeDealDiscount > 0 && (
                <div className="flex justify-between text-emerald-400">
                  <span>Nachbarschafts-Angebot</span><span>-{fmt(routeDealDiscount)}</span>
                </div>
              )}

              {routeDealBenefit.applied &&
                routeDealDiscount === 0 &&
                (routeDealBenefit.rewardType === "free_sauce" ||
                  routeDealBenefit.rewardType === "free_drink") && (
                  <div className="flex justify-between text-emerald-400">
                    <span>Nachbarschafts-Angebot</span><span>{routeDealBenefit.label}</span>
                  </div>
                )}

              <div className="flex justify-between font-semibold"><span>Gesamt</span><span>{fmt(totalFinal)}</span></div>

              <button
                type="button"
                onClick={() => router.push("/checkout")}
                disabled={!canCheckout}
                className={`w-full card-cta card-cta--lg ${!canCheckout ? "opacity-50 cursor-not-allowed" : ""}`}
                title={!canCheckout ? "Bitte Anforderungen erfüllen" : "Zur Kasse"}
              >
                Zur Kasse
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );

}
