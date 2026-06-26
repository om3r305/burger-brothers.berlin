// app/api/admin/backup/export/route.ts
import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma, getTenantId } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate",
};

type BackupSection =
  | "all"
  | "orders"
  | "products"
  | "settings"
  | "campaigns"
  | "coupons"
  | "customers"
  | "summaries"
  | "brian";

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

function jsonResponse(payload: Record<string, any>, status = 200) {
  return NextResponse.json(sanitizeJson(payload), {
    status,
    headers: NO_STORE_HEADERS,
  });
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
  if (value == null || value === "") return fallback;

  const text = String(value).trim().replace(/[€\s]/g, "").replace(",", ".");
  const n = Number(text);

  return Number.isFinite(n) ? n : fallback;
}

function parseBool(value: any) {
  const text = String(value || "").toLowerCase().trim();
  return text === "1" || text === "true" || text === "yes" || text === "ja";
}

function parseSections(value: any): BackupSection[] {
  const text = String(value || "all").trim();

  if (!text || text === "all" || text === "*") {
    return ["all"];
  }

  const allowed = new Set<BackupSection>([
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

  const sections = text
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
    .filter((item): item is BackupSection => allowed.has(item as BackupSection));

  return sections.length ? sections : ["all"];
}

function hasSection(sections: BackupSection[], section: BackupSection) {
  return sections.includes("all") || sections.includes(section);
}

function safeFilePart(value: any) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function defaultFromDate() {
  const date = new Date();
  date.setFullYear(date.getFullYear() - 5);
  date.setHours(0, 0, 0, 0);
  return date;
}

function defaultToDate() {
  const date = new Date();
  date.setHours(23, 59, 59, 999);
  return date;
}

function parseRange(url: URL) {
  const from =
    toDate(url.searchParams.get("from")) ||
    toDate(url.searchParams.get("start")) ||
    defaultFromDate();

  const to =
    toDate(url.searchParams.get("to")) ||
    toDate(url.searchParams.get("end")) ||
    defaultToDate();

  return {
    from,
    to,
  };
}

async function getTenantInfo(tenantId: string) {
  const tenant = await prisma.tenant
    .findUnique({
      where: {
        id: tenantId,
      },
      select: {
        id: true,
        slug: true,
        name: true,
        createdAt: true,
        updatedAt: true,
      },
    })
    .catch(() => null);

  return tenant;
}

async function collectOrders(tenantId: string, from: Date, to: Date, includeArchived: boolean) {
  const where: any = {
    tenantId,
    ts: {
      gte: from,
      lte: to,
    },
  };

  if (!includeArchived) {
    where.archivedAt = null;
  }

  return prisma.order.findMany({
    where,
    orderBy: {
      ts: "asc",
    },
  });
}

async function collectProducts(tenantId: string) {
  return prisma.product.findMany({
    where: {
      tenantId,
    },
    orderBy: [
      {
        category: "asc",
      },
      {
        name: "asc",
      },
    ],
  });
}

async function collectSettings(tenantId: string) {
  return prisma.setting.findMany({
    where: {
      tenantId,
    },
    orderBy: {
      key: "asc",
    },
  });
}

async function collectCampaigns(tenantId: string) {
  return prisma.campaign.findMany({
    where: {
      tenantId,
    },
    orderBy: {
      createdAt: "asc",
    },
  });
}

async function collectCoupons(tenantId: string) {
  const issuedCoupons = await prisma.issuedCoupon
    .findMany({
      where: {
        tenantId,
      },
      orderBy: {
        issuedAt: "asc",
      },
    })
    .catch(() => []);

  const coupons = await prisma.coupon
    .findMany({
      where: {
        tenantId,
      },
      orderBy: {
        code: "asc",
      },
    })
    .catch(() => []);

  return {
    coupons,
    issuedCoupons,
  };
}

async function collectCustomers(tenantId: string) {
  return prisma.customer.findMany({
    where: {
      tenantId,
    },
    orderBy: {
      createdAt: "asc",
    },
  });
}

async function collectSummaries(tenantId: string, from: Date, to: Date) {
  const db = prisma as any;

  const daily = await db.dailySalesSummary
    .findMany({
      where: {
        tenantId,
        date: {
          gte: from,
          lte: to,
        },
      },
      orderBy: {
        date: "asc",
      },
    })
    .catch(() => []);

  const fromYear = from.getUTCFullYear();
  const fromMonth = from.getUTCMonth() + 1;
  const toYear = to.getUTCFullYear();
  const toMonth = to.getUTCMonth() + 1;

  const monthly = await db.monthlySalesSummary
    .findMany({
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
    })
    .catch(() => []);

  return {
    daily,
    monthly,
  };
}

async function collectBrian(tenantId: string, from: Date, to: Date) {
  const db = prisma as any;

  const learnLogs = await db.brianLearnLog
    .findMany({
      where: {
        tenantId,
        occurredAt: {
          gte: from,
          lte: to,
        },
      },
      orderBy: {
        occurredAt: "asc",
      },
      take: 20000,
    })
    .catch(() => []);

  const routeModels = await db.brianRouteModel
    .findMany({
      where: {
        tenantId,
      },
      orderBy: {
        generatedAt: "desc",
      },
    })
    .catch(() => []);

  return {
    learnLogs,
    routeModels,
  };
}

async function writeBackupLog(params: {
  tenantId: string;
  fileName: string;
  sizeBytes: number;
  meta: any;
  status: "success" | "error";
  error?: string | null;
}) {
  const db = prisma as any;

  try {
    await db.backupLog.create({
      data: {
        tenantId: params.tenantId,
        type: "json_export",
        status: params.status,
        fileName: params.fileName,
        fileUrl: null,
        sizeBytes: params.sizeBytes,
        checksum: null,
        startedAt: new Date(),
        finishedAt: new Date(),
        meta: sanitizeJson(params.meta),
        error: params.error ?? null,
      },
    });
  } catch {
    // Backup log yazılamazsa export bozulmasın.
  }
}

async function buildBackup(params: {
  tenantId: string;
  sections: BackupSection[];
  from: Date;
  to: Date;
  includeArchived: boolean;
}) {
  const { tenantId, sections, from, to, includeArchived } = params;

  const tenant = await getTenantInfo(tenantId);

  const backup: Record<string, any> = {
    ok: true,
    source: "db",
    format: "burger-brothers-backup-json-v1",
    exportedAt: new Date().toISOString(),
    range: {
      from: from.toISOString(),
      to: to.toISOString(),
      includeArchived,
    },
    sections,
    tenant: sanitizeJson(tenant),
    data: {},
    counts: {},
  };

  if (hasSection(sections, "orders")) {
    const orders = await collectOrders(tenantId, from, to, includeArchived);
    backup.data.orders = sanitizeJson(orders);
    backup.counts.orders = orders.length;
  }

  if (hasSection(sections, "products")) {
    const products = await collectProducts(tenantId);
    backup.data.products = sanitizeJson(products);
    backup.counts.products = products.length;
  }

  if (hasSection(sections, "settings")) {
    const settings = await collectSettings(tenantId);
    backup.data.settings = sanitizeJson(settings);
    backup.counts.settings = settings.length;
  }

  if (hasSection(sections, "campaigns")) {
    const campaigns = await collectCampaigns(tenantId);
    backup.data.campaigns = sanitizeJson(campaigns);
    backup.counts.campaigns = campaigns.length;
  }

  if (hasSection(sections, "coupons")) {
    const coupons = await collectCoupons(tenantId);
    backup.data.coupons = sanitizeJson(coupons.coupons);
    backup.data.issuedCoupons = sanitizeJson(coupons.issuedCoupons);
    backup.counts.coupons = coupons.coupons.length;
    backup.counts.issuedCoupons = coupons.issuedCoupons.length;
  }

  if (hasSection(sections, "customers")) {
    const customers = await collectCustomers(tenantId);
    backup.data.customers = sanitizeJson(customers);
    backup.counts.customers = customers.length;
  }

  if (hasSection(sections, "summaries")) {
    const summaries = await collectSummaries(tenantId, from, to);
    backup.data.dailySalesSummaries = sanitizeJson(summaries.daily);
    backup.data.monthlySalesSummaries = sanitizeJson(summaries.monthly);
    backup.counts.dailySalesSummaries = summaries.daily.length;
    backup.counts.monthlySalesSummaries = summaries.monthly.length;
  }

  if (hasSection(sections, "brian")) {
    const brian = await collectBrian(tenantId, from, to);
    backup.data.brianLearnLogs = sanitizeJson(brian.learnLogs);
    backup.data.brianRouteModels = sanitizeJson(brian.routeModels);
    backup.counts.brianLearnLogs = brian.learnLogs.length;
    backup.counts.brianRouteModels = brian.routeModels.length;
  }

  return sanitizeJson(backup);
}

export async function GET(req: Request) {
  let tenantId = "";

  try {
    tenantId = await getTenantId();

    const url = new URL(req.url);
    const sections = parseSections(url.searchParams.get("sections"));
    const { from, to } = parseRange(url);

    const includeArchived =
      parseBool(url.searchParams.get("includeArchived")) ||
      parseBool(url.searchParams.get("archived"));

    const download = !parseBool(url.searchParams.get("inline"));

    const backup = await buildBackup({
      tenantId,
      sections,
      from,
      to,
      includeArchived,
    });

    const tenantSlug = safeFilePart(backup?.tenant?.slug || "burger-brothers");
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const fileName = `${tenantSlug}-backup-${stamp}.json`;
    const json = JSON.stringify(backup, null, 2);
    const sizeBytes = Buffer.byteLength(json, "utf8");

    await writeBackupLog({
      tenantId,
      fileName,
      sizeBytes,
      status: "success",
      meta: {
        sections,
        from: from.toISOString(),
        to: to.toISOString(),
        includeArchived,
        counts: backup.counts,
      },
    });

    return new NextResponse(json, {
      status: 200,
      headers: {
        ...NO_STORE_HEADERS,
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": download
          ? `attachment; filename="${fileName}"`
          : `inline; filename="${fileName}"`,
      },
    });
  } catch (error: any) {
    console.error("[admin/backup/export] GET failed:", error);

    if (tenantId) {
      await writeBackupLog({
        tenantId,
        fileName: "failed-backup.json",
        sizeBytes: 0,
        status: "error",
        meta: null,
        error: error?.message || "BACKUP_EXPORT_FAILED",
      });
    }

    return jsonResponse(
      {
        ok: false,
        source: "db",
        error: error?.message || "BACKUP_EXPORT_FAILED",
      },
      500,
    );
  }
}

export async function POST(req: Request) {
  let tenantId = "";

  try {
    tenantId = await getTenantId();

    const body = await req.json().catch(() => ({} as any));

    const sections = parseSections(body?.sections);
    const from = toDate(body?.from ?? body?.start) || defaultFromDate();
    const to = toDate(body?.to ?? body?.end) || defaultToDate();
    const includeArchived = parseBool(body?.includeArchived ?? body?.archived);

    const backup = await buildBackup({
      tenantId,
      sections,
      from,
      to,
      includeArchived,
    });

    const tenantSlug = safeFilePart(backup?.tenant?.slug || "burger-brothers");
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const fileName = `${tenantSlug}-backup-${stamp}.json`;
    const json = JSON.stringify(backup, null, 2);
    const sizeBytes = Buffer.byteLength(json, "utf8");

    await writeBackupLog({
      tenantId,
      fileName,
      sizeBytes,
      status: "success",
      meta: {
        sections,
        from: from.toISOString(),
        to: to.toISOString(),
        includeArchived,
        counts: backup.counts,
      },
    });

    return jsonResponse({
      ok: true,
      source: "db",
      fileName,
      sizeBytes,
      backup,
    });
  } catch (error: any) {
    console.error("[admin/backup/export] POST failed:", error);

    if (tenantId) {
      await writeBackupLog({
        tenantId,
        fileName: "failed-backup.json",
        sizeBytes: 0,
        status: "error",
        meta: null,
        error: error?.message || "BACKUP_EXPORT_FAILED",
      });
    }

    return jsonResponse(
      {
        ok: false,
        source: "db",
        error: error?.message || "BACKUP_EXPORT_FAILED",
      },
      500,
    );
  }
}