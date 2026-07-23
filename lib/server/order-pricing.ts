import { evaluateConditionalCartCampaign } from "@/lib/conditional-campaign";
import {
  evaluateFreebieRules,
  parseFreebieCategory,
  type FreebieUnit,
} from "@/lib/freebies";
import { prisma } from "@/lib/db";

type OrderMode = "pickup" | "delivery";

export type CanonicalPricingSnapshot = {
  merchandise: number;
  discount: number;
  surcharges: number;
  couponDiscount: number;
  total: number;
};

export type PricingAdjustmentReason =
  | "none"
  | "breakdown_only"
  | "rounding"
  | "canonical_reprice";

export type PricingAdjustment = {
  changed: boolean;
  payableChanged: boolean;
  breakdownChanged: boolean;
  reason: PricingAdjustmentReason;
  differenceCents: number;
  submitted: CanonicalPricingSnapshot;
  canonical: CanonicalPricingSnapshot;
};

type CanonicalExtra = {
  id: string;
  sku: string;
  name: string;
  label: string;
  priceCents: number;
  aliases: string[];
};

type CanonicalCatalogItem = {
  source: "product" | "drink_variant" | "extra_variant";
  id: string;
  sku: string;
  name: string;
  category: string;
  priceCents: number;
  active: boolean;
  activeFrom: Date | null;
  activeTo: Date | null;
  extras: CanonicalExtra[];
  pfandType: string;
  pfandAmountCents: number;
  aliases: string[];
};

type CanonicalOrderItem = {
  id: string;
  sku: string;
  name: string;
  description?: string;
  category: string;
  price: number;
  qty: number;
  add?: Array<{
    id?: string;
    sku?: string;
    label: string;
    name: string;
    price: number;
  }>;
  rm?: string[];
  note?: string;
  pfandType: string;
  pfandAmount: number;
  depositType: string;
  depositAmount: number;
  canonicalBasePrice: number;
  canonicalExtrasTotal: number;
  canonicalUnitPrice: number;
  canonicalSource: CanonicalCatalogItem["source"];
};


type NormalizedCampaign = {
  id: string;
  type: "percentOffProduct" | "percentOffCategory";
  percent: number;
  targetCategory: string;
  productAliases: string[];
  mode: "pickup" | "delivery" | "both";
  active: boolean;
  startsAt: Date | null;
  endsAt: Date | null;
  priority: number;
  badgeText: string;
};

type NormalizedCouponDefinition = ReturnType<typeof normalizeCouponDefinition>;
type CouponDefinitionEntry = { row: any; definition: NormalizedCouponDefinition };

type CouponResult = {
  code: string | null;
  discountCents: number;
  definitionId: string | null;
  issuedId: string | null;
  message: string;
};

export class OrderPricingError extends Error {
  code: string;
  status: number;
  details?: Record<string, any>;

  constructor(
    code: string,
    message: string,
    status = 400,
    details?: Record<string, any>,
  ) {
    super(message);
    this.name = "OrderPricingError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

function ensureObj(value: any): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

function ensureArr(value: any): any[] {
  return Array.isArray(value) ? value : [];
}

function toNumber(value: any, fallback = 0) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value && typeof value.toNumber === "function") {
    const number = value.toNumber();
    return Number.isFinite(number) ? number : fallback;
  }

  const text = String(value ?? "")
    .trim()
    .replace(/[€\s]/g, "")
    .replace(",", ".");
  const number = Number(text);
  return Number.isFinite(number) ? number : fallback;
}

function toCents(value: any) {
  return Math.max(0, Math.round(toNumber(value, 0) * 100));
}

function fromCents(value: number) {
  return +(Math.max(0, Math.round(value)) / 100).toFixed(2);
}

function roundToTenCents(cents: number) {
  return Math.max(0, Math.round(Math.max(0, cents) / 10) * 10);
}

function normalizeMode(value: any): OrderMode {
  const text = String(value || "").toLowerCase().trim();
  return ["pickup", "abholung", "apollo", "apollon"].includes(text)
    ? "pickup"
    : "delivery";
}

function normalizeCategory(value: any) {
  const raw = String(value ?? "").toLowerCase().trim();

  if (raw.includes("vegan") || raw.includes("vegetar")) return "vegan";
  if (
    raw.includes("drink") ||
    raw.includes("getränk") ||
    raw.includes("getraenk")
  ) {
    return "drinks";
  }
  if (raw.includes("soß") || raw.includes("sauce") || raw.includes("sos")) {
    return "sauces";
  }
  if (raw.includes("hotdog") || raw.includes("hot dog")) return "hotdogs";
  if (raw.includes("donut") || raw.includes("doughnut")) return "donuts";
  if (raw.includes("bubble") || raw.includes("boba")) return "bubbletea";
  if (
    raw.includes("extra") ||
    raw.includes("snack") ||
    raw.includes("pommes") ||
    raw.includes("fries")
  ) {
    return "extras";
  }
  return "burger";
}

function normalizeKey(value: any) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function uniqueStrings(values: any[]) {
  return Array.from(
    new Set(values.map((value) => String(value ?? "").trim()).filter(Boolean)),
  );
}

function uniqueAliases(values: any[]) {
  return Array.from(
    new Set(values.map(normalizeKey).filter(Boolean)),
  );
}

function toDate(value: any): Date | null {
  if (!value) return null;
  if (value instanceof Date) {
    return Number.isFinite(value.valueOf()) ? value : null;
  }
  const date = new Date(value);
  return Number.isFinite(date.valueOf()) ? date : null;
}

function isAvailable(item: CanonicalCatalogItem, now: Date) {
  if (!item.active) return false;
  if (item.activeFrom && now < item.activeFrom) return false;
  if (item.activeTo && now > item.activeTo) return false;
  return true;
}

function normalizeExtra(raw: any, index: number): CanonicalExtra {
  const name = String(raw?.name ?? raw?.label ?? `Extra ${index + 1}`).trim();
  const label = String(raw?.label ?? raw?.name ?? name).trim();
  const id = String(raw?.id ?? raw?.sku ?? raw?.code ?? name).trim();
  const sku = String(raw?.sku ?? raw?.id ?? raw?.code ?? id).trim();

  return {
    id,
    sku,
    name,
    label,
    priceCents: toCents(raw?.price ?? raw?.preis),
    aliases: uniqueAliases([id, sku, name, label, raw?.code]),
  };
}

