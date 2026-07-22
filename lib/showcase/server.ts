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
import type {
  ShowcaseBranding,
  ShowcaseCampaign,
  ShowcaseDocument,
  ShowcaseMediaItem,
  ShowcaseProduct,
  ShowcaseSnapshot,
} from "./types";

export const SHOWCASE_DRAFT_KEY = "showcase:draft";
export const SHOWCASE_PUBLISHED_KEY = "showcase:published";
export const SHOWCASE_MEDIA_KEY = "showcase:media";
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

export async function readShowcaseAdminState(siteUrl: string) {
  const tenantId = await getTenantId();
  const values = await readSettingValues(tenantId, [
    SHOWCASE_DRAFT_KEY,
    SHOWCASE_PUBLISHED_KEY,
    SHOWCASE_MEDIA_KEY,
  ]);

  const published = normalizeShowcaseDocument(values.get(SHOWCASE_PUBLISHED_KEY), siteUrl);
  const draft = values.has(SHOWCASE_DRAFT_KEY)
    ? normalizeShowcaseDocument(values.get(SHOWCASE_DRAFT_KEY), siteUrl)
    : published;
  const media = normalizeShowcaseMediaList(values.get(SHOWCASE_MEDIA_KEY));

  return { tenantId, draft, published, media };
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

export async function buildShowcaseSnapshot(req: Request): Promise<ShowcaseSnapshot> {
  const siteUrl = requestOrigin(req);
  const tenantId = await getTenantId();
  const now = new Date();
  const [values, products, campaigns, settings] = await Promise.all([
    readSettingValues(tenantId, [
      SHOWCASE_PUBLISHED_KEY,
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

  const document = values.has(SHOWCASE_PUBLISHED_KEY)
    ? normalizeShowcaseDocument(values.get(SHOWCASE_PUBLISHED_KEY), siteUrl)
    : createDefaultShowcaseDocument(siteUrl);
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

  return {
    ok: true,
    source: "db",
    generatedAt: new Date().toISOString(),
    document,
    products: showcaseProducts,
    campaigns: campaigns.map(mapCampaign),
    branding,
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
