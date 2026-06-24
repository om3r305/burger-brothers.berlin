// app/checkout/page.tsx
"use client";

import Link from "next/link";
import TrackPanel from "@/components/ui/TrackPanel";
import CouponBox from "@/components/CouponBox";
import { useEffect, useMemo, useState, useLayoutEffect, useRef } from "react";
import { t } from "@/lib/i18n";

import { useCart } from "@/components/store";
import {
  LS_SETTINGS,
  readSettings,
  getPricingOverrides,
  fetchAndApplyRemoteSettings,
} from "@/lib/settings";
import {
  planFromSettings,
  isOpenAt,
  buildSlotsForDate,
  validatePlannedTime,
  nowInTZ,
} from "@/lib/availability";

import { getStreets, searchStreets } from "@/lib/streets";
import * as Coupons from "@/lib/coupons";

import {
  type PauseState,
  isModePaused,
  onPauseChange,
  syncPauseFromServer,
} from "@/lib/pause";

/* ───────── helpers ───────── */

const fmt = (n: number) =>
  new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: "EUR",
  }).format(n);

type Mode = "pickup" | "delivery";

type Address = {
  name: string;
  phone: string;
  email?: string;
  emailOptIn?: boolean;
  street: string;
  house: string;
  zip: string;
  city: string;
  floor?: string;
  entrance?: string;
  note?: string;
};

type Planned = {
  enabledPickup: boolean;
  timePickup: string;
  enabledDelivery: boolean;
  timeDelivery: string;
};

type PaymentMethod = "cash" | "online";
type TipChoice = "none" | "1" | "2" | "3" | "custom";

type FreebieTier = {
  minTotal: number;
  freeSauces: number;
};

type FreebiesCfg = {
  enabled?: boolean;
  tiers?: FreebieTier[];
  mode?: "pickup" | "delivery" | "both";
} | null;

type Variant = {
  id: string;
  name: string;
  price: number;
  active?: boolean;
};

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
const LS_DRINK_GROUPS = "bb_drink_groups_v1";
const LS_ACTIVE_COUPON = "bb_active_coupon_code";
const LS_ACTIVE_COUPON_META = "bb_active_coupon_meta";
const LS_PRODUCTS = "bb_products_v1";
const PROFILE_KEY = "bb_checkout_profile_v2";

const pad2 = (n: number) => (n < 10 ? `0${n}` : String(n));

const normCode = (s: string) =>
  s
    .replace(/[\s\u00A0\u2000-\u200B\u202F\u205F\u3000\uFEFF]/g, "")
    .trim()
    .toLowerCase();

