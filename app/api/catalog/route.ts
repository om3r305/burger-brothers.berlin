// app/api/catalog/route.ts
import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma, getTenantId } from "@/lib/db";
import { readFallbackSnapshot, writeFallbackSnapshot } from "@/lib/server/fallback-snapshot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const VALID_CATEGORIES = new Set([
  "burger",
  "vegan",
  "sauces",
  "drinks",
  "extras",
  "hotdogs",
  "donuts",
  "bubbletea",
]);

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate",
};

const CATALOG_TRANSACTION_MAX_WAIT_MS = 15_000;
const CATALOG_TRANSACTION_TIMEOUT_MS = 60_000;

function hasModelField(modelName: string, fieldName: string) {
  try {
    const model = Prisma.dmmf.datamodel.models.find((item) => item.name === modelName);
    return Boolean(model?.fields?.some((field) => field.name === fieldName));
  } catch {
    return false;
  }
}

function hasProductField(fieldName: string) {
  return hasModelField("Product", fieldName);
}

function hasCampaignField(fieldName: string) {
  return hasModelField("Campaign", fieldName);
}

function kebab(value: string) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 64);
}

function hashText(value: string) {
  let hash = 0;
  const text = String(value || "");

  for (let i = 0; i < text.length; i += 1) {
    hash = (hash << 5) - hash + text.charCodeAt(i);
    hash |= 0;
  }

  return Math.abs(hash).toString(36);
}

function normalizeString(value: any, fallback = "") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function toPlainNumber(value: any, fallback = 0) {
  if (typeof value === "number" && Number.isFinite(value)) return value;

  if (value instanceof Prisma.Decimal) {
    return value.toNumber();
  }

  if (value == null || value === "") return fallback;

  const text = String(value)
    .trim()
    .replace(/[€\s]/g, "")
    .replace(",", ".");

  const match = text.match(/-?\d+(\.\d+)?/);
  const number = match ? Number(match[0]) : Number(text);

  return Number.isFinite(number) ? number : fallback;
}

function toDecimal(value: any) {
  return new Prisma.Decimal(toPlainNumber(value, 0));
}

function decimalToNumber(value: any) {
  return toPlainNumber(value, 0);
}

function toDate(value: any): Date | null {
  if (!value && value !== 0) return null;

  if (value instanceof Date) {
    return Number.isFinite(value.valueOf()) ? value : null;
  }

  if (typeof value === "number") {
    const date = new Date(value);
    return Number.isFinite(date.valueOf()) ? date : null;
  }

  if (typeof value === "string") {
    const text = value.trim();
    if (!text) return null;

    const asNumber = Number(text);

    if (Number.isFinite(asNumber) && asNumber > 0) {
      const byNumber = new Date(asNumber);
      if (Number.isFinite(byNumber.valueOf())) return byNumber;
    }

    const parsed = new Date(text);
    if (Number.isFinite(parsed.valueOf())) return parsed;

    const german = text.match(
      /^(\d{2})\.(\d{2})\.(\d{4})(?:\s+(\d{2}):(\d{2})(?::(\d{2}))?)?$/,
    );

    if (german) {
      const [, dd, mm, yyyy, hh = "00", min = "00", sec = "00"] = german;

      const date = new Date(
        Number(yyyy),
        Number(mm) - 1,
        Number(dd),
        Number(hh),
        Number(min),
        Number(sec),
      );

      return Number.isFinite(date.valueOf()) ? date : null;
    }
  }

  return null;
}

function toIso(value: any): string | null {
  const date = toDate(value);
  return date ? date.toISOString() : null;
}

function safeJsonParse<T = any>(value: any, fallback: T): T {
  try {
    if (typeof value !== "string") return (value ?? fallback) as T;
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
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

  if (typeof value === "bigint") return value.toString();
  if (typeof value === "function" || typeof value === "symbol") return null;

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeJson(item));
  }

  if (value && typeof value === "object") {
    const out: Record<string, any> = {};

    for (const [key, item] of Object.entries(value)) {
      if (key === "__proto__" || key === "prototype" || key === "constructor") {
        continue;
      }

      if (item === undefined) continue;

      out[key] = sanitizeJson(item);
    }

    return out;
  }

  return value;
}

