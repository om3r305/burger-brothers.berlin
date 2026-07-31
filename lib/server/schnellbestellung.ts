import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma, getTenantId } from "@/lib/db";
import { MENU_NAV_KEYS, type MenuNavKey } from "@/lib/menu-navigation";
import {
  DEFAULT_REWARD_PROGRAM,
  normalizeRewardProgram,
  type SchnellRewardProgram,
} from "@/lib/rewards/config";
import {
  decideSchnellReward,
  rewardFromOrderMeta,
  rewardMetaPayload,
} from "@/lib/server/schnell-rewards";

export const SCHNELL_COOKIE = "bb_schnell_sess";
export const SCHNELL_SETTINGS_KEY = "schnellbestellung";
export const SCHNELL_PAUSE_KEY = "pause";
export const SCHNELL_DRINK_GROUPS_KEY = "bb_drink_groups_v1";
export const SCHNELL_EXTRA_GROUPS_KEY = "bb_extra_groups_v1";
const SCHNELL_GROUP_VARIANT_PREFIX = "sgv:";
const SCHNELL_SETTINGS_CACHE_MS = 5_000;

type SchnellSettingsCacheEntry = {
  tenantId: string;
  settings: SchnellSettings;
  tvPaused: boolean;
  expiresAt: number;
};

let schnellSettingsCache: SchnellSettingsCacheEntry | null = null;
let schnellSettingsPromise: Promise<SchnellSettingsCacheEntry> | null = null;

function invalidateSchnellSettingsCache() {
  schnellSettingsCache = null;
  schnellSettingsPromise = null;
}

export const SCHNELL_CATEGORY_ORDER = [
  "burger",
  "vegan",
  "lunch",
  ...MENU_NAV_KEYS.filter((key) => key !== "burger" && key !== "vegan"),
] as const;

export type SchnellCategory = MenuNavKey | "lunch";
export type SchnellQrMode = "static" | "dynamic";
export type SchnellCampaignType =
  | "percent_category"
  | "percent_product"
  | "fixed_product";

export type SchnellLunchMenu = {
  id: string;
  name: string;
  description: string;
  badge: string;
  enabled: boolean;
  vegetarian: boolean;
  sortOrder: number;
  menuPrice: number;
  burgerProductId: string;
  includedSideProductId: string;
  allowedSideProductIds: string[];
  allowExistingBurgerModifiers: boolean;
  allowNotes: boolean;
};

export type SchnellLunchSettings = {
  enabled: boolean;
  weekdays: number[];
  startTime: string;
  endTime: string;
  timezone: "Europe/Berlin";
  menus: SchnellLunchMenu[];
};

export type SchnellCampaign = {
  id: string;
  name: string;
  type: SchnellCampaignType;
  active: boolean;
  targetCategory?: SchnellCategory;
  targetProductId?: string;
  percent?: number;
  fixedPrice?: number;
  startsAt?: string;
  endsAt?: string;
  badgeText?: string;
};

export type SchnellCatalogRecord = {
  id: string;
  sku?: string | null;
  name: string;
  description: string;
  imageUrl: string;
  category: SchnellCategory;
  rawCategory: string;
  price: number;
  taxRate: 7 | 19;
  extrasJson: unknown[];
  allergens: unknown;
  activeFrom?: Date | null;
  activeTo?: Date | null;
  sourceKind: "product" | "group_variant" | "lunch_menu";
  depositAmount?: number;
  complimentaryTableSauce?: boolean;
  lunchMenu?: {
    menuId: string;
    burgerProductId: string;
    burgerName: string;
    includedSideProductId: string;
    includedSideName: string;
    sideOptions: Array<{
      id: string;
      name: string;
      price: number;
      upgradePrice: number;
      included: boolean;
    }>;
    vegetarian: boolean;
    badge: string;
    allowNotes: boolean;
  };
};

export type SchnellSettings = {
  enabled: boolean;
  paused: boolean;
  cashEnabled: boolean;
  onlineEnabled: boolean;
  splitEnabled: boolean;
  tvEnabled: boolean;
  soundEnabled: boolean;
  autoPrint: boolean;
  locationCheckEnabled: boolean;
  takeawayEnabled: boolean;
  orderHistoryEnabled: boolean;
  liveReadyAlertEnabled: boolean;
  backgroundReadyPushEnabled: boolean;
  iosHomeScreenFlowEnabled: boolean;
  timeSignalEnabled: boolean;
  timeWarningMinutes: number;
  timeCriticalMinutes: number;
  historyMaxOrders: number;
  historyDays: number;
  radiusMeters: number;
  maxAccuracyMeters: number;
  qrMode: SchnellQrMode;
  staticQrId: string;
  qrTtlMinutes: number;
  qrGraceMinutes: number;
  sessionMinutes: number;
  recheckMinutes: number;
  maxOrdersPerDevice: number;
  orderWindowMinutes: number;
  orderLimitPolicyVersion: number;
  numberStart: number;
  generation: number;
  shopLat: number;
  shopLng: number;
  visibleCategories: string[];
  hiddenProductIds: string[];
  campaigns: SchnellCampaign[];
  lunchMenu: SchnellLunchSettings;
  rewardProgram: SchnellRewardProgram;
};

export const DEFAULT_SCHNELL_SETTINGS: SchnellSettings = {
  enabled: false,
  paused: false,
  cashEnabled: true,
  onlineEnabled: false,
  splitEnabled: false,
  tvEnabled: true,
  soundEnabled: true,
  autoPrint: true,
  locationCheckEnabled: true,
  takeawayEnabled: true,
  orderHistoryEnabled: true,
  liveReadyAlertEnabled: true,
  backgroundReadyPushEnabled: true,
  iosHomeScreenFlowEnabled: false,
  timeSignalEnabled: true,
  timeWarningMinutes: 10,
  timeCriticalMinutes: 15,
  historyMaxOrders: 5,
  historyDays: 90,
  radiusMeters: 100,
  maxAccuracyMeters: 75,
  qrMode: "dynamic",
  staticQrId: "",
  qrTtlMinutes: 10,
  qrGraceMinutes: 2,
  sessionMinutes: 30,
  recheckMinutes: 15,
  maxOrdersPerDevice: 3,
  orderWindowMinutes: 15,
  orderLimitPolicyVersion: 2,
  numberStart: 1,
  generation: 1,
  shopLat: Number(process.env.SCHNELLBESTELLUNG_SHOP_LAT || 52.5881),
  shopLng: Number(process.env.SCHNELLBESTELLUNG_SHOP_LNG || 13.2866),
  visibleCategories: [],
  hiddenProductIds: [],
  campaigns: [],
  lunchMenu: {
    enabled: false,
    weekdays: [1, 2, 3, 4, 5],
    startTime: "10:00",
    endTime: "16:00",
    timezone: "Europe/Berlin",
    menus: [],
  },
  rewardProgram: DEFAULT_REWARD_PROGRAM,
};

function obj(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, any>)
    : {};
}

function clamp(value: unknown, min: number, max: number, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? Math.min(max, Math.max(min, parsed))
    : fallback;
}

function cleanText(value: unknown, max = 160) {
  return String(value ?? "").trim().slice(0, max);
}

function normalizeSchnellOrderStatus(value: unknown) {
  const status = String(value ?? "").toLowerCase().trim();
  if (status === "new" || status === "received") return "new";
  if (status === "preparing" || status === "accepted") return "preparing";
  if (status === "ready" || status === "abholbereit") return "ready";
  if (
    status === "done" ||
    status === "completed" ||
    status === "delivered" ||
    status === "issued" ||
    status === "cancelled" ||
    status === "canceled"
  ) {
    return "final";
  }
  return status;
}

function normalizeDateText(value: unknown) {
  const text = cleanText(value, 40);
  if (!text) return undefined;
  const date = new Date(text);
  return Number.isFinite(date.valueOf()) ? date.toISOString() : undefined;
}

