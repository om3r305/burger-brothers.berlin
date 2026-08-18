import { NextResponse } from "next/server";
import { prisma, getTenantId } from "@/lib/db";
import {
  DRIVER_MESSAGE_COOLDOWN_MS,
  driverMessageTemplate,
} from "@/lib/server/driver-communication";
import { orderAssignedToDriver } from "@/lib/server/driver-order";
import { notifyGeneralOrderMessage } from "@/lib/server/general-push";
import {
  enforceRateLimit,
  getSessionSubject,
  requireMutationRole,
  securityJson,
} from "@/lib/server/request-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ACTIVE_STATUSES = ["new", "preparing", "ready", "out_for_delivery"];
const json = (payload: Record<string, unknown>, status = 200) =>
  NextResponse.json(payload, { status, headers: { "Cache-Control": "no-store" } });

function plainObject(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, any>)
    : {};
}

function toTimestamp(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value;
  }
  if (value instanceof Date && Number.isFinite(value.valueOf())) {
    return value.getTime();
  }
  if (typeof value === "string" && value.trim()) {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) return numeric;
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return Number.POSITIVE_INFINITY;
}

function outForDeliveryStartedAt(order: any) {
  const meta = plainObject(order?.meta);
  const currentStatus = String(meta.statusManual || order?.status || "").toLowerCase();

  // statusUpdatedAt is the latest server-owned transition into the current
  // out_for_delivery state. It correctly handles release -> restart flows.
  if (currentStatus === "out_for_delivery") {
    const latestTransition = toTimestamp(meta.statusUpdatedAt);
    if (Number.isFinite(latestTransition)) return latestTransition;
  }

  const firstDeparture = toTimestamp(meta.outForDeliveryAt);
  if (Number.isFinite(firstDeparture)) return firstDeparture;

  return toTimestamp(order?.updatedAt);
}

function serverCurrentStopId(orders: any[], driverSubject: string) {
  return orders
    .filter((candidate) => orderAssignedToDriver(candidate, driverSubject))
    .sort((left, right) => {
      const byStartedAt = outForDeliveryStartedAt(left) - outForDeliveryStartedAt(right);
      if (Number.isFinite(byStartedAt) && byStartedAt !== 0) return byStartedAt;
      return String(left?.id || "").localeCompare(String(right?.id || ""));
    })[0]?.id || "";
}

