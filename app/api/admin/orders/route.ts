// app/api/admin/orders/route.ts
import { NextResponse } from "next/server";
import { prisma, getTenantId } from "@/lib/db";
import { generateOrderId } from "@/lib/order-id";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type OrderMode = "pickup" | "delivery";

type OrderStatus =
  | "new"
  | "preparing"
  | "ready"
  | "out_for_delivery"
  | "done"
  | "cancelled";

type LegacyOrderStatus =
  | "received"
  | "preparing"
  | "ready"
  | "on_the_way"
  | "delivered"
  | "completed"
  | "cancelled";

const VALID_STATUSES: OrderStatus[] = [
  "new",
  "preparing",
  "ready",
  "out_for_delivery",
  "done",
  "cancelled",
];

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate",
};

const ADMIN_COOKIE = process.env.ADMIN_COOKIE_NAME || "bb_admin_sess";
const TV_COOKIE = "bb_tv_auth";

const ORDER_SCHEMA_FIELDS = new Set([
  "id",
  "tenantId",
  "mode",
  "channel",
  "status",
  "merchandise",
  "discount",
  "surcharges",
  "total",
  "coupon",
  "couponDiscount",
  "customer",
  "items",
  "meta",
  "ts",
  "planned",
  "etaMin",
  "etaAdjustMin",
  "driver",
  "doneAt",
  "cancelledAt",
  "history",
  "print",
  "createdAt",
  "updatedAt",
]);

function hasOrderField(fieldName: string) {
  return ORDER_SCHEMA_FIELDS.has(fieldName);
}

