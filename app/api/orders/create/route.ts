// app/api/orders/create/route.ts
import { NextResponse } from "next/server";
import { prisma, getTenantId } from "@/lib/db";
import { generateOrderId } from "@/lib/order-id";
import { getServerSettings, saveServerSettings } from "@/lib/server/settings";
import { sendTelegramNewOrder } from "@/lib/telegram";
import { normalizePlz, routeDealMatchesAddress, routeDealStreetLabel } from "@/lib/streets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type OrderMode = "pickup" | "delivery";
type OrderSource = "lieferando" | "apollo" | "web";

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
  "print",
  "history",
  "doneAt",
  "cancelledAt",
  "archivedAt",
  "anonymizedAt",
  "createdAt",
  "updatedAt",
]);

const CUSTOMER_SCHEMA_FIELDS = new Set([
  "id",
  "tenantId",
  "name",
  "phone",
  "email",
  "address",
  "plz",
  "lastOrderAt",
  "stats",
  "emailOptIn",
  "createdAt",
  "updatedAt",
]);

function hasModelField(modelName: string, fieldName: string) {
  if (modelName === "Order") return ORDER_SCHEMA_FIELDS.has(fieldName);
  if (modelName === "Customer") return CUSTOMER_SCHEMA_FIELDS.has(fieldName);
  return false;
}

function hasOrderField(fieldName: string) {
  return hasModelField("Order", fieldName);
}

function hasCustomerField(fieldName: string) {
  return hasModelField("Customer", fieldName);
}

function isDecimalLike(value: any) {
  return Boolean(
    value &&
      typeof value === "object" &&
      typeof value.toNumber === "function" &&
      typeof value.toString === "function",
  );
}

function normPhone(value: any) {
  const digits = String(value || "").replace(/\D/g, "");
  return digits.length ? digits : null;
}

function normCouponCode(value: any) {
  return String(value || "")
    .replace(/[\s\u00A0\u2000-\u200B\u202F\u205F\u3000\uFEFF]/g, "")
    .trim()
    .toUpperCase();
}

