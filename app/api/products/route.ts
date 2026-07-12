// app/api/products/route.ts
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

const ADMIN_COOKIE = process.env.ADMIN_COOKIE_NAME || "bb_admin_sess";

const PUBLIC_READ_CACHE_TTL_MS = 30_000;
let productsMemoryCache:
  | {
      expiresAt: number;
      items: any[];
    }
  | null = null;

function readProductsMemoryCache() {
  if (!productsMemoryCache) return null;
  if (productsMemoryCache.expiresAt <= Date.now()) {
    productsMemoryCache = null;
    return null;
  }
  return productsMemoryCache.items;
}

function writeProductsMemoryCache(items: any[]) {
  productsMemoryCache = {
    expiresAt: Date.now() + PUBLIC_READ_CACHE_TTL_MS,
    items,
  };
}

function clearProductsMemoryCache() {
  productsMemoryCache = null;
}

function shouldWriteRuntimeSnapshot() {
  return !process.env.VERCEL;
}


function hasAdminSession(req: Request) {
  const cookie = req.headers.get("cookie") || "";
  const parts = cookie.split(";").map((part) => part.trim());
  const found = parts.find((part) => part.startsWith(`${ADMIN_COOKIE}=`));
  const value = found ? decodeURIComponent(found.slice(ADMIN_COOKIE.length + 1)) : "";

  return value.startsWith("ok:");
}

function requireAdminAuth(req: Request) {
  if (hasAdminSession(req)) return null;

  return jsonResponse(
    {
      ok: false,
      source: "db",
      error: "not_authenticated",
      message: "Nicht angemeldet.",
    },
    401,
  );
}

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

function kebab(value: string) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 64);
}

function isAllFilter(value: any) {
  const text = String(value ?? "").toLowerCase().trim();
  return !text || text === "all" || text === "alle" || text === "*" || text === "any";
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
  if (Array.isArray(value?.products)) return value.products;
  if (Array.isArray(value?.data)) return value.data;

  if (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    (value.sku || value.code || value.id || value.name || value.title)
  ) {
    return [value];
  }

  return [];
}