function normalizeGroupList(value: any) {
  return Array.isArray(value)
    ? value
    : Array.isArray(value?.items)
      ? value.items
      : [];
}

function readGroupSettings(settings: any, kind: "drink" | "extra") {
  const keys =
    kind === "drink"
      ? [
          "bb_drink_groups_v1",
          "drinkGroups",
          "drinksGroups",
          "groupsDrinks",
        ]
      : [
          "bb_extra_groups_v1",
          "extraGroups",
          "extrasGroups",
          "groupsExtras",
        ];

  for (const key of keys) {
    const list = normalizeGroupList(settings?.[key]);
    if (list.length) return list;
  }

  return [];
}

function groupVariantsToCatalog(
  settings: any,
  kind: "drink" | "extra",
): CanonicalCatalogItem[] {
  const category = kind === "drink" ? "drinks" : "extras";
  const source = kind === "drink" ? "drink_variant" : "extra_variant";
  const out: CanonicalCatalogItem[] = [];

  for (const [groupIndex, group] of readGroupSettings(settings, kind).entries()) {
    if (group?.active === false || group?.enabled === false) continue;

    const groupId = String(
      group?.id ?? group?.sku ?? group?.code ?? `group-${groupIndex + 1}`,
    ).trim();
    const groupSku = String(group?.sku ?? group?.code ?? groupId).trim();
    const groupName = String(group?.name ?? group?.title ?? groupSku).trim();
    const variants = Array.isArray(group?.variants)
      ? group.variants
      : Array.isArray(group?.items)
        ? group.items
        : Array.isArray(group?.options)
          ? group.options
          : [];

    for (const [variantIndex, variant] of variants.entries()) {
      const variantId = String(
        variant?.id ??
          variant?.sku ??
          variant?.code ??
          `variant-${variantIndex + 1}`,
      ).trim();
      const variantSku = String(
        variant?.sku ?? variant?.code ?? variantId,
      ).trim();
      const variantName = String(
        variant?.name ?? variant?.title ?? variant?.label ?? variantSku,
      ).trim();
      const compositeSku = `${groupSku}-${variantId}`;
      const fullName = `${groupName} – ${variantName}`;

      out.push({
        source,
        id: compositeSku,
        sku: compositeSku,
        name: fullName,
        category,
        priceCents: toCents(variant?.price ?? variant?.preis),
        active: variant?.active !== false && variant?.enabled !== false,
        activeFrom: toDate(variant?.activeFrom ?? variant?.startAt),
        activeTo: toDate(variant?.activeTo ?? variant?.endAt),
        extras: [],
        pfandType: String(
          variant?.pfandType ?? variant?.depositType ?? "none",
        )
          .toLowerCase()
          .trim(),
        pfandAmountCents: toCents(
          variant?.pfandAmount ?? variant?.depositAmount,
        ),
        aliases: uniqueAliases([
          compositeSku,
          `${groupId}-${variantId}`,
          `${groupSku}-${variantSku}`,
          variantSku,
          variantId,
          fullName,
          `${groupName} ${variantName}`,
        ]),
      });
    }
  }

  return out;
}

async function loadCatalog(tenantId: string, settings: any) {
  const products = await prisma.product.findMany({
    where: { tenantId },
    orderBy: [{ category: "asc" }, { name: "asc" }],
  });

  const catalog: CanonicalCatalogItem[] = products.map((row: any) => {
    const extrasRaw = Array.isArray(row?.extrasJson)
      ? row.extrasJson
      : Array.isArray(row?.extras)
        ? row.extras
        : [];

    return {
      source: "product",
      id: String(row?.id ?? "").trim(),
      sku: String(row?.sku ?? row?.id ?? "").trim(),
      name: String(row?.name ?? row?.sku ?? "Artikel").trim(),
      category: normalizeCategory(row?.category),
      priceCents: toCents(row?.price),
      active: row?.active !== false,
      activeFrom: toDate(row?.activeFrom),
      activeTo: toDate(row?.activeTo),
      extras: extrasRaw.map(normalizeExtra),
      pfandType: "none",
      pfandAmountCents: 0,
      aliases: uniqueAliases([
        row?.id,
        row?.sku,
        row?.code,
        row?.name,
      ]),
    } satisfies CanonicalCatalogItem;
  });

  catalog.push(...groupVariantsToCatalog(settings, "drink"));
  catalog.push(...groupVariantsToCatalog(settings, "extra"));

  return catalog;
}

function readAvailabilityMap(settings: any) {
  const raw = ensureObj(settings?.productAvailability);
  const out = new Map<string, any>();

  for (const [key, value] of Object.entries(raw)) {
    const normalized = normalizeKey(key);
    if (normalized) out.set(normalized, value);
  }

  return out;
}

function unavailableByRuntimeSetting(
  item: CanonicalCatalogItem,
  availability: Map<string, any>,
  now: Date,
) {
  for (const alias of item.aliases) {
    const entry = availability.get(alias);
    if (!entry || entry?.disabled !== true) continue;
    if (!entry?.until) return true;

    const until = toDate(entry.until);
    if (!until || until > now) return true;
  }

  return false;
}

function itemLookupKeys(item: any) {
  return uniqueAliases([
    item?.sku,
    item?.id,
    item?.code,
    item?.name,
    item?.title,
  ]);
}

function resolveCatalogItem(
  rawItem: any,
  catalog: CanonicalCatalogItem[],
): CanonicalCatalogItem {
  const keys = itemLookupKeys(rawItem);

  for (const key of keys) {
    const matches = catalog.filter((entry) => entry.aliases.includes(key));
    if (matches.length === 1) return matches[0];

    if (matches.length > 1) {
      const category = normalizeCategory(rawItem?.category);
      const categoryMatches = matches.filter(
        (entry) => entry.category === category,
      );
      if (categoryMatches.length === 1) return categoryMatches[0];
    }
  }

  throw new OrderPricingError(
    "CATALOG_ITEM_NOT_FOUND",
    `Artikel nicht im aktuellen Katalog gefunden: ${String(rawItem?.name || rawItem?.sku || rawItem?.id || "Artikel")}`,
    409,
    {
      item: String(rawItem?.name || rawItem?.sku || rawItem?.id || ""),
    },
  );
}

