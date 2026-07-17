// app/api/admin/cron/daily-backup/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getTenantId, prisma } from "@/lib/db";
import { secretMatches } from "@/lib/server/request-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type AnyRecord = Record<string, any>;

const DEFAULT_BACKUP_BUCKET = "bb-backups";
const DEFAULT_RETENTION_DAYS = 30;

function jsonResponse(data: AnyRecord, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

function unauthorized() {
  return jsonResponse(
    {
      ok: false,
      error: "UNAUTHORIZED_CRON_REQUEST",
      message: "Bu cron endpoint sadece yetkili otomatik görevler için çalışır.",
    },
    401,
  );
}

function verifyCronRequest(req: NextRequest) {
  const cronSecret = String(process.env.CRON_SECRET || "").trim();

  if (!cronSecret) {
    if (process.env.VERCEL_ENV === "production") {
      return false;
    }

    return true;
  }

  const authHeader = req.headers.get("authorization") || "";
  const bearer = authHeader.replace(/^Bearer\s+/i, "").trim();

  return secretMatches(bearer, cronSecret);
}

function nowStamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function toSafeJson<T>(value: T): T {
  return JSON.parse(
    JSON.stringify(value, (_key, val) => {
      if (typeof val === "bigint") return val.toString();
      return val;
    }),
  ) as T;
}

function toNumber(value: any, fallback = 0) {
  if (value == null || value === "") return fallback;

  if (typeof value === "object" && typeof value.toNumber === "function") {
    const n = value.toNumber();
    return Number.isFinite(n) ? n : fallback;
  }

  const n = Number(String(value).replace(",", "."));
  return Number.isFinite(n) ? n : fallback;
}

function pickNumber(values: any[], fallback = 0) {
  for (const value of values) {
    const n = toNumber(value, Number.NaN);
    if (Number.isFinite(n)) return n;
  }

  return fallback;
}

function asArray(value: any): any[] {
  return Array.isArray(value) ? value : [];
}

function asObject(value: any): AnyRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function dayKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function dayStart(date: Date) {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function monthKey(date: Date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function getOrderDate(order: AnyRecord) {
  const raw =
    order.createdAt ||
    order.ts ||
    order.date ||
    order.created_at ||
    order.meta?.createdAt ||
    order.meta?.ts;

  if (typeof raw === "number") {
    const date = new Date(raw);
    return Number.isFinite(date.valueOf()) ? date : new Date();
  }

  if (typeof raw === "string" || raw instanceof Date) {
    const date = new Date(raw);
    return Number.isFinite(date.valueOf()) ? date : new Date();
  }

  return new Date();
}

function getOrderItems(order: AnyRecord) {
  return asArray(order.items || order.itemsJson || order.cart || order.meta?.items);
}

function getOrderTotals(order: AnyRecord) {
  return asObject(order.totals || order.totalsJson || order.meta?.totals);
}

function getOrderMeta(order: AnyRecord) {
  return asObject(order.meta || order.metaJson);
}

function getOrderPaymentMethod(order: AnyRecord) {
  const meta = getOrderMeta(order);
  const totals = getOrderTotals(order);

  const raw = String(
    order.paymentMethod ||
      meta.paymentMethod ||
      totals.paymentMethod ||
      order.method ||
      "",
  )
    .toLowerCase()
    .trim();

  if (raw.includes("split")) return "split";
  if (raw.includes("online") || raw.includes("stripe") || raw.includes("card")) return "online";
  if (raw.includes("contactless") || raw.includes("terminal")) return "contactless";
  if (raw.includes("cash") || raw.includes("bar")) return "cash";

  return raw || "unknown";
}

function getOrderMode(order: AnyRecord) {
  const raw = String(order.mode || order.type || order.meta?.mode || "").toLowerCase();

  if (raw.includes("delivery") || raw.includes("liefer")) return "delivery";
  if (raw.includes("pickup") || raw.includes("abholung") || raw.includes("apollo")) return "pickup";

  return raw || "unknown";
}

function getOrderStatus(order: AnyRecord) {
  return String(order.status || order.state || "").toLowerCase().trim();
}

function getOrderMoney(order: AnyRecord) {
  const totals = getOrderTotals(order);
  const meta = getOrderMeta(order);

  const total = pickNumber(
    [
      order.total,
      order.grandTotal,
      order.amount,
      totals.total,
      totals.grandTotal,
      totals.amount,
      meta.total,
    ],
    0,
  );

  const merchandise = pickNumber(
    [
      order.merchandise,
      order.subtotal,
      totals.merchandise,
      totals.subtotal,
      totals.itemsTotal,
      meta.merchandise,
    ],
    total,
  );

  const discounts = pickNumber(
    [
      order.discount,
      order.discounts,
      totals.discount,
      totals.discounts,
      totals.discountTotal,
      meta.discount,
    ],
    0,
  );

  const surcharges = pickNumber(
    [
      order.surcharges,
      order.surcharge,
      totals.surcharges,
      totals.surcharge,
      totals.deliveryFee,
      meta.surcharges,
    ],
    0,
  );

  const couponDiscount = pickNumber(
    [
      order.couponDiscount,
      totals.couponDiscount,
      totals.couponDiscountTotal,
      meta.couponDiscount,
    ],
    0,
  );

  return {
    grossSales: total,
    netSales: total,
    merchandise,
    discounts,
    surcharges,
    couponDiscount,
  };
}

function addMoney(target: AnyRecord, money: AnyRecord) {
  target.grossSales += money.grossSales;
  target.netSales += money.netSales;
  target.merchandise += money.merchandise;
  target.discounts += money.discounts;
  target.surcharges += money.surcharges;
  target.couponDiscount += money.couponDiscount;
}

function blankSummaryBucket(date: Date) {
  return {
    date: dayStart(date),
    orderCount: 0,
    pickupCount: 0,
    deliveryCount: 0,
    cancelledCount: 0,
    grossSales: 0,
    netSales: 0,
    merchandise: 0,
    discounts: 0,
    surcharges: 0,
    couponDiscount: 0,
    cashTotal: 0,
    onlineTotal: 0,
    contactlessTotal: 0,
    splitTotal: 0,
    byHour: {} as Record<string, number>,
    byMode: {} as Record<string, number>,
    byPayment: {} as Record<string, number>,
    topItemsMap: new Map<string, AnyRecord>(),
  };
}

function addTopItems(bucket: ReturnType<typeof blankSummaryBucket>, order: AnyRecord) {
  for (const item of getOrderItems(order)) {
    const name = String(item?.name || item?.title || item?.productName || "Unbekannt").trim();
    const sku = String(item?.sku || item?.productId || item?.id || name).trim();
    const category = String(item?.category || item?.cat || "unknown").trim();
    const qty = Math.max(1, Math.trunc(toNumber(item?.qty ?? item?.quantity, 1)));
    const price = toNumber(item?.price ?? item?.unitPrice, 0);
    const revenue = toNumber(item?.total ?? item?.lineTotal, price * qty);

    const key = `${sku}::${name}`;
    const current =
      bucket.topItemsMap.get(key) ||
      ({
        sku,
        name,
        category,
        qty: 0,
        revenue: 0,
      } as AnyRecord);

    current.qty += qty;
    current.revenue += revenue;

    bucket.topItemsMap.set(key, current);
  }
}

function finalizeTopItems(bucket: ReturnType<typeof blankSummaryBucket>) {
  return Array.from(bucket.topItemsMap.values())
    .sort((a, b) => {
      if (b.revenue !== a.revenue) return b.revenue - a.revenue;
      return b.qty - a.qty;
    })
    .slice(0, 25)
    .map((item) => ({
      ...item,
      revenue: Math.round(item.revenue * 100) / 100,
    }));
}

async function rebuildSummaries(tenantId: string, orders: AnyRecord[]) {
  const db = prisma as any;

  if (!db.dailySalesSummary || !db.monthlySalesSummary) {
    return {
      skipped: true,
      reason: "SUMMARY_MODELS_NOT_FOUND",
      orders: orders.length,
      daily: 0,
      monthly: 0,
    };
  }

  const daily = new Map<string, ReturnType<typeof blankSummaryBucket>>();
  const monthly = new Map<string, ReturnType<typeof blankSummaryBucket> & { year: number; month: number }>();

  for (const order of orders) {
    const date = getOrderDate(order);
    const status = getOrderStatus(order);
    const cancelled = status === "cancelled" || status === "canceled";

    const dKey = dayKey(date);
    const mKey = monthKey(date);

    if (!daily.has(dKey)) {
      daily.set(dKey, blankSummaryBucket(date));
    }

    if (!monthly.has(mKey)) {
      monthly.set(mKey, {
        ...blankSummaryBucket(date),
        year: date.getUTCFullYear(),
        month: date.getUTCMonth() + 1,
      });
    }

    const dailyBucket = daily.get(dKey)!;
    const monthlyBucket = monthly.get(mKey)!;

    if (cancelled) {
      dailyBucket.cancelledCount += 1;
      monthlyBucket.cancelledCount += 1;
      continue;
    }

    const mode = getOrderMode(order);
    const payment = getOrderPaymentMethod(order);
    const money = getOrderMoney(order);
    const hour = String(date.getHours()).padStart(2, "0");

    for (const bucket of [dailyBucket, monthlyBucket]) {
      bucket.orderCount += 1;

      if (mode === "pickup") bucket.pickupCount += 1;
      if (mode === "delivery") bucket.deliveryCount += 1;

      bucket.byHour[hour] = (bucket.byHour[hour] || 0) + 1;
      bucket.byMode[mode] = (bucket.byMode[mode] || 0) + 1;
      bucket.byPayment[payment] = (bucket.byPayment[payment] || 0) + 1;

      if (payment === "cash") bucket.cashTotal += money.grossSales;
      if (payment === "online") bucket.onlineTotal += money.grossSales;
      if (payment === "contactless") bucket.contactlessTotal += money.grossSales;
      if (payment === "split") bucket.splitTotal += money.grossSales;

      addMoney(bucket, money);
      addTopItems(bucket, order);
    }
  }

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
        grossSales: bucket.grossSales,
        netSales: bucket.netSales,
        merchandise: bucket.merchandise,
        discounts: bucket.discounts,
        surcharges: bucket.surcharges,
        couponDiscount: bucket.couponDiscount,
        cashTotal: bucket.cashTotal,
        onlineTotal: bucket.onlineTotal,
        contactlessTotal: bucket.contactlessTotal,
        splitTotal: bucket.splitTotal,
        byHour: bucket.byHour,
        byMode: bucket.byMode,
        byPayment: bucket.byPayment,
        topItems: finalizeTopItems(bucket),
      },
      update: {
        orderCount: bucket.orderCount,
        pickupCount: bucket.pickupCount,
        deliveryCount: bucket.deliveryCount,
        cancelledCount: bucket.cancelledCount,
        grossSales: bucket.grossSales,
        netSales: bucket.netSales,
        merchandise: bucket.merchandise,
        discounts: bucket.discounts,
        surcharges: bucket.surcharges,
        couponDiscount: bucket.couponDiscount,
        cashTotal: bucket.cashTotal,
        onlineTotal: bucket.onlineTotal,
        contactlessTotal: bucket.contactlessTotal,
        splitTotal: bucket.splitTotal,
        byHour: bucket.byHour,
        byMode: bucket.byMode,
        byPayment: bucket.byPayment,
        topItems: finalizeTopItems(bucket),
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
        grossSales: bucket.grossSales,
        netSales: bucket.netSales,
        merchandise: bucket.merchandise,
        discounts: bucket.discounts,
        surcharges: bucket.surcharges,
        couponDiscount: bucket.couponDiscount,
        cashTotal: bucket.cashTotal,
        onlineTotal: bucket.onlineTotal,
        contactlessTotal: bucket.contactlessTotal,
        splitTotal: bucket.splitTotal,
        byHour: bucket.byHour,
        byMode: bucket.byMode,
        byPayment: bucket.byPayment,
        topItems: finalizeTopItems(bucket),
      },
      update: {
        orderCount: bucket.orderCount,
        pickupCount: bucket.pickupCount,
        deliveryCount: bucket.deliveryCount,
        cancelledCount: bucket.cancelledCount,
        grossSales: bucket.grossSales,
        netSales: bucket.netSales,
        merchandise: bucket.merchandise,
        discounts: bucket.discounts,
        surcharges: bucket.surcharges,
        couponDiscount: bucket.couponDiscount,
        cashTotal: bucket.cashTotal,
        onlineTotal: bucket.onlineTotal,
        contactlessTotal: bucket.contactlessTotal,
        splitTotal: bucket.splitTotal,
        byHour: bucket.byHour,
        byMode: bucket.byMode,
        byPayment: bucket.byPayment,
        topItems: finalizeTopItems(bucket),
      },
    });
  }

  return {
    skipped: false,
    orders: orders.length,
    daily: daily.size,
    monthly: monthly.size,
  };
}

