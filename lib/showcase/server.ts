import { Prisma } from "@prisma/client";
import { prisma, getTenantId } from "@/lib/db";
import { getServerSettings } from "@/lib/server/settings";
import { siteConfig } from "@/config/site.config";
import {
  getThemeLogo,
  getThemePreset,
  getThemeVideo,
  resolveActiveTheme,
} from "@/lib/themes";
import {
  createDefaultShowcaseDocument,
  normalizeShowcaseDocument,
  normalizeShowcaseMediaList,
} from "./config";
import {
  normalizeShowcaseCategory,
  showcaseCategoryLabel,
} from "./runtime";
import { campaignScenePatch } from "./editor";
import type {
  ShowcaseBranding,
  ShowcaseCampaign,
  ShowcaseDocument,
  ShowcaseMediaItem,
  ShowcaseProduct,
  ShowcaseSnapshot,
  ShowcaseScreen,
  ShowcaseReview,
  ShowcaseWeather,
  ShowcaseBestseller,
} from "./types";

export const SHOWCASE_DRAFT_KEY = "showcase:draft";
export const SHOWCASE_PUBLISHED_KEY = "showcase:published";
export const SHOWCASE_MEDIA_KEY = "showcase:media";
export const SHOWCASE_SCREENS_KEY = "showcase:screens";
export const SHOWCASE_REVIEWS_KEY = "showcase:reviews";

export const DEFAULT_SHOWCASE_SCREENS: ShowcaseScreen[] = [
  { slug: "main", name: "Ana vitrin", orientation: "landscape", active: true },
  { slug: "brand", name: "Marka ve video", orientation: "landscape", active: true },
  { slug: "menu", name: "Dijital menü", orientation: "landscape", active: true },
  { slug: "announcement", name: "Duyuru ve kampanya", orientation: "landscape", active: true },
];

export function normalizeScreenSlug(value: any) {
  const slug = String(value || "main").trim().toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 60);
  return slug || "main";
}
function draftKey(slug: string) { return slug === "main" ? SHOWCASE_DRAFT_KEY : `showcase:screen:${slug}:draft`; }
function publishedKey(slug: string) { return slug === "main" ? SHOWCASE_PUBLISHED_KEY : `showcase:screen:${slug}:published`; }
function normalizeScreens(value: any): ShowcaseScreen[] {
  const rows = Array.isArray(value) ? value : DEFAULT_SHOWCASE_SCREENS;
  const seen = new Set<string>();
  const out = rows.map((row: any) => ({
    slug: normalizeScreenSlug(row?.slug),
    name: String(row?.name || row?.slug || "Ekran").trim().slice(0, 100),
    orientation: ["landscape", "portrait", "ultrawide"].includes(row?.orientation) ? row.orientation : "landscape",
    active: row?.active !== false,
  } as ShowcaseScreen)).filter((row: ShowcaseScreen) => !seen.has(row.slug) && seen.add(row.slug));
  if (!out.some((row) => row.slug === "main")) out.unshift(DEFAULT_SHOWCASE_SCREENS[0]);
  return out.slice(0, 30);
}
function normalizeReviews(value: any): ShowcaseReview[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 250).map((r: any) => ({
    id: String(r?.id || r?.reviewId || `review-${Date.now()}-${Math.random()}`),
    authorName: String(r?.authorName || r?.reviewer?.displayName || "Google Nutzer").slice(0, 100),
    authorPhotoUrl: r?.authorPhotoUrl || r?.reviewer?.profilePhotoUrl || undefined,
    rating: Math.max(1, Math.min(5, Number(r?.rating || r?.starRating || 5))),
    comment: String(r?.comment || "").slice(0, 1500),
    photoUrls: Array.isArray(r?.photoUrls) ? r.photoUrls.filter(Boolean).slice(0, 8) : [],
    createTime: r?.createTime || undefined, updateTime: r?.updateTime || undefined,
    approved: r?.approved === true, source: r?.source === "manual" ? "manual" : "google",
  }));
}

