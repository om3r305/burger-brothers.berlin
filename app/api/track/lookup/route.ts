// app/api/track/lookup/route.ts
import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma, getTenantId } from "@/lib/db";
import { enforceRateLimit, hasAnySessionRole } from "@/lib/server/request-security";
import {
  extractTrackingToken,
  matchesTrackingToken,
  publicOrderDto,
} from "@/lib/server/public-order";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type OrderStatus =
  | "new"
  | "preparing"
  | "ready"
  | "out_for_delivery"
  | "done"
  | "cancelled";

type OrderMode = "pickup" | "delivery";

type LookupResult = {
  code: string;
  order: any | null;
  error: string | null;
  status: number;
};

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate",
};

function cleanCode(input: any) {
  return String(input || "")
    .trim()
    .replace(/^#+/, "")
    .replace(/\s+/g, "")
    .replace(/[^a-zA-Z0-9_-]/g, "");
}

function looksLikeOrderNumber(code: string) {
  return /^ORD-\d{8}-\d{3,6}$/i.test(code);
}

function toNum(value: any, fallback = 0) {
  if (typeof value === "number" && Number.isFinite(value)) return value;

  if (value instanceof Prisma.Decimal) {
    return value.toNumber();
  }

  if (value == null) return fallback;

  const text = String(value).trim().replace(/[€\s]/g, "").replace(",", ".");
  const match = text.match(/-?\d+(\.\d+)?/);
  const number = match ? Number(match[0]) : Number(text);

  return Number.isFinite(number) ? number : fallback;
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
  }

  return null;
}

function toMs(value: any, fallback = Date.now()) {
  const date = toDate(value);
  return date ? date.getTime() : toNum(value, fallback);
}

function toIso(value: any): string | null {
  const date = toDate(value);
  return date ? date.toISOString() : null;
}

function normalizeMode(value: any): OrderMode {
  const text = String(value || "").toLowerCase().trim();

  if (
    text === "pickup" ||
    text === "abholung" ||
    text === "apollo" ||
    text === "apollon"
  ) {
    return "pickup";
  }

  return "delivery";
}

function normalizeChannel(value: any) {
  const text = String(value || "").toLowerCase().trim();

  if (text === "lieferando" || text === "liferando") return "lieferando";

  if (
    text === "apollo" ||
    text === "apollon" ||
    text === "abholung" ||
    text === "pickup"
  ) {
    return "apollo";
  }

  if (text === "web" || text === "online" || text === "direct") return "web";

  return text || "web";
}

function normalizeStatus(value: any): OrderStatus {
  const text = String(value || "").toLowerCase().trim();

  if (text === "new" || text === "received" || text === "eingegangen") return "new";

  if (
    text === "preparing" ||
    text === "prepare" ||
    text === "zubereitung" ||
    text === "in_vorbereitung" ||
    text === "in vorbereitung"
  ) {
    return "preparing";
  }

  if (text === "ready" || text === "bereit" || text === "abholbereit") return "ready";

  if (
    text === "out_for_delivery" ||
    text === "on_the_way" ||
    text === "unterwegs"
  ) {
    return "out_for_delivery";
  }

  if (
    text === "done" ||
    text === "completed" ||
    text === "delivered" ||
    text === "geliefert"
  ) {
    return "done";
  }

  if (text === "cancelled" || text === "canceled" || text === "storniert") {
    return "cancelled";
  }

  return "new";
}

function toLegacyStatus(status: OrderStatus) {
  switch (status) {
    case "new":
      return "received";
    case "out_for_delivery":
      return "on_the_way";
    case "done":
      return "completed";
    case "preparing":
    case "ready":
    case "cancelled":
      return status;
    default:
      return "received";
  }
}

function ensureObj(value: any): Record<string, any> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, any>;
  }

  return {};
}

