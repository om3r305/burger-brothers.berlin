// app/api/admin/customers/route.ts
import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma, getTenantId } from "@/lib/db";
import { requireMutationRole, requireSessionRole } from "@/lib/server/request-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate",
};



function unauthorized() {
  return NextResponse.json(
    {
      ok: false,
      source: "db",
      error: "Nicht angemeldet.",
    },
    {
      status: 401,
      headers: NO_STORE_HEADERS,
    },
  );
}

function normPhone(value: any) {
  const digits = String(value || "").replace(/\D/g, "");
  return digits.length ? digits : null;
}

function toBool(value: any, fallback = false) {
  if (typeof value === "boolean") return value;
  if (value === undefined || value === null || value === "") return fallback;

  const text = String(value).toLowerCase().trim();

  if (["true", "1", "yes", "ja", "on", "optin", "opt-in"].includes(text)) return true;
  if (["false", "0", "no", "nein", "off"].includes(text)) return false;

  return fallback;
}

function toNum(value: any, fallback = 0) {
  if (typeof value === "number" && Number.isFinite(value)) return value;

  if (value instanceof Prisma.Decimal) {
    return value.toNumber();
  }

  if (value == null || value === "") return fallback;

  const text = String(value).trim().replace(/[€\s]/g, "").replace(",", ".");
  const match = text.match(/-?\d+(\.\d+)?/);
  const n = match ? Number(match[0]) : Number(text);

  return Number.isFinite(n) ? n : fallback;
}

function toDate(value: any) {
  if (!value && value !== 0) return null;

  if (value instanceof Date && Number.isFinite(value.valueOf())) {
    return value;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    const date = new Date(value);
    return Number.isFinite(date.valueOf()) ? date : null;
  }

  const n = Number(value);

  if (Number.isFinite(n) && n > 0) {
    const date = new Date(n);
    return Number.isFinite(date.valueOf()) ? date : null;
  }

  const date = new Date(value);
  return Number.isFinite(date.valueOf()) ? date : null;
}

function cleanText(value: any) {
  return String(value ?? "").trim();
}

function normalizeEmail(value: any) {
  const email = cleanText(value).toLowerCase();
  return email.includes("@") ? email : null;
}

function hasOwn(value: any, key: string) {
  return Object.prototype.hasOwnProperty.call(value || {}, key);
}

