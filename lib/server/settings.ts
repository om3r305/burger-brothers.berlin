// lib/server/settings.ts
import { Prisma } from "@prisma/client";
import { prisma, getTenantId } from "@/lib/db";

export type ServerSettings = {
  security?: {
    tvPin?: string;
    [key: string]: any;
  };

  telegram?: {
    enabled?: boolean;
    botToken?: string;
    chatId?: string;
  };

  hours?: {
    timezone?: string;
    avgPickupMinutes?: number;
    avgDeliveryMinutes?: number;
    allowPreorder?: boolean;
    slotMinutes?: number;
    daysAhead?: number;
    forceClosed?: boolean;
    [key: string]: any;
  };

  orders?: {
    idLength?: number;
    [key: string]: any;
  };

  validation?: {
    phoneDigits?: number;
    [key: string]: any;
  };

  features?: {
    donuts?: {
      enabled?: boolean;
      [key: string]: any;
    };
    bubbleTea?: {
      enabled?: boolean;
      [key: string]: any;
    };
    liveTracking?: {
      enabled?: boolean;
      [key: string]: any;
    };
    tracking?: {
      enabled?: boolean;
      showEtaClock?: boolean;
      [key: string]: any;
    };
    [key: string]: any;
  };

  freebies?: {
    enabled?: boolean;
    category?: string;
    mode?: string;
    tiers?: any[];
    [key: string]: any;
  };

  pricingOverrides?: {
    plzMin?: Record<string, any>;
    [key: string]: any;
  };

  discounts?: {
    pickupPercent?: number;
    deliveryPercent?: number;
    apolloPercent?: number;
    lifaPercent?: number;
    [key: string]: any;
  };

  surcharges?: Record<string, any>;

  contact?: {
    phone?: string;
    address?: string;
    email?: string;
    instagram?: string;
    tiktok?: string;
    facebook?: string;
    mapsUrl?: string;
    reviewsUrl?: string;
    whatsapp?: string;
    [key: string]: any;
  };

  printing?: {
    logoUrl?: string;
    footerNote?: string;
    paper?: string;
    showBarcode?: boolean;
    showQR?: boolean;
    [key: string]: any;
  };

  routeDeals?: {
    enabled?: boolean;
    maxActiveDeals?: number;
    defaultDurationMinutes?: number;
    rules?: Array<{
      id?: string;
      name?: string;
      enabled?: boolean;
      plz?: string[];
      streets?: string[];
      durationMinutes?: number;
      minTotal?: number;
      reward?: {
        type?: "percent" | "fixed" | "free_delivery" | "free_sauce" | "free_drink";
        percent?: number;
        amount?: number;
        maxDiscount?: number;
        freeItemName?: string;
        freeItemCategory?: string;
        [key: string]: any;
      };
      message?: string;
      priority?: number;
      [key: string]: any;
    }>;
    active?: Array<{
      id?: string;
      ruleId?: string;
      name?: string;
      plz?: string;
      street?: string;
      orderId?: string;
      startedAt?: string;
      expiresAt?: string;
      durationMinutes?: number;
      minTotal?: number;
      reward?: Record<string, any>;
      message?: string;
      [key: string]: any;
    }>;
    [key: string]: any;
  };

  statusColors?: Record<string, any>;

  theme?: {
    active?: string;
    [key: string]: any;
  };

  [key: string]: any;
};

type PlainObject = Record<string, any>;

const WHOLE_SETTINGS_KEYS = new Set(["settings", "bb_settings_v6", "app:settings"]);

function readEnvNumber(key: string, fallback: number) {
  const n = Number(process.env[key]);
  return Number.isFinite(n) ? n : fallback;
}

