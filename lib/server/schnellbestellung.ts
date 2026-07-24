import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma, getTenantId } from "@/lib/db";

export const SCHNELL_COOKIE = "bb_schnell_sess";
export const SCHNELL_SETTINGS_KEY = "schnellbestellung";
export const SCHNELL_PAUSE_KEY = "pause";

export const SCHNELL_CATEGORY_ORDER = [
  "burger",
  "vegan",
  "extras",
  "sauces",
  "hotdogs",
  "drinks",
  "donuts",
  "bubbletea",
] as const;

export type SchnellCategory = (typeof SCHNELL_CATEGORY_ORDER)[number];
export type SchnellQrMode = "static" | "dynamic";
export type SchnellCampaignType =
  | "percent_category"
  | "percent_product"
  | "fixed_product";

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

export type SchnellSettings = {
  enabled: boolean;
  paused: boolean;
  cashEnabled: boolean;
  onlineEnabled: boolean;
  splitEnabled: boolean;
  tvEnabled: boolean;
  soundEnabled: boolean;
  autoPrint: boolean;
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
  numberStart: number;
  generation: number;
  shopLat: number;
  shopLng: number;
  visibleCategories: string[];
  hiddenProductIds: string[];
  campaigns: SchnellCampaign[];
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
  radiusMeters: 100,
  maxAccuracyMeters: 75,
  qrMode: "static",
  staticQrId: "",
  qrTtlMinutes: 10,
  qrGraceMinutes: 2,
  sessionMinutes: 30,
  recheckMinutes: 15,
  maxOrdersPerDevice: 3,
  orderWindowMinutes: 30,
  numberStart: 1,
  generation: 1,
  shopLat: Number(process.env.SCHNELLBESTELLUNG_SHOP_LAT || 52.5881),
  shopLng: Number(process.env.SCHNELLBESTELLUNG_SHOP_LNG || 13.2866),
  visibleCategories: [],
  hiddenProductIds: [],
  campaigns: [],
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

function normalizeDateText(value: unknown) {
  const text = cleanText(value, 40);
  if (!text) return undefined;
  const date = new Date(text);
  return Number.isFinite(date.valueOf()) ? date.toISOString() : undefined;
}

export function normalizeSchnellCategory(value: unknown): SchnellCategory {
  const raw = String(value ?? "").toLowerCase().trim();

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
    raw.includes("pommes") ||
    raw.includes("fries") ||
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

  return /^(?:heinz\s+)?(?:ketchup|mayo|mayonnaise)(?:\s+(?:portion|becher))?$/i.test(
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

export function normalizeSchnellSettings(value: unknown): SchnellSettings {
  const raw = obj(value);
  const defaults = DEFAULT_SCHNELL_SETTINGS;
  const qrMode: SchnellQrMode = raw.qrMode === "dynamic" ? "dynamic" : "static";

  return {
    enabled: raw.enabled === true,
    paused: raw.paused === true,
    cashEnabled: raw.cashEnabled !== false,
    onlineEnabled: raw.onlineEnabled === true,
    splitEnabled: raw.splitEnabled === true,
    tvEnabled: raw.tvEnabled !== false,
    soundEnabled: raw.soundEnabled !== false,
    autoPrint: raw.autoPrint !== false,
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
    orderWindowMinutes: clamp(
      raw.orderWindowMinutes,
      5,
      180,
      defaults.orderWindowMinutes,
    ),
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
  const { tenantId, settings: stored } = await readStoredSchnellSettings();
  let settings = stored;

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

  if (options?.includeTvPause === false) return settings;

  const tvPaused = await readTvDineInPause(tenantId).catch(() => false);
  return tvPaused ? { ...settings, paused: true } : settings;
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
  data: { lat: number; lng: number; accuracy: number; deviceId: string },
) {
  const now = Date.now();
  return createSignedToken({
    typ: "schnell-session",
    iat: now,
    exp: now + settings.sessionMinutes * 60_000,
    locAt: now,
    gen: settings.generation,
    ...data,
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

function productIsAllowed(
  product: { id: string; category: string; name: string },
  settings: SchnellSettings,
) {
  if (settings.hiddenProductIds.includes(product.id)) return false;
  if (
    settings.visibleCategories.length > 0 &&
    !settings.visibleCategories.includes(product.category) &&
    !settings.visibleCategories.includes(normalizeSchnellCategory(product.category))
  ) {
    return false;
  }
  if (isComplimentaryTableSauce(product.category, product.name)) return false;
  return true;
}

export async function createCashSchnellOrder(params: {
  items: any[];
  idempotencyKey: string;
  deviceId: string;
  session: any;
}) {
  const tenantId = await getTenantId();
  const businessDate = berlinBusinessDate();

  for (let attempt = 0; attempt < 4; attempt += 1) {
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
            };
          }

          const [settingsRow, pauseRow] = await Promise.all([
            transaction.setting.findUnique({
              where: {
                tenantId_key: { tenantId, key: SCHNELL_SETTINGS_KEY },
              },
              select: { value: true },
            }),
            transaction.setting.findUnique({
              where: { tenantId_key: { tenantId, key: SCHNELL_PAUSE_KEY } },
              select: { value: true },
            }),
          ]);

          const settings = normalizeSchnellSettings(settingsRow?.value);
          const tvPaused = obj(pauseRow?.value).dineIn === true;

          if (
            !settings.enabled ||
            settings.paused ||
            tvPaused ||
            !settings.cashEnabled
          ) {
            throw new Error("SCHNELL_UNAVAILABLE");
          }

          const since = new Date(Date.now() - settings.orderWindowMinutes * 60_000);
          const recent = await transaction.order.findMany({
            where: {
              tenantId,
              channel: "schnellbestellung",
              ts: { gte: since },
            },
            select: { meta: true },
            take: 100,
          });
          const deviceOrderCount = recent.filter(
            (row) => obj(row.meta).deviceId === params.deviceId,
          ).length;

          if (deviceOrderCount >= settings.maxOrdersPerDevice) {
            throw new Error("DEVICE_RATE_LIMIT");
          }

          const productIds = params.items
            .map((item) => String(item.productId || item.id || ""))
            .filter(Boolean);

          if (!productIds.length) throw new Error("EMPTY_CART");

          const products = await transaction.product.findMany({
            where: { tenantId, id: { in: productIds }, active: true },
          });
          const productById = new Map(products.map((product) => [product.id, product]));

          let merchandise = 0;
          let discount = 0;
          let payable = 0;
          const campaignDetails: Prisma.InputJsonObject[] = [];
          const canonicalItems: any[] = [];

          for (const rawItem of params.items.slice(0, 60)) {
            const product = productById.get(
              String(rawItem.productId || rawItem.id || ""),
            );

            if (
              !product ||
              (product.activeFrom && product.activeFrom.getTime() > Date.now()) ||
              (product.activeTo && product.activeTo.getTime() < Date.now()) ||
              !productIsAllowed(product, settings)
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
            const campaignPrice = getSchnellCampaignPrice(
              {
                id: product.id,
                category: product.category,
                price: Number(product.price),
              },
              settings,
            );
            const baseUnit = Number(product.price) + extrasTotal;
            const finalUnit = campaignPrice.price + extrasTotal;

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
            });
          }

          merchandise = Math.round(merchandise * 100) / 100;
          discount = Math.round(discount * 100) / 100;
          payable = Math.round(payable * 100) / 100;

          const counterKey = `schnell-counter:${businessDate}`;
          const counter = await transaction.setting.findUnique({
            where: { tenantId_key: { tenantId, key: counterKey } },
            select: { value: true },
          });
          const lastNumber =
            Number(obj(counter?.value).lastNumber) || settings.numberStart - 1;
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
              merchandise: new Prisma.Decimal(merchandise),
              discount: new Prisma.Decimal(discount),
              surcharges: new Prisma.Decimal(0),
              total: new Prisma.Decimal(payable),
              customer: { name: `Nummer ${customerNumber}` },
              items: canonicalItems,
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
                printRequested: settings.autoPrint,
                tvEnabled: settings.tvEnabled,
                campaigns: campaignDetails,
                createdAt: new Date().toISOString(),
              },
            },
          });

          return { order, customerNumber, reused: false };
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          maxWait: 10_000,
          timeout: 30_000,
        },
      );
    } catch (error: any) {
      if (error?.code === "P2034" && attempt < 3) continue;
      throw error;
    }
  }

  throw new Error("ORDER_TRANSACTION_FAILED");
}