function isPlainObject(value: any): value is Record<string, any> {
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

  if (typeof value === "bigint") return value.toString();
  if (typeof value === "function" || typeof value === "symbol") return null;

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeJson(item));
  }

  if (isPlainObject(value)) {
    const out: Record<string, any> = {};

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

function hasModelField(modelName: string, fieldName: string) {
  try {
    const models = ((Prisma as any).dmmf?.datamodel?.models || []) as Array<{
      name: string;
      fields: Array<{ name: string }>;
    }>;

    const model = models.find((item: any) => item.name === modelName);
    if (!model) return true;

    return model.fields.some((field: any) => field.name === fieldName);
  } catch {
    return true;
  }
}

function pickModelData(modelName: string, data: Record<string, any>) {
  const out: Record<string, any> = {};

  for (const [key, value] of Object.entries(data)) {
    if (value === undefined) continue;
    if (!hasModelField(modelName, key)) continue;
    out[key] = value;
  }

  return out;
}

function customerOrderBy() {
  const orderBy: any[] = [];

  if (hasModelField("Customer", "vip")) {
    orderBy.push({ vip: "desc" });
  }

  if (hasModelField("Customer", "lastOrderAt")) {
    orderBy.push({ lastOrderAt: "desc" });
  }

  if (hasModelField("Customer", "updatedAt")) {
    orderBy.push({ updatedAt: "desc" });
  }

  if (hasModelField("Customer", "name")) {
    orderBy.push({ name: "asc" });
  }

  if (!orderBy.length) {
    orderBy.push({ id: "asc" });
  }

  return orderBy;
}

function normalizeStats(value: any) {
  const stats = isPlainObject(value) ? value : {};

  return {
    orders: Math.max(0, toNum(stats.orders ?? stats.orderCount ?? stats.count, 0)),
    totalSpent: Math.max(0, toNum(stats.totalSpent ?? stats.revenue ?? stats.sum, 0)),
  };
}

function readItems(body: any) {
  return Array.isArray(body?.items)
    ? body.items
    : Array.isArray(body?.customers)
      ? body.customers
      : Array.isArray(body?.data?.items)
        ? body.data.items
        : Array.isArray(body?.data?.customers)
          ? body.data.customers
          : body?.item
            ? [body.item]
            : body?.customer
              ? [body.customer]
              : [];
}

function normalizeCustomerInput(raw: any) {
  const phone = normPhone(raw?.phone);
  const id = raw?.id ? cleanText(raw.id) : null;

  const name = cleanText(raw?.name) || "Unbekannt";
  const email = normalizeEmail(raw?.email);
  const address = cleanText(raw?.address ?? raw?.addressLine ?? raw?.street) || null;
  const plz = cleanText(raw?.plz ?? raw?.zip ?? raw?.postalCode) || null;
  const notes = cleanText(raw?.notes ?? raw?.note) || null;
  const lastOrderAt = toDate(raw?.lastOrderAt);
  const stats = normalizeStats(raw?.stats ?? raw);

  const createData = pickModelData("Customer", {
    id: id || undefined,
    phone,
    name,
    email,
    address,
    plz,
    notes,
    vip: toBool(raw?.vip, false),
    blocked: toBool(raw?.blocked, false),
    emailOptIn: toBool(
      raw?.emailOptIn ?? raw?.marketingOptIn ?? raw?.newsletterOptIn,
      false,
    ),
    lastOrderAt,
    stats: jsonForDb(stats),
  });

  const updateData: Record<string, any> = {};

  if (cleanText(raw?.name)) updateData.name = name;
  if (phone) updateData.phone = phone;

  if (hasOwn(raw, "email")) updateData.email = email;
  if (hasOwn(raw, "address") || hasOwn(raw, "addressLine") || hasOwn(raw, "street")) {
    updateData.address = address;
  }
  if (hasOwn(raw, "plz") || hasOwn(raw, "zip") || hasOwn(raw, "postalCode")) {
    updateData.plz = plz;
  }
  if (hasOwn(raw, "notes") || hasOwn(raw, "note")) {
    updateData.notes = notes;
  }
  if (hasOwn(raw, "vip")) updateData.vip = toBool(raw.vip, false);
  if (hasOwn(raw, "blocked")) updateData.blocked = toBool(raw.blocked, false);
  if (hasOwn(raw, "emailOptIn") || hasOwn(raw, "marketingOptIn") || hasOwn(raw, "newsletterOptIn")) {
    updateData.emailOptIn = toBool(
      raw.emailOptIn ?? raw.marketingOptIn ?? raw.newsletterOptIn,
      false,
    );
  }
  if (hasOwn(raw, "lastOrderAt")) updateData.lastOrderAt = lastOrderAt;
  if (hasOwn(raw, "stats") || hasOwn(raw, "orders") || hasOwn(raw, "totalSpent")) {
    updateData.stats = jsonForDb(stats);
  }

  return {
    id,
    phone,
    email,
    createData,
    updateData: pickModelData("Customer", updateData),
  };
}

function statsFromCustomerRow(row: any) {
  const base = normalizeStats(
    row?.stats ?? {
      orders: row?.orders ?? row?.orderCount ?? row?.ordersCount,
      totalSpent: row?.totalSpent ?? row?.revenue ?? row?.spentTotal,
    },
  );

  return base;
}

function serializeCustomer(row: any) {
  const stats = statsFromCustomerRow(row);

  return sanitizeJson({
    id: row?.id,
    name: row?.name || "Unbekannt",
    phone: row?.phone || null,
    email: row?.email || null,
    address: row?.address || null,
    plz: row?.plz || null,
    notes: row?.notes || null,
    vip: Boolean(row?.vip),
    blocked: Boolean(row?.blocked),
    emailOptIn: Boolean(row?.emailOptIn),
    createdAt: row?.createdAt instanceof Date ? row.createdAt.toISOString() : row?.createdAt,
    updatedAt: row?.updatedAt instanceof Date ? row.updatedAt.toISOString() : row?.updatedAt,
    lastOrderAt:
      row?.lastOrderAt instanceof Date ? row.lastOrderAt.toISOString() : row?.lastOrderAt,
    stats,
  });
}

function buildCustomerSearchWhere(tenantId: string, searchParams?: URLSearchParams) {
  const where: Record<string, any> = {
    tenantId,
  };

  if (!searchParams) return where;

  const phone = normPhone(searchParams.get("phone"));
  const id = cleanText(searchParams.get("id"));
  const plz = cleanText(searchParams.get("plz") ?? searchParams.get("zip"));
  const q = cleanText(searchParams.get("q") ?? searchParams.get("search"));

  if (id && hasModelField("Customer", "id")) {
    where.id = id;
  }

  if (phone && hasModelField("Customer", "phone")) {
    where.phone = phone;
  }

  if (plz && hasModelField("Customer", "plz")) {
    where.plz = plz;
  }

  if (q) {
    const OR: any[] = [];

    if (hasModelField("Customer", "name")) {
      OR.push({ name: { contains: q, mode: "insensitive" } });
    }

    if (hasModelField("Customer", "email")) {
      OR.push({ email: { contains: q, mode: "insensitive" } });
    }

    if (hasModelField("Customer", "phone")) {
      OR.push({ phone: { contains: q.replace(/\D/g, "") || q } });
    }

    if (OR.length) {
      where.OR = OR;
    }
  }

  return where;
}

async function listCustomers(tenantId: string, searchParams?: URLSearchParams) {
  const items = await prisma.customer.findMany({
    where: buildCustomerSearchWhere(tenantId, searchParams) as any,
    orderBy: customerOrderBy(),
  });

  return items.map(serializeCustomer);
}

function jsonResponse(payload: Record<string, any>, status = 200) {
  return NextResponse.json(payload, {
    status,
    headers: NO_STORE_HEADERS,
  });
}

function okResponse(payload: Record<string, any>, status = 200) {
  return jsonResponse(
    {
      ok: true,
      source: "db",
      ...payload,
    },
    status,
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

async function findExistingCustomer(tx: any, tenantId: string, normalized: ReturnType<typeof normalizeCustomerInput>) {
  const OR: any[] = [];

  if (normalized.id && hasModelField("Customer", "id")) {
    OR.push({ id: normalized.id });
  }

  if (normalized.phone && hasModelField("Customer", "phone")) {
    OR.push({ phone: normalized.phone });
  }

  if (normalized.email && hasModelField("Customer", "email")) {
    OR.push({ email: normalized.email });
  }

  if (!OR.length) return null;

  return tx.customer.findFirst({
    where: {
      tenantId,
      OR,
    },
    select: {
      id: true,
    },
  });
}

export async function GET(req: Request) {
  const authError = req.method === "GET"
    ? await requireSessionRole(req, "admin")
    : await requireMutationRole(req, ["admin"]);
  if (authError) return authError;

  try {
    const tenantId = await getTenantId();
    const { searchParams } = new URL(req.url);
    const items = await listCustomers(tenantId, searchParams);

    return okResponse({
      items,
      customers: items,
      count: items.length,
    });
  } catch (error: any) {
    return errorResponse(error, "CUSTOMERS_GET_FAILED");
  }
}

/**
 * POST supports:
 * - { items: CustomerLike[] }        -> save many
 * - { customers: CustomerLike[] }    -> save many
 * - { item: CustomerLike }           -> save one
 * - { customer: CustomerLike }       -> save one
 * - { replace: true, items: [...] }  -> delete missing only if list is not empty
 */
export async function POST(req: Request) {
  const authError = req.method === "GET"
    ? await requireSessionRole(req, "admin")
    : await requireMutationRole(req, ["admin"]);
  if (authError) return authError;

  try {
    const tenantId = await getTenantId();
    const body = await req.json().catch(() => ({} as any));

    const replace = body?.replace === true;
    const rawItems = readItems(body);
    const savedIds: string[] = [];

    await prisma.$transaction(async (tx: any) => {
      for (const raw of rawItems) {
        const normalized = normalizeCustomerInput(raw);

        const existing = await findExistingCustomer(tx, tenantId, normalized);

        if (existing?.id) {
          const data =
            Object.keys(normalized.updateData).length > 0
              ? normalized.updateData
              : normalized.createData;

          const updated = await tx.customer.update({
            where: {
              id: existing.id,
            },
            data,
          });

          savedIds.push(updated.id);
          continue;
        }

        const created = await tx.customer.create({
          data: pickModelData("Customer", {
            tenantId,
            ...normalized.createData,
          }) as any,
        });

        savedIds.push(created.id);
      }

      /*
        DB-first güvenlik:
        replace=true boş/stale payload ile gelirse müşteri tablosunu silmiyoruz.
      */
      if (replace && rawItems.length > 0 && savedIds.length > 0) {
        await tx.customer.deleteMany({
          where: {
            tenantId,
            id: {
              notIn: savedIds,
            },
          },
        });
      }
    });

    const items = await listCustomers(tenantId);

    return okResponse({
      saved: savedIds.length,
      ids: savedIds,
      items,
      customers: items,
      count: items.length,
    });
  } catch (error: any) {
    return errorResponse(error, "CUSTOMERS_POST_FAILED");
  }
}

export async function PUT(req: Request) {
  return POST(req);
}

export async function DELETE(req: Request) {
  const authError = req.method === "GET"
    ? await requireSessionRole(req, "admin")
    : await requireMutationRole(req, ["admin"]);
  if (authError) return authError;

  try {
    const tenantId = await getTenantId();
    const { searchParams } = new URL(req.url);
    const body = await req.json().catch(() => ({} as any));

    const id = cleanText(searchParams.get("id") ?? body?.id);
    const phone = normPhone(searchParams.get("phone") ?? body?.phone);
    const email = normalizeEmail(searchParams.get("email") ?? body?.email);

    const OR: any[] = [];

    if (id && hasModelField("Customer", "id")) OR.push({ id });
    if (phone && hasModelField("Customer", "phone")) OR.push({ phone });
    if (email && hasModelField("Customer", "email")) OR.push({ email });

    if (!OR.length) {
      return errorResponse(new Error("missing_id_phone_or_email"), "missing_id_phone_or_email", 400);
    }

    await prisma.customer.deleteMany({
      where: {
        tenantId,
        OR,
      },
    });

    const items = await listCustomers(tenantId);

    return okResponse({
      deleted: true,
      items,
      customers: items,
      count: items.length,
    });
  } catch (error: any) {
    return errorResponse(error, "CUSTOMERS_DELETE_FAILED");
  }
}