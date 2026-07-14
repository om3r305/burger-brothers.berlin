// app/api/admin/stats/summary/route.ts
import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma, getTenantId } from "@/lib/db";

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

type SummaryOrder = {
  id: string;
  mode: string;
  channel: string | null;
  status: string;
  merchandise: Prisma.Decimal | number | string | null;
  discount: Prisma.Decimal | number | string | null;
  surcharges: Prisma.Decimal | number | string | null;
  total: Prisma.Decimal | number | string;
  coupon: string | null;
  couponDiscount: Prisma.Decimal | number | string | null;
  customer: any;
  items: any;
  meta: any;
  ts: Date;
  createdAt: Date;
  doneAt?: Date | null;
  cancelledAt?: Date | null;
  archivedAt?: Date | null;
};

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate",
};

function jsonResponse(payload: Record<string, any>, status = 200) {
  return NextResponse.json(payload, {
    status,
    headers: NO_STORE_HEADERS,
  });
}

function isDecimalLike(value: any) {
  return Boolean(
    value &&
      typeof value === "object" &&
      typeof value.toNumber === "function" &&
      typeof value.toString === "function",
  );
}

function toNum(value: any, fallback = 0) {
  if (typeof value === "number" && Number.isFinite(value)) return value;

  if (value instanceof Prisma.Decimal) {
    return value.toNumber();
  }

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

function normalizeStatus(value: any): OrderStatus {
  const text = String(value || "").toLowerCase().trim();

  if (text === "received" || text === "eingegangen") return "new";

  if (
    text === "prepare" ||
    text === "preparing" ||
    text === "zubereitung" ||
    text === "in_vorbereitung" ||
    text === "in vorbereitung"
  ) {
    return "preparing";
  }

  if (text === "ready" || text === "bereit" || text === "abholbereit") return "ready";
  if (text === "on_the_way" || text === "unterwegs") return "out_for_delivery";
  if (text === "delivered" || text === "completed" || text === "geliefert") return "done";
  if (text === "canceled" || text === "cancelled" || text === "storniert") return "cancelled";

  if (
    text === "new" ||
    text === "preparing" ||
    text === "ready" ||
    text === "out_for_delivery" ||
    text === "done" ||
    text === "cancelled"
  ) {
    return text as OrderStatus;
  }

  return "new";
}

function normalizeMode(value: any): "pickup" | "delivery" {
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

function normalizePaymentMethod(order: SummaryOrder) {
  const meta = ensureObj(order.meta);
  const payment = ensureObj(meta.payment);

  const raw =
    meta.paymentMethod ??
    payment.method ??
    meta.paymentType ??
    payment.type ??
    "";

  const text = String(raw || "").toLowerCase().trim();

  if (text === "cash" || text === "bar" || text === "barzahlung") return "cash";
  if (text === "online" || text === "stripe" || text === "card" || text === "karte") return "online";
  if (text === "contactless" || text === "kontaktlos" || text === "terminal") return "contactless";
  if (text === "split" || text === "split_contactless" || text === "getrennt") return "split_contactless";

  return "cash";
}

function normalizeCategory(value: any) {
  const text = String(value || "").toLowerCase().trim();

  if (text.includes("vegan") || text.includes("vegetar")) return "vegan";
  if (text.includes("extra") || text.includes("snack") || text.includes("pommes")) return "extras";
  if (text.includes("sauce") || text.includes("soß") || text.includes("sos")) return "sauces";
  if (text.includes("drink") || text.includes("getränk") || text.includes("getraenke")) return "drinks";
  if (text.includes("hotdog") || text.includes("hot dog") || text.includes("hot-dog")) return "hotdogs";
  if (text.includes("donut") || text.includes("doughnut")) return "donuts";
  if (text.includes("bubble") || text.includes("boba") || text.includes("milk tea")) return "bubbleTea";

  return text || "burger";
}

function startOfUtcDay(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0, 0));
}

function dateKey(date: Date) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function monthKey(date: Date) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function addTopItem(map: Map<string, any>, item: any) {
  const name = String(item?.name || item?.title || "Artikel");
  const category = normalizeCategory(item?.category);
  const sku = item?.sku ? String(item.sku) : item?.id ? String(item.id) : name;
  const key = `${sku}|${category}|${name}`;

  const qty = Math.max(1, toNum(item?.qty ?? item?.quantity ?? 1, 1));
  const base = toNum(item?.price ?? item?.unitPrice, 0);

  const extrasTotal = ensureArr(item?.add ?? item?.extras).reduce(
    (sum, extra) => sum + toNum(extra?.price, 0),
    0,
  );

  const revenue = (base + extrasTotal) * qty;

  const prev = map.get(key) || {
    sku,
    name,
    category,
    qty: 0,
    revenue: 0,
  };

  prev.qty += qty;
  prev.revenue += revenue;

  map.set(key, prev);
}

