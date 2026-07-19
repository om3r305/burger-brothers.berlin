import { NextResponse } from "next/server";
import { prisma, getTenantId } from "@/lib/db";
import {
  enforceRateLimit,
  getSessionSubject,
  hasAnySessionRole,
  hasSessionRole,
  requireMutationRole,
  securityJson,
} from "@/lib/server/request-security";
import {
  extractTrackingToken,
  matchesTrackingToken,
  publicTrackingSessionDto,
} from "@/lib/server/public-order";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate",
};

type TrackingPoint = {
  lat: number;
  lng: number;
  ts: number;
  speed?: number;
  heading?: number;
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
  return NextResponse.json(payload, {
    status,
    headers: NO_STORE_HEADERS,
  });
}

function cleanSessionId(value: any) {
  return String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, "")
    .slice(0, 128);
}

function point(value: any): TrackingPoint | null {
  const lat = Number(value?.lat);
  const lng = Number(value?.lng);
  const speed = Number(value?.speed);
  const heading = Number(value?.heading);

  if (!Number.isFinite(lat) || lat < -90 || lat > 90) return null;
  if (!Number.isFinite(lng) || lng < -180 || lng > 180) return null;

  return {
    lat,
    lng,
    ts: Date.now(),
    ...(Number.isFinite(speed) ? { speed: Math.max(0, speed) } : {}),
    ...(Number.isFinite(heading) ? { heading: ((heading % 360) + 360) % 360 } : {}),
  };
}

function driverIdFromOrder(row: any) {
  const meta = row?.meta && typeof row.meta === "object" ? row.meta : {};
  const driver = row?.driver && typeof row.driver === "object" ? row.driver : meta?.driver || {};
  return String(driver?.id ?? meta?.driverId ?? "").trim();
}

async function tokenCanReadSession(
  tenantId: string,
  orderIds: string[],
  token: string,
) {
  if (!token || !orderIds.length) return false;

  const orders = await prisma.order.findMany({
    where: {
      tenantId,
      id: { in: orderIds.slice(0, 20) },
    },
    select: {
      id: true,
      meta: true,
    },
  });

  return orders.some((order: any) => matchesTrackingToken(order, token));
}

export async function GET(
  req: Request,
  { params }: { params: { session: string } },
) {
  const rateError = await enforceRateLimit(req, "tracking:session:read", 60, 60_000);
  if (rateError) return rateError;

  try {
    const tenantId = await getTenantId();
    const id = cleanSessionId(params?.session);
    if (!id) return json({ ok: false, error: "session_required" }, 400);

    const row = await prisma.trackingSession.findFirst({
      where: { id, tenantId },
    });

    if (!row) return json({ ok: false, error: "not_found" }, 404);

    const privileged = await hasAnySessionRole(req, ["admin", "tv"]);
    const driverSubject = privileged
      ? ""
      : await getSessionSubject(req, "driver");

    if (!privileged && !driverSubject) {
      if (trackingExpired(row)) {
        return securityJson({ ok: false, error: "tracking_expired" }, 410);
      }

      const token = extractTrackingToken(req);
      const allowed = await tokenCanReadSession(tenantId, row.orderIds || [], token);
      if (!allowed) return securityJson({ ok: false, error: "invalid_tracking_token" }, 401);

      return json({
        ok: true,
        source: "db",
        session: publicTrackingSessionDto(row),
      });
    }

    if (
      driverSubject &&
      (!row.driverId || String(row.driverId) !== driverSubject)
    ) {
      return securityJson(
        { ok: false, error: "tracking_session_owned_by_other_driver" },
        403,
      );
    }

    return json({
      ok: true,
      source: "db",
      session: {
        id: row.id,
        active: row.active,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        driverId: row.driverId || undefined,
        orders: row.orderIds,
        last: row.last || null,
        history: Array.isArray(row.history) ? row.history : [],
      },
    });
  } catch (error: any) {
    return json({ ok: false, error: error?.message || "TRACKING_GET_FAILED" }, 500);
  }
}