function asArray(value: any): any[] {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.items)) return value.items;
  if (Array.isArray(value?.data)) return value.data;
  if (Array.isArray(value?.products)) return value.products;
  if (Array.isArray(value?.campaigns)) return value.campaigns;
  return [];
}

function looksLikeProduct(value: any) {
  return Boolean(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      (value.sku ||
        value.code ||
        value.name ||
        value.title ||
        value.price !== undefined ||
        value.category ||
        value.cat),
  );
}

function looksLikeCampaign(value: any) {
  return Boolean(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      (value.type ||
        value.percent !== undefined ||
        value.value !== undefined ||
        value.amount !== undefined ||
        value.scope ||
        value.target ||
        value.badgeText ||
        value.badge ||
        value.payload ||
        value.productIds ||
        value.targetProductId),
  );
}

function productArrayFromBody(body: any): any[] {
  if (Array.isArray(body)) return body;
  if (Array.isArray(body?.products)) return body.products;
  if (Array.isArray(body?.items)) return body.items;
  if (Array.isArray(body?.data)) return body.data;
  if (body?.product && typeof body.product === "object") return [body.product];

  if (looksLikeProduct(body) && !looksLikeCampaign(body)) {
    return [body];
  }

  return [];
}

function campaignArrayFromBody(body: any): any[] {
  if (Array.isArray(body?.campaigns)) return body.campaigns;
  if (body?.campaign && typeof body.campaign === "object") return [body.campaign];

  if (looksLikeCampaign(body) && !Array.isArray(body)) {
    return [body];
  }

  return [];
}

function normalizeCategory(value: any): string {
  const raw = String(value ?? "").toLowerCase().trim();

  if (!raw) return "burger";

  if (raw.includes("vegan") || raw.includes("vegetar")) return "vegan";

  if (
    raw.includes("drink") ||
    raw.includes("getränk") ||
    raw.includes("getraenk") ||
    raw.includes("getranke")
  ) {
    return "drinks";
  }

  if (raw.includes("soß") || raw.includes("sauce") || raw.includes("sos")) {
    return "sauces";
  }

  if (
    raw.includes("hotdog") ||
    raw.includes("hot dog") ||
    (raw.includes("hot") && raw.includes("dog"))
  ) {
    return "hotdogs";
  }

  if (raw.includes("donut") || raw.includes("doughnut")) return "donuts";

  if (
    raw.includes("bubble") ||
    raw.includes("boba") ||
    raw.includes("milk tea") ||
    raw.includes("bubbletea") ||
    raw.includes("bubble-tea") ||
    raw.includes("bubble_tea")
  ) {
    return "bubbletea";
  }

  if (
    raw.includes("extra") ||
    raw.includes("snack") ||
    raw.includes("pommes") ||
    raw.includes("fries")
  ) {
    return "extras";
  }

  if (raw.includes("burger")) return "burger";

  const simple = kebab(raw).replace(/-/g, "");

  if (VALID_CATEGORIES.has(simple)) return simple;

  return "burger";
}

function normalizeSku(item: any) {
  const direct = normalizeString(item?.sku ?? item?.code, "");
  if (direct) return direct.slice(0, 96);

  const legacyId = normalizeString(item?.id, "");

  if (legacyId && !legacyId.startsWith("cm") && legacyId.length <= 96) {
    return legacyId;
  }

  const fromName = kebab(String(item?.name ?? item?.title ?? "product"));
  return (fromName || `product-${Date.now()}`).slice(0, 96);
}

function normalizeExtras(value: any): any[] {
  const parsed = typeof value === "string" ? safeJsonParse<any[]>(value, []) : value;

  if (!Array.isArray(parsed)) return [];

  return parsed
    .filter(Boolean)
    .map((extra: any) => ({
      id: normalizeString(extra?.id ?? extra?.sku ?? extra?.code ?? extra?.name, ""),
      sku: normalizeString(extra?.sku ?? extra?.id ?? extra?.code, ""),
      name: normalizeString(extra?.name ?? extra?.label, "Extra"),
      label: normalizeString(extra?.label ?? extra?.name, "Extra"),
      price: toPlainNumber(extra?.price, 0),
    }))
    .filter((extra) => extra.id || extra.sku || extra.name);
}