function mapToTopItems(map: Map<string, any>) {
  return Array.from(map.values())
    .sort((a, b) => b.qty - a.qty || b.revenue - a.revenue || String(a.name).localeCompare(String(b.name)))
    .slice(0, 30)
    .map((item) => ({
      sku: item.sku,
      name: item.name,
      category: item.category,
      qty: item.qty,
      revenue: Number(item.revenue.toFixed(2)),
    }));
}

function emptyDailyBucket(date: Date) {
  return {
    date: startOfUtcDay(date),
    orderCount: 0,
    pickupCount: 0,
    deliveryCount: 0,
    cancelledCount: 0,
    grossSales: 0,
    netSales: 0,
    merchandise: 0,
    discounts: 0,
    surcharges: 0,
    couponDiscounts: 0,
    cashTotal: 0,
    onlineTotal: 0,
    contactlessTotal: 0,
    splitTotal: 0,
    byHour: Array.from({ length: 24 }, () => ({ count: 0, revenue: 0 })),
    byMode: {
      pickup: { count: 0, revenue: 0 },
      delivery: { count: 0, revenue: 0 },
    },
    byPayment: {
      cash: { count: 0, revenue: 0 },
      online: { count: 0, revenue: 0 },
      contactless: { count: 0, revenue: 0 },
      split_contactless: { count: 0, revenue: 0 },
    },
    topItemsMap: new Map<string, any>(),
  };
}

function emptyMonthlyBucket(year: number, month: number) {
  return {
    year,
    month,
    orderCount: 0,
    pickupCount: 0,
    deliveryCount: 0,
    cancelledCount: 0,
    grossSales: 0,
    netSales: 0,
    merchandise: 0,
    discounts: 0,
    surcharges: 0,
    couponDiscounts: 0,
    cashTotal: 0,
    onlineTotal: 0,
    contactlessTotal: 0,
    splitTotal: 0,
    byDay: {} as Record<string, { count: number; revenue: number }>,
    byMode: {
      pickup: { count: 0, revenue: 0 },
      delivery: { count: 0, revenue: 0 },
    },
    byPayment: {
      cash: { count: 0, revenue: 0 },
      online: { count: 0, revenue: 0 },
      contactless: { count: 0, revenue: 0 },
      split_contactless: { count: 0, revenue: 0 },
    },
    topItemsMap: new Map<string, any>(),
  };
}

function addOrderToBuckets(params: {
  order: SummaryOrder;
  daily: Map<string, ReturnType<typeof emptyDailyBucket>>;
  monthly: Map<string, ReturnType<typeof emptyMonthlyBucket>>;
}) {
  const { order, daily, monthly } = params;

  const meta = ensureObj(order.meta);
  const status = normalizeStatus(meta?.statusManual ?? order.status);
  const mode = normalizeMode(order.mode);
  const paymentMethod = normalizePaymentMethod(order);

  const ts = order.ts instanceof Date ? order.ts : new Date(order.ts);
  const dayKey = dateKey(ts);
  const mKey = monthKey(ts);

  const year = ts.getUTCFullYear();
  const month = ts.getUTCMonth() + 1;
  const hour = ts.getUTCHours();

  if (!daily.has(dayKey)) {
    daily.set(dayKey, emptyDailyBucket(ts));
  }

  if (!monthly.has(mKey)) {
    monthly.set(mKey, emptyMonthlyBucket(year, month));
  }

  const d = daily.get(dayKey)!;
  const m = monthly.get(mKey)!;

  const total = toNum(order.total, 0);
  const merchandise = toNum(order.merchandise, 0);
  const discount = toNum(order.discount, 0);
  const surcharges = toNum(order.surcharges, 0);
  const couponDiscount = toNum(order.couponDiscount, 0);

  const isCancelled = status === "cancelled";

  if (isCancelled) {
    d.cancelledCount += 1;
    m.cancelledCount += 1;
    return;
  }

  d.orderCount += 1;
  m.orderCount += 1;

  if (mode === "pickup") {
    d.pickupCount += 1;
    m.pickupCount += 1;
  } else {
    d.deliveryCount += 1;
    m.deliveryCount += 1;
  }

  d.grossSales += total;
  d.netSales += total;
  d.merchandise += merchandise;
  d.discounts += discount;
  d.surcharges += surcharges;
  d.couponDiscounts += couponDiscount;

  m.grossSales += total;
  m.netSales += total;
  m.merchandise += merchandise;
  m.discounts += discount;
  m.surcharges += surcharges;
  m.couponDiscounts += couponDiscount;

  if (paymentMethod === "online") {
    d.onlineTotal += total;
    m.onlineTotal += total;
  } else if (paymentMethod === "contactless") {
    d.contactlessTotal += total;
    m.contactlessTotal += total;
  } else if (paymentMethod === "split_contactless") {
    d.splitTotal += total;
    m.splitTotal += total;
  } else {
    d.cashTotal += total;
    m.cashTotal += total;
  }

  d.byHour[hour].count += 1;
  d.byHour[hour].revenue += total;

  d.byMode[mode].count += 1;
  d.byMode[mode].revenue += total;

  m.byMode[mode].count += 1;
  m.byMode[mode].revenue += total;

  if (!m.byDay[dayKey]) {
    m.byDay[dayKey] = { count: 0, revenue: 0 };
  }

  m.byDay[dayKey].count += 1;
  m.byDay[dayKey].revenue += total;

  const paymentKey =
    paymentMethod === "online" ||
    paymentMethod === "contactless" ||
    paymentMethod === "split_contactless"
      ? paymentMethod
      : "cash";

  d.byPayment[paymentKey].count += 1;
  d.byPayment[paymentKey].revenue += total;

  m.byPayment[paymentKey].count += 1;
  m.byPayment[paymentKey].revenue += total;

  for (const item of ensureArr(order.items)) {
    addTopItem(d.topItemsMap, item);
    addTopItem(m.topItemsMap, item);
  }
}