export async function POST(
  req: Request,
  { params }: { params: { session: string } },
) {
  const authError = await requireMutationRole(req, ["admin", "driver"]);
  if (authError) return authError;

  const rateError = await enforceRateLimit(req, "tracking:session:write", 120, 60_000);
  if (rateError) return rateError;

  try {
    const tenantId = await getTenantId();
    const id = cleanSessionId(params?.session);
    const body = await req.json().catch(() => ({} as any));
    const active = body?.active !== false;
    const location = point(body);
    const isAdmin = await hasSessionRole(req, "admin");
    const driverSubject = isAdmin
      ? ""
      : await getSessionSubject(req, "driver");
    const requestedDriverId = String(body?.driverId || "").trim();
    const driverId = driverSubject || requestedDriverId;

    if (!id) return json({ ok: false, error: "session_required" }, 400);
    if (active && !location) return json({ ok: false, error: "invalid_location" }, 400);
    if (!driverId) return json({ ok: false, error: "driver_required" }, 400);
    if (driverSubject && requestedDriverId && requestedDriverId !== driverSubject) {
      return securityJson({ ok: false, error: "driver_identity_mismatch" }, 403);
    }

    const rawOrderIds: unknown[] = Array.isArray(body?.orderIds)
      ? body.orderIds
      : [];
    const requestedOrderIds: string[] = Array.from(
      new Set<string>(
        rawOrderIds
          .map((value: unknown) => String(value || "").trim())
          .filter((value: string): value is string => value.length > 0),
      ),
    ).slice(0, 20);

    const existing = await prisma.trackingSession.findFirst({
      where: { id, tenantId },
    });

    if (existing?.driverId && existing.driverId !== driverId) {
      return securityJson({ ok: false, error: "tracking_session_owned_by_other_driver" }, 403);
    }

    const candidateOrderIds: string[] = requestedOrderIds.length
      ? requestedOrderIds
      : Array.isArray(existing?.orderIds)
        ? existing.orderIds.filter(
            (value: unknown): value is string =>
              typeof value === "string" && value.length > 0,
          )
        : [];

    if (active && !candidateOrderIds.length) {
      return json({ ok: false, error: "active_orders_required" }, 400);
    }

    if (candidateOrderIds.length) {
      const rows = await prisma.order.findMany({
        where: {
          tenantId,
          id: { in: candidateOrderIds },
          status: { notIn: ["done", "cancelled"] },
        },
        select: {
          id: true,
          mode: true,
          status: true,
          driver: true,
          meta: true,
        },
      });

      if (rows.length !== candidateOrderIds.length) {
        return securityJson({ ok: false, error: "invalid_tracking_orders" }, 403);
      }

      if (
        driverSubject &&
        rows.some(
          (row: any) =>
            String(row.mode || "") !== "delivery" ||
            driverIdFromOrder(row) !== driverSubject,
        )
      ) {
        return securityJson({ ok: false, error: "order_not_assigned_to_driver" }, 403);
      }
    }

    const oldHistory: unknown[] = Array.isArray(existing?.history)
      ? existing.history
      : [];
    const history: unknown[] = location
      ? [...oldHistory, location].slice(-240)
      : oldHistory.slice(-240);

    const saved = await prisma.trackingSession.upsert({
      where: { id },
      update: {
        tenantId,
        active,
        driverId,
        orderIds: candidateOrderIds,
        ...(location
          ? {
              last: location as any,
              history: history as any,
            }
          : {}),
      },
      create: {
        id,
        tenantId,
        active,
        driverId,
        orderIds: candidateOrderIds,
        ...(location ? { last: location as any } : {}),
        history: history as any,
      },
    });

    return json({
      ok: true,
      source: "db",
      session: {
        id: saved.id,
        active: saved.active,
        orders: saved.orderIds,
        updatedAt: saved.updatedAt,
      },
    });
  } catch (error: any) {
    return json({ ok: false, error: error?.message || "TRACKING_POST_FAILED" }, 500);
  }
}