function normalizeAllergens(value: any): string[] {
  const parsed = typeof value === "string" ? safeJsonParse<any[]>(value, []) : value;

  if (!Array.isArray(parsed)) return [];

  return parsed.map((item: any) => String(item ?? "").trim()).filter(Boolean);
}

function normalizeBool(value: any, fallback = true) {
  if (typeof value === "boolean") return value;

  const text = String(value ?? "").toLowerCase().trim();

  if (text === "1" || text === "true" || text === "yes" || text === "ja" || text === "aktiv") {
    return true;
  }

  if (
    text === "0" ||
    text === "false" ||
    text === "no" ||
    text === "nein" ||
    text === "inaktiv"
  ) {
    return false;
  }

  return fallback;
}

function normalizeProductInput(item: any) {
  const sku = normalizeSku(item);
  const name = normalizeString(item?.name ?? item?.title, sku || "Produkt");
  const category = normalizeCategory(item?.category ?? item?.cat);

  const extras = normalizeExtras(item?.extras ?? item?.extrasJson ?? item?.extras_json);
  const allergens = normalizeAllergens(item?.allergens ?? item?.allergenes);

  const description =
    item?.description === undefined && item?.desc === undefined
      ? null
      : String(item?.description ?? item?.desc ?? "");

  const imageUrl =
    item?.imageUrl === undefined &&
    item?.image === undefined &&
    item?.cover === undefined &&
    item?.photoUrl === undefined
      ? null
      : String(item?.imageUrl ?? item?.image ?? item?.cover ?? item?.photoUrl ?? "");

  return {
    sku,
    name,
    description,
    imageUrl,
    category,
    price: toDecimal(item?.price),
    active: normalizeBool(item?.active ?? item?.enabled, true),
    activeFrom: toDate(item?.activeFrom ?? item?.startAt ?? item?.startsAt),
    activeTo: toDate(item?.activeTo ?? item?.endAt ?? item?.endsAt),
    extrasJson: extras.length ? sanitizeJson(extras) : null,
    allergens: allergens.length ? sanitizeJson(allergens) : null,
  };
}

function serializeProduct(row: any) {
  const extras = normalizeExtras(row?.extrasJson ?? row?.extras);
  const allergens = normalizeAllergens(row?.allergens);
  const category = normalizeCategory(row?.category);

  return sanitizeJson({
    id: String(row?.id ?? ""),
    sku: String(row?.sku ?? row?.id ?? ""),
    code: row?.code ?? row?.sku ?? undefined,
    name: String(row?.name ?? "Produkt"),
    description: row?.description ?? "",
    imageUrl: row?.imageUrl ?? undefined,
    image: row?.imageUrl ?? undefined,
    cover: row?.imageUrl ?? undefined,
    category,
    categoryKey: category,
    price: decimalToNumber(row?.price),
    active: row?.active !== false,
    activeFrom: toIso(row?.activeFrom),
    activeTo: toIso(row?.activeTo),
    extras,
    extrasJson: extras,
    allergens,
    allergenHinweise: row?.allergenHinweise ?? row?.allergenNotes ?? undefined,
    order: typeof row?.order === "number" ? row.order : undefined,
    sortOrder: typeof row?.sortOrder === "number" ? row.sortOrder : undefined,
    dailyLimit: typeof row?.dailyLimit === "number" ? row.dailyLimit : undefined,
    createdAt: toIso(row?.createdAt),
    updatedAt: toIso(row?.updatedAt),
  });
}

