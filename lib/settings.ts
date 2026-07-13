import { normalizeFreebieConfig } from "@/lib/freebies";
import type { FreebieCategory, FreebieRule } from "@/lib/freebies";
import { createDefaultThemeSettings, normalizeThemeSettings } from "@/lib/themes";
import type { ThemeSettings } from "@/lib/themes";

// lib/settings.ts
export const LS_SETTINGS = "bb_settings_v6";
export const SETTINGS_REMOTE_URL = "/api/settings";
export const LS_DEVICE_ID = "bb_device_id_v1";

/* ───────── Device ID ───────── */

export function getDeviceId(): string {
  if (typeof window === "undefined") return "server";

  let id = localStorage.getItem(LS_DEVICE_ID);

  if (!id) {
    id = `dev-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
    localStorage.setItem(LS_DEVICE_ID, id);
  }

  return id;
}

/* ───────── Types ───────── */

export type StatusColors = {
  eingegangen: string;
  zubereitung: string;
  abholbereit: string;
  unterwegs: string;
  abgeschlossen: string;
  storniert?: string;

  new?: string;
  preparing?: string;
  ready?: string;
  out_for_delivery?: string;
  done?: string;
  cancelled?: string;
};

export type Features = {
  bubbleTea: { enabled: boolean; [key: string]: any };
  donuts: { enabled: boolean; [key: string]: any };
  liveTracking?: { enabled: boolean; [key: string]: any };
  tracking?: { enabled: boolean; showEtaClock?: boolean; [key: string]: any };
  [key: string]: any;
};

export type Tracking = {
  enabled: boolean;
  showEtaClock: boolean;
  [key: string]: any;
};

export type TimeRange = { start: string; end: string };

export type WeekSchedule = Partial<
  Record<"mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun", TimeRange[]>
>;

export type Hours = {
  allowPreorder: boolean;
  slotMinutes: number;
  slotMinutesDelivery?: number;
  slotMinutesPickup?: number;
  daysAhead: number;
  avgPickupMinutes: number;
  avgDeliveryMinutes: number;
  tz?: string;
  timezone?: string;
  forceClosed?: boolean;
  newGraceMinutes?: number;
  autoDoneWhenEtaUp?: boolean;
  plan?: {
    pickup?: Array<{ day: string; open: string; close: string }>;
    delivery?: Array<{ day: string; open: string; close: string }>;
  };
  pickup?: WeekSchedule;
  delivery?: WeekSchedule;
  [key: string]: any;
};

export type Printing = {
  logoUrl?: string;
  footerNote?: string;
  footerHinweise?: string;
  paper?: "A4" | "A5" | "80mm" | string;
  showBarcode?: boolean;
  showQR?: boolean;
  groupingOrder?: string[];
  qrPayload?: {
    includeOrderId: boolean;
    includeCustomerName: boolean;
    includePhone: boolean;
    includeAddress: boolean;
  };
  enabled?: boolean;
  ip?: string;
  port?: number;
  [key: string]: any;
};

export type TelegramCfg = {
  enabled: boolean;
  botToken?: string;
  chatId?: string;
  [key: string]: any;
};

export type DiscountCfg = {
  active: boolean;
  discountRate: number;
  [key: string]: any;
};

export type DeliveryCfg = {
  plzMin: Record<string, number>;
  minOrderAfterDiscountByPLZ?: Record<string, number>;
  surcharges: Record<string, number>;
  discountRate?: number;
  [key: string]: any;
};

export type FreebieTier = {
  minTotal: number;
  freeSauces: number;
  [key: string]: any;
};

export type FreebiesCfg = {
  enabled: boolean;
  rules: FreebieRule[];
  category: FreebieCategory;
  mode: "pickup" | "delivery" | "both";
  tiers: FreebieTier[];
  [key: string]: any;
};


export type CartOffer = {
  id: string;
  name: string;
  enabled: boolean;
  percent: number;
  minNetTotal: number;
  mode: "pickup" | "delivery" | "both";
  startAt?: string;
  endAt?: string;
  priority?: number;
  customerNotice?: string;
  overrideStandardDiscount?: boolean;
  createdAt?: string;
  updatedAt?: string;
  [key: string]: any;
};

export type CouponRule = {
  code: string;
  active: boolean;
  validFrom?: string;
  validTo?: string;
  minSubtotal?: number;
  usageLimitPerUser?: number;
  maxUses?: number;
  type: "percent" | "fixed" | "free_item";
  value: number;
  scope?: { category?: string; productId?: string };
  [key: string]: any;
};

export type AnnItem = {
  title: string;
  text?: string;
  imageUrl?: string;
  ctaLabel?: string;
  ctaHref?: string;
  active?: boolean;
  enabled?: boolean;
  startsAt?: string;
  endsAt?: string;
};

export type RouteDealRewardType =
  | "percent"
  | "fixed"
  | "free_delivery"
  | "free_sauce"
  | "free_drink";

export type RouteDealReward = {
  type: RouteDealRewardType;
  percent?: number;
  amount?: number;
  maxDiscount?: number;
  freeItemName?: string;
  freeItemCategory?: "sauces" | "drinks" | "donuts" | "bubbletea" | string;
  [key: string]: any;
};

export type RouteDealRule = {
  id: string;
  name: string;
  enabled: boolean;
  plz: string[];
  streets: string[];
  durationMinutes: number;
  minTotal: number;
  reward: RouteDealReward;
  message?: string;
  priority?: number;
  [key: string]: any;
};

export type ActiveRouteDeal = {
  id: string;
  ruleId: string;
  name: string;
  plz: string;
  street?: string;
  orderId?: string;
  startedAt: string;
  expiresAt: string;
  durationMinutes: number;
  minTotal: number;
  reward: RouteDealReward;
  message?: string;
  [key: string]: any;
};

export type RouteDealsCfg = {
  enabled: boolean;
  maxActiveDeals: number;
  defaultDurationMinutes: number;
  rules: RouteDealRule[];
  active: ActiveRouteDeal[];
  [key: string]: any;
};

export type ProductAvailabilityMode = "today" | "manual";

export type ProductAvailabilityEntry = {
  disabled?: boolean;
  mode?: ProductAvailabilityMode | string;
  until?: string | null;
  by?: string;
  updatedAt?: number;
  productId?: string;
  name?: string;
  [key: string]: any;
};

export type ProductAvailabilityMap = Record<string, ProductAvailabilityEntry | null | undefined>;

export type TVSettings = {
  autoRefreshSeconds: number;
  hideSensitive: boolean;
  sounds: {
    apollonEnabled: boolean;
    apollonUrl: string;
    lifaEnabled: boolean;
    lifaUrl: string;
    volume: number;
  };
  allowDurationAdjust: boolean;
  durationStepMinutes: number;
  durationMaxMinutes: number;
  allowCancel: boolean;
  confirmCancel: boolean;
  [key: string]: any;
};

export type SecuritySettings = {
  requirePinForQR: boolean;
  driverPin?: string;
  qrAccessTTLMinutes: number;
  drivers: Array<{ id: string; name: string; active: boolean }>;
  trustedDevices: Record<string, { driverName: string }>;
  [key: string]: any;
};

export type SettingsV6 = {
  features: Features;
  tracking: Tracking;
  hours: Hours;

  statusColors: StatusColors;
  modeColors?: { pickup: string; delivery: string };

  telegram: TelegramCfg;

  lifa: DiscountCfg;
  apollon: DiscountCfg;

  delivery: DeliveryCfg;
  pickup?: {
    discountRate?: number;
    [key: string]: any;
  };

  freebies?: FreebiesCfg;
  cartOffers?: CartOffer[];
  coupons?: CouponRule[];
  announcements?: { enabled: boolean; items: AnnItem[] };
  routeDeals?: RouteDealsCfg;
  productAvailability?: ProductAvailabilityMap;
  printing?: Printing;
  tv?: TVSettings;
  security?: SecuritySettings;

  contact?: {
    phone?: string;
    email?: string;
    address?: string;
    whatsapp?: string;
    whatsappNumber?: string;
    instagram?: string;
    tiktok?: string;
    facebook?: string;
    mapsUrl?: string;
    reviewsUrl?: string;
    [key: string]: any;
  };

  site?: {
    closed?: boolean;
    message?: string;
    maintenanceStart?: string;
    maintenanceEnd?: string;
    [key: string]: any;
  };

  validation?: {
    phoneDigits?: number;
    nameCapitalizeFirst?: boolean;
    [key: string]: any;
  };

  orders?: {
    idLength?: number;
    [key: string]: any;
  };

  colors?: {
    statusColors?: any;
    modeColors?: any;
  };

  theme?: ThemeSettings;

  offers?: {
    freebies?: FreebiesCfg;
    [key: string]: any;
  };

  discount?: {
    lifaRate?: number;
    apollonRate?: number;
    [key: string]: any;
  };

  discounts?: {
    deliveryPercent?: number;
    pickupPercent?: number;
    lifaPercent?: number;
    apolloPercent?: number;
    apollonPercent?: number;
    [key: string]: any;
  };

  pricingOverrides?: {
    plzMin?: Record<string, number>;
    [key: string]: any;
  };

  surcharges?: Record<string, number>;

  dashboard?: {
    password?: string;
    pollSeconds?: number;
    targets?: {
      deliveryMins?: number;
      pickupMins?: number;
    };
    sound?: {
      newOrder?: string;
    };
    [key: string]: any;
  };

  [key: string]: any;
};

/* ───────── Defaults ───────── */

const defaultSettings: SettingsV6 = {
  features: {
    bubbleTea: { enabled: false },
    donuts: { enabled: false },
    liveTracking: { enabled: true },
    tracking: { enabled: true, showEtaClock: true },
  },

  tracking: {
    enabled: true,
    showEtaClock: true,
  },

  hours: {
    allowPreorder: true,
    slotMinutes: 15,
    slotMinutesDelivery: 15,
    slotMinutesPickup: 15,
    daysAhead: 2,
    avgPickupMinutes: 15,
    avgDeliveryMinutes: 35,
    tz: "Europe/Berlin",
    timezone: "Europe/Berlin",
    forceClosed: false,
    newGraceMinutes: 5,
    autoDoneWhenEtaUp: true,
    plan: {
      pickup: [],
      delivery: [],
    },
    pickup: {},
    delivery: {},
  },

  statusColors: {
    eingegangen: "#38bdf8",
    zubereitung: "#f59e0b",
    abholbereit: "#10b981",
    unterwegs: "#22d3ee",
    abgeschlossen: "#9ca3af",
    storniert: "#ef4444",
    new: "#38bdf8",
    preparing: "#f59e0b",
    ready: "#10b981",
    out_for_delivery: "#22d3ee",
    done: "#9ca3af",
    cancelled: "#ef4444",
  },

  modeColors: {
    pickup: "#60a5fa",
    delivery: "#a78bfa",
  },

  telegram: {
    enabled: false,
    botToken: "",
    chatId: "",
  },

  lifa: {
    active: true,
    discountRate: 0,
  },

  apollon: {
    active: true,
    discountRate: 0,
  },

  delivery: {
    plzMin: {},
    minOrderAfterDiscountByPLZ: {},
    surcharges: {
      burger: 0,
      vegan: 0,
      drinks: 0,
      sauces: 0,
      extras: 0,
      hotdogs: 0,
      donuts: 0,
      bubbleTea: 0,
    },
    discountRate: 0,
  },

  pickup: {
    discountRate: 0,
  },

  freebies: {
    enabled: false,
    rules: [],
    category: "sauces",
    mode: "both",
    tiers: [],
  },

  cartOffers: [],

  coupons: [],

  announcements: {
    enabled: false,
    items: [],
  },

  routeDeals: {
    enabled: false,
    maxActiveDeals: 2,
    defaultDurationMinutes: 12,
    rules: [],
    active: [],
  },

  productAvailability: {},

  printing: {
    logoUrl: "/logo.png",
    footerNote: "Vielen Dank!",
    footerHinweise: "Vielen Dank!",
    paper: "80mm",
    showBarcode: true,
    showQR: true,
    groupingOrder: ["burger", "vegan", "hotdogs", "extras", "drinks", "sauces"],
    qrPayload: {
      includeOrderId: true,
      includeCustomerName: false,
      includePhone: false,
      includeAddress: true,
    },
    enabled: true,
    ip: "192.168.0.150",
    port: 9100,
  },

  tv: {
    autoRefreshSeconds: 5,
    hideSensitive: true,
    sounds: {
      apollonEnabled: true,
      apollonUrl: "/sounds/apollo.mp3",
      lifaEnabled: true,
      lifaUrl: "/sounds/lifa.mp3",
      volume: 1,
    },
    allowDurationAdjust: true,
    durationStepMinutes: 5,
    durationMaxMinutes: 60,
    allowCancel: true,
    confirmCancel: true,
  },

  security: {
    requirePinForQR: true,
    driverPin: "123456",
    qrAccessTTLMinutes: 120,
    drivers: [
      { id: "ali", name: "Ali", active: true },
      { id: "recep", name: "Recep", active: true },
      { id: "oktay", name: "Oktay", active: true },
    ],
    trustedDevices: {},
  },

  contact: {
    phone: "",
    email: "",
    address: "",
    whatsapp: "",
    whatsappNumber: "",
    instagram: "",
    tiktok: "",
    facebook: "",
    mapsUrl: "",
    reviewsUrl: "",
  },

  site: {
    closed: false,
    message: "",
    maintenanceStart: "",
    maintenanceEnd: "",
  },

  validation: {
    phoneDigits: 11,
    nameCapitalizeFirst: true,
  },

  orders: {
    idLength: 6,
  },

  colors: {
    statusColors: {
      eingegangen: "#38bdf8",
      zubereitung: "#f59e0b",
      abholbereit: "#10b981",
      unterwegs: "#22d3ee",
      abgeschlossen: "#9ca3af",
      storniert: "#ef4444",
    },
    modeColors: {
      pickup: "#60a5fa",
      delivery: "#a78bfa",
    },
  },

  theme: createDefaultThemeSettings(),

  offers: {
    freebies: {
      enabled: false,
      rules: [],
      category: "sauces",
      mode: "both",
      tiers: [],
    },
  },

  discount: {
    lifaRate: 0,
    apollonRate: 0,
  },

  discounts: {
    deliveryPercent: 0,
    pickupPercent: 0,
    lifaPercent: 0,
    apolloPercent: 0,
    apollonPercent: 0,
  },

  pricingOverrides: {
    plzMin: {},
  },

  surcharges: {},
};

/* ───────── Helpers ───────── */

const RESPONSE_META_KEYS = new Set([
  "ok",
  "source",
  "tenant",
  "count",
  "counts",
  "saved",
  "keys",
  "error",
  "message",
  "dbError",
  "fallbackSaved",
  "memoryCached",
  "createdAt",
  "updatedAt",
]);

function isPlainObject(value: any): value is Record<string, any> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isSafeKey(key: string) {
  if (!key) return false;
  if (key === "__proto__") return false;
  if (key === "prototype") return false;
  if (key === "constructor") return false;
  return true;
}

function num(value: any, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function bool(value: any, fallback = false) {
  if (typeof value === "boolean") return value;
  if (value === undefined || value === null || value === "") return fallback;

  const s = String(value).toLowerCase().trim();

  if (["1", "true", "yes", "ja", "on"].includes(s)) return true;
  if (["0", "false", "no", "nein", "off"].includes(s)) return false;

  return fallback;
}

function cleanString(value: any, fallback = "") {
  const s = String(value ?? "").trim();
  return s || fallback;
}

function safeIso(value: any) {
  if (!value) return "";

  const d = new Date(value);
  return Number.isFinite(d.valueOf()) ? d.toISOString() : "";
}

function safeJsonParse(value: string | null) {
  if (!value) return null;

  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function safeStringify(value: any) {
  try {
    return JSON.stringify(value);
  } catch {
    return "{}";
  }
}

function sanitize(value: any): any {
  if (value === undefined) return null;
  if (value === null) return null;

  if (value instanceof Date) {
    return Number.isFinite(value.valueOf()) ? value.toISOString() : null;
  }

  if (typeof value === "bigint") return value.toString();
  if (typeof value === "function" || typeof value === "symbol") return null;

  if (Array.isArray(value)) {
    return value.map((item) => sanitize(item));
  }

  if (isPlainObject(value)) {
    const out: Record<string, any> = {};

    for (const [key, item] of Object.entries(value)) {
      if (!isSafeKey(key)) continue;
      if (item === undefined) continue;
      out[key] = sanitize(item);
    }

    return out;
  }

  return value;
}

function mergeDeep<A extends object, B extends object>(a: A, b: B): A & B {
  const out: any = Array.isArray(a) ? [...(a as any)] : { ...(a as any) };

  for (const [key, value] of Object.entries(b || {})) {
    if (!isSafeKey(key)) continue;

    if (value && typeof value === "object" && !Array.isArray(value)) {
      out[key] = mergeDeep((out as any)[key] || {}, value as any);
    } else {
      out[key] = value;
    }
  }

  return out;
}

function stripResponseMetadata(raw: any): any {
  const source =
    isPlainObject(raw?.settings)
      ? raw.settings
      : isPlainObject(raw?.data)
        ? raw.data
        : raw;

  if (!isPlainObject(source)) return source || {};

  const out: Record<string, any> = {};

  for (const [key, value] of Object.entries(source)) {
    if (!isSafeKey(key)) continue;
    if (RESPONSE_META_KEYS.has(key)) continue;
    out[key] = value;
  }

  return out;
}

function dispatchSettingsChanged(next: SettingsV6) {
  if (typeof window === "undefined") return;

  try {
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: LS_SETTINGS,
        newValue: safeStringify(next),
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

function writeLocalSettings(next: SettingsV6) {
  if (typeof window === "undefined") return next;

  localStorage.setItem(LS_SETTINGS, safeStringify(next));
  dispatchSettingsChanged(next);

  return next;
}

function normalizeFreebies(value: any): FreebiesCfg {
  return normalizeFreebieConfig(value) as FreebiesCfg;
}

function normalizeAnnouncements(value: any) {
  const raw = value || {};

  return {
    enabled: bool(raw.enabled, false),
    items: Array.isArray(raw.items)
      ? raw.items.map((item: any) => ({
          title: cleanString(item?.title, ""),
          text: cleanString(item?.text, ""),
          imageUrl: cleanString(item?.imageUrl, ""),
          ctaLabel: cleanString(item?.ctaLabel, ""),
          ctaHref: cleanString(item?.ctaHref, ""),
          enabled: item?.enabled !== false,
          active: item?.active !== false && item?.enabled !== false,
          startsAt: item?.startsAt ? safeIso(item.startsAt) : "",
          endsAt: item?.endsAt ? safeIso(item.endsAt) : "",
        }))
      : [],
  };
}

function cleanStringList(value: any): string[] {
  const list = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/[;,\n]/g)
      : [];

  return Array.from(
    new Set(
      list
        .map((item) => cleanString(item, ""))
        .filter(Boolean),
    ),
  );
}

function normalizeRouteDealReward(value: any): RouteDealReward {
  const raw = value || {};
  const type: RouteDealRewardType =
    raw.type === "fixed" ||
    raw.type === "free_delivery" ||
    raw.type === "free_sauce" ||
    raw.type === "free_drink"
      ? raw.type
      : "percent";

  return {
    ...raw,
    type,
    percent: Math.min(100, Math.max(0, num(raw.percent ?? raw.value, 15))),
    amount: Math.max(0, num(raw.amount ?? raw.fixedAmount, 0)),
    maxDiscount: Math.max(0, num(raw.maxDiscount, 0)),
    freeItemName: cleanString(raw.freeItemName, ""),
    freeItemCategory: cleanString(raw.freeItemCategory, ""),
  };
}

function normalizeRouteDeals(value: any): RouteDealsCfg {
  const raw = value || {};

  const defaultDurationMinutes = Math.min(
    60,
    Math.max(1, num(raw.defaultDurationMinutes ?? raw.durationMinutes, 12)),
  );

  const rules = Array.isArray(raw.rules)
    ? raw.rules.map((rule: any, index: number) => {
        const id = cleanString(rule?.id, `route-deal-${index + 1}`);
        const durationMinutes = Math.min(
          60,
          Math.max(1, num(rule?.durationMinutes, defaultDurationMinutes)),
        );

        return {
          ...rule,
          id,
          name: cleanString(rule?.name, "Nachbarschafts-Deal"),
          enabled: rule?.enabled !== false,
          plz: cleanStringList(rule?.plz ?? rule?.plzList ?? rule?.postalCodes),
          streets: cleanStringList(rule?.streets ?? rule?.streetList),
          durationMinutes,
          minTotal: Math.max(0, num(rule?.minTotal ?? rule?.minimumTotal, 0)),
          reward: normalizeRouteDealReward(rule?.reward ?? rule),
          message: cleanString(
            rule?.message,
            "Unser Fahrer ist gleich in Ihrer Nähe. Bestellen Sie jetzt und sichern Sie sich Ihr Nachbarschafts-Angebot.",
          ),
          priority: num(rule?.priority, index),
        };
      })
    : [];

  const active = Array.isArray(raw.active)
    ? raw.active.map((deal: any, index: number) => ({
        ...deal,
        id: cleanString(deal?.id, `active-route-deal-${index + 1}`),
        ruleId: cleanString(deal?.ruleId, ""),
        name: cleanString(deal?.name, "Nachbarschafts-Deal"),
        plz: cleanString(deal?.plz, ""),
        street: cleanString(deal?.street, ""),
        orderId: cleanString(deal?.orderId, ""),
        startedAt: deal?.startedAt ? safeIso(deal.startedAt) : "",
        expiresAt: deal?.expiresAt ? safeIso(deal.expiresAt) : "",
        durationMinutes: Math.min(
          60,
          Math.max(1, num(deal?.durationMinutes, defaultDurationMinutes)),
        ),
        minTotal: Math.max(0, num(deal?.minTotal ?? deal?.minimumTotal, 0)),
        reward: normalizeRouteDealReward(deal?.reward ?? deal),
        message: cleanString(deal?.message, ""),
      }))
    : [];

  return {
    ...raw,
    enabled: bool(raw.enabled, false),
    maxActiveDeals: Math.min(5, Math.max(1, num(raw.maxActiveDeals, 2))),
    defaultDurationMinutes,
    rules,
    active,
  };
}

/** Legacy alanları normalize edip defaults ile birleştirir */
function normalizeAndMerge(raw: any): SettingsV6 {
  const incoming = stripResponseMetadata(raw);
  const compat: any = sanitize(incoming || {});

  const deliveryDiscountRate = num(
    compat?.delivery?.discountRate ??
      compat?.discount?.lifaRate ??
      compat?.discounts?.deliveryPercent ??
      compat?.discounts?.lifaPercent ??
      compat?.lifa?.discountRate,
    defaultSettings.lifa.discountRate,
  );

  const pickupDiscountRate = num(
    compat?.pickup?.discountRate ??
      compat?.discount?.apollonRate ??
      compat?.discounts?.pickupPercent ??
      compat?.discounts?.apolloPercent ??
      compat?.discounts?.apollonPercent ??
      compat?.apollon?.discountRate,
    defaultSettings.apollon.discountRate,
  );

  compat.lifa = {
    ...(compat.lifa || {}),
    active: compat?.lifa?.active ?? true,
    discountRate: deliveryDiscountRate,
  };

  compat.apollon = {
    ...(compat.apollon || {}),
    active: compat?.apollon?.active ?? true,
    discountRate: pickupDiscountRate,
  };

  compat.delivery = {
    ...(compat.delivery || {}),
    discountRate: deliveryDiscountRate,
    surcharges: {
      ...(compat.surcharges || {}),
      ...(compat.delivery?.surcharges || {}),
    },
    plzMin: {
      ...(compat.pricingOverrides?.plzMin || {}),
      ...(compat.delivery?.plzMin || {}),
      ...(compat.delivery?.minOrderAfterDiscountByPLZ || {}),
    },
  };

  compat.delivery.minOrderAfterDiscountByPLZ = {
    ...(compat.delivery.plzMin || {}),
  };

  compat.pickup = {
    ...(compat.pickup || {}),
    discountRate: pickupDiscountRate,
  };

  compat.discount = {
    ...(compat.discount || {}),
    lifaRate: deliveryDiscountRate,
    apollonRate: pickupDiscountRate,
  };

  compat.discounts = {
    ...(compat.discounts || {}),
    deliveryPercent: deliveryDiscountRate,
    pickupPercent: pickupDiscountRate,
    lifaPercent: deliveryDiscountRate,
    apolloPercent: pickupDiscountRate,
    apollonPercent: pickupDiscountRate,
  };

  compat.surcharges = {
    ...(compat.delivery.surcharges || {}),
  };

  compat.pricingOverrides = {
    ...(compat.pricingOverrides || {}),
    plzMin: {
      ...(compat.delivery.plzMin || {}),
    },
  };

  const trackingEnabled = compat?.tracking?.enabled ?? compat?.features?.tracking?.enabled ?? true;
  const showEtaClock =
    compat?.tracking?.showEtaClock ?? compat?.features?.tracking?.showEtaClock ?? true;

  compat.tracking = {
    ...(compat.tracking || {}),
    enabled: bool(trackingEnabled, true),
    showEtaClock: bool(showEtaClock, true),
  };

  compat.features = {
    ...(compat.features || {}),
    bubbleTea: {
      ...(compat.features?.bubbleTea || {}),
      enabled: bool(compat.features?.bubbleTea?.enabled, false),
    },
    donuts: {
      ...(compat.features?.donuts || {}),
      enabled: bool(compat.features?.donuts?.enabled, false),
    },
    liveTracking: {
      ...(compat.features?.liveTracking || {}),
      enabled: bool(trackingEnabled, true),
    },
    tracking: {
      ...(compat.features?.tracking || {}),
      enabled: bool(trackingEnabled, true),
      showEtaClock: bool(showEtaClock, true),
    },
  };

  compat.freebies = normalizeFreebies(compat.freebies || compat.offers?.freebies);
  compat.offers = {
    ...(compat.offers || {}),
    freebies: { ...compat.freebies },
  };

  compat.announcements = normalizeAnnouncements(compat.announcements);
  compat.routeDeals = normalizeRouteDeals(compat.routeDeals);
  compat.theme = normalizeThemeSettings(compat.theme);

  const footerNote =
    compat?.printing?.footerNote ??
    compat?.printing?.footerHinweise ??
    defaultSettings.printing?.footerNote ??
    "Vielen Dank!";

  compat.printing = {
    ...(compat.printing || {}),
    footerNote,
    footerHinweise: footerNote,
    paper: compat?.printing?.paper || defaultSettings.printing?.paper || "80mm",
    showBarcode: compat?.printing?.showBarcode !== false,
    showQR: compat?.printing?.showQR !== false,
  };

  const whatsapp = compat?.contact?.whatsapp ?? compat?.contact?.whatsappNumber ?? "";

  compat.contact = {
    ...(compat.contact || {}),
    phone: compat?.contact?.phone || "",
    email: compat?.contact?.email || "",
    address: compat?.contact?.address || "",
    whatsapp,
    whatsappNumber: whatsapp,
    instagram: compat?.contact?.instagram || "",
    tiktok: compat?.contact?.tiktok || "",
    facebook: compat?.contact?.facebook || "",
    mapsUrl: compat?.contact?.mapsUrl || "",
    reviewsUrl: compat?.contact?.reviewsUrl || "",
  };

  compat.validation = {
    ...(compat.validation || {}),
    phoneDigits: num(compat?.validation?.phoneDigits, 11),
    nameCapitalizeFirst: bool(compat?.validation?.nameCapitalizeFirst, true),
  };

  compat.orders = {
    ...(compat.orders || {}),
    idLength: Math.min(Math.max(num(compat?.orders?.idLength, 6), 4), 12),
  };

  compat.site = {
    ...(compat.site || {}),
    closed: bool(compat?.site?.closed, false),
    message: cleanString(compat?.site?.message, ""),
    maintenanceStart: compat?.site?.maintenanceStart ? safeIso(compat.site.maintenanceStart) : "",
    maintenanceEnd: compat?.site?.maintenanceEnd ? safeIso(compat.site.maintenanceEnd) : "",
  };

  let merged = mergeDeep(defaultSettings, compat) as SettingsV6;
  merged.theme = normalizeThemeSettings(merged.theme);

  merged.hours = {
    ...merged.hours,
    tz: merged.hours.tz || merged.hours.timezone || "Europe/Berlin",
    timezone: merged.hours.timezone || merged.hours.tz || "Europe/Berlin",
    slotMinutes: merged.hours.slotMinutesDelivery ?? merged.hours.slotMinutes ?? 15,
    slotMinutesDelivery: merged.hours.slotMinutesDelivery ?? merged.hours.slotMinutes ?? 15,
    slotMinutesPickup: merged.hours.slotMinutesPickup ?? merged.hours.slotMinutes ?? 15,
    daysAhead: Math.max(0, num(merged.hours.daysAhead, 2)),
    avgPickupMinutes: Math.max(1, num(merged.hours.avgPickupMinutes, 15)),
    avgDeliveryMinutes: Math.max(1, num(merged.hours.avgDeliveryMinutes, 35)),
    forceClosed: bool(merged.hours.forceClosed, false),
    newGraceMinutes: merged.hours.newGraceMinutes ?? 5,
    autoDoneWhenEtaUp: merged.hours.autoDoneWhenEtaUp ?? true,
    pickup: merged.hours.pickup || {},
    delivery: merged.hours.delivery || {},
  };

  merged.tv = {
    ...defaultSettings.tv!,
    ...(merged.tv || {}),
    sounds: {
      ...defaultSettings.tv!.sounds,
      ...(merged.tv?.sounds || {}),
    },
  };

  merged.printing = mergeDeep(defaultSettings.printing || {}, merged.printing || {});

  if (!merged.printing?.qrPayload) {
    merged.printing = {
      ...merged.printing,
      qrPayload: {
        ...defaultSettings.printing!.qrPayload!,
      },
    };
  }

  merged.security = mergeDeep(
    (defaultSettings.security ?? {}) as SecuritySettings,
    (merged.security ?? {}) as SecuritySettings,
  ) as SecuritySettings;

  merged.colors = {
    statusColors: {
      ...(defaultSettings.colors?.statusColors || {}),
      ...(merged.colors?.statusColors || {}),
    },
    modeColors: {
      ...(defaultSettings.colors?.modeColors || {}),
      ...(merged.colors?.modeColors || {}),
    },
  };

  merged.statusColors = {
    ...merged.statusColors,
    new: merged.statusColors.new ?? merged.colors.statusColors.eingegangen,
    preparing: merged.statusColors.preparing ?? merged.colors.statusColors.zubereitung,
    ready: merged.statusColors.ready ?? merged.colors.statusColors.abholbereit,
    out_for_delivery:
      merged.statusColors.out_for_delivery ?? merged.colors.statusColors.unterwegs,
    done: merged.statusColors.done ?? merged.colors.statusColors.abgeschlossen,
    cancelled: merged.statusColors.cancelled ?? merged.colors.statusColors.storniert,
  };

  merged.modeColors = {
    ...(merged.modeColors || {}),
    pickup: merged.modeColors?.pickup || merged.colors.modeColors.pickup || "#60a5fa",
    delivery:
      merged.modeColors?.delivery || merged.colors.modeColors.delivery || "#a78bfa",
  };

  return merged;
}

/* ───────── Read / Write local cache ───────── */

export function readSettings(): SettingsV6 {
  if (typeof window === "undefined") return normalizeAndMerge(defaultSettings);

  try {
    const raw = localStorage.getItem(LS_SETTINGS);
    if (!raw) return normalizeAndMerge(defaultSettings);

    const parsed = safeJsonParse(raw) || {};
    return normalizeAndMerge(parsed);
  } catch {
    return normalizeAndMerge(defaultSettings);
  }
}

export function writeSettings(patch?: Partial<SettingsV6> | null) {
  if (typeof window === "undefined") return normalizeAndMerge(defaultSettings);

  const current = readSettings();

  if (!patch) {
    const normalized = normalizeAndMerge(current);
    return writeLocalSettings(normalized);
  }

  const merged = mergeDeep(current, patch as any) as SettingsV6;
  const normalized = normalizeAndMerge(merged);

  return writeLocalSettings(normalized);
}

/* ───────── Remote DB sync helpers ───────── */

export async function fetchServerSettings(): Promise<Partial<SettingsV6> | null> {
  try {
    const res = await fetch(`${SETTINGS_REMOTE_URL}?ts=${Date.now()}`, {
      method: "GET",
      cache: "no-store",
      headers: {
        accept: "application/json",
      },
    });

    const json = await res.json().catch(() => ({}));

    if (!res.ok || json?.ok === false) {
      throw new Error(json?.error || `HTTP ${res.status}`);
    }

    return stripResponseMetadata(json) as Partial<SettingsV6>;
  } catch {
    return null;
  }
}

export function applyRemoteSettings(remote: any): SettingsV6 {
  const normalized = normalizeAndMerge(stripResponseMetadata(remote));
  return writeLocalSettings(normalized);
}

export async function fetchAndApplyRemoteSettings(): Promise<SettingsV6> {
  if (typeof window === "undefined") return normalizeAndMerge(defaultSettings);

  const remote = await fetchServerSettings();

  if (!remote) {
    return readSettings();
  }

  return applyRemoteSettings(remote);
}

export async function saveSettingsRemote(
  patch?: Partial<SettingsV6> | null,
): Promise<SettingsV6> {
  const current = readSettings();

  const next = patch
    ? normalizeAndMerge(mergeDeep(current, patch as any))
    : normalizeAndMerge(current);

  const res = await fetch(SETTINGS_REMOTE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      accept: "application/json",
    },
    body: safeStringify({ settings: next }),
  });

  const json = await res.json().catch(() => null);

  if (!res.ok || json?.ok === false) {
    throw new Error(json?.error || `SETTINGS_SAVE_FAILED_${res.status}`);
  }

  if (json && typeof json === "object") {
    return applyRemoteSettings(json);
  }

  return writeLocalSettings(next);
}

/* ───────── Pricing helpers ───────── */

export function getPricingOverrides(mode: "pickup" | "delivery") {
  const settings = readSettings();

  const discountRate =
    mode === "pickup"
      ? settings.apollon?.active
        ? settings.apollon?.discountRate || 0
        : 0
      : settings.lifa?.active
        ? settings.lifa?.discountRate || 0
        : 0;

  return {
    discountRate,
    apollonRate: settings.apollon?.discountRate || 0,
    lifaRate: settings.lifa?.discountRate || 0,
    surcharges: settings.delivery?.surcharges || {},
    plzMin: settings.delivery?.plzMin || {},
    freebies: settings.freebies || undefined,
  };
}

/* ───────── Init ───────── */

export function ensureSettingsInitialized() {
  if (typeof window === "undefined") return;

  if (!localStorage.getItem(LS_SETTINGS)) {
    writeLocalSettings(normalizeAndMerge(defaultSettings));
  }
}