async function safeFindMany(model: any, args: AnyRecord) {
  if (!model || typeof model.findMany !== "function") return [];

  try {
    return await model.findMany(args);
  } catch {
    return [];
  }
}

async function safeCreateBackupLog(data: AnyRecord) {
  const db = prisma as any;

  if (!db.backupLog || typeof db.backupLog.create !== "function") {
    return null;
  }

  const attempts = [
    data,
    {
      tenantId: data.tenantId,
      type: data.type,
      status: data.status,
      fileName: data.fileName,
      storageBucket: data.storageBucket,
      storagePath: data.storagePath,
      sizeBytes: data.sizeBytes,
      meta: data.meta,
    },
    {
      tenantId: data.tenantId,
      type: data.type,
      status: data.status,
      fileName: data.fileName,
      path: data.storagePath,
      byteSize: data.sizeBytes,
      meta: data.meta,
    },
    {
      tenantId: data.tenantId,
      type: data.type,
      status: data.status,
      meta: data.meta,
    },
  ];

  for (const attempt of attempts) {
    try {
      return await db.backupLog.create({
        data: attempt,
      });
    } catch {}
  }

  return null;
}

async function buildBackupPayload(tenantId: string) {
  const db = prisma as any;

  const [
    tenant,
    orders,
    products,
    campaigns,
    settings,
    coupons,
    issuedCoupons,
    customers,
    dailySalesSummaries,
    monthlySalesSummaries,
    brianLearnLogs,
    brianRouteModels,
  ] = await Promise.all([
    safeFindMany(db.tenant, {
      where: { id: tenantId },
      take: 1,
    }),
    safeFindMany(db.order, {
      where: { tenantId },
      orderBy: [{ createdAt: "asc" }],
    }),
    safeFindMany(db.product, {
      where: { tenantId },
      orderBy: [{ category: "asc" }, { order: "asc" }, { name: "asc" }],
    }),
    safeFindMany(db.campaign, {
      where: { tenantId },
      orderBy: [{ createdAt: "asc" }],
    }),
    safeFindMany(db.setting, {
      where: { tenantId },
      orderBy: [{ createdAt: "asc" }],
    }),
    safeFindMany(db.coupon, {
      where: { tenantId },
      orderBy: [{ createdAt: "asc" }],
    }),
    safeFindMany(db.issuedCoupon, {
      where: { tenantId },
      orderBy: [{ createdAt: "asc" }],
    }),
    safeFindMany(db.customer, {
      where: { tenantId },
      orderBy: [{ createdAt: "asc" }],
    }),
    safeFindMany(db.dailySalesSummary, {
      where: { tenantId },
      orderBy: [{ date: "asc" }],
    }),
    safeFindMany(db.monthlySalesSummary, {
      where: { tenantId },
      orderBy: [{ year: "asc" }, { month: "asc" }],
    }),
    safeFindMany(db.brianLearnLog, {
      where: { tenantId },
      orderBy: [{ createdAt: "asc" }],
    }),
    safeFindMany(db.brianRouteModel, {
      where: { tenantId },
      orderBy: [{ createdAt: "asc" }],
    }),
  ]);

  return toSafeJson({
    ok: true,
    source: "auto-cron",
    version: 1,
    createdAt: new Date().toISOString(),
    tenant: tenant[0] || { id: tenantId },
    counts: {
      orders: orders.length,
      products: products.length,
      campaigns: campaigns.length,
      settings: settings.length,
      coupons: coupons.length,
      issuedCoupons: issuedCoupons.length,
      customers: customers.length,
      dailySalesSummaries: dailySalesSummaries.length,
      monthlySalesSummaries: monthlySalesSummaries.length,
      brianLearnLogs: brianLearnLogs.length,
      brianRouteModels: brianRouteModels.length,
    },
    data: {
      orders,
      products,
      campaigns,
      settings,
      coupons,
      issuedCoupons,
      customers,
      dailySalesSummaries,
      monthlySalesSummaries,
      brianLearnLogs,
      brianRouteModels,
    },
  });
}