function roundMoney(value: number) {
  return Number(value.toFixed(2));
}

function cleanHourRows(rows: Array<{ count: number; revenue: number }>) {
  return rows.map((row, hour) => ({
    hour,
    count: row.count,
    revenue: roundMoney(row.revenue),
  }));
}

function cleanModeMap(value: any) {
  return sanitizeJson({
    pickup: {
      count: value?.pickup?.count || 0,
      revenue: roundMoney(value?.pickup?.revenue || 0),
    },
    delivery: {
      count: value?.delivery?.count || 0,
      revenue: roundMoney(value?.delivery?.revenue || 0),
    },
  });
}

function cleanPaymentMap(value: any) {
  return sanitizeJson({
    cash: {
      count: value?.cash?.count || 0,
      revenue: roundMoney(value?.cash?.revenue || 0),
    },
    online: {
      count: value?.online?.count || 0,
      revenue: roundMoney(value?.online?.revenue || 0),
    },
    contactless: {
      count: value?.contactless?.count || 0,
      revenue: roundMoney(value?.contactless?.revenue || 0),
    },
    split_contactless: {
      count: value?.split_contactless?.count || 0,
      revenue: roundMoney(value?.split_contactless?.revenue || 0),
    },
  });
}

function cleanDayMap(value: Record<string, { count: number; revenue: number }>) {
  const out: Record<string, { count: number; revenue: number }> = {};

  for (const [key, row] of Object.entries(value)) {
    out[key] = {
      count: row.count,
      revenue: roundMoney(row.revenue),
    };
  }

  return sanitizeJson(out);
}