function ensureArr(value: any): any[] {
  return Array.isArray(value) ? value : [];
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

function normalizeItems(value: any): any[] {
  return ensureArr(value).map((item, index) =>
    sanitizeJson({
      id: item?.id ? String(item.id) : undefined,
      sku: item?.sku ? String(item.sku) : item?.code ? String(item.code) : undefined,
      name: String(item?.name || item?.title || "Artikel"),
      category: item?.category ? String(item.category) : undefined,
      price: toNum(item?.price ?? item?.unitPrice, 0),
      qty: Math.max(1, toNum(item?.qty ?? item?.quantity ?? 1, 1)),
      add: ensureArr(item?.add ?? item?.extras).map((extra: any) => ({
        id: extra?.id ? String(extra.id) : undefined,
        label: String(extra?.label ?? extra?.name ?? "Extra"),
        name: String(extra?.name ?? extra?.label ?? "Extra"),
        price: toNum(extra?.price, 0),
      })),
      rm: ensureArr(item?.rm ?? item?.remove).map((entry: any) => String(entry)),
      note: item?.note ? String(item.note) : undefined,
      _idx: index,
    }),
  );
}

function lineTotal(item: any) {
  const qty = Math.max(1, toNum(item?.qty ?? item?.quantity ?? 1, 1));
  const base = toNum(item?.price ?? item?.unitPrice, 0);

  const extrasTotal = ensureArr(item?.add ?? item?.extras).reduce(
    (sum, extra) => sum + toNum(extra?.price, 0),
    0,
  );

  return (base + extrasTotal) * qty;
}

function computeMerchandise(items: any[]) {
  return items.reduce((sum, item) => sum + lineTotal(item), 0);
}

function normalizeCustomer(row: any) {
  const customer = ensureObj(row?.customer);

  const addressLine =
    customer?.addressLine ||
    customer?.address ||
    row?.addressLine ||
    [customer?.street, customer?.house || customer?.houseNo].filter(Boolean).join(" ");

  const plz = customer?.plz ?? customer?.zip ?? customer?.postalCode ?? row?.plz ?? null;

  const note =
    customer?.note ||
    customer?.deliveryHint ||
    customer?.hint ||
    row?.note ||
    "";

  return sanitizeJson({
    ...customer,
    name: String(customer?.name ?? row?.customerName ?? ""),
    phone: String(customer?.phone ?? row?.phone ?? ""),
    address: String(customer?.address ?? addressLine ?? ""),
    addressLine: String(addressLine ?? ""),
    street: customer?.street ? String(customer.street) : undefined,
    house:
      customer?.house || customer?.houseNo
        ? String(customer.house || customer.houseNo)
        : undefined,
    plz: plz == null || plz === "" ? null : String(plz),
    zip: plz == null || plz === "" ? null : String(plz),
    email: customer?.email ? String(customer.email) : "",
    deliveryHint: String(customer?.deliveryHint ?? note ?? ""),
    note: String(note ?? ""),
  });
}

function normalizeHistory(value: any) {
  return ensureArr(value).map((entry) =>
    sanitizeJson({
      ts: toNum(entry?.ts ?? entry?.createdAt, Date.now()),
      action: String(entry?.action ?? entry?.status ?? "event"),
      by: entry?.by ? String(entry.by) : undefined,
      note: entry?.note ? String(entry.note) : undefined,
    }),
  );
}

function serializeOrder(row: any) {
  const meta = ensureObj(row?.meta);
  const customer = normalizeCustomer(row);
  const items = normalizeItems(row?.items);

  const id = String(row?.id || "");
  const status = normalizeStatus(meta?.statusManual ?? meta?.manualStatus ?? row?.status);
  const legacyStatus = toLegacyStatus(status);
  const mode = normalizeMode(row?.mode);

  const merchandise = toNum(row?.merchandise, computeMerchandise(items));
  const discount = toNum(row?.discount, 0);
  const surcharges = toNum(row?.surcharges, 0);
  const couponDiscount = toNum(row?.couponDiscount ?? meta?.couponDiscount, 0);

  const total = toNum(
    row?.total,
    Math.max(0, merchandise + surcharges - discount - couponDiscount),
  );

  const addressLine =
    customer?.addressLine ||
    customer?.address ||
    row?.addressLine ||
    "";

  const note =
    row?.note ||
    customer?.note ||
    customer?.deliveryHint ||
    meta?.note ||
    meta?.orderNote ||
    "";

  const history = normalizeHistory(row?.history ?? meta?.history);

  const payload = sanitizeJson({
    items,
    customer,
    planned: row?.planned ?? undefined,
    meta: {
      ...meta,
      history,
    },
    merchandise,
    discount,
    surcharges,
    total,
    coupon: row?.coupon ?? meta?.coupon ?? null,
    couponDiscount,
  });

  return sanitizeJson({
    id,
    orderId: id,
    ts: toMs(row?.ts ?? row?.createdAt),
    createdAt: toIso(row?.createdAt ?? row?.ts),
    updatedAt: toIso(row?.updatedAt),
    mode,
    channel: normalizeChannel(row?.channel ?? meta?.source ?? "web"),
    status,
    legacyStatus,
    statusLegacy: legacyStatus,
    etaMin: row?.etaMin ?? null,
    etaAdjustMin: toNum(row?.etaAdjustMin ?? meta?.etaAdjustMin, 0),
    planned: row?.planned ?? null,
    plz: customer?.plz ?? customer?.zip ?? row?.plz ?? null,
    customerName: customer?.name ?? row?.customerName ?? "",
    phone: customer?.phone ?? row?.phone ?? "",
    addressLine,
    note,
    items,
    customer,
    meta: payload.meta,
    history,
    merchandise,
    discount,
    surcharges,
    total,
    coupon: row?.coupon ?? meta?.coupon ?? null,
    couponDiscount,
    driver: row?.driver ?? meta?.driver ?? null,
    print: row?.print ?? meta?.print ?? null,
    doneAt: toIso(row?.doneAt ?? meta?.doneAt),
    cancelledAt: toIso(row?.cancelledAt ?? meta?.cancelledAt),
    order: payload,
    item: payload,
  });
}

async function findByDirectId(tenantId: string, code: string) {
  const original = String(code || "").trim().replace(/^#+/, "");
  const cleaned = cleanCode(original);

  const candidates = Array.from(
    new Set(
      [
        original,
        cleaned,
        cleaned.toLowerCase(),
        cleaned.toUpperCase(),
      ].filter(Boolean),
    ),
  );

  return prisma.order.findFirst({
    where: {
      tenantId,
      id: {
        in: candidates,
      },
    },
  });
}

async function findByMetaCode(tenantId: string, code: string) {
  const cleaned = cleanCode(code);

  if (!cleaned) return null;

  const rows = await prisma.$queryRaw<any[]>`
    SELECT *
    FROM "Order"
    WHERE "tenantId" = ${tenantId}
      AND (
        LOWER("meta" ->> 'orderNo') = LOWER(${cleaned})
        OR LOWER("meta" ->> 'orderNumber') = LOWER(${cleaned})
        OR LOWER("meta" ->> 'code') = LOWER(${cleaned})
        OR LOWER("meta" ->> 'trackingCode') = LOWER(${cleaned})
        OR LOWER("meta" ->> 'orderId') = LOWER(${cleaned})
        OR LOWER("meta" ->> 'displayId') = LOWER(${cleaned})
        OR LOWER("meta" ->> 'shortId') = LOWER(${cleaned})
      )
    ORDER BY "ts" DESC
    LIMIT 1;
  `;

  return rows?.[0] || null;
}

async function findOrder(codeRaw: any): Promise<LookupResult> {
  const code = cleanCode(codeRaw);

  if (!code) {
    return {
      code,
      order: null,
      error: "code_required",
      status: 400,
    };
  }

  const tenantId = await getTenantId();

  const byId = await findByDirectId(tenantId, code);

  if (byId) {
    return {
      code,
      order: byId,
      error: null,
      status: 200,
    };
  }

  const byMeta = await findByMetaCode(tenantId, code);

  if (byMeta) {
    return {
      code,
      order: byMeta,
      error: null,
      status: 200,
    };
  }

  return {
    code,
    order: null,
    error: looksLikeOrderNumber(code) ? "not_found" : "not_found",
    status: 404,
  };
}

async function findOrderByTrackingToken(tokenRaw: any): Promise<LookupResult> {
  const token = String(tokenRaw || "").trim();

  if (token.length < 32 || token.length > 160) {
    return { code: "", order: null, error: "invalid_tracking_token", status: 401 };
  }

  const tenantId = await getTenantId();

  /*
   * Prisma JSON path lookup normally works on PostgreSQL, but an exact,
   * parameterized JSONB text lookup is kept as a compatibility fallback.
   * This also supports older rows that used publicTrackingToken.
   */
  let order: any = null;

  try {
    order = await prisma.order.findFirst({
      where: {
        tenantId,
        meta: {
          path: ["trackingToken"],
          equals: token,
        } as any,
      },
    });
  } catch {
    /*
     * Do not expose the token or Prisma error. The parameterized PostgreSQL
     * fallback below remains authoritative for this lookup attempt.
     */
  }

  if (!order) {
    const rows = await prisma.$queryRaw<any[]>`
      SELECT *
      FROM "Order"
      WHERE "tenantId" = ${tenantId}
        AND (
          "meta" ->> 'trackingToken' = ${token}
          OR "meta" ->> 'publicTrackingToken' = ${token}
        )
      ORDER BY "ts" DESC
      LIMIT 2;
    `;

    order =
      rows.find((candidate: any) => matchesTrackingToken(candidate, token)) ||
      null;
  }

  if (!order || !matchesTrackingToken(order, token)) {
    return { code: "", order: null, error: "invalid_tracking_token", status: 401 };
  }

  return { code: String(order.id || ""), order, error: null, status: 200 };
}

function okResponse(order: any, code: string, operational = false) {
  const serialized = operational ? serializeOrder(order) : publicOrderDto(order);

  return NextResponse.json(
    {
      ok: true,
      source: "db",
      code,
      id: serialized.id,
      orderId: serialized.orderId,
      status: serialized.status,
      order: serialized,
      item: serialized,
      data: serialized,
    },
    {
      headers: NO_STORE_HEADERS,
    },
  );
}

function errorResponse(error: string, status = 500, code = "") {
  return NextResponse.json(
    {
      ok: false,
      source: "db",
      code,
      error,
    },
    {
      status,
      headers: NO_STORE_HEADERS,
    },
  );
}

function extractCodeFromRequestUrl(req: Request) {
  const url = new URL(req.url);

  return (
    url.searchParams.get("id") ||
    url.searchParams.get("code") ||
    url.searchParams.get("orderId") ||
    url.searchParams.get("orderNo") ||
    url.searchParams.get("orderNumber") ||
    url.searchParams.get("trackingCode") ||
    url.searchParams.get("displayId") ||
    url.searchParams.get("shortId") ||
    url.searchParams.get("q") ||
    ""
  );
}

export async function GET(req: Request) {
  const rateError = await enforceRateLimit(req, "tracking:lookup", 30, 60_000);
  if (rateError) return rateError;

  try {
    const isAdmin = await hasAnySessionRole(req, ["admin"]);
    const hasTvSession = await hasAnySessionRole(req, ["tv"]);
    const explicitToken = extractTrackingToken(req);
    const code = extractCodeFromRequestUrl(req);
    const trackingToken =
      explicitToken || (code.length >= 32 && code.length <= 160 ? code : "");

    /*
     * A customer tracking token must always win over admin/TV cookies.
     * Otherwise the same browser being logged into /tv makes this public
     * request use the operational order-id branch and the long token is
     * treated as an order id. Besides breaking tracking, returning the
     * operational DTO here would expose more data than the public page needs.
     */
    const tokenLookup = Boolean(trackingToken);
    const operational = !tokenLookup && (isAdmin || hasTvSession);
    const result = tokenLookup
      ? await findOrderByTrackingToken(trackingToken)
      : operational
        ? await findOrder(code)
        : await findOrderByTrackingToken(code);

    if (!result.order) {
      return errorResponse(result.error || "not_found", result.status, result.code);
    }

    if (
      operational &&
      !isAdmin &&
      String(result.order?.status || "").toLowerCase().startsWith("payment_")
    ) {
      return errorResponse("payment_session_not_operational_order", 403, result.code);
    }

    return okResponse(result.order, result.code, operational);
  } catch (error: any) {
    console.error("[track/lookup] GET failed:", error);
    return errorResponse(error?.message || "lookup_failed", 500);
  }
}

export async function POST(req: Request) {
  const rateError = await enforceRateLimit(req, "tracking:lookup", 30, 60_000);
  if (rateError) return rateError;

  try {
    const body = await req.json().catch(() => ({} as any));
    const isAdmin = await hasAnySessionRole(req, ["admin"]);
    const hasTvSession = await hasAnySessionRole(req, ["tv"]);

    const code =
      body?.id ||
      body?.code ||
      body?.orderId ||
      body?.orderNo ||
      body?.orderNumber ||
      body?.trackingCode ||
      body?.displayId ||
      body?.shortId ||
      body?.q ||
      "";

    const explicitToken = extractTrackingToken(req, body);
    const normalizedCode = cleanCode(code);
    const trackingToken =
      explicitToken ||
      (normalizedCode.length >= 32 && normalizedCode.length <= 160
        ? normalizedCode
        : "");
    const tokenLookup = Boolean(trackingToken);
    const operational = !tokenLookup && (isAdmin || hasTvSession);
    const result = tokenLookup
      ? await findOrderByTrackingToken(trackingToken)
      : operational
        ? await findOrder(code)
        : await findOrderByTrackingToken(code);

    if (!result.order) {
      return errorResponse(result.error || "not_found", result.status, result.code);
    }

    if (
      operational &&
      !isAdmin &&
      String(result.order?.status || "").toLowerCase().startsWith("payment_")
    ) {
      return errorResponse("payment_session_not_operational_order", 403, result.code);
    }

    return okResponse(result.order, result.code, operational);
  } catch (error: any) {
    console.error("[track/lookup] POST failed:", error);
    return errorResponse(error?.message || "lookup_failed", 500);
  }
}