function normalizeCampaignMode(value: any) {
  if (!value) return "both";

  if (typeof value === "object") {
    const delivery = !!(value.delivery ?? value.lieferung ?? value.lifa);
    const pickup = !!(value.pickup ?? value.abholung ?? value.apollon);

    if (delivery && pickup) return "both";
    if (delivery) return "delivery";
    if (pickup) return "pickup";

    return "both";
  }

  const text = String(value).toLowerCase().trim();

  if (
    text.includes("both") ||
    text.includes("alle") ||
    text.includes("beide") ||
    text.includes("her ikisi")
  ) {
    return "both";
  }

  const isDelivery = /(liefer|delivery|lifa)/.test(text);
  const isPickup = /(abhol|pickup|apollon|apollo)/.test(text);

  if (isDelivery && isPickup) return "both";
  if (isDelivery) return "delivery";
  if (isPickup) return "pickup";

  return text === "delivery" ? "delivery" : text === "pickup" ? "pickup" : "both";
}

function normalizeCampaignPayload(input: any) {
  const payload =
    input?.payload && typeof input.payload === "object" && !Array.isArray(input.payload)
      ? input.payload
      : {};

  const merged = {
    ...payload,
    ...input,
  };

  const kind = String(merged?.kind ?? merged?.valueType ?? "").toLowerCase();
  const scope = String(merged?.scope ?? merged?.target ?? "").toLowerCase();

  const productIds = Array.from(
    new Set(
      [
        ...(Array.isArray(merged?.productIds) ? merged.productIds : []),
        ...(Array.isArray(merged?.products)
          ? merged.products.map((product: any) => product?.id ?? product?.sku ?? product?.code ?? product?.name)
          : []),
        merged?.targetProductId,
        merged?.productId,
        merged?.sku,
        merged?.targetId,
      ]
        .map((item) => String(item ?? "").trim())
        .filter(Boolean),
    ),
  );

  const rawType = String(merged?.type ?? "").trim();

  const type =
    rawType === "percentOffProduct" || scope.includes("product") || productIds.length > 0
      ? "percentOffProduct"
      : rawType === "fixedOffProduct"
        ? "fixedOffProduct"
        : "percentOffCategory";

  const rawPercent = Number(merged?.percent ?? merged?.value ?? merged?.amount ?? 0);

  const percent =
    kind && kind !== "percent" && !rawType.startsWith("percentOff")
      ? 0
      : Math.max(0, Math.min(100, Number.isFinite(rawPercent) ? rawPercent : 0));

  const targetCategory =
    type === "percentOffCategory"
      ? normalizeCategory(
          merged?.targetCategory ??
            merged?.category ??
            (Array.isArray(merged?.categories) ? merged.categories[0] : undefined),
        )
      : undefined;

  return sanitizeJson({
    ...payload,
    type,
    percent,
    targetCategory,
    targetProductId: productIds[0],
    productIds,
    mode: normalizeCampaignMode(merged?.mode),
    active: normalizeBool(merged?.active ?? merged?.enabled, true),
    startsAt: toIso(merged?.startsAt ?? merged?.startAt ?? merged?.from),
    endsAt: toIso(merged?.endsAt ?? merged?.endAt ?? merged?.until ?? merged?.to),
    priority: Number(merged?.priority ?? merged?.prio ?? 0) || 0,
    badgeText: merged?.badgeText ?? merged?.badge ?? merged?.label ?? undefined,
  });
}

function normalizeCampaignId(input: any) {
  const direct = normalizeString(input?.id, "");
  if (direct) return direct;

  const code = normalizeString(input?.code, "");
  if (code) return `campaign-${kebab(code)}`;

  const name = normalizeString(input?.title ?? input?.name ?? input?.badgeText, "campaign");
  const payloadHash = hashText(JSON.stringify(input ?? {}));

  return `campaign-${kebab(name)}-${payloadHash}`;
}

