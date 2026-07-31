import { NextResponse } from "next/server";
import { prisma, getTenantId } from "@/lib/db";
import {
  getSchnellSettings,
  SCHNELL_COOKIE,
  verifySessionToken,
} from "@/lib/server/schnellbestellung";
import { readRequestCookie } from "@/lib/server/request-security";
import { rewardFromOrderMeta } from "@/lib/server/schnell-rewards";

function objectValue(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, any>)
    : {};
}

function normalizeStatus(value: unknown) {
  const text = String(value || "").toLowerCase().trim();
  if (text === "preparing" || text === "accepted") return "preparing";
  if (text === "ready" || text === "abholbereit") return "ready";
  if (text === "done" || text === "completed" || text === "delivered") {
    return "done";
  }
  if (text === "cancelled" || text === "canceled") return "cancelled";
  return "new";
}

export async function GET(req: Request) {
  const settings = await getSchnellSettings();
  const session = verifySessionToken(
    readRequestCookie(req, SCHNELL_COOKIE),
    settings,
  );

  if (!session) {
    return NextResponse.json(
      { ok: false, error: "session_expired" },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }

  const url = new URL(req.url);
  const orderId = String(url.searchParams.get("order") || "")
    .replace(/[^a-zA-Z0-9_-]/g, "")
    .slice(0, 120);

  if (!orderId) {
    return NextResponse.json(
      { ok: false, error: "order_required" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  const tenantId = await getTenantId();
  const order = await prisma.order.findFirst({
    where: {
      id: orderId,
      tenantId,
      channel: "schnellbestellung",
    },
    select: {
      id: true,
      status: true,
      meta: true,
      ts: true,
    },
  });

  if (!order) {
    return NextResponse.json(
      { ok: false, error: "order_not_found" },
      { status: 404, headers: { "Cache-Control": "no-store" } },
    );
  }

  const meta = objectValue(order.meta);
  const payment = objectValue(meta.payment);
  const paymentMethod = String(
    meta.paymentMethod ?? payment.method ?? "cash",
  )
    .toLowerCase()
    .trim();
  const paymentStatus = String(
    meta.paymentStatus ?? payment.status ?? "pay_at_counter",
  )
    .toLowerCase()
    .trim();
  const paymentOpen =
    paymentMethod === "cash" &&
    !["paid", "bezahlt", "completed", "succeeded"].includes(paymentStatus);

  if (String(meta.deviceId || "") !== String(session.deviceId || "")) {
    return NextResponse.json(
      { ok: false, error: "order_forbidden" },
      { status: 403, headers: { "Cache-Control": "no-store" } },
    );
  }

  return NextResponse.json(
    {
      ok: true,
      orderId: order.id,
      customerNumber: Number(meta.customerNumber || 0),
      status: normalizeStatus(meta.statusManual ?? order.status),
      liveReadyAlertEnabled: settings.liveReadyAlertEnabled,
      readyEventId: String(meta.readyEventId || ""),
      readyEventAt: Number(meta.readyEventAt || 0),
      readyEventSequence: Number(meta.readyEventSequence || 0),
      reward: rewardFromOrderMeta(meta),
      paymentOpen,
      updatedAt: Date.now(),
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