function resolveSelectedExtras(
  rawItem: any,
  catalogItem: CanonicalCatalogItem,
) {
  const submitted = ensureArr(rawItem?.add ?? rawItem?.extras);
  const resolved: CanonicalExtra[] = [];

  for (const rawExtra of submitted) {
    const keys = uniqueAliases([
      rawExtra?.id,
      rawExtra?.sku,
      rawExtra?.code,
      rawExtra?.name,
      rawExtra?.label,
    ]);

    const match = catalogItem.extras.find((extra) =>
      keys.some((key) => extra.aliases.includes(key)),
    );

    if (!match) {
      throw new OrderPricingError(
        "CATALOG_EXTRA_NOT_FOUND",
        `Extra ist für diesen Artikel nicht verfügbar: ${String(rawExtra?.label || rawExtra?.name || rawExtra?.id || "Extra")}`,
        409,
        {
          product: catalogItem.name,
          extra: String(
            rawExtra?.label || rawExtra?.name || rawExtra?.id || "",
          ),
        },
      );
    }

    resolved.push(match);
  }

  return resolved;
}

function campaignMode(value: any): "pickup" | "delivery" | "both" {
  if (value && typeof value === "object") {
    const delivery = Boolean(value?.delivery ?? value?.lieferung ?? value?.lifa);
    const pickup = Boolean(value?.pickup ?? value?.abholung ?? value?.apollon);
    if (delivery && !pickup) return "delivery";
    if (pickup && !delivery) return "pickup";
    return "both";
  }

  const text = String(value || "").toLowerCase().trim();
  if (/(liefer|delivery|lifa)/.test(text)) return "delivery";
  if (/(abhol|pickup|apollo)/.test(text)) return "pickup";
  return "both";
}

function normalizeCampaign(row: any): NormalizedCampaign {
  const payload = ensureObj(row?.payload);
  const merged = { ...payload, ...row };
  const rawType = String(merged?.type || "").trim();
  const productIds = uniqueStrings([
    ...ensureArr(merged?.productIds),
    ...ensureArr(merged?.products).map(
      (item: any) => item?.id ?? item?.sku ?? item?.code ?? item?.name,
    ),
    merged?.targetProductId,
    merged?.productId,
    merged?.sku,
    merged?.targetId,
  ]);
  const scope = String(merged?.scope ?? merged?.target ?? "").toLowerCase();
  const type =
    rawType === "percentOffProduct" ||
    scope.includes("product") ||
    productIds.length
      ? "percentOffProduct"
      : "percentOffCategory";

  return {
    id: String(row?.id ?? merged?.id ?? ""),
    type,
    percent: Math.max(
      0,
      Math.min(
        100,
        toNumber(merged?.percent ?? merged?.value ?? merged?.amount, 0),
      ),
    ),
    targetCategory: normalizeCategory(
      merged?.targetCategory ??
        merged?.category ??
        ensureArr(merged?.categories)[0],
    ),
    productAliases: uniqueAliases(productIds),
    mode: campaignMode(merged?.mode),
    active: merged?.active !== false && merged?.enabled !== false,
    startsAt: toDate(
      row?.startsAt ?? merged?.startsAt ?? merged?.startAt ?? merged?.from,
    ),
    endsAt: toDate(
      row?.endsAt ?? merged?.endsAt ?? merged?.endAt ?? merged?.until,
    ),
    priority: toNumber(merged?.priority ?? merged?.prio, 0),
    badgeText: String(
      row?.badgeText ?? merged?.badgeText ?? merged?.badge ?? "",
    ),
  };
}

async function loadCampaigns(tenantId: string): Promise<NormalizedCampaign[]> {
  const rows = await prisma.campaign.findMany({ where: { tenantId } });
  return rows.map(normalizeCampaign);
}

function campaignForItem(
  item: CanonicalCatalogItem,
  campaigns: NormalizedCampaign[],
  mode: OrderMode,
  now: Date,
) {
  return campaigns
    .filter((campaign) => {
      if (!campaign.active || campaign.percent <= 0) return false;
      if (campaign.mode !== "both" && campaign.mode !== mode) return false;
      if (campaign.startsAt && now < campaign.startsAt) return false;
      if (campaign.endsAt && now > campaign.endsAt) return false;

      if (campaign.type === "percentOffCategory") {
        return campaign.targetCategory === item.category;
      }

      const itemCampaignAliases = uniqueAliases([item.id, item.sku]);
      return campaign.productAliases.some((alias) =>
        itemCampaignAliases.includes(alias),
      );
    })
    .sort(
      (left, right) =>
        right.priority - left.priority || right.percent - left.percent,
    )[0] ?? null;
}

function campaignPriceCents(
  item: CanonicalCatalogItem,
  campaigns: NormalizedCampaign[],
  mode: OrderMode,
  now: Date,
) {
  const campaign = campaignForItem(item, campaigns, mode, now);
  if (!campaign) return { priceCents: roundToTenCents(item.priceCents), campaign: null };

  const raw = item.priceCents * (1 - campaign.percent / 100);
  return {
    priceCents: roundToTenCents(Math.round(raw)),
    campaign,
  };
}

