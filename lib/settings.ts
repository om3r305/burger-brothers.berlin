// lib/settings.ts
export const LS_SETTINGS = "bb_settings_v6";

/* ───────── Merkezi ayar / senkron ───────── */
export const SETTINGS_REMOTE_URL = "/api/settings"; // merkezi endpoint
export const LS_DEVICE_ID = "bb_device_id_v1";

/** Rastgele ve stabil cihaz kimliği (tarayıcı + cihaz bazında) */
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
};

export type Features = {
  bubbleTea: { enabled: boolean };
  donuts: { enabled: boolean };
};

export type Tracking = {
  enabled: boolean;
  showEtaClock: boolean;
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
  newGraceMinutes?: number;
  autoDoneWhenEtaUp?: boolean;
  plan?: {
    pickup?: Array<{ day: string; open: string; close: string }>;
    delivery?: Array<{ day: string; open: string; close: string }>;
  };
  pickup?: WeekSchedule;
  delivery?: WeekSchedule;
};

/** 🆕 Yazdırma ayarları (ağ yazıcısı için IP/port eklendi) */
export type Printing = {
  logoUrl?: string;
  footerHinweise?: string;
  paper?: "A4" | "A5" | "80mm";
  showBarcode?: boolean;
  showQR?: boolean;
  groupingOrder?: string[];
  qrPayload?: {
    includeOrderId: boolean;
    includeCustomerName: boolean;
    includePhone: boolean;
    includeAddress: boolean;
  };

  /** Yazdırma açık mı? (UI’de butonları aktif/pasif yapmak için) */
  enabled?: boolean;
  /** Ağ yazıcısı IP (örn: 192.168.0.150) */
  ip?: string;
  /** RAW/Socket portu (genelde 9100) */
  port?: number;
};

export type TelegramCfg = {
  enabled: boolean;
  botToken?: string;
  chatId?: string;
};

export type DiscountCfg = {
  active: boolean;
  discountRate: number; // 0..1
};

export type DeliveryCfg = {
  plzMin: Record<string, number>;
  surcharges: Record<string, number>;
};

export type FreebieTier = { minTotal: number; freeSauces: number };
export type FreebiesCfg = {
  enabled: boolean;
  category: "sauces" | "drinks";
  mode: "pickup" | "delivery" | "both";
  tiers: FreebieTier[];
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
};

export type AnnItem = {
  title: string;
  text?: string;
  imageUrl?: string;
  ctaLabel?: string;
  ctaHref?: string;
  active?: boolean;
};

/** TV (dashboard public) configuration */
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
};

/** Security & driver mapping for QR flow */
export type SecuritySettings = {
  requirePinForQR: boolean;
  driverPin?: string;
  qrAccessTTLMinutes: number;
  drivers: Array<{ id: string; name: string; active: boolean }>;
  trustedDevices: Record<string, { driverName: string }>;
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
  freebies?: FreebiesCfg;
  coupons?: CouponRule[];
  announcements?: { enabled: boolean; items: AnnItem[] };
  printing?: Printing;
  tv?: TVSettings;
  security?: SecuritySettings;

  // legacy/compat mirrors:
  contact?: { phone?: string; email?: string; address?: string; whatsappNumber?: string };
  site?: { closed?: boolean; message?: string };
  validation?: { phoneDigits?: number; nameCapitalizeFirst?: boolean };
  colors?: { statusColors?: any; modeColors?: any };
  theme?: any;
  offers?: any;
  discount?: { lifaRate?: number; apollonRate?: number };
  pickup?: { discountRate?: number };
};