export function normalizeSchnellCategory(value: unknown): SchnellCategory {
  const raw = String(value ?? "").toLowerCase().trim();

  if (raw.includes("mittag") || raw.includes("lunch")) return "lunch";
  if (raw.includes("vegan") || raw.includes("vegetar")) return "vegan";
  if (raw.includes("bubble") || raw.includes("boba")) return "bubbletea";
  if (raw.includes("donut") || raw.includes("doughnut")) return "donuts";
  if (raw.includes("hotdog") || raw.includes("hot dog")) return "hotdogs";
  if (
    raw.includes("drink") ||
    raw.includes("getränk") ||
    raw.includes("getraenk") ||
    raw.includes("cola") ||
    raw.includes("ayran")
  ) {
    return "drinks";
  }
  if (
    raw.includes("sauce") ||
    raw.includes("soß") ||
    raw.includes("soss") ||
    raw === "sos"
  ) {
    return "sauces";
  }
  if (
    raw.includes("extra") ||
    raw.includes("beilage") ||
    raw.includes("pommes") ||
    raw.includes("fries") ||
    raw.includes("kartoff") ||
    raw.includes("curly") ||
    raw.includes("sweet potato") ||
    raw.includes("süßkartoff") ||
    raw.includes("suesskartoff") ||
    raw.includes("snack")
  ) {
    return "extras";
  }

  return "burger";
}

export function schnellCategoryLabel(category: SchnellCategory) {
  const labels: Record<SchnellCategory, string> = {
    burger: "Burger",
    vegan: "Vegan / Vegetarisch",
    lunch: "Mittagsmenü",
    extras: "Extras",
    sauces: "Soßen",
    hotdogs: "Hot Dogs",
    drinks: "Getränke",
    donuts: "Donuts",
    bubbletea: "Bubble Tea",
  };

  return labels[category];
}

