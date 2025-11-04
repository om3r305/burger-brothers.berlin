// app/checkout/page.tsx
"use client";

import Link from "next/link";
import TrackPanel from "@/components/ui/TrackPanel";
import CouponBox from "@/components/CouponBox";
import { useEffect, useMemo, useState, useLayoutEffect, useRef } from "react";
import { t } from "@/lib/i18n";

import { useCart } from "@/components/store";
import { LS_SETTINGS, readSettings, getPricingOverrides } from "@/lib/settings";
import {
  planFromSettings,
  isOpenAt,
  buildSlotsForDate,
  validatePlannedTime,
  nowInTZ,
} from "@/lib/availability";

// PLZ → street search
import { getStreets, searchStreets } from "@/lib/streets";

// Coupons
import * as Coupons from "@/lib/coupons";

/* ───────── helpers ───────── */
const fmt = (n: number) =>
  new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(n);

type Mode = "pickup" | "delivery";

type Address = {
  name: string;
  phone: string;
  email?: string;
  street: string;
  house: string;
  zip: string;
  city: string;
  floor?: string;
  entrance?: string;
  note?: string;
};

function sanitizeDigits(s: string) { return (s || "").replace(/\D+/g, ""); }

type Planned = {
  enabledPickup: boolean;
  timePickup: string;
  enabledDelivery: boolean;
  timeDelivery: string;
};

type FreebieTier = { minTotal: number; freeSauces: number };

type Variant = { id: string; name: string; price: number; active?: boolean };
type FlatItem = {
  id?: string;
  sku?: string;
  name: string;
  price?: number;
  category?: string;
  tags?: string[];
  variants?: Variant[];
};

const LS_CHECKOUT = "bb_checkout_info_v1";
const LS_ORDERS = "bb_orders_v1";
const LS_CUSTOMERS = "bb_customers_v1";
const LS_DRINK_GROUPS = "bb_drink_groups_v1";
const LS_ACTIVE_COUPON = "bb_active_coupon_code";
/* 🆕 Ürünler (menüde gördüğünle aynı kaynak) */
const LS_PRODUCTS = "bb_products_v1";

/* ➜ Yeni: kalıcı müşteri profil anahtarı */
const PROFILE_KEY = "bb_checkout_profile_v2";

const pad2 = (n: number) => (n < 10 ? `0${n}` : String(n));

// normalize coupon code
const normCode = (s: string) =>
  s.replace(/[\s\u00A0\u2000-\u200B\u202F\u205F\u3000\uFEFF]/g, "").trim().toLowerCase();

function hhmmInTZ(d: Date, tz: string) {
  return new Intl.DateTimeFormat("de-DE", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",        // ✅ düzeltildi (minute)
    hour12: false,
  }).format(d);
}

function todayAt(hhmm: string, tz: string) {
  const [h, m] = (hhmm || "").split(":").map((x) => parseInt(x, 10));
  const base = nowInTZ(tz);
  const y = base.getFullYear();
  const mo = base.getMonth();
  const da = base.getDate();
  const iso = `${y}-${pad2(mo + 1)}-${pad2(da)}T${pad2(h || 0)}:${pad2(m || 0)}:00`;
  return new Date(new Date(`${iso} GMT`).toLocaleString("en-US", { timeZone: tz }));
}

function getMinTotal(t: any) {
  // ✅ her iki olası anahtara tolerans (eski/yanlış yazımlar için)
  return Number(
    t?.minTotal ??
    t?.MinTotal ??
    t?.["Min.Total"] ??
    0
  );
}

function calcFreeSauces(merchandise: number, tiers?: FreebieTier[]) {
  if (!tiers?.length) return 0;
  const sorted = tiers.slice().sort((a: any, b: any) => getMinTotal(a) - getMinTotal(b));
  let free = 0;
  for (const t of sorted) if (merchandise >= getMinTotal(t)) free = (t as any).freeSauces;
  return free;
}

function Toggle({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => !disabled && onChange(!checked)}
      className={`inline-flex h-6 w-11 items-center rounded-full transition ${
        disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"
      } ${checked ? "bg-emerald-500" : "bg-stone-600"}`}
    >
      <span
        className={`ml-0.5 inline-block h-5 w-5 transform rounded-full bg-white transition ${
          checked ? "translate-x-5" : "translate-x-0"
        }`}
      />
    </button>
  );
}

const rid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const toNum = (n: any, fb = 0) => {
  const x = Number(String(n ?? "").replace(",", ".")); return Number.isFinite(x) ? x : fb;
};
const normName = (v: string) => (v ? v.charAt(0).toLocaleUpperCase("de-DE") + v.slice(1) : v);

/* ───────── catalog (drinks/donuts/sauces) ───────── */
function collectCatalog(): FlatItem[] {
  const out: FlatItem[] = [];
  const safeArray = (v: any) => (Array.isArray(v) ? v : []);
  const readPrice = (o: any) => {
    const c = [o?.price, o?.amount, o?.preis, o?.value].find((x) => Number.isFinite(Number(x)));
    return Number(c ?? 0);
  };
  const readName = (o: any) => String(o?.name ?? o?.label ?? o?.title ?? o?.sku ?? "Artikel");

  const isAvail = (obj: any) => {
    if (obj?.active === false) return false;
    const now = Date.now();
    const from = obj?.activeFrom ?? obj?.startAt;
    const to = obj?.activeTo ?? obj?.endAt;
    const f = from ? Date.parse(from) : NaN;
    const t = to ? Date.parse(to) : NaN;
    if (Number.isFinite(f) && now < f) return false;
    if (Number.isFinite(t) && now > t) return false;
    return true;
  };

  const pushProduct = (obj: any, cat?: string) => {
    if (!isAvail(obj)) return;
    out.push({
      id: obj?.id || obj?._id || obj?.sku,
      sku: obj?.sku,
      name: readName(obj),
      price: readPrice(obj),
      category: cat ?? obj?.category,
      tags: safeArray(obj?.tags),
    });
  };

  const pushGroupWithVariants = (obj: any, cat?: string) => {
    if (!isAvail(obj)) return;
    const pools = [obj?.variants, obj?.options, obj?.choices, obj?.items, obj?.children];
    const variants: Variant[] = pools
      .flatMap((p) =>
        safeArray(p).map((v: any) => ({
          id: v?.id || v?._id || v?.sku || v?.name,
          name: readName(v),
          price: readPrice(v),
          active: v?.active !== false,
        })),
      )
      .filter((v) => v.active !== false);
    if (variants.length) {
      out.push({
        id: obj?.id || obj?._id || obj?.sku,
        sku: obj?.sku,
        name: readName(obj),
        category: cat ?? obj?.category,
        tags: safeArray(obj?.tags),
        variants,
      });
    }
  };

  // A) AdMin. drink groups (LS)
  try {
    const raw = localStorage.getItem(LS_DRINK_GROUPS);
    const arr = raw ? JSON.parse(raw) : [];
    if (Array.isArray(arr)) {
      for (const g of arr) {
        const group = {
          id: g?.id || g?._id || g?.sku,
          sku: g?.sku,
          name: readName(g),
          category: "drinks",
          variants: (Array.isArray(g?.variants) ? g.variants : []).map((v: any) => ({
            id: v?.id || v?.name,
            name: readName(v),
            price: readPrice(v),
            active: v?.active !== false,
          })),
        };
        if ((group as any).variants?.length) out.push(group as FlatItem);
      }
    }
  } catch {}

  // B) Optional extra source (global siteConfig if present)
  try {
    const maybe = (globalThis as any)?.siteConfig?.menu;
    if (maybe) {
      const walk = (node: any, cat?: string) => {
        if (!node || typeof node !== "object") return;
        if (Array.isArray(node)) return void node.forEach((n) => walk(n, cat));
        const nextCat =
          node?.category || node?.cat || (typeof node?.name === "string" ? node.name : cat) || cat;

        const hasVariants =
          (Array.isArray(node?.variants) && node.variants.length > 0) ||
          (Array.isArray(node?.options) && node.options.length > 0) ||
          (Array.isArray(node?.choices) && node.choices.length > 0);

        const looksLikeProduct =
          typeof node?.name === "string" ||
          typeof node?.title === "string" ||
          typeof node?.label === "string";

        if (looksLikeProduct) {
          if (hasVariants) pushGroupWithVariants(node, nextCat);
          else if (node?.price != null || node?.amount != null || node?.preis != null) pushProduct(node, nextCat);
        }

        for (const b of [node?.children, node?.items, node?.groups, node?.sections, node?.list, node?.data]) {
          if (b) walk(b, nextCat);
        }
      };
      walk(maybe, undefined);
    }
  } catch {}

  /* 🆕 C) LocalStorage ürünleri (bb_products_v1) — donut/drink/sauce gibi basit ürünler */
  try {
    const raw = localStorage.getItem(LS_PRODUCTS);
    const arr = raw ? JSON.parse(raw) : [];
    if (Array.isArray(arr)) {
      for (const p of arr) {
        const hasVariants =
          (Array.isArray(p?.variants) && p.variants.length > 0) ||
          (Array.isArray(p?.options) && p.options.length > 0) ||
          (Array.isArray(p?.choices) && p.choices.length > 0);
        if (hasVariants) pushGroupWithVariants(p, p?.category);
        else pushProduct(p, p?.category);
      }
    }
  } catch {}

  return out.filter(Boolean);
}

