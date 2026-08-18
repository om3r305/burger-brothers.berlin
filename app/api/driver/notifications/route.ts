import { NextResponse } from "next/server";
import { prisma, getTenantId } from "@/lib/db";
import {
  DRIVER_MESSAGE_COOLDOWN_MS,
  currentRouteOrderId,
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

export async function POST(req: Request) {
  const authError = await requireMutationRole(req, ["driver"]);
  if (authError) return authError;
  const rateError = await enforceRateLimit(req, "driver:customer-notification", 20, 60_000);
  if (rateError) return rateError;

  const driverSubject = await getSessionSubject(req, "driver");
  if (!driverSubject) return securityJson({ ok: false, error: "driver_session_subject_missing" }, 401);
  const body = await req.json().catch(() => ({}));
  const orderId = String(body?.orderId || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 120);
  const tenantId = await getTenantId();
  const order = orderId ? await prisma.order.findFirst({ where: { id: orderId, tenantId } }) : null;

  if (!order) return json({ ok: false, error: "order_not_found" }, 404);
  if (String(order.mode).toLowerCase() !== "delivery") return json({ ok: false, error: "delivery_required" }, 409);
  if (!orderAssignedToDriver(order, driverSubject)) return securityJson({ ok: false, error: "order_assigned_to_other_driver" }, 403);
  if (!ACTIVE_STATUSES.includes(String(order.status).toLowerCase())) return json({ ok: false, error: "order_not_operational" }, 409);

  if (body?.kind === "nearby") {
    if (String(order.status).toLowerCase() !== "out_for_delivery") return json({ ok: false, error: "trip_not_started" }, 409);
    const routeIds = Array.isArray(body?.routeOrderIds) ? body.routeOrderIds.map(String).slice(0, 50) : [];
    if (currentRouteOrderId(routeIds) !== order.id) return json({ ok: false, error: "not_current_stop" }, 409);

    const activeOrders = await prisma.order.findMany({ where: { tenantId, mode: "delivery", status: "out_for_delivery" } });
    const assignedIds = activeOrders.filter((candidate) => orderAssignedToDriver(candidate, driverSubject)).map((candidate) => candidate.id);
    if (assignedIds.length !== routeIds.length || assignedIds.some((id) => !routeIds.includes(id))) {
      return json({ ok: false, error: "route_snapshot_stale" }, 409);
    }

    const result = await notifyGeneralOrderMessage({
      order,
      type: "order_driver_nearby",
      title: "🚗 Fahrer gleich da!",
      body: "Unser Fahrer ist nur noch wenige Minuten entfernt. Bitte halten Sie sich für die Übergabe bereit.",
      dedupeKey: (subscriptionId) => `driver_nearby:${tenantId}:${order.id}:${subscriptionId}`,
      payload: { silent: false },
    });
    return json({ ok: true, ...result });
  }

  const template = driverMessageTemplate(body?.templateId);
  if (!template) return json({ ok: false, error: "invalid_template" }, 400);
  const since = new Date(Date.now() - DRIVER_MESSAGE_COOLDOWN_MS);
  const type = `order_driver_message_${template.id}`;
  const recent = await (prisma as any).notificationEvent.findFirst({ where: { tenantId, orderId: order.id, type, createdAt: { gte: since } } });
  if (recent) return json({ ok: false, error: "cooldown", retryAfterMs: DRIVER_MESSAGE_COOLDOWN_MS }, 429);

  const result = await notifyGeneralOrderMessage({
    order,
    type,
    title: template.title,
    body: template.body,
    dedupeKey: (subscriptionId) => `driver_message:${order.id}:${template.id}:${Date.now()}:${subscriptionId}`,
    payload: { templateId: template.id, silent: false },
  });
  return json({ ok: true, ...result });
}
