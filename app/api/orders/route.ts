// app/api/orders/route.ts
import { NextResponse } from "next/server";
import { prisma, getTenantId } from "@/lib/db";
import { generateOrderId } from "@/lib/order-id";
import { getServerSettings } from "@/lib/server/settings";

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

const ORDER_SCHEMA_FIELDS = new Set<string>([
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
  "archivedAt",
  "anonymizedAt",
  "history",
  "print",
  "createdAt",
  "updatedAt",
]);

function hasOrderField(fieldName: string) {
  return ORDER_SCHEMA_FIELDS.has(fieldName);
}

function isDecimalLike(value: any): value is { toNumber: () => number } {
  return Boolean(
    value &&
      typeof value === "object" &&
      typeof value.toNumber === "function" &&
      value.constructor?.name === "Decimal",
  );
}

function cleanId(value: any) {
  return String(value || "")
    .trim()
    .replace(/^#+/, "")
    .replace(/\s+/g, "")
    .replace(/[^a-zA-Z0-9_-]/g, "");
}

function toNum(value: any, fallback = 0) {
  if (typeof value === "number" && Number.isFinite(value)) return value;

  if (isDecimalLike(value)) {
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
      if (key === "__proto__" || key === "prototype" || key === "constructor") continue;
      if (item === undefined) continue;

      out[key] = sanitizeJson(item);
    }

    return out;
  }

  return value;
}

