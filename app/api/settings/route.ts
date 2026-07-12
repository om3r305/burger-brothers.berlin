// app/api/settings/route.ts
import { NextResponse } from "next/server";
import { prisma, getTenantId } from "@/lib/db";
import { readFallbackSnapshot, writeFallbackSnapshot } from "@/lib/server/fallback-snapshot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type PlainObject = Record<string, any>;

const WHOLE_SETTINGS_KEYS = new Set(["settings", "bb_settings_v6", "app:settings"]);

const PROTECTED_KEY_PREFIXES = ["kv:"];

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate",
};

const ADMIN_COOKIE = process.env.ADMIN_COOKIE_NAME || "bb_admin_sess";
const TV_COOKIE_NAMES = Array.from(
  new Set(
    [
      process.env.TV_COOKIE_NAME || "bb_tv_sess",
      "bb_tv_session",
      "bb_tv_auth",
    ].filter(Boolean),
  ),
);
const TV_WRITABLE_SETTING_KEYS = new Set(["productAvailability"]);

const PUBLIC_READ_CACHE_TTL_MS = 30_000;
let settingsMemoryCache:
  | {
      expiresAt: number;
      value: PlainObject;
    }
  | null = null;

function readSettingsMemoryCache() {
  if (!settingsMemoryCache) return null;
  if (settingsMemoryCache.expiresAt <= Date.now()) {
    settingsMemoryCache = null;
    return null;
  }
  return settingsMemoryCache.value;
}

function writeSettingsMemoryCache(value: PlainObject) {
  settingsMemoryCache = {
    expiresAt: Date.now() + PUBLIC_READ_CACHE_TTL_MS,
    value,
  };
}

function clearSettingsMemoryCache() {
  settingsMemoryCache = null;
}

function shouldWriteRuntimeSnapshot() {
  return !process.env.VERCEL;
}