export function isComplimentaryTableSauce(
  category: unknown,
  productName: unknown,
) {
  if (normalizeSchnellCategory(category) !== "sauces") return false;

  const name = String(productName ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9äöüß\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return /^(?:heinz\s+)?(?:ketchup|mayo|mayonnaise)(?:\s+(?:(?:sauce|soße|sosse|portion|becher|dip|sachet|päckchen|paeckchen|packchen|packung|tüte|tuete|tute|\d+(?:[.,]\d+)?(?:ml|g)?|ml|g))){0,5}$/i.test(
    name,
  );
}

function normalizeCampaign(value: unknown, index: number): SchnellCampaign | null {
  const raw = obj(value);
  const type = String(raw.type || "").trim() as SchnellCampaignType;

  if (
    type !== "percent_category" &&
    type !== "percent_product" &&
    type !== "fixed_product"
  ) {
    return null;
  }

  const id = cleanText(raw.id, 100) || `schnell-campaign-${index + 1}`;
  const name = cleanText(raw.name || raw.title, 120) || "Angebot";
  const targetCategory = raw.targetCategory
    ? normalizeSchnellCategory(raw.targetCategory)
    : undefined;
  const targetProductId = cleanText(raw.targetProductId, 120) || undefined;
  const percent = clamp(raw.percent, 0, 100, 0);
  const fixedPrice = clamp(raw.fixedPrice, 0, 9999, 0);

  if (type === "percent_category" && !targetCategory) return null;
  if (
    (type === "percent_product" || type === "fixed_product") &&
    !targetProductId
  ) {
    return null;
  }
  if (type !== "fixed_product" && percent <= 0) return null;

  return {
    id,
    name,
    type,
    active: raw.active !== false,
    targetCategory,
    targetProductId,
    percent: type === "fixed_product" ? undefined : percent,
    fixedPrice: type === "fixed_product" ? fixedPrice : undefined,
    startsAt: normalizeDateText(raw.startsAt),
    endsAt: normalizeDateText(raw.endsAt),
    badgeText: cleanText(raw.badgeText, 60) || undefined,
  };
}


function normalizeClock(value: unknown, fallback: string) {
  const text = cleanText(value, 5);
  const match = text.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return fallback;

  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return fallback;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function normalizeProductId(value: unknown) {
  return cleanText(value, 180).replace(/[^a-zA-Z0-9:_%-]/g, "");
}

function normalizeLunchMenu(value: unknown, index: number): SchnellLunchMenu | null {
  const raw = obj(value);
  const id = normalizeProductId(raw.id) || `lunch-${index + 1}`;
  const name = cleanText(raw.name || raw.title, 160) || `Mittagsmenü ${index + 1}`;
  const burgerProductId = normalizeProductId(raw.burgerProductId);
  const includedSideProductId = normalizeProductId(raw.includedSideProductId);
  const allowedSideProductIds = Array.from(
    new Set(
      [
        includedSideProductId,
        ...(Array.isArray(raw.allowedSideProductIds)
          ? raw.allowedSideProductIds.map(normalizeProductId)
          : []),
      ].filter(Boolean),
    ),
  ).slice(0, 30);
  const rawMenuPrice =
    raw.menuPrice ??
    raw.price ??
    (Number.isFinite(Number(raw.menuPriceCents))
      ? Number(raw.menuPriceCents) / 100
      : 0);

  return {
    id,
    name,
    description: cleanText(raw.description, 500),
    badge: cleanText(raw.badge, 60) || "Mittagsmenü",
    enabled: raw.enabled !== false,
    vegetarian: raw.vegetarian === true,
    sortOrder: Math.round(clamp(raw.sortOrder, -9999, 9999, (index + 1) * 10)),
    menuPrice: Math.round(clamp(rawMenuPrice, 0, 9999, 0) * 100) / 100,
    burgerProductId,
    includedSideProductId,
    allowedSideProductIds,
    allowExistingBurgerModifiers: raw.allowExistingBurgerModifiers !== false,
    allowNotes: raw.allowNotes !== false,
  };
}

export function normalizeSchnellLunchSettings(value: unknown): SchnellLunchSettings {
  const raw = obj(value);
  const weekdays = Array.from(
    new Set(
      (Array.isArray(raw.weekdays) ? raw.weekdays : [1, 2, 3, 4, 5])
        .map(Number)
        .filter((day) => Number.isInteger(day) && day >= 1 && day <= 7),
    ),
  ).sort((left, right) => left - right);

  return {
    enabled: raw.enabled === true,
    weekdays: weekdays.length ? weekdays : [1, 2, 3, 4, 5],
    startTime: normalizeClock(raw.startTime, "10:00"),
    endTime: normalizeClock(raw.endTime, "16:00"),
    timezone: "Europe/Berlin",
    menus: Array.isArray(raw.menus)
      ? raw.menus
          .map(normalizeLunchMenu)
          .filter((menu): menu is SchnellLunchMenu => Boolean(menu))
          .slice(0, 100)
      : [],
  };
}

export function normalizeSchnellSettings(value: unknown): SchnellSettings {
  const raw = obj(value);
  const defaults = DEFAULT_SCHNELL_SETTINGS;
  const qrMode: SchnellQrMode = raw.qrMode === "static" ? "static" : "dynamic";
  const storedOrderWindow = clamp(
    raw.orderWindowMinutes,
    5,
    180,
    defaults.orderWindowMinutes,
  );
  const storedPolicyVersion = clamp(raw.orderLimitPolicyVersion, 1, 99, 1);
  const orderWindowMinutes =
    storedPolicyVersion >= 2 ? storedOrderWindow : Math.min(15, storedOrderWindow);

  return {
    enabled: raw.enabled === true,
    paused: raw.paused === true,
    cashEnabled: raw.cashEnabled !== false,
    onlineEnabled: raw.onlineEnabled === true,
    splitEnabled: raw.splitEnabled === true,
    tvEnabled: raw.tvEnabled !== false,
    soundEnabled: raw.soundEnabled !== false,
    autoPrint: raw.autoPrint !== false,
    locationCheckEnabled: raw.locationCheckEnabled !== false,
    takeawayEnabled: raw.takeawayEnabled !== false,
    orderHistoryEnabled: raw.orderHistoryEnabled !== false,
    liveReadyAlertEnabled: raw.liveReadyAlertEnabled !== false,
    backgroundReadyPushEnabled: raw.backgroundReadyPushEnabled !== false,
    iosHomeScreenFlowEnabled: raw.iosHomeScreenFlowEnabled === true,
    timeSignalEnabled: raw.timeSignalEnabled !== false,
    timeWarningMinutes: clamp(
      raw.timeWarningMinutes,
      1,
      120,
      defaults.timeWarningMinutes,
    ),
    timeCriticalMinutes: clamp(
      raw.timeCriticalMinutes,
      2,
      180,
      defaults.timeCriticalMinutes,
    ),
    historyMaxOrders: clamp(
      raw.historyMaxOrders,
      1,
      20,
      defaults.historyMaxOrders,
    ),
    historyDays: clamp(raw.historyDays, 1, 365, defaults.historyDays),
    radiusMeters: clamp(raw.radiusMeters, 25, 500, defaults.radiusMeters),
    maxAccuracyMeters: clamp(
      raw.maxAccuracyMeters,
      20,
      500,
      defaults.maxAccuracyMeters,
    ),
    qrMode,
    staticQrId: cleanText(raw.staticQrId, 160),
    qrTtlMinutes: clamp(raw.qrTtlMinutes, 2, 60, defaults.qrTtlMinutes),
    qrGraceMinutes: clamp(raw.qrGraceMinutes, 0, 10, defaults.qrGraceMinutes),
    sessionMinutes: clamp(raw.sessionMinutes, 5, 120, defaults.sessionMinutes),
    recheckMinutes: clamp(raw.recheckMinutes, 5, 60, defaults.recheckMinutes),
    maxOrdersPerDevice: clamp(
      raw.maxOrdersPerDevice,
      1,
      20,
      defaults.maxOrdersPerDevice,
    ),
    orderWindowMinutes,
    orderLimitPolicyVersion: 2,
    numberStart: clamp(raw.numberStart, 1, 999, defaults.numberStart),
    generation: clamp(raw.generation, 1, 999999, defaults.generation),
    shopLat: clamp(raw.shopLat, -90, 90, defaults.shopLat),
    shopLng: clamp(raw.shopLng, -180, 180, defaults.shopLng),
    visibleCategories: Array.isArray(raw.visibleCategories)
      ? raw.visibleCategories.map(String).filter(Boolean).slice(0, 50)
      : [],
    hiddenProductIds: Array.isArray(raw.hiddenProductIds)
      ? raw.hiddenProductIds.map(String).filter(Boolean).slice(0, 500)
      : [],
    campaigns: Array.isArray(raw.campaigns)
      ? raw.campaigns
          .map(normalizeCampaign)
          .filter((campaign): campaign is SchnellCampaign => Boolean(campaign))
          .slice(0, 100)
      : [],
    lunchMenu: normalizeSchnellLunchSettings(raw.lunchMenu),
    rewardProgram: normalizeRewardProgram(raw.rewardProgram),
  };
}

function newStaticQrId() {
  return randomBytes(18).toString("base64url");
}

async function readStoredSchnellSettings() {
  const tenantId = await getTenantId();
  const row = await prisma.setting.findUnique({
    where: { tenantId_key: { tenantId, key: SCHNELL_SETTINGS_KEY } },
    select: { value: true },
  });

  return { tenantId, settings: normalizeSchnellSettings(row?.value) };
}

async function readTvDineInPause(tenantId: string) {
  const row = await prisma.setting.findUnique({
    where: { tenantId_key: { tenantId, key: SCHNELL_PAUSE_KEY } },
    select: { value: true },
  });

  return obj(row?.value).dineIn === true;
}

export async function getSchnellSettings(options?: { includeTvPause?: boolean }) {
  const includeTvPause = options?.includeTvPause !== false;
  const now = Date.now();

  if (schnellSettingsCache && schnellSettingsCache.expiresAt > now) {
    return includeTvPause && schnellSettingsCache.tvPaused
      ? { ...schnellSettingsCache.settings, paused: true }
      : schnellSettingsCache.settings;
  }

  if (!schnellSettingsPromise) {
    schnellSettingsPromise = (async () => {
      const tenantId = await getTenantId();
      const [settingsRow, pauseRow] = await Promise.all([
        prisma.setting.findUnique({
          where: { tenantId_key: { tenantId, key: SCHNELL_SETTINGS_KEY } },
          select: { value: true },
        }),
        prisma.setting.findUnique({
          where: { tenantId_key: { tenantId, key: SCHNELL_PAUSE_KEY } },
          select: { value: true },
        }),
      ]);

      let settings = normalizeSchnellSettings(settingsRow?.value);
      if (!settings.staticQrId) {
        settings = { ...settings, staticQrId: newStaticQrId() };
        await prisma.setting.upsert({
          where: { tenantId_key: { tenantId, key: SCHNELL_SETTINGS_KEY } },
          update: { value: settings as unknown as Prisma.InputJsonValue },
          create: {
            tenantId,
            key: SCHNELL_SETTINGS_KEY,
            value: settings as unknown as Prisma.InputJsonValue,
          },
        });
      }

      return {
        tenantId,
        settings,
        tvPaused: obj(pauseRow?.value).dineIn === true,
        expiresAt: Date.now() + SCHNELL_SETTINGS_CACHE_MS,
      } satisfies SchnellSettingsCacheEntry;
    })().finally(() => {
      schnellSettingsPromise = null;
    });
  }

  const fresh = await schnellSettingsPromise;
  schnellSettingsCache = fresh;
  return includeTvPause && fresh.tvPaused
    ? { ...fresh.settings, paused: true }
    : fresh.settings;
}

export async function saveSchnellSettings(value: unknown) {
  const { tenantId, settings: current } = await readStoredSchnellSettings();
  const incoming = obj(value);
  const merged = normalizeSchnellSettings({
    ...current,
    ...incoming,
    staticQrId: cleanText(incoming.staticQrId, 160) || current.staticQrId || newStaticQrId(),
  });

  await prisma.setting.upsert({
    where: { tenantId_key: { tenantId, key: SCHNELL_SETTINGS_KEY } },
    update: { value: merged as unknown as Prisma.InputJsonValue },
    create: {
      tenantId,
      key: SCHNELL_SETTINGS_KEY,
      value: merged as unknown as Prisma.InputJsonValue,
    },
  });

  invalidateSchnellSettingsCache();
  return merged;
}

export async function rotateStaticSchnellQr() {
  const current = await getSchnellSettings({ includeTvPause: false });
  return saveSchnellSettings({ ...current, staticQrId: newStaticQrId() });
}

export async function invalidateSchnellSessions() {
  const current = await getSchnellSettings({ includeTvPause: false });
  return saveSchnellSettings({
    ...current,
    generation: Math.min(999999, current.generation + 1),
  });
}

function secret() {
  const value = String(
    process.env.SESSION_SECRET ||
      process.env.NEXTAUTH_SECRET ||
      process.env.AUTH_SECRET ||
      "",
  ).trim();

  if (!value) throw new Error("SESSION_SECRET_MISSING");
  return value;
}

function b64(value: string) {
  return Buffer.from(value).toString("base64url");
}

function unb64(value: string) {
  return Buffer.from(value, "base64url").toString("utf8");
}

function sign(data: string) {
  return createHmac("sha256", secret()).update(data).digest("base64url");
}

export function createSignedToken(payload: Record<string, unknown>) {
  const body = b64(JSON.stringify(payload));
  return `${body}.${sign(body)}`;
}

export function readSignedToken(token: string): Record<string, any> | null {
  try {
    const [body, signature] = token.split(".");
    if (!body || !signature) return null;

    const actual = Buffer.from(signature);
    const expected = Buffer.from(sign(body));

    if (
      actual.length !== expected.length ||
      !timingSafeEqual(actual, expected)
    ) {
      return null;
    }

    return JSON.parse(unb64(body));
  } catch {
    return null;
  }
}

export function createAccessToken(settings: SchnellSettings) {
  const now = Date.now();

  if (settings.qrMode === "static") {
    return createSignedToken({
      typ: "schnell-static-access",
      iat: now,
      sid: settings.staticQrId,
    });
  }

  return createSignedToken({
    typ: "schnell-access",
    iat: now,
    exp: now + settings.qrTtlMinutes * 60_000,
    gen: settings.generation,
    nonce: randomBytes(10).toString("hex"),
  });
}

export function verifyAccessToken(token: string, settings: SchnellSettings) {
  const payload = readSignedToken(token);
  if (!payload) return null;

  if (payload.typ === "schnell-static-access") {
    return String(payload.sid || "") === settings.staticQrId ? payload : null;
  }

  if (
    payload.typ !== "schnell-access" ||
    Number(payload.gen) !== settings.generation
  ) {
    return null;
  }

  const now = Date.now();
  if (Number(payload.exp) + settings.qrGraceMinutes * 60_000 < now) {
    return null;
  }

  return payload;
}

export function createSessionToken(
  settings: SchnellSettings,
  data: {
    deviceId: string;
    lat?: number;
    lng?: number;
    accuracy?: number;
    locationVerified?: boolean;
  },
) {
  const now = Date.now();
  return createSignedToken({
    typ: "schnell-session",
    iat: now,
    exp: now + settings.sessionMinutes * 60_000,
    locAt: now,
    gen: settings.generation,
    locationVerified: data.locationVerified === true,
    deviceId: data.deviceId,
    ...(Number.isFinite(data.lat) ? { lat: data.lat } : {}),
    ...(Number.isFinite(data.lng) ? { lng: data.lng } : {}),
    ...(Number.isFinite(data.accuracy) ? { accuracy: data.accuracy } : {}),
  });
}

export function verifySessionToken(token: string, settings: SchnellSettings) {
  const payload = readSignedToken(token);

  if (
    !payload ||
    payload.typ !== "schnell-session" ||
    Number(payload.gen) !== settings.generation ||
    Number(payload.exp) < Date.now()
  ) {
    return null;
  }

  return payload;
}

export function distanceMeters(
  firstLat: number,
  firstLng: number,
  secondLat: number,
  secondLng: number,
) {
  const radius = 6_371_000;
  const toRadians = (value: number) => (value * Math.PI) / 180;
  const latitude = toRadians(secondLat - firstLat);
  const longitude = toRadians(secondLng - firstLng);
  const haversine =
    Math.sin(latitude / 2) ** 2 +
    Math.cos(toRadians(firstLat)) *
      Math.cos(toRadians(secondLat)) *
      Math.sin(longitude / 2) ** 2;

  return 2 * radius * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

export function berlinBusinessDate(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Berlin",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}


function berlinScheduleParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Berlin",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const weekdays: Record<string, number> = {
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
    Sun: 7,
  };

  return {
    weekday: weekdays[values.weekday] || 1,
    minuteOfDay: Number(values.hour || 0) * 60 + Number(values.minute || 0),
  };
}

function clockMinutes(value: string) {
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}

export function getSchnellLunchAvailability(
  settings: SchnellSettings | SchnellLunchSettings,
  now = new Date(),
) {
  const lunch = "lunchMenu" in settings ? settings.lunchMenu : settings;
  if (!lunch.enabled || !lunch.menus.some((menu) => menu.enabled)) {
    return { active: false, availableUntil: null as string | null };
  }

  const { weekday, minuteOfDay } = berlinScheduleParts(now);
  const start = clockMinutes(lunch.startTime);
  const end = clockMinutes(lunch.endTime);
  if (start === end) {
    return { active: false, availableUntil: null as string | null };
  }

  const activeDays = new Set(lunch.weekdays);
  let active = false;
  let remainingMinutes = 0;

  if (start < end) {
    active = activeDays.has(weekday) && minuteOfDay >= start && minuteOfDay < end;
    remainingMinutes = end - minuteOfDay;
  } else if (minuteOfDay >= start) {
    active = activeDays.has(weekday);
    remainingMinutes = 24 * 60 - minuteOfDay + end;
  } else {
    const previousWeekday = weekday === 1 ? 7 : weekday - 1;
    active = activeDays.has(previousWeekday) && minuteOfDay < end;
    remainingMinutes = end - minuteOfDay;
  }

  return {
    active,
    availableUntil: active
      ? new Date(
          now.getTime() +
            Math.max(1, remainingMinutes) * 60_000 -
            now.getSeconds() * 1_000 -
            now.getMilliseconds(),
        ).toISOString()
      : null,
  };
}

function campaignIsActive(campaign: SchnellCampaign, now = new Date()) {
  if (!campaign.active) return false;

  const time = now.getTime();
  const starts = campaign.startsAt ? new Date(campaign.startsAt).getTime() : -Infinity;
  const ends = campaign.endsAt ? new Date(campaign.endsAt).getTime() : Infinity;

  return time >= starts && time <= ends;
}

export function getSchnellCampaignPrice(
  product: { id: string; category: string; price: number },
  settings: SchnellSettings,
  now = new Date(),
) {
  const category = normalizeSchnellCategory(product.category);
  const basePrice = Math.max(0, Number(product.price) || 0);
  const campaigns = settings.campaigns.filter((campaign) => {
    if (!campaignIsActive(campaign, now)) return false;
    if (campaign.type === "percent_category") {
      return campaign.targetCategory === category;
    }
    return campaign.targetProductId === product.id;
  });

  const candidates = campaigns.map((campaign) => {
    const finalPrice =
      campaign.type === "fixed_product"
        ? Math.min(basePrice, Math.max(0, Number(campaign.fixedPrice) || 0))
        : basePrice * (1 - Math.max(0, Math.min(100, Number(campaign.percent) || 0)) / 100);

    return {
      campaign,
      price: Math.round(finalPrice * 100) / 100,
    };
  });

  candidates.sort((left, right) => left.price - right.price);
  const best = candidates[0];

  if (!best || best.price >= basePrice) {
    return {
      price: basePrice,
      originalPrice: undefined as number | undefined,
      badgeText: undefined as string | undefined,
      campaign: null as SchnellCampaign | null,
    };
  }

  const percent = Math.round((1 - best.price / Math.max(basePrice, 0.01)) * 100);

  return {
    price: best.price,
    originalPrice: basePrice,
    badgeText: best.campaign.badgeText || (percent > 0 ? `-${percent}%` : "Angebot"),
    campaign: best.campaign,
  };
}


function toFiniteNumber(value: unknown, fallback = 0) {
  const parsed =
    typeof value === "number"
      ? value
      : Number(String(value ?? "").replace(",", "."));

  return Number.isFinite(parsed) ? parsed : fallback;
}

function toBoolean(value: unknown, fallback = true) {
  if (typeof value === "boolean") return value;
  if (value === undefined || value === null || value === "") return fallback;

  const text = String(value).trim().toLowerCase();

  if (["1", "true", "yes", "ja", "on", "aktiv"].includes(text)) return true;
  if (["0", "false", "no", "nein", "off", "inaktiv"].includes(text)) return false;

  return fallback;
}

function toOptionalDate(value: unknown) {
  if (!value) return null;

  const date = value instanceof Date ? value : new Date(String(value));

  return Number.isFinite(date.valueOf()) ? date : null;
}

function activeAt(
  active: unknown,
  startsAt: unknown,
  endsAt: unknown,
  now = new Date(),
) {
  if (!toBoolean(active, true)) return false;

  const starts = toOptionalDate(startsAt);
  const ends = toOptionalDate(endsAt);
  const time = now.getTime();

  if (starts && starts.getTime() > time) return false;
  if (ends && ends.getTime() < time) return false;

  return true;
}

function groupArray(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function stableGroupPart(value: unknown, fallback: string) {
  const text = cleanText(value, 180);

  return encodeURIComponent(text || fallback).slice(0, 180);
}

function groupVariantId(
  category: "drinks" | "extras",
  groupId: unknown,
  variantId: unknown,
) {
  return `${SCHNELL_GROUP_VARIANT_PREFIX}${category}:${stableGroupPart(
    groupId,
    "group",
  )}:${stableGroupPart(variantId, "variant")}`;
}

export function isSchnellGroupVariantId(value: unknown) {
  return String(value ?? "").startsWith(SCHNELL_GROUP_VARIANT_PREFIX);
}

function normalizeComparableName(value: unknown) {
  return String(value ?? "")
    .toLocaleLowerCase("de-DE")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function stripSchnellGroupPrefix(
  groupNameRaw: unknown,
  variantNameRaw: unknown,
) {
  const groupName = cleanText(groupNameRaw, 160);
  const variantName = cleanText(variantNameRaw, 160);

  if (!groupName || !variantName) return variantName;

  const groupComparable = normalizeComparableName(groupName);
  const variantComparable = normalizeComparableName(variantName);

  if (!variantComparable.startsWith(`${groupComparable} `)) {
    return variantName;
  }

  const groupWords = groupName
    .split(/[\s\-–—()]+/g)
    .map((word) => word.trim())
    .filter(Boolean);

  if (!groupWords.length) return variantName;

  const prefixPattern = groupWords
    .map(escapeRegex)
    .join("[\\s\\-–—()]*");
  const match = variantName.match(
    new RegExp(`^${prefixPattern}(?:\\s*[-–—:]\\s*|\\s+)`, "i"),
  );
  const cleaned = match ? variantName.slice(match[0].length).trim() : "";

  return cleaned || variantName;
}

export function cleanSchnellGroupVariantName(
  category: "drinks" | "extras",
  groupNameRaw: unknown,
  variantNameRaw: unknown,
) {
  const groupName = cleanText(groupNameRaw, 160);
  const variantName = cleanText(variantNameRaw, 160);

  // Admin panelindeki "Varianten" alanı müşteri ekranının gerçek ürün adıdır.
  // SKU ve grup adı yalnız kimliklendirme/gruplama için kullanılır; kart adına
  // eklenmez ve variant metninden otomatik olarak çıkarılmaz.
  if (variantName) return variantName;

  return groupName || (category === "drinks" ? "Getränk" : "Extra");
}

function normalizeGroupVariantProducts(
  category: "drinks" | "extras",
  value: unknown,
  now = new Date(),
): SchnellCatalogRecord[] {
  const records: SchnellCatalogRecord[] = [];

  groupArray(value).forEach((group: any, groupIndex) => {
    if (
      !activeAt(
        group?.active ?? group?.enabled,
        group?.activeFrom ?? group?.startAt ?? group?.startsAt,
        group?.activeTo ?? group?.endAt ?? group?.endsAt,
        now,
      )
    ) {
      return;
    }

    const groupName =
      cleanText(group?.name ?? group?.title, 160) ||
      (category === "drinks" ? "Getränk" : "Extra");
    const groupKey =
      group?.sku ??
      group?.code ??
      group?.slug ??
      group?.id ??
      `${category}-${groupIndex + 1}`;
    const variants = Array.isArray(group?.variants)
      ? group.variants
      : Array.isArray(group?.items)
        ? group.items
        : Array.isArray(group?.options)
          ? group.options
          : [];

    variants.forEach((variant: any, variantIndex: number) => {
      if (
        !activeAt(
          variant?.active ?? variant?.enabled,
          variant?.activeFrom ?? variant?.startAt ?? variant?.startsAt,
          variant?.activeTo ?? variant?.endAt ?? variant?.endsAt,
          now,
        )
      ) {
        return;
      }

      const variantName = cleanText(
        variant?.name ?? variant?.title ?? variant?.label,
        140,
      );
      const variantKey =
        variant?.id ??
        variant?.sku ??
        variant?.code ??
        variantName ??
        variantIndex + 1;
      const basePrice = Math.max(
        0,
        toFiniteNumber(variant?.price ?? variant?.preis, 0),
      );
      const depositAmount = Math.max(
        0,
        toFiniteNumber(
          variant?.pfandAmount ??
            variant?.depositAmount ??
            group?.pfandAmount ??
            group?.depositAmount,
          0,
        ),
      );
      const id = groupVariantId(category, groupKey, variantKey);
      const name = cleanSchnellGroupVariantName(
        category,
        groupName,
        variantName,
      );
      const depositNote =
        depositAmount > 0
          ? `inkl. ${depositAmount.toLocaleString("de-DE", {
              style: "currency",
              currency: "EUR",
            })} Pfand`
          : "";
      const description = [
        cleanText(group?.description ?? group?.desc, 500),
        depositNote,
      ]
        .filter(Boolean)
        .join(" · ");

      records.push({
        id,
        sku: cleanText(variant?.sku ?? variant?.code, 120) || id,
        name,
        description,
        imageUrl: cleanText(
          variant?.image ??
            variant?.imageUrl ??
            variant?.cover ??
            group?.image ??
            group?.imageUrl ??
            group?.cover,
          1000,
        ),
        category,
        rawCategory: category,
        price: Math.round((basePrice + depositAmount) * 100) / 100,
        taxRate:
          Number(variant?.taxRate ?? group?.taxRate) === 7
            ? 7
            : category === "drinks"
              ? 19
              : 7,
        extrasJson: [],
        allergens:
          variant?.allergens ??
          variant?.allergenJson ??
          group?.allergens ??
          group?.allergenJson ??
          [],
        activeFrom: null,
        activeTo: null,
        sourceKind: "group_variant",
        depositAmount,
      });
    });
  });

  return records;
}

function normalizeProductRecord(product: any): SchnellCatalogRecord {
  const category = normalizeSchnellCategory(product?.category);

  return {
    id: String(product?.id || ""),
    sku: product?.sku ? String(product.sku) : null,
    name: cleanText(product?.name, 180) || "Artikel",
    description: cleanText(product?.description, 1000),
    imageUrl: cleanText(product?.imageUrl, 1000),
    category,
    rawCategory: cleanText(product?.category, 100) || category,
    price: Math.max(0, toFiniteNumber(product?.price, 0)),
    taxRate: Number(product?.taxRate) === 19 ? 19 : 7,
    extrasJson: Array.isArray(product?.extrasJson) ? product.extrasJson : [],
    allergens: product?.allergens ?? [],
    activeFrom: product?.activeFrom ?? null,
    activeTo: product?.activeTo ?? null,
    sourceKind: "product",
    depositAmount: 0,
  };
}

export function buildSchnellGroupVariantProducts(
  drinkGroups: unknown,
  extraGroups: unknown,
  now = new Date(),
) {
  return [
    ...normalizeGroupVariantProducts("drinks", drinkGroups, now),
    ...normalizeGroupVariantProducts("extras", extraGroups, now),
  ];
}

export async function loadSchnellCatalogProducts(
  settings: SchnellSettings,
  options?: { applyVisibility?: boolean },
): Promise<SchnellCatalogRecord[]> {
  const tenantId = await getTenantId();
  const now = new Date();

  const [products, drinkGroupsRow, extraGroupsRow] = await Promise.all([
    prisma.product.findMany({
      where: { tenantId, active: true },
      orderBy: [{ order: "asc" }, { name: "asc" }],
    }),
    prisma.setting.findUnique({
      where: {
        tenantId_key: { tenantId, key: SCHNELL_DRINK_GROUPS_KEY },
      },
      select: { value: true },
    }),
    prisma.setting.findUnique({
      where: {
        tenantId_key: { tenantId, key: SCHNELL_EXTRA_GROUPS_KEY },
      },
      select: { value: true },
    }),
  ]);

  const regularProducts = products
    .map(normalizeProductRecord)
    .filter((product) => {
      if (product.activeFrom && product.activeFrom.getTime() > now.getTime()) {
        return false;
      }

      if (product.activeTo && product.activeTo.getTime() < now.getTime()) {
        return false;
      }

      return options?.applyVisibility === false
        ? true
        : schnellProductIsAllowed(product, settings);
    });

  const groupProducts = buildSchnellGroupVariantProducts(
    drinkGroupsRow?.value,
    extraGroupsRow?.value,
    now,
  ).filter((product) =>
    options?.applyVisibility === false
      ? true
      : schnellProductIsAllowed(product, settings),
  );

  return [...regularProducts, ...groupProducts];
}


export const SCHNELL_LUNCH_PRODUCT_PREFIX = "slm:";

export function schnellLunchProductId(menuId: string) {
  return `${SCHNELL_LUNCH_PRODUCT_PREFIX}${menuId}`;
}

export function isSchnellLunchProductId(value: unknown) {
  return String(value ?? "").startsWith(SCHNELL_LUNCH_PRODUCT_PREFIX);
}

function lunchMenuIdFromProductId(value: unknown) {
  const text = String(value ?? "");
  return isSchnellLunchProductId(text)
    ? text.slice(SCHNELL_LUNCH_PRODUCT_PREFIX.length)
    : "";
}

export function buildSchnellLunchCatalogProducts(
  products: SchnellCatalogRecord[],
  settings: SchnellSettings,
  now = new Date(),
  options?: { requireActive?: boolean },
): SchnellCatalogRecord[] {
  const availability = getSchnellLunchAvailability(settings, now);
  if (options?.requireActive !== false && !availability.active) return [];

  const productById = new Map(products.map((product) => [product.id, product]));

  return settings.lunchMenu.menus
    .filter((menu) => menu.enabled && menu.menuPrice > 0)
    .sort((left, right) => left.sortOrder - right.sortOrder || left.name.localeCompare(right.name, "de"))
    .flatMap((menu) => {
      const burger = productById.get(menu.burgerProductId);
      const includedSide = productById.get(menu.includedSideProductId);
      if (
        !burger ||
        !includedSide ||
        (burger.category !== "burger" && burger.category !== "vegan") ||
        includedSide.category !== "extras"
      ) {
        return [];
      }

      const sideOptions = menu.allowedSideProductIds
        .map((id) => productById.get(id))
        .filter(
          (product): product is SchnellCatalogRecord =>
            Boolean(product && product.category === "extras"),
        )
        .map((product) => ({
          id: product.id,
          name: product.name,
          price: Math.round(Number(product.price) * 100) / 100,
          upgradePrice:
            Math.round(
              Math.max(0, Number(product.price) - Number(includedSide.price)) * 100,
            ) / 100,
          included: product.id === includedSide.id,
        }));

      if (!sideOptions.some((side) => side.included)) return [];

      return [
        {
          id: schnellLunchProductId(menu.id),
          sku: `MITTAG-${menu.id}`,
          name: menu.name,
          description:
            menu.description ||
            `${burger.name} + ${includedSide.name} inklusive`,
          imageUrl: burger.imageUrl,
          category: "lunch" as const,
          rawCategory: "lunch",
          price: menu.menuPrice,
          taxRate: burger.taxRate,
          extrasJson: menu.allowExistingBurgerModifiers ? burger.extrasJson : [],
          allergens: burger.allergens,
          activeFrom: null,
          activeTo: null,
          sourceKind: "lunch_menu" as const,
          depositAmount: 0,
          lunchMenu: {
            menuId: menu.id,
            burgerProductId: burger.id,
            burgerName: burger.name,
            includedSideProductId: includedSide.id,
            includedSideName: includedSide.name,
            sideOptions,
            vegetarian: menu.vegetarian,
            badge: menu.badge,
            allowNotes: menu.allowNotes,
          },
        },
      ];
    });
}

export function schnellProductIsAllowed(
  product: { id: string; category: string; name: string },
  settings: SchnellSettings,
) {
  if (settings.hiddenProductIds.includes(product.id)) return false;

  // Empty keeps backward compatibility with older saved settings and means
  // "show every Schnellbestellung category". Once the admin saves explicit
  // category choices, only those categories are returned.
  if (
    settings.visibleCategories.length > 0 &&
    !settings.visibleCategories.includes(product.category)
  ) {
    return false;
  }

  return true;
}

type SchnellOrderDbClient = Pick<Prisma.TransactionClient, "order">;

async function activeDeviceOrders(
  client: SchnellOrderDbClient,
  params: {
    tenantId: string;
    deviceId: string;
    since: Date;
    take: number;
  },
) {
  const rows = await client.order.findMany({
    where: {
      tenantId: params.tenantId,
      channel: "schnellbestellung",
      ts: { gte: params.since },
      meta: { path: ["deviceId"], equals: params.deviceId },
    },
    select: { status: true, meta: true, ts: true },
    orderBy: { ts: "desc" },
    take: Math.max(1, Math.min(50, params.take)),
  });

  const activeStatuses = new Set(["new", "preparing", "ready"]);
  return rows.filter((row) => {
    const meta = obj(row.meta);
    const status = normalizeSchnellOrderStatus(
      meta.statusManual ?? row.status ?? "new",
    );
    return activeStatuses.has(status);
  });
}

function throwDeviceRateLimit(
  matchingDeviceOrders: Array<{ ts: Date }>,
  settings: SchnellSettings,
) {
  if (matchingDeviceOrders.length < settings.maxOrdersPerDevice) return;

  const oldestActiveTime = Math.min(
    ...matchingDeviceOrders.map((row) => row.ts.getTime()),
  );
  const retryAfterSeconds = Math.max(
    1,
    Math.ceil(
      (oldestActiveTime +
        settings.orderWindowMinutes * 60_000 -
        Date.now()) /
        1_000,
    ),
  );
  const error = new Error("DEVICE_RATE_LIMIT") as Error & {
    retryAfterSeconds?: number;
  };
  error.retryAfterSeconds = retryAfterSeconds;
  throw error;
}

async function prepareCashSchnellOrder(params: {
  tenantId: string;
  items: any[];
  deviceId: string;
  takeaway?: boolean;
}) {
  const settings = await getSchnellSettings();
  if (!settings.enabled || settings.paused || !settings.cashEnabled) {
    throw new Error("SCHNELL_UNAVAILABLE");
  }

  const takeaway = settings.takeawayEnabled && params.takeaway === true;
  const since = new Date(Date.now() - settings.orderWindowMinutes * 60_000);

  const [drinkGroupsRow, extraGroupsRow, matchingDeviceOrders] =
    await Promise.all([
      prisma.setting.findUnique({
        where: {
          tenantId_key: {
            tenantId: params.tenantId,
            key: SCHNELL_DRINK_GROUPS_KEY,
          },
        },
        select: { value: true },
      }),
      prisma.setting.findUnique({
        where: {
          tenantId_key: {
            tenantId: params.tenantId,
            key: SCHNELL_EXTRA_GROUPS_KEY,
          },
        },
        select: { value: true },
      }),
      activeDeviceOrders(prisma, {
        tenantId: params.tenantId,
        deviceId: params.deviceId,
        since,
        take: settings.maxOrdersPerDevice + 2,
      }),
    ]);

  throwDeviceRateLimit(matchingDeviceOrders, settings);

  const productIds = params.items
    .map((item) => String(item.productId || item.id || ""))
    .filter(Boolean);
  if (!productIds.length) throw new Error("EMPTY_CART");

  const lunchMenuById = new Map(
    settings.lunchMenu.menus.map((menu) => [menu.id, menu]),
  );
  const lunchLinkedProductIds = params.items.flatMap((item) => {
    const menuId = lunchMenuIdFromProductId(item.productId || item.id);
    const menu = lunchMenuById.get(menuId);
    if (!menu) return [];
    return [
      menu.burgerProductId,
      menu.includedSideProductId,
      ...menu.allowedSideProductIds,
      normalizeProductId(item.selectedSideProductId),
    ].filter(Boolean);
  });
  const regularProductIds = Array.from(
    new Set([...productIds, ...lunchLinkedProductIds]),
  ).filter(
    (productId) =>
      !isSchnellGroupVariantId(productId) &&
      !isSchnellLunchProductId(productId),
  );
  const products = regularProductIds.length
    ? await prisma.product.findMany({
        where: {
          tenantId: params.tenantId,
          id: { in: regularProductIds },
          active: true,
        },
      })
    : [];

  const productById = new Map<string, SchnellCatalogRecord>();
  products
    .map(normalizeProductRecord)
    .forEach((product) => productById.set(product.id, product));
  buildSchnellGroupVariantProducts(
    drinkGroupsRow?.value,
    extraGroupsRow?.value,
  ).forEach((product) => productById.set(product.id, product));

  let merchandise = 0;
  let discount = 0;
  let payable = 0;
  const campaignDetails: Prisma.InputJsonObject[] = [];
  const canonicalItems: any[] = [];
  const nowMs = Date.now();

  for (const rawItem of params.items.slice(0, 60)) {
    const requestedProductId = String(rawItem.productId || rawItem.id || "");
    const lunchMenuId = lunchMenuIdFromProductId(requestedProductId);

    if (lunchMenuId) {
      const availability = getSchnellLunchAvailability(settings);
      const menu = lunchMenuById.get(lunchMenuId);
      if (!availability.active || !menu?.enabled || menu.menuPrice <= 0) {
        throw new Error("LUNCH_MENU_UNAVAILABLE");
      }

      const burger = productById.get(menu.burgerProductId);
      const includedSide = productById.get(menu.includedSideProductId);
      const selectedSideId =
        normalizeProductId(rawItem.selectedSideProductId) ||
        menu.includedSideProductId;
      const selectedSide = productById.get(selectedSideId);
      const allowedSides = new Set(menu.allowedSideProductIds);
      const activeProduct = (product: SchnellCatalogRecord | undefined) =>
        Boolean(
          product &&
            (!product.activeFrom || product.activeFrom.getTime() <= nowMs) &&
            (!product.activeTo || product.activeTo.getTime() >= nowMs),
        );

      if (
        !activeProduct(burger) ||
        !activeProduct(includedSide) ||
        !activeProduct(selectedSide) ||
        (burger!.category !== "burger" && burger!.category !== "vegan") ||
        includedSide!.category !== "extras" ||
        selectedSide!.category !== "extras" ||
        !allowedSides.has(selectedSideId)
      ) {
        throw new Error("PRODUCT_UNAVAILABLE");
      }

      const qty = Math.max(
        1,
        Math.min(20, Math.floor(Number(rawItem.qty) || 1)),
      );
      const availableExtras =
        menu.allowExistingBurgerModifiers && Array.isArray(burger!.extrasJson)
          ? burger!.extrasJson
          : [];
      const selectedExtraIds = new Set(
        (Array.isArray(rawItem.extraIds) ? rawItem.extraIds : []).map(String),
      );
      const extras = availableExtras
        .filter((extra: any) =>
          selectedExtraIds.has(String(extra.id || extra.name)),
        )
        .map((extra: any) => ({
          id: String(extra.id || extra.name),
          name: String(extra.name || extra.label || "Extra"),
          label: String(extra.label || extra.name || "Extra"),
          price: Math.max(0, Number(extra.price) || 0),
        }));
      const extrasTotal = extras.reduce(
        (sum: number, extra: any) => sum + extra.price,
        0,
      );
      const upgradePrice =
        Math.round(
          Math.max(
            0,
            Number(selectedSide!.price) - Number(includedSide!.price),
          ) * 100,
        ) / 100;
      const sideLabel =
        selectedSideId === includedSide!.id
          ? `${includedSide!.name} inklusive`
          : `${selectedSide!.name} statt ${includedSide!.name} (+${upgradePrice.toLocaleString(
              "de-DE",
              { style: "currency", currency: "EUR" },
            )})`;
      const add = [
        {
          id: `lunch-side:${selectedSide!.id}`,
          name: sideLabel,
          label: sideLabel,
          price: upgradePrice,
          kind: "side_upgrade",
        },
        ...extras,
      ];
      const unitPrice = menu.menuPrice + upgradePrice + extrasTotal;

      merchandise += unitPrice * qty;
      payable += unitPrice * qty;
      canonicalItems.push({
        id: schnellLunchProductId(menu.id),
        sku: `MITTAG-${menu.id}`,
        name: menu.name,
        category: "lunch",
        price: menu.menuPrice,
        taxRate: burger!.taxRate,
        qty,
        add,
        note: menu.allowNotes ? cleanText(rawItem.note, 300) : "",
        sourceKind: "lunch_menu",
        lunchMenu: {
          menuId: menu.id,
          burgerProductId: burger!.id,
          burgerName: burger!.name,
          includedSideProductId: includedSide!.id,
          includedSideName: includedSide!.name,
          selectedSideProductId: selectedSide!.id,
          selectedSideName: selectedSide!.name,
          upgradePrice,
          menuPrice: menu.menuPrice,
          priceSource: "database_product_difference",
        },
      });
      continue;
    }

    const product = productById.get(requestedProductId);

    if (
      !product ||
      (product.activeFrom && product.activeFrom.getTime() > nowMs) ||
      (product.activeTo && product.activeTo.getTime() < nowMs) ||
      !schnellProductIsAllowed(product, settings)
    ) {
      throw new Error("PRODUCT_UNAVAILABLE");
    }

    const qty = Math.max(
      1,
      Math.min(20, Math.floor(Number(rawItem.qty) || 1)),
    );
    const availableExtras = Array.isArray(product.extrasJson)
      ? product.extrasJson
      : [];
    const selectedExtraIds = new Set(
      (Array.isArray(rawItem.extraIds) ? rawItem.extraIds : []).map(String),
    );
    const extras = availableExtras
      .filter((extra: any) =>
        selectedExtraIds.has(String(extra.id || extra.name)),
      )
      .map((extra: any) => ({
        id: String(extra.id || extra.name),
        name: String(extra.name || extra.label || "Extra"),
        label: String(extra.label || extra.name || "Extra"),
        price: Number(extra.price) || 0,
      }));
    const extrasTotal = extras.reduce(
      (sum: number, extra: any) => sum + extra.price,
      0,
    );
    const complimentaryTableSauce =
      !takeaway && isComplimentaryTableSauce(product.category, product.name);
    const campaignPrice = complimentaryTableSauce
      ? {
          price: 0,
          originalPrice: undefined as number | undefined,
          badgeText: undefined as string | undefined,
          campaign: null as SchnellCampaign | null,
        }
      : getSchnellCampaignPrice(
          {
            id: product.id,
            category: product.category,
            price: Number(product.price),
          },
          settings,
        );
    const baseUnit = complimentaryTableSauce
      ? 0
      : Number(product.price) + extrasTotal;
    const finalUnit =
      campaignPrice.price + (complimentaryTableSauce ? 0 : extrasTotal);

    merchandise += baseUnit * qty;
    payable += finalUnit * qty;
    discount += (baseUnit - finalUnit) * qty;

    if (campaignPrice.campaign) {
      campaignDetails.push({
        id: campaignPrice.campaign.id,
        name: campaignPrice.campaign.name,
        badgeText: campaignPrice.badgeText ?? null,
        productId: product.id,
        qty,
        amount: Math.round((baseUnit - finalUnit) * qty * 100) / 100,
      });
    }

    canonicalItems.push({
      id: product.id,
      sku: product.sku,
      name: product.name,
      category: normalizeSchnellCategory(product.category),
      price: campaignPrice.price,
      taxRate: product.taxRate,
      originalPrice: campaignPrice.originalPrice,
      qty,
      add: extras,
      note: cleanText(rawItem.note, 300),
      campaign: campaignPrice.campaign
        ? {
            id: campaignPrice.campaign.id,
            name: campaignPrice.campaign.name,
            badgeText: campaignPrice.badgeText,
          }
        : undefined,
      sourceKind: product.sourceKind,
      depositAmount: product.depositAmount || 0,
      complimentaryTableSauce,
      freeReason: complimentaryTableSauce ? "dine_in_table_sauce" : undefined,
    });
  }

  return {
    settings,
    takeaway,
    since,
    canonicalItems,
    campaignDetails,
    merchandise: Math.round(merchandise * 100) / 100,
    discount: Math.round(discount * 100) / 100,
    payable: Math.round(payable * 100) / 100,
  };
}

export async function createCashSchnellOrder(params: {
  items: any[];
  idempotencyKey: string;
  deviceId: string;
  session: any;
  takeaway?: boolean;
}) {
  const tenantId = await getTenantId();
  const businessDate = berlinBusinessDate();

  const existingBeforeTransaction = await prisma.order.findFirst({
    where: {
      tenantId,
      channel: "schnellbestellung",
      meta: { path: ["idempotencyKey"], equals: params.idempotencyKey },
    },
    orderBy: { ts: "desc" },
  });
  if (existingBeforeTransaction) {
    const meta = obj(existingBeforeTransaction.meta);
    return {
      order: existingBeforeTransaction,
      customerNumber: Number(meta.customerNumber),
      reused: true,
      reward: rewardFromOrderMeta(meta),
    };
  }

  // Ayarlar, ürünler ve sepet hesaplaması transaction dışında hazırlanır.
  // Interactive transaction yalnız yarış durumunda atomik olması gereken kısa
  // DB işlerini tutar; connection pool bağlantısı CPU işlemlerinde beklemez.
  const prepared = await prepareCashSchnellOrder({
    tenantId,
    items: params.items,
    deviceId: params.deviceId,
    takeaway: params.takeaway,
  });

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await prisma.$transaction(
        async (transaction) => {
          const existing = await transaction.order.findFirst({
            where: {
              tenantId,
              channel: "schnellbestellung",
              meta: {
                path: ["idempotencyKey"],
                equals: params.idempotencyKey,
              },
            },
            orderBy: { ts: "desc" },
          });

          if (existing) {
            const meta = obj(existing.meta);
            return {
              order: existing,
              customerNumber: Number(meta.customerNumber),
              reused: true,
              reward: rewardFromOrderMeta(meta),
            };
          }

          const matchingDeviceOrders = await activeDeviceOrders(transaction, {
            tenantId,
            deviceId: params.deviceId,
            since: prepared.since,
            take: prepared.settings.maxOrdersPerDevice + 2,
          });
          throwDeviceRateLimit(matchingDeviceOrders, prepared.settings);

          let discount = prepared.discount;
          let payable = prepared.payable;
          const rewardDecision = prepared.canonicalItems.some(
            (item) => item.category === "lunch",
          )
            ? null
            : await decideSchnellReward({
                transaction,
                tenantId,
                now: new Date(),
                deviceId: params.deviceId,
                decisionKey: params.idempotencyKey,
                program: prepared.settings.rewardProgram,
                items: prepared.canonicalItems.map((item) => ({
                  id: String(item.id || ""),
                  name: String(item.name || "Artikel"),
                  category: String(item.category || ""),
                  price: Number(item.price) || 0,
                  qty: Number(item.qty) || 1,
                })),
                payable,
              });
          const rewardWinId = rewardDecision ? randomUUID() : "";

          if (rewardDecision) {
            discount =
              Math.round((discount + rewardDecision.discountAmount) * 100) /
              100;
            payable = Math.max(
              0,
              Math.round((payable - rewardDecision.discountAmount) * 100) /
                100,
            );
          }

          const counterKey = `schnell-counter:${businessDate}`;
          const counter = await transaction.setting.findUnique({
            where: { tenantId_key: { tenantId, key: counterKey } },
            select: { value: true },
          });
          const lastNumber =
            Number(obj(counter?.value).lastNumber) ||
            prepared.settings.numberStart - 1;
          const customerNumber = lastNumber + 1;

          await transaction.setting.upsert({
            where: { tenantId_key: { tenantId, key: counterKey } },
            update: {
              value: {
                lastNumber: customerNumber,
                businessDate,
                updatedAt: new Date().toISOString(),
              },
            },
            create: {
              tenantId,
              key: counterKey,
              value: {
                lastNumber: customerNumber,
                businessDate,
                updatedAt: new Date().toISOString(),
              },
            },
          });

          const order = await transaction.order.create({
            data: {
              tenantId,
              mode: "dine_in",
              channel: "schnellbestellung",
              status: "new",
              merchandise: new Prisma.Decimal(prepared.merchandise),
              discount: new Prisma.Decimal(discount),
              surcharges: new Prisma.Decimal(0),
              total: new Prisma.Decimal(payable),
              customer: { name: `Nummer ${customerNumber}` },
              items: prepared.canonicalItems,
              meta: {
                source: "qr_quick_order",
                customerNumber,
                businessDate,
                tableNumber: null,
                paymentMethod: "cash",
                paymentStatus: "pay_at_counter",
                deviceId: params.deviceId,
                idempotencyKey: params.idempotencyKey,
                sessionIssuedAt: params.session.iat,
                printRequested: prepared.settings.autoPrint,
                tvEnabled: prepared.settings.tvEnabled,
                liveReadyAlertEnabled:
                  prepared.settings.liveReadyAlertEnabled,
                backgroundReadyPushEnabled:
                  prepared.settings.backgroundReadyPushEnabled,
                campaigns: prepared.campaignDetails,
                reward: rewardDecision
                  ? rewardMetaPayload(rewardWinId, rewardDecision)
                  : null,
                fulfillment: prepared.takeaway ? "takeaway" : "eat_here",
                takeaway: prepared.takeaway,
                timeSignalEnabled: prepared.settings.timeSignalEnabled,
                timeWarningMinutes: prepared.settings.timeWarningMinutes,
                timeCriticalMinutes: Math.max(
                  prepared.settings.timeWarningMinutes + 1,
                  prepared.settings.timeCriticalMinutes,
                ),
                createdAt: new Date().toISOString(),
              },
            },
          });

          if (rewardDecision) {
            await transaction.schnellRewardWin.create({
              data: {
                id: rewardWinId,
                tenantId,
                orderId: order.id,
                businessDate,
                slotIndex: rewardDecision.slotIndex,
                deviceTokenHash: rewardDecision.deviceTokenHash,
                rewardType: rewardDecision.definition.type,
                rewardCode: rewardDecision.code,
                rewardLabel: rewardDecision.label,
                rewardData: rewardMetaPayload(rewardWinId, rewardDecision),
                discountAmount: new Prisma.Decimal(
                  rewardDecision.discountAmount,
                ),
                status: "won",
              },
            });
          }

          return {
            order,
            customerNumber,
            reused: false,
            reward: rewardDecision
              ? { winId: rewardWinId, ...rewardDecision.publicReward }
              : null,
          };
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          maxWait: 5_000,
          timeout: 15_000,
        },
      );
    } catch (error: any) {
      if (error?.code === "P2034" && attempt < 2) continue;
      if (error?.code === "P2024") {
        const busyError = new Error("DB_BUSY") as Error & {
          retryAfterSeconds?: number;
        };
        busyError.retryAfterSeconds = 3;
        throw busyError;
      }
      throw error;
    }
  }

  throw new Error("ORDER_TRANSACTION_FAILED");
}