async function rebuildSummaries(params: {
  tenantId: string;
  from: Date;
  to: Date;
}) {
  const { tenantId, from, to } = params;

  const rows = await prisma.order.findMany({
    where: {
      tenantId,
      archivedAt: null,
      ts: {
        gte: from,
        lte: to,
      },
    },
    orderBy: {
      ts: "asc",
    },
    select: {
      id: true,
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
      createdAt: true,
      doneAt: true,
      cancelledAt: true,
      archivedAt: true,
    } as any,
  });

  const daily = new Map<string, ReturnType<typeof emptyDailyBucket>>();
  const monthly = new Map<string, ReturnType<typeof emptyMonthlyBucket>>();

  for (const row of rows as any[]) {
    addOrderToBuckets({
      order: row as SummaryOrder,
      daily,
      monthly,
    });
  }

  const db = prisma as any;
  const now = new Date();

  for (const bucket of daily.values()) {
    await db.dailySalesSummary.upsert({
      where: {
        tenantId_date: {
          tenantId,
          date: bucket.date,
        },
      },
      create: {
        tenantId,
        date: bucket.date,
        orderCount: bucket.orderCount,
        pickupCount: bucket.pickupCount,
        deliveryCount: bucket.deliveryCount,
        cancelledCount: bucket.cancelledCount,
        grossSales: roundMoney(bucket.grossSales),
        netSales: roundMoney(bucket.netSales),
        merchandise: roundMoney(bucket.merchandise),
        discounts: roundMoney(bucket.discounts),
        surcharges: roundMoney(bucket.surcharges),
        couponDiscounts: roundMoney(bucket.couponDiscounts),
        cashTotal: roundMoney(bucket.cashTotal),
        onlineTotal: roundMoney(bucket.onlineTotal),
        contactlessTotal: roundMoney(bucket.contactlessTotal),
        splitTotal: roundMoney(bucket.splitTotal),
        topItems: sanitizeJson(mapToTopItems(bucket.topItemsMap)),
        byHour: sanitizeJson(cleanHourRows(bucket.byHour)),
        byMode: cleanModeMap(bucket.byMode),
        byPayment: cleanPaymentMap(bucket.byPayment),
        extra: sanitizeJson({
          source: "orders",
          rebuiltAt: now.toISOString(),
        }),
        generatedAt: now,
      },
      update: {
        orderCount: bucket.orderCount,
        pickupCount: bucket.pickupCount,
        deliveryCount: bucket.deliveryCount,
        cancelledCount: bucket.cancelledCount,
        grossSales: roundMoney(bucket.grossSales),
        netSales: roundMoney(bucket.netSales),
        merchandise: roundMoney(bucket.merchandise),
        discounts: roundMoney(bucket.discounts),
        surcharges: roundMoney(bucket.surcharges),
        couponDiscounts: roundMoney(bucket.couponDiscounts),
        cashTotal: roundMoney(bucket.cashTotal),
        onlineTotal: roundMoney(bucket.onlineTotal),
        contactlessTotal: roundMoney(bucket.contactlessTotal),
        splitTotal: roundMoney(bucket.splitTotal),
        topItems: sanitizeJson(mapToTopItems(bucket.topItemsMap)),
        byHour: sanitizeJson(cleanHourRows(bucket.byHour)),
        byMode: cleanModeMap(bucket.byMode),
        byPayment: cleanPaymentMap(bucket.byPayment),
        extra: sanitizeJson({
          source: "orders",
          rebuiltAt: now.toISOString(),
        }),
        generatedAt: now,
      },
    });
  }

  for (const bucket of monthly.values()) {
    await db.monthlySalesSummary.upsert({
      where: {
        tenantId_year_month: {
          tenantId,
          year: bucket.year,
          month: bucket.month,
        },
      },
      create: {
        tenantId,
        year: bucket.year,
        month: bucket.month,
        orderCount: bucket.orderCount,
        pickupCount: bucket.pickupCount,
        deliveryCount: bucket.deliveryCount,
        cancelledCount: bucket.cancelledCount,
        grossSales: roundMoney(bucket.grossSales),
        netSales: roundMoney(bucket.netSales),
        merchandise: roundMoney(bucket.merchandise),
        discounts: roundMoney(bucket.discounts),
        surcharges: roundMoney(bucket.surcharges),
        couponDiscounts: roundMoney(bucket.couponDiscounts),
        cashTotal: roundMoney(bucket.cashTotal),
        onlineTotal: roundMoney(bucket.onlineTotal),
        contactlessTotal: roundMoney(bucket.contactlessTotal),
        splitTotal: roundMoney(bucket.splitTotal),
        topItems: sanitizeJson(mapToTopItems(bucket.topItemsMap)),
        byDay: cleanDayMap(bucket.byDay),
        byMode: cleanModeMap(bucket.byMode),
        byPayment: cleanPaymentMap(bucket.byPayment),
        extra: sanitizeJson({
          source: "orders",
          rebuiltAt: now.toISOString(),
        }),
        generatedAt: now,
      },
      update: {
        orderCount: bucket.orderCount,
        pickupCount: bucket.pickupCount,
        deliveryCount: bucket.deliveryCount,
        cancelledCount: bucket.cancelledCount,
        grossSales: roundMoney(bucket.grossSales),
        netSales: roundMoney(bucket.netSales),
        merchandise: roundMoney(bucket.merchandise),
        discounts: roundMoney(bucket.discounts),
        surcharges: roundMoney(bucket.surcharges),
        couponDiscounts: roundMoney(bucket.couponDiscounts),
        cashTotal: roundMoney(bucket.cashTotal),
        onlineTotal: roundMoney(bucket.onlineTotal),
        contactlessTotal: roundMoney(bucket.contactlessTotal),
        splitTotal: roundMoney(bucket.splitTotal),
        topItems: sanitizeJson(mapToTopItems(bucket.topItemsMap)),
        byDay: cleanDayMap(bucket.byDay),
        byMode: cleanModeMap(bucket.byMode),
        byPayment: cleanPaymentMap(bucket.byPayment),
        extra: sanitizeJson({
          source: "orders",
          rebuiltAt: now.toISOString(),
        }),
        generatedAt: now,
      },
    });
  }

  await db.cleanupJobLog.create({
    data: {
      tenantId,
      jobType: "rebuild_sales_summaries",
      status: "success",
      affectedOrders: rows.length,
      affectedLogs: daily.size + monthly.size,
      startedAt: now,
      finishedAt: new Date(),
      meta: sanitizeJson({
        from: from.toISOString(),
        to: to.toISOString(),
        dailyCount: daily.size,
        monthlyCount: monthly.size,
      }),
    },
  }).catch(() => null);

  return {
    orders: rows.length,
    daily: daily.size,
    monthly: monthly.size,
  };
}