const DEFAULT_SETTINGS: PlainObject = {
  orders: {
    idLength: 6,
  },

  security: {
    tvPin: "",
  },

  validation: {
    phoneDigits: 11,
  },

  hours: {
    timezone: "Europe/Berlin",
    avgPickupMinutes: 15,
    avgDeliveryMinutes: 35,
    allowPreorder: true,
    slotMinutes: 15,
    daysAhead: 2,
    forceClosed: false,
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
    rules: [],
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

  telegram: {
    enabled: false,
    botToken: "",
    chatId: "",
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

  productAvailability: {},

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

function isProtectedSettingKey(key: string) {
  return PROTECTED_KEY_PREFIXES.some((prefix) => key.startsWith(prefix));
}

function decodeCookieValue(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function hasAdminSession(req: Request) {
  const cookieHeader = req.headers.get("cookie") || "";
  const cookies = cookieHeader
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean);

  for (const cookie of cookies) {
    const index = cookie.indexOf("=");
    const name = index >= 0 ? cookie.slice(0, index).trim() : cookie.trim();
    const rawValue = index >= 0 ? cookie.slice(index + 1).trim() : "";
    const value = decodeCookieValue(rawValue);

    if (name === ADMIN_COOKIE && value.startsWith("ok:")) {
      return true;
    }
  }

  return false;
}

function hasTvSession(req: Request) {
  const cookieHeader = req.headers.get("cookie") || "";
  const cookies = cookieHeader
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean);

  for (const cookie of cookies) {
    const index = cookie.indexOf("=");
    const name = index >= 0 ? cookie.slice(0, index).trim() : cookie.trim();
    const rawValue = index >= 0 ? cookie.slice(index + 1).trim() : "";
    const value = decodeCookieValue(rawValue);

    if (
      TV_COOKIE_NAMES.includes(name) &&
      (value.startsWith("ok:") || value === "1" || value === "true")
    ) {
      return true;
    }
  }

  return false;
}

function isTvWritableSettingsPayload(payload: PlainObject, replace: boolean) {
  if (replace) return false;

  const keys = Object.keys(payload || {});
  if (!keys.length) return false;

  return keys.every((key) => TV_WRITABLE_SETTING_KEYS.has(key));
}

function sanitizeJson(value: any): any {
  if (value === undefined) return null;
  if (value === null) return null;

  if (value instanceof Date) {
    return Number.isFinite(value.valueOf()) ? value.toISOString() : null;
  }

  /*
    Prisma Decimal bazı projelerde Prisma.Decimal olarak export edilmiyor.
    Bu yüzden özel Prisma type kullanmadan güvenli şekilde yakalıyoruz.
  */
  if (
    value &&
    typeof value === "object" &&
    typeof value.toNumber === "function" &&
    typeof value.toString === "function"
  ) {
    try {
      return value.toNumber();
    } catch {
      return value.toString();
    }
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

function jsonForDb(value: any): any {
  const cleaned = sanitizeJson(value);

  if (cleaned === null) {
    return {};
  }

  return cleaned;
}

function deepMerge(base: any, override: any): any {
  if (Array.isArray(base) || Array.isArray(override)) {
    return override === undefined ? base : override;
  }

  if (!isPlainObject(base) || !isPlainObject(override)) {
    return override === undefined ? base : override;
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

  return result;
}

function setPathValue(path: string, value: any): PlainObject {
  const parts = path
    .split(".")
    .map((part) => part.trim())
    .filter(Boolean);

  if (!parts.length) return {};
  if (!parts.every(isSafeKey)) return {};

  const root: PlainObject = {};
  let cursor = root;

  for (let i = 0; i < parts.length; i += 1) {
    const key = parts[i];

    if (i === parts.length - 1) {
      cursor[key] = value;
    } else {
      cursor[key] = {};
      cursor = cursor[key];
    }
  }

  return root;
}

function normalizeIncomingSettings(body: any): PlainObject {
  if (!isPlainObject(body)) return {};

  if (typeof body.key === "string") {
    const key = body.key.trim();

    if (!key) return {};

    if (isProtectedSettingKey(key)) {
      return {
        [key]: body.value,
      };
    }

    if (key.includes(".")) {
      return setPathValue(key, body.value);
    }

    if (!isSafeKey(key)) return {};

    return {
      [key]: body.value,
    };
  }

  if (isPlainObject(body.settings)) {
    return body.settings;
  }

  if (isPlainObject(body.data)) {
    return body.data;
  }

  const ignoredKeys = new Set([
    "ok",
    "source",
    "tenant",
    "count",
    "counts",
    "replace",
    "updatedAt",
    "createdAt",
    "saved",
    "keys",
  ]);

  const out: PlainObject = {};

  for (const [key, value] of Object.entries(body)) {
    if (ignoredKeys.has(key)) continue;
    if (!isSafeKey(key)) continue;
    if (value === undefined) continue;

    out[key] = value;
  }

  return out;
}

async function readSettingsMap(tenantId: string) {
  const rows = await prisma.setting.findMany({
    where: {
      tenantId,
    },
    orderBy: {
      key: "asc",
    },
  });

  let legacySettings: PlainObject = {};
  let wholeSettings: PlainObject = {};

  for (const row of rows) {
    if (!isSafeKey(row.key)) continue;
    if (isProtectedSettingKey(row.key)) continue;

    const value = sanitizeJson(row.value);

    /*
      Tek parça bb_settings_v6 kaydı artık ana kaynaktır.
      Eski ayrı key kayıtlarını önce okuyoruz, tek parça güncel kaydı en son
      uyguluyoruz. Böylece eski/stale satırlar yeni ayarları ezemez.
    */
    if (WHOLE_SETTINGS_KEYS.has(row.key) && isPlainObject(value)) {
      wholeSettings = deepMerge(wholeSettings, value);
      continue;
    }

    legacySettings[row.key] = value;
  }

  return deepMerge(
    DEFAULT_SETTINGS,
    deepMerge(legacySettings, wholeSettings),
  );
}

async function saveSettingKey(
  tenantId: string,
  key: string,
  value: any,
  opts?: {
    mergeObjects?: boolean;
  },
) {
  const existing = await prisma.setting.findFirst({
    where: {
      tenantId,
      key,
    },
    select: {
      id: true,
      value: true,
    },
  });

  let nextValue = value;

  if (opts?.mergeObjects && existing?.value && isPlainObject(existing.value) && isPlainObject(value)) {
    nextValue = deepMerge(existing.value, value);
  }

  if (existing?.id) {
    await prisma.setting.update({
      where: {
        id: existing.id,
      },
      data: {
        value: jsonForDb(nextValue) as any,
      },
    });

    /*
      Eski yedeklerde aynı key'den birden fazla kayıt oluşmuş olabilir.
      Ana kaydı güncelledikten sonra duplicate kayıtları temizliyoruz.
    */
    await prisma.setting.deleteMany({
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

  await prisma.setting.create({
    data: {
      tenantId,
      key,
      value: jsonForDb(value) as any,
    },
  });
}

async function saveWholeSettings(
  tenantId: string,
  payload: PlainObject,
) {
  const key = "bb_settings_v6";
  const cleaned = sanitizeJson(payload);

  const existing = await prisma.setting.findFirst({
    where: {
      tenantId,
      key,
    },
    select: {
      id: true,
    },
  });

  if (existing?.id) {
    await prisma.setting.update({
      where: {
        id: existing.id,
      },
      data: {
        value: jsonForDb(cleaned) as any,
      },
    });

    // Aynı key ile oluşmuş eski duplicate satırları temizle.
    await prisma.setting.deleteMany({
      where: {
        tenantId,
        key,
        id: {
          not: existing.id,
        },
      },
    });
  } else {
    await prisma.setting.create({
      data: {
        tenantId,
        key,
        value: jsonForDb(cleaned) as any,
      },
    });
  }

  return {
    saved: 1,
    keys: [key],
  };
}

async function saveSettings(tenantId: string, payload: PlainObject, replace = false) {
  const entries = Object.entries(payload || {}).filter(([key, value]) => {
    if (!isSafeKey(key)) return false;
    if (value === undefined) return false;
    return true;
  });

  const keys = entries.map(([key]) => key);

  /*
    ÖNEMLİ:
    Burada bilerek prisma.$transaction kullanmıyoruz.
    Admin Settings çok büyük payload gönderebildiği için interactive transaction
    bazen kapanıyor ve POST /api/settings 500 verebiliyor.
  */
  for (const [key, value] of entries) {
    await saveSettingKey(tenantId, key, value, {
      mergeObjects: !replace && !WHOLE_SETTINGS_KEYS.has(key) && !isProtectedSettingKey(key),
    });
  }

  const canReplace =
    replace &&
    keys.length > 0 &&
    !keys.some((key) => WHOLE_SETTINGS_KEYS.has(key) || isProtectedSettingKey(key));

  /*
    DB-first güvenlik:
    - replace=true boş payload ile gelirse mevcut ayarları silmiyoruz.
    - tek parça legacy settings key'i ile gelirse mevcut ayarları silmiyoruz.
    - kv:* fallback kayıtlarını asla settings replace ile silmiyoruz.
  */
  if (canReplace) {
    const keepKeys = Array.from(new Set([...keys, ...WHOLE_SETTINGS_KEYS]));

    await prisma.setting.deleteMany({
      where: {
        tenantId,
        AND: [
          {
            key: {
              notIn: keepKeys,
            },
          },
          {
            key: {
              not: {
                startsWith: "kv:",
              },
            },
          },
        ],
      },
    });
  }

  return {
    saved: entries.length,
    keys,
  };
}

function jsonResponse(payload: Record<string, any>, status = 200) {
  return NextResponse.json(payload, {
    status,
    headers: NO_STORE_HEADERS,
  });
}

function unauthorizedResponse() {
  return jsonResponse(
    {
      ok: false,
      source: "db",
      error: "unauthorized",
      message: "Nicht angemeldet.",
    },
    401,
  );
}

function errorResponse(error: any, fallback: string, status = 500) {
  return jsonResponse(
    {
      ok: false,
      source: "db",
      error: error?.message || fallback,
    },
    status,
  );
}


async function readSettingsFallback() {
  const fallback = await readFallbackSnapshot<PlainObject>("settings");

  if (!isPlainObject(fallback)) return null;

  return deepMerge(DEFAULT_SETTINGS, normalizeIncomingSettings(fallback));
}

async function writeSettingsFallback(settings: PlainObject) {
  return writeFallbackSnapshot("settings", settings).catch((error) => {
    console.warn("[settings:fallback] write failed", error);
    return null;
  });
}


async function readRequestBody(req: Request) {
  try {
    return await req.json();
  } catch {
    return {};
  }
}

export async function GET() {
  try {
    const cached = readSettingsMemoryCache();

    if (cached) {
      return NextResponse.json(
        {
          ...cached,
          ok: true,
          source: "db",
          memoryCached: true,
        },
        {
          headers: NO_STORE_HEADERS,
        },
      );
    }

    const tenantId = await getTenantId();
    const settings = await readSettingsMap(tenantId);
    writeSettingsMemoryCache(settings);

    const fallbackSaved = shouldWriteRuntimeSnapshot()
      ? await writeSettingsFallback(settings)
      : null;

    return NextResponse.json(
      {
        ...settings,
        ok: true,
        source: "db",
        fallbackSaved,
        memoryCached: false,
      },
      {
        headers: NO_STORE_HEADERS,
      },
    );
  } catch (error: any) {
    console.error("[settings:GET]", error);

    const fallback = await readSettingsFallback();

    if (fallback) {
      return NextResponse.json(
        {
          ...fallback,
          source: "cache_fallback",
          dbError: error?.message || "SETTINGS_GET_FAILED",
        },
        {
          headers: NO_STORE_HEADERS,
        },
      );
    }

    return errorResponse(error, "SETTINGS_GET_FAILED");
  }
}

export async function POST(req: Request) {
  try {
    const tenantId = await getTenantId();
    const body = await readRequestBody(req);
    const payload = normalizeIncomingSettings(body);
    const replace = body?.replace === true;
    const isAdmin = hasAdminSession(req);
    const isWholeAdminSave = isAdmin && isPlainObject(body?.settings);

    if (!isAdmin && (!hasTvSession(req) || !isTvWritableSettingsPayload(payload, replace))) {
      return unauthorizedResponse();
    }

    clearSettingsMemoryCache();

    const result = isWholeAdminSave
      ? await saveWholeSettings(tenantId, payload)
      : await saveSettings(tenantId, payload, replace);

    /*
      Admin sayfası tam ayar objesini gönderdiğinde ikinci bir DB okumasına
      gerek yok. Bu, connection_limit=1 ortamında kayıt süresini ciddi azaltır.
    */
    const settings = isWholeAdminSave
      ? deepMerge(DEFAULT_SETTINGS, payload)
      : await readSettingsMap(tenantId);

    writeSettingsMemoryCache(settings);

    const fallbackSaved = shouldWriteRuntimeSnapshot()
      ? await writeSettingsFallback(settings)
      : null;

    return jsonResponse({
      ...settings,
      ok: true,
      source: "db",
      fallbackSaved,
      saved: result.saved,
      keys: result.keys,
    });
  } catch (error: any) {
    console.error("[settings:POST]", error);
    return errorResponse(error, "SETTINGS_POST_FAILED");
  }
}

export async function PUT(req: Request) {
  try {
    const tenantId = await getTenantId();
    const body = await readRequestBody(req);
    const payload = normalizeIncomingSettings(body);
    const replace = body?.replace === true;
    const isAdmin = hasAdminSession(req);
    const isWholeAdminSave = isAdmin && isPlainObject(body?.settings);

    if (!isAdmin && (!hasTvSession(req) || !isTvWritableSettingsPayload(payload, replace))) {
      return unauthorizedResponse();
    }

    clearSettingsMemoryCache();

    const result = isWholeAdminSave
      ? await saveWholeSettings(tenantId, payload)
      : await saveSettings(tenantId, payload, replace);

    const settings = isWholeAdminSave
      ? deepMerge(DEFAULT_SETTINGS, payload)
      : await readSettingsMap(tenantId);

    writeSettingsMemoryCache(settings);

    const fallbackSaved = shouldWriteRuntimeSnapshot()
      ? await writeSettingsFallback(settings)
      : null;

    return jsonResponse({
      ...settings,
      ok: true,
      source: "db",
      fallbackSaved,
      saved: result.saved,
      keys: result.keys,
    });
  } catch (error: any) {
    console.error("[settings:PUT]", error);
    return errorResponse(error, "SETTINGS_PUT_FAILED");
  }
}
