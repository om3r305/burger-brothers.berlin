// app/api/admin/backup/import/route.ts
import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma, getTenantId } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type ImportSection =
  | "all"
  | "orders"
  | "products"
  | "settings"
  | "campaigns"
  | "coupons"
  | "customers"
  | "summaries"
  | "brian";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate",
};

function jsonResponse(payload: Record<string, any>, status = 200) {
  return NextResponse.json(sanitizeJson(payload), {
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

function ensureObj(value: any): Record<string, any> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, any>;
  }

  return {};
}

function ensureArr(value: any): any[] {
  return Array.isArray(value) ? value : [];
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

function toNumber(value: any, fallback = 0) {
  if (typeof value === "number" && Number.isFinite(value)) return value;

  if (value instanceof Prisma.Decimal) {
    return value.toNumber();
  }

  if (isDecimalLike(value)) {
    return value.toNumber();
  }

  if (value == null || value === "") return fallback;

  const text = String(value).trim().replace(/[€\s]/g, "").replace(",", ".");
  const n = Number(text);

  return Number.isFinite(n) ? n : fallback;
}

function toBool(value: any, fallback = false) {
  if (typeof value === "boolean") return value;

  const text = String(value || "").toLowerCase().trim();

  if (text === "1" || text === "true" || text === "yes" || text === "ja") return true;
  if (text === "0" || text === "false" || text === "no" || text === "nein") return false;

  return fallback;
}

function cleanText(value: any, fallback = "") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function parseSections(value: any): ImportSection[] {
  if (Array.isArray(value)) {
    const list = value.map((item) => String(item).trim().toLowerCase());
    return normalizeSections(list);
  }

  const text = String(value || "all").trim();

  if (!text || text === "all" || text === "*") {
    return ["all"];
  }

  return normalizeSections(text.split(","));
}

function normalizeSections(list: string[]): ImportSection[] {
  const allowed = new Set<ImportSection>([
    "all",
    "orders",
    "products",
    "settings",
    "campaigns",
    "coupons",
    "customers",
    "summaries",
    "brian",
  ]);

  const sections = list
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
    .filter((item): item is ImportSection => allowed.has(item as ImportSection));

  return sections.length ? sections : ["all"];
}

function hasSection(sections: ImportSection[], section: ImportSection) {
  return sections.includes("all") || sections.includes(section);
}

function stripSystemFields(row: any) {
  const input = ensureObj(row);

  const {
    tenant,
    products,
    campaigns,
    settings,
    coupons,
    orders,
    customers,
    issuedCoupons,
    trackingSessions,
    brianLearnLogs,
    brianRouteModels,
    dailySalesSummaries,
    monthlySalesSummaries,
    backupLogs,
    cleanupJobLogs,
    ...data
  } = input;

  return data;
}

function omitIdTenant<T extends Record<string, any>>(data: T) {
  const { id, tenantId, ...updateData } = data;
  return updateData;
}

function omitTenant<T extends Record<string, any>>(data: T) {
  const { tenantId, ...updateData } = data;
  return updateData;
}

function normalizeProductData(tenantId: string, row: any) {
  const input = stripSystemFields(row);

  const sku = cleanText(input.sku || input.id);
  const name = cleanText(input.name, "Artikel");
  const category = cleanText(input.category, "burger");

  return {
    id: input.id ? String(input.id) : undefined,
    tenantId,
    sku,
    name,
    description: input.description ?? null,
    imageUrl: input.imageUrl ?? null,
    category,
    price: toNumber(input.price, 0),
    active: toBool(input.active, true),
    activeFrom: toDate(input.activeFrom),
    activeTo: toDate(input.activeTo),
    extrasJson: sanitizeJson(input.extrasJson ?? null),
    allergens: sanitizeJson(input.allergens ?? null),
    order: input.order == null ? null : Math.trunc(toNumber(input.order, 0)),
    dailyLimit: input.dailyLimit == null ? null : Math.trunc(toNumber(input.dailyLimit, 0)),
  };
}

function normalizeSettingData(tenantId: string, row: any) {
  const input = stripSystemFields(row);

  return {
    tenantId,
    key: cleanText(input.key),
    value: sanitizeJson(input.value ?? {}),
  };
}

function normalizeCampaignData(tenantId: string, row: any) {
  const input = stripSystemFields(row);

  return {
    id: input.id ? String(input.id) : undefined,
    tenantId,
    code: input.code == null || input.code === "" ? null : String(input.code),
    title: cleanText(input.title, "Kampagne"),
    badgeText: input.badgeText ?? null,
    startsAt: toDate(input.startsAt),
    endsAt: toDate(input.endsAt),
    payload: sanitizeJson(input.payload ?? {}),
  };
}

function normalizeCouponData(tenantId: string, row: any) {
  const input = stripSystemFields(row);

  return {
    id: input.id ? String(input.id) : undefined,
    tenantId,
    code: cleanText(input.code).toUpperCase(),
    definition: sanitizeJson(input.definition ?? {}),
  };
}

function normalizeIssuedCouponData(tenantId: string, row: any) {
  const input = stripSystemFields(row);

  return {
    id: input.id ? String(input.id) : undefined,
    tenantId,
    couponId: cleanText(input.couponId),
    couponCode: cleanText(input.couponCode).toUpperCase(),
    code: cleanText(input.code).toUpperCase(),
    assignedToPhone: input.assignedToPhone ?? null,
    assignedToEmail: input.assignedToEmail ?? null,
    issuedAt: toDate(input.issuedAt) || new Date(),
    expiresAt: toDate(input.expiresAt),
    used: toBool(input.used, false),
    usedAt: toDate(input.usedAt),
    source: input.source ?? null,
    note: input.note ?? null,
  };
}

function normalizeCustomerData(tenantId: string, row: any) {
  const input = stripSystemFields(row);

  return {
    id: input.id ? String(input.id) : undefined,
    tenantId,
    name: cleanText(input.name, "Unbekannt"),
    phone: input.phone ? String(input.phone) : null,
    email: input.email ?? null,
    address: input.address ?? null,
    plz: input.plz ?? null,
    notes: input.notes ?? null,
    vip: toBool(input.vip, false),
    blocked: toBool(input.blocked, false),
    emailOptIn: toBool(input.emailOptIn, false),
    lastOrderAt: toDate(input.lastOrderAt),
    stats: sanitizeJson(input.stats ?? null),
  };
}

function normalizeOrderData(tenantId: string, row: any) {
  const input = stripSystemFields(row);

  const id = cleanText(input.id || input.orderId);
  const total = toNumber(input.total, 0);

  return {
    id,
    tenantId,
    mode: cleanText(input.mode, "delivery"),
    channel: input.channel ?? null,
    status: cleanText(input.status, "new"),
    merchandise: input.merchandise == null ? null : toNumber(input.merchandise, 0),
    discount: input.discount == null ? null : toNumber(input.discount, 0),
    surcharges: input.surcharges == null ? null : toNumber(input.surcharges, 0),
    total,
    coupon: input.coupon ?? null,
    couponDiscount: input.couponDiscount == null ? null : toNumber(input.couponDiscount, 0),
    customer: sanitizeJson(input.customer ?? {}),
    items: sanitizeJson(input.items ?? []),
    meta: sanitizeJson(input.meta ?? null),
    ts: toDate(input.ts) || toDate(input.createdAt) || new Date(),
    planned: input.planned ?? null,
    etaMin: input.etaMin == null ? null : Math.trunc(toNumber(input.etaMin, 0)),
    etaAdjustMin:
      input.etaAdjustMin == null ? null : Math.trunc(toNumber(input.etaAdjustMin, 0)),
    driver: sanitizeJson(input.driver ?? null),
    doneAt: toDate(input.doneAt),
    cancelledAt: toDate(input.cancelledAt),
    archivedAt: toDate(input.archivedAt),
    anonymizedAt: toDate(input.anonymizedAt),
    history: sanitizeJson(input.history ?? null),
    print: sanitizeJson(input.print ?? null),
  };
}

function normalizeDailySummaryData(tenantId: string, row: any) {
  const input = stripSystemFields(row);
  const date = toDate(input.date);

  if (!date) return null;

  return {
    tenantId,
    date,
    orderCount: Math.trunc(toNumber(input.orderCount, 0)),
    pickupCount: Math.trunc(toNumber(input.pickupCount, 0)),
    deliveryCount: Math.trunc(toNumber(input.deliveryCount, 0)),
    cancelledCount: Math.trunc(toNumber(input.cancelledCount, 0)),
    grossSales: toNumber(input.grossSales, 0),
    netSales: toNumber(input.netSales, 0),
    merchandise: toNumber(input.merchandise, 0),
    discounts: toNumber(input.discounts, 0),
    surcharges: toNumber(input.surcharges, 0),
    couponDiscounts: toNumber(input.couponDiscounts, 0),
    cashTotal: toNumber(input.cashTotal, 0),
    onlineTotal: toNumber(input.onlineTotal, 0),
    contactlessTotal: toNumber(input.contactlessTotal, 0),
    splitTotal: toNumber(input.splitTotal, 0),
    topItems: sanitizeJson(input.topItems ?? null),
    byHour: sanitizeJson(input.byHour ?? null),
    byMode: sanitizeJson(input.byMode ?? null),
    byPayment: sanitizeJson(input.byPayment ?? null),
    extra: sanitizeJson(input.extra ?? null),
    generatedAt: toDate(input.generatedAt) || new Date(),
  };
}

function normalizeMonthlySummaryData(tenantId: string, row: any) {
  const input = stripSystemFields(row);

  const year = Math.trunc(toNumber(input.year, 0));
  const month = Math.trunc(toNumber(input.month, 0));

  if (!year || !month) return null;

  return {
    tenantId,
    year,
    month,
    orderCount: Math.trunc(toNumber(input.orderCount, 0)),
    pickupCount: Math.trunc(toNumber(input.pickupCount, 0)),
    deliveryCount: Math.trunc(toNumber(input.deliveryCount, 0)),
    cancelledCount: Math.trunc(toNumber(input.cancelledCount, 0)),
    grossSales: toNumber(input.grossSales, 0),
    netSales: toNumber(input.netSales, 0),
    merchandise: toNumber(input.merchandise, 0),
    discounts: toNumber(input.discounts, 0),
    surcharges: toNumber(input.surcharges, 0),
    couponDiscounts: toNumber(input.couponDiscounts, 0),
    cashTotal: toNumber(input.cashTotal, 0),
    onlineTotal: toNumber(input.onlineTotal, 0),
    contactlessTotal: toNumber(input.contactlessTotal, 0),
    splitTotal: toNumber(input.splitTotal, 0),
    topItems: sanitizeJson(input.topItems ?? null),
    byDay: sanitizeJson(input.byDay ?? null),
    byMode: sanitizeJson(input.byMode ?? null),
    byPayment: sanitizeJson(input.byPayment ?? null),
    extra: sanitizeJson(input.extra ?? null),
    generatedAt: toDate(input.generatedAt) || new Date(),
  };
}

function normalizeBrianLearnLogData(tenantId: string, row: any) {
  const input = stripSystemFields(row);

  return {
    id: input.id ? String(input.id) : undefined,
    tenantId,
    orderId: input.orderId ?? null,
    driverId: input.driverId ?? null,
    driverName: input.driverName ?? null,
    primaryStreet: input.primaryStreet ?? null,
    streets: sanitizeJson(input.streets ?? []),
    peerStreets: sanitizeJson(input.peerStreets ?? null),
    status: input.status ?? null,
    source: input.source ?? null,
    raw: sanitizeJson(input.raw ?? null),
    occurredAt: toDate(input.occurredAt) || new Date(),
  };
}

function normalizeBrianRouteModelData(tenantId: string, row: any) {
  const input = stripSystemFields(row);

  return {
    id: input.id ? String(input.id) : undefined,
    tenantId,
    key: cleanText(input.key, "current"),
    version: Math.trunc(toNumber(input.version, 1)),
    model: sanitizeJson(input.model ?? {}),
    stats: sanitizeJson(input.stats ?? null),
    generatedAt: toDate(input.generatedAt) || new Date(),
  };
}

function getBackupData(body: any) {
  if (body?.backup && typeof body.backup === "object") {
    return body.backup;
  }

  if (body?.data && typeof body.data === "object") {
    return body;
  }

  return body;
}

function getDataSection(backup: any, key: string) {
  const data = ensureObj(backup?.data);
  return ensureArr(data[key]);
}

async function upsertProduct(tx: any, tenantId: string, row: any) {
  const data = normalizeProductData(tenantId, row);
  if (!data.sku) return false;

  const existing = await tx.product.findFirst({
    where: {
      tenantId,
      sku: data.sku,
    },
    select: {
      id: true,
    },
  });

  if (existing?.id) {
    await tx.product.update({
      where: {
        id: existing.id,
      },
      data: omitIdTenant(data),
    });
  } else {
    await tx.product.create({
      data,
    });
  }

  return true;
}

async function upsertSetting(tx: any, tenantId: string, row: any) {
  const data = normalizeSettingData(tenantId, row);
  if (!data.key) return false;

  const existing = await tx.setting.findFirst({
    where: {
      tenantId,
      key: data.key,
    },
    select: {
      id: true,
    },
  });

  if (existing?.id) {
    await tx.setting.update({
      where: {
        id: existing.id,
      },
      data: {
        value: data.value,
      },
    });
  } else {
    await tx.setting.create({
      data,
    });
  }

  return true;
}

async function upsertCampaign(tx: any, tenantId: string, row: any) {
  const data = normalizeCampaignData(tenantId, row);

  let existing: any = null;

  if (data.code) {
    existing = await tx.campaign.findFirst({
      where: {
        tenantId,
        code: data.code,
      },
      select: {
        id: true,
      },
    });
  } else if (data.id) {
    existing = await tx.campaign.findFirst({
      where: {
        tenantId,
        id: data.id,
      },
      select: {
        id: true,
      },
    });
  }

  if (existing?.id) {
    await tx.campaign.update({
      where: {
        id: existing.id,
      },
      data: omitIdTenant(data),
    });
  } else {
    await tx.campaign.create({
      data,
    });
  }

  return true;
}

async function upsertCoupon(tx: any, tenantId: string, row: any) {
  const data = normalizeCouponData(tenantId, row);
  if (!data.code) return false;

  const existing = await tx.coupon.findFirst({
    where: {
      tenantId,
      code: data.code,
    },
    select: {
      id: true,
    },
  });

  if (existing?.id) {
    await tx.coupon.update({
      where: {
        id: existing.id,
      },
      data: omitIdTenant(data),
    });
  } else {
    await tx.coupon.create({
      data,
    });
  }

  return true;
}

async function upsertIssuedCoupon(tx: any, tenantId: string, row: any) {
  const data = normalizeIssuedCouponData(tenantId, row);
  if (!data.code) return false;

  const existing = await tx.issuedCoupon.findFirst({
    where: {
      tenantId,
      code: data.code,
    },
    select: {
      id: true,
    },
  });

  if (existing?.id) {
    await tx.issuedCoupon.update({
      where: {
        id: existing.id,
      },
      data: omitIdTenant(data),
    });
  } else {
    await tx.issuedCoupon.create({
      data,
    });
  }

  return true;
}

async function upsertCustomer(tx: any, tenantId: string, row: any) {
  const data = normalizeCustomerData(tenantId, row);

  let existing: any = null;

  if (data.phone) {
    existing = await tx.customer.findFirst({
      where: {
        tenantId,
        phone: data.phone,
      },
      select: {
        id: true,
      },
    });
  } else if (data.id) {
    existing = await tx.customer.findFirst({
      where: {
        tenantId,
        id: data.id,
      },
      select: {
        id: true,
      },
    });
  }

  if (existing?.id) {
    await tx.customer.update({
      where: {
        id: existing.id,
      },
      data: omitIdTenant(data),
    });
  } else {
    await tx.customer.create({
      data,
    });
  }

  return true;
}

async function upsertOrder(tx: any, tenantId: string, row: any) {
  const data = normalizeOrderData(tenantId, row);
  if (!data.id) return false;

  const existing = await tx.order.findFirst({
    where: {
      tenantId,
      id: data.id,
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
      data: omitIdTenant(data),
    });
  } else {
    await tx.order.create({
      data,
    });
  }

  return true;
}

async function upsertDailySummary(tx: any, tenantId: string, row: any) {
  const data = normalizeDailySummaryData(tenantId, row);
  if (!data) return false;

  const existing = await tx.dailySalesSummary.findFirst({
    where: {
      tenantId,
      date: data.date,
    },
    select: {
      id: true,
    },
  });

  if (existing?.id) {
    await tx.dailySalesSummary.update({
      where: {
        id: existing.id,
      },
      data: omitTenant(data),
    });
  } else {
    await tx.dailySalesSummary.create({
      data,
    });
  }

  return true;
}

async function upsertMonthlySummary(tx: any, tenantId: string, row: any) {
  const data = normalizeMonthlySummaryData(tenantId, row);
  if (!data) return false;

  const existing = await tx.monthlySalesSummary.findFirst({
    where: {
      tenantId,
      year: data.year,
      month: data.month,
    },
    select: {
      id: true,
    },
  });

  if (existing?.id) {
    await tx.monthlySalesSummary.update({
      where: {
        id: existing.id,
      },
      data: omitTenant(data),
    });
  } else {
    await tx.monthlySalesSummary.create({
      data,
    });
  }

  return true;
}

async function upsertBrianLearnLog(tx: any, tenantId: string, row: any) {
  const data = normalizeBrianLearnLogData(tenantId, row);

  let existing: any = null;

  if (data.id) {
    existing = await tx.brianLearnLog.findFirst({
      where: {
        tenantId,
        id: data.id,
      },
      select: {
        id: true,
      },
    });
  }

  if (existing?.id) {
    await tx.brianLearnLog.update({
      where: {
        id: existing.id,
      },
      data: omitIdTenant(data),
    });
  } else {
    await tx.brianLearnLog.create({
      data,
    });
  }

  return true;
}

async function upsertBrianRouteModel(tx: any, tenantId: string, row: any) {
  const data = normalizeBrianRouteModelData(tenantId, row);

  const existing = await tx.brianRouteModel.findFirst({
    where: {
      tenantId,
      key: data.key,
    },
    select: {
      id: true,
    },
  });

  if (existing?.id) {
    await tx.brianRouteModel.update({
      where: {
        id: existing.id,
      },
      data: omitIdTenant(data),
    });
  } else {
    await tx.brianRouteModel.create({
      data,
    });
  }

  return true;
}

function previewCounts(backup: any, sections: ImportSection[]) {
  const counts: Record<string, number> = {};

  if (hasSection(sections, "orders")) {
    counts.orders = getDataSection(backup, "orders").length;
  }

  if (hasSection(sections, "products")) {
    counts.products = getDataSection(backup, "products").length;
  }

  if (hasSection(sections, "settings")) {
    counts.settings = getDataSection(backup, "settings").length;
  }

  if (hasSection(sections, "campaigns")) {
    counts.campaigns = getDataSection(backup, "campaigns").length;
  }

  if (hasSection(sections, "coupons")) {
    counts.coupons = getDataSection(backup, "coupons").length;
    counts.issuedCoupons = getDataSection(backup, "issuedCoupons").length;
  }

  if (hasSection(sections, "customers")) {
    counts.customers = getDataSection(backup, "customers").length;
  }

  if (hasSection(sections, "summaries")) {
    counts.dailySalesSummaries = getDataSection(backup, "dailySalesSummaries").length;
    counts.monthlySalesSummaries = getDataSection(backup, "monthlySalesSummaries").length;
  }

  if (hasSection(sections, "brian")) {
    counts.brianLearnLogs = getDataSection(backup, "brianLearnLogs").length;
    counts.brianRouteModels = getDataSection(backup, "brianRouteModels").length;
  }

  return counts;
}

async function writeBackupLog(params: {
  tenantId: string;
  status: "success" | "error";
  meta: any;
  error?: string | null;
}) {
  const db = prisma as any;

  try {
    await db.backupLog.create({
      data: {
        tenantId: params.tenantId,
        type: "json_import",
        status: params.status,
        fileName: null,
        fileUrl: null,
        sizeBytes: null,
        checksum: null,
        startedAt: new Date(),
        finishedAt: new Date(),
        meta: sanitizeJson(params.meta),
        error: params.error ?? null,
      },
    });
  } catch {
    // Log hatası import işlemini bozmasın.
  }
}

async function runImport(params: {
  tenantId: string;
  backup: any;
  sections: ImportSection[];
}) {
  const { tenantId, backup, sections } = params;

  const result: Record<string, number> = {};

  await prisma.$transaction(
    async (tx: any) => {
      if (hasSection(sections, "products")) {
        result.products = 0;
        for (const row of getDataSection(backup, "products")) {
          if (await upsertProduct(tx, tenantId, row)) result.products += 1;
        }
      }

      if (hasSection(sections, "settings")) {
        result.settings = 0;
        for (const row of getDataSection(backup, "settings")) {
          if (await upsertSetting(tx, tenantId, row)) result.settings += 1;
        }
      }

      if (hasSection(sections, "campaigns")) {
        result.campaigns = 0;
        for (const row of getDataSection(backup, "campaigns")) {
          if (await upsertCampaign(tx, tenantId, row)) result.campaigns += 1;
        }
      }

      if (hasSection(sections, "coupons")) {
        result.coupons = 0;
        for (const row of getDataSection(backup, "coupons")) {
          if (await upsertCoupon(tx, tenantId, row)) result.coupons += 1;
        }

        result.issuedCoupons = 0;
        for (const row of getDataSection(backup, "issuedCoupons")) {
          if (await upsertIssuedCoupon(tx, tenantId, row)) result.issuedCoupons += 1;
        }
      }

      if (hasSection(sections, "customers")) {
        result.customers = 0;
        for (const row of getDataSection(backup, "customers")) {
          if (await upsertCustomer(tx, tenantId, row)) result.customers += 1;
        }
      }

      if (hasSection(sections, "orders")) {
        result.orders = 0;
        for (const row of getDataSection(backup, "orders")) {
          if (await upsertOrder(tx, tenantId, row)) result.orders += 1;
        }
      }

      if (hasSection(sections, "summaries")) {
        result.dailySalesSummaries = 0;
        for (const row of getDataSection(backup, "dailySalesSummaries")) {
          if (await upsertDailySummary(tx, tenantId, row)) {
            result.dailySalesSummaries += 1;
          }
        }

        result.monthlySalesSummaries = 0;
        for (const row of getDataSection(backup, "monthlySalesSummaries")) {
          if (await upsertMonthlySummary(tx, tenantId, row)) {
            result.monthlySalesSummaries += 1;
          }
        }
      }

      if (hasSection(sections, "brian")) {
        result.brianLearnLogs = 0;
        for (const row of getDataSection(backup, "brianLearnLogs")) {
          if (await upsertBrianLearnLog(tx, tenantId, row)) {
            result.brianLearnLogs += 1;
          }
        }

        result.brianRouteModels = 0;
        for (const row of getDataSection(backup, "brianRouteModels")) {
          if (await upsertBrianRouteModel(tx, tenantId, row)) {
            result.brianRouteModels += 1;
          }
        }
      }
    },
    {
      timeout: 30000,
      maxWait: 10000,
    },
  );

  return result;
}

export async function POST(req: Request) {
  let tenantId = "";

  try {
    tenantId = await getTenantId();

    const body = await req.json().catch(() => ({} as any));
    const backup = getBackupData(body);
    const sections = parseSections(body?.sections ?? backup?.sections ?? "all");

    const dryRun = body?.dryRun !== false && body?.confirm !== true;

    if (!backup || typeof backup !== "object") {
      return jsonResponse(
        {
          ok: false,
          source: "db",
          error: "BACKUP_JSON_REQUIRED",
        },
        400,
      );
    }

    const counts = previewCounts(backup, sections);

    if (dryRun) {
      return jsonResponse({
        ok: true,
        source: "db",
        mode: "preview",
        message: "Dry-run: veri yazılmadı. Gerçek import için confirm:true gönder.",
        sections,
        counts,
      });
    }

    const imported = await runImport({
      tenantId,
      backup,
      sections,
    });

    await writeBackupLog({
      tenantId,
      status: "success",
      meta: {
        sections,
        previewCounts: counts,
        imported,
      },
    });

    return jsonResponse({
      ok: true,
      source: "db",
      mode: "import",
      sections,
      previewCounts: counts,
      imported,
    });
  } catch (error: any) {
    console.error("[admin/backup/import] POST failed:", error);

    if (tenantId) {
      await writeBackupLog({
        tenantId,
        status: "error",
        meta: null,
        error: error?.message || "BACKUP_IMPORT_FAILED",
      });
    }

    return jsonResponse(
      {
        ok: false,
        source: "db",
        error: error?.message || "BACKUP_IMPORT_FAILED",
      },
      500,
    );
  }
}

export async function GET() {
  return jsonResponse({
    ok: true,
    source: "db",
    endpoint: "/api/admin/backup/import",
    method: "POST",
    note: "JSON backup import endpoint. Varsayılan dry-run çalışır. Gerçek import için body içine confirm:true ekle.",
    example: {
      dryRunPreview: {
        backup: "{ exported backup json }",
        sections: "products,settings",
      },
      realImport: {
        backup: "{ exported backup json }",
        sections: "products,settings",
        confirm: true,
      },
    },
  });
}