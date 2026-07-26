import { NextResponse } from "next/server";
import { prisma, getTenantId } from "@/lib/db";
import {
  bindGeneralPushToOrder,
  findGeneralPushSubscriptionForRequest,
} from "@/lib/server/general-push";
import { matchesTrackingToken } from "@/lib/server/public-order";
import {
  enforceRateLimit,
  forbiddenResponse,
  hasTrustedMutationOrigin,
} from "@/lib/server/request-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const HEADERS = { "Cache-Control": "private, no-store" };

function json(payload: Record<string, unknown>, status = 200) {
  return NextResponse.json(payload, { status, headers: HEADERS });
}

function cleanOrderId(value: unknown) {
  return String(value || "")
    .replace(/[^a-zA-Z0-9_-]/g, "")
    .slice(0, 120);
}

export async function POST(req: Request) {
  if (!hasTrustedMutationOrigin(req)) {
    return forbiddenResponse("origin_not_allowed");
  }

  const rate = await enforceRateLimit(req, "push:order:bind", 30, 10 * 60_000);
  if (rate) return rate;

  const tenantId = await getTenantId();
  const subscription = await findGeneralPushSubscriptionForRequest(req, tenantId);
  if (!subscription) {
    return json({ ok: false, error: "not_subscribed" }, 409);
  }

  const body = await req.json().catch(() => ({}));
  const orderId = cleanOrderId(body?.orderId || body?.id);
  const trackingToken = String(body?.trackingToken || body?.token || "").trim();

  if (!orderId || !trackingToken) {
    return json({ ok: false, error: "order_and_token_required" }, 400);
  }

  const order = await prisma.order.findFirst({
    where: { id: orderId, tenantId },
  });

  if (!order || !matchesTrackingToken(order, trackingToken)) {
    return json({ ok: false, error: "invalid_tracking_token" }, 403);
  }

  await bindGeneralPushToOrder(subscription, order);

  return json({
    ok: true,
    bound: true,
    orderId: order.id,
  });
}
