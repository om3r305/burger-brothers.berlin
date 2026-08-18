import { NextResponse } from "next/server";
import { prisma, getTenantId } from "@/lib/db";
import {
  driverCustomerNotificationEventType,
  notifyGeneralDriverMessage,
  type DriverCustomerNotificationTemplateId,
} from "@/lib/server/general-push";
import {
  enforceRateLimit,
  getSessionSubject,
  hasSessionRole,
  requireMutationRole,
} from "@/lib/server/request-security";
import { orderAssignedToDriver } from "@/lib/server/driver-order";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const MANUAL_COOLDOWN_MS = 45_000;
const ACTIVE_STATUSES = new Set([
  "new",
  "preparing",
  "ready",
  "out_for_delivery",
]);

const TEMPLATE_IDS = new Set<DriverCustomerNotificationTemplateId>([
  "nearby",
  "at_door",
  "phone_unreachable",
  "no_answer",
  "address_unclear",
  "come_to_entrance",
]);

function json(payload: Record<string, unknown>, status = 200) {
  return NextResponse.json(payload, {
    status,
    headers: {
      "Cache-Control": "no-store, no-cache, must-revalidate",
    },
  });
}

function cleanId(value: unknown) {
  return String(value || "")
    .trim()
    .replace(/^#+/, "")
    .replace(/[^a-zA-Z0-9_-]/g, "")
    .slice(0, 120);
}

function plainObject(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, any>)
    : {};
}

function normalizeMode(value: unknown) {
  const text = String(value || "").trim().toLowerCase();
  return ["delivery", "lieferung", "liefern"].includes(text)
    ? "delivery"
    : text;
}

function normalizeStatus(order: any) {
  const meta = plainObject(order?.meta);
  const text = String(meta.statusManual ?? order?.status ?? "")
    .trim()
    .toLowerCase();

  if (["new", "received", "eingegangen"].includes(text)) return "new";
  if (
    [
      "preparing",
      "prepare",
      "preparation",
      "in_preparation",
      "vorbereitung",
      "in_vorbereitung",
      "zubereitung",
    ].includes(text)
  ) {
    return "preparing";
  }
  if (["ready", "prepared", "bereit", "abholbereit", "fertig"].includes(text)) {
    return "ready";
  }
  if (
    ["out_for_delivery", "on_the_way", "underway", "unterwegs"].includes(text)
  ) {
    return "out_for_delivery";
  }
  if (["done", "delivered", "completed", "geliefert"].includes(text)) {
    return "done";
  }
  if (["cancelled", "canceled", "storniert"].includes(text)) {
    return "cancelled";
  }

  return text;
}

function templateId(value: unknown): DriverCustomerNotificationTemplateId | null {
  const candidate = String(value || "").trim() as DriverCustomerNotificationTemplateId;
  return TEMPLATE_IDS.has(candidate) ? candidate : null;
}

export async function POST(req: Request) {
  const authError = await requireMutationRole(req, ["driver", "admin"]);
  if (authError) return authError;

  const isAdmin = await hasSessionRole(req, "admin");
  const driverSubject = isAdmin
    ? ""
    : String((await getSessionSubject(req, "driver")) || "").trim();

  if (!isAdmin && !driverSubject) {
    return json({ ok: false, error: "driver_identity_missing" }, 401);
  }

  const rateError = await enforceRateLimit(
    req,
    "driver:customer-notification",
    60,
    10 * 60_000,
    driverSubject || "admin",
  );
  if (rateError) return rateError;

  const body = await req.json().catch(() => ({}));
  const orderId = cleanId(body?.orderId || body?.id);
  const selectedTemplate = templateId(body?.templateId);

  if (!orderId || !selectedTemplate) {
    return json(
      { ok: false, error: "order_and_template_required" },
      400,
    );
  }

  const tenantId = await getTenantId();
  const order = await prisma.order.findFirst({
    where: { id: orderId, tenantId },
  });

  if (!order) {
    return json({ ok: false, error: "order_not_found" }, 404);
  }

  if (normalizeMode(order.mode) !== "delivery") {
    return json({ ok: false, error: "delivery_required" }, 409);
  }

  if (!isAdmin && !orderAssignedToDriver(order, driverSubject)) {
    return json(
      { ok: false, error: "order_assigned_to_other_driver" },
      403,
    );
  }

  const status = normalizeStatus(order);

  if (!ACTIVE_STATUSES.has(status)) {
    return json({ ok: false, error: "order_not_operational" }, 409);
  }

  if (selectedTemplate === "nearby" && status !== "out_for_delivery") {
    return json({ ok: false, error: "trip_not_started" }, 409);
  }

  if (selectedTemplate !== "nearby") {
    const recent = await (prisma as any).notificationEvent.findFirst({
      where: {
        tenantId,
        orderId: order.id,
        type: driverCustomerNotificationEventType(selectedTemplate),
        createdAt: {
          gte: new Date(Date.now() - MANUAL_COOLDOWN_MS),
        },
      },
      select: { id: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    });

    if (recent) {
      const retryAfterMs = Math.max(
        1_000,
        MANUAL_COOLDOWN_MS -
          (Date.now() - new Date(recent.createdAt).getTime()),
      );

      return json(
        {
          ok: false,
          error: "cooldown",
          retryAfterMs,
        },
        429,
      );
    }
  }

  try {
    const result = await notifyGeneralDriverMessage(order, selectedTemplate);

    return json({
      ok: true,
      templateId: selectedTemplate,
      subscriptions: result.subscriptions,
      accepted: result.accepted,
      queued: result.queued,
      deduped: result.deduped,
    });
  } catch (error) {
    console.error("[orders/notification] push failed", error);
    return json(
      {
        ok: false,
        error: "notification_send_failed",
      },
      500,
    );
  }
}