function parseBool(value: any) {
  const text = String(value || "").toLowerCase().trim();
  return text === "1" || text === "true" || text === "yes" || text === "ja";
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

function normalizeStatus(value: any): OrderStatus {
  const text = String(value || "").toLowerCase().trim();

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

  return "new";
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

function normalizeCustomerFromRaw(raw: any) {
  const order = ensureObj(raw?.order);
  const customer = ensureObj(raw?.customer ?? order?.customer);

  const name =
    raw?.customerName ??
    raw?.name ??
    order?.customerName ??
    order?.name ??
    customer?.name ??
    customer?.customerName ??
    "";

  const phone =
    raw?.phone ??
    raw?.telephone ??
    order?.phone ??
    order?.telephone ??
    customer?.phone ??
    customer?.telephone ??
    "";

  const streetHouse = [customer?.street, customer?.house ?? customer?.houseNo]
    .map((part) => cleanText(part))
    .filter(Boolean)
    .join(" ");

  const addressLine =
    raw?.addressLine ??
    raw?.address ??
    order?.addressLine ??
    order?.address ??
    customer?.addressLine ??
    customer?.address ??
    streetHouse ??
    "";

  const plz =
    raw?.plz ??
    raw?.zip ??
    order?.plz ??
    order?.zip ??
    customer?.plz ??
    customer?.zip ??
    customer?.postalCode ??
    "";

  const email = raw?.email ?? order?.email ?? customer?.email ?? "";

  const note =
    raw?.note ??
    raw?.orderNote ??
    order?.note ??
    order?.orderNote ??
    customer?.note ??
    customer?.deliveryHint ??
    "";

  return sanitizeJson({
    ...customer,
    name: cleanText(name, ""),
    phone: cleanText(phone, ""),
    address: cleanText(customer?.address ?? addressLine, ""),
    addressLine: cleanText(addressLine, ""),
    street: cleanText(customer?.street, ""),
    house: cleanText(customer?.house ?? customer?.houseNo, ""),
    plz: cleanText(plz, "") || null,
    zip: cleanText(customer?.zip ?? plz, "") || null,
    city: cleanText(customer?.city, ""),
    email: cleanText(email, ""),
    deliveryHint: cleanText(customer?.deliveryHint ?? note, ""),
    note: cleanText(customer?.note ?? note, ""),
  });
}

function normalizeItems(value: any) {
  return ensureArr(value).map((item, index) =>
    sanitizeJson({
      id: item?.id ? String(item.id) : undefined,
      sku: item?.sku ? String(item.sku) : item?.code ? String(item.code) : undefined,
      name: cleanText(item?.name || item?.title || "Artikel"),
      category: item?.category ? String(item.category) : undefined,
      price: toNum(item?.price ?? item?.unitPrice, 0),
      qty: Math.max(1, toNum(item?.qty ?? item?.quantity ?? 1, 1)),
      add: ensureArr(item?.add ?? item?.extras).map((extra: any) => ({
        id: extra?.id ? String(extra.id) : undefined,
        label: cleanText(extra?.label ?? extra?.name ?? "Extra"),
        name: cleanText(extra?.name ?? extra?.label ?? "Extra"),
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

function normalizeHistory(value: any) {
  return ensureArr(value).map((entry) =>
    sanitizeJson({
      ts: toNum(entry?.ts ?? entry?.createdAt, Date.now()),
      action: cleanText(entry?.action ?? entry?.status ?? "event"),
      by: cleanText(entry?.by) || undefined,
      note: cleanText(entry?.note) || undefined,
    }),
  );
}

function hasIncomingEtaMin(raw: any) {
  const order = ensureObj(raw?.order);

  return (
    (raw?.etaMin !== undefined && raw?.etaMin !== null && raw?.etaMin !== "") ||
    (order?.etaMin !== undefined && order?.etaMin !== null && order?.etaMin !== "")
  );
}

function etaByDeliveryLoad(baseDelivery: number, load: number) {
  const base = Math.max(1, Math.round(baseDelivery || 35));

  if (load >= 9) return 60;
  if (load >= 7) return Math.min(60, base + 20);
  if (load >= 5) return Math.min(60, base + 15);
  if (load >= 3) return Math.min(60, base + 10);

  return Math.min(60, base);
}

async function readEtaSettings() {
  const settings = await getServerSettings().catch(() => ({} as any));

  return {
    pickup: Math.max(1, Number(settings?.hours?.avgPickupMinutes ?? 15) || 15),
    delivery: Math.max(1, Number(settings?.hours?.avgDeliveryMinutes ?? 35) || 35),
  };
}

async function computeDeliveryEtaMin(tenantId: string, baseDelivery: number) {
  const where: Record<string, any> = {
    tenantId,
    mode: "delivery",
    status: {
      in: ["new", "preparing", "ready", "out_for_delivery"],
    },
  };

  if (hasOrderField("archivedAt")) where.archivedAt = null;
  if (hasOrderField("anonymizedAt")) where.anonymizedAt = null;

  const rows = await prisma.order
    .findMany({
      where,
      select: {
        status: true,
      },
    })
    .catch(() => []);

  let kitchenLoad = 0;
  let driverLoad = 0;

  for (const row of rows) {
    const status = normalizeStatus((row as any)?.status);

    if (status === "new" || status === "preparing") {
      kitchenLoad += 1;
      driverLoad += 0.75;
    } else if (status === "ready") {
      kitchenLoad += 0.5;
      driverLoad += 2;
    } else if (status === "out_for_delivery") {
      driverLoad += 1.25;
    }
  }

  // Yeni gelen Lieferung de sıraya gireceği için hesaba dahil edilir.
  kitchenLoad += 1;
  driverLoad += 0.75;

  return etaByDeliveryLoad(baseDelivery, Math.max(kitchenLoad, driverLoad));
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
    "archivedAt",
    "anonymizedAt",
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
  const customer = normalizeCustomerFromRaw({ customer: row?.customer });
  const items = normalizeItems(row?.items);
  const history = normalizeHistory(row?.history ?? rawMeta?.history);

  const status = normalizeStatus(rawMeta?.statusManual ?? row?.status);
  const legacyStatus = toLegacyStatus(status);

  const merchandise = toNum(row?.merchandise, computeMerchandise(items));
  const discount = toNum(row?.discount, 0);
  const surcharges = toNum(row?.surcharges, 0);
  const couponDiscount = toNum(row?.couponDiscount, rawMeta?.couponDiscount ?? 0);
  const total = toNum(
    row?.total,
    Math.max(0, merchandise + surcharges - discount - couponDiscount),
  );

  const archivedAt = toIso(row?.archivedAt ?? rawMeta?.archivedAt);
  const anonymizedAt = toIso(row?.anonymizedAt ?? rawMeta?.anonymizedAt);

  const meta = sanitizeJson({
    ...rawMeta,
    history,
    coupon: row?.coupon ?? rawMeta?.coupon ?? null,
    couponDiscount,
    couponMeta: rawMeta?.couponMeta ?? null,
    couponLifecycle: rawMeta?.couponLifecycle ?? null,
    archivedAt,
    anonymizedAt,
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
    archivedAt,
    anonymizedAt,
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
  `;

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

function buildCreateData(
  tenantId: string,
  raw: any,
  forcedId?: string,
  etaFallback?: {
    pickup: number;
    delivery: number;
  },
) {
  const now = Date.now();
  const order = ensureObj(raw?.order);
  const rawMeta = ensureObj(raw?.meta ?? order?.meta);

  const id =
    cleanId(forcedId || raw?.id || raw?.orderId) ||
    `ORD-${now.toString(36).toUpperCase()}`;

  const items = normalizeItems(raw?.items ?? order?.items);
  const customer = normalizeCustomerFromRaw(raw);

  const status = normalizeStatus(raw?.status ?? order?.status ?? rawMeta?.statusManual);
  const mode = normalizeMode(raw?.mode ?? order?.mode);
  const channel = normalizeChannel(raw?.channel ?? raw?.source ?? order?.channel ?? order?.source, mode);

  const merchandise = toNum(raw?.merchandise ?? order?.merchandise, computeMerchandise(items));
  const discount = toNum(raw?.discount ?? order?.discount, 0);
  const surcharges = toNum(raw?.surcharges ?? order?.surcharges, 0);
  const couponDiscount = toNum(
    raw?.couponDiscount ?? order?.couponDiscount,
    rawMeta?.couponDiscount ?? 0,
  );

  const total = toNum(
    raw?.total ?? order?.total,
    Math.max(0, merchandise + surcharges - discount - couponDiscount),
  );

  const coupon = raw?.coupon ?? order?.coupon ?? rawMeta?.coupon ?? null;
  const history = normalizeHistory(raw?.history ?? rawMeta?.history);

  const finalHistory = history.length
    ? history
    : [
        {
          ts: toMs(raw?.ts ?? raw?.createdAt, now),
          action: `status:${status}`,
          by: channel || "api",
        },
      ];

  const meta = sanitizeJson({
    ...rawMeta,
    source: rawMeta?.source ?? channel,
    orderId: rawMeta?.orderId ?? raw?.orderId ?? id,
    trackingCode: rawMeta?.trackingCode ?? id,
    code: rawMeta?.code ?? id,
    history: finalHistory,
    coupon,
    couponDiscount,
    couponMeta: rawMeta?.couponMeta ?? raw?.couponMeta ?? order?.couponMeta ?? null,
    couponLifecycle: rawMeta?.couponLifecycle ?? raw?.couponLifecycle ?? order?.couponLifecycle ?? null,
    note: rawMeta?.note ?? raw?.note ?? order?.note ?? customer?.deliveryHint ?? customer?.note ?? null,
    orderNote: rawMeta?.orderNote ?? raw?.orderNote ?? order?.orderNote ?? customer?.deliveryHint ?? customer?.note ?? null,
    archivedAt: toIso(raw?.archivedAt ?? order?.archivedAt ?? rawMeta?.archivedAt),
    anonymizedAt: toIso(raw?.anonymizedAt ?? order?.anonymizedAt ?? rawMeta?.anonymizedAt),
  });

  const fallbackPickup = Math.max(1, Math.round(toNum(etaFallback?.pickup, 15)));
  const fallbackDelivery = Math.max(1, Math.round(toNum(etaFallback?.delivery, 35)));

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
    ts: toDate(raw?.ts ?? raw?.createdAt ?? order?.ts) || new Date(now),
    planned: raw?.planned ?? order?.planned ?? null,
    etaMin: toNum(raw?.etaMin ?? order?.etaMin, mode === "pickup" ? fallbackPickup : fallbackDelivery),
  };

  if (hasOrderField("etaAdjustMin")) {
    data.etaAdjustMin = toNum(raw?.etaAdjustMin ?? rawMeta?.etaAdjustMin, 0);
  }

  if (hasOrderField("history")) {
    data.history = sanitizeJson(finalHistory);
  }

  if (hasOrderField("driver")) {
    data.driver = sanitizeJson(raw?.driver ?? rawMeta?.driver ?? null);
  }

  if (hasOrderField("print")) {
    data.print = sanitizeJson(raw?.print ?? rawMeta?.print ?? null);
  }

  if (hasOrderField("doneAt")) {
    data.doneAt = status === "done" ? toDate(raw?.doneAt ?? rawMeta?.doneAt) || new Date() : null;
  }

  if (hasOrderField("cancelledAt")) {
    data.cancelledAt =
      status === "cancelled" ? toDate(raw?.cancelledAt ?? rawMeta?.cancelledAt) || new Date() : null;
  }

  if (hasOrderField("archivedAt")) {
    data.archivedAt = toDate(raw?.archivedAt ?? order?.archivedAt ?? rawMeta?.archivedAt);
  }

  if (hasOrderField("anonymizedAt")) {
    data.anonymizedAt = toDate(raw?.anonymizedAt ?? order?.anonymizedAt ?? rawMeta?.anonymizedAt);
  }

  return data;
}

function toUpdateData(createData: Record<string, any>) {
  const data = { ...createData };
  delete data.id;
  delete data.tenantId;
  return data;
}

function buildCouponLifecyclePatch(meta: Record<string, any>, next: OrderStatus, now: number, by: string) {
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

function buildStatusPatch(row: any, statusRaw: any, by = "api") {
  const next = normalizeStatus(statusRaw);
  const now = Date.now();
  const rawMeta = ensureObj(row?.meta);
  const history = normalizeHistory(row?.history ?? rawMeta?.history);

  const nextHistory = [
    ...history,
    {
      ts: now,
      action: `status:${next}`,
      by,
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

async function listOrders(tenantId: string, take = 1000, includeArchived = false) {
  const where: Record<string, any> = {
    tenantId,
  };

  if (hasOrderField("archivedAt") && !includeArchived) {
    where.archivedAt = null;
  }

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

async function upsertImportedOrder(tx: any, tenantId: string, raw: any) {
  const id =
    cleanId(raw?.id || raw?.orderId) ||
    (await generateUniqueOrderId(6));

  const data = buildCreateData(tenantId, raw, id);

  const existing = await tx.order.findFirst({
    where: {
      tenantId,
      id,
    },
    select: {
      id: true,
    },
  });

  if (existing?.id) {
    await tx.order.update({
      where: {
        id: existing.id,
      },
      data: toUpdateData(data) as any,
    });
  } else {
    await tx.order.create({
      data: data as any,
    });
  }

  return id;
}

export async function GET(req: Request) {
  try {
    const tenantId = await getTenantId();
    const url = new URL(req.url);
    const id =
      url.searchParams.get("id") ||
      url.searchParams.get("orderId") ||
      url.searchParams.get("code");

    if (id) {
      const row = await findOrder(tenantId, id);
      const order = row ? serializeOrder(row) : null;

      if (!order) {
        return jsonResponse(
          {
            ok: false,
            source: "db",
            error: "not_found",
            order: null,
            item: null,
          },
          404,
        );
      }

      return jsonResponse({
        ok: true,
        source: "db",
        ...order,
        order,
        item: order,
        data: order,
      });
    }

    const take = Math.min(
      Math.max(toNum(url.searchParams.get("take"), 1000), 1),
      1000,
    );

    const includeArchived =
      parseBool(url.searchParams.get("includeArchived")) ||
      parseBool(url.searchParams.get("archived"));

    const orders = await listOrders(tenantId, take, includeArchived);

    return jsonResponse({
      ok: true,
      source: "db",
      archived: {
        included: includeArchived,
      },
      orders,
      items: orders,
      allOrders: orders,
      count: orders.length,
    });
  } catch (error: any) {
    console.error("[orders] GET failed:", error);
    return errorResponse(error, "ORDERS_GET_FAILED");
  }
}

export async function POST(req: Request) {
  try {
    const tenantId = await getTenantId();
    const body = await req.json().catch(() => ({} as any));
    const action = String(body?.action || "").trim();

    if (!action) {
      const id = await generateUniqueOrderId(6);
      const etaSettings = await readEtaSettings();

      const incoming = {
        ...body,
        id,
        meta: {
          ...ensureObj(body?.meta),
          source: ensureObj(body?.meta)?.source ?? "api",
        },
      };

      const mode = normalizeMode(body?.mode ?? ensureObj(body?.order)?.mode);
      const deliveryEta =
        mode === "delivery" && !hasIncomingEtaMin(incoming)
          ? await computeDeliveryEtaMin(tenantId, etaSettings.delivery)
          : etaSettings.delivery;

      const data = buildCreateData(tenantId, incoming, id, {
        pickup: etaSettings.pickup,
        delivery: deliveryEta,
      });

      const created = await prisma.order.create({
        data: data as any,
        select: buildOrderSelect() as any,
      });

      const order = serializeOrder(created);

      return jsonResponse({
        ok: true,
        source: "db",
        id: order.id,
        orderId: order.orderId,
        order,
        item: order,
        data: order,
      });
    }

    if (action === "addDummy") {
      const id = await generateUniqueOrderId(6);
      const now = Date.now();
      const delivery = Math.random() > 0.5;
      const etaSettings = await readEtaSettings();
      const etaMin = delivery
        ? await computeDeliveryEtaMin(tenantId, etaSettings.delivery)
        : etaSettings.pickup;

      await prisma.order.create({
        data: buildCreateData(
          tenantId,
          {
            id,
            ts: now,
            mode: delivery ? "delivery" : "pickup",
            channel: "web",
            plz: delivery ? "13507" : null,
            customer: {
              name: "Max Mustermann",
              phone: "49123456789",
              address: delivery ? "Berliner Str. 1 | 13507 Berlin" : "",
              addressLine: delivery ? "Berliner Str. 1" : "",
              plz: delivery ? "13507" : null,
              zip: delivery ? "13507" : null,
              city: "Berlin",
            },
            items: [
              { name: "Classic Burger", category: "burger", price: 9.9, qty: 1 },
              { name: "Fries", category: "extras", price: 3.5, qty: 1 },
              { name: "Ketchup", category: "sauces", price: 0.5, qty: 1 },
            ],
            merchandise: 13.9,
            discount: 0,
            surcharges: delivery ? 1.5 : 0,
            total: 13.9 + (delivery ? 1.5 : 0),
            status: "new",
            etaMin,
            meta: {
              source: "api",
              note: "Testbestellung",
            },
          },
          id,
        ) as any,
      });

      const orders = await listOrders(tenantId);

      return jsonResponse({
        ok: true,
        source: "db",
        orders,
        items: orders,
        count: orders.length,
      });
    }

    if (action === "updateDriverPosition") {
      const id = String(body?.id || body?.orderId || body?.code || "").trim();
      const by = cleanText(body?.by || body?.driverName || "driver", "driver");

      const lat = Number(body?.lat ?? body?.position?.lat ?? body?.position?.latitude);
      const lng = Number(
        body?.lng ??
          body?.lon ??
          body?.position?.lng ??
          body?.position?.lon ??
          body?.position?.longitude,
      );

      const ts = toNum(body?.ts ?? body?.position?.ts, Date.now());

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

      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        return jsonResponse(
          {
            ok: false,
            source: "db",
            error: "lat/lng missing",
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

      const rawMeta = ensureObj((row as any)?.meta);

      const livePos = sanitizeJson({
        lat,
        lng,
        ts,
      });

      const nextMeta = sanitizeJson({
        ...rawMeta,
        lastPos: livePos,
        lastDriverPos: livePos,
        lastDriverPosAt: ts,
        lastDriverPosBy: by,
      });

      const updated = await prisma.order.update({
        where: {
          id: String((row as any).id),
        },
        data: {
          meta: nextMeta,
        } as any,
        select: buildOrderSelect() as any,
      });

      const order = serializeOrder(updated);

      return jsonResponse({
        ok: true,
        source: "db",
        id: order.id,
        orderId: order.orderId,
        position: livePos,
        order,
        item: order,
        data: order,
      });
    }

    if (action === "setStatus") {
      const id = String(body?.id || body?.orderId || body?.code || "").trim();
      const status = body?.status;

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
        data: buildStatusPatch(row, status, "api") as any,
        select: buildOrderSelect() as any,
      });

      const order = serializeOrder(updated);
      const orders = await listOrders(tenantId);

      return jsonResponse({
        ok: true,
        source: "db",
        id: order.id,
        orderId: order.orderId,
        status: order.status,
        order,
        item: order,
        data: order,
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

      const orders = await listOrders(tenantId);

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

      const row = await findOrder(tenantId, id);

      if (row) {
        const copyId = await generateUniqueOrderId(6);
        const serialized = serializeOrder(row);
        const meta = ensureObj(serialized?.meta);
        const history = normalizeHistory(serialized?.history ?? meta?.history);

        history.push({
          ts: Date.now(),
          action: "duplicated",
          by: "api",
          note: `Quelle: ${id}`,
        });

        await prisma.order.create({
          data: buildCreateData(
            tenantId,
            {
              ...serialized,
              id: copyId,
              ts: Date.now(),
              status: "new",
              archivedAt: null,
              anonymizedAt: null,
              meta: {
                ...meta,
                source: "api",
                duplicatedFrom: id,
                statusManual: "new",
                archivedAt: null,
                anonymizedAt: null,
                history,
              },
            },
            copyId,
          ) as any,
        });
      }

      const orders = await listOrders(tenantId);

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

      await prisma.$transaction(async (tx: any) => {
        for (const raw of incoming) {
          const id = await upsertImportedOrder(tx, tenantId, raw);
          seenIds.add(id);
        }

        /*
          DB-first güvenlik:
          replace=true boş/stale payload ile gelirse siparişleri silmiyoruz.
          Ayrıca arşivlenmiş siparişleri import replace ile silmiyoruz.
        */
        if (replace && incoming.length > 0 && seenIds.size > 0) {
          const where: Record<string, any> = {
            tenantId,
            id: {
              notIn: Array.from(seenIds),
            },
          };

          if (hasOrderField("archivedAt")) {
            where.archivedAt = null;
          }

          await tx.order.deleteMany({
            where,
          });
        }
      });

      const orders = await listOrders(tenantId);

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
        allowedActions: [
          "addDummy",
          "setStatus",
          "updateDriverPosition",
          "delete",
          "duplicate",
          "import",
        ],
      },
      400,
    );
  } catch (error: any) {
    console.error("[orders] POST failed:", error);
    return errorResponse(error, "ORDERS_POST_FAILED");
  }
}

export async function PUT(req: Request) {
  try {
    const body = await req.json().catch(() => ({} as any));

    const orders = Array.isArray(body)
      ? body
      : Array.isArray(body?.orders)
        ? body.orders
        : Array.isArray(body?.items)
          ? body.items
          : Array.isArray(body?.data)
            ? body.data
            : [];

    const request = new Request(req.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        action: "import",
        orders,
        replace: body?.replace === true,
      }),
    });

    return POST(request);
  } catch (error: any) {
    console.error("[orders] PUT failed:", error);
    return errorResponse(error, "ORDERS_PUT_FAILED");
  }
}

export async function DELETE(req: Request) {
  try {
    const url = new URL(req.url);
    const body = await req.json().catch(() => ({} as any));

    const id = String(
      url.searchParams.get("id") ||
        url.searchParams.get("orderId") ||
        url.searchParams.get("code") ||
        body?.id ||
        body?.orderId ||
        body?.code ||
        "",
    ).trim();

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

    const request = new Request(req.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        action: "delete",
        id,
      }),
    });

    return POST(request);
  } catch (error: any) {
    console.error("[orders] DELETE failed:", error);
    return errorResponse(error, "ORDERS_DELETE_FAILED");
  }
}