export async function POST(req: Request) {
  const authError = await requireMutationRole(req, ["driver"]);
  if (authError) return authError;
  const rateError = await enforceRateLimit(
    req,
    "driver:customer-notification",
    20,
    60_000,
  );
  if (rateError) return rateError;

  const driverSubject = await getSessionSubject(req, "driver");
  if (!driverSubject) {
    return securityJson(
      { ok: false, error: "driver_session_subject_missing" },
      401,
    );
  }

  const body = await req.json().catch(() => ({}));
  const orderId = String(body?.orderId || "")
    .replace(/[^a-zA-Z0-9_-]/g, "")
    .slice(0, 120);
  const tenantId = await getTenantId();
  const order = orderId
    ? await prisma.order.findFirst({ where: { id: orderId, tenantId } })
    : null;

  if (!order) return json({ ok: false, error: "order_not_found" }, 404);
  if (String(order.mode).toLowerCase() !== "delivery") {
    return json({ ok: false, error: "delivery_required" }, 409);
  }
  if (!orderAssignedToDriver(order, driverSubject)) {
    return securityJson(
      { ok: false, error: "order_assigned_to_other_driver" },
      403,
    );
  }
  if (!ACTIVE_STATUSES.includes(String(order.status).toLowerCase())) {
    return json({ ok: false, error: "order_not_operational" }, 409);
  }

  if (body?.kind === "nearby") {
    if (String(order.status).toLowerCase() !== "out_for_delivery") {
      return json({ ok: false, error: "trip_not_started" }, 409);
    }

    /*
     * CURRENT A is determined from server-owned delivery-start timestamps.
     * `startMany` starts A -> B -> C sequentially and the status API persists
     * the status transition time. The browser may still send routeOrderIds for
     * backwards compatibility, but this endpoint never uses that client state
     * as authority.
     */
    const activeOrders = await prisma.order.findMany({
      where: {
        tenantId,
        mode: "delivery",
        status: "out_for_delivery",
      },
    });
    const currentStopId = serverCurrentStopId(activeOrders, driverSubject);

    if (!currentStopId || String(currentStopId) !== String(order.id)) {
      return json({ ok: false, error: "not_current_stop" }, 409);
    }

    const result = await notifyGeneralOrderMessage({
      order,
      type: "order_driver_nearby",
      title: "🚗 Fahrer gleich da!",
      body:
        "Unser Fahrer ist nur noch wenige Minuten entfernt. Bitte halten Sie sich für die Übergabe bereit.",
      dedupeKey: (subscriptionId) =>
        `driver_nearby:${tenantId}:${order.id}:${subscriptionId}`,
      payload: { silent: false },
    });
    return json({ ok: true, ...result });
  }

  const template = driverMessageTemplate(body?.templateId);
  if (!template) return json({ ok: false, error: "invalid_template" }, 400);

  /*
   * Serialize cooldown reservation on the Order row. Two concurrent taps for
   * the same order/template cannot both pass because the second transaction
   * waits for the first row lock and then sees the persisted cooldown marker.
   */
  const reservation = await prisma.$transaction(async (tx: any) => {
    await tx.$queryRaw`
      SELECT "id"
      FROM "Order"
      WHERE "tenantId" = ${tenantId}
        AND "id" = ${String(order.id)}
      FOR UPDATE
    `;

    const lockedOrder = await tx.order.findFirst({
      where: { id: String(order.id), tenantId },
    });

    if (!lockedOrder) {
      return { kind: "error" as const, error: "order_not_found", status: 404 };
    }
    if (String(lockedOrder.mode).toLowerCase() !== "delivery") {
      return { kind: "error" as const, error: "delivery_required", status: 409 };
    }
    if (!orderAssignedToDriver(lockedOrder, driverSubject)) {
      return {
        kind: "security" as const,
        error: "order_assigned_to_other_driver",
        status: 403,
      };
    }
    if (!ACTIVE_STATUSES.includes(String(lockedOrder.status).toLowerCase())) {
      return {
        kind: "error" as const,
        error: "order_not_operational",
        status: 409,
      };
    }

    const now = Date.now();
    const meta = plainObject(lockedOrder.meta);
    const cooldowns = plainObject(meta.driverMessageCooldowns);
    const previousAt = toTimestamp(cooldowns[template.id]);
    const elapsed = Number.isFinite(previousAt) ? now - previousAt : Infinity;

    if (elapsed >= 0 && elapsed < DRIVER_MESSAGE_COOLDOWN_MS) {
      return {
        kind: "cooldown" as const,
        retryAfterMs: Math.max(1, DRIVER_MESSAGE_COOLDOWN_MS - elapsed),
      };
    }

    await tx.order.update({
      where: { id: String(lockedOrder.id) },
      data: {
        meta: {
          ...meta,
          driverMessageCooldowns: {
            ...cooldowns,
            [template.id]: now,
          },
          driverMessageLastAt: now,
          driverMessageLastTemplate: template.id,
        } as any,
      },
    });

    return {
      kind: "reserved" as const,
      order: lockedOrder,
      reservationAt: now,
    };
  });

  if (reservation.kind === "security") {
    return securityJson(
      { ok: false, error: reservation.error },
      reservation.status,
    );
  }
  if (reservation.kind === "error") {
    return json(
      { ok: false, error: reservation.error },
      reservation.status,
    );
  }
  if (reservation.kind === "cooldown") {
    return json(
      {
        ok: false,
        error: "cooldown",
        retryAfterMs: reservation.retryAfterMs,
      },
      429,
    );
  }

  const type = `order_driver_message_${template.id}`;
  const result = await notifyGeneralOrderMessage({
    order: reservation.order,
    type,
    title: template.title,
    body: template.body,
    dedupeKey: (subscriptionId) =>
      `driver_message:${tenantId}:${order.id}:${template.id}:${reservation.reservationAt}:${subscriptionId}`,
    payload: { templateId: template.id, silent: false },
  });

  return json({ ok: true, ...result });
}