const DRINK_GROUPS_KEY = "bb_drink_groups_v1";
const EXTRA_GROUPS_KEY = "bb_extra_groups_v1";

function decimal(value: any) {
  if (value instanceof Prisma.Decimal) return value.toNumber();
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function object(value: any): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function stringArray(value: any) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item ?? "").trim()).filter(Boolean);
}

function array(value: any) {
  return Array.isArray(value) ? value : [];
}

function bool(value: any, fallback = true) {
  return typeof value === "boolean" ? value : fallback;
}

function itemIsActive(item: any, now = Date.now()) {
  if (!bool(item?.active ?? item?.enabled, true)) return false;
  const start = dateMs(item?.activeFrom ?? item?.startAt ?? item?.startsAt, -Infinity);
  const end = dateMs(item?.activeTo ?? item?.endAt ?? item?.endsAt, Infinity);
  return now >= start && now <= end;
}

function dateMs(value: any, fallback: number) {
  if (!value) return fallback;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function roundDisplayPrice(value: number) {
  const safe = Math.max(0, Number(value) || 0);
  return Number((Math.round(safe / 0.1) * 0.1).toFixed(2));
}

function campaignPayload(row: any) {
  return object(row?.payload);
}

function campaignIsActive(row: any, now = Date.now()) {
  const payload = campaignPayload(row);
  if (payload.enabled === false || payload.active === false) return false;
  const start = dateMs(row?.startsAt ?? payload.startsAt ?? payload.startAt, -Infinity);
  const end = dateMs(row?.endsAt ?? payload.endsAt ?? payload.endAt, Infinity);
  return now >= start && now <= end;
}

function campaignMode(row: any): "delivery" | "pickup" | "both" {
  const mode = String(campaignPayload(row)?.mode || "both").toLowerCase();
  if (mode === "delivery") return "delivery";
  if (mode === "pickup") return "pickup";
  return "both";
}

function campaignMatchesProduct(row: any, product: any) {
  const payload = campaignPayload(row);
  const productIds = Array.from(
    new Set(
      [
        ...(Array.isArray(payload.productIds) ? payload.productIds : []),
        ...(payload.targetProductId ? [payload.targetProductId] : []),
        ...(payload.productId ? [payload.productId] : []),
        ...(payload.sku ? [payload.sku] : []),
      ]
        .map((value) => String(value ?? "").trim())
        .filter(Boolean),
    ),
  );
  const productKeys = new Set([String(product?.id || ""), String(product?.sku || "")]);
  if (productIds.some((id) => productKeys.has(id))) return true;

  const categories = [
    ...(Array.isArray(payload.categories) ? payload.categories : []),
    ...(payload.targetCategory ? [payload.targetCategory] : []),
    ...(payload.category ? [payload.category] : []),
  ]
    .map((value) => normalizeShowcaseCategory(String(value)))
    .filter(Boolean);

  if (!categories.length) return false;
  return categories.includes(normalizeShowcaseCategory(product?.category));
}

function campaignValue(row: any) {
  const payload = campaignPayload(row);
  const kindText = String(payload.kind || payload.type || "").toLowerCase();
  const typeText = String(payload.type || "").toLowerCase();
  const kind = kindText.includes("newprice")
    ? "newPrice"
    : kindText.includes("absolute") || kindText.includes("fixed") || typeText.includes("fixed")
      ? "absolute"
      : "percent";
  const raw =
    kind === "percent"
      ? Number(payload.percent ?? payload.value ?? payload.amount ?? 0)
      : Number(payload.value ?? payload.amount ?? payload.fixed ?? 0);
  return { kind, value: Number.isFinite(raw) ? Math.max(0, raw) : 0 } as const;
}

function campaignPriority(row: any) {
  return Number(campaignPayload(row)?.priority ?? 100) || 0;
}

function productCampaignPrice(product: any, campaigns: any[]) {
  const base = roundDisplayPrice(decimal(product?.price));
  const matches = (campaigns || [])
    .filter((campaign) => campaignIsActive(campaign) && campaignMatchesProduct(campaign, product))
    .sort((a, b) => {
      const priority = campaignPriority(b) - campaignPriority(a);
      if (priority) return priority;
      return campaignValue(b).value - campaignValue(a).value;
    });

  const campaign = matches[0];
  if (!campaign) {
    return {
      displayPrice: base,
      originalPrice: undefined,
      campaignBadge: undefined,
      campaignTitle: undefined,
      campaignMode: undefined,
      campaignEndsAt: undefined,
    };
  }

  const payload = campaignPayload(campaign);
  const { kind, value } = campaignValue(campaign);
  let final = base;
  if (kind === "percent") final = base * (1 - Math.min(100, value) / 100);
  if (kind === "absolute") final = base - value;
  if (kind === "newPrice") final = value;
  final = roundDisplayPrice(final);

  if (!(final < base)) {
    return {
      displayPrice: base,
      originalPrice: undefined,
      campaignBadge: undefined,
      campaignTitle: undefined,
      campaignMode: undefined,
      campaignEndsAt: undefined,
    };
  }

  const automaticBadge =
    kind === "percent"
      ? `-${Math.round(Math.min(100, value))}%`
      : kind === "absolute"
        ? `-${value.toFixed(2).replace(".", ",")} €`
        : "AKTION";

  return {
    displayPrice: final,
    originalPrice: base,
    campaignBadge: String(payload.badge || payload.badgeText || campaign.badgeText || automaticBadge),
    campaignTitle: String(payload.name || payload.title || campaign.title || "Aktion"),
    campaignMode: campaignMode(campaign),
    campaignEndsAt: campaign.endsAt ? new Date(campaign.endsAt).toISOString() : undefined,
  };
}

export function requestOrigin(req: Request) {
  try {
    const configured = String(
      process.env.NEXT_PUBLIC_BASE_URL ||
        process.env.NEXT_PUBLIC_SITE_URL ||
        process.env.SITE_URL ||
        "",
    ).trim();
    return configured ? new URL(configured).origin : new URL(req.url).origin;
  } catch {
    return "https://www.burger-brothers.berlin";
  }
}

async function readSettingValues(tenantId: string, keys: string[]) {
  const rows = await prisma.setting.findMany({
    where: { tenantId, key: { in: keys } },
    select: { key: true, value: true },
  });

  return new Map(rows.map((row) => [row.key, row.value]));
}

export async function readShowcaseAdminState(siteUrl: string, requestedSlug = "main") {
  const tenantId = await getTenantId();
  const slug = normalizeScreenSlug(requestedSlug);
  const values = await readSettingValues(tenantId, [
    draftKey(slug), publishedKey(slug), SHOWCASE_MEDIA_KEY, SHOWCASE_SCREENS_KEY, SHOWCASE_REVIEWS_KEY,
  ]);
  const screens = normalizeScreens(values.get(SHOWCASE_SCREENS_KEY));
  const screen = screens.find((row) => row.slug === slug) || screens[0];
  const effectiveSlug = screen.slug;
  const pubKey = publishedKey(effectiveSlug);
  const drKey = draftKey(effectiveSlug);
  let publishedRaw = values.get(pubKey);
  if (!publishedRaw && effectiveSlug !== "main") {
    const fallback = await readSettingValues(tenantId, [SHOWCASE_PUBLISHED_KEY]);
    publishedRaw = fallback.get(SHOWCASE_PUBLISHED_KEY);
  }
  const published = normalizeShowcaseDocument(publishedRaw, siteUrl);
  const draft = values.has(drKey) ? normalizeShowcaseDocument(values.get(drKey), siteUrl) : published;
  const media = normalizeShowcaseMediaList(values.get(SHOWCASE_MEDIA_KEY));
  const reviews = normalizeReviews(values.get(SHOWCASE_REVIEWS_KEY));
  return { tenantId, slug: effectiveSlug, screen, screens, draft, published, media, reviews };
}


export async function readPublishedShowcaseVersion(requestedSlug = "main") {
  const tenantId = await getTenantId();
  const slug = normalizeScreenSlug(requestedSlug);
  const values = await readSettingValues(tenantId, [publishedKey(slug), SHOWCASE_PUBLISHED_KEY]);
  const raw = values.get(publishedKey(slug)) ?? values.get(SHOWCASE_PUBLISHED_KEY);
  const version = raw && typeof raw === "object" && !Array.isArray(raw)
    ? String((raw as Record<string, unknown>).version || "")
    : "";
  return { slug, version };
}

export async function saveShowcaseSetting(
  tenantId: string,
  key: string,
  value: ShowcaseDocument | ShowcaseMediaItem[],
) {
  await prisma.setting.upsert({
    where: { tenantId_key: { tenantId, key } },
    update: { value: value as Prisma.InputJsonValue },
    create: { tenantId, key, value: value as Prisma.InputJsonValue },
  });
}

function mapProduct(item: any, campaigns: any[]): ShowcaseProduct {
  const pricing = productCampaignPrice(item, campaigns);
  const category = normalizeShowcaseCategory(item.category);
  const description = item.description ? String(item.description).trim() : undefined;

  return {
    id: String(item.id || item.sku || ""),
    sku: item.sku ? String(item.sku) : undefined,
    name: String(item.name || "Produkt"),
    description,
    ingredientsText: description,
    allergens: stringArray(item.allergens),
    imageUrl: item.imageUrl ? String(item.imageUrl) : undefined,
    category,
    categoryLabel: showcaseCategoryLabel(category, "de"),
    groupKey: item.groupKey ? String(item.groupKey) : category,
    groupLabel: item.groupLabel
      ? String(item.groupLabel)
      : showcaseCategoryLabel(category, "de"),
    order: item.order == null ? undefined : Number(item.order),
    depositAmount: Math.max(0, decimal(item.depositAmount ?? item.pfandAmount)),
    price: roundDisplayPrice(decimal(item.price)),
    displayPrice: pricing.displayPrice,
    originalPrice: pricing.originalPrice,
    campaignBadge: pricing.campaignBadge,
    campaignTitle: pricing.campaignTitle,
    campaignMode: pricing.campaignMode,
    campaignEndsAt: pricing.campaignEndsAt,
    active: item.active !== false,
  };
}

function mapVariantGroups(
  rawGroups: any,
  category: "drinks" | "extras",
  campaigns: any[],
): ShowcaseProduct[] {
  const output: ShowcaseProduct[] = [];

  array(rawGroups).forEach((rawGroup, groupIndex) => {
    const group = object(rawGroup);
    if (!itemIsActive(group)) return;
    const groupName = String(group.name || group.title || `Gruppe ${groupIndex + 1}`).trim();
    const groupSku = String(group.sku || group.code || group.id || `${category}-${groupIndex + 1}`).trim();
    const groupImage = String(group.image || group.imageUrl || group.cover || "").trim();
    const groupDescription = String(group.description || group.desc || "").trim();
    const variants = array(group.variants || group.items || group.options);

    variants.forEach((rawVariant, variantIndex) => {
      const variant = object(rawVariant);
      if (!itemIsActive(variant)) return;

      const variantName = String(
        variant.name || variant.title || variant.label || `Variante ${variantIndex + 1}`,
      ).trim();
      const variantId = String(
        variant.id || variant.sku || variant.code || `${groupSku}-${variantIndex + 1}`,
      ).trim();
      const variantSku = String(variant.sku || variant.code || variantId).trim();
      const imageUrl = String(
        variant.image || variant.imageUrl || variant.cover || groupImage || "",
      ).trim();
      const description = String(variant.description || variant.desc || groupDescription || "").trim();

      output.push(
        mapProduct(
          {
            ...variant,
            id: `${category}:${groupSku}:${variantId}`,
            sku: variantSku,
            name: variantName,
            description: description || undefined,
            imageUrl: imageUrl || undefined,
            category,
            groupKey: `${category}:${groupSku}`,
            groupLabel: groupName,
            order: groupIndex * 1_000 + variantIndex,
            price: variant.price ?? variant.preis ?? 0,
            active: true,
            depositAmount:
              variant.depositAmount ??
              variant.pfandAmount ??
              0,
          },
          campaigns,
        ),
      );
    });
  });

  return output;
}

function mapCampaign(item: any): ShowcaseCampaign {
  return {
    id: String(item.id || item.code || ""),
    title: String(item.title || item.badgeText || "Kampagne"),
    badgeText: item.badgeText ? String(item.badgeText) : undefined,
    startsAt: item.startsAt ? new Date(item.startsAt).toISOString() : null,
    endsAt: item.endsAt ? new Date(item.endsAt).toISOString() : null,
    payload: object(item.payload),
  };
}

function selectLogo(settings: any, themeId: string) {
  return getThemeLogo(
    settings?.theme,
    themeId,
    siteConfig.brand.logoPath,
  );
}

function selectShopName(settings: any) {
  return String(
    settings?.branding?.name ||
      settings?.shop?.name ||
      settings?.store?.name ||
      settings?.business?.name ||
      "Burger Brothers Berlin",
  ).trim();
}


const WEATHER_TTL_MS = 10 * 60_000;
const WEATHER_STALE_MS = 60 * 60_000;
let weatherCache: { value: ShowcaseWeather; expiresAt: number; staleUntil: number } | null = null;
let weatherRequest: Promise<ShowcaseWeather | null> | null = null;

async function fetchShowcaseWeather(): Promise<ShowcaseWeather | null> {
  const now = Date.now();
  if (weatherCache && now < weatherCache.expiresAt) return weatherCache.value;
  if (weatherRequest) return weatherRequest;

  weatherRequest = (async () => {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 4_500);
      const response = await fetch(
        "https://api.open-meteo.com/v1/forecast?latitude=52.588&longitude=13.289&current=temperature_2m,apparent_temperature,weather_code&timezone=Europe%2FBerlin",
        { cache: "no-store", signal: controller.signal },
      );
      clearTimeout(timer);
      if (!response.ok) throw new Error(`OPEN_METEO_${response.status}`);
      const data: any = await response.json();
      const temperature = Number(data?.current?.temperature_2m);
      const apparentTemperature = Number(data?.current?.apparent_temperature);
      const code = Number(data?.current?.weather_code);
      if (!Number.isFinite(temperature) || !Number.isFinite(code)) {
        throw new Error("OPEN_METEO_INVALID_PAYLOAD");
      }
      const rainy = [51,53,55,56,57,61,63,65,66,67,80,81,82,95,96,99].includes(code);
      const snowy = [71,73,75,77,85,86].includes(code);
      const foggy = [45,48].includes(code);
      const cloudy = [1,2,3].includes(code);
      const value: ShowcaseWeather = {
        temperature,
        apparentTemperature: Number.isFinite(apparentTemperature) ? apparentTemperature : undefined,
        weatherCode: code,
        label: snowy ? "Schnee" : rainy ? "Regen" : foggy ? "Nebel" : cloudy ? "Bewölkt" : "Sonnig",
        emoji: snowy ? "❄️" : rainy ? "🌧️" : foggy ? "🌫️" : cloudy ? "☁️" : "☀️",
        updatedAt: data?.current?.time ? new Date(data.current.time).toISOString() : new Date().toISOString(),
        source: "open-meteo",
        locationLabel: "BERLIN-TEGEL",
        stale: false,
      };
      weatherCache = { value, expiresAt: now + WEATHER_TTL_MS, staleUntil: now + WEATHER_STALE_MS };
      return value;
    } catch (error) {
      if (weatherCache && now < weatherCache.staleUntil) {
        return { ...weatherCache.value, source: "cache_fallback", stale: true };
      }
      console.warn("[showcase:weather]", error);
      return null;
    } finally {
      weatherRequest = null;
    }
  })();

  return weatherRequest;
}