function canonicalizeItems(params: {
  rawItems: any[];
  catalog: CanonicalCatalogItem[];
  campaigns: NormalizedCampaign[];
  settings: any;
  mode: OrderMode;
  now: Date;
}) {
  if (!params.rawItems.length) {
    throw new OrderPricingError(
      "ORDER_ITEMS_EMPTY",
      "Der Warenkorb ist leer.",
      400,
    );
  }
  if (params.rawItems.length > 200) {
    throw new OrderPricingError(
      "ORDER_ITEMS_LIMIT",
      "Zu viele unterschiedliche Artikel im Warenkorb.",
      400,
    );
  }

  const availability = readAvailabilityMap(params.settings);
  const canonicalItems: CanonicalOrderItem[] = [];
  const freebieUnits: FreebieUnit[] = [];
  const couponItems: Array<{
    sku: string;
    name: string;
    category: string;
    qty: number;
    unitPrice: number;
  }> = [];
  let merchandiseCents = 0;
  let categorySurchargeCents = 0;
  let pfandCents = 0;
  let totalUnits = 0;

  const categorySurcharges = ensureObj(params.settings?.delivery?.surcharges);
  const pfandEnabled = params.settings?.pfand?.enabled !== false;
  params.rawItems.forEach((rawItem, index) => {
    const qty = Math.round(toNumber(rawItem?.qty ?? rawItem?.quantity, 1));
    if (qty < 1 || qty > 50) {
      throw new OrderPricingError(
        "ORDER_ITEM_QTY_INVALID",
        `Ungültige Menge für ${String(rawItem?.name || "Artikel")}.`,
        400,
      );
    }

    totalUnits += qty;
    if (totalUnits > 250) {
      throw new OrderPricingError(
        "ORDER_TOTAL_QTY_LIMIT",
        "Zu viele Artikel im Warenkorb.",
        400,
      );
    }

    const catalogItem = resolveCatalogItem(rawItem, params.catalog);
    if (
      !isAvailable(catalogItem, params.now) ||
      unavailableByRuntimeSetting(catalogItem, availability, params.now)
    ) {
      throw new OrderPricingError(
        "CATALOG_ITEM_UNAVAILABLE",
        `Artikel ist aktuell nicht verfügbar: ${catalogItem.name}`,
        409,
      );
    }

    const extras = resolveSelectedExtras(rawItem, catalogItem);
    const campaignResult = campaignPriceCents(
      catalogItem,
      params.campaigns,
      params.mode,
      params.now,
    );
    const extrasCents = extras.reduce(
      (sum, extra) => sum + extra.priceCents,
      0,
    );
    const unitPriceCents = campaignResult.priceCents + extrasCents;
    merchandiseCents += unitPriceCents * qty;

    if (params.mode === "delivery") {
      categorySurchargeCents +=
        toCents(
          categorySurcharges?.[catalogItem.category] ??
            categorySurcharges?.[
              catalogItem.category === "bubbletea"
                ? "bubbleTea"
                : catalogItem.category
            ],
        ) * qty;
    }

    const itemPfandCents = pfandEnabled ? catalogItem.pfandAmountCents : 0;
    pfandCents += itemPfandCents * qty;

    const canonical: CanonicalOrderItem = {
      id: catalogItem.id,
      sku: catalogItem.sku,
      name: catalogItem.name,
      description: rawItem?.description
        ? String(rawItem.description).slice(0, 500)
        : undefined,
      category: catalogItem.category,
      // Mevcut checkout/fiş uyumluluğu: item.price seçili extralar dahil birim fiyattır.
      price: fromCents(unitPriceCents),
      qty,
      add: extras.length
        ? extras.map((extra) => ({
            id: extra.id || undefined,
            sku: extra.sku || undefined,
            label: extra.label,
            name: extra.name,
            price: fromCents(extra.priceCents),
          }))
        : undefined,
      rm: ensureArr(rawItem?.rm ?? rawItem?.remove)
        .slice(0, 50)
        .map((entry) => String(entry).slice(0, 120)),
      note: rawItem?.note ? String(rawItem.note).slice(0, 500) : undefined,
      pfandType: itemPfandCents > 0 ? catalogItem.pfandType || "custom" : "none",
      pfandAmount: fromCents(itemPfandCents),
      depositType: itemPfandCents > 0 ? catalogItem.pfandType || "custom" : "none",
      depositAmount: fromCents(itemPfandCents),
      canonicalBasePrice: fromCents(campaignResult.priceCents),
      canonicalExtrasTotal: fromCents(extrasCents),
      canonicalUnitPrice: fromCents(unitPriceCents),
      canonicalSource: catalogItem.source,
    };

    canonicalItems.push(canonical);
    couponItems.push({
      sku: catalogItem.sku,
      name: catalogItem.name,
      category: catalogItem.category,
      qty,
      unitPrice: fromCents(unitPriceCents),
    });

    const freebieCategory = parseFreebieCategory(catalogItem.category);
    if (freebieCategory) {
      for (let unitIndex = 0; unitIndex < qty; unitIndex += 1) {
        freebieUnits.push({
          unitId: `${catalogItem.sku || catalogItem.id}-${index}-${unitIndex}`,
          category: freebieCategory,
          price: fromCents(campaignResult.priceCents),
        });
      }
    }
  });

  return {
    canonicalItems,
    couponItems,
    freebieUnits,
    merchandiseCents,
    categorySurchargeCents,
    deliverySurchargeCents: categorySurchargeCents,
    pfandCents,
  };
}

function normalizeRate(value: any) {
  const raw = Math.max(0, toNumber(value, 0));
  return Math.min(0.9999, raw > 1 ? raw / 100 : raw);
}

function firstConfiguredValue(values: any[]) {
  for (const value of values) {
    if (value !== undefined && value !== null) return value;
  }

  return 0;
}

function standardDiscountRate(settings: any, mode: OrderMode) {
  const legacyConfig =
    mode === "pickup" ? settings?.apollon : settings?.lifa;

  // Eski etkinlik anahtarı açıkça kapalıysa indirim uygulanmaz. Anahtarın
  // bulunmadığı güncel ayarlarda ise indirim alanı tek başına yeterlidir.
  if (legacyConfig?.active === false) return 0;

  const configuredRate =
    mode === "pickup"
      ? firstConfiguredValue([
          settings?.pickup?.discountRate,
          settings?.discount?.apollonRate,
          settings?.discounts?.pickupPercent,
          settings?.discounts?.apolloPercent,
          settings?.discounts?.apollonPercent,
          settings?.apollon?.discountRate,
        ])
      : firstConfiguredValue([
          settings?.delivery?.discountRate,
          settings?.discount?.lifaRate,
          settings?.discounts?.deliveryPercent,
          settings?.discounts?.lifaPercent,
          settings?.lifa?.discountRate,
        ]);

  return normalizeRate(configuredRate);
}

function normalizePhone(value: any) {
  return String(value || "").replace(/\D/g, "");
}

function normalizeCouponCode(value: any) {
  return String(value ?? "")
    .replace(/[\s\u00A0\u2000-\u200B\u202F\u205F\u3000\uFEFF]/g, "")
    .trim()
    .toUpperCase();
}