function cleanId(value: any) {
  return String(value || "")
    .trim()
    .replace(/^#+/, "")
    .replace(/\s+/g, "")
    .replace(/[^a-zA-Z0-9_-]/g, "");
}

function isDecimalLike(value: any) {
  return Boolean(
    value &&
      typeof value === "object" &&
      typeof value.toNumber === "function" &&
      typeof value.toString === "function",
  );
}

function toNumber(value: any, fallback = 0) {
  if (typeof value === "number" && Number.isFinite(value)) return value;

  if (isDecimalLike(value)) {
    try {
      const n = value.toNumber();
      return Number.isFinite(n) ? n : fallback;
    } catch {
      const n = Number(value.toString());
      return Number.isFinite(n) ? n : fallback;
    }
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
  return date ? date.getTime() : fallback;
}

function toIso(value: any): string | null {
  const date = toDate(value);
  return date ? date.toISOString() : null;
}

function cleanText(value: any, fallback = "") {
  const text = String(value ?? "").trim();
  return text || fallback;
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

  if (isDecimalLike(value)) {
    try {
      return value.toNumber();
    } catch {
      return value.toString();
    }
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

function normalizeChannel(value: any, mode?: OrderMode) {
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

  return mode === "pickup" ? "apollo" : text || "web";
}

function tryStatus(value: any): OrderStatus | null {
  const text = String(value || "").toLowerCase().trim();

  if (!text) return null;

  if (text === "received" || text === "eingegangen") return "new";

  if (
    text === "prepare" ||
    text === "zubereitung" ||
    text === "in_vorbereitung" ||
    text === "in vorbereitung"
  ) {
    return "preparing";
  }

  if (text === "bereit" || text === "abholbereit") return "ready";
  if (text === "on_the_way" || text === "unterwegs") return "out_for_delivery";
  if (text === "delivered" || text === "completed" || text === "geliefert") return "done";
  if (text === "canceled" || text === "storniert") return "cancelled";

  if (VALID_STATUSES.includes(text as OrderStatus)) {
    return text as OrderStatus;
  }

  return null;
}

function normalizeStatus(value: any): OrderStatus {
  return tryStatus(value) ?? "new";
}

function toLegacyStatus(value: any): LegacyOrderStatus {
  const status = normalizeStatus(value);

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

function normalizeItems(value: any): any[] {
  return ensureArr(value).map((item, index) =>
    sanitizeJson({
      id: item?.id ? String(item.id) : undefined,
      sku: item?.sku ? String(item.sku) : item?.code ? String(item.code) : undefined,
      name: cleanText(item?.name || item?.title || "Artikel"),
      category: item?.category ? String(item.category) : undefined,
      price: toNumber(item?.price ?? item?.unitPrice, 0),
      qty: Math.max(1, toNumber(item?.qty ?? item?.quantity ?? 1, 1)),
      add: ensureArr(item?.add ?? item?.extras).map((extra: any) => ({
        id: extra?.id ? String(extra.id) : undefined,
        label: cleanText(extra?.label ?? extra?.name ?? "Extra"),
        name: cleanText(extra?.name ?? extra?.label ?? "Extra"),
        price: toNumber(extra?.price, 0),
      })),
      rm: ensureArr(item?.rm ?? item?.remove).map((entry: any) => String(entry)),
      note: item?.note ? String(item.note) : undefined,
      _idx: index,
    }),
  );
}

function lineTotal(item: any) {
  const qty = Math.max(1, toNumber(item?.qty ?? item?.quantity ?? 1, 1));
  const base = toNumber(item?.price ?? item?.unitPrice, 0);

  const extrasTotal = ensureArr(item?.add ?? item?.extras).reduce(
    (sum: number, extra: any) => sum + toNumber(extra?.price, 0),
    0,
  );

  return (base + extrasTotal) * qty;
}

function computeMerchandise(items: any[]) {
  return items.reduce((sum: number, item: any) => sum + lineTotal(item), 0);
}

function normalizeCustomer(raw: any) {
  const customer = ensureObj(raw?.customer ?? raw);

  const name =
    raw?.customerName ??
    raw?.name ??
    customer?.name ??
    customer?.customerName ??
    "";

  const phone =
    raw?.phone ??
    raw?.telephone ??
    customer?.phone ??
    customer?.telephone ??
    "";

  const streetHouse = [customer?.street, customer?.house || customer?.houseNo]
    .map((part) => cleanText(part))
    .filter(Boolean)
    .join(" ");

  const address =
    raw?.addressLine ??
    raw?.address ??
    customer?.addressLine ??
    customer?.address ??
    streetHouse ??
    "";

  const plz =
    raw?.plz ??
    raw?.zip ??
    customer?.plz ??
    customer?.zip ??
    customer?.postalCode ??
    "";

  const email = raw?.email ?? customer?.email ?? "";

  const note =
    raw?.note ??
    raw?.orderNote ??
    customer?.note ??
    customer?.deliveryHint ??
    "";

  return sanitizeJson({
    ...customer,
    name: cleanText(name, ""),
    phone: cleanText(phone, ""),
    address: cleanText(address, ""),
    addressLine: cleanText(address, ""),
    street: cleanText(customer?.street, ""),
    house: cleanText(customer?.house ?? customer?.houseNo, ""),
    plz: cleanText(plz, "") || null,
    zip: cleanText(customer?.zip ?? plz, "") || null,
    city: cleanText(customer?.city, ""),
    email: cleanText(email, ""),
    deliveryHint: cleanText(note, ""),
    note: cleanText(customer?.note ?? note, ""),
  });
}

function normalizeHistory(value: any): any[] {
  return ensureArr(value).map((entry: any) =>
    sanitizeJson({
      ts: toNumber(entry?.ts ?? entry?.createdAt, Date.now()),
      action: cleanText(entry?.action ?? entry?.status ?? "event"),
      by: cleanText(entry?.by) || undefined,
      note: cleanText(entry?.note) || undefined,
    }),
  );
}

function buildOrderSelect() {
  const select: Record<string, boolean> = {
    id: true,
    tenantId: true,
    mode: true,
    channel: true,
    status: true,
    merchandise: true,
    discount: true,
    surcharges: true,
    total: true,
    coupon: true,
    couponDiscount: true,
    customer: true,
    items: true,
    meta: true,
    ts: true,
    planned: true,
    etaMin: true,
    createdAt: true,
    updatedAt: true,
  };

  const optionalFields = [
    "etaAdjustMin",
    "driver",
    "doneAt",
    "cancelledAt",
    "history",
    "print",
  ];

  for (const field of optionalFields) {
    if (hasOrderField(field)) {
      select[field] = true;
    }
  }

  return select;
}

function serializeOrder(row: any) {
  const rawMeta = ensureObj(row?.meta);
  const customer = normalizeCustomer(row?.customer);
  const items = normalizeItems(row?.items);
  const history = normalizeHistory(row?.history ?? rawMeta?.history);

  const status = normalizeStatus(rawMeta?.statusManual ?? row?.status);
  const legacyStatus = toLegacyStatus(status);

  const merchandise = toNumber(row?.merchandise, computeMerchandise(items));
  const discount = toNumber(row?.discount, 0);
  const surcharges = toNumber(row?.surcharges, 0);
  const couponDiscount = toNumber(row?.couponDiscount, rawMeta?.couponDiscount ?? 0);

  const total = toNumber(
    row?.total,
    Math.max(0, merchandise + surcharges - discount - couponDiscount),
  );

  const meta = sanitizeJson({
    ...rawMeta,
    history,
    coupon: row?.coupon ?? rawMeta?.coupon ?? null,
    couponDiscount,
    couponMeta: rawMeta?.couponMeta ?? null,
    couponLifecycle: rawMeta?.couponLifecycle ?? null,
  });

  const payload = sanitizeJson({
    items,
    customer,
    planned: row?.planned ?? undefined,
    meta,
    merchandise,
    discount,
    surcharges,
    total,
    coupon: row?.coupon ?? rawMeta?.coupon ?? null,
    couponDiscount,
  });

  return sanitizeJson({
    id: String(row?.id ?? ""),
    orderId: String(row?.id ?? ""),
    ts: toMs(row?.ts ?? row?.createdAt),
    createdAt: toIso(row?.createdAt ?? row?.ts),
    updatedAt: toIso(row?.updatedAt),
    mode: normalizeMode(row?.mode),
    channel: normalizeChannel(row?.channel, normalizeMode(row?.mode)),
    status,
    legacyStatus,
    statusLegacy: legacyStatus,
    etaMin: row?.etaMin ?? undefined,
    etaAdjustMin: row?.etaAdjustMin ?? rawMeta?.etaAdjustMin ?? 0,
    planned: row?.planned ?? null,
    plz: customer?.plz ?? customer?.zip ?? null,
    customerName: customer?.name ?? "",
    phone: customer?.phone ?? "",
    addressLine: customer?.addressLine || customer?.address || "",
    note: cleanText(rawMeta?.note ?? rawMeta?.orderNote ?? customer?.deliveryHint ?? customer?.note, ""),
    items,
    customer,
    meta,
    history,
    merchandise,
    discount,
    surcharges,
    total,
    coupon: row?.coupon ?? rawMeta?.coupon ?? null,
    couponDiscount,
    couponMeta: meta?.couponMeta ?? null,
    couponLifecycle: meta?.couponLifecycle ?? null,
    driver: row?.driver ?? rawMeta?.driver ?? null,
    print: row?.print ?? rawMeta?.print ?? null,
    doneAt: toIso(row?.doneAt ?? rawMeta?.doneAt),
    cancelledAt: toIso(row?.cancelledAt ?? rawMeta?.cancelledAt),
    order: payload,
    item: payload,
  });
}

async function generateUniqueOrderId(length = 6) {
  for (let i = 0; i < 40; i += 1) {
    const id = generateOrderId(length);

    const exists = await prisma.order
      .findUnique({
        where: {
          id,
        },
        select: {
          id: true,
        },
      })
      .catch(() => null);

    if (!exists) return id;
  }

  return `ORD-${Date.now().toString(36).toUpperCase()}`;
}

async function findOrder(tenantId: string, idRaw: string) {
  const original = String(idRaw || "").trim().replace(/^#+/, "");
  const cleaned = cleanId(original);

  if (!cleaned) return null;

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

  const byId = await prisma.order.findFirst({
    where: {
      tenantId,
      id: {
        in: candidates,
      },
    },
    select: buildOrderSelect() as any,
  });

  if (byId) return byId;

  const rows = await prisma.$queryRaw<any[]>`
    SELECT "id"
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
  `.catch(() => []);

  const id = rows?.[0]?.id;

  if (!id) return null;

  return prisma.order.findFirst({
    where: {
      tenantId,
      id: String(id),
    },
    select: buildOrderSelect() as any,
  });
}

function buildOrderCreateData(tenantId: string, raw: any, forcedId?: string) {
  const now = Date.now();

  const id =
    cleanId(forcedId || raw?.id || raw?.orderId) ||
    `ORD-${now.toString(36).toUpperCase()}`;

  const order = ensureObj(raw?.order);
  const rawMeta = ensureObj(raw?.meta ?? order?.meta);

  const mode = normalizeMode(raw?.mode ?? raw?.orderMode ?? order?.mode);
  const channel = normalizeChannel(raw?.channel ?? raw?.source ?? order?.channel ?? order?.source, mode);
  const status = normalizeStatus(raw?.status ?? order?.status ?? rawMeta?.statusManual);

  const items = normalizeItems(raw?.items ?? order?.items);
  const customer = normalizeCustomer(raw?.customer ?? order?.customer ?? raw);

  const merchandise = toNumber(raw?.merchandise ?? order?.merchandise, computeMerchandise(items));
  const discount = toNumber(raw?.discount ?? order?.discount, 0);
  const surcharges = toNumber(raw?.surcharges ?? order?.surcharges, 0);
  const couponDiscount = toNumber(raw?.couponDiscount ?? order?.couponDiscount ?? rawMeta?.couponDiscount, 0);

  const total = toNumber(
    raw?.total ?? order?.total,
    Math.max(0, merchandise + surcharges - discount - couponDiscount),
  );

  const ts = toDate(raw?.ts ?? raw?.createdAt ?? order?.ts) ?? new Date(now);
  const history = normalizeHistory(raw?.history ?? rawMeta?.history);

  const finalHistory = history.length
    ? history
    : [
        {
          ts: ts.getTime(),
          action: `status:${status}`,
          by: channel || "admin",
        },
      ];

  const note =
    raw?.note ??
    raw?.orderNote ??
    order?.note ??
    order?.orderNote ??
    rawMeta?.note ??
    customer?.deliveryHint ??
    null;

  const coupon = raw?.coupon ?? order?.coupon ?? rawMeta?.coupon ?? null;

  const meta = sanitizeJson({
    ...rawMeta,
    source: channel,
    note,
    orderNote: note,
    history: finalHistory,
    coupon: coupon ? String(coupon) : null,
    couponDiscount,
    couponMeta: rawMeta?.couponMeta ?? raw?.couponMeta ?? order?.couponMeta ?? null,
    couponLifecycle: rawMeta?.couponLifecycle ?? raw?.couponLifecycle ?? order?.couponLifecycle ?? null,
    orderId: rawMeta?.orderId ?? raw?.orderId ?? id,
    trackingCode: rawMeta?.trackingCode ?? id,
    code: rawMeta?.code ?? id,
  });

  const data: Record<string, any> = {
    id,
    tenantId,
    mode,
    channel,
    status,
    merchandise,
    discount,
    surcharges,
    total,
    coupon: coupon ? String(coupon) : null,
    couponDiscount,
    customer,
    items,
    meta,
    ts,
    planned: raw?.planned ?? order?.planned ?? null,
    etaMin: raw?.etaMin ?? order?.etaMin ?? (mode === "pickup" ? 15 : 35),
  };

  if (hasOrderField("etaAdjustMin")) {
    data.etaAdjustMin = toNumber(raw?.etaAdjustMin ?? rawMeta?.etaAdjustMin, 0);
  }

  if (hasOrderField("driver")) {
    data.driver = sanitizeJson(raw?.driver ?? rawMeta?.driver ?? null);
  }

  if (hasOrderField("doneAt")) {
    data.doneAt = status === "done" ? toDate(raw?.doneAt ?? rawMeta?.doneAt) || new Date() : null;
  }

  if (hasOrderField("cancelledAt")) {
    data.cancelledAt =
      status === "cancelled" ? toDate(raw?.cancelledAt ?? rawMeta?.cancelledAt) || new Date() : null;
  }

  if (hasOrderField("history")) {
    data.history = sanitizeJson(finalHistory);
  }

  if (hasOrderField("print")) {
    data.print = sanitizeJson(raw?.print ?? rawMeta?.print ?? null);
  }

  return data;
}

function toUpdateData(createData: Record<string, any>) {
  const data = { ...createData };
  delete data.id;
  delete data.tenantId;

  return data;
}

function buildCouponLifecyclePatch(
  meta: Record<string, any>,
  next: OrderStatus,
  now: number,
  by: string,
) {
  const current = ensureObj(meta?.couponLifecycle);
  const code = cleanText(current?.code ?? meta?.coupon, "");

  if (!code) return {};

  if (next === "done") {
    return {
      couponLifecycle: {
        ...current,
        code,
        state: "redeemed",
        redeemedAt: now,
        redeemedBy: by,
      },
      couponRedeemedAt: now,
      couponRestoredAt: null,
      couponVoidedAt: null,
    };
  }

  if (next === "cancelled") {
    const policy = String(current?.cancelPolicy ?? meta?.couponCancelPolicy ?? "restore_if_not_redeemed");
    const state = policy === "void_on_cancel" ? "voided" : "restored";

    return {
      couponLifecycle: {
        ...current,
        code,
        state,
        cancelledAt: now,
        cancelledBy: by,
        cancelPolicy: policy,
      },
      couponRestoredAt: state === "restored" ? now : null,
      couponVoidedAt: state === "voided" ? now : null,
    };
  }

  return {
    couponLifecycle: {
      ...current,
      code,
      state: current?.state || "reserved",
      lastStatus: next,
      lastStatusAt: now,
      lastStatusBy: by,
    },
  };
}

function buildStatusPatch(row: any, statusRaw: any, by = "admin", note?: string) {
  const next = tryStatus(statusRaw);

  if (!next) {
    throw new Error("Ungültiger Status.");
  }

  const now = Date.now();
  const rawMeta = ensureObj(row?.meta);
  const history = normalizeHistory(row?.history ?? rawMeta?.history);

  const nextHistory = [
    ...history,
    {
      ts: now,
      action: `status:${next}`,
      by,
      note: note || undefined,
    },
  ];

  const nextMeta: Record<string, any> = {
    ...rawMeta,
    history: nextHistory,
    lastStatus: next,
    lastStatusAt: now,
    lastStatusBy: by,
    ...buildCouponLifecyclePatch(rawMeta, next, now, by),
  };

  if (next === "done" || next === "cancelled") {
    delete nextMeta.statusManual;
  } else {
    nextMeta.statusManual = next;
  }

  if (next === "done") {
    nextMeta.doneAt = now;
  } else {
    delete nextMeta.doneAt;
  }

  if (next === "cancelled") {
    nextMeta.cancelledAt = now;
  } else {
    delete nextMeta.cancelledAt;
  }

  const data: Record<string, any> = {
    status: next,
    meta: sanitizeJson(nextMeta),
  };

  if (hasOrderField("history")) {
    data.history = sanitizeJson(nextHistory);
  }

  if (hasOrderField("doneAt")) {
    data.doneAt = next === "done" ? new Date(now) : null;
  }

  if (hasOrderField("cancelledAt")) {
    data.cancelledAt = next === "cancelled" ? new Date(now) : null;
  }

  return data;
}

function decodeCookie(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function readCookie(req: Request, name: string) {
  const cookieHeader = req.headers.get("cookie") || "";
  const parts = cookieHeader
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean);

  for (const part of parts) {
    const index = part.indexOf("=");
    const key = index >= 0 ? part.slice(0, index).trim() : part.trim();
    const rawValue = index >= 0 ? part.slice(index + 1).trim() : "";

    if (key === name) {
      return decodeCookie(rawValue);
    }
  }

  return "";
}

function hasApiSession(req: Request) {
  const admin = readCookie(req, ADMIN_COOKIE);
  const tv = readCookie(req, TV_COOKIE);

  return admin.startsWith("ok:") || tv === "1";
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
      message: error?.message || fallback,
    },
    status,
  );
}

async function listOrders(tenantId: string, req?: Request) {
  const url = req ? new URL(req.url) : null;
  const from = url?.searchParams.get("from");
  const to = url?.searchParams.get("to");
  const takeRaw = url?.searchParams.get("take");

  const where: any = {
    tenantId,
    archivedAt: null,
  };

  const fromDate = toDate(from);
  const toDateValue = toDate(to);

  if (fromDate || toDateValue) {
    where.ts = {};
    if (fromDate) where.ts.gte = fromDate;
    if (toDateValue) where.ts.lte = toDateValue;
  }

  const take = Math.min(Math.max(toNumber(takeRaw, 500), 1), 1000);

  const rows = await prisma.order.findMany({
    where,
    orderBy: {
      ts: "desc",
    },
    take,
    select: buildOrderSelect() as any,
  });

  return rows.map(serializeOrder);
}

export async function GET(req: Request) {
  try {
    if (!hasApiSession(req)) return unauthorizedResponse();

    const tenantId = await getTenantId();
    const url = new URL(req.url);

    const id =
      url.searchParams.get("id") ||
      url.searchParams.get("orderId") ||
      url.searchParams.get("code");

    if (id) {
      const row = await findOrder(tenantId, id);
      const order = row ? serializeOrder(row) : null;

      return jsonResponse(
        {
          ok: Boolean(order),
          source: "db",
          order,
          item: order,
          data: order,
        },
        order ? 200 : 404,
      );
    }

    const orders = await listOrders(tenantId, req);

    return jsonResponse({
      ok: true,
      source: "db",
      orders,
      items: orders,
      count: orders.length,
    });
  } catch (error: any) {
    console.error("[admin/orders] GET failed:", error);
    return errorResponse(error, "ADMIN_ORDERS_GET_FAILED");
  }
}

async function handlePost(req: Request, bodyOverride?: any) {
  try {
    if (!hasApiSession(req)) return unauthorizedResponse();

    const tenantId = await getTenantId();
    const body = bodyOverride ?? (await req.json().catch(() => ({} as any)));
    const action = String(body?.action || "").trim();

    if (action === "addDummy") {
      const id = await generateUniqueOrderId(6);
      const now = Date.now();
      const delivery = Math.random() > 0.5;

      await prisma.order.create({
        data: buildOrderCreateData(
          tenantId,
          {
            id,
            ts: now,
            mode: delivery ? "delivery" : "pickup",
            channel: "web",
            status: "new",
            plz: delivery ? "13507" : null,
            customerName: "Max Mustermann",
            phone: "49123456789",
            addressLine: delivery ? "Berliner Str. 1" : "",
            items: [
              { name: "Classic Burger", category: "burger", price: 9.9, qty: 1 },
              { name: "Fries", category: "extras", price: 3.5, qty: 1 },
              { name: "Ketchup", category: "sauces", price: 0.5, qty: 1 },
            ],
            merchandise: 13.9,
            discount: 0,
            surcharges: delivery ? 1.5 : 0,
            total: 13.9 + (delivery ? 1.5 : 0),
            etaMin: delivery ? 35 : 15,
            meta: {
              source: "admin",
              note: "Demo-Bestellung",
            },
          },
          id,
        ) as any,
      });

      const orders = await listOrders(tenantId, req);

      return jsonResponse({
        ok: true,
        source: "db",
        orders,
        items: orders,
        count: orders.length,
      });
    }

    if (action === "setStatus") {
      const id = String(body?.id || body?.orderId || body?.code || "").trim();
      const status = body?.status;
      const by = body?.by ? String(body.by) : "admin";
      const note = body?.note ? String(body.note) : undefined;

      if (!id || !status) {
        return jsonResponse(
          {
            ok: false,
            source: "db",
            error: "id/status missing",
          },
          400,
        );
      }

      if (!tryStatus(status)) {
        return jsonResponse(
          {
            ok: false,
            source: "db",
            error: "bad_status",
            message: "Ungültiger Status.",
          },
          400,
        );
      }

      const row = await findOrder(tenantId, id);

      if (!row) {
        return jsonResponse(
          {
            ok: false,
            source: "db",
            error: "not_found",
          },
          404,
        );
      }

      const updated = await prisma.order.update({
        where: {
          id: String((row as any).id),
        },
        data: buildStatusPatch(row, status, by, note) as any,
        select: buildOrderSelect() as any,
      });

      const order = serializeOrder(updated);
      const orders = await listOrders(tenantId, req);

      return jsonResponse({
        ok: true,
        source: "db",
        id: order.id,
        orderId: order.orderId,
        status: order.status,
        order,
        item: order,
        orders,
        items: orders,
        count: orders.length,
      });
    }

    if (action === "delete") {
      const id = String(body?.id || body?.orderId || body?.code || "").trim();

      if (!id) {
        return jsonResponse(
          {
            ok: false,
            source: "db",
            error: "id missing",
          },
          400,
        );
      }

      const row = await findOrder(tenantId, id);

      if (row) {
        await prisma.order.delete({
          where: {
            id: String((row as any).id),
          },
        });
      }

      const orders = await listOrders(tenantId, req);

      return jsonResponse({
        ok: true,
        source: "db",
        orders,
        items: orders,
        count: orders.length,
      });
    }

    if (action === "duplicate") {
      const id = String(body?.id || body?.orderId || body?.code || "").trim();

      if (!id) {
        return jsonResponse(
          {
            ok: false,
            source: "db",
            error: "id missing",
          },
          400,
        );
      }

      const sourceOrder = await findOrder(tenantId, id);

      if (sourceOrder) {
        const copyId = await generateUniqueOrderId(6);
        const serialized = serializeOrder(sourceOrder);
        const meta = ensureObj(serialized?.meta);
        const history = normalizeHistory(serialized?.history ?? meta?.history);

        history.push({
          ts: Date.now(),
          action: "duplicated",
          by: "admin",
          note: `Quelle: ${id}`,
        });

        await prisma.order.create({
          data: buildOrderCreateData(
            tenantId,
            {
              ...serialized,
              id: copyId,
              ts: Date.now(),
              status: "new",
              meta: {
                ...meta,
                source: "admin",
                duplicatedFrom: id,
                statusManual: "new",
                history,
              },
            },
            copyId,
          ) as any,
        });
      }

      const orders = await listOrders(tenantId, req);

      return jsonResponse({
        ok: true,
        source: "db",
        orders,
        items: orders,
        count: orders.length,
      });
    }

    if (action === "import") {
      const incoming = Array.isArray(body?.orders)
        ? body.orders
        : Array.isArray(body?.items)
          ? body.items
          : Array.isArray(body?.data)
            ? body.data
            : [];

      const replace = body?.replace === true;
      const seenIds = new Set<string>();

      for (const raw of incoming) {
        const id =
          cleanId(raw?.id || raw?.orderId) ||
          (await generateUniqueOrderId(6));

        const data = buildOrderCreateData(tenantId, raw, id);
        seenIds.add(id);

        const existing = await prisma.order.findFirst({
          where: {
            tenantId,
            id,
          },
          select: {
            id: true,
          },
        });

        if (existing?.id) {
          await prisma.order.update({
            where: {
              id: existing.id,
            },
            data: toUpdateData(data) as any,
          });
        } else {
          await prisma.order.create({
            data: data as any,
          });
        }
      }

      /*
        DB-first güvenlik:
        replace=true boş/stale payload ile gelirse siparişleri silmiyoruz.
      */
      if (replace && incoming.length > 0 && seenIds.size > 0) {
        await prisma.order.deleteMany({
          where: {
            tenantId,
            id: {
              notIn: Array.from(seenIds),
            },
          },
        });
      }

      const orders = await listOrders(tenantId, req);

      return jsonResponse({
        ok: true,
        source: "db",
        orders,
        items: orders,
        count: orders.length,
      });
    }

    return jsonResponse(
      {
        ok: false,
        source: "db",
        error: "Unknown action",
        allowedActions: ["addDummy", "setStatus", "delete", "duplicate", "import"],
      },
      400,
    );
  } catch (error: any) {
    console.error("[admin/orders] POST failed:", error);
    return errorResponse(error, "ADMIN_ORDERS_POST_FAILED");
  }
}

export async function POST(req: Request) {
  return handlePost(req);
}

export async function PUT(req: Request) {
  try {
    const body = await req.json().catch(() => ({} as any));

    return handlePost(req, {
      action: "import",
      items: Array.isArray(body) ? body : body?.items ?? body?.orders ?? body?.data ?? [],
      replace: body?.replace === true,
    });
  } catch (error: any) {
    console.error("[admin/orders] PUT failed:", error);
    return errorResponse(error, "ADMIN_ORDERS_PUT_FAILED");
  }
}

export async function DELETE(req: Request) {
  try {
    const url = new URL(req.url);
    const body = await req.json().catch(() => ({} as any));

    const id =
      url.searchParams.get("id") ||
      url.searchParams.get("orderId") ||
      url.searchParams.get("code") ||
      body?.id ||
      body?.orderId ||
      body?.code ||
      "";

    if (!id) {
      return jsonResponse(
        {
          ok: false,
          source: "db",
          error: "id missing",
        },
        400,
      );
    }

    return handlePost(req, {
      action: "delete",
      id,
    });
  } catch (error: any) {
    console.error("[admin/orders] DELETE failed:", error);
    return errorResponse(error, "ADMIN_ORDERS_DELETE_FAILED");
  }
}