function catKey(name?: string) {
  const t = (name || "").toLowerCase();
  if (!t) return "";
  if (t.includes("burger")) return "burger";
  if (t.includes("drink") || t.includes("getränk") || t.includes("getraenk") || t.includes("cola") || t.includes("wasser") || t.includes("fritz")) return "drinks";
  if (t.includes("sauce") || t.includes("soße") || t.includes("soßen") || t.includes("sossen") || t.includes("sos") || t.includes("ketchup") || t.includes("mayo")) return "sauces";
  if (t.includes("donut") || t.includes("dessert")) return "donuts";
  if (t.includes("hotdog")) return "hotdogs";
  if (t.includes("vegan")) return "vegan";
  if (t.includes("bubble")) return "bubbleTea";
  if (t.includes("extra")) return "extras";
  return t;
}

/* küçük yardımcı: çekmece için kategori seç */
function pickByCategory(catalog: FlatItem[], type: "drink" | "donut" | "sauce") {
  const key = type === "drink" ? "drinks" : type === "donut" ? "donuts" : "sauces";
  return catalog.filter((it) => catKey(it.category || it.name) === key);
}

function sumCartMerchandise(items: any[]) {
  let sum = 0;
  for (const ci of items) {
    const base = toNum(ci?.item?.price, 0);
    const addSum = (Array.isArray(ci?.add) ? ci.add : []).reduce(
      (a: number, b: any) => a + toNum(b?.price, 0), 0
    );
    sum += (base + addSum) * toNum(ci?.qty, 1);
  }
  return +(sum.toFixed(2));
}

function computePricingV6(items: any[], mode: Mode, plz: string | null | undefined) {
  const ov = getPricingOverrides(mode); // discountRate, surcharges, plzMin, freebies
  const rate = toNum(ov.discountRate, 0);

  const merchandise = sumCartMerchandise(items);
  const discount = +(merchandise * rate).toFixed(2);
  const afterDiscount = +(merchandise - discount).toFixed(2);

  const plzMap = ov.plzMin || {};
  const code = (plz || "").replace(/[^\d]/g, "").slice(0, 5);
  const requiredMin = typeof plzMap[code] === "number" ? toNum(plzMap[code], 0) : null;
  const plzKnown = requiredMin != null;

  let surcharges = 0;
  if (mode === "delivery" && ov.surcharges) {
    for (const ci of items) {
      const key = catKey(ci?.item?.category || ci?.item?.name || "");
      const s = toNum((ov.surcharges as any)[key], 0);
      if (s > 0) surcharges += s * toNum(ci?.qty, 1);
    }
  }
  surcharges = +surcharges.toFixed(2);

  const totalPreCoupon = +(afterDiscount + surcharges).toFixed(2);

  return {
    merchandise,
    discount,
    afterDiscount,
    surcharges,
    totalPreCoupon,
    requiredMin: requiredMin ?? null,
    plzKnown,
    freebiesCfg: ov.freebies,
  };
}

/* ───────── coupon helpers ───────── */

function mapCartToCouponItems(items: any[]): Coupons.CartItemForCoupon[] {
  return (items || []).map((ci: any) => {
    const addSum = (Array.isArray(ci?.add) ? ci.add : []).reduce(
      (a: number, b: any) => a + toNum(b?.price, 0), 0
    );
    const base = toNum(ci?.item?.price, 0);
    return {
      sku: String(ci?.item?.sku || ci?.item?.id || ci?.id || ""),
      name: String(ci?.item?.name || ""),
      category: String(ci?.item?.category || ""),
      qty: toNum(ci?.qty, 1),
      unitPrice: +(base + addSum).toFixed(2),
    };
  });
}

function computeCouponDiscount(
  code: string | null,
  items: any[],
  cartAfterOverride: number,
  customerPhone?: string | null
): { amount: number; message: string; code?: string; error?: string } {
  if (!code) return { amount: 0, message: "" };
  const codeUp = code.trim();
  if (!codeUp) return { amount: 0, message: "" };

  const issued = Coupons.findIssuedByCode(codeUp);
  const allDefs = Coupons.getAllCoupons();
  const def = issued
    ? (allDefs.find((c) => c.id === issued.couponId) || null)
    : (allDefs.find((c) => normCode(c.code || "") === normCode(codeUp)) || null);

  if (!def) return { amount: 0, message: "", code: codeUp, error: "Ungültiger Gutschein" };

  const check = Coupons.canApply({
    def,
    issued: issued || undefined,
    cartTotal: Math.max(0, cartAfterOverride),
    cartItems: mapCartToCouponItems(items),
    customerPhone: customerPhone || undefined,
  });

  if (!check.ok) return { amount: 0, message: "", code: codeUp, error: check.message || "Gutschein nicht anwendbar" };

  return { amount: +check.discountAmount.toFixed(2), message: check.message, code: codeUp };
}

/* ───────── component ───────── */