function samePhone(left: any, right: any) {
  const a = normPhone(left);
  const b = normPhone(right);

  return Boolean(a && b && a === b);
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

function toMs(value: any, fallback = 0) {
  if (!value) return fallback;

  if (typeof value === "number" && Number.isFinite(value)) return value;

  if (value instanceof Date && Number.isFinite(value.valueOf())) {
    return value.getTime();
  }

  const asNumber = Number(value);
  if (Number.isFinite(asNumber) && asNumber > 0) return asNumber;

  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function cleanText(value: any) {
  return String(value ?? "").trim();
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

function normalizeSource(value: any, mode?: OrderMode): OrderSource {
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

  return mode === "pickup" ? "apollo" : "web";
}

function normalizePaymentMethod(order: any) {
  const meta = ensureObj(order?.meta);

  const raw =
    order?.paymentMethod ??
    order?.payment?.method ??
    meta?.paymentMethod ??
    meta?.payment?.method ??
    "";

  const text = String(raw || "").toLowerCase().trim();

  if (text === "cash" || text === "bar" || text === "barzahlung") return "cash";
  if (text === "online" || text === "stripe" || text === "card" || text === "karte") return "online";
  if (text === "contactless" || text === "kontaktlos" || text === "terminal") return "contactless";
  if (text === "split" || text === "split_contactless" || text === "getrennt") return "split_contactless";

  return text || null;
}

function normalizePaymentStatus(order: any) {
  const meta = ensureObj(order?.meta);

  const raw =
    order?.paymentStatus ??
    order?.payment?.status ??
    meta?.paymentStatus ??
    meta?.payment?.status ??
    "";

  const text = String(raw || "").toLowerCase().trim();

  if (text === "paid" || text === "bezahlt") return "paid";
  if (text === "failed" || text === "cancelled" || text === "canceled") return "failed";
  if (text === "refunded") return "refunded";
  if (text === "pending" || text === "offen") return "pending";

  return text || "pending";
}

function normalizeCustomer(order: any) {
  const customer = ensureObj(order?.customer);
  const phone = normPhone(customer?.phone ?? order?.phone);

  const streetHouse = [
    customer?.street,
    customer?.house ?? customer?.houseNo,
  ]
    .map((part) => cleanText(part))
    .filter(Boolean)
    .join(" ");

  const addressLine =
    cleanText(customer?.addressLine) ||
    cleanText(customer?.address) ||
    cleanText(order?.addressLine) ||
    cleanText(order?.address) ||
    cleanText(streetHouse);

  const plz =
    cleanText(customer?.plz ?? customer?.zip ?? customer?.postalCode ?? order?.plz) ||
    "";

  const note =
    cleanText(customer?.deliveryHint) ||
    cleanText(customer?.note) ||
    cleanText(order?.note) ||
    cleanText(order?.orderNote) ||
    "";

  return sanitizeJson({
    ...customer,
    name: cleanText(customer?.name ?? order?.customerName),
    phone: phone || cleanText(customer?.phone ?? order?.phone) || null,
    email: cleanText(customer?.email ?? order?.email) || null,
    address: cleanText(customer?.address) || addressLine || null,
    addressLine: addressLine || null,
    street: cleanText(customer?.street) || null,
    house: cleanText(customer?.house ?? customer?.houseNo) || null,
    zip: plz || null,
    plz: plz || null,
    city: cleanText(customer?.city) || null,
    floor: cleanText(customer?.floor) || null,
    entrance: cleanText(customer?.entrance) || null,
    deliveryHint: note || null,
    note: cleanText(customer?.note) || note || null,
    emailOptIn: Boolean(customer?.emailOptIn ?? order?.emailOptIn ?? false),
  });
}

function normalizeItems(order: any) {
  return ensureArr(order?.items).map((item: any, index) => {
    const add = ensureArr(item?.add ?? item?.extras);
    const rm = ensureArr(item?.rm ?? item?.remove);

    return sanitizeJson({
      id: item?.id != null ? String(item.id) : undefined,
      sku: item?.sku != null ? String(item.sku) : item?.id != null ? String(item.id) : undefined,
      name: cleanText(item?.name || item?.title || "Artikel"),
      description: cleanText(item?.description ?? item?.desc ?? item?.itemDescription) || undefined,
      category: item?.category != null ? String(item.category) : undefined,
      price: toNum(item?.price ?? item?.unitPrice, 0),
      qty: Math.max(1, toNum(item?.qty ?? item?.quantity ?? 1, 1)),
      add: add.length
        ? add.map((extra: any) => ({
            id: extra?.id != null ? String(extra.id) : undefined,
            label: cleanText(extra?.label ?? extra?.name),
            name: cleanText(extra?.name ?? extra?.label),
            price: toNum(extra?.price, 0),
          }))
        : undefined,
      rm: rm.length ? rm.map((entry: any) => String(entry)) : undefined,
      note: cleanText(item?.note) || undefined,
      _idx: index,
    });
  });
}

function normalizeProductKey(value: any) {
  return cleanText(value)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function productAvailabilityLookupKeys(item: any) {
  return [
    item?.id,
    item?.sku,
    item?.code,
    item?.name,
    item?.title,
  ]
    .map(normalizeProductKey)
    .filter(Boolean);
}

function normalizeProductAvailabilityMap(value: any): Record<string, any> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};

  const out: Record<string, any> = {};

  for (const [key, entry] of Object.entries(value)) {
    const cleanKey = normalizeProductKey(key);
    if (!cleanKey) continue;

    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      out[cleanKey] = null;
      continue;
    }

    out[cleanKey] = sanitizeJson({
      disabled: (entry as any)?.disabled === true,
      mode: cleanText((entry as any)?.mode) || "manual",
      until: (entry as any)?.until ? String((entry as any).until) : null,
      by: cleanText((entry as any)?.by) || undefined,
      updatedAt: toNum((entry as any)?.updatedAt, 0) || undefined,
      productId: cleanText((entry as any)?.productId) || undefined,
      name: cleanText((entry as any)?.name) || undefined,
    });
  }

  return out;
}

function isAvailabilityEntryClosed(entry: any, nowMs: number) {
  if (!entry?.disabled) return false;
  if (!entry?.until) return true;

  const untilMs = Date.parse(String(entry.until));
  if (!Number.isFinite(untilMs)) return true;

  return untilMs > nowMs;
}

function isOrderItemTemporarilyUnavailable(
  item: any,
  availability: Record<string, any>,
  nowMs: number,
) {
  for (const key of productAvailabilityLookupKeys(item)) {
    if (isAvailabilityEntryClosed(availability[key], nowMs)) return true;
  }

  return false;
}

function findUnavailableOrderItems(items: any[], settings: any, nowMs: number) {
  const availability = normalizeProductAvailabilityMap(settings?.productAvailability);

  return items
    .filter((item) => isOrderItemTemporarilyUnavailable(item, availability, nowMs))
    .map((item) => cleanText(item?.name || item?.title || item?.sku || item?.id || "Artikel"))
    .filter(Boolean);
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

function normalizeLoadStatus(value: any) {
  const text = String(value || "").toLowerCase().trim();

  if (text === "received" || text === "eingegangen") return "new";

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

  if (text === "out_for_delivery" || text === "on_the_way" || text === "unterwegs") {
    return "out_for_delivery";
  }

  if (text === "done" || text === "delivered" || text === "completed" || text === "fertig") return "done";
  if (text === "cancelled" || text === "canceled" || text === "storniert") return "cancelled";
  if (text === "new") return "new";

  return "";
}

const DELIVERY_MAX_MINUTES = 60;
const DELIVERY_LOAD_STEP_MINUTES = 5;
const DELIVERY_ORDERS_PER_STEP = 2;
const DELIVERY_ACTIVE_LOOKBACK_MINUTES = 12 * 60;

function etaByDeliveryLoad(baseDelivery: number, activeOrders: number) {
  const base = Math.min(
    DELIVERY_MAX_MINUTES,
    Math.max(1, Math.round(baseDelivery || 35)),
  );

  const activeCount = Math.max(0, Math.floor(activeOrders || 0));

  if (activeCount <= 0) {
    return base;
  }

  const extra = Math.ceil(activeCount / DELIVERY_ORDERS_PER_STEP) * DELIVERY_LOAD_STEP_MINUTES;

  return Math.min(DELIVERY_MAX_MINUTES, base + extra);
}

async function computeDeliveryEtaMin(tenantId: string, baseDelivery: number) {
  const nowMs = Date.now();
  const since = new Date(nowMs - DELIVERY_ACTIVE_LOOKBACK_MINUTES * 60_000);

  const where: Record<string, any> = {
    tenantId,
    mode: "delivery",
    ts: { gte: since },
    status: {
      in: ["new", "preparing", "ready", "out_for_delivery"],
    },
  };

  if (hasOrderField("archivedAt")) where.archivedAt = null;
  if (hasOrderField("anonymizedAt")) where.anonymizedAt = null;

  const activeOrders = await prisma.order
    .count({
      where,
    })
    .catch(() => 0);

  return etaByDeliveryLoad(baseDelivery, activeOrders);
}

function safeRouteDealList(value: any): string[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => cleanText(item))
      .filter(Boolean);
  }

  if (typeof value === "string") {
    return value
      .split(/[;,\n]/g)
      .map((item) => cleanText(item))
      .filter(Boolean);
  }

  return [];
}