const DEFAULT_SETTINGS: ServerSettings = {
  security: {
    tvPin: "",
  },

  telegram: {
    enabled: false,
    botToken: process.env.TELEGRAM_BOT_TOKEN || "",
    chatId: process.env.TELEGRAM_CHAT_ID || "",
  },

  hours: {
    timezone: "Europe/Berlin",
    avgPickupMinutes: readEnvNumber("AVG_PICKUP_MINUTES", 15),
    avgDeliveryMinutes: readEnvNumber("AVG_DELIVERY_MINUTES", 35),
    allowPreorder: true,
    slotMinutes: 15,
    daysAhead: 2,
    forceClosed: false,
  },

  orders: {
    idLength: readEnvNumber("ORDER_ID_LENGTH", 6),
  },

  validation: {
    phoneDigits: 11,
  },

  features: {
    donuts: {
      enabled: false,
    },
    bubbleTea: {
      enabled: false,
    },
    liveTracking: {
      enabled: true,
    },
    tracking: {
      enabled: true,
      showEtaClock: true,
    },
  },

  freebies: {
    enabled: false,
    category: "sauces",
    mode: "both",
    tiers: [],
  },

  pricingOverrides: {
    plzMin: {},
  },

  discounts: {
    pickupPercent: 0,
    deliveryPercent: 0,
    apolloPercent: 0,
    lifaPercent: 0,
  },

  surcharges: {},

  contact: {
    phone: "",
    address: "",
    email: "",
    instagram: "",
    tiktok: "",
    facebook: "",
    mapsUrl: "",
    reviewsUrl: "",
    whatsapp: "",
  },

  printing: {
    logoUrl: "",
    footerNote: "",
    paper: "80mm",
    showBarcode: true,
    showQR: true,
  },

  routeDeals: {
    enabled: false,
    maxActiveDeals: 2,
    defaultDurationMinutes: 12,
    rules: [],
    active: [],
  },

  statusColors: {
    new: "#f59e0b",
    preparing: "#3b82f6",
    ready: "#22c55e",
    out_for_delivery: "#a855f7",
    done: "#64748b",
    cancelled: "#ef4444",
  },

  theme: {
    active: "default",
  },
};

function isPlainObject(value: any): value is PlainObject {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isSafeKey(key: string) {
  if (!key) return false;
  if (key === "__proto__") return false;
  if (key === "prototype") return false;
  if (key === "constructor") return false;
  return true;
}

function sanitizeJson(value: any): any {
  if (value === undefined) return null;
  if (value === null) return null;

  if (value instanceof Date) {
    return Number.isFinite(value.valueOf()) ? value.toISOString() : null;
  }

  if (value instanceof Prisma.Decimal) {
    return value.toNumber();
  }

  if (typeof value === "bigint") {
    return value.toString();
  }

  if (typeof value === "function" || typeof value === "symbol") {
    return null;
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeJson(item));
  }

  if (isPlainObject(value)) {
    const out: PlainObject = {};

    for (const [key, item] of Object.entries(value)) {
      if (!isSafeKey(key)) continue;
      if (item === undefined) continue;

      out[key] = sanitizeJson(item);
    }

    return out;
  }

  return value;
}

function jsonForDb(value: any): Prisma.InputJsonValue {
  const cleaned = sanitizeJson(value);

  if (cleaned === null) {
    return {} as Prisma.InputJsonValue;
  }

  return cleaned as Prisma.InputJsonValue;
}

function deepMerge<T = any>(base: T, override: any): T {
  if (override === undefined) return base;

  if (Array.isArray(base) || Array.isArray(override)) {
    return override as T;
  }

  if (!isPlainObject(base) || !isPlainObject(override)) {
    return override as T;
  }

  const result: PlainObject = { ...base };

  for (const [key, value] of Object.entries(override)) {
    if (!isSafeKey(key)) continue;

    if (isPlainObject(result[key]) && isPlainObject(value)) {
      result[key] = deepMerge(result[key], value);
    } else {
      result[key] = value;
    }
  }

  return result as T;
}

function normalizeSettingsObject(value: any): ServerSettings {
  if (!isPlainObject(value)) return {};

  const ignored = new Set([
    "ok",
    "source",
    "tenant",
    "count",
    "counts",
    "saved",
    "keys",
    "replace",
    "createdAt",
    "updatedAt",
  ]);

  const out: ServerSettings = {};

  for (const [key, item] of Object.entries(value)) {
    if (ignored.has(key)) continue;
    if (!isSafeKey(key)) continue;
    if (item === undefined) continue;

    out[key] = sanitizeJson(item);
  }

  return out;
}