const defaultSettings: SettingsV6 = {
  features: { bubbleTea: { enabled: true }, donuts: { enabled: true } },
  tracking: { enabled: true, showEtaClock: true },
  hours: {
    allowPreorder: true,
    slotMinutes: 15,
    slotMinutesDelivery: 15,
    slotMinutesPickup: 15,
    daysAhead: 0,
    avgPickupMinutes: 10,
    avgDeliveryMinutes: 35,
    tz: "Europe/Berlin",
    timezone: "Europe/Berlin",
    newGraceMinutes: 5,
    autoDoneWhenEtaUp: true,
  },
  statusColors: {
    eingegangen: "#60a5fa",
    zubereitung: "#f59e0b",
    abholbereit: "#34d399",
    unterwegs: "#a78bfa",
    abgeschlossen: "#9ca3af",
  },
  modeColors: { pickup: "#10b981", delivery: "#f59e0b" },
  telegram: { enabled: false },
  lifa: { active: true, discountRate: 0.1 },
  apollon: { active: true, discountRate: 0.05 },
  delivery: { plzMin: {}, surcharges: { burger: 0, vegan: 0, drinks: 0, sauces: 0, extras: 0 } },
  freebies: { enabled: false, category: "sauces", mode: "both", tiers: [] },
  coupons: [],
  announcements: { enabled: false, items: [] },
  printing: {
    paper: "A4",
    showBarcode: true,
    showQR: true,
    groupingOrder: ["BURGER", "VEGAN", "BEILAGEN", "GETRÄNKE", "SOßEN"],
    qrPayload: {
      includeOrderId: true,
      includeCustomerName: false,
      includePhone: false,
      includeAddress: true,
    },

    // 🆕 ağ yazıcı defaultları
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
      volume: 1.0,
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
};

/* ───────── Helpers ───────── */
function mergeDeep<A extends object, B extends object>(a: A, b: B): A & B {
  const out: any = Array.isArray(a) ? [...(a as any)] : { ...(a as any) };
  for (const [k, v] of Object.entries(b || {})) {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      out[k] = mergeDeep((out as any)[k] || {}, v as any);
    } else {
      out[k] = v;
    }
  }
  return out;
}

/** Legacy alanları normalize edip defaults ile birleştirir */
function normalizeAndMerge(raw: any): SettingsV6 {
  const compat: any = { ...(raw || {}) };

  if (compat?.delivery?.discountRate != null) {
    const r = Number(compat.delivery.discountRate) || 0;
    compat.lifa = { ...(compat.lifa || {}), active: compat?.lifa?.active ?? true, discountRate: r };
  }
  if (compat?.pickup?.discountRate != null) {
    const r = Number(compat.pickup.discountRate) || 0;
    compat.apollon = { ...(compat.apollon || {}), active: compat?.apollon?.active ?? true, discountRate: r };
  }
  if (compat?.delivery?.minOrderAfterDiscountByPLZ) {
    compat.delivery = {
      ...(compat.delivery || {}),
      plzMin: { ...(compat.delivery?.plzMin || {}), ...(compat.delivery?.minOrderAfterDiscountByPLZ || {}) },
    };
  }
  if (compat?.delivery && !compat.delivery.surcharges) {
    compat.delivery.surcharges = {};
  }

  let merged = mergeDeep(defaultSettings, compat) as SettingsV6;

  merged.hours = {
    ...merged.hours,
    tz: merged.hours.tz || merged.hours.timezone || "Europe/Berlin",
    timezone: merged.hours.timezone || merged.hours.tz || "Europe/Berlin",
    slotMinutes: merged.hours.slotMinutesDelivery ?? merged.hours.slotMinutes ?? 15,
    slotMinutesDelivery: merged.hours.slotMinutesDelivery ?? merged.hours.slotMinutes ?? 15,
    slotMinutesPickup: merged.hours.slotMinutesPickup ?? merged.hours.slotMinutes ?? 15,
    newGraceMinutes: merged.hours.newGraceMinutes ?? 5,
    autoDoneWhenEtaUp: merged.hours.autoDoneWhenEtaUp ?? true,
  };

  merged.tv = {
    ...defaultSettings.tv!,
    ...(merged.tv || {}),
    sounds: { ...defaultSettings.tv!.sounds, ...(merged.tv?.sounds || {}) },
  };

  merged.printing = mergeDeep(defaultSettings.printing || {}, merged.printing || {});
  if (!merged.printing?.qrPayload) {
    merged.printing = { ...merged.printing, qrPayload: { ...defaultSettings.printing!.qrPayload! } };
  }

  // ✅ FIX: Tipi netleştirerek security birleştirme
  merged.security = mergeDeep(
    (defaultSettings.security ?? {}) as SecuritySettings,
    (merged.security ?? {}) as SecuritySettings
  ) as SecuritySettings;

  return merged;
}