function buildBestsellers(
  orders: Array<{ items: unknown; ts?: Date | string | null }>,
  products: ShowcaseProduct[],
  periodDays: number,
): ShowcaseBestseller[] {
  const cutoff = Date.now() - Math.max(1, periodDays) * 86_400_000;
  const counts = new Map<string, { name: string; quantity: number }>();
  for (const order of orders) {
    const timestamp = order?.ts ? new Date(order.ts).valueOf() : Date.now();
    if (Number.isFinite(timestamp) && timestamp < cutoff) continue;
    for (const raw of array(order?.items)) {
      const item = object(raw);
      const id = String(item.productId || item.id || item.sku || "");
      const name = String(item.name || item.title || "Produkt");
      const key = id || name.toLowerCase();
      const current = counts.get(key) || { name, quantity: 0 };
      current.quantity += Math.max(1, Number(item.qty || item.quantity || 1));
      counts.set(key, current);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1].quantity - a[1].quantity)
    .slice(0, 10)
    .map(([key, row]) => {
      const product = products.find((item) => item.id === key || item.sku === key || item.name.toLowerCase() === row.name.toLowerCase());
      return {
        productId: product?.id,
        name: product?.name || row.name,
        quantity: row.quantity,
        imageUrl: product?.imageUrl,
        displayPrice: product?.displayPrice,
      };
    });
}