async function readSettingsFromDb(): Promise<ServerSettings> {
  const tenantId = await getTenantId();

  const rows = await prisma.setting.findMany({
    where: {
      tenantId,
    },
    orderBy: {
      key: "asc",
    },
  });

  let dbSettings: ServerSettings = {};

  for (const row of rows) {
    if (!isSafeKey(row.key)) continue;

    const value = sanitizeJson(row.value);

    if (WHOLE_SETTINGS_KEYS.has(row.key) && isPlainObject(value)) {
      dbSettings = deepMerge(dbSettings, normalizeSettingsObject(value));
      continue;
    }

    dbSettings[row.key] = value;
  }

  return dbSettings;
}

async function saveSettingKey(tx: any, tenantId: string, key: string, value: any) {
  const existing = await tx.setting.findFirst({
    where: {
      tenantId,
      key,
    },
    select: {
      id: true,
    },
  });

  if (existing?.id) {
    await tx.setting.update({
      where: {
        id: existing.id,
      },
      data: {
        value: jsonForDb(value) as any,
      },
    });

    await tx.setting.deleteMany({
      where: {
        tenantId,
        key,
        id: {
          not: existing.id,
        },
      },
    });

    return;
  }

  await tx.setting.create({
    data: {
      tenantId,
      key,
      value: jsonForDb(value) as any,
    },
  });
}

async function writeSettingsToDb(settings: ServerSettings) {
  const tenantId = await getTenantId();
  const normalized = normalizeSettingsObject(settings);

  const entries = Object.entries(normalized).filter(([key, value]) => {
    if (!isSafeKey(key)) return false;
    if (value === undefined) return false;
    return true;
  });

  if (!entries.length) return;

  await prisma.$transaction(async (tx) => {
    for (const [key, value] of entries) {
      await saveSettingKey(tx, tenantId, key, value);
    }
  });
}

function applyEnvFallback(settings: ServerSettings): ServerSettings {
  const current = deepMerge(DEFAULT_SETTINGS, settings);

  return {
    ...current,

    telegram: {
      ...current.telegram,
      botToken: current.telegram?.botToken || process.env.TELEGRAM_BOT_TOKEN || "",
      chatId: current.telegram?.chatId || process.env.TELEGRAM_CHAT_ID || "",
    },

    hours: {
      ...current.hours,
      timezone: current.hours?.timezone || "Europe/Berlin",
      avgPickupMinutes:
        Number(current.hours?.avgPickupMinutes) ||
        readEnvNumber("AVG_PICKUP_MINUTES", 15),
      avgDeliveryMinutes:
        Number(current.hours?.avgDeliveryMinutes) ||
        readEnvNumber("AVG_DELIVERY_MINUTES", 35),
    },

    orders: {
      ...current.orders,
      idLength:
        Number(current.orders?.idLength) || readEnvNumber("ORDER_ID_LENGTH", 6),
    },
  };
}

/**
 * Sunucu ayarlarını DB-first getirir.
 *
 * Ana kaynak:
 * - Postgres/Supabase Setting tablosu
 *
 * Fallback:
 * - DEFAULT_SETTINGS
 * - ENV sadece eksik kritik alanları tamamlar
 */
export async function getServerSettings(): Promise<ServerSettings> {
  try {
    const dbSettings = await readSettingsFromDb();
    return applyEnvFallback(dbSettings);
  } catch (error) {
    console.error("[server/settings] DB read failed, using safe defaults:", error);
    return applyEnvFallback({});
  }
}

/**
 * Ayarları DB’ye kaydeder.
 * Admin veya server action tarafında kullanılabilir.
 */
export async function saveServerSettings(settings: ServerSettings): Promise<void> {
  try {
    await writeSettingsToDb(settings);
  } catch (error) {
    console.error("[server/settings] DB write failed:", error);
  }
}