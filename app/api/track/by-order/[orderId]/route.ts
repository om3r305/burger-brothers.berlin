import { NextResponse } from "next/server";
import { prisma, getTenantId } from "@/lib/db";
import {
  enforceRateLimit,
  getSessionSubject,
  hasAnySessionRole,
  securityJson,
} from "@/lib/server/request-security";
import { orderAssignedToDriver } from "@/lib/server/driver-order";
import {
  extractTrackingToken,
  matchesTrackingToken,
  publicTrackingSessionDto,
} from "@/lib/server/public-order";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const headers = {
  "Cache-Control": "no-store, no-cache, must-revalidate",
};

const TRACKING_PUBLIC_TTL_MS = Math.max(
  60 * 60_000,
  Number(process.env.TRACKING_PUBLIC_TTL_HOURS || 72) * 60 * 60_000,
);

function trackingExpired(row: any) {
  const updatedAt = new Date(row?.updatedAt || row?.createdAt || 0).valueOf();
  return !Number.isFinite(updatedAt) || Date.now() - updatedAt > TRACKING_PUBLIC_TTL_MS;
}

function json(payload: any, status = 200) {
  return NextResponse.json(payload, { status, headers });
}

export async function GET(
  req: Request,
  { params }: { params: { orderId: string } },
) {
  const rateError = await enforceRateLimit(req, "tracking:order:read", 60, 60_000);
  if (rateError) return rateError;

  try {
    const tenantId = await getTenantId();
    const orderId = String(params?.orderId || "").trim();
    const privileged = await hasAnySessionRole(req, ["admin", "tv"]);
    const driverSubject = privileged
      ? ""
      : await getSessionSubject(req, "driver");
    const operational = privileged || Boolean(driverSubject);
    const token = extractTrackingToken(req) || (orderId.length >= 32 ? orderId : "");

    let order: any = null;

    if (operational && orderId) {
      order = await prisma.order.findFirst({
        where: { tenantId, id: orderId },
        select: {
          id: true,
          mode: true,
          status: true,
          driver: true,
          meta: true,
        },
      });
    } else if (token) {
      order = await prisma.order.findFirst({
        where: {
          tenantId,
          meta: {
            path: ["trackingToken"],
            equals: token,
          } as any,
        },
        select: { id: true, meta: true },
      });

      if (!order || !matchesTrackingToken(order, token)) {
        return securityJson({ ok: false, error: "invalid_tracking_token" }, 401);
      }
    }

    if (!order?.id) return json({ ok: false, error: "not_found" }, 404);

    if (
      driverSubject &&
      (String(order?.status || "").toLowerCase().startsWith("payment_") ||
        !orderAssignedToDriver(order, driverSubject))
    ) {
      return securityJson(
        { ok: false, error: "order_not_assigned_to_driver" },
        403,
      );
    }

    const row = await prisma.trackingSession.findFirst({
      where: {
        tenantId,
        orderIds: { has: order.id },
        ...(driverSubject ? { driverId: driverSubject } : {}),
      },
      orderBy: { updatedAt: "desc" },
    });

    if (!row) return json({ ok: false, error: "not_found" }, 404);

    if (!operational) {
      if (trackingExpired(row)) {
        return securityJson({ ok: false, error: "tracking_expired" }, 410);
      }

      return json({
        ok: true,
        source: "db",
        session: publicTrackingSessionDto(row),
      });
    }

    return json({
      ok: true,
      source: "db",
      sessionId: row.id,
      session: {
        id: row.id,
        active: row.active,
        driverId: row.driverId || undefined,
        orders: row.orderIds,
        last: row.last || null,
        history: Array.isArray(row.history) ? row.history : [],
        updatedAt: row.updatedAt,
      },
    });
  } catch (error: any) {
    return json({ ok: false, error: error?.message || "TRACKING_LOOKUP_FAILED" }, 500);
  }
}