export async function buildShowcaseSnapshot(req: Request, requestedSlug = "main", documentOverride?: ShowcaseDocument): Promise<ShowcaseSnapshot> {
  const siteUrl = requestOrigin(req);
  const tenantId = await getTenantId();
  const slug = normalizeScreenSlug(requestedSlug);
  const now = new Date();
  const [values, products, campaigns, settings] = await Promise.all([
    readSettingValues(tenantId, [
      publishedKey(slug),
      SHOWCASE_PUBLISHED_KEY,
      SHOWCASE_SCREENS_KEY,
      SHOWCASE_REVIEWS_KEY,
      DRINK_GROUPS_KEY,
      EXTRA_GROUPS_KEY,
    ]),
    prisma.product.findMany({
      where: {
        tenantId,
        active: true,
        AND: [
          { OR: [{ activeFrom: null }, { activeFrom: { lte: now } }] },
          { OR: [{ activeTo: null }, { activeTo: { gte: now } }] },
        ],
      },
      orderBy: [{ category: "asc" }, { order: "asc" }, { name: "asc" }],
    }),
    prisma.campaign.findMany({
      where: { tenantId },
      orderBy: [{ updatedAt: "desc" }],
    }),
    getServerSettings(),
  ]);

  const publishedRaw = values.get(publishedKey(slug)) ?? values.get(SHOWCASE_PUBLISHED_KEY);
  const baseDocument = documentOverride
    ? normalizeShowcaseDocument(documentOverride, siteUrl)
    : publishedRaw
      ? normalizeShowcaseDocument(publishedRaw, siteUrl)
      : createDefaultShowcaseDocument(siteUrl);
  const mappedCampaigns = campaigns.map(mapCampaign);
  const document: ShowcaseDocument = {
    ...baseDocument,
    scenes: baseDocument.scenes.map((scene) => {
      if (scene.type !== "campaign" || scene.campaignAutoContent === false || !scene.campaignId) return scene;
      const campaign = mappedCampaigns.find((item) => item.id === scene.campaignId);
      return campaign ? { ...scene, ...campaignScenePatch(campaign, scene.campaignVariant || "standard"), id: scene.id } : scene;
    }),
  };
  const resolved = resolveActiveTheme(settings?.theme);
  const preset = getThemePreset(resolved.theme);
  const showSnow =
    resolved.settings.snow &&
    (resolved.theme === "christmas" || resolved.theme === "winter");

  const branding: ShowcaseBranding = {
    shopName: selectShopName(settings),
    logoUrl: selectLogo(settings, resolved.theme),
    themeId: resolved.theme,
    themeColor: preset.themeColor,
    themeVideoUrl: getThemeVideo(
      settings?.theme,
      resolved.theme,
      "/flames/flame-loop.mp4",
    ),
    themeDecorationsEnabled: resolved.settings.decorationsEnabled,
    themeMotionEnabled: resolved.settings.motionEnabled,
    themeSnow: showSnow,
    themeCornerLeft: preset.cornerLeft,
    themeCornerRight: preset.cornerRight,
    themeParticles: showSnow ? ["❄", "·", "✦"] : preset.particles,
    locationLabel: "13507 Berlin Tegel",
    siteUrl,
  };

  const showcaseProducts = [
    ...products.map((product) => mapProduct(product, campaigns)),
    ...mapVariantGroups(values.get(DRINK_GROUPS_KEY), "drinks", campaigns),
    ...mapVariantGroups(values.get(EXTRA_GROUPS_KEY), "extras", campaigns),
  ];
  const screens = normalizeScreens(values.get(SHOWCASE_SCREENS_KEY));
  const screen = screens.find((row) => row.slug === slug) || screens[0];
  const reviews = normalizeReviews(values.get(SHOWCASE_REVIEWS_KEY)).filter((review) => review.approved);
  const bestsellerPeriods = Array.from(new Set(
    document.scenes
      .filter((scene) => scene.type === "bestseller")
      .map((scene) => Math.max(1, Math.min(365, Number(scene.bestsellerPeriodDays || 7)))),
  ));
  if (!bestsellerPeriods.length) bestsellerPeriods.push(7);
  const maxPeriod = Math.max(...bestsellerPeriods);
  const [weather, recentOrders] = await Promise.all([
    fetchShowcaseWeather(),
    prisma.order.findMany({
      where: { tenantId, status: { notIn: ["cancelled", "canceled"] }, ts: { gte: new Date(Date.now() - maxPeriod * 86400000) } },
      select: { items: true, ts: true },
      take: 2500,
      orderBy: { ts: "desc" },
    }).catch(() => []),
  ]);
  const bestsellersByPeriod = Object.fromEntries(
    bestsellerPeriods.map((days) => [String(days), buildBestsellers(recentOrders, showcaseProducts, days)]),
  );
  const bestsellers = bestsellersByPeriod[String(bestsellerPeriods[0])] || [];

  return {
    ok: true,
    source: "db",
    generatedAt: new Date().toISOString(),
    document,
    products: showcaseProducts,
    campaigns: mappedCampaigns,
    branding,
    screen,
    weather,
    reviews,
    bestsellers,
    bestsellersByPeriod,
    bestsellerGeneratedAt: new Date().toISOString(),
  };
}

export function defaultShowcaseSnapshot(req: Request): ShowcaseSnapshot {
  const siteUrl = requestOrigin(req);
  return {
    ok: true,
    source: "default_fallback",
    generatedAt: new Date().toISOString(),
    document: createDefaultShowcaseDocument(siteUrl),
    products: [],
    campaigns: [],
    branding: {
      shopName: "Burger Brothers Berlin",
      logoUrl: siteConfig.brand.logoPath,
      themeId: "classic",
      themeColor: "#0b0704",
      themeVideoUrl: "/flames/flame-loop.mp4",
      themeDecorationsEnabled: true,
      themeMotionEnabled: true,
      themeSnow: false,
      themeCornerLeft: "🍔",
      themeCornerRight: "🔥",
      themeParticles: [],
      locationLabel: "13507 Berlin Tegel",
      siteUrl,
    },
  };
}