function dateMs(value: any): number | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value instanceof Date) return value.getTime();
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) return numeric;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeCouponDefinition(row: any) {
  const definition = ensureObj(row?.definition);
  const meta = ensureObj(definition?.meta ?? definition?.metaJson);

  return {
    id: String(definition?.id ?? row?.id ?? ""),
    code: normalizeCouponCode(definition?.code ?? row?.code),
    title: String(definition?.title ?? ""),
    type: String(definition?.type ?? "fixed").toLowerCase(),
    value: Math.max(0, toNumber(definition?.value, 0)),
    minCartTotal: Math.max(0, toNumber(definition?.minCartTotal, 0)),
    maxUses:
      definition?.maxUses === undefined || definition?.maxUses === null
        ? null
        : Math.max(0, Math.trunc(toNumber(definition.maxUses, 0))),
    perCustomerLimit:
      definition?.perCustomerLimit === undefined ||
      definition?.perCustomerLimit === null
        ? null
        : Math.max(
            0,
            Math.trunc(toNumber(definition.perCustomerLimit, 0)),
          ),
    validFrom: dateMs(definition?.validFrom),
    validUntil: dateMs(definition?.validUntil),
    meta,
  };
}

async function couponUsageCount(params: {
  tenantId: string;
  couponId: string;
  customerPhone?: string;
}) {
  const rows = await prisma.issuedCoupon.findMany({
    where: {
      tenantId: params.tenantId,
      couponId: params.couponId,
      used: true,
    },
    select: {
      assignedToPhone: true,
    },
    take: 5000,
  });

  if (!params.customerPhone) {
    return { global: rows.length, customer: 0 };
  }

  const customer = rows.filter(
    (row: any) => normalizePhone(row?.assignedToPhone) === params.customerPhone,
  ).length;

  return { global: rows.length, customer };
}

async function calculateCoupon(params: {
  tenantId: string;
  codeRaw: any;
  cartTotalCents: number;
  couponItems: Array<{
    sku: string;
    name: string;
    category: string;
    qty: number;
    unitPrice: number;
  }>;
  customerPhone: string;
  now: Date;
}): Promise<CouponResult> {
  const code = normalizeCouponCode(params.codeRaw);
  if (!code) {
    return {
      code: null,
      discountCents: 0,
      definitionId: null,
      issuedId: null,
      message: "",
    };
  }

  const issued = await prisma.issuedCoupon.findFirst({
    where: { tenantId: params.tenantId, code },
  });

  const couponRows = await prisma.coupon.findMany({
    where: { tenantId: params.tenantId },
  });
  const definitions: CouponDefinitionEntry[] = couponRows.map((row: any) => ({
    row,
    definition: normalizeCouponDefinition(row),
  }));

  let selected = definitions.find(
    (entry) => entry.definition.code === code,
  );

  if (issued) {
    selected =
      definitions.find(
        (entry) =>
          entry.definition.id === String(issued.couponId || "") ||
          String(entry.row.id) === String(issued.couponId || ""),
      ) ||
      definitions.find(
        (entry) =>
          entry.definition.code ===
          normalizeCouponCode(issued.couponCode),
      );
  }

  if (!selected) {
    throw new OrderPricingError(
      "COUPON_NOT_FOUND",
      "Gutschein wurde nicht gefunden.",
      409,
    );
  }

  const definition = selected.definition;
  const nowMs = params.now.getTime();

  if (definition.validFrom && nowMs < definition.validFrom) {
    throw new OrderPricingError(
      "COUPON_NOT_STARTED",
      "Dieser Gutschein ist noch nicht aktiv.",
      409,
    );
  }
  if (definition.validUntil && nowMs > definition.validUntil) {
    throw new OrderPricingError(
      "COUPON_EXPIRED",
      "Dieser Gutschein ist abgelaufen.",
      409,
    );
  }

  if (issued) {
    if (issued.used) {
      throw new OrderPricingError(
        "COUPON_ALREADY_USED",
        "Dieser Gutschein wurde bereits verwendet.",
        409,
      );
    }
    const expiresAt = dateMs(issued.expiresAt);
    if (expiresAt && nowMs > expiresAt) {
      throw new OrderPricingError(
        "COUPON_ISSUED_EXPIRED",
        "Dieser Gutschein ist abgelaufen.",
        409,
      );
    }
    const assignedPhone = normalizePhone(issued.assignedToPhone);
    if (assignedPhone && !params.customerPhone) {
      throw new OrderPricingError(
        "COUPON_PHONE_REQUIRED",
        "Für diesen Gutschein ist eine Telefonnummer erforderlich.",
        409,
      );
    }
    if (assignedPhone && assignedPhone !== params.customerPhone) {
      throw new OrderPricingError(
        "COUPON_ASSIGNED_OTHER",
        "Dieser Gutschein ist einer anderen Telefonnummer zugeordnet.",
        409,
      );
    }
    if (String(issued.note || "").toLowerCase() === "cancelled") {
      throw new OrderPricingError(
        "COUPON_CANCELLED",
        "Dieser Gutschein wurde storniert.",
        409,
      );
    }
    if (
      String(issued.note || "").toLowerCase() === "scheduled" &&
      issued.issuedAt &&
      new Date(issued.issuedAt).getTime() > nowMs
    ) {
      throw new OrderPricingError(
        "COUPON_NOT_AVAILABLE_YET",
        "Dieser Gutschein ist noch nicht verfügbar.",
        409,
      );
    }
  }

  if (params.cartTotalCents < toCents(definition.minCartTotal)) {
    throw new OrderPricingError(
      "COUPON_MIN_TOTAL",
      `Mindestbestellwert: ${definition.minCartTotal.toFixed(2)}€.`,
      409,
    );
  }

  if (definition.maxUses || definition.perCustomerLimit) {
    const usage = await couponUsageCount({
      tenantId: params.tenantId,
      couponId: definition.id || String(selected.row.id),
      customerPhone: params.customerPhone,
    });

    if (definition.maxUses && usage.global >= definition.maxUses) {
      throw new OrderPricingError(
        "COUPON_MAX_USES",
        "Dieser Gutschein wurde bereits zu oft verwendet.",
        409,
      );
    }
    if (
      definition.perCustomerLimit &&
      params.customerPhone &&
      usage.customer >= definition.perCustomerLimit
    ) {
      throw new OrderPricingError(
        "COUPON_CUSTOMER_LIMIT",
        "Dieser Gutschein wurde für diese Telefonnummer bereits verwendet.",
        409,
      );
    }
  }

  let discountCents = 0;
  let message = "";

  if (definition.type === "fixed") {
    discountCents = Math.min(
      params.cartTotalCents,
      toCents(definition.value),
    );
    message = `${definition.value.toFixed(2)}€ Rabatt angewendet.`;
  } else if (definition.type === "percent") {
    discountCents = Math.round(
      params.cartTotalCents * (Math.min(100, definition.value) / 100),
    );
    message = `${definition.value}% Rabatt angewendet.`;
  } else if (definition.type === "free_item") {
    discountCents = 0;
    message = `Gratis: ${String(definition.meta?.freeItemName || "Artikel")}.`;
  } else if (definition.type === "bogo") {
    const rule = ensureObj(definition.meta?.bogo);
    const matchBy = String(rule?.matchBy || "sku");
    const matchValue = String(rule?.matchValue || "").toLowerCase();
    const buyQty = Math.max(0, Math.trunc(toNumber(rule?.buyQty, 0)));
    const freeQty = Math.max(0, Math.trunc(toNumber(rule?.freeQty, 0)));
    const maxFree = Math.max(
      0,
      Math.trunc(toNumber(rule?.maxFreePerOrder, 0)),
    );

    if (!matchValue || !buyQty || !freeQty) {
      throw new OrderPricingError(
        "COUPON_BOGO_CONFIG",
        "BOGO-Regel ist nicht korrekt konfiguriert.",
        409,
      );
    }

    const pool = params.couponItems
      .filter((item) => {
        const value =
          matchBy === "category"
            ? item.category
            : matchBy === "name"
              ? item.name
              : item.sku;
        return String(value || "").toLowerCase().includes(matchValue);
      })
      .flatMap((item) =>
        Array.from({ length: Math.max(0, item.qty) }, () =>
          toCents(item.unitPrice),
        ),
      )
      .sort((left, right) => left - right);

    const possibleFree = Math.floor(pool.length / buyQty) * freeQty;
    const freeCount = maxFree > 0 ? Math.min(possibleFree, maxFree) : possibleFree;
    discountCents = pool.slice(0, freeCount).reduce((sum, value) => sum + value, 0);

    if (discountCents <= 0) {
      throw new OrderPricingError(
        "COUPON_BOGO_NO_MATCH",
        "Der passende Artikel befindet sich nicht im Warenkorb.",
        409,
      );
    }
    message = `BOGO angewendet: ${buyQty} kaufen, ${freeQty} gratis.`;
  } else {
    throw new OrderPricingError(
      "COUPON_TYPE_UNSUPPORTED",
      "Dieser Gutscheintyp wird nicht unterstützt.",
      409,
    );
  }

  return {
    code,
    discountCents: Math.min(params.cartTotalCents, Math.max(0, discountCents)),
    definitionId: definition.id || String(selected.row.id),
    issuedId: issued ? String(issued.id) : null,
    message,
  };
}

