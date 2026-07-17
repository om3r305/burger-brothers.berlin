// app/api/admin/maintenance/archive-orders/route.ts
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

const DEFAULT_DAYS_OLD = 90;

function jsonResponse(payload: Record<string, any>, status = 200) {
  return NextResponse.json(payload, {
    status,
    headers: NO_STORE_HEADERS,
  });
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

function toNumber(value: any, fallback = 0) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value == null || value === "") return fallback;

  const text = String(value).trim().replace(/[€\s]/g, "").replace(",", ".");
  const number = Number(text);

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

function cutoffFromDays(daysOld: number) {
  const date = new Date();
  date.setDate(date.getDate() - daysOld);
  return date;
}

function parseBool(value: any) {
  const text = String(value || "").toLowerCase().trim();
  return text === "1" || text === "true" || text === "yes" || text === "ja";
}

async function writeCleanupLog(params: {
  tenantId: string;
  status: "success" | "error";
  affectedOrders: number;
  startedAt: Date;
  finishedAt: Date;
  meta?: any;
  error?: string | null;
}) {
  const db = prisma as any;

  try {
    await db.cleanupJobLog.create({
      data: {
        tenantId: params.tenantId,
        jobType: "archive_orders",
        status: params.status,
        affectedOrders: params.affectedOrders,
        affectedCustomers: 0,
        affectedLogs: 0,
        startedAt: params.startedAt,
        finishedAt: params.finishedAt,
        meta: sanitizeJson(params.meta ?? null),
        error: params.error ?? null,
      },
    });
  } catch {
    // Log yazılamazsa ana işlem bozulmasın.
  }
}

async function archiveOrders(params: {
  tenantId: string;
  daysOld: number;
  dryRun: boolean;
  cutoffOverride?: Date | null;
}) {
  const { tenantId, dryRun } = params;
  const daysOld = Math.max(1, Math.trunc(params.daysOld || DEFAULT_DAYS_OLD));
  const cutoff = params.cutoffOverride || cutoffFromDays(daysOld);

  const where: any = {
    tenantId,
    archivedAt: null,
    status: {
      in: ["done", "cancelled"],
    },
    ts: {
      lt: cutoff,
    },
  };

  const candidates = await prisma.order.findMany({
    where,
    orderBy: {
      ts: "asc",
    },
    take: 5000,
    select: {
      id: true,
      status: true,
      mode: true,
      total: true,
      ts: true,
      doneAt: true,
      cancelledAt: true,
      archivedAt: true,
    } as any,
  });

  if (dryRun) {
    return {
      dryRun: true,
      daysOld,
      cutoff,
      matched: candidates.length,
      archived: 0,
      sample: candidates.slice(0, 20).map((order: any) => ({
        id: order.id,
        status: order.status,
        mode: order.mode,
        total:
          order.total instanceof Prisma.Decimal
            ? order.total.toNumber()
            : toNumber(order.total, 0),
        ts: order.ts instanceof Date ? order.ts.toISOString() : order.ts,
      })),
    };
  }

  const now = new Date();

  const updated = await prisma.order.updateMany({
    where,
    data: {
      archivedAt: now,
    } as any,
  });

  return {
    dryRun: false,
    daysOld,
    cutoff,
    matched: candidates.length,
    archived: updated.count,
    archivedAt: now,
  };
}

function parseRequestUrl(req: Request) {
  const url = new URL(req.url);

  const daysOld = Math.max(
    1,
    Math.trunc(toNumber(url.searchParams.get("daysOld") ?? url.searchParams.get("days"), DEFAULT_DAYS_OLD)),
  );

  const dryRun =
    parseBool(url.searchParams.get("dryRun")) ||
    parseBool(url.searchParams.get("preview"));

  const cutoff =
    toDate(url.searchParams.get("cutoff")) ||
    toDate(url.searchParams.get("before")) ||
    null;

  return {
    daysOld,
    dryRun,
    cutoff,
  };
}

export async function GET(req: Request) {
  const authError = await requireSessionRole(req, "admin");
  if (authError) return authError;
  const startedAt = new Date();

  try {
    const tenantId = await getTenantId();
    const parsed = parseRequestUrl(req);

    const result = await archiveOrders({
      tenantId,
      daysOld: parsed.daysOld,
      dryRun: true,
      cutoffOverride: parsed.cutoff,
    });

    const finishedAt = new Date();

    return jsonResponse({
      ok: true,
      source: "db",
      mode: "preview",
      range: {
        daysOld: result.daysOld,
        cutoff: result.cutoff.toISOString(),
      },
      matched: result.matched,
      archived: result.archived,
      sample: result.sample,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
    });
  } catch (error: any) {
    const finishedAt = new Date();

    console.error("[admin/maintenance/archive-orders] GET failed:", error);

    return jsonResponse(
      {
        ok: false,
        source: "db",
        error: error?.message || "ARCHIVE_ORDERS_PREVIEW_FAILED",
        startedAt: startedAt.toISOString(),
        finishedAt: finishedAt.toISOString(),
      },
      500,
    );
  }
}

export async function POST(req: Request) {
  const authError = await requireMutationRole(req, ["admin"]);
  if (authError) return authError;
  const startedAt = new Date();
  let tenantId = "";

  try {
    tenantId = await getTenantId();

    const body = await req.json().catch(() => ({} as any));

    const daysOld = Math.max(
      1,
      Math.trunc(toNumber(body?.daysOld ?? body?.days, DEFAULT_DAYS_OLD)),
    );

    const dryRun = parseBool(body?.dryRun ?? body?.preview);
    const cutoff = toDate(body?.cutoff ?? body?.before);

    const result = await archiveOrders({
      tenantId,
      daysOld,
      dryRun,
      cutoffOverride: cutoff,
    });

    const finishedAt = new Date();

    if (!dryRun) {
      await writeCleanupLog({
        tenantId,
        status: "success",
        affectedOrders: result.archived,
        startedAt,
        finishedAt,
        meta: {
          daysOld: result.daysOld,
          cutoff: result.cutoff.toISOString(),
          matched: result.matched,
          archived: result.archived,
          archivedAt: result.archivedAt?.toISOString?.() ?? null,
        },
      });
    }

    return jsonResponse({
      ok: true,
      source: "db",
      mode: dryRun ? "preview" : "archive",
      range: {
        daysOld: result.daysOld,
        cutoff: result.cutoff.toISOString(),
      },
      matched: result.matched,
      archived: result.archived,
      archivedAt: result.archivedAt?.toISOString?.() ?? null,
      sample: result.sample ?? undefined,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
    });
  } catch (error: any) {
    const finishedAt = new Date();

    console.error("[admin/maintenance/archive-orders] POST failed:", error);

    if (tenantId) {
      await writeCleanupLog({
        tenantId,
        status: "error",
        affectedOrders: 0,
        startedAt,
        finishedAt,
        meta: null,
        error: error?.message || "ARCHIVE_ORDERS_FAILED",
      });
    }

    return jsonResponse(
      {
        ok: false,
        source: "db",
        error: error?.message || "ARCHIVE_ORDERS_FAILED",
        startedAt: startedAt.toISOString(),
        finishedAt: finishedAt.toISOString(),
      },
      500,
    );
  }
}