function normalizeRouteDealReward(value: any) {
  const raw = ensureObj(value);
  const type = ["percent", "fixed", "free_delivery", "free_sauce", "free_drink"].includes(
    String(raw?.type || ""),
  )
    ? String(raw.type)
    : "percent";

  return sanitizeJson({
    ...raw,
    type,
    percent: Math.min(100, Math.max(0, toNum(raw?.percent ?? raw?.value, 15))),
    amount: Math.max(0, toNum(raw?.amount ?? raw?.fixedAmount, 0)),
    maxDiscount: Math.max(0, toNum(raw?.maxDiscount, 0)),
    freeItemName: cleanText(raw?.freeItemName),
    freeItemCategory:
      cleanText(raw?.freeItemCategory) ||
      (type === "free_drink" ? "drinks" : type === "free_sauce" ? "sauces" : ""),
  });
}

function cleanActiveRouteDeals(value: any, nowMs: number) {
  return ensureArr(value).filter((deal) => {
    const expiresAtMs = toMs(deal?.expiresAt, 0);
    return expiresAtMs > nowMs;
  });
}

function makeRouteDealId(ruleId: string, orderId: string, nowMs: number) {
  const cleanRule = String(ruleId || "route-deal")
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);

  return `rd-${cleanRule || "deal"}-${orderId}-${nowMs.toString(36)}`;
}

async function activateRouteDealIfNeeded(params: {
  settings: any;
  order: any;
  customer: any;
  orderId: string;
  mode: OrderMode;
  nowMs: number;
}) {
  const { settings, order, customer, orderId, mode, nowMs } = params;

  if (mode !== "delivery") return null;

  const cfg = ensureObj(settings?.routeDeals);
  if (cfg?.enabled !== true) return null;

  const rules = ensureArr(cfg?.rules)
    .filter((rule) => rule?.enabled !== false)
    .sort((a, b) => toNum(a?.priority, 0) - toNum(b?.priority, 0));

  if (!rules.length) return null;

  const address = {
    plz: customer?.plz ?? customer?.zip ?? order?.plz ?? order?.zip ?? null,
    zip: customer?.zip ?? customer?.plz ?? order?.zip ?? order?.plz ?? null,
    postalCode: customer?.postalCode ?? null,
    street: customer?.street ?? null,
    addressLine: customer?.addressLine ?? order?.addressLine ?? null,
    address: customer?.address ?? order?.address ?? null,
  };

  const matchedRule = rules.find((rule) => routeDealMatchesAddress(rule, address));
  if (!matchedRule) return null;

  const plz = normalizePlz(address.plz || address.zip || "");
  if (!plz) return null;

  const durationMinutes = Math.min(
    60,
    Math.max(1, toNum(matchedRule?.durationMinutes, toNum(cfg?.defaultDurationMinutes, 12))),
  );

  const startedAt = new Date(nowMs);
  const expiresAt = new Date(nowMs + durationMinutes * 60_000);
  const streetLabel = routeDealStreetLabel(address);
  const ruleStreets = safeRouteDealList(matchedRule?.streets ?? matchedRule?.streetList);
  const matchMode = ruleStreets.length > 0 ? "street" : "plz";

  const ruleId = cleanText(matchedRule?.id) || `route-deal-${plz}`;
  const activeDeal = sanitizeJson({
    id: makeRouteDealId(ruleId, orderId, nowMs),
    ruleId,
    name: cleanText(matchedRule?.name) || "Nachbarschafts-Deal",
    plz,
    street: matchMode === "street" ? streetLabel || "" : "",
    streets: ruleStreets,
    matchMode,
    requireStreet: matchMode === "street",
    orderId,
    startedAt: startedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    durationMinutes,
    minTotal: Math.max(0, toNum(matchedRule?.minTotal ?? matchedRule?.minimumTotal, 0)),
    reward: normalizeRouteDealReward(matchedRule?.reward ?? matchedRule),
    message:
      cleanText(matchedRule?.message) ||
      "Unser Fahrer ist gleich in Ihrer Nähe. Bestellen Sie jetzt und sichern Sie sich Ihr Nachbarschafts-Angebot.",
    trigger: {
      source: "order_create",
      orderId,
      plz,
      street: streetLabel || "",
    },
  });

  const existingActive = cleanActiveRouteDeals(cfg?.active, nowMs).filter((deal) => {
    const sameRule = cleanText(deal?.ruleId) === ruleId;
    const samePlz = normalizePlz(deal?.plz) === plz;
    const dealStreets = safeRouteDealList(deal?.streets ?? deal?.streetList);
    const dealMatchMode =
      cleanText(deal?.matchMode) || (dealStreets.length > 0 ? "street" : "plz");
    const sameStreet =
      cleanText(deal?.street || "").toLowerCase() ===
      cleanText(streetLabel || "").toLowerCase();
    const sameScope = dealMatchMode === "street" ? sameStreet : true;

    return !(sameRule && samePlz && sameScope);
  });

  const maxActiveDeals = Math.min(5, Math.max(1, toNum(cfg?.maxActiveDeals, 2)));

  const nextRouteDeals = sanitizeJson({
    ...cfg,
    enabled: true,
    maxActiveDeals,
    defaultDurationMinutes: Math.min(
      60,
      Math.max(1, toNum(cfg?.defaultDurationMinutes, 12)),
    ),
    rules,
    active: [activeDeal, ...existingActive].slice(0, maxActiveDeals),
  });

  await saveServerSettings({
    routeDeals: nextRouteDeals,
  } as any);

  return activeDeal;
}