function normalizePlz(value: any) {
  return String(value || "").replace(/\D/g, "").slice(0, 5);
}

function normalizeStreet(value: any) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/straße/g, "strasse")
    .replace(/\bstr\.?\b/g, "strasse")
    .replace(/\s+/g, " ")
    .trim();
}

function stringList(value: any): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item ?? "").trim()).filter(Boolean);
  }
  if (typeof value === "string") {
    return value
      .split(/[;,\n]/g)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

function findRouteDeal(params: {
  settings: any;
  mode: OrderMode;
  plz: string;
  street: string;
  now: Date;
}) {
  const config = ensureObj(params.settings?.routeDeals);
  if (params.mode !== "delivery" || config?.enabled !== true) return null;

  const active = ensureArr(config?.active);
  const street = normalizeStreet(params.street);

  return (
    active
      .filter((deal) => {
        const expiresAt = toDate(deal?.expiresAt);
        if (!expiresAt || expiresAt <= params.now) return false;
        if (normalizePlz(deal?.plz) !== params.plz) return false;

        const explicit = stringList(deal?.streets);
        const mustMatch =
          deal?.matchMode === "street" ||
          deal?.requireStreet === true ||
          explicit.length > 0;
        if (!mustMatch) return true;

        const allowed = explicit.length
          ? explicit
          : [deal?.street].filter(Boolean);
        if (!allowed.length) return true;
        return Boolean(
          street &&
            allowed.some(
              (candidate) => normalizeStreet(candidate) === street,
            ),
        );
      })
      .sort(
        (left, right) =>
          Number(toDate(left?.expiresAt)?.getTime() || 0) -
          Number(toDate(right?.expiresAt)?.getTime() || 0),
      )[0] || null
  );
}

function calculateRouteDeal(params: {
  deal: any;
  baseTotalCents: number;
  netMerchandiseCents: number;
  deliverySurchargeCents: number;
}) {
  if (!params.deal) {
    return {
      discountCents: 0,
      applied: false,
      rewardType: "",
      label: "",
    };
  }

  const minTotalCents = toCents(params.deal?.minTotal);
  const unlocked = params.baseTotalCents >= minTotalCents;
  const reward = ensureObj(params.deal?.reward);
  const type = String(reward?.type || "percent");
  let discountCents = 0;

  if (unlocked) {
    if (type === "fixed") {
      discountCents = toCents(reward?.amount);
    } else if (type === "free_delivery") {
      discountCents = params.deliverySurchargeCents;
    } else if (type === "percent") {
      discountCents = Math.round(
        params.netMerchandiseCents *
          (Math.max(0, toNumber(reward?.percent, 15)) / 100),
      );
    }

    const maxDiscountCents = toCents(reward?.maxDiscount);
    if (maxDiscountCents > 0) {
      discountCents = Math.min(discountCents, maxDiscountCents);
    }
  }

  discountCents = Math.min(
    params.baseTotalCents,
    Math.max(0, discountCents),
  );

  return {
    discountCents,
    applied:
      unlocked &&
      (discountCents > 0 || type === "free_sauce" || type === "free_drink"),
    rewardType: type,
    label: String(reward?.label || params.deal?.name || "Nachbarschafts-Deal"),
  };
}

function compareSubmittedPricing(params: {
  order: any;
  canonicalPayableCents: number;
  canonicalMerchandiseCents: number;
  canonicalDiscountCents: number;
  canonicalSurchargesCents: number;
  canonicalCouponCents: number;
}): PricingAdjustment {
  const submitted = {
    merchandise: fromCents(toCents(params.order?.merchandise)),
    discount: fromCents(toCents(params.order?.discount)),
    surcharges: fromCents(toCents(params.order?.surcharges)),
    couponDiscount: fromCents(toCents(params.order?.couponDiscount)),
    total: fromCents(toCents(params.order?.total)),
  };
  const canonical = {
    merchandise: fromCents(params.canonicalMerchandiseCents),
    discount: fromCents(params.canonicalDiscountCents),
    surcharges: fromCents(params.canonicalSurchargesCents),
    couponDiscount: fromCents(params.canonicalCouponCents),
    total: fromCents(params.canonicalPayableCents),
  };

  const submittedPayableCents = toCents(submitted.total);
  const payableDifferenceCents =
    params.canonicalPayableCents - submittedPayableCents;
  const payableChanged = Math.abs(payableDifferenceCents) > 1;
  const breakdownChanged = [
    Math.abs(
      toCents(submitted.merchandise) - params.canonicalMerchandiseCents,
    ),
    Math.abs(toCents(submitted.discount) - params.canonicalDiscountCents),
    Math.abs(toCents(submitted.surcharges) - params.canonicalSurchargesCents),
    Math.abs(
      toCents(submitted.couponDiscount) - params.canonicalCouponCents,
    ),
  ].some((difference) => difference > 1);
  const changed = payableChanged || breakdownChanged;
  const reason: PricingAdjustmentReason = !changed
    ? "none"
    : !payableChanged
      ? "breakdown_only"
      : Math.abs(payableDifferenceCents) <= 10
        ? "rounding"
        : "canonical_reprice";

  /*
   * Güvenlik client toplamını reddetmeye değil, tamamen yok sayıp DB'den
   * canonical fiyatı yeniden kurmaya dayanır. Geçersiz ürün/extra/kupon hâlâ
   * yukarıdaki doğrulamalarda hata verir. Burada stale cache, kampanya
   * muhasebesi veya yuvarlama farkı siparişi kilitlemez; ödeme ve DB kaydı
   * yalnız canonical değerlerle devam eder.
   */
  return {
    changed,
    payableChanged,
    breakdownChanged,
    reason,
    differenceCents: payableDifferenceCents,
    submitted,
    canonical,
  };
}

export async function rebuildOrderPricingFromDatabase(params: {
  tenantId: string;
  order: any;
  settings: any;
  now?: Date;
}) {
  const now = params.now ?? new Date();
  const order = ensureObj(params.order);
  const mode = normalizeMode(order?.mode);
  const customer = ensureObj(order?.customer);
  const catalog = await loadCatalog(params.tenantId, params.settings);
  const campaigns = await loadCampaigns(params.tenantId);

  const itemResult = canonicalizeItems({
    rawItems: ensureArr(order?.items),
    catalog,
    campaigns,
    settings: params.settings,
    mode,
    now,
  });

  const standardRate = standardDiscountRate(params.settings, mode);

  const conditional = evaluateConditionalCartCampaign({
    cartOffers: ensureArr(params.settings?.cartOffers),
    mode,
    baseAmount: fromCents(itemResult.merchandiseCents),
    standardRate,
    now,
  });
  const standardDiscountCents = toCents(conditional.discountAmount);

  const freebies = evaluateFreebieRules({
    config: params.settings?.freebies,
    mode,
    merchandise: fromCents(itemResult.merchandiseCents),
    units: itemResult.freebieUnits,
  });
  const freebieDiscountCents = toCents(freebies.discountedAmount);
  const merchandiseDiscountCents = Math.min(
    itemResult.merchandiseCents,
    standardDiscountCents + freebieDiscountCents,
  );
  const afterDiscountCents = Math.max(
    0,
    itemResult.merchandiseCents - merchandiseDiscountCents,
  );

  const coupon = await calculateCoupon({
    tenantId: params.tenantId,
    codeRaw: order?.coupon,
    cartTotalCents: afterDiscountCents,
    couponItems: itemResult.couponItems,
    customerPhone: normalizePhone(customer?.phone),
    now,
  });
  const netMerchandiseCents = Math.max(
    0,
    afterDiscountCents - coupon.discountCents,
  );

  const plz = normalizePlz(customer?.plz ?? customer?.zip ?? order?.plz);
  const street = String(customer?.street ?? "").trim();
  const routeDeal = findRouteDeal({
    settings: params.settings,
    mode,
    plz,
    street,
    now,
  });
  const routeBaseCents =
    netMerchandiseCents + itemResult.deliverySurchargeCents;
  const routeBenefit = calculateRouteDeal({
    deal: routeDeal,
    baseTotalCents: routeBaseCents,
    netMerchandiseCents,
    deliverySurchargeCents: itemResult.deliverySurchargeCents,
  });

  const orderBeforeTipCents = roundToTenCents(
    Math.max(0, routeBaseCents - routeBenefit.discountCents) +
      itemResult.pfandCents,
  );
  const paymentMeta = ensureObj(ensureObj(order?.meta)?.payment ?? order?.payment);
  const tipCents = Math.min(50_000, toCents(paymentMeta?.tip ?? order?.tip));
  const payableCents = roundToTenCents(orderBeforeTipCents + tipCents);

  const discountCents = merchandiseDiscountCents + routeBenefit.discountCents;
  const surchargeCents =
    itemResult.deliverySurchargeCents + itemResult.pfandCents;

  const pricingAdjustment = compareSubmittedPricing({
    order,
    canonicalPayableCents: payableCents,
    canonicalMerchandiseCents: itemResult.merchandiseCents,
    canonicalDiscountCents: discountCents,
    canonicalSurchargesCents: surchargeCents,
    canonicalCouponCents: coupon.discountCents,
  });

  return {
    mode,
    items: itemResult.canonicalItems,
    merchandiseCents: itemResult.merchandiseCents,
    discountCents,
    surchargesCents: surchargeCents,
    couponCode: coupon.code,
    couponDiscountCents: coupon.discountCents,
    tipCents,
    orderBeforeTipCents,
    payableCents,
    pricingAdjustment,
    pricingMeta: {
      source: "db",
      pricingAdjusted: pricingAdjustment.changed,
      pricingAdjustment,
      calculatedAt: now.toISOString(),
      catalogItems: itemResult.canonicalItems.length,
      merchandise: fromCents(itemResult.merchandiseCents),
      discounts: {
        standardOrCartOffer: fromCents(standardDiscountCents),
        freebies: fromCents(freebieDiscountCents),
        routeDeal: fromCents(routeBenefit.discountCents),
        coupon: fromCents(coupon.discountCents),
      },
      surcharges: {
        category: fromCents(itemResult.categorySurchargeCents),
        pfand: fromCents(itemResult.pfandCents),
      },
      conditionalCampaign: conditional,
      freebies,
      coupon: coupon.code
        ? {
            code: coupon.code,
            definitionId: coupon.definitionId,
            issuedId: coupon.issuedId,
            message: coupon.message,
          }
        : null,
      routeDeal: routeDeal
        ? {
            id: routeDeal?.id ?? null,
            ruleId: routeDeal?.ruleId ?? null,
            name: routeDeal?.name ?? "Nachbarschafts-Deal",
            applied: routeBenefit.applied,
            rewardType: routeBenefit.rewardType,
            discount: fromCents(routeBenefit.discountCents),
          }
        : null,
      tip: fromCents(tipCents),
      orderBeforeTip: fromCents(orderBeforeTipCents),
      payable: fromCents(payableCents),
    },
  };
}

/**
 * Uses the canonical order snapshot persisted by the payment prepare route.
 * This path is only valid after the internal payment-finalize HMAC has been
 * verified by /api/orders/create.
 *
 * Repricing a paid order against a newer catalog/campaign could make the DB
 * total diverge from the amount Stripe already collected. The signed pending
 * snapshot is therefore the immutable pricing authority for finalization.
 */
export function rebuildOrderPricingFromVerifiedPayment(orderInput: any) {
  const order = ensureObj(orderInput);
  const mode = normalizeMode(order?.mode);
  const items = ensureArr(order?.items);

  if (!items.length) {
    throw new OrderPricingError(
      "ORDER_ITEMS_EMPTY",
      "Der Warenkorb ist leer.",
      400,
    );
  }

  const meta = ensureObj(order?.meta);
  const payment = ensureObj(meta?.payment ?? order?.payment);
  const merchandiseCents = toCents(order?.merchandise);
  const discountCents = toCents(order?.discount);
  const surchargesCents = toCents(order?.surcharges);
  const couponDiscountCents = toCents(order?.couponDiscount);
  const payableCents = toCents(order?.total);
  const tipCents = Math.min(50_000, toCents(payment?.tip ?? meta?.tip));
  const orderBeforeTipCents = Math.max(0, payableCents - tipCents);
  const paidOrderTotalCents = toCents(
    payment?.orderTotal ?? payment?.baseTotal ?? order?.total,
  );

  if (
    payableCents <= 0 ||
    paidOrderTotalCents <= 0 ||
    Math.abs(paidOrderTotalCents - payableCents) > 1
  ) {
    throw new OrderPricingError(
      "PAYMENT_TOTAL_MISMATCH",
      "Der bestätigte Zahlbetrag stimmt nicht mit der Bestellung überein.",
      409,
    );
  }

  const canonical: CanonicalPricingSnapshot = {
    merchandise: fromCents(merchandiseCents),
    discount: fromCents(discountCents),
    surcharges: fromCents(surchargesCents),
    couponDiscount: fromCents(couponDiscountCents),
    total: fromCents(payableCents),
  };
  const pricingMeta = ensureObj(payment?.pricing ?? meta?.pricing);
  const storedAdjustment = ensureObj(
    payment?.pricingAdjustment ?? pricingMeta?.pricingAdjustment,
  );
  const submitted = ensureObj(storedAdjustment?.submitted);
  const storedCanonical = ensureObj(storedAdjustment?.canonical);
  const pricingAdjustment: PricingAdjustment = {
    changed: storedAdjustment?.changed === true,
    payableChanged: storedAdjustment?.payableChanged === true,
    breakdownChanged: storedAdjustment?.breakdownChanged === true,
    reason: [
      "breakdown_only",
      "rounding",
      "canonical_reprice",
    ].includes(String(storedAdjustment?.reason || ""))
      ? (String(storedAdjustment.reason) as PricingAdjustmentReason)
      : "none",
    differenceCents: Math.round(toNumber(storedAdjustment?.differenceCents, 0)),
    submitted: {
      merchandise: fromCents(toCents(submitted?.merchandise ?? canonical.merchandise)),
      discount: fromCents(toCents(submitted?.discount ?? canonical.discount)),
      surcharges: fromCents(toCents(submitted?.surcharges ?? canonical.surcharges)),
      couponDiscount: fromCents(
        toCents(submitted?.couponDiscount ?? canonical.couponDiscount),
      ),
      total: fromCents(toCents(submitted?.total ?? canonical.total)),
    },
    canonical: {
      merchandise: fromCents(
        toCents(storedCanonical?.merchandise ?? canonical.merchandise),
      ),
      discount: fromCents(
        toCents(storedCanonical?.discount ?? canonical.discount),
      ),
      surcharges: fromCents(
        toCents(storedCanonical?.surcharges ?? canonical.surcharges),
      ),
      couponDiscount: fromCents(
        toCents(storedCanonical?.couponDiscount ?? canonical.couponDiscount),
      ),
      total: fromCents(toCents(storedCanonical?.total ?? canonical.total)),
    },
  };

  return {
    mode,
    items,
    merchandiseCents,
    discountCents,
    surchargesCents,
    couponCode: order?.coupon ? String(order.coupon).trim() : null,
    couponDiscountCents,
    tipCents,
    orderBeforeTipCents,
    payableCents,
    pricingAdjustment,
    pricingMeta: {
      ...pricingMeta,
      source: "payment_locked",
      pricingLocked: true,
      pricingAdjusted: pricingAdjustment.changed,
      pricingAdjustment,
    },
  };
}