async function cleanupOldBackups(params: {
  bucket: string;
  retentionDays: number;
  supabaseUrl: string;
  serviceRoleKey: string;
}) {
  const supabase = createClient(params.supabaseUrl, params.serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  const cutoffMs = Date.now() - params.retentionDays * 24 * 60 * 60 * 1000;

  const listResult = await supabase.storage.from(params.bucket).list("daily", {
    limit: 1000,
    sortBy: {
      column: "name",
      order: "asc",
    },
  });

  if (listResult.error || !Array.isArray(listResult.data)) {
    return {
      ok: false,
      deleted: 0,
      error: listResult.error?.message || "LIST_FAILED",
    };
  }

  const removePaths: string[] = [];

  for (const item of listResult.data) {
    if (!item?.name || item.name === ".emptyFolderPlaceholder") continue;

    const createdAt = item.created_at ? new Date(item.created_at).valueOf() : Number.NaN;
    const updatedAt = item.updated_at ? new Date(item.updated_at).valueOf() : Number.NaN;
    const lastModifiedAt = item.last_accessed_at ? new Date(item.last_accessed_at).valueOf() : Number.NaN;

    const candidateMs = Number.isFinite(createdAt)
      ? createdAt
      : Number.isFinite(updatedAt)
        ? updatedAt
        : Number.isFinite(lastModifiedAt)
          ? lastModifiedAt
          : Number.NaN;

    if (Number.isFinite(candidateMs) && candidateMs < cutoffMs) {
      removePaths.push(`daily/${item.name}`);
    }
  }

  if (removePaths.length === 0) {
    return {
      ok: true,
      deleted: 0,
    };
  }

  const removeResult = await supabase.storage.from(params.bucket).remove(removePaths);

  if (removeResult.error) {
    return {
      ok: false,
      deleted: 0,
      error: removeResult.error.message,
    };
  }

  return {
    ok: true,
    deleted: removePaths.length,
  };
}

export async function GET(req: NextRequest) {
  const startedAt = new Date();

  if (!verifyCronRequest(req)) {
    return unauthorized();
  }

  const supabaseUrl = String(process.env.SUPABASE_URL || "").trim();
  const serviceRoleKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  const bucket = String(process.env.BACKUP_BUCKET || DEFAULT_BACKUP_BUCKET).trim();
  const retentionDays = Math.max(
    1,
    Math.trunc(Number(process.env.BACKUP_RETENTION_DAYS || DEFAULT_RETENTION_DAYS)),
  );

  if (!supabaseUrl || !serviceRoleKey || !bucket) {
    return jsonResponse(
      {
        ok: false,
        error: "MISSING_BACKUP_ENV",
        required: ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "BACKUP_BUCKET"],
        message: "Otomatik yedekleme için gerekli environment değişkenleri eksik.",
      },
      500,
    );
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  let tenantId = "";

  try {
    tenantId = await getTenantId();
  } catch (error: any) {
    return jsonResponse(
      {
        ok: false,
        error: "TENANT_RESOLVE_FAILED",
        detail: error?.message || String(error),
      },
      500,
    );
  }

  const db = prisma as any;
  const trackingRetentionDays = Math.max(
    1,
    Math.trunc(Number(process.env.TRACKING_RETENTION_DAYS || 7)),
  );
  const trackingCutoff = new Date(
    Date.now() - trackingRetentionDays * 24 * 60 * 60 * 1000,
  );
  let trackingCleanup = { deleted: 0, retentionDays: trackingRetentionDays };

  try {
    const cleanup = await db.trackingSession.deleteMany({
      where: {
        tenantId,
        updatedAt: { lt: trackingCutoff },
      },
    });
    trackingCleanup = {
      deleted: Number(cleanup?.count || 0),
      retentionDays: trackingRetentionDays,
    };
  } catch (error) {
    console.warn("[daily-backup] tracking cleanup skipped", error);
  }

  const allOrders = await safeFindMany(db.order, {
    where: { tenantId },
    orderBy: [{ createdAt: "asc" }],
  });

  const summaryResult = await rebuildSummaries(tenantId, allOrders);
  const backupPayload = await buildBackupPayload(tenantId);

  const fileName = `burger-brothers-auto-backup-${nowStamp()}.json`;
  const storagePath = `daily/${fileName}`;
  const jsonText = JSON.stringify(backupPayload, null, 2);
  const sizeBytes = Buffer.byteLength(jsonText, "utf8");

  const uploadResult = await supabase.storage.from(bucket).upload(storagePath, jsonText, {
    contentType: "application/json; charset=utf-8",
    upsert: true,
  });

  if (uploadResult.error) {
    await safeCreateBackupLog({
      tenantId,
      type: "auto_daily_storage",
      status: "failed",
      fileName,
      storageBucket: bucket,
      storagePath,
      sizeBytes,
      meta: {
        error: uploadResult.error.message,
        summary: summaryResult,
        startedAt: startedAt.toISOString(),
        finishedAt: new Date().toISOString(),
      },
    });

    return jsonResponse(
      {
        ok: false,
        error: "SUPABASE_STORAGE_UPLOAD_FAILED",
        detail: uploadResult.error.message,
        bucket,
        storagePath,
      },
      500,
    );
  }

  const cleanupResult = await cleanupOldBackups({
    bucket,
    retentionDays,
    supabaseUrl,
    serviceRoleKey,
  });

  const finishedAt = new Date();

  await safeCreateBackupLog({
    tenantId,
    type: "auto_daily_storage",
    status: "success",
    fileName,
    storageBucket: bucket,
    storagePath,
    sizeBytes,
    meta: {
      bucket,
      storagePath,
      sizeBytes,
      counts: backupPayload.counts,
      summary: summaryResult,
      cleanup: cleanupResult,
      trackingCleanup,
      retentionDays,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs: finishedAt.valueOf() - startedAt.valueOf(),
    },
  });

  return jsonResponse({
    ok: true,
    source: "cron",
    message: "Otomatik günlük yedek başarıyla oluşturuldu.",
    tenantId,
    bucket,
    storagePath,
    fileName,
    sizeBytes,
    counts: backupPayload.counts,
    summary: summaryResult,
    cleanup: cleanupResult,
    trackingCleanup,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.valueOf() - startedAt.valueOf(),
  });
}

export async function POST(req: NextRequest) {
  return GET(req);
}