function buildOrderMeta(params: {
  order: any;
  source: OrderSource;
  nowMs: number;
  coupon: string | null;
  couponDiscount: number;
  orderId: string;
}) {
  const { order, source, nowMs, coupon, couponDiscount, orderId } = params;
  const incomingMeta = ensureObj(order?.meta);
  const customer = ensureObj(order?.customer);

  const note =
    cleanText(order?.orderNote) ||
    cleanText(order?.note) ||
    cleanText(incomingMeta?.note) ||
    cleanText(incomingMeta?.orderNote) ||
    cleanText(customer?.deliveryHint) ||
    cleanText(customer?.note) ||
    "";

  const oldHistory = normalizeHistory(incomingMeta?.history);

  const history = [
    ...oldHistory,
    {
      ts: nowMs,
      action: "status:new",
      by: source,
    },
  ];

  const couponMeta =
    incomingMeta?.couponMeta && typeof incomingMeta.couponMeta === "object"
      ? incomingMeta.couponMeta
      : null;

  const incomingLifecycle =
    incomingMeta?.couponLifecycle && typeof incomingMeta.couponLifecycle === "object"
      ? incomingMeta.couponLifecycle
      : {};

  const couponLifecycle = coupon
    ? {
        ...incomingLifecycle,
        code: coupon,
        state: incomingLifecycle?.state || "reserved",
        reservedAt: incomingLifecycle?.reservedAt ?? nowMs,
        reservedBy: incomingLifecycle?.reservedBy ?? "checkout",
        source: incomingLifecycle?.source ?? "checkout",
        couponDiscount,
      }
    : null;

  const paymentMethod = normalizePaymentMethod(order);
  const paymentStatus = normalizePaymentStatus(order);

  return sanitizeJson({
    ...incomingMeta,
    source,
    orderId,
    trackingCode: incomingMeta?.trackingCode ?? orderId,
    code: incomingMeta?.code ?? orderId,
    note: note || null,
    orderNote: note || null,
    coupon: coupon || null,
    couponDiscount,
    couponMeta,
    couponLifecycle,
    paymentMethod,
    paymentStatus,
    paymentProvider:
      order?.paymentProvider ??
      order?.payment?.provider ??
      incomingMeta?.paymentProvider ??
      incomingMeta?.payment?.provider ??
      null,
    paymentId:
      order?.paymentId ??
      order?.paymentIntentId ??
      order?.payment?.id ??
      incomingMeta?.paymentId ??
      incomingMeta?.paymentIntentId ??
      incomingMeta?.payment?.id ??
      null,
    payment: {
      ...(incomingMeta?.payment && typeof incomingMeta.payment === "object" ? incomingMeta.payment : {}),
      method: paymentMethod,
      status: paymentStatus,
      provider:
        order?.paymentProvider ??
        order?.payment?.provider ??
        incomingMeta?.paymentProvider ??
        incomingMeta?.payment?.provider ??
        null,
      id:
        order?.paymentId ??
        order?.paymentIntentId ??
        order?.payment?.id ??
        incomingMeta?.paymentId ??
        incomingMeta?.paymentIntentId ??
        incomingMeta?.payment?.id ??
        null,
    },
    history,
    createdBy: source,
    createdAtMs: nowMs,
  });
}

function createCouponError(code: string, status = 409) {
  const error = new Error(code) as Error & {
    status?: number;
    couponError?: boolean;
    code?: string;
  };

  error.status = status;
  error.couponError = true;
  error.code = code;

  return error;
}

function validateIssuedCouponForOrder(params: {
  issued: any;
  customerPhone: any;
  nowMs: number;
}) {
  const { issued, customerPhone, nowMs } = params;

  if (!issued) return;

  if (issued.used === true) {
    throw createCouponError("coupon_already_used");
  }

  if (issued.note === "cancelled") {
    throw createCouponError("coupon_cancelled");
  }

  const issuedAtMs = toMs(issued.issuedAt, 0);

  if (issued.note === "scheduled" && issuedAtMs > nowMs) {
    throw createCouponError("coupon_not_available_yet");
  }

  const expiresAtMs = toMs(issued.expiresAt, 0);

  if (expiresAtMs && expiresAtMs < nowMs) {
    throw createCouponError("coupon_expired");
  }

  if (issued.assignedToPhone) {
    const phone = normPhone(customerPhone);

    if (!phone) {
      throw createCouponError("coupon_phone_required");
    }

    if (!samePhone(issued.assignedToPhone, phone)) {
      throw createCouponError("coupon_assigned_to_other_phone");
    }
  }
}

