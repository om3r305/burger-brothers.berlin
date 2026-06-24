// app/api/orders/create/route.ts
import { NextResponse } from "next/server";
import { prisma, getTenantId } from "@/lib/db";
import { generateOrderId } from "@/lib/order-id";
import { getServerSettings } from "@/lib/server/settings";
import { sendTelegramNewOrder } from "@/lib/telegram";

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
    history,
    createdBy: source,
    createdAtMs: nowMs,
  });
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
    createdAt: row?.createdAt,
    updatedAt: row?.updatedAt,
  });
}

export async function POST(req: Request) {
  try {
    const tenantId = await getTenantId();
    const body = await req.json().catch(() => ({} as any));
    const order = body?.order && typeof body.order === "object" ? body.order : body;

    const notify = body?.notify !== false;

    const settings = await getServerSettings().catch(() => ({} as any));

    const idLength = Math.max(4, Number(settings?.orders?.idLength ?? 6) || 6);
    const id = await generateUniqueOrderId(idLength);

    const avgPickup = Math.max(1, Number(settings?.hours?.avgPickupMinutes ?? 15) || 15);
    const avgDelivery = Math.max(1, Number(settings?.hours?.avgDeliveryMinutes ?? 35) || 35);

    const mode = normalizeMode(order?.mode);
    const etaMin = mode === "pickup" ? avgPickup : avgDelivery;

    const source = normalizeSource(order?.source ?? order?.channel, mode);
    const nowMs = Date.now();

    const items = normalizeItems(order);
    const customer = normalizeCustomer(order);

    const computedMerchandise = computeMerchandise(items);
    const merchandise = toNum(order?.merchandise, computedMerchandise);
    const discount = toNum(order?.discount, 0);
    const surcharges = toNum(order?.surcharges, 0);

    const coupon = order?.coupon ? cleanText(order.coupon).toUpperCase() : null;
    const couponDiscount = toNum(order?.couponDiscount, 0);

    const total = toNum(
      order?.total,
      Math.max(0, merchandise + surcharges - discount - couponDiscount),
    );

    const meta = buildOrderMeta({
      order,
      source,
      nowMs,
      coupon,
      couponDiscount,
      orderId: id,
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
      meta,
      ts: new Date(nowMs),
      planned: order?.planned ?? null,
      etaMin,
    };

    if (hasOrderField("etaAdjustMin")) {
      data.etaAdjustMin = 0;
    }

    if (hasOrderField("history")) {
      data.history = sanitizeJson(meta?.history ?? []);
    }

    if (hasOrderField("driver")) {
      data.driver = sanitizeJson(order?.driver ?? meta?.driver ?? null);
    }

    if (hasOrderField("print")) {
      data.print = sanitizeJson(order?.print ?? meta?.print ?? null);
    }

    const created = await prisma.order.create({
      data: data as any,
    });

    await upsertCustomerFromOrder(tenantId, order, total);

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
            note: customer?.deliveryHint || customer?.note || meta?.note,
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

    return NextResponse.json(
      {
        ok: false,
        source: "db",
        error: error?.message || "bad_request",
      },
      {
        status: 400,
        headers: {
          "Cache-Control": "no-store, no-cache, must-revalidate",
        },
      },
    );
  }
}