/* ───────── Read / Write ───────── */
export function readSettings(): SettingsV6 {
  if (typeof window === "undefined") return defaultSettings;
  try {
    const raw = localStorage.getItem(LS_SETTINGS);
    if (!raw) return defaultSettings;
    const obj = JSON.parse(raw) || {};
    return normalizeAndMerge(obj);
  } catch {
    return defaultSettings;
  }
}

/**
 * Lokal ayarı yazar ve storage olayı ile diğer sekmelere haber verir.
 * patch gelmezse mevcut ayarı normalize edip geri yazar.
 */
export function writeSettings(patch?: Partial<SettingsV6> | null) {
  if (typeof window === "undefined") return;
  const cur = readSettings();

  if (!patch) {
    localStorage.setItem(LS_SETTINGS, JSON.stringify(cur));
    try { window.dispatchEvent(new StorageEvent("storage", { key: LS_SETTINGS })); } catch {}
    return cur as SettingsV6;
  }

  const next: SettingsV6 = {
    ...cur,
    ...patch,
    features: mergeDeep(cur.features, (patch as any).features || {}),
    tracking: mergeDeep(cur.tracking, (patch as any).tracking || {}),
    hours: mergeDeep(cur.hours, (patch as any).hours || {}),
    statusColors: mergeDeep(cur.statusColors, (patch as any).statusColors || {}),
    delivery: {
      ...cur.delivery,
      ...(patch as any).delivery,
      plzMin: { ...cur.delivery.plzMin, ...((patch as any).delivery?.plzMin || {}) },
      surcharges: { ...cur.delivery.surcharges, ...((patch as any).delivery?.surcharges || {}) },
    },
    lifa: { ...cur.lifa, ...(patch as any).lifa },
    apollon: { ...cur.apollon, ...(patch as any).apollon },
    printing: mergeDeep(cur.printing || {}, (patch as any).printing || {}),
    tv: mergeDeep(cur.tv || {}, (patch as any).tv || {}),
    security: mergeDeep(cur.security || {}, (patch as any).security || {}),
  };

  localStorage.setItem(LS_SETTINGS, JSON.stringify(next));
  try { window.dispatchEvent(new StorageEvent("storage", { key: LS_SETTINGS })); } catch {}
  return next as SettingsV6;
}

/** Uzak (merkezi) ayarı al ve lokal ile birleştirip uygula */
export async function fetchAndApplyRemoteSettings(): Promise<SettingsV6> {
  if (typeof window === "undefined") return defaultSettings;
  try {
    const res = await fetch(`${SETTINGS_REMOTE_URL}?t=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const remote = await res.json();
    return applyRemoteSettings(remote);
  } catch {
    return readSettings();
  }
}

/** Basit: uzak ayarı getir (SettingsSync için) */
export async function fetchServerSettings(): Promise<Partial<SettingsV6> | null> {
  try {
    const res = await fetch(`${SETTINGS_REMOTE_URL}?ts=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) throw new Error("fetch failed");
    return (await res.json()) as Partial<SettingsV6>;
  } catch {
    return null;
  }
}

/** Uzak ayar nesnesini normalize edip yaz (derin birleştirme) */
export function applyRemoteSettings(remote: any): SettingsV6 {
  const normalized = normalizeAndMerge(remote);
  return writeSettings(normalized) as SettingsV6;
}

/** Moda göre pricing knobs döndürür */
export function getPricingOverrides(mode: "pickup" | "delivery") {
  const s = readSettings();
  const discountRate =
    mode === "pickup"
      ? (s.apollon?.active ? (s.apollon?.discountRate || 0) : 0)
      : (s.lifa?.active ? (s.lifa?.discountRate || 0) : 0);

  return {
    discountRate,
    apollonRate: s.apollon?.discountRate || 0,
    lifaRate: s.lifa?.discountRate || 0,
    surcharges: s.delivery?.surcharges || {},
    plzMin: s.delivery?.plzMin || {},
    freebies: s.freebies || undefined,
  };
}

/** İlk açılışta localStorage boşsa varsayılanı yaz (idempotent) */
export function ensureSettingsInitialized() {
  if (typeof window === "undefined") return;
  if (!localStorage.getItem(LS_SETTINGS)) {
    localStorage.setItem(LS_SETTINGS, JSON.stringify(defaultSettings));
  }
}