function markCouponRedeemedInMeta(params: {
  meta: any;
  issued: any;
  coupon: string;
  couponDiscount: number;
  orderId: string;
  nowMs: number;
}) {
  const { meta, issued, coupon, couponDiscount, orderId, nowMs } = params;

  const currentMeta = ensureObj(meta);
  const couponMeta = ensureObj(currentMeta?.couponMeta);
  const couponLifecycle = ensureObj(currentMeta?.couponLifecycle);

  return sanitizeJson({
    ...currentMeta,
    couponMeta: {
      ...couponMeta,
      issuedId: issued?.id ?? couponMeta?.issuedId ?? null,
      couponId: issued?.couponId ?? couponMeta?.couponId ?? null,
      code: coupon,
      redeemedAt: nowMs,
      redeemedOrderId: orderId,
    },
    couponLifecycle: {
      ...couponLifecycle,
      code: coupon,
      issuedId: issued?.id ?? couponLifecycle?.issuedId ?? null,
      couponId: issued?.couponId ?? couponLifecycle?.couponId ?? null,
      state: "redeemed",
      reservedAt: couponLifecycle?.reservedAt ?? nowMs,
      reservedBy: couponLifecycle?.reservedBy ?? "checkout",
      redeemedAt: nowMs,
      redeemedOrderId: orderId,
      couponDiscount,
    },
  });
}

async function redeemIssuedCouponIfNeeded(params: {
  tx: any;
  tenantId: string;
  coupon: string | null;
  customerPhone: any;
  orderId: string;
  couponDiscount: number;
  nowMs: number;
}) {
  const { tx, tenantId, coupon, customerPhone, orderId, couponDiscount, nowMs } = params;
  const code = normCouponCode(coupon);

  if (!code) return null;

  const issued = await tx.issuedCoupon
    .findFirst({
      where: {
        tenantId,
        code,
      },
      orderBy: {
        issuedAt: "desc",
      },
    })
    .catch(() => null);

  if (!issued) {
    return null;
  }

  validateIssuedCouponForOrder({
    issued,
    customerPhone,
    nowMs,
  });

  const updated = await tx.issuedCoupon.updateMany({
    where: {
      id: issued.id,
      tenantId,
      used: false,
    },
    data: {
      used: true,
      usedAt: new Date(nowMs),
    },
  });

  if (!updated?.count) {
    throw createCouponError("coupon_already_used");
  }

  return {
    ...issued,
    used: true,
    usedAt: new Date(nowMs),
    redeemedOrderId: orderId,
    couponDiscount,
  };
}

function mapCouponErrorMessage(code: string) {
  switch (code) {
    case "coupon_already_used":
      return "Dieser Gutschein wurde bereits verwendet.";
    case "coupon_cancelled":
      return "Dieser Gutschein wurde storniert.";
    case "coupon_not_available_yet":
      return "Dieser Gutschein ist noch nicht freigeschaltet.";
    case "coupon_expired":
      return "Dieser Gutschein ist abgelaufen.";
    case "coupon_phone_required":
      return "Für diesen Gutschein ist eine Telefonnummer erforderlich.";
    case "coupon_assigned_to_other_phone":
      return "Dieser Gutschein gehört zu einer anderen Telefonnummer.";
    default:
      return "Gutschein kann nicht verwendet werden.";
  }
}

async function generateUniqueOrderId(length: number) {
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

async function upsertCustomerFromOrder(tenantId: string, order: any, total: number) {
  try {
    const customer = normalizeCustomer(order);
    const phone = normPhone(customer?.phone);
    const name = cleanText(customer?.name);

    if (!name && !phone) return;

    const now = new Date();

    const existing =
      phone && hasCustomerField("phone")
        ? await prisma.customer.findFirst({
            where: {
              tenantId,
              phone,
            } as any,
          })
        : null;

    const prevStats = ensureObj((existing as any)?.stats);

    const nextStats = sanitizeJson({
      ...prevStats,
      orders: toNum(prevStats?.orders, 0) + 1,
      totalSpent: toNum(prevStats?.totalSpent, 0) + toNum(total, 0),
    });

    const data: Record<string, any> = {};

    if (hasCustomerField("tenantId")) data.tenantId = tenantId;
    if (hasCustomerField("name")) data.name = name || "Unbekannt";
    if (hasCustomerField("phone") && phone) data.phone = phone;
    if (hasCustomerField("email")) data.email = cleanText(customer?.email) || (existing as any)?.email || null;
    if (hasCustomerField("address")) data.address = cleanText(customer?.address ?? customer?.addressLine) || null;
    if (hasCustomerField("plz")) data.plz = cleanText(order?.plz ?? customer?.plz ?? customer?.zip) || null;
    if (hasCustomerField("lastOrderAt")) data.lastOrderAt = now;
    if (hasCustomerField("stats")) data.stats = nextStats;

    if (hasCustomerField("emailOptIn")) {
      data.emailOptIn = Boolean(customer?.emailOptIn ?? (existing as any)?.emailOptIn ?? false);
    }

    if (existing?.id) {
      await prisma.customer.update({
        where: {
          id: existing.id,
        },
        data: data as any,
      });

      return;
    }

    await prisma.customer.create({
      data: data as any,
    });
  } catch (error) {
    console.error("Customer upsert failed (order still created):", error);
  }
}

function serializeOrder(row: any) {
  return sanitizeJson({
    id: row?.id,
    orderId: row?.id,
    mode: row?.mode,
    channel: row?.channel,
    status: row?.status,
    merchandise: row?.merchandise,
    discount: row?.discount,
    surcharges: row?.surcharges,
    total: row?.total,
    coupon: row?.coupon,
    couponDiscount: row?.couponDiscount,
    customer: row?.customer,
    items: row?.items,
    meta: row?.meta,
    ts: row?.ts,
    planned: row?.planned,
    etaMin: row?.etaMin,
    etaAdjustMin: row?.etaAdjustMin ?? 0,
    driver: row?.driver,
    history: row?.history,
    print: row?.print,
    doneAt: row?.doneAt,
    cancelledAt: row?.cancelledAt,
    archivedAt: row?.archivedAt,
    anonymizedAt: row?.anonymizedAt,
    createdAt: row?.createdAt,
    updatedAt: row?.updatedAt,
  });
}


function pad2(value: number) {
  return String(value).padStart(2, "0");
}

function formatEuro(value: any) {
  return new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: "EUR",
  }).format(toNum(value, 0));
}