function normalizeCategory(value: any): string {
  const raw = String(value ?? "").toLowerCase().trim();

  if (!raw || isAllFilter(raw)) return "burger";

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
  if (legacyId && legacyId.length <= 96) return legacyId;

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
    category: normalizeCategory(item?.category ?? item?.cat),
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
    createdAt: toIso(row?.createdAt),
    updatedAt: toIso(row?.updatedAt),
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

async function readRequestBody(req: Request) {
  try {
    return await req.json();
  } catch {
    return {};
  }
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

async function listProducts(tenantId: string, categoryRaw?: string | null) {
  const where: Record<string, any> = {
    tenantId,
  };

  if (categoryRaw && !isAllFilter(categoryRaw)) {
    where.category = normalizeCategory(categoryRaw);
  }

  const products = await prisma.product.findMany({
    where,
    orderBy: [{ category: "asc" }, { name: "asc" }],
  });

  return products.map(serializeProduct);
}


function productsResponsePayload(items: any[], source: "db" | "cache_fallback" | "default_fallback") {
  return {
    ok: true,
    source,
    items,
    products: items,
    count: items.length,
  };
}

function filterProductItems(items: any[], categoryRaw?: string | null, activeOnly = false) {
  let out = Array.isArray(items) ? items.slice() : [];

  if (categoryRaw && !isAllFilter(categoryRaw)) {
    const category = normalizeCategory(categoryRaw);
    out = out.filter((item) => normalizeCategory(item?.category ?? item?.categoryKey) === category);
  }

  if (activeOnly) {
    out = out.filter((item) => item?.active !== false);
  }

  return out;
}

async function readProductsFallback(categoryRaw?: string | null, activeOnly = false) {
  const fallback = await readFallbackSnapshot<any>("products");

  const rawItems = Array.isArray(fallback?.items)
    ? fallback.items
    : Array.isArray(fallback?.products)
      ? fallback.products
      : Array.isArray(fallback)
        ? fallback
        : [];

  if (!rawItems.length) return null;

  const items = filterProductItems(rawItems, categoryRaw, activeOnly);

  return productsResponsePayload(items, "cache_fallback");
}

async function writeProductsFallback(items: any[]) {
  if (!Array.isArray(items) || !items.length) {
    return {
      skipped: true,
      reason: "empty_products",
    };
  }

  return writeFallbackSnapshot("products", productsResponsePayload(items, "cache_fallback")).catch(
    (error) => {
      console.warn("[products:fallback] write failed", error);
      return null;
    },
  );
}


export async function GET(req: Request) {
  try {
    const url = new URL(req.url);

    const category = url.searchParams.get("category") || url.searchParams.get("cat");
    const activeOnly =
      url.searchParams.get("active") === "1" ||
      url.searchParams.get("active") === "true";

    let allItems = readProductsMemoryCache();

    if (!allItems) {
      const tenantId = await getTenantId();
      allItems = await listProducts(tenantId);
      writeProductsMemoryCache(allItems);
    }

    let items = allItems;

    if (category && !isAllFilter(category)) {
      const normalizedCategory = normalizeCategory(category);
      items = items.filter((item) => item.category === normalizedCategory);
    }

    if (activeOnly) {
      items = items.filter((item) => item.active !== false);
    }

    const fallbackSaved =
      !category && !activeOnly && shouldWriteRuntimeSnapshot()
        ? await writeProductsFallback(items)
        : null;

    return jsonResponse({
      ok: true,
      source: "db",
      fallbackSaved,
      memoryCached: Boolean(readProductsMemoryCache()),
      items,
      products: items,
      count: items.length,
    });
  } catch (error: any) {
    const url = new URL(req.url);
    const category = url.searchParams.get("category") || url.searchParams.get("cat");
    const activeOnly =
      url.searchParams.get("active") === "1" ||
      url.searchParams.get("active") === "true";

    const fallback = await readProductsFallback(category, activeOnly);

    if (fallback) {
      return jsonResponse({
        ...fallback,
        dbError: error?.message || "PRODUCTS_GET_FAILED",
      });
    }

    return errorResponse(error, "PRODUCTS_GET_FAILED");
  }
}

export async function PUT(req: Request) {
  try {
    const authError = requireAdminAuth(req);
    if (authError) return authError;

    const tenantId = await getTenantId();
    const body = await readRequestBody(req);
    clearProductsMemoryCache();

    const items = asArray(body);
    const replace = body?.replace === true;

    const seenSkus = new Set<string>();

    await prisma.$transaction(async (tx) => {
      for (const rawItem of items) {
        const item = normalizeProductInput(rawItem);
        if (!item.sku) continue;

        seenSkus.add(item.sku);
        await saveProduct(tx, tenantId, item);
      }

      /*
        DB-first güvenlik:
        replace=true ama liste boşsa ürünleri silmiyoruz.
        Böylece eski/stale localStorage sync DB'yi kazara boşaltamaz.
      */
      if (replace && seenSkus.size > 0) {
        await tx.product.deleteMany({
          where: {
            tenantId,
            sku: {
              notIn: Array.from(seenSkus),
            },
          },
        });
      }
    });

    const serialized = await listProducts(tenantId);
    writeProductsMemoryCache(serialized);
    const fallbackSaved = await writeProductsFallback(serialized);

    return jsonResponse({
      ok: true,
      source: "db",
      fallbackSaved,
      counts: {
        input: items.length,
        saved: serialized.length,
      },
      items: serialized,
      products: serialized,
    });
  } catch (error: any) {
    return errorResponse(error, "PRODUCTS_PUT_FAILED");
  }
}

export async function POST(req: Request) {
  return PUT(req);
}

export async function DELETE(req: Request) {
  try {
    const authError = requireAdminAuth(req);
    if (authError) return authError;

    const tenantId = await getTenantId();
    const url = new URL(req.url);
    const body = await readRequestBody(req);

    const id = normalizeString(
      url.searchParams.get("id") || body?.id,
      "",
    );

    const sku = normalizeString(
      url.searchParams.get("sku") ||
        url.searchParams.get("code") ||
        body?.sku ||
        body?.code,
      "",
    );

    if (!id && !sku) {
      return jsonResponse(
        {
          ok: false,
          source: "db",
          error: "id_or_sku_required",
        },
        400,
      );
    }

    await prisma.product.deleteMany({
      where: {
        tenantId,
        ...(id ? { id } : {}),
        ...(sku ? { sku } : {}),
      },
    });

    const items = await listProducts(tenantId);
    const fallbackSaved = await writeProductsFallback(items);

    return jsonResponse({
      ok: true,
      source: "db",
      fallbackSaved,
      items,
      products: items,
      count: items.length,
    });
  } catch (error: any) {
    return errorResponse(error, "PRODUCTS_DELETE_FAILED");
  }
}