function hhmmInTZ(d: Date, tz: string) {
  return new Intl.DateTimeFormat("de-DE", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
}

function todayAt(hhmm: string, tz: string) {
  const [h, m] = (hhmm || "").split(":").map((x) => parseInt(x, 10));
  const base = nowInTZ(tz);
  const y = base.getFullYear();
  const mo = base.getMonth();
  const da = base.getDate();
  const iso = `${y}-${pad2(mo + 1)}-${pad2(da)}T${pad2(h || 0)}:${pad2(
    m || 0,
  )}:00`;

  return new Date(new Date(`${iso} GMT`).toLocaleString("en-US", { timeZone: tz }));
}

function getMinTotal(tier: any) {
  return Number(tier?.minTotal ?? tier?.MinTotal ?? tier?.["Min.Total"] ?? 0);
}

function calcFreeSauces(merchandise: number, tiers?: FreebieTier[]) {
  if (!tiers?.length) return 0;

  const sorted = tiers
    .slice()
    .sort((a: any, b: any) => getMinTotal(a) - getMinTotal(b));

  let free = 0;

  for (const tier of sorted) {
    if (merchandise >= getMinTotal(tier)) {
      free = Number((tier as any).freeSauces ?? 0);
    }
  }

  return free;
}

function Toggle({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
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

const toNum = (value: any, fallback = 0) => {
  const n = Number(String(value ?? "").replace(",", "."));
  return Number.isFinite(n) ? n : fallback;
};

const normName = (value: string) =>
  value ? value.charAt(0).toLocaleUpperCase("de-DE") + value.slice(1) : value;

function safeJsonParse(value: string | null) {
  if (!value) return null;

  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

/* ───────── catalog ───────── */

function collectCatalog(): FlatItem[] {
  const out: FlatItem[] = [];

  const safeArray = (value: any) => (Array.isArray(value) ? value : []);

  const readPrice = (obj: any) => {
    const candidate = [obj?.price, obj?.amount, obj?.preis, obj?.value].find((x) =>
      Number.isFinite(Number(x)),
    );

    return Number(candidate ?? 0);
  };

  const readName = (obj: any) =>
    String(obj?.name ?? obj?.label ?? obj?.title ?? obj?.sku ?? "Artikel");

  const isAvailable = (obj: any) => {
    if (obj?.active === false) return false;

    const now = Date.now();
    const from = obj?.activeFrom ?? obj?.startAt;
    const to = obj?.activeTo ?? obj?.endAt;

    const fromMs = from ? Date.parse(from) : NaN;
    const toMs = to ? Date.parse(to) : NaN;

    if (Number.isFinite(fromMs) && now < fromMs) return false;
    if (Number.isFinite(toMs) && now > toMs) return false;

    return true;
  };

  const pushProduct = (obj: any, category?: string) => {
    if (!isAvailable(obj)) return;

    out.push({
      id: obj?.id || obj?._id || obj?.sku,
      sku: obj?.sku,
      name: readName(obj),
      price: readPrice(obj),
      category: category ?? obj?.category,
      tags: safeArray(obj?.tags),
    });
  };

  const pushGroupWithVariants = (obj: any, category?: string) => {
    if (!isAvailable(obj)) return;

    const pools = [obj?.variants, obj?.options, obj?.choices, obj?.items, obj?.children];

    const variants: Variant[] = pools
      .flatMap((pool) =>
        safeArray(pool).map((v: any) => ({
          id: v?.id || v?._id || v?.sku || v?.name,
          name: readName(v),
          price: readPrice(v),
          active: v?.active !== false,
        })),
      )
      .filter((variant) => variant.active !== false);

    if (variants.length) {
      out.push({
        id: obj?.id || obj?._id || obj?.sku,
        sku: obj?.sku,
        name: readName(obj),
        category: category ?? obj?.category,
        tags: safeArray(obj?.tags),
        variants,
      });
    }
  };

  try {
    const arr = safeJsonParse(localStorage.getItem(LS_DRINK_GROUPS)) || [];

    if (Array.isArray(arr)) {
      for (const groupRaw of arr) {
        const group = {
          id: groupRaw?.id || groupRaw?._id || groupRaw?.sku,
          sku: groupRaw?.sku,
          name: readName(groupRaw),
          category: "drinks",
          variants: (Array.isArray(groupRaw?.variants) ? groupRaw.variants : []).map(
            (variant: any) => ({
              id: variant?.id || variant?.name,
              name: readName(variant),
              price: readPrice(variant),
              active: variant?.active !== false,
            }),
          ),
        };

        if ((group as any).variants?.length) {
          out.push(group as FlatItem);
        }
      }
    }
  } catch {}

  try {
    const maybe = (globalThis as any)?.siteConfig?.menu;

    if (maybe) {
      const walk = (node: any, category?: string) => {
        if (!node || typeof node !== "object") return;

        if (Array.isArray(node)) {
          node.forEach((item) => walk(item, category));
          return;
        }

        const nextCategory =
          node?.category ||
          node?.cat ||
          (typeof node?.name === "string" ? node.name : category) ||
          category;

        const hasVariants =
          (Array.isArray(node?.variants) && node.variants.length > 0) ||
          (Array.isArray(node?.options) && node.options.length > 0) ||
          (Array.isArray(node?.choices) && node.choices.length > 0);

        const looksLikeProduct =
          typeof node?.name === "string" ||
          typeof node?.title === "string" ||
          typeof node?.label === "string";

        if (looksLikeProduct) {
          if (hasVariants) {
            pushGroupWithVariants(node, nextCategory);
          } else if (node?.price != null || node?.amount != null || node?.preis != null) {
            pushProduct(node, nextCategory);
          }
        }

        for (const branch of [
          node?.children,
          node?.items,
          node?.groups,
          node?.sections,
          node?.list,
          node?.data,
        ]) {
          if (branch) walk(branch, nextCategory);
        }
      };

      walk(maybe, undefined);
    }
  } catch {}

  try {
    const arr = safeJsonParse(localStorage.getItem(LS_PRODUCTS)) || [];

    if (Array.isArray(arr)) {
      for (const product of arr) {
        const hasVariants =
          (Array.isArray(product?.variants) && product.variants.length > 0) ||
          (Array.isArray(product?.options) && product.options.length > 0) ||
          (Array.isArray(product?.choices) && product.choices.length > 0);

        if (hasVariants) {
          pushGroupWithVariants(product, product?.category);
        } else {
          pushProduct(product, product?.category);
        }
      }
    }
  } catch {}

  return out.filter(Boolean);
}

function catKey(name?: string) {
  const text = (name || "").toLowerCase();

  if (!text) return "";
  if (text.includes("burger")) return "burger";
  if (
    text.includes("drink") ||
    text.includes("getränk") ||
    text.includes("getraenk") ||
    text.includes("cola") ||
    text.includes("wasser") ||
    text.includes("fritz")
  ) {
    return "drinks";
  }
  if (
    text.includes("sauce") ||
    text.includes("soße") ||
    text.includes("soßen") ||
    text.includes("sossen") ||
    text.includes("sos") ||
    text.includes("ketchup") ||
    text.includes("mayo")
  ) {
    return "sauces";
  }
  if (text.includes("donut") || text.includes("dessert")) return "donuts";
  if (text.includes("hotdog")) return "hotdogs";
  if (text.includes("vegan")) return "vegan";
  if (text.includes("bubble")) return "bubbleTea";
  if (text.includes("extra")) return "extras";

  return text;
}

function pickByCategory(catalog: FlatItem[], type: "drink" | "donut" | "sauce") {
  const key = type === "drink" ? "drinks" : type === "donut" ? "donuts" : "sauces";
  return catalog.filter((item) => catKey(item.category || item.name) === key);
}

function sumCartMerchandise(items: any[]) {
  let sum = 0;

  for (const ci of items) {
    const base = toNum(ci?.item?.price, 0);
    const addSum = (Array.isArray(ci?.add) ? ci.add : []).reduce(
      (total: number, extra: any) => total + toNum(extra?.price, 0),
      0,
    );

    sum += (base + addSum) * toNum(ci?.qty, 1);
  }

  return +sum.toFixed(2);
}

function computePricingV6(items: any[], mode: Mode, plz: string | null | undefined) {
  const overrides = getPricingOverrides(mode);
  const rate = toNum(overrides.discountRate, 0);

  const merchandise = sumCartMerchandise(items);
  const discount = +(merchandise * rate).toFixed(2);
  const afterDiscount = +(merchandise - discount).toFixed(2);

  const plzMap = overrides.plzMin || {};
  const code = (plz || "").replace(/[^\d]/g, "").slice(0, 5);
  const requiredMin =
    typeof plzMap[code] === "number" ? toNum(plzMap[code], 0) : null;
  const plzKnown = requiredMin != null;

  let surcharges = 0;

  if (mode === "delivery" && overrides.surcharges) {
    for (const ci of items) {
      const key = catKey(ci?.item?.category || ci?.item?.name || "");
      const surcharge = toNum((overrides.surcharges as any)[key], 0);

      if (surcharge > 0) {
        surcharges += surcharge * toNum(ci?.qty, 1);
      }
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
    freebiesCfg: overrides.freebies,
  };
}

/* ───────── coupon helpers ───────── */

function mapCartToCouponItems(items: any[]): Coupons.CartItemForCoupon[] {
  return (items || []).map((ci: any) => {
    const addSum = (Array.isArray(ci?.add) ? ci.add : []).reduce(
      (total: number, extra: any) => total + toNum(extra?.price, 0),
      0,
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
  customerPhone?: string | null,
): { amount: number; message: string; code?: string; error?: string } {
  if (!code) return { amount: 0, message: "" };

  const codeUp = code.trim();
  if (!codeUp) return { amount: 0, message: "" };

  const found = Coupons.findCouponByAnyCode(codeUp);
  const def = found.def;
  const issued = found.issued;

  if (!def) {
    return {
      amount: 0,
      message: "",
      code: codeUp,
      error: "Ungültiger Gutschein",
    };
  }

  const check = Coupons.canApply({
    def,
    issued: issued || undefined,
    cartTotal: Math.max(0, cartAfterOverride),
    cartItems: mapCartToCouponItems(items),
    customerPhone: customerPhone || undefined,
  });

  if (!check.ok) {
    return {
      amount: 0,
      message: "",
      code: codeUp,
      error: check.message || "Gutschein nicht anwendbar",
    };
  }

  return {
    amount: +check.discountAmount.toFixed(2),
    message: check.message,
    code: codeUp,
  };
}

/* ───────── component ───────── */

export default function CheckoutPage() {
  const add = useCart((state: any) =>
    state.add ?? state.addItem ?? state.addCartItem ?? state.addToCart ?? state.push,
  ) as ((ci: any) => void) | undefined;

  const items = useCart((state: any) => state.items);
  const clear = useCart((state: any) => state.clear);
  const orderMode: Mode = useCart((state: any) => state.orderMode);
  const setOrderMode = useCart((state: any) => state.setOrderMode);
  const plzStore = useCart((state: any) => state.plz);
  const setPLZ = useCart((state: any) => state.setPLZ);

  const [pause, setPause] = useState<PauseState>({
    delivery: false,
    pickup: false,
  });

  useEffect(() => {
    let active = true;

    (async () => {
      try {
        const state = await syncPauseFromServer();
        if (active && state) setPause(state);
      } catch {}
    })();

    const unsubscribe = onPauseChange((state) => {
      if (active) setPause(state);
    });

    return () => {
      active = false;
      unsubscribe?.();
    };
  }, []);

  const [cfgTick, setCfgTick] = useState(0);

  useEffect(() => {
    let stop = false;

    const refreshRemoteSettings = async () => {
      try {
        await fetchAndApplyRemoteSettings();
        if (!stop) setCfgTick((tick) => tick + 1);
      } catch {
        if (!stop) setCfgTick((tick) => tick + 1);
      }
    };

    refreshRemoteSettings();

    const onStorage = (event: StorageEvent) => {
      if (!event.key || event.key === LS_SETTINGS) {
        setCfgTick((tick) => tick + 1);
      }
    };

    const onFocus = () => {
      refreshRemoteSettings();
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        refreshRemoteSettings();
      }
    };

    const onSettingsSync = () => {
      setCfgTick((tick) => tick + 1);
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

  const settingsRaw = useMemo(() => readSettings() as any, [cfgTick]);

  const avgPickupMinutes = Math.max(
    1,
    toNum(settingsRaw?.hours?.avgPickupMinutes, 15),
  );
  const avgDeliveryMinutes = Math.max(
    1,
    toNum(settingsRaw?.hours?.avgDeliveryMinutes, 35),
  );

  const planCfg = useMemo(() => {
    const cfg = planFromSettings(settingsRaw?.hours);
    cfg.daysAhead = toNum(settingsRaw?.hours?.daysAhead, 0);
    return cfg;
  }, [settingsRaw]);

  const phoneDigits = toNum(settingsRaw?.validation?.phoneDigits, 11) || 11;

  const freebiesFromOverrides = getPricingOverrides(orderMode)?.freebies as FreebiesCfg;

  const [addr, setAddr] = useState<Address>({
    name: "",
    phone: "",
    email: "",
    emailOptIn: false,
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

  const mustPlanNow = !isOpenAt(
    orderMode,
    nowInTZ(planCfg.tz),
    planCfg.plan,
    planCfg.tz,
  ).open;

  const buildSlotConfig = () => ({
    plan: planCfg.plan,
    tz: planCfg.tz,
    slotMinutes: planCfg.slotMinutes,
    leadPickupMin: avgPickupMinutes,
    leadDeliveryMin: avgDeliveryMinutes,
    lastOrderBufferMin: 15,
    allowPreorder: settingsRaw?.hours?.allowPreorder !== false,
    daysAhead: planCfg.daysAhead ?? 0,
  });

  useLayoutEffect(() => {
    if (!mustPlanNow) return;

    const today = nowInTZ(planCfg.tz);
    const first = buildSlotsForDate(orderMode, today, buildSlotConfig())[0];
    const hhmm = first ? hhmmInTZ(first, planCfg.tz) : "";

    setPlanned((current) =>
      orderMode === "pickup"
        ? {
            ...current,
            enabledPickup: true,
            timePickup: current.timePickup || hhmm,
          }
        : {
            ...current,
            enabledDelivery: true,
            timeDelivery: current.timeDelivery || hhmm,
          },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    mustPlanNow,
    orderMode,
    planCfg.plan,
    planCfg.tz,
    planCfg.slotMinutes,
    avgPickupMinutes,
    avgDeliveryMinutes,
  ]);

  const slotOptions: string[] = useMemo(() => {
    const today = nowInTZ(planCfg.tz);
    const list = buildSlotsForDate(orderMode, today, buildSlotConfig());
    return list.map((date) => hhmmInTZ(date, planCfg.tz));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    orderMode,
    planCfg.plan,
    planCfg.tz,
    planCfg.slotMinutes,
    planCfg.daysAhead,
    avgPickupMinutes,
    avgDeliveryMinutes,
    cfgTick,
  ]);

  useEffect(() => {
    if (!mustPlanNow || slotOptions.length === 0) return;

    const first = slotOptions[0];

    setPlanned((current) =>
      orderMode === "pickup"
        ? {
            ...current,
            enabledPickup: true,
            timePickup: current.timePickup || first,
          }
        : {
            ...current,
            enabledDelivery: true,
            timeDelivery: current.timeDelivery || first,
          },
    );
  }, [mustPlanNow, slotOptions, orderMode]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_CHECKOUT);
      if (!raw) return;

      const saved = JSON.parse(raw) as {
        addr?: Address;
        planned?: Planned;
        orderMode?: Mode;
      };

      const savedAddr = saved?.addr ?? null;

      if (savedAddr) {
        setAddr((current) => ({
          ...current,
          ...(savedAddr ?? {}),
          zip: savedAddr?.zip ?? plzStore ?? "",
          email: savedAddr?.email ?? "",
          emailOptIn: Boolean(savedAddr?.emailOptIn ?? current.emailOptIn),
        }));
      }

      if (saved?.planned) {
        setPlanned({
          enabledPickup: !!saved.planned?.enabledPickup,
          timePickup: saved.planned?.timePickup || "",
          enabledDelivery: !!saved.planned?.enabledDelivery,
          timeDelivery: saved.planned?.timeDelivery || "",
        });
      }

      if (saved?.orderMode === "pickup" || saved?.orderMode === "delivery") {
        setOrderMode(saved.orderMode);
      }
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(`${PROFILE_KEY}:${orderMode}`);
      if (!raw) return;

      const profile = JSON.parse(raw) as Partial<Address>;

      setAddr((current) => ({
        ...current,
        ...profile,
        zip: profile?.zip ?? current.zip,
        email: profile?.email ?? current.email,
        emailOptIn: Boolean(profile?.emailOptIn ?? current.emailOptIn),
      }));
    } catch {}
  }, [orderMode]);

  useEffect(() => {
    try {
      localStorage.setItem(
        LS_CHECKOUT,
        JSON.stringify({
          addr,
          planned,
          orderMode,
        }),
      );
    } catch {}
  }, [addr, planned, orderMode]);

  const profileTimer = useRef<number | null>(null);
  const [streetOptions, setStreetOptions] = useState<string[]>([]);
  const [streetQuery, setStreetQuery] = useState("");
  const [showSug, setShowSug] = useState(false);

  useEffect(() => {
    if (profileTimer.current) {
      window.clearTimeout(profileTimer.current);
    }

    profileTimer.current = window.setTimeout(() => {
      try {
        const toSave: Partial<Address> = {
          name: addr.name,
          phone: addr.phone,
          email: addr.email,
          emailOptIn: Boolean(addr.emailOptIn),
          street: (addr.street || streetQuery || "").trim(),
          house: addr.house,
          zip: addr.zip,
          city: addr.city,
          floor: addr.floor,
          entrance: addr.entrance,
          note: addr.note,
        };

        localStorage.setItem(`${PROFILE_KEY}:${orderMode}`, JSON.stringify(toSave));
      } catch {}
    }, 400);

    return () => {
      if (profileTimer.current) {
        window.clearTimeout(profileTimer.current);
      }
    };
  }, [orderMode, addr, streetQuery]);

  const base = useMemo(
    () => computePricingV6(items, orderMode, addr.zip || plzStore),
    [items, orderMode, addr.zip, plzStore, cfgTick],
  );

  const {
    merchandise,
    discount,
    afterDiscount,
    surcharges,
    requiredMin,
    plzKnown,
  } = base;

  const [lsTick, setLsTick] = useState(0);
  const [submitBusy, setSubmitBusy] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [confirm, setConfirm] = useState<{ id?: string; etaMin?: number } | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);

  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cash");
  const [tipChoice, setTipChoice] = useState<TipChoice>("none");
  const [customTip, setCustomTip] = useState("");
  const [testPaymentOpen, setTestPaymentOpen] = useState(false);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (
        !event.key ||
        event.key === LS_ACTIVE_COUPON ||
        event.key === LS_ACTIVE_COUPON_META ||
        event.key === LS_CHECKOUT
      ) {
        setLsTick((tick) => tick + 1);
      }
    };

    const onCouponEvent = () => {
      setLsTick((tick) => tick + 1);
    };

    window.addEventListener("storage", onStorage);
    window.addEventListener("bb_coupon_changed", onCouponEvent as EventListener);
    window.addEventListener("bb:coupon-sync", onCouponEvent as EventListener);
    window.addEventListener("bb:coupon-changed", onCouponEvent as EventListener);

    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("bb_coupon_changed", onCouponEvent as EventListener);
      window.removeEventListener("bb:coupon-sync", onCouponEvent as EventListener);
      window.removeEventListener("bb:coupon-changed", onCouponEvent as EventListener);
    };
  }, []);

  const activeCode = useMemo(() => {
    try {
      return (localStorage.getItem(LS_ACTIVE_COUPON) || "").trim();
    } catch {
      return "";
    }
  }, [lsTick, items.length]);

  const couponItems = useMemo(() => mapCartToCouponItems(items), [items]);

  const coupon = useMemo(
    () =>
      computeCouponDiscount(
        activeCode,
        items,
        afterDiscount,
        (addr.phone || "").replace(/\D/g, "") || null,
      ),
    [activeCode, items, afterDiscount, addr.phone],
  );

  const couponAmount = Math.min(afterDiscount, Math.max(0, coupon.amount || 0));
  const totalFinal = +((afterDiscount - couponAmount) + surcharges).toFixed(2);

  const tipAmount = useMemo(() => {
    if (tipChoice === "none") return 0;
    if (tipChoice === "custom") {
      return +Math.max(0, toNum(customTip, 0)).toFixed(2);
    }

    return +toNum(tipChoice, 0).toFixed(2);
  }, [tipChoice, customTip]);

  const payableTotal = +(totalFinal + tipAmount).toFixed(2);

  const meetsMin =
    orderMode === "pickup"
      ? true
      : plzKnown
        ? Math.round(totalFinal * 100) >= Math.round(toNum(requiredMin, 0) * 100)
        : false;

  const freebiesCfg: FreebiesCfg = freebiesFromOverrides ?? null;
  const freebiesEnabled =
    !!freebiesCfg?.enabled &&
    Array.isArray(freebiesCfg?.tiers) &&
    (freebiesCfg?.tiers?.length ?? 0) > 0;
  const freebiesModeOk =
    !freebiesCfg?.mode || freebiesCfg.mode === "both" || freebiesCfg.mode === orderMode;

  const freeSauces = useMemo(() => {
    if (!freebiesEnabled || !freebiesModeOk) return 0;
    return calcFreeSauces(merchandise, (freebiesCfg?.tiers ?? []) as FreebieTier[]);
  }, [freebiesEnabled, freebiesModeOk, merchandise, freebiesCfg?.tiers]);

  const modePaused = isModePaused(orderMode, pause);
  const pauseMessage = modePaused
    ? orderMode === "pickup"
      ? "Abholung ist vorübergehend pausiert. Online-Bestellungen sind aktuell nicht möglich."
      : "Lieferung ist vorübergehend pausiert. Online-Bestellungen sind aktuell nicht möglich."
    : "";

  const requiredOk =
    orderMode === "pickup"
      ? !!addr.name.trim() && !!addr.phone.trim()
      : !!addr.name.trim() &&
        !!addr.phone.trim() &&
        !!(addr.street || streetQuery).trim() &&
        !!addr.house.trim() &&
        !!addr.zip.trim();

  const emailValid =
    !addr.email || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addr.email.trim());

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
    addr.phone.replace(/\D/g, "").length !== phoneDigits ||
    modePaused;

  const filteredStreets = useMemo(
    () => searchStreets(addr.zip, streetQuery, 50),
    [addr.zip, streetQuery],
  );

  const onZipChange = (value: string, resetStreet = true) => {
    const only = value.replace(/[^\d]/g, "").slice(0, 5);

    setPLZ(only || null);

    const list = getStreets(only);
    setStreetOptions(list);

    setAddr((current) => ({
      ...current,
      zip: only,
      street: resetStreet ? "" : current.street,
    }));

    if (resetStreet) {
      setStreetQuery("");
    }
  };

  useEffect(() => {
    if (!addr.zip) return;

    const list = getStreets(addr.zip);
    setStreetOptions(list);

    if (!streetQuery && addr.street) {
      setStreetQuery(addr.street);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addr.zip]);

  const enablePlanned = (enable: boolean) => {
    const today = nowInTZ(planCfg.tz);
    const first = buildSlotsForDate(orderMode, today, buildSlotConfig())[0];
    const hhmm = first ? hhmmInTZ(first, planCfg.tz) : "";

    if (orderMode === "pickup") {
      setPlanned((current) => ({
        ...current,
        enabledPickup: enable,
        timePickup: enable ? current.timePickup || hhmm : "",
      }));
    } else {
      setPlanned((current) => ({
        ...current,
        enabledDelivery: enable,
        timeDelivery: enable ? current.timeDelivery || hhmm : "",
      }));
    }
  };

  const ensureValidPlanned = (): boolean => {
    if (!mustPlanNow) return true;

    const tz = planCfg.tz;
    const selectedHHMM = orderMode === "pickup" ? planned.timePickup : planned.timeDelivery;

    const candidate =
      plannedEnabledVirtual && selectedHHMM ? todayAt(selectedHHMM, tz) : nowInTZ(tz);

    const result = validatePlannedTime(orderMode, candidate, {
      plan: planCfg.plan,
      tz,
      leadPickupMin: avgPickupMinutes,
      leadDeliveryMin: avgDeliveryMinutes,
      lastOrderBufferMin: 15,
      siteClosed: false,
      allowPreorder: settingsRaw?.hours?.allowPreorder !== false,
      daysAhead: planCfg.daysAhead ?? 0,
    });

    if (result.ok) return true;

    if (result.suggest) {
      const hhmm = hhmmInTZ(result.suggest, tz);

      if (orderMode === "pickup") {
        setPlanned((current) => ({
          ...current,
          enabledPickup: true,
          timePickup: hhmm,
        }));
      } else {
        setPlanned((current) => ({
          ...current,
          enabledDelivery: true,
          timeDelivery: hhmm,
        }));
      }
    }

    return false;
  };

  const catalog = useMemo(() => collectCatalog(), [cfgTick]);

  const hasBurger = (items || []).some((ci: any) =>
    String(ci?.item?.category || "").toLowerCase().includes("burger"),
  );

  const hasPommes = (items || []).some((ci: any) =>
    ["pommes", "fries", "patates", "friet", "kartoffel"].some((key) =>
      String(ci?.item?.name || "").toLowerCase().includes(key),
    ),
  );

  const hasDrink = (items || []).some((ci: any) =>
    ["drink", "getränk", "cola", "fanta", "sprite", "wasser", "fritz"].some((key) =>
      (ci?.item?.category || ci?.item?.name || "").toLowerCase().includes(key),
    ),
  );

  const hasSauce = (items || []).some((ci: any) =>
    ["sauce", "soße", "soßen", "sos", "ketchup", "mayo"].some((key) =>
      (ci?.item?.category || ci?.item?.name || "").toLowerCase().includes(key),
    ),
  );

  const hasDonut = (items || []).some((ci: any) =>
    ["donut", "dessert", "süß", "suess"].some((key) =>
      (ci?.item?.category || ci?.item?.name || "").toLowerCase().includes(key),
    ),
  );

  let suggestion: "drink" | "donut" | "sauce" | null = null;

  if (hasBurger && hasPommes && !hasDrink) suggestion = "drink";
  else if (hasBurger && hasPommes && hasDrink && !hasDonut) suggestion = "donut";
  else if ((hasBurger || hasPommes) && hasDrink && !hasSauce) suggestion = "sauce";

  const [drawer, setDrawer] = useState<null | "drink" | "donut" | "sauce">(null);
  const drawerList: FlatItem[] = useMemo(
    () => (drawer ? pickByCategory(catalog, drawer) : []),
    [drawer, catalog],
  );

  const [drawerSel, setDrawerSel] = useState<Record<string, number>>({});

  useEffect(() => {
    setDrawerSel({});
  }, [drawer]);

  const drawerCount = Object.values(drawerSel).reduce(
    (total, value) => total + (value || 0),
    0,
  );

  const drawerSum = useMemo(() => {
    let sum = 0;

    for (const item of drawerList) {
      if (item.variants?.length) {
        for (const variant of item.variants) {
          const key = `${item.id || item.sku}-${variant.id}`;
          const qty = drawerSel[key] || 0;

          if (qty > 0) sum += variant.price * qty;
        }
      } else {
        const key = `${item.id || item.sku}`;
        const qty = drawerSel[key] || 0;

        if (qty > 0) sum += (item.price || 0) * qty;
      }
    }

    return sum;
  }, [drawerList, drawerSel]);

  const applyDrawer = () => {
    if (!add) return;

    for (const item of drawerList) {
      if (item.variants?.length) {
        for (const variant of item.variants) {
          const key = `${item.id || item.sku}-${variant.id}`;
          const qty = drawerSel[key] || 0;

          if (qty > 0) {
            add({
              id: key,
              item: {
                id: key,
                name: `${item.name} • ${variant.name}`,
                price: variant.price,
                category: item.category || "drinks",
              },
              qty,
            });
          }
        }
      } else {
        const key = `${item.id || item.sku}`;
        const qty = drawerSel[key] || 0;

        if (qty > 0) {
          add({
            id: key,
            item: {
              id: key,
              name: item.name,
              price: item.price || 0,
              category: item.category || "drinks",
            },
            qty,
          });
        }
      }
    }

    setDrawer(null);
  };

  const clearActiveCoupon = () => {
    try {
      localStorage.removeItem(LS_ACTIVE_COUPON);
      localStorage.removeItem(LS_ACTIVE_COUPON_META);
      window.dispatchEvent(new CustomEvent("bb_coupon_changed"));
      window.dispatchEvent(new CustomEvent("bb:coupon-sync"));
    } catch {}

    setLsTick((tick) => tick + 1);
  };

  return (
    <main className="mx-auto max-w-5xl space-y-6 px-4 pb-6 sm:px-6">
      <div className="sticky top-0 z-40 -mx-4 border-b border-stone-800/60 bg-stone-950/70 px-4 pb-3 pt-[max(0.5rem,env(safe-area-inset-top))] backdrop-blur sm:-mx-6 sm:px-6">
        <div className="flex items-center justify-between">
          <Link href="/menu" className="text-sm text-stone-300 hover:text-stone-100">
            ← Zurück zum Menü
          </Link>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setOrderMode("pickup")}
              className={`nav-pill ${orderMode === "pickup" ? "nav-pill--active" : ""}`}
              title="Im Laden abholen"
            >
              Abholen
            </button>

            <button
              type="button"
              onClick={() => setOrderMode("delivery")}
              className={`nav-pill ${orderMode === "delivery" ? "nav-pill--active" : ""}`}
              title="Lieferung"
            >
              Liefern
            </button>
          </div>
        </div>

        <h1 className="mt-3 text-2xl font-semibold">Checkout</h1>
      </div>

      {modePaused && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-200">
          {pauseMessage}
        </div>
      )}

      <div className="space-y-1 text-sm">
        <div className="flex justify-between">
          <span>Warenwert</span>
          <span>{fmt(merchandise)}</span>
        </div>

        {orderMode === "delivery" && surcharges > 0 && (
          <div className="flex justify-between">
            <span>Lieferaufschläge</span>
            <span>{fmt(surcharges)}</span>
          </div>
        )}

        {discount > 0 && (
          <div className="flex justify-between text-emerald-400">
            <span>Rabatt</span>
            <span>-{fmt(discount)}</span>
          </div>
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
            <button
              className="rounded-md border border-stone-700/60 px-2 py-0.5 text-xs"
              onClick={clearActiveCoupon}
            >
              ✕
            </button>
          </div>
        )}

        {tipAmount > 0 && (
          <div className="flex justify-between text-emerald-300">
            <span>Trinkgeld</span>
            <span>{fmt(tipAmount)}</span>
          </div>
        )}

        <div className="flex justify-between font-semibold">
          <span>Gesamt</span>
          <span>{fmt(payableTotal)}</span>
        </div>
      </div>

      {freeSauces > 0 && (
        <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-200">
          Gratis-Regel aktiv: <b>{freeSauces}</b>{" "}
          {freeSauces === 1 ? "Soße" : "Soßen"} möglich.
        </div>
      )}

      <CouponBox
        cartTotal={afterDiscount}
        cartItems={couponItems}
        customerPhone={(addr.phone || "").replace(/\D/g, "") || null}
      />

      {suggestion && (
        <div className="flex items-center justify-between rounded-md border border-sky-500/30 bg-sky-500/10 p-3 text-sm text-sky-200">
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
        <div className="rounded-md bg-amber-500/10 p-3 text-sm text-amber-300">
          Dein Warenkorb ist leer.
        </div>
      )}

      {orderMode === "delivery" && (addr.zip || "").trim().length === 5 && !plzKnown && (
        <div className="rounded-md bg-rose-500/10 p-3 text-sm text-rose-300">
          <div className="font-medium">Außerhalb unseres Liefergebiets.</div>
          <div>Bitte eine unterstützte PLZ eingeben.</div>
        </div>
      )}

      {orderMode === "delivery" &&
        plzKnown &&
        !meetsMin &&
        typeof requiredMin === "number" && (
          <div className="rounded-md bg-amber-500/10 p-3 text-sm text-amber-300">
            Mindestbestellwert: <b>{fmt(requiredMin)}</b>. Dein Gesamt:{" "}
            <b>{fmt(totalFinal)}</b>. Bitte weitere Artikel hinzufügen.
          </div>
        )}

      {noSlotsToday && (
        <div className="rounded-md bg-rose-500/10 p-3 text-sm text-rose-300">
          Heute sind keine Zeiten mehr verfügbar.
        </div>
      )}

      <div className="rounded-2xl border border-stone-700/60 bg-stone-900/60 p-4">
        <p className="mb-3 text-xs text-stone-400">
          Ihre Daten werden auf diesem Gerät gespeichert, damit Sie beim nächsten Mal
          schneller bestellen können. Bitte prüfen Sie, ob Ihre Daten noch aktuell sind.{" "}
          <button
            type="button"
            className="underline hover:text-stone-300"
            onClick={() => {
              try {
                localStorage.removeItem(`${PROFILE_KEY}:${orderMode}`);
              } catch {}

              alert("Gespeicherte Daten wurden entfernt.");
            }}
          >
            Daten löschen
          </button>
        </p>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Field label="Vollständiger Name *">
            <input
              value={addr.name}
              onChange={(event) =>
                setAddr({
                  ...addr,
                  name:
                    settingsRaw?.validation?.nameCapitalizeFirst === false
                      ? event.target.value
                      : normName(event.target.value),
                })
              }
              className="w-full rounded-md bg-stone-800/60 p-2 outline-none"
            />
          </Field>

          <Field label={`Telefon * (${phoneDigits} Ziffern)`}>
            <input
              inputMode="tel"
              pattern="[\d+\s()-]+"
              value={addr.phone}
              onChange={(event) => {
                const only = event.target.value.replace(/\D/g, "").slice(0, phoneDigits);
                setAddr({ ...addr, phone: only });
              }}
              className="w-full rounded-md bg-stone-800/60 p-2 outline-none"
            />
          </Field>

          {orderMode === "delivery" && (
            <>
              <div className="grid grid-cols-2 gap-3 md:col-span-2">
                <Field label="PLZ *">
                  <input
                    placeholder="z. B. 13507"
                    inputMode="numeric"
                    value={addr.zip}
                    onChange={(event) => onZipChange(event.target.value)}
                    className="w-full rounded-md bg-stone-800/60 p-2 outline-none"
                  />
                </Field>

                <Field label="Straße *">
                  <div className="relative">
                    <input
                      value={streetQuery || addr.street}
                      onChange={(event) => {
                        const value = event.target.value;
                        setStreetQuery(value);
                        setAddr((current) => ({ ...current, street: value }));
                      }}
                      onFocus={() => setShowSug(true)}
                      onBlur={() => {
                        window.setTimeout(() => setShowSug(false), 150);
                        setAddr((current) => ({
                          ...current,
                          street: (streetQuery || current.street || "").trim(),
                        }));
                      }}
                      placeholder={
                        streetOptions.length
                          ? "Straße eingeben"
                          : "Zuerst PLZ eingeben"
                      }
                      className="w-full rounded-md bg-stone-800/60 p-2 outline-none"
                    />

                    {showSug &&
                      streetOptions.length > 0 &&
                      (streetQuery || "").length >= 2 && (
                        <div className="absolute z-10 mt-1 max-h-60 w-full overflow-auto rounded-md border border-stone-700/60 bg-stone-900/95 shadow-lg">
                          {filteredStreets.map((street) => (
                            <button
                              type="button"
                              key={street}
                              onMouseDown={(event) => event.preventDefault()}
                              onClick={() => {
                                setAddr((current) => ({ ...current, street }));
                                setStreetQuery(street);
                                setShowSug(false);
                              }}
                              className="block w-full px-3 py-2 text-left hover:bg-stone-800/70"
                            >
                              {street}
                            </button>
                          ))}

                          {filteredStreets.length === 0 && (
                            <div className="px-3 py-2 text-sm text-stone-400">
                              Keine Treffer.
                            </div>
                          )}
                        </div>
                      )}
                  </div>
                </Field>
              </div>

              <div className="grid grid-cols-2 gap-3 md:col-span-2">
                <Field label="Hausnummer *">
                  <input
                    placeholder="z. B. 12A"
                    value={addr.house}
                    onChange={(event) => setAddr({ ...addr, house: event.target.value })}
                    className="w-full rounded-md bg-stone-800/60 p-2 outline-none"
                  />
                </Field>

                <Field label="Etage/Stockwerk">
                  <input
                    placeholder="z. B. 3. OG"
                    value={addr.floor}
                    onChange={(event) => setAddr({ ...addr, floor: event.target.value })}
                    className="w-full rounded-md bg-stone-800/60 p-2 outline-none"
                  />
                </Field>
              </div>

              <div className="grid grid-cols-2 gap-3 md:col-span-2">
                <Field label="Aufgang/Block">
                  <input
                    placeholder="z. B. Block B / Aufgang 2"
                    value={addr.entrance}
                    onChange={(event) =>
                      setAddr({ ...addr, entrance: event.target.value })
                    }
                    className="w-full rounded-md bg-stone-800/60 p-2 outline-none"
                  />
                </Field>

                <Field label="Stadt/Ort">
                  <input
                    value={addr.city}
                    onChange={(event) => setAddr({ ...addr, city: event.target.value })}
                    className="w-full rounded-md bg-stone-800/60 p-2 outline-none"
                  />
                </Field>
              </div>
            </>
          )}

          <Field label="E-Mail (optional)">
            <input
              type="email"
              placeholder="z. B. name@example.com"
              value={addr.email ?? ""}
              onChange={(event) => setAddr({ ...addr, email: event.target.value })}
              className={`w-full rounded-md bg-stone-800/60 p-2 outline-none ${
                addr.email && !emailValid ? "ring-1 ring-rose-500/60" : ""
              }`}
            />

            <div className="mt-2 flex items-center gap-2 text-xs text-stone-300/80">
              <input
                type="checkbox"
                checked={!!addr.emailOptIn}
                onChange={(event) =>
                  setAddr({ ...addr, emailOptIn: event.target.checked })
                }
              />
              <span>Ja, ich möchte Angebote & Neuigkeiten per E-Mail erhalten.</span>
            </div>

            {addr.email && !emailValid && (
              <span className="mt-1 block text-xs text-rose-300">
                Bitte eine gültige E-Mail eingeben.
              </span>
            )}
          </Field>

          <div className="md:col-span-2">
            <Field
              label={
                orderMode === "pickup" ? "Hinweis zur Abholung" : "Lieferhinweis"
              }
            >
              <textarea
                rows={3}
                placeholder={
                  orderMode === "pickup"
                    ? "z. B. komme in 15 Min"
                    : "Klingeln bei Müller, Tor links, Hund vor, usw."
                }
                value={addr.note}
                onChange={(event) => setAddr({ ...addr, note: event.target.value })}
                className="w-full rounded-md bg-stone-800/60 p-2 outline-none"
              />
            </Field>
          </div>
        </div>

        <div className="mt-4 rounded-2xl border border-stone-700/60 bg-stone-950/40 p-4">
          <div className="mb-3">
            <div className="text-sm font-semibold text-stone-100">Zahlungsart</div>
            <div className="mt-1 text-xs text-stone-400">
              Wählen Sie aus, wie Sie bezahlen möchten. Online-Zahlung läuft aktuell im
              Testmodus.
            </div>
          </div>

          <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
            <button
              type="button"
              onClick={() => setPaymentMethod("cash")}
              className={`rounded-xl border p-3 text-left transition ${
                paymentMethod === "cash"
                  ? "border-emerald-500/70 bg-emerald-500/10"
                  : "border-stone-700/60 bg-stone-900/60 hover:bg-stone-800/60"
              }`}
            >
              <div className="font-medium">Barzahlung</div>
              <div className="mt-1 text-xs text-stone-400">
                Bei Abholung oder Lieferung bezahlen. Die Bestellung wird sofort gesendet.
              </div>
            </button>

            <button
              type="button"
              onClick={() => setPaymentMethod("online")}
              className={`rounded-xl border p-3 text-left transition ${
                paymentMethod === "online"
                  ? "border-sky-500/70 bg-sky-500/10"
                  : "border-stone-700/60 bg-stone-900/60 hover:bg-stone-800/60"
              }`}
            >
              <div className="font-medium">Online-Zahlung</div>
              <div className="mt-1 text-xs text-stone-400">
                Testmodus: Zahlung simulieren. Später mit Stripe, Apple Pay und Google Pay.
              </div>
            </button>
          </div>

          <div className="mt-4 border-t border-stone-800/70 pt-4">
            <div className="text-sm font-semibold text-stone-100">Trinkgeld</div>
            <div className="mt-1 text-xs text-stone-400">
              Optional. Wird zum Gesamtbetrag addiert.
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              {[
                { key: "none" as TipChoice, label: "Kein Trinkgeld" },
                { key: "1" as TipChoice, label: "+1 €" },
                { key: "2" as TipChoice, label: "+2 €" },
                { key: "3" as TipChoice, label: "+3 €" },
                { key: "custom" as TipChoice, label: "Eigener Betrag" },
              ].map((option) => (
                <button
                  key={option.key}
                  type="button"
                  onClick={() => setTipChoice(option.key)}
                  className={`rounded-full border px-3 py-1.5 text-sm transition ${
                    tipChoice === option.key
                      ? "border-emerald-500/70 bg-emerald-500/10 text-emerald-200"
                      : "border-stone-700/60 bg-stone-900/60 text-stone-200 hover:bg-stone-800/60"
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>

            {tipChoice === "custom" && (
              <div className="mt-3 max-w-xs">
                <input
                  inputMode="decimal"
                  placeholder="z. B. 2,50"
                  value={customTip}
                  onChange={(event) =>
                    setCustomTip(
                      event.target.value
                        .replace(/[^\d,.]/g, "")
                        .replace(/(,.*),/g, "$1"),
                    )
                  }
                  className="w-full rounded-md bg-stone-800/60 p-2 outline-none"
                />
              </div>
            )}

            <div className="mt-3 flex items-center justify-between rounded-lg bg-stone-900/70 px-3 py-2 text-sm">
              <span>Zu zahlen</span>
              <span className="font-semibold">{fmt(payableTotal)}</span>
            </div>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
          {orderMode === "pickup" ? (
            <Field label="Geplant optional / wenn geschlossen erforderlich">
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2 text-sm">
                  <Toggle
                    checked={mustPlanNow ? true : planned.enabledPickup}
                    onChange={(value) => enablePlanned(value)}
                    label="Geplante Abholzeit"
                    disabled={mustPlanNow}
                  />
                  <span>
                    Geplante Abholzeit
                    {mustPlanNow ? " – aktuell geschlossen" : ""}
                  </span>
                </div>

                <select
                  disabled={!plannedEnabledVirtual}
                  value={planned.timePickup}
                  onChange={(event) =>
                    setPlanned((current) => ({
                      ...current,
                      timePickup: event.target.value,
                    }))
                  }
                  className={`rounded-md bg-stone-800/60 p-2 outline-none ${
                    !plannedEnabledVirtual ? "opacity-50" : ""
                  }`}
                >
                  <option value="" disabled>
                    Zeit wählen
                  </option>
                  {slotOptions.map((time) => (
                    <option key={time} value={time}>
                      {time}
                    </option>
                  ))}
                </select>
              </div>
            </Field>
          ) : (
            <Field label="Geplant optional / wenn geschlossen erforderlich">
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2 text-sm">
                  <Toggle
                    checked={mustPlanNow ? true : planned.enabledDelivery}
                    onChange={(value) => enablePlanned(value)}
                    label="Geplante Lieferzeit"
                    disabled={mustPlanNow}
                  />
                  <span>
                    Geplante Lieferzeit
                    {mustPlanNow ? " – aktuell geschlossen" : ""}
                  </span>
                </div>

                <select
                  disabled={!plannedEnabledVirtual}
                  value={planned.timeDelivery}
                  onChange={(event) =>
                    setPlanned((current) => ({
                      ...current,
                      timeDelivery: event.target.value,
                    }))
                  }
                  className={`rounded-md bg-stone-800/60 p-2 outline-none ${
                    !plannedEnabledVirtual ? "opacity-50" : ""
                  }`}
                >
                  <option value="" disabled>
                    Zeit wählen
                  </option>
                  {slotOptions.map((time) => (
                    <option key={time} value={time}>
                      {time}
                    </option>
                  ))}
                </select>
              </div>
            </Field>
          )}

          <button
            type="button"
            onClick={async (event) => {
              if (!ensureValidPlanned()) {
                event.preventDefault();
                event.stopPropagation();
                return;
              }

              if (disableSend) {
                event.preventDefault();
                return;
              }

              if (paymentMethod === "online") {
                setTestPaymentOpen(true);
                return;
              }

              await submitOrderWithPayment({
                method: "cash",
                status: "pending",
                testMode: false,
              });
            }}
            className={`card-cta card-cta--lg ${
              disableSend || submitBusy || submitted
                ? "pointer-events-none opacity-50"
                : ""
            }`}
            title={
              modePaused
                ? orderMode === "pickup"
                  ? "Abholung ist pausiert."
                  : "Lieferung ist pausiert."
                : disableSend
                  ? "Bitte Pflichtfelder/PLZ/Minimalbetrag/Zeit prüfen"
                  : paymentMethod === "online"
                    ? "Online-Zahlung testen"
                    : "Bestellung senden"
            }
            disabled={disableSend || submitBusy || submitted}
          >
            {paymentMethod === "online" ? "Online-Zahlung testen" : t("checkout.place_order")}
          </button>

          <button
            onClick={() => clear()}
            className="rounded-full border border-stone-700/60 bg-stone-800/60 px-5 py-2.5 font-semibold"
          >
            Warenkorb leeren
          </button>
        </div>
      </div>

      <TrackPanel variant="emphasized" />

      {confirm && submitted && !showConfirm && (
        <div className="rounded-md border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm text-emerald-200">
          <div className="font-medium">Ihre Bestellung ist eingegangen ✅</div>
          <div>
            Bestellnummer: <b>#{confirm.id}</b>
          </div>
          <div>
            {orderMode === "pickup" ? (
              <>
                Vorbereitungszeit: <b>{confirm.etaMin ?? avgPickupMinutes} Min</b>
              </>
            ) : (
              <>
                Voraussichtliche Lieferung:{" "}
                <b>{confirm.etaMin ?? avgDeliveryMinutes} Min</b>
              </>
            )}
          </div>
        </div>
      )}

      {showConfirm && confirm && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4 pt-[max(1rem,env(safe-area-inset-top))]"
          onKeyDown={(event) => {
            if (event.key === "Escape") setShowConfirm(false);
          }}
        >
          <div className="w-full max-w-md rounded-2xl border border-stone-700/60 bg-stone-900/95 p-5 shadow-xl">
            <div className="mb-2 text-lg font-semibold">Bestellbestätigung</div>

            <div className="space-y-2 text-sm text-stone-200">
              <div>
                Bestellnummer: <b>#{confirm.id}</b>
              </div>
              <div>
                {orderMode === "pickup" ? (
                  <>
                    Vorbereitungszeit: <b>{confirm.etaMin ?? avgPickupMinutes} Min</b>
                  </>
                ) : (
                  <>
                    Voraussichtliche Lieferung:{" "}
                    <b>{confirm.etaMin ?? avgDeliveryMinutes} Min</b>
                  </>
                )}
              </div>
              <div className="text-stone-400">Bitte notieren Sie diese Nummer.</div>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <button
                type="button"
                className="rounded-full border border-stone-700/60 bg-stone-800/60 px-4 py-2 text-sm"
                onClick={async () => {
                  try {
                    const id = String(confirm?.id ?? "").replace(/^#/, "");

                    if (!id) {
                      alert("Keine Bestellnummer gefunden.");
                      return;
                    }

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
                  try {
                    clear();
                  } catch {}

                  setShowConfirm(false);

                  try {
                    window.location.href = "/menu";
                  } catch {}
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

      {testPaymentOpen && (
        <div className="fixed inset-0 z-[65] flex items-center justify-center bg-black/70 p-4 pt-[max(1rem,env(safe-area-inset-top))]">
          <div className="w-full max-w-md rounded-2xl border border-stone-700/60 bg-stone-900/95 p-5 shadow-xl">
            <div className="mb-2 text-lg font-semibold">Online-Zahlung testen</div>

            <div className="space-y-2 text-sm text-stone-200">
              <div>
                Betrag: <b>{fmt(payableTotal)}</b>
              </div>
              <div className="rounded-md border border-sky-500/30 bg-sky-500/10 p-3 text-xs text-sky-100">
                Testmodus: Es wird kein echtes Geld abgebucht. Später übernimmt Stripe
                diesen Schritt mit Apple Pay, Google Pay und Kartenzahlung.
              </div>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <button
                type="button"
                className="card-cta"
                disabled={submitBusy || submitted}
                onClick={async () => {
                  setTestPaymentOpen(false);
                  await submitOrderWithPayment({
                    method: "online",
                    status: "paid",
                    testMode: true,
                  });
                }}
              >
                Zahlung erfolgreich simulieren
              </button>

              <button
                type="button"
                className="rounded-full border border-rose-500/40 bg-rose-500/10 px-4 py-2 text-sm text-rose-200"
                disabled={submitBusy || submitted}
                onClick={() => {
                  setTestPaymentOpen(false);
                  alert("Test-Zahlung fehlgeschlagen. Die Bestellung wurde nicht gesendet.");
                }}
              >
                Fehlschlag simulieren
              </button>

              <button
                type="button"
                className="btn-ghost ml-auto"
                disabled={submitBusy}
                onClick={() => setTestPaymentOpen(false)}
              >
                Abbrechen
              </button>
            </div>
          </div>
        </div>
      )}

      {drawer && (
        <div className="fixed inset-x-0 bottom-0 z-50 border-t border-stone-700/60 bg-stone-950/95">
          <div className="mx-auto flex max-h-[80svh] max-w-5xl flex-col p-4">
            <div className="mb-2 flex items-center justify-between">
              <div className="text-lg font-medium">
                {drawer === "drink" && "Getränke"}
                {drawer === "donut" && "Donuts"}
                {drawer === "sauce" && "Soßen"}
              </div>

              <button className="btn-ghost" onClick={() => setDrawer(null)}>
                Schließen
              </button>
            </div>

            {drawerList.length === 0 ? (
              <div className="flex-1 overflow-y-auto text-sm text-stone-400">
                Kein Artikel gefunden.
                <div className="mt-1 text-xs opacity-70">
                  Hinweis: Artikel-Kategorie/Tag prüfen.
                </div>
              </div>
            ) : (
              <div className="grid flex-1 grid-cols-1 gap-3 overflow-y-auto overscroll-contain sm:grid-cols-2 [WebkitOverflowScrolling:touch]">
                {drawerList.map((item) => (
                  <div
                    key={item.id || item.sku || item.name}
                    className="rounded-md border border-stone-700/60 p-3"
                  >
                    <div className="mb-2 font-medium">{item.name}</div>

                    {item.variants?.length ? (
                      <div className="space-y-2">
                        {item.variants.map((variant) => {
                          const key = `${item.id || item.sku}-${variant.id}`;
                          const qty = drawerSel[key] || 0;

                          return (
                            <div
                              key={key}
                              className="flex items-center justify-between gap-3"
                            >
                              <div className="text-sm">{variant.name}</div>

                              <div className="flex items-center gap-3">
                                <div className="text-sm opacity-80">{fmt(variant.price)}</div>

                                <div className="flex items-center gap-2">
                                  <button
                                    className="btn-ghost"
                                    onClick={() =>
                                      setDrawerSel((current) => ({
                                        ...current,
                                        [key]: Math.max(0, (current[key] || 0) - 1),
                                      }))
                                    }
                                  >
                                    −
                                  </button>

                                  <div className="w-6 text-center">{qty}</div>

                                  <button
                                    className="btn-ghost"
                                    onClick={() =>
                                      setDrawerSel((current) => ({
                                        ...current,
                                        [key]: (current[key] || 0) + 1,
                                      }))
                                    }
                                  >
                                    +
                                  </button>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="flex items-center justify-between">
                        <div className="text-sm opacity-80">{fmt(item.price || 0)}</div>

                        <div className="flex items-center gap-2">
                          <button
                            className="btn-ghost"
                            onClick={() =>
                              setDrawerSel((current) => {
                                const key = String(item.id || item.sku || item.name);

                                return {
                                  ...current,
                                  [key]: Math.max(0, (current[key] || 0) - 1),
                                };
                              })
                            }
                          >
                            −
                          </button>

                          <div className="w-6 text-center">
                            {drawerSel[String(item.id || item.sku || item.name)] || 0}
                          </div>

                          <button
                            className="btn-ghost"
                            onClick={() =>
                              setDrawerSel((current) => {
                                const key = String(item.id || item.sku || item.name);

                                return {
                                  ...current,
                                  [key]: (current[key] || 0) + 1,
                                };
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

            <div className="mt-4 flex items-center justify-end gap-2 border-t border-stone-800/60 pt-2">
              <button className="btn-ghost" onClick={() => setDrawer(null)}>
                Abbrechen
              </button>

              <button
                className="card-cta"
                disabled={drawerCount === 0}
                onClick={applyDrawer}
              >
                Hinzufügen ({drawerCount}) • {fmt(drawerSum)}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );

  async function submitOrderWithPayment(payment: {
    method: PaymentMethod;
    status: "pending" | "paid" | "failed";
    testMode: boolean;
  }) {
    try {
      setSubmitBusy(true);

      const result = await handleLogBeforeNavigate(payment);
      const etaMin =
        result?.etaMin ?? (orderMode === "pickup" ? avgPickupMinutes : avgDeliveryMinutes);
      const id = result?.id || String(Date.now());

      setConfirm({ id, etaMin });
      setSubmitted(true);
      setShowConfirm(true);
    } catch (error: any) {
      console.error(error);
      alert(error?.message || "Es ist ein Fehler aufgetreten. Bitte erneut versuchen.");
    } finally {
      setSubmitBusy(false);
    }
  }

  function mapCartToOrderItems() {
    return (items || []).map((ci: any) => {
      const addSum =
        (Array.isArray(ci?.add) ? ci.add : []).reduce(
          (total: number, extra: any) => total + toNum(extra?.price, 0),
          0,
        ) || 0;

      return {
        id: ci?.item?.id || ci?.id,
        sku: ci?.item?.sku || ci?.item?.id || ci?.id,
        name: ci?.item?.name || "Artikel",
        category: ci?.item?.category || undefined,
        price: toNum(ci?.item?.price, 0) + addSum,
        qty: toNum(ci?.qty, 1),
        add: Array.isArray(ci?.add)
          ? ci.add.map((extra: any) => ({
              label: extra?.label || extra?.name,
              name: extra?.name,
              price: toNum(extra?.price, 0),
            }))
          : undefined,
        note: ci?.note != null ? String(ci.note) : undefined,
        rm: Array.isArray(ci?.rm) ? ci.rm : undefined,
      };
    });
  }

  async function handleLogBeforeNavigate(payment: {
    method: PaymentMethod;
    status: "pending" | "paid" | "failed";
    testMode: boolean;
  }) {
    const ts = Date.now();
    const streetFinal = (addr.street || streetQuery || "").trim();

    const plannedValue =
      orderMode === "pickup"
        ? planned.enabledPickup && planned.timePickup
          ? planned.timePickup
          : undefined
        : planned.enabledDelivery && planned.timeDelivery
          ? planned.timeDelivery
          : undefined;

    if (activeCode) {
      try {
        await Coupons.syncCouponsFromServer();
      } catch {}
    }

    const latestCoupon = computeCouponDiscount(
      activeCode,
      items,
      afterDiscount,
      (addr.phone || "").replace(/\D/g, "") || null,
    );

    if (activeCode && latestCoupon.error) {
      clearActiveCoupon();
      throw new Error(latestCoupon.error);
    }

    const latestCouponAmount = Math.min(
      afterDiscount,
      Math.max(0, latestCoupon.amount || 0),
    );
    const latestTotalFinal = +((afterDiscount - latestCouponAmount) + surcharges).toFixed(2);
    const latestTipAmount = +Math.max(0, tipAmount).toFixed(2);
    const latestPayableTotal = +(latestTotalFinal + latestTipAmount).toFixed(2);

    const couponMeta = safeJsonParse(
      typeof window !== "undefined"
        ? localStorage.getItem(LS_ACTIVE_COUPON_META)
        : null,
    );

    const orderBase = {
      ts,
      mode: orderMode,
      source: "web",
      channel: "web",
      orderChannel: orderMode === "pickup" ? "abholung" : "lieferung",
      plz: orderMode === "delivery" ? addr.zip || null : null,
      items: mapCartToOrderItems(),
      merchandise,
      discount,
      surcharges,
      total: latestPayableTotal,
      coupon: activeCode || undefined,
      couponDiscount: latestCouponAmount || 0,
      orderNote: (addr.note || "").trim() ? (addr.note || "").trim() : undefined,
      customer: {
        name: addr.name,
        phone: addr.phone,
        ...(orderMode === "delivery"
          ? {
              deliveryHint: (addr.note || "").trim() || undefined,
            }
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
        street: streetFinal || undefined,
        house: addr.house || undefined,
        zip: addr.zip || undefined,
        plz: addr.zip || undefined,
        city: addr.city || undefined,
        floor: addr.floor || undefined,
        entrance: addr.entrance || undefined,
        email: addr.email || undefined,
        emailOptIn: !!addr.emailOptIn,
      },
      planned: plannedValue,
      meta: {
        coupon: activeCode || null,
        couponMeta: couponMeta || null,
        emailOptIn: !!addr.emailOptIn,
        payment: {
          method: payment.method,
          status: payment.status,
          provider: payment.method === "online" ? "stripe_test" : "manual",
          testMode: payment.testMode,
          tip: latestTipAmount,
          baseTotal: latestTotalFinal,
          payableTotal: latestPayableTotal,
        },
        tip: latestTipAmount,
        couponLifecycle: activeCode
          ? {
              code: activeCode,
              state: "reserved",
              reservedAt: ts,
              source: "checkout",
            }
          : null,
      },
    };

    const response = await fetch("/api/orders/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        order: orderBase,
        notify: true,
      }),
      keepalive: true,
    });

    const created = (await response.json().catch(() => ({} as any))) as any;

    if (!response.ok || created?.ok === false) {
      console.error("Order create failed", response.status, created);
      throw new Error(created?.error || "ORDER_CREATE_FAILED");
    }

    const id = created?.orderId || created?.id || created?.order?.id || String(Date.now());
    const etaMin = created?.etaMin ?? created?.order?.etaMin;

    return { id, etaMin };
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