function makeEmergencyOrderId(nowMs = Date.now()) {
  const d = new Date(nowMs);
  const stamp = [
    d.getFullYear(),
    pad2(d.getMonth() + 1),
    pad2(d.getDate()),
    "-",
    pad2(d.getHours()),
    pad2(d.getMinutes()),
    pad2(d.getSeconds()),
  ].join("");
  const rnd = Math.random().toString(36).slice(2, 6).toUpperCase();

  return `NF-${stamp}-${rnd}`;
}

function formatEmergencyTelegramText(params: {
  id: string;
  order: any;
  mode: OrderMode;
  items: any[];
  customer: any;
  merchandise: number;
  discount: number;
  surcharges: number;
  coupon: string | null;
  couponDiscount: number;
  total: number;
  reason: string;
  waitMs: number;
}) {
  const {
    id,
    order,
    mode,
    items,
    customer,
    merchandise,
    discount,
    surcharges,
    coupon,
    couponDiscount,
    total,
    reason,
    waitMs,
  } = params;

  const note =
    cleanText(order?.orderNote) ||
    cleanText(order?.note) ||
    cleanText(customer?.deliveryHint) ||
    cleanText(customer?.note) ||
    "-";

  const address =
    cleanText(customer?.addressLine) ||
    cleanText(customer?.address) ||
    [
      [customer?.street, customer?.house].map(cleanText).filter(Boolean).join(" "),
      [customer?.plz || customer?.zip, customer?.city].map(cleanText).filter(Boolean).join(" "),
      [customer?.floor, customer?.entrance].map(cleanText).filter(Boolean).join(" • "),
    ]
      .map(cleanText)
      .filter(Boolean)
      .join(" | ") ||
    "-";

  const itemLines = items.length
    ? items.map((item) => {
        const extras = ensureArr(item?.add)
          .map((extra) => cleanText(extra?.label || extra?.name))
          .filter(Boolean)
          .join(", ");
        const removals = ensureArr(item?.rm)
          .map((entry) => cleanText(entry))
          .filter(Boolean)
          .join(", ");
        const itemNote = cleanText(item?.note);
        const details = [
          extras ? `Extras: ${extras}` : "",
          removals ? `Ohne: ${removals}` : "",
          itemNote ? `Notiz: ${itemNote}` : "",
        ]
          .filter(Boolean)
          .join(" | ");

        return `- ${toNum(item?.qty, 1)}x ${cleanText(item?.name) || "Artikel"}${
          details ? ` (${details})` : ""
        }`;
      })
    : ["- Keine Artikel übermittelt"];

  return [
    "🚨 ACİL MOD SİPARİŞ",
    "",
    reason || "DB bağlantısı kurulamadı.",
    `Bekleme: ${Math.round(waitMs / 1000 / 60)} dakika`,
    "Sipariş DB’ye kaydedilemedi.",
    "",
    `Order: ${id}`,
    `Mod: ${mode === "pickup" ? "Abholung" : "Lieferung"}`,
    `Zahlung: ${normalizePaymentMethod(order) || "cash"} / ${normalizePaymentStatus(order)}`,
    order?.planned ? `Geplant: ${order.planned}` : "Geplant: -",
    "",
    `Ad: ${cleanText(customer?.name) || "-"}`,
    `Telefon: ${cleanText(customer?.phone) || "-"}`,
    `Adresse: ${mode === "delivery" ? address : "Abholung"}`,
    `PLZ: ${cleanText(customer?.plz || customer?.zip || order?.plz) || "-"}`,
    `Not: ${note}`,
    "",
    "Ürünler:",
    ...itemLines,
    "",
    `Warenwert: ${formatEuro(merchandise)}`,
    discount > 0 ? `Rabatt: -${formatEuro(discount)}` : "Rabatt: -",
    coupon ? `Gutschein: ${coupon} (-${formatEuro(couponDiscount)})` : "Gutschein: -",
    surcharges > 0 ? `Aufschläge: ${formatEuro(surcharges)}` : "Aufschläge: -",
    `Toplam: ${formatEuro(total)}`,
    "",
    "ÖNEMLİ: Bu sipariş TV/Admin DB listesinde görünmez. Telegram’dan manuel takip edin.",
  ].join("\n");
}

function readTelegramEnv() {
  return {
    token:
      process.env.TELEGRAM_BOT_TOKEN ||
      process.env.BB_TELEGRAM_BOT_TOKEN ||
      process.env.TELEGRAM_TOKEN ||
      process.env.BOT_TOKEN ||
      "",
    chatId:
      process.env.TELEGRAM_CHAT_ID ||
      process.env.BB_TELEGRAM_CHAT_ID ||
      process.env.TELEGRAM_ORDER_CHAT_ID ||
      process.env.TELEGRAM_ADMIN_CHAT_ID ||
      "",
  };
}

