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

const ACTIVE_STATUSES = new Set(["new", "preparing", "ready", "out_for_delivery"]);
const json = (payload: Record<string, unknown>, status = 200) =>
  NextResponse.json(payload, { status, headers: { "Cache-Control": "no-store" } });

function plainObject(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, any>)
    : {};
}

function normalizeOrderMode(value: unknown) {
  const text = String(value || "").toLowerCase().trim();
  if (["delivery", "lieferung", "liefern"].includes(text)) return "delivery";
  if (["pickup", "abholung", "abholen", "apollo", "apollon"].includes(text)) {
    return "pickup";
  }
  return text;
}

function normalizeOrderStatus(order: any) {
  const meta = plainObject(order?.meta);
  const text = String(meta.statusManual ?? order?.status ?? "")
    .toLowerCase()
    .trim();

  if (["new", "received", "eingegangen"].includes(text)) return "new";
  if (
    [
      "preparing",
      "prepare",
      "zubereitung",
      "in_vorbereitung",
      "in vorbereitung",
    ].includes(text)
  ) {
    return "preparing";
  }
  if (["ready", "bereit", "abholbereit"].includes(text)) return "ready";
  if (["out_for_delivery", "on_the_way", "unterwegs"].includes(text)) {
    return "out_for_delivery";
  }
  if (["done", "completed", "delivered", "geliefert"].includes(text)) {
    return "done";
  }
  if (["cancelled", "canceled", "storniert"].includes(text)) return "cancelled";
  return text;
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
  const currentStatus = normalizeOrderStatus(order);

  if (currentStatus === "out_for_delivery") {
    const latestTransition = toTimestamp(meta.statusUpdatedAt);
    if (Number.isFinite(latestTransition)) return latestTransition;
  }

  const firstDeparture = toTimestamp(meta.outForDeliveryAt);
  if (Number.isFinite(firstDeparture)) return firstDeparture;

  return toTimestamp(order?.updatedAt);
}

function serverCurrentStopId(orders: any[], driverSubject: string) {
  return (
    orders
      .filter((candidate) => normalizeOrderMode(candidate?.mode) === "delivery")
      .filter((candidate) => normalizeOrderStatus(candidate) === "out_for_delivery")
      .filter((candidate) => orderAssignedToDriver(candidate, driverSubject))
      .sort((left, right) => {
        const byStartedAt =
          outForDeliveryStartedAt(left) - outForDeliveryStartedAt(right);
        if (Number.isFinite(byStartedAt) && byStartedAt !== 0) return byStartedAt;
        return String(left?.id || "").localeCompare(String(right?.id || ""));
      })[0]?.id || ""
  );
}

function safeInternalCode(error: unknown) {
  const raw = error as { code?: unknown; name?: unknown } | null;
  const code = String(raw?.code || raw?.name || "internal_error")
    .replace(/[^a-zA-Z0-9_-]/g, "")
    .slice(0, 80);
  return code || "internal_error";
}

async function clearCooldownReservation(input: {
  tenantId: string;
  orderId: string;
  templateId: string;
  reservationAt: number;
}) {
  await prisma
    .$transaction(async (tx: any) => {
      await tx.$queryRaw`
        SELECT "id"
        FROM "Order"
        WHERE "tenantId" = ${input.tenantId}
          AND "id" = ${input.orderId}
        FOR UPDATE
      `;

      const row = await tx.order.findFirst({
        where: { id: input.orderId, tenantId: input.tenantId },
      });
      if (!row) return;

      const meta = plainObject(row.meta);
      const cooldowns = plainObject(meta.driverMessageCooldowns);
      if (Number(cooldowns[input.templateId]) !== input.reservationAt) return;

      const nextCooldowns = { ...cooldowns };
      delete nextCooldowns[input.templateId];

      await tx.order.update({
        where: { id: String(row.id) },
        data: {
          meta: {
            ...meta,
            driverMessageCooldowns: nextCooldowns,
          } as any,
        },
      });
    })
    .catch((error) => {
      console.error("[driver-notifications] cooldown rollback failed", error);
    });
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

  try {
    const order = orderId
      ? await prisma.order.findFirst({ where: { id: orderId, tenantId } })
      : null;

    if (!order) return json({ ok: false, error: "order_not_found" }, 404);
    if (normalizeOrderMode(order.mode) !== "delivery") {
      return json({ ok: false, error: "delivery_required" }, 409);
    }
    if (!orderAssignedToDriver(order, driverSubject)) {
      return securityJson(
        { ok: false, error: "order_assigned_to_other_driver" },
        403,
      );
    }

    const currentStatus = normalizeOrderStatus(order);
    if (!ACTIVE_STATUSES.has(currentStatus)) {
      return json({ ok: false, error: "order_not_operational" }, 409);
    }

    if (body?.kind === "nearby") {
      if (currentStatus !== "out_for_delivery") {
        return json({ ok: false, error: "trip_not_started" }, 409);
      }

      /*
       * CURRENT A is server-derived. We deliberately do not trust the route
       * ordering sent by the browser. Legacy status/mode aliases are normalized
       * before CURRENT A is selected so old rows cannot silently break pushes.
       */
      const activeOrders = await prisma.order.findMany({
        where: {
          tenantId,
          status: {
            in: ["out_for_delivery", "on_the_way", "unterwegs"],
          },
        },
        take: 100,
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
      if (normalizeOrderMode(lockedOrder.mode) !== "delivery") {
        return { kind: "error" as const, error: "delivery_required", status: 409 };
      }
      if (!orderAssignedToDriver(lockedOrder, driverSubject)) {
        return {
          kind: "security" as const,
          error: "order_assigned_to_other_driver",
          status: 403,
        };
      }
      if (!ACTIVE_STATUSES.has(normalizeOrderStatus(lockedOrder))) {
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

    try {
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

      if (!result.subscriptions) {
        await clearCooldownReservation({
          tenantId,
          orderId: String(order.id),
          templateId: template.id,
          reservationAt: reservation.reservationAt,
        });
      }

      return json({ ok: true, ...result });
    } catch (error) {
      await clearCooldownReservation({
        tenantId,
        orderId: String(order.id),
        templateId: template.id,
        reservationAt: reservation.reservationAt,
      });
      console.error("[driver-notifications] push send failed", error);
      return json(
        {
          ok: false,
          error: "driver_notification_push_failed",
          detailCode: safeInternalCode(error),
        },
        500,
      );
    }
  } catch (error) {
    console.error("[driver-notifications] request failed", error);
    return json(
      {
        ok: false,
        error: "driver_notification_failed",
        detailCode: safeInternalCode(error),
      },
      500,
    );
  }
}