async function readSummaries(params: {
  tenantId: string;
  from: Date;
  to: Date;
}) {
  const { tenantId, from, to } = params;
  const db = prisma as any;

  const daily = await db.dailySalesSummary.findMany({
    where: {
      tenantId,
      date: {
        gte: startOfUtcDay(from),
        lte: startOfUtcDay(to),
      },
    },
    orderBy: {
      date: "asc",
    },
  });

  const fromYear = from.getUTCFullYear();
  const fromMonth = from.getUTCMonth() + 1;
  const toYear = to.getUTCFullYear();
  const toMonth = to.getUTCMonth() + 1;

  const monthly = await db.monthlySalesSummary.findMany({
    where: {
      tenantId,
      OR: [
        {
          year: {
            gt: fromYear,
            lt: toYear,
          },
        },
        {
          year: fromYear,
          month: {
            gte: fromMonth,
          },
        },
        {
          year: toYear,
          month: {
            lte: toMonth,
          },
        },
      ],
    },
    orderBy: [
      {
        year: "asc",
      },
      {
        month: "asc",
      },
    ],
  });

  return {
    daily: sanitizeJson(daily),
    monthly: sanitizeJson(monthly),
  };
}

function defaultRange() {
  const now = new Date();
  const from = new Date(now.getTime() - 30 * 86400000);
  from.setUTCHours(0, 0, 0, 0);

  const to = new Date(now);
  to.setUTCHours(23, 59, 59, 999);

  return { from, to };
}

function parseRange(req: Request) {
  const url = new URL(req.url);
  const defaults = defaultRange();

  const from =
    toDate(url.searchParams.get("from")) ||
    toDate(url.searchParams.get("start")) ||
    defaults.from;

  const to =
    toDate(url.searchParams.get("to")) ||
    toDate(url.searchParams.get("end")) ||
    defaults.to;

  return {
    from,
    to,
  };
}

export async function GET(req: Request) {
  try {
    const tenantId = await getTenantId();
    const { from, to } = parseRange(req);
    const url = new URL(req.url);

    const rebuild =
      url.searchParams.get("rebuild") === "1" ||
      url.searchParams.get("refresh") === "1";

    let rebuilt: any = null;

    if (rebuild) {
      rebuilt = await rebuildSummaries({
        tenantId,
        from,
        to,
      });
    }

    const summaries = await readSummaries({
      tenantId,
      from,
      to,
    });

    return jsonResponse({
      ok: true,
      source: "db",
      range: {
        from: from.toISOString(),
        to: to.toISOString(),
      },
      rebuilt,
      daily: summaries.daily,
      monthly: summaries.monthly,
    });
  } catch (error: any) {
    console.error("[admin/stats/summary] GET failed:", error);

    return jsonResponse(
      {
        ok: false,
        source: "db",
        error: error?.message || "STATS_SUMMARY_GET_FAILED",
      },
      500,
    );
  }
}

export async function POST(req: Request) {
  try {
    const tenantId = await getTenantId();
    const body = await req.json().catch(() => ({} as any));
    const defaults = defaultRange();

    const from = toDate(body?.from ?? body?.start) || defaults.from;
    const to = toDate(body?.to ?? body?.end) || defaults.to;

    const rebuilt = await rebuildSummaries({
      tenantId,
      from,
      to,
    });

    const summaries = await readSummaries({
      tenantId,
      from,
      to,
    });

    return jsonResponse({
      ok: true,
      source: "db",
      range: {
        from: from.toISOString(),
        to: to.toISOString(),
      },
      rebuilt,
      daily: summaries.daily,
      monthly: summaries.monthly,
    });
  } catch (error: any) {
    console.error("[admin/stats/summary] POST failed:", error);

    return jsonResponse(
      {
        ok: false,
        source: "db",
        error: error?.message || "STATS_SUMMARY_POST_FAILED",
      },
      500,
    );
  }
}