async function sendRawTelegramMessage(text: string) {
  const { token, chatId } = readTelegramEnv();

  if (!token || !chatId) {
    throw new Error("telegram_env_missing");
  }

  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      disable_web_page_preview: true,
    }),
  });

  if (!response.ok) {
    const payload = await response.text().catch(() => "");
    throw new Error(`telegram_http_${response.status}${payload ? `_${payload}` : ""}`);
  }
}

async function sendEmergencyTelegramOrder(params: {
  id: string;
  order: any;
  mode: OrderMode;
  items: any[];
  customer: any;
  merchandise: number;
  discount: number;
  surcharges: number;
  coupon: string | null;
  couponDiscount: number;
  total: number;
  reason: string;
  waitMs: number;
}) {
  const text = formatEmergencyTelegramText(params);

  try {
    await sendRawTelegramMessage(text);
    return "raw";
  } catch (rawError) {
    console.error("Emergency raw Telegram failed, trying helper:", rawError);
  }

  await sendTelegramNewOrder({
    id: params.id,
    mode: params.mode,
    items: [
      {
        name: "🚨 ACİL MOD SİPARİŞ - DB bağlantısı yok",
        qty: 1,
        price: 0,
        note: params.reason,
      },
      ...params.items.map((item: any) => ({
        name: item?.name || "Artikel",
        qty: item?.qty || 1,
        price: item?.price,
        category: item?.category,
        add: Array.isArray(item?.add) ? item.add : undefined,
        rm: Array.isArray(item?.rm) ? item.rm : undefined,
        note: item?.note,
      })),
    ],
    totals: {
      merchandise: params.merchandise,
      discount: params.discount,
      coupon: params.coupon || null,
      couponDiscount: params.couponDiscount,
      surcharges: params.surcharges,
      total: params.total,
    },
    customer: {
      name: params.customer?.name,
      phone: params.customer?.phone,
      address: params.customer?.addressLine || params.customer?.address,
      plz: params.customer?.plz || params.customer?.zip,
      note: `ACİL MOD SİPARİŞ — DB bağlantısı yok. ${params.customer?.deliveryHint || params.customer?.note || ""}`,
    },
    planned: params.order?.planned,
  } as any);

  return "helper";
}