export default function CheckoutPage() {
  // cart/store
  const add =
    useCart((s: any) =>
      s.add ?? s.addItem ?? s.addCartItem ?? s.addToCart ?? s.push
    ) as ((ci: any) => void) | undefined;

  const items = useCart((s: any) => s.items);
  const clear = useCart((s: any) => s.clear);
  const orderMode: Mode = useCart((s: any) => s.orderMode);
  const setOrderMode = useCart((s: any) => s.setOrderMode);
  const plzStore = useCart((s: any) => s.plz);
  const setPLZ = useCart((s: any) => s.setPLZ);

  // live settings
  const [cfgTick, setCfgTick] = useState(0);
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (!e.key || e.key === LS_SETTINGS) setCfgTick((t) => t + 1);
    };
    const onFocus = () => setCfgTick((t) => t + 1);
    const onVisibility = () => {
      if (document.visibilityState === "visible") setCfgTick((t) => t + 1);
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  // hours/plan & phoneDigits & telegram
  const settingsRaw = useMemo(() => readSettings() as any, [cfgTick]);
  const planCfg = useMemo(() => {
    const c = planFromSettings(settingsRaw?.hours);
    c.daysAhead = 0;
    return c;
  }, [settingsRaw]);

  // ✅ correct key: validation.phoneDigits
  const phoneDigits = toNum(settingsRaw?.validation?.phoneDigits, 11) || 11;

  // ✅ Telegram config from Settings (forward to API)
  const telegramFromSettings = useMemo(() => {
    const tok =
      settingsRaw?.notify?.telegram?.botToken ??
      settingsRaw?.notifications?.telegram?.botToken ??
      settingsRaw?.telegram?.botToken ??
      null;
    const chat =
      settingsRaw?.notify?.telegram?.chatId ??
      settingsRaw?.notifications?.telegram?.chatId ??
      settingsRaw?.telegram?.chatId ??
      null;
    return { botToken: tok, chatId: chat };
  }, [settingsRaw]);

  // FREEBIE (v6)
  const freebiesFromOverrides = getPricingOverrides(orderMode)?.freebies || {};
  const [addr, setAddr] = useState<Address>({
    name: "",
    phone: "",
    email: "",
    street: "",
    house: "",
    zip: plzStore ?? "",
    city: "",
    floor: "",
    entrance: "",
    note: "",
  });

  const [planned, setPlanned] = useState<Planned>({
    enabledPickup: false,
    timePickup: "",
    enabledDelivery: false,
    timeDelivery: "",
  });

  // open?
  const mustPlanNow = !isOpenAt(orderMode, nowInTZ(planCfg.tz), planCfg.plan, planCfg.tz).open;

  useLayoutEffect(() => {
    if (!mustPlanNow) return;
    const today = nowInTZ(planCfg.tz);
    const first = buildSlotsForDate(orderMode, today, {
      plan: planCfg.plan, tz: planCfg.tz, slotMinutes: planCfg.slotMinutes,
      leadPickupMin: 10, leadDeliveryMin: 35, lastOrderBufferMin: 15,
      allowPreorder: true, daysAhead: 0,
    })[0];
    const hhmm = first ? hhmmInTZ(first, planCfg.tz) : "";
    setPlanned((p) =>
      orderMode === "pickup"
        ? { ...p, enabledPickup: true, timePickup: p.timePickup || hhmm }
        : { ...p, enabledDelivery: true, timeDelivery: p.timeDelivery || hhmm }
    );
  }, [mustPlanNow, orderMode, planCfg.plan, planCfg.tz, planCfg.slotMinutes]);

  const slotOptions: string[] = useMemo(() => {
    const today = nowInTZ(planCfg.tz);
    const list = buildSlotsForDate(orderMode, today, {
      plan: planCfg.plan, tz: planCfg.tz, slotMinutes: planCfg.slotMinutes,
      leadPickupMin: 10, leadDeliveryMin: 35, lastOrderBufferMin: 15,
      allowPreorder: true, daysAhead: 0,
    });
    return list.map((d) => hhmmInTZ(d, planCfg.tz));
  }, [orderMode, planCfg.plan, planCfg.tz, planCfg.slotMinutes, cfgTick]);

  useEffect(() => {
    if (!mustPlanNow || slotOptions.length === 0) return;
    const first = slotOptions[0];
    setPlanned((p) =>
      orderMode === "pickup"
        ? { ...p, enabledPickup: true, timePickup: p.timePickup || first }
        : { ...p, enabledDelivery: true, timeDelivery: p.timeDelivery || first }
    );
  }, [mustPlanNow, slotOptions, orderMode]);

  // load from LS (eski)
  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_CHECKOUT);
      if (!raw) return;
      const saved = JSON.parse(raw) as { addr?: Address; planned?: Planned; orderMode?: Mode };
      if (saved?.addr) {
        setAddr((a) => ({ ...a, ...saved.addr, zip: saved.addr.zip ?? (plzStore ?? ""), email: saved.addr.email ?? "" }));
      }
      if (saved?.planned) {
        setPlanned({
          enabledPickup: !!saved.planned.enabledPickup,
          timePickup: saved.planned.timePickup || "",
          enabledDelivery: !!saved.planned.enabledDelivery,
          timeDelivery: saved.planned.timeDelivery || "",
        });
      }
      if (saved?.orderMode === "pickup" || saved?.orderMode === "delivery") setOrderMode(saved.orderMode);
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ✅ Yeni: Profil – mod bazlı oku (pickup/delivery)
  useEffect(() => {
    try {
      const raw = localStorage.getItem(`${PROFILE_KEY}:${orderMode}`);
      if (!raw) return;
      const p = JSON.parse(raw) as Partial<Address>;
      setAddr((a) => ({ ...a, ...p, zip: p?.zip ?? a.zip, email: p?.email ?? a.email }));
    } catch {}
    // sadece mod değişince bir kere
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderMode]);

  // save to LS (eski)
  useEffect(() => {
    try { localStorage.setItem(LS_CHECKOUT, JSON.stringify({ addr, planned, orderMode })); } catch {}
  }, [addr, planned, orderMode]);

  // ✅ Profil kaydı – 400ms debounce (street final güvence)
  const profTimer = useRef<number | null>(null);
  // PLZ + street suggestions state
  const [streetOptions, setStreetOptions] = useState<string[]>([]);
  const [streetQuery, setStreetQuery] = useState("");
  const [showSug, setShowSug] = useState(false);

  useEffect(() => {
    if (profTimer.current) window.clearTimeout(profTimer.current);
    profTimer.current = window.setTimeout(() => {
      try {
        const toSave: Partial<Address> = {
          name: addr.name, phone: addr.phone, email: addr.email,
          street: (addr.street || streetQuery || "").trim(), // ← final street
          house: addr.house, zip: addr.zip, city: addr.city,
          floor: addr.floor, entrance: addr.entrance, note: addr.note,
        };
        localStorage.setItem(`${PROFILE_KEY}:${orderMode}`, JSON.stringify(toSave));
      } catch {}
    }, 400);
    return () => { if (profTimer.current) window.clearTimeout(profTimer.current); };
  }, [orderMode, addr, streetQuery]);

  // PRICING (before coupon)
  const base = useMemo(
    () => computePricingV6(items, orderMode, addr.zip || plzStore),
    [items, orderMode, addr.zip, plzStore, cfgTick]
  );
  const { merchandise, discount, afterDiscount, surcharges, totalPreCoupon, requiredMin, plzKnown } = base;

  // coupon + submit
  const [lsTick, setLsTick] = useState(0);
  const [submitBusy, setSubmitBusy] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [confirm, setConfirm] = useState<{ id?: string; etaMin?: number } | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);

  useEffect(() => {
    const onSt = (e: StorageEvent) => {
      if (!e.key || e.key === LS_ACTIVE_COUPON || e.key === LS_CHECKOUT) setLsTick((t)=>t+1);
    };
    window.addEventListener("storage", onSt);
    return () => window.removeEventListener("storage", onSt);
  }, []);
  const activeCode = useMemo(() => {
    try { return (localStorage.getItem(LS_ACTIVE_COUPON) || "").trim(); } catch { return ""; }
  }, [lsTick, items.length]);

  const coupon = useMemo(
    () => computeCouponDiscount(activeCode, items, afterDiscount, (addr.phone || "").replace(/\D/g, "") || null),
    [activeCode, items, afterDiscount, addr.phone]
  );
  const couponAmount = Math.min(afterDiscount, Math.max(0, coupon.amount || 0));   // ✅ düzeltildi (Math.min)

  const totalFinal = +((afterDiscount - couponAmount) + surcharges).toFixed(2);

  // Min. end-amount (after coupon)
  const meetsMin =
    orderMode === "pickup"
      ? true
      : (plzKnown
          ? Math.round(totalFinal * 100) >= Math.round(toNum(requiredMin, 0) * 100)
          : false);

  // freebies (v6)
  const freebiesCfg = freebiesFromOverrides || {};
  const freebiesEnabled =
    !!freebiesCfg?.enabled && Array.isArray(freebiesCfg?.tiers) && freebiesCfg.tiers.length > 0;
  const freebiesModeOk =
    !freebiesCfg?.mode ||
    freebiesCfg.mode === "both" ||
    freebiesCfg.mode === orderMode;
  const freeSauces = useMemo(() => {
    if (!freebiesEnabled || !freebiesModeOk) return 0;
    return calcFreeSauces(merchandise, freebiesCfg.tiers as FreebieTier[]);
  }, [freebiesEnabled, freebiesModeOk, merchandise]);

  // required fields
  const requiredOk =
    orderMode === "pickup"
      ? !!addr.name.trim() && !!addr.phone.trim()
      : !!addr.name.trim() &&
        !!addr.phone.trim() &&
        !!(addr.street || streetQuery).trim() && // ← final street de kabul
        !!addr.house.trim() &&
        !!addr.zip.trim();

  const emailValid = !addr.email || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addr.email.trim());

  const plannedEnabledVirtual =
    orderMode === "pickup"
      ? mustPlanNow || planned.enabledPickup
      : mustPlanNow || planned.enabledDelivery;

  const plannedTime = orderMode === "pickup" ? planned.timePickup : planned.timeDelivery;
  const plannedOk = !mustPlanNow || (plannedEnabledVirtual && !!plannedTime);
  const noSlotsToday = mustPlanNow && (slotOptions?.length ?? 0) === 0;

  const disableSend =
    items.length === 0 ||
    !requiredOk ||
    !emailValid ||
    !plannedOk ||
    noSlotsToday ||
    (orderMode === "delivery" && (!plzKnown || !meetsMin)) ||
    addr.phone.replace(/\D/g, "").length !== phoneDigits;

  /* Street search helpers */
  const filteredStreets = useMemo(
    () => searchStreets(addr.zip, streetQuery, 50),
    [addr.zip, streetQuery]
  );

  const onZipChange = (v: string) => {
    const only = v.replace(/[^\d]/g, "").slice(0, 5);
    setPLZ(only || null);
    const list = getStreets(only);
    setStreetOptions(list);
    setAddr((a) => ({ ...a, zip: only, street: "" })); // PLZ değişince reset
    setStreetQuery("");
  };

  useEffect(() => {
    if (addr.zip) onZipChange(addr.zip);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /* Planned toggle */
  const enablePlanned = (enable: boolean) => {
    const today = nowInTZ(planCfg.tz);
    const first = buildSlotsForDate(orderMode, today, {
      plan: planCfg.plan, tz: planCfg.tz, slotMinutes: planCfg.slotMinutes,
      leadPickupMin: 10, leadDeliveryMin: 35, lastOrderBufferMin: 15,
      allowPreorder: true, daysAhead: 0,
    })[0];
    const hhmm = first ? hhmmInTZ(first, planCfg.tz) : "";

    if (orderMode === "pickup") {
      setPlanned((p) => ({ ...p, enabledPickup: enable, timePickup: enable ? p.timePickup || hhmm : "" }));
    } else {
      setPlanned((p) => ({ ...p, enabledDelivery: enable, timeDelivery: enable ? p.timeDelivery || hhmm : "" }));
    }
  };

  const ensureValidPlanned = (): boolean => {
    if (!mustPlanNow) return true;
    const tz = planCfg.tz;
    const selectedHHMM = orderMode === "pickup" ? planned.timePickup : planned.timeDelivery;
    const candidate = plannedEnabledVirtual && selectedHHMM ? todayAt(selectedHHMM, tz) : nowInTZ(tz);

    const r = validatePlannedTime(orderMode, candidate, {
      plan: planCfg.plan, tz, leadPickupMin: 10, leadDeliveryMin: 35, lastOrderBufferMin: 15,
      siteClosed: false, allowPreorder: true, daysAhead: 0,
    });

    if (r.ok) return true;
    if (r.suggest) {
      const hhmm = hhmmInTZ(r.suggest, tz);
      if (orderMode === "pickup") setPlanned((p) => ({ ...p, enabledPickup: true, timePickup: hhmm }));
      else setPlanned((p) => ({ ...p, enabledDelivery: true, timeDelivery: hhmm }));
    }
    return false;
  };

  /* smart suggestion & drawer */
  const catalog = useMemo(() => collectCatalog(), [cfgTick]);

  const hasBurger = (items || []).some((ci: any) => String(ci?.item?.category || "").toLowerCase().includes("burger"));
  const hasPommes = (items || []).some((ci: any) =>
    ["pommes", "fries", "patates", "friet", "kartoffel"].some((k) => String(ci?.item?.name || "").toLowerCase().includes(k))
  );
  const hasDrink = (items || []).some((ci: any) =>
    ["drink", "getränk", "cola", "fanta", "sprite", "wasser", "fritz"].some((k) =>
      (ci?.item?.category || ci?.item?.name || "").toLowerCase().includes(k))
  );
  const hasSauce = (items || []).some((ci: any) =>
    ["sauce", "soße", "soßen", "sos", "ketchup", "mayo"].some((k) => (ci?.item?.category || ci?.item?.name || "").toLowerCase().includes(k))
  );
  const hasDonut = (items || []).some((ci: any) =>
    ["donut", "dessert", "süß", "suess"].some((k) => (ci?.item?.category || ci?.item?.name || "").toLowerCase().includes(k))
  );

  let suggestion: "drink" | "donut" | "sauce" | null = null;
  if (hasBurger && hasPommes && !hasDrink) suggestion = "drink";
  else if (hasBurger && hasPommes && hasDrink && !hasDonut) suggestion = "donut";
  else if ((hasBurger || hasPommes) && hasDrink && !hasSauce) suggestion = "sauce";

  const [drawer, setDrawer] = useState<null | "drink" | "donut" | "sauce">(null);
  const drawerList: FlatItem[] = useMemo(() => (drawer ? pickByCategory(catalog, drawer) : []), [drawer, catalog]);

  const [drawerSel, setDrawerSel] = useState<Record<string, number>>({});
  useEffect(() => { setDrawerSel({}); }, [drawer]);

  const drawerCount = Object.values(drawerSel).reduce((a, b) => a + (b || 0), 0);
  const drawerSum = useMemo(() => {
    let s = 0;
    for (const it of drawerList) {
      if (it.variants?.length) {
        for (const v of it.variants) {
          const k = `${it.id || it.sku}-${v.id}`;
          const q = drawerSel[k] || 0;
          if (q > 0) s += v.price * q;
        }
      } else {
        const k = `${it.id || it.sku}`;
        const q = drawerSel[k] || 0;
        if (q > 0) s += (it.price || 0) * q;
      }
    }
    return s;
  }, [drawerList, drawerSel]);

  const applyDrawer = () => {
    if (!add) return;
    for (const it of drawerList) {
      if (it.variants?.length) {
        for (const v of it.variants) {
          const k = `${it.id || it.sku}-${v.id}`;
          const q = drawerSel[k] || 0;
          if (q > 0) {
            add({
              id: k,
              item: { id: k, name: `${it.name} • ${v.name}`, price: v.price, category: it.category || "drinks" },
              qty: q,
            });
          }
        }
      } else {
        const k = `${it.id || it.sku}`;
        const q = drawerSel[k] || 0;
        if (q > 0) {
          add({
            id: k,
            item: { id: k, name: it.name, price: it.price || 0, category: it.category || "drinks" },
            qty: q,
          });
        }
      }
    }
    setDrawer(null);
  };

  const clearActiveCoupon = () => {
    try { localStorage.removeItem(LS_ACTIVE_COUPON); } catch {}
    setLsTick((t)=>t+1);
  };

  /* ───────── render ───────── */

  return (
    <main className="mx-auto max-w-5xl px-4 sm:px-6 pb-6 space-y-6">
      {/* MOBILE SAFE-AREA TOP + STICKY HEADER */}
      <div className="sticky top-0 z-40 -mx-4 sm:-mx-6 px-4 sm:px-6 pt-[max(0.5rem,env(safe-area-inset-top))] pb-3 bg-stone-950/70 backdrop-blur border-b border-stone-800/60">
        <div className="flex items-center justify-between">
          <Link href="/menu" className="text-sm text-stone-300 hover:text-stone-100">← Zurück zum Menü</Link>
          <div className="flex gap-2">
            <button type="button" onClick={() => setOrderMode("pickup")}
              className={`nav-pill ${orderMode === "pickup" ? "nav-pill--active" : ""}`} title="Im Laden abholen">Abholen</button>
            <button type="button" onClick={() => setOrderMode("delivery")}
              className={`nav-pill ${orderMode === "delivery" ? "nav-pill--active" : ""}`} title="Lieferung">Liefern</button>
          </div>
        </div>
        <h1 className="mt-3 text-2xl font-semibold">Checkout</h1>
      </div>

      {/* totals */}
      <div className="space-y-1 text-sm">
        <div className="flex justify-between"><span>Warenwert</span><span>{fmt(merchandise)}</span></div>
        {orderMode === "delivery" && surcharges > 0 && (
          <div className="flex justify-between"><span>Lieferaufschläge</span><span>{fmt(surcharges)}</span></div>
        )}
        {discount > 0 && (
          <div className="flex justify-between text-emerald-400"><span>Rabatte</span><span>-{fmt(discount)}</span></div>
        )}

        {!!activeCode && couponAmount > 0 && (
          <div className="flex justify-between text-emerald-400">
            <span>Gutschein {coupon.code ? `(${coupon.code})` : ""}</span>
            <span>-{fmt(couponAmount)}</span>
          </div>
        )}
        {!!activeCode && couponAmount === 0 && coupon.error && (
          <div className="flex items-center justify-between text-rose-300">
            <span className="text-xs">{coupon.error}</span>
            <button className="rounded-md border border-stone-700/60 px-2 py-0.5 text-xs" onClick={clearActiveCoupon}>✕</button>
          </div>
        )}

        <div className="flex justify-between font-semibold"><span>Gesamt (zu zahlen)</span><span>{fmt(totalFinal)}</span></div>
      </div>

      {/* Coupons */}
      <CouponBox />

      {/* SUGGESTION */}
      {suggestion && (
        <div className="rounded-md border border-sky-500/30 bg-sky-500/10 p-3 text-sky-200 text-sm flex items-center justify-between">
          <div className="flex items-center gap-2">
            {suggestion === "drink" && <span>🥤</span>}
            {suggestion === "donut" && <span>🍩</span>}
            {suggestion === "sauce" && <span>🥫</span>}
            {suggestion === "drink" && <span>Durstig? Füge ein Getränk hinzu.</span>}
            {suggestion === "donut" && <span>Lust auf etwas Süßes? Donut auswählen.</span>}
            {suggestion === "sauce" && <span>Pommes ohne Soße? Soße hinzufügen.</span>}
          </div>
          <button onClick={() => setDrawer(suggestion)} className="btn-ghost">
            {suggestion === "drink" && "Getränk auswählen"}
            {suggestion === "donut" && "Donut auswählen"}
            {suggestion === "sauce" && "Soße auswählen"}
          </button>
        </div>
      )}

      {items.length === 0 && (
        <div className="rounded-md bg-amber-500/10 p-3 text-amber-300 text-sm">Dein Warenkorb ist leer.</div>
      )}

      {orderMode === "delivery" && (addr.zip || "").trim().length === 5 && !plzKnown && (
        <div className="rounded-md bg-rose-500/10 p-3 text-rose-300 text-sm">
          <div className="font-medium">Außerhalb unseres Liefergebiets.</div>
          <div>Bitte eine unterstützte PLZ eingeben (z. B. 13507, 13509, 13437, …).</div>
        </div>
      )}

      {orderMode === "delivery" && plzKnown && !meetsMin && typeof requiredMin === "number" && (
        <div className="rounded-md bg-amber-500/10 p-3 text-amber-300 text-sm">
          Mindestbestellwert (Endbetrag): <b>{fmt(requiredMin)}</b>. Dein Gesamt: <b>{fmt(totalFinal)}</b>. Bitte weitere Artikel hinzufügen.
        </div>
      )}

      {noSlotsToday && (
        <div className="rounded-md bg-rose-500/10 p-3 text-rose-300 text-sm">Heute sind keine Zeiten mehr verfügbar.</div>
      )}

      <div className="rounded-2xl border border-stone-700/60 bg-stone-900/60 p-4">
        {/* profil uyarısı */}
        <p className="mb-3 text-xs text-stone-400">
          Ihre Daten werden auf diesem Gerät gespeichert, damit Sie beim nächsten Mal schneller bestellen können.
          Bitte prüfen Sie, ob Ihre Daten noch aktuell sind.{" "}
          <button
            type="button"
            className="underline hover:text-stone-300"
            onClick={() => {
              try { localStorage.removeItem(`${PROFILE_KEY}:${orderMode}`); } catch {}
              alert("Gespeicherte Daten wurden entfernt.");
            }}
          >
            Daten löschen
          </button>
        </p>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Field label="Vollständiger Name *">
            <input value={addr.name} onChange={(e) => setAddr({ ...addr, name: normName(e.target.value) })}
              className="w-full rounded-md bg-stone-800/60 p-2 outline-none" />
          </Field>

          <Field label={`Telefon * (${phoneDigits} Ziffern)`}>
            <input placeholder="" inputMode="tel" pattern="[\d+\s()-]+" value={addr.phone}
              onChange={(e) => { const only = e.target.value.replace(/\D/g, "").slice(0, phoneDigits); setAddr({ ...addr, phone: only }); }}
              className="w-full rounded-md bg-stone-800/60 p-2 outline-none" />
          </Field>

          {/* PLZ + Straße */}
          {orderMode === "delivery" && (
            <>
              <div className="grid grid-cols-2 gap-3 md:col-span-2">
                <Field label="PLZ *">
                  <input
                    placeholder="z. B. 13507"
                    inputMode="numeric"
                    value={addr.zip}
                    onChange={(e) => onZipChange(e.target.value)}
                    className="w-full rounded-md bg-stone-800/60 p-2 outline-none"
                  />
                </Field>

                <Field label="Straße *">
                  <div className="relative">
                    <input
                      value={streetQuery || addr.street}
                      onChange={(e) => {
                        const v = e.target.value;
                        setStreetQuery(v);
                        setAddr((a) => ({ ...a, street: v })); // ← yazılanı da tut
                      }}
                      onFocus={() => setShowSug(true)}
                      onBlur={() => {
                        setTimeout(() => setShowSug(false), 150);
                        // öneri seçilmemişse bile yazılanı commit et
                        setAddr((a) => ({ ...a, street: (streetQuery || a.street || "").trim() }));
                      }}
                      placeholder={streetOptions.length ? "Straße eingeben (z. B. Adelheidallee)" : "Zuerst PLZ eingeben"}
                      className="w-full rounded-md bg-stone-800/60 p-2 outline-none"
                    />
                    {showSug && streetOptions.length > 0 && (streetQuery || "").length >= 2 && (
                      <div className="absolute z-10 mt-1 max-h-60 w-full overflow-auto rounded-md border border-stone-700/60 bg-stone-900/95 shadow-lg">
                        {filteredStreets.map((s) => (
                          <button
                            type="button"
                            key={s}
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => {
                              setAddr((a) => ({ ...a, street: s }));
                              setStreetQuery(s);
                              setShowSug(false);
                            }}
                            className="block w-full px-3 py-2 text-left hover:bg-stone-800/70"
                          >
                            {s}
                          </button>
                        ))}
                        {filteredStreets.length === 0 && (
                          <div className="px-3 py-2 text-stone-400 text-sm">Keine Treffer.</div>
                        )}
                      </div>
                    )}
                  </div>
                </Field>
              </div>

              {/* Hausnummer + Etage */}
              <div className="grid grid-cols-2 gap-3 md:col-span-2">
                <Field label="Hausnummer *">
                  <input placeholder="z. B. 12A" value={addr.house}
                    onChange={(e) => setAddr({ ...addr, house: e.target.value })}
                    className="w-full rounded-md bg-stone-800/60 p-2 outline-none" />
                </Field>
                <Field label="Etage/Stockwerk">
                  <input placeholder="z. B. 3. OG" value={addr.floor}
                    onChange={(e) => setAddr({ ...addr, floor: e.target.value })}
                    className="w-full rounded-md bg-stone-800/60 p-2 outline-none" />
                </Field>
              </div>

              {/* Aufgang + Stadt */}
              <div className="grid grid-cols-2 gap-3 md:col-span-2">
                <Field label="Aufgang/Block">
                  <input placeholder="z. B. Block B / Aufgang 2" value={addr.entrance}
                    onChange={(e) => setAddr({ ...addr, entrance: e.target.value })}
                    className="w-full rounded-md bg-stone-800/60 p-2 outline-none" />
                </Field>
                <Field label="Stadt/Ort">
                  <input value={addr.city} onChange={(e) => setAddr({ ...addr, city: e.target.value })}
                    className="w-full rounded-md bg-stone-800/60 p-2 outline-none" />
                </Field>
              </div>
            </>
          )}

          {/* E-mail + checkbox */}
          <Field label="E-Mail (optional)">
            <input
              type="email"
              placeholder="z. B. name@example.com"
              value={addr.email ?? ""}
              onChange={(e) => setAddr({ ...addr, email: e.target.value })}
              className={`w-full rounded-md bg-stone-800/60 p-2 outline-none ${addr.email && !emailValid ? "ring-1 ring-rose-500/60" : ""}`}
            />
            <div className="mt-2 flex items-center gap-2 text-xs text-stone-300/80">
              <input type="checkbox" onChange={() => {}} />
              <span>Ja, ich möchte Angebote & Neuigkeiten per E-Mail erhalten.</span>
            </div>
            {addr.email && !emailValid && (
              <span className="mt-1 block text-xs text-rose-300">Bitte eine gültige E-Mail eingeben.</span>
            )}
          </Field>

          <div className="md:col-span-2">
            <Field label={orderMode === "pickup" ? "Hinweis zur Abholung" : "Lieferhinweis"}>
              <textarea rows={3}
                placeholder={orderMode === "pickup" ? "z. B. komme in 15 Min" : "Klingeln bei Müller, Tor links, Hund vor, usw."}
                value={addr.note} onChange={(e) => setAddr({ ...addr, note: e.target.value })}
                className="w-full rounded-md bg-stone-800/60 p-2 outline-none" />
            </Field>
          </div>
        </div>

        {/* planned time */}
        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
          {orderMode === "pickup" ? (
            <Field label="Geplant (optional / wenn geschlossen: erforderlich)">
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2 text-sm">
                  <Toggle checked={mustPlanNow ? true : planned.enabledPickup} onChange={(v) => enablePlanned(v)}
                          label="Geplante Abholzeit (heute)" disabled={mustPlanNow} />
                  <span>Geplante Abholzeit (heute){mustPlanNow ? " – aktuell geschlossen" : ""}</span>
                </div>
                <select disabled={!plannedEnabledVirtual} value={planned.timePickup}
                        onChange={(e) => setPlanned((p) => ({ ...p, timePickup: e.target.value }))}
                        className={`rounded-md bg-stone-800/60 p-2 outline-none ${!plannedEnabledVirtual ? "opacity-50" : ""}`}>
                  <option value="" disabled>Zeit wählen</option>
                  {slotOptions.map((t) => (<option key={t} value={t}>{t}</option>))}
                </select>
              </div>
            </Field>
          ) : (
            <Field label="Geplant (optional / wenn geschlossen: erforderlich)">
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2 text-sm">
                  <Toggle checked={mustPlanNow ? true : planned.enabledDelivery} onChange={(v) => enablePlanned(v)}
                          label="Geplante Lieferzeit (heute)" disabled={mustPlanNow} />
                  <span>Geplante Lieferzeit (heute){mustPlanNow ? " – aktuell geschlossen" : ""}</span>
                </div>
                <select disabled={!plannedEnabledVirtual} value={planned.timeDelivery}
                        onChange={(e) => setPlanned((p) => ({ ...p, timeDelivery: e.target.value }))}
                        className={`rounded-md bg-stone-800/60 p-2 outline-none ${!plannedEnabledVirtual ? "opacity-50" : ""}`}>
                  <option value="" disabled>Zeit wählen</option>
                  {slotOptions.map((t) => (<option key={t} value={t}>{t}</option>))}
                </select>
              </div>
            </Field>
          )}

          <button
            type="button"
            onClick={async (e) => {
              if (!ensureValidPlanned()) { e.preventDefault(); e.stopPropagation(); return; }
              if (disableSend) { e.preventDefault(); return; }
              try {
                setSubmitBusy(true);
                const res = await handleLogBeforeNavigate(); // returns {id, etaMin}
                const avgPickup = toNum(settingsRaw?.hours?.avgPickupMinutes, 15);
                const avgDelivery = toNum(settingsRaw?.hours?.avgDeliveryMinutes, 35);
                const etaMin = res?.etaMin ?? (orderMode === "pickup" ? avgPickup : avgDelivery);
                const id = res?.id || String(Date.now());
                setConfirm({ id, etaMin });
                setSubmitted(true);
                setShowConfirm(true);
              } catch (err) {
                console.error(err);
                alert("Es ist ein Fehler aufgetreten. Bitte erneut versuchen.");
              } finally {
                setSubmitBusy(false);
              }
            }}
            className={`card-cta card-cta--lg ${disableSend || submitBusy || submitted ? "pointer-events-none opacity-50" : ""}`}
            title={disableSend ? "Bitte Pflichtfelder/PLZ/Minimalbetrag/Zeit prüfen" : "Bestellung senden"}
            disabled={disableSend || submitBusy || submitted}
          >
            {t('checkout.place_order')}
          </button>

          <button
            onClick={() => clear()}
            className="rounded-full border border-stone-700/60 bg-stone-800/60 px-5 py-2.5 font-semibold"
          >
            Warenkorb leeren
          </button>
        </div>
      </div>

      {/* Tracking (nur EIN kutu – alttaki, vurgulu) */}
      <TrackPanel variant="emphasized" />

      {/* Small confirmation banner (when modal closed) */}
      {confirm && submitted && !showConfirm && (
        <div className="rounded-md border border-emerald-500/40 bg-emerald-500/10 p-3 text-emerald-200 text-sm">
          <div className="font-medium">Ihre Bestellung ist eingegangen ✅</div>
          <div>Bestellnummer: <b>#{confirm.id}</b></div>
          <div>
            {orderMode === "pickup"
              ? <>Vorbereitungszeit: <b>{confirm.etaMin ?? 15} Min</b></>
              : <>Voraussichtliche Lieferung: <b>{confirm.etaMin ?? 35} Min</b></>}
          </div>
        </div>
      )}

      {/* Confirmation MODAL */}
      {showConfirm && confirm && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4 pt-[max(1rem,env(safe-area-inset-top))]"
          onKeyDown={(e) => { if (e.key === "Escape") setShowConfirm(false); }}
        >
          <div className="w-full max-w-md rounded-2xl border border-stone-700/60 bg-stone-900/95 p-5 shadow-xl">
            <div className="mb-2 text-lg font-semibold">Bestellbestätigung</div>
            <div className="space-y-2 text-sm text-stone-200">
              <div>Bestellnummer: <b>#{confirm.id}</b></div>
              <div>
                {orderMode === "pickup"
                  ? <>Vorbereitungszeit: <b>{confirm.etaMin ?? 15} Min</b></>
                  : <>Voraussichtliche Lieferung: <b>{confirm.etaMin ?? 35} Min</b></>}
              </div>
              <div className="text-stone-400">
                Bitte notieren Sie diese Nummer.
              </div>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <button
                type="button"
                className="rounded-full border border-stone-700/60 bg-stone-800/60 px-4 py-2 text-sm"
                onClick={async () => {
                  try {
                    // ✅ sadece sipariş numarası (başta # varsa da temizler)
                    const id = String(confirm?.id ?? "").replace(/^#/, "");
                    if (!id) { alert("Keine Bestellnummer gefunden."); return; }
                    await navigator.clipboard.writeText(id);
                    alert("Bestellnummer wurde kopiert.");
                  } catch {}
                }}
              >
                Kopieren
              </button>
              <button
                type="button"
                className="card-cta"
                onClick={() => {
                  try { clear(); } catch {}
                  setShowConfirm(false);
                  try { window.location.href = "/menu"; } catch {}
                }}
              >
                OK • Zurück zum Menü
              </button>
              <button
                type="button"
                className="btn-ghost ml-auto"
                onClick={() => setShowConfirm(false)}
              >
                Schließen
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Drawer (mobile-friendly, scrollable) */}
      {drawer && (
        <div className="fixed inset-x-0 bottom-0 z-50 bg-stone-950/95 border-t border-stone-700/60">
          {/* container is column; list scrolls; footer fixed */}
          <div className="mx-auto max-w-5xl p-4 max-h-[80svh] flex flex-col">
            <div className="mb-2 flex items-center justify-between">
              <div className="text-lg font-medium">
                {drawer === "drink" && "Getränke"}
                {drawer === "donut" && "Donuts"}
                {drawer === "sauce" && "Soßen"}
              </div>
              <button className="btn-ghost" onClick={() => setDrawer(null)}>Schließen</button>
            </div>

            {drawerList.length === 0 ? (
              <div className="text-sm text-stone-400 flex-1 overflow-y-auto">
                Kein Artikel gefunden.
                <div className="text-xs opacity-70 mt-1">
                  (Hinweis: Artikel-Kategorie/Tag „Getränke/Drinks/Soßen/Donuts“ ve opsiyonel “variants/options/choices”.)
                </div>
              </div>
            ) : (
              <div
                className="grid grid-cols-1 gap-3 sm:grid-cols-2 flex-1 overflow-y-auto overscroll-contain [WebkitOverflowScrolling:touch]"
              >
                {drawerList.map((it) => (
                  <div key={it.id || it.sku || it.name} className="rounded-md border border-stone-700/60 p-3">
                    <div className="mb-2 font-medium">{it.name}</div>
                    {it.variants?.length ? (
                      <div className="space-y-2">
                        {it.variants.map((v) => {
                          const key = `${it.id || it.sku}-${v.id}`;
                          const q = drawerSel[key] || 0;
                          return (
                            <div key={key} className="flex items-center justify-between gap-3">
                              <div className="text-sm">{v.name}</div>
                              <div className="flex items-center gap-3">
                                <div className="text-sm opacity-80">{fmt(v.price)}</div>
                                <div className="flex items-center gap-2">
                                  <button className="btn-ghost" onClick={() => setDrawerSel((s) => ({ ...s, [key]: Math.max(0, (s[key] || 0) - 1) }))}>−</button>
                                  <div className="w-6 text-center">{q}</div>
                                  <button className="btn-ghost" onClick={() => setDrawerSel((s) => ({ ...s, [key]: (s[key] || 0) + 1 }))}>+</button>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="flex items-center justify-between">
                        <div className="text-sm opacity-80">{fmt(it.price || 0)}</div>
                        <div className="flex items-center gap-2">
                          <button
                            className="btn-ghost"
                            onClick={() =>
                              setDrawerSel((s) => {
                                const k = String(it.id || it.sku || it.name);
                                return { ...s, [k]: Math.max(0, (s[k] || 0) - 1) };
                              })
                            }
                          >
                            −
                          </button>
                          <div className="w-6 text-center">
                            {drawerSel[String(it.id || it.sku || it.name)] || 0}
                          </div>
                          <button
                            className="btn-ghost"
                            onClick={() =>
                              setDrawerSel((s) => {
                                const k = String(it.id || it.sku || it.name);
                                return { ...s, [k]: (s[k] || 0) + 1 };
                              })
                            }
                          >
                            +
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            <div className="mt-4 flex items-center justify-end gap-2 pt-2 border-t border-stone-800/60">
              <button className="btn-ghost" onClick={() => setDrawer(null)}>Abbrechen</button>
              <button className="card-cta" disabled={drawerCount === 0} onClick={applyDrawer}>
                Hinzufügen ({drawerCount}) • {fmt(drawerSum)}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );

  /* ───────── logging helpers ───────── */

  function mapCartToOrderItems() {
    return (items || []).map((ci: any) => {
      const addSum = (Array.isArray(ci?.add) ? ci.add : []).reduce(
        (a: number, b: any) => a + toNum(b?.price, 0), 0
      ) || 0;
      return {
        id: ci?.item?.id || ci?.id,
        sku: ci?.item?.id || ci?.id,
        name: ci?.item?.name || "Artikel",
        category: ci?.item?.category || undefined,
        price: toNum(ci?.item?.price, 0) + addSum,
        qty: toNum(ci?.qty, 1),
        add: Array.isArray(ci?.add)
          ? ci.add.map((a: any) => ({ label: a?.label || a?.name, name: a?.name, price: toNum(a?.price, 0) }))
          : undefined,
        note: (ci?.note != null ? String(ci.note) : undefined),
        rm: Array.isArray(ci?.rm) ? ci.rm : undefined,
      };
    });
  }

  function upsertCustomerLS(totalPaid: number, ts: number) {
    try {
      const raw = localStorage.getItem(LS_CUSTOMERS);
      const arr = raw ? (JSON.parse(raw) as any[]) : [];
      const list: any[] = Array.isArray(arr) ? arr : [];
      let found = list.find((c) => (c.phone && c.phone === addr.phone) || (!addr.phone && c.name === addr.name));
      if (!found) {
        found = {
          id: rid(),
          name: addr.name,
          phone: addr.phone || undefined,
          plz: addr.zip || undefined,
          address: [addr.street, addr.house, addr.zip, addr.city].filter(Boolean).join(" "),
          notes: addr.note || undefined,
          vip: false,
          blocked: false,
          createdAt: ts,
          lastOrderAt: ts,
          stats: { orders: 1, totalSpent: totalPaid },
        };
        list.unshift(found);
      } else {
        found.name = addr.name || found.name;
        found.phone = addr.phone || found.phone;
        found.plz = addr.zip || found.plz;
        found.address = [addr.street, addr.house, addr.zip, addr.city].filter(Boolean).join(" ") || found.address;
        found.notes = addr.note || found.notes;
        found.lastOrderAt = ts;
        const orders = (found.stats?.orders || 0) + 1;
        const totalSpent = (found.stats?.totalSpent || 0) + totalPaid;
        found.stats = { orders, totalSpent };
      }
      localStorage.setItem(LS_CUSTOMERS, JSON.stringify(list));
    } catch {}
  }

  function appendOrderLS(order: any) {
    try {
      const raw = localStorage.getItem(LS_ORDERS);
      const arr = raw ? (JSON.parse(raw) as any[]) : [];
      const list: any[] = Array.isArray(arr) ? arr : [];
      list.push(order);
      localStorage.setItem(LS_ORDERS, JSON.stringify(list));
    } catch {}
  }

  async function handleLogBeforeNavigate() {
    const ts = Date.now();

    // Kanalı mode’dan türet (Dashboard iki sütun için şart)
    const channel = (orderMode === "pickup" ? "abholung" : "lieferung");

    // FINAL STREET (input/öneri farketmez)
    const streetFinal = (addr.street || streetQuery || "").trim();

    // Sipariş payload (id’yi API’den aldıktan sonra kaydedeceğiz)
    const orderBase = {
  ts,
  mode: orderMode,
  channel,
  plz: orderMode === "delivery" ? (addr.zip || null) : null,
  items: mapCartToOrderItems(),
  merchandise,
  discount,
  surcharges,
  total: totalFinal,
  coupon: (activeCode || undefined),
  couponDiscount: couponAmount || 0,

  // 🔹 Checkout notunu köke yaz: TV/print tarafından kolay okunur
  orderNote: (addr.note || "").trim() ? (addr.note || "").trim() : undefined,

  customer: {
    name: addr.name,
    phone: addr.phone,

    // 🔹 Delivery ise notu ayrıca customer.deliveryHint olarak da sakla
    ...(orderMode === "delivery"
      ? { deliveryHint: (addr.note || "").trim() || undefined }
      : {}),

    address:
      orderMode === "delivery"
        ? [
            `${streetFinal} ${addr.house}`.trim(),
            `${addr.zip} ${addr.city}`.trim(),
            [addr.floor, addr.entrance].filter(Boolean).join(" • "),
          ]
            .filter(Boolean)
            .join(" | ")
        : addr.note || undefined,
  },

  planned:
    orderMode === "pickup"
      ? (planned.enabledPickup && planned.timePickup) ? planned.timePickup : undefined
      : (planned.enabledDelivery && planned.timeDelivery) ? planned.timeDelivery : undefined,
};

    try {
      // pass Telegram settings along (server also reads its own settings/env)
      const notifyCfg = {
        telegram: {
          botToken: telegramFromSettings.botToken,
          chatId: telegramFromSettings.chatId,
        },
      };

      const res = await fetch("/api/orders/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order: orderBase, notify: true, notifyConfig: notifyCfg }),
        keepalive: true,
      });

      const created = await res.json().catch(() => ({} as any));
      const id = created?.id || String(Date.now());
      const etaMin = created?.etaMin;

      appendOrderLS({ id, etaMin, ...orderBase });
      upsertCustomerLS(orderBase.total, ts);

      return { id, etaMin };
    } catch {
      const id = String(Date.now());
      appendOrderLS({ id, ...orderBase });
      upsertCustomerLS(orderBase.total, ts);
      return { id, etaMin: orderMode === "pickup" ? 15 : 35 };
    }
  }
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block text-stone-300/80">{label}</span>
      {children}
    </label>
  );
}