function serializeCampaign(row: any) {
  const rawPayload = row?.payload && typeof row.payload === "object" ? row.payload : {};

  const payload = normalizeCampaignPayload({
    ...rawPayload,
    id: row?.id,
    code: row?.code,
    title: row?.title,
    name: row?.title,
    badgeText: row?.badgeText,
    startsAt: row?.startsAt,
    endsAt: row?.endsAt,
  });

  return sanitizeJson({
    id: String(row?.id ?? ""),
    code: row?.code ?? null,
    title: row?.title ?? "Campaign",
    name: row?.title ?? "Campaign",
    badgeText: row?.badgeText ?? payload.badgeText ?? null,
    startsAt: toIso(row?.startsAt ?? payload.startsAt),
    endsAt: toIso(row?.endsAt ?? payload.endsAt),
    createdAt: toIso(row?.createdAt),
    updatedAt: toIso(row?.updatedAt),
    ...payload,
    payload,
  });
}

function jsonResponse(payload: Record<string, any>, status = 200) {
  return NextResponse.json(payload, {
    status,
    headers: NO_STORE_HEADERS,
  });
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

function productDataForDb(item: ReturnType<typeof normalizeProductInput>) {
  const data: Record<string, any> = {};

  if (hasProductField("name")) data.name = item.name;
  if (hasProductField("description")) data.description = item.description;
  if (hasProductField("imageUrl")) data.imageUrl = item.imageUrl;
  if (hasProductField("category")) data.category = item.category;
  if (hasProductField("price")) data.price = item.price;
  if (hasProductField("active")) data.active = item.active;
  if (hasProductField("activeFrom")) data.activeFrom = item.activeFrom;
  if (hasProductField("activeTo")) data.activeTo = item.activeTo;
  if (hasProductField("extrasJson")) data.extrasJson = item.extrasJson as any;
  if (hasProductField("allergens")) data.allergens = item.allergens as any;

  return data;
}

function campaignDataForDb(rawCampaign: any, payload: any) {
  const title = normalizeString(rawCampaign?.title ?? rawCampaign?.name ?? rawCampaign?.badgeText, "Campaign");

  const code = rawCampaign?.code ? String(rawCampaign.code).trim() : null;

  const badgeText =
    rawCampaign?.badgeText ??
    rawCampaign?.badge ??
    rawCampaign?.label ??
    payload?.badgeText ??
    null;

  const data: Record<string, any> = {};

  if (hasCampaignField("code")) data.code = code;
  if (hasCampaignField("title")) data.title = title;
  if (hasCampaignField("badgeText")) data.badgeText = badgeText;
  if (hasCampaignField("startsAt")) data.startsAt = toDate(rawCampaign?.startsAt ?? rawCampaign?.startAt ?? rawCampaign?.from);
  if (hasCampaignField("endsAt")) data.endsAt = toDate(rawCampaign?.endsAt ?? rawCampaign?.endAt ?? rawCampaign?.until ?? rawCampaign?.to);
  if (hasCampaignField("payload")) data.payload = sanitizeJson(payload) as any;

  return data;
}

async function saveProduct(tx: any, tenantId: string, item: ReturnType<typeof normalizeProductInput>) {
  const existing = await tx.product.findFirst({
    where: {
      tenantId,
      sku: item.sku,
    },
    select: {
      id: true,
    },
  });

  const data = productDataForDb(item);

  if (existing?.id) {
    await tx.product.update({
      where: {
        id: existing.id,
      },
      data,
    });

    await tx.product.deleteMany({
      where: {
        tenantId,
        sku: item.sku,
        id: {
          not: existing.id,
        },
      },
    });

    return;
  }

  await tx.product.create({
    data: {
      tenantId,
      sku: item.sku,
      ...data,
    },
  });
}

async function saveCampaign(tx: any, tenantId: string, rawCampaign: any) {
  const id = normalizeCampaignId(rawCampaign);
  const payload = normalizeCampaignPayload(rawCampaign);
  const data = campaignDataForDb(rawCampaign, payload);

  const existing = await tx.campaign.findFirst({
    where: {
      tenantId,
      id,
    },
    select: {
      id: true,
    },
  });

  if (existing?.id) {
    await tx.campaign.update({
      where: {
        id: existing.id,
      },
      data,
    });

    return id;
  }

  await tx.campaign.create({
    data: {
      id,
      tenantId,
      ...data,
    },
  });

  return id;
}

function isPrismaTransactionClosedError(error: any) {
  const code = String(error?.code || "").toUpperCase();
  const message = String(error?.message || error || "").toLowerCase();

  return (
    code === "P2028" ||
    message.includes("transaction api error") ||
    message.includes("transaction not found") ||
    message.includes("transaction id is invalid") ||
    message.includes("closed transaction") ||
    message.includes("transaction already closed")
  );
}

function uniqueProductInputs(products: any[]) {
  const map = new Map<string, ReturnType<typeof normalizeProductInput>>();

  for (const rawProduct of products) {
    const item = normalizeProductInput(rawProduct);
    if (!item.sku) continue;

    /*
      Aynı SKU iki kez gelirse son hali kazanır.
      Admin edit sırasında ürünün güncel form hali payload'ın sonunda kalabildiği için
      eski değer yanlışlıkla DB'ye geri basılmasın.
    */
    map.set(item.sku, item);
  }

  return Array.from(map.values());
}

function uniqueCampaignInputs(campaigns: any[]) {
  const map = new Map<string, any>();

  for (const rawCampaign of campaigns) {
    const id = normalizeCampaignId(rawCampaign);
    if (!id) continue;
    map.set(id, rawCampaign);
  }

  return Array.from(map.values());
}

async function persistCatalog(
  tenantId: string,
  productInputs: ReturnType<typeof normalizeProductInput>[],
  campaignInputs: any[],
  replace: boolean,
) {
  const seenSkus = new Set<string>();
  const seenCampaignIds = new Set<string>();

  const run = async (db: any) => {
    seenSkus.clear();
    seenCampaignIds.clear();

    for (const item of productInputs) {
      if (!item.sku) continue;

      seenSkus.add(item.sku);
      await saveProduct(db, tenantId, item);
    }

    /*
      DB-first güvenlik:
      replace=true ama ürün listesi boş/stale gelirse ürünleri silmiyoruz.
    */
    if (replace && productInputs.length > 0 && seenSkus.size > 0) {
      await db.product.deleteMany({
        where: {
          tenantId,
          sku: {
            notIn: Array.from(seenSkus),
          },
        },
      });
    }

    for (const rawCampaign of campaignInputs) {
      const id = await saveCampaign(db, tenantId, rawCampaign);
      seenCampaignIds.add(id);
    }

    /*
      DB-first güvenlik:
      replace=true ama kampanya listesi boş/stale gelirse kampanyaları silmiyoruz.
    */
    if (replace && campaignInputs.length > 0 && seenCampaignIds.size > 0) {
      await db.campaign.deleteMany({
        where: {
          tenantId,
          id: {
            notIn: Array.from(seenCampaignIds),
          },
        },
      });
    }
  };

  try {
    await prisma.$transaction(
      async (tx) => {
        await run(tx);
      },
      {
        maxWait: CATALOG_TRANSACTION_MAX_WAIT_MS,
        timeout: CATALOG_TRANSACTION_TIMEOUT_MS,
      },
    );

    return {
      saveMode: "transaction",
      savedInputProducts: productInputs.length,
      savedInputCampaigns: campaignInputs.length,
    };
  } catch (error) {
    if (!isPrismaTransactionClosedError(error)) {
      throw error;
    }

    /*
      Prisma interactive transaction default timeout eski halinde 5sn civarında patlıyordu.
      Büyük menü import/edit payloadlarında transaction kapanırsa aynı işi direct fallback ile
      tamamlıyoruz. Böylece Admin "kaydetti gibi" görünüp DB eski halde kalmıyor.
    */
    console.error("CATALOG transaction closed, retrying without interactive transaction", error);

    await run(prisma);

    return {
      saveMode: "direct-fallback",
      savedInputProducts: productInputs.length,
      savedInputCampaigns: campaignInputs.length,
    };
  }
}

async function listCatalog(tenantId: string) {
  const [products, campaigns] = await Promise.all([
    prisma.product.findMany({
      where: {
        tenantId,
      },
      orderBy: [{ category: "asc" }, { name: "asc" }],
    }),
    prisma.campaign.findMany({
      where: {
        tenantId,
      },
      orderBy: [{ createdAt: "desc" }],
    }),
  ]);

  return {
    products: products.map(serializeProduct),
    campaigns: campaigns.map(serializeCampaign),
  };
}


function catalogResponsePayload(
  catalog: { products?: any[]; campaigns?: any[] },
  source: "db" | "fallback",
) {
  const products = Array.isArray(catalog?.products) ? catalog.products : [];
  const campaigns = Array.isArray(catalog?.campaigns) ? catalog.campaigns : [];

  return {
    ok: true,
    source,
    products,
    items: products,
    campaigns,
    counts: {
      products: products.length,
      campaigns: campaigns.length,
    },
  };
}

async function readCatalogFallback() {
  const catalog = await readFallbackSnapshot<any>("catalog");

  if (
    catalog &&
    (Array.isArray(catalog?.products) ||
      Array.isArray(catalog?.items) ||
      Array.isArray(catalog?.campaigns))
  ) {
    return catalogResponsePayload(
      {
        products: Array.isArray(catalog.products) ? catalog.products : catalog.items,
        campaigns: Array.isArray(catalog.campaigns) ? catalog.campaigns : [],
      },
      "fallback",
    );
  }

  const products = await readFallbackSnapshot<any>("products");

  const productItems = Array.isArray(products?.items)
    ? products.items
    : Array.isArray(products?.products)
      ? products.products
      : Array.isArray(products)
        ? products
        : [];

  if (!productItems.length) return null;

  return catalogResponsePayload(
    {
      products: productItems,
      campaigns: [],
    },
    "fallback",
  );
}

async function writeCatalogFallback(catalog: { products: any[]; campaigns: any[] }) {
  const payload = catalogResponsePayload(catalog, "fallback");

  const [catalogSaved, productsSaved] = await Promise.all([
    writeFallbackSnapshot("catalog", payload).catch((error) => {
      console.warn("[catalog:fallback] catalog write failed", error);
      return null;
    }),
    writeFallbackSnapshot("products", {
      ok: true,
      source: "fallback",
      items: payload.products,
      products: payload.products,
      count: payload.products.length,
    }).catch((error) => {
      console.warn("[catalog:fallback] products write failed", error);
      return null;
    }),
  ]);

  return {
    catalog: catalogSaved,
    products: productsSaved,
  };
}


async function readBody(req: Request) {
  try {
    return await req.json();
  } catch {
    return {};
  }
}

export async function GET() {
  try {
    const tenantId = await getTenantId();
    const catalog = await listCatalog(tenantId);

    return jsonResponse(catalogResponsePayload(catalog, "db"));
  } catch (error: any) {
    const fallback = await readCatalogFallback();

    if (fallback) {
      return jsonResponse({
        ...fallback,
        dbError: error?.message || "CATALOG_GET_FAILED",
      });
    }

    return errorResponse(error, "CATALOG_GET_FAILED");
  }
}

export async function PUT(req: Request) {
  try {
    const tenantId = await getTenantId();
    const body = await readBody(req);

    const products = productArrayFromBody(body);
    const campaigns = campaignArrayFromBody(body);
    const replace = body?.replace === true;

    const productInputs = uniqueProductInputs(products);
    const campaignInputs = uniqueCampaignInputs(campaigns);

    const saveResult = await persistCatalog(tenantId, productInputs, campaignInputs, replace);

    const catalog = await listCatalog(tenantId);
    const fallbackSaved = await writeCatalogFallback(catalog);

    return jsonResponse({
      ...catalogResponsePayload(catalog, "db"),
      fallbackSaved,
      saveMode: saveResult.saveMode,
      counts: {
        inputProducts: products.length,
        inputCampaigns: campaigns.length,
        savedInputProducts: saveResult.savedInputProducts,
        savedInputCampaigns: saveResult.savedInputCampaigns,
        savedProducts: catalog.products.length,
        savedCampaigns: catalog.campaigns.length,
      },
    });
  } catch (error: any) {
    return errorResponse(error, "CATALOG_PUT_FAILED");
  }
}

export async function POST(req: Request) {
  return PUT(req);
}