async function handleEmergencyOrder(body: any, order: any) {
  const nowMs = Date.now();
  const id =
    cleanText(body?.emergencyOrderId) ||
    cleanText(order?.meta?.emergencyOrderId) ||
    makeEmergencyOrderId(nowMs);

  const mode = normalizeMode(order?.mode);
  const items = normalizeItems(order);
  const customer = normalizeCustomer(order);
  const computedMerchandise = computeMerchandise(items);
  const merchandise = toNum(order?.merchandise, computedMerchandise);
  const discount = toNum(order?.discount, 0);
  const surcharges = toNum(order?.surcharges, 0);
  const coupon = order?.coupon ? normCouponCode(order.coupon) : null;
  const couponDiscount = toNum(order?.couponDiscount, 0);
  const total = toNum(
    order?.total,
    Math.max(0, merchandise + surcharges - discount - couponDiscount),
  );
  const reason = cleanText(body?.emergencyReason) || "DB bağlantısı kurulamadı.";
  const waitMs = Math.max(0, toNum(body?.emergencyWaitMs, 5 * 60 * 1000));

  const telegramVia = await sendEmergencyTelegramOrder({
    id,
    order,
    mode,
    items,
    customer,
    merchandise,
    discount,
    surcharges,
    coupon,
    couponDiscount,
    total,
    reason,
    waitMs,
  });

  return NextResponse.json(
    {
      ok: true,
      source: "telegram_emergency",
      emergencyMode: true,
      id,
      orderId: id,
      etaMin: null,
      notifySent: true,
      telegramVia,
      message: "Order sent via emergency Telegram fallback.",
    },
    {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate",
      },
    },
  );
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({} as any));
  const order = body?.order && typeof body.order === "object" ? body.order : body;

  if (body?.emergencyMode === true || body?.notfallMode === true) {
    try {
      return await handleEmergencyOrder(body, order);
    } catch (error: any) {
      console.error("❌ emergency order Telegram fallback failed", error);

      return NextResponse.json(
        {
          ok: false,
          source: "telegram_emergency",
          emergencyMode: true,
          error: error?.message || "EMERGENCY_TELEGRAM_FAILED",
          message: "Notfall-Telegram konnte nicht gesendet werden.",
        },
        {
          status: 503,
          headers: {
            "Cache-Control": "no-store, no-cache, must-revalidate",
          },
        },
      );
    }
  }

  try {
    const tenantId = await getTenantId();

    const notify = body?.notify !== false;

    const settings = await getServerSettings().catch(() => ({} as any));

    const idLength = Math.max(4, Number(settings?.orders?.idLength ?? 6) || 6);
    const id = await generateUniqueOrderId(idLength);

    const avgPickup = Math.max(1, Number(settings?.hours?.avgPickupMinutes ?? 15) || 15);
    const avgDelivery = Math.max(1, Number(settings?.hours?.avgDeliveryMinutes ?? 35) || 35);

    const mode = normalizeMode(order?.mode);
    const etaMin =
      mode === "pickup"
        ? avgPickup
        : await computeDeliveryEtaMin(tenantId, avgDelivery);

    const source = normalizeSource(order?.source ?? order?.channel, mode);
    const nowMs = Date.now();

    const items = normalizeItems(order);
    const customer = normalizeCustomer(order);

    const unavailableItems = findUnavailableOrderItems(items, settings, nowMs);
    if (unavailableItems.length) {
      return NextResponse.json(
        {
          ok: false,
          source: "db",
          error: "product_unavailable",
          message: "Einige Artikel sind aktuell nicht verfügbar.",
          unavailableItems,
        },
        {
          status: 409,
          headers: {
            "Cache-Control": "no-store, no-cache, must-revalidate",
          },
        },
      );
    }

    const computedMerchandise = computeMerchandise(items);
    const merchandise = toNum(order?.merchandise, computedMerchandise);
    const discount = toNum(order?.discount, 0);
    const surcharges = toNum(order?.surcharges, 0);

    const coupon = order?.coupon ? normCouponCode(order.coupon) : null;
    const couponDiscount = toNum(order?.couponDiscount, 0);

    const total = toNum(
      order?.total,
      Math.max(0, merchandise + surcharges - discount - couponDiscount),
    );

    const baseMeta = sanitizeJson({
      ...buildOrderMeta({
        order,
        source,
        nowMs,
        coupon,
        couponDiscount,
        orderId: id,
      }),
      suggestedEtaMin: etaMin,
      etaMin,
      finalEtaMin: null,
      acceptedEtaMin: null,
      acceptStatus: "waiting_accept",
      printStatus: "waiting_accept",
    });

    const data: Record<string, any> = {
      id,
      tenantId,
      mode,
      channel: source,
      status: "new",
      merchandise,
      discount,
      surcharges,
      total,
      coupon,
      couponDiscount,
      customer,
      items,
      meta: baseMeta,
      ts: new Date(nowMs),
      planned: order?.planned ?? null,
      etaMin,
    };

    if (hasOrderField("etaAdjustMin")) {
      data.etaAdjustMin = 0;
    }

    if (hasOrderField("history")) {
      data.history = sanitizeJson(baseMeta?.history ?? []);
    }

    if (hasOrderField("driver")) {
      data.driver = sanitizeJson(order?.driver ?? baseMeta?.driver ?? null);
    }

    if (hasOrderField("print")) {
      data.print = sanitizeJson(order?.print ?? baseMeta?.print ?? null);
    }

    const created = await prisma.$transaction(async (tx) => {
      const redeemedIssued = await redeemIssuedCouponIfNeeded({
        tx,
        tenantId,
        coupon,
        customerPhone: customer?.phone,
        orderId: id,
        couponDiscount,
        nowMs,
      });

      const finalMeta = redeemedIssued
        ? markCouponRedeemedInMeta({
            meta: baseMeta,
            issued: redeemedIssued,
            coupon: coupon || "",
            couponDiscount,
            orderId: id,
            nowMs,
          })
        : baseMeta;

      const finalData: Record<string, any> = {
        ...data,
        meta: finalMeta,
      };

      if (hasOrderField("history")) {
        finalData.history = sanitizeJson(ensureObj(finalMeta)?.history ?? []);
      }

      return tx.order.create({
        data: finalData as any,
      });
    });

    await upsertCustomerFromOrder(tenantId, order, total);

    let routeDealActivated: any = null;

    try {
      routeDealActivated = await activateRouteDealIfNeeded({
        settings,
        order,
        customer,
        orderId: id,
        mode,
        nowMs,
      });
    } catch (error) {
      console.error("Route Deal activation failed (order still created):", error);
    }

    let notifySent = false;

    if (notify) {
      try {
        await sendTelegramNewOrder({
          id,
          mode,
          items: items.map((item: any) => ({
            name: item?.name || "Artikel",
            qty: item?.qty || 1,
            price: item?.price,
            category: item?.category,
            add: Array.isArray(item?.add) ? item.add : undefined,
            rm: Array.isArray(item?.rm) ? item.rm : undefined,
            note: item?.note,
          })),
          totals: {
            merchandise,
            discount,
            coupon: coupon || null,
            couponDiscount,
            surcharges,
            total,
          },
          customer: {
            name: customer?.name,
            phone: customer?.phone,
            address: customer?.addressLine || customer?.address,
            plz: customer?.plz || customer?.zip,
            note: customer?.deliveryHint || customer?.note || baseMeta?.note,
          },
          planned: order?.planned,
        } as any);

        notifySent = true;
      } catch (error) {
        console.error("Telegram send failed (order still created):", error);
      }
    }

    const serialized = serializeOrder(created);

    return NextResponse.json(
      {
        ok: true,
        source: "db",
        id,
        orderId: id,
        etaMin,
        notifySent,
        routeDealActivated,
        order: serialized,
        item: serialized,
        data: serialized,
      },
      {
        headers: {
          "Cache-Control": "no-store, no-cache, must-revalidate",
        },
      },
    );
  } catch (error: any) {
    console.error("❌ create order error", error);

    const errorCode = error?.code || error?.message || "bad_request";
    const isCouponError = Boolean(error?.couponError);
    const status = Number(error?.status || (isCouponError ? 409 : 503));

    return NextResponse.json(
      {
        ok: false,
        source: "db",
        error: errorCode,
        message: isCouponError ? mapCouponErrorMessage(errorCode) : errorCode,
        couponError: isCouponError,
      },
      {
        status,
        headers: {
          "Cache-Control": "no-store, no-cache, must-revalidate",
        },
      },
    );
  }
}