import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { prisma, getTenantId } from "@/lib/db";
import {
  getSchnellSettings,
  SCHNELL_COOKIE,
  verifySessionToken,
} from "@/lib/server/schnellbestellung";
import {
  getSchnellPushConfig,
  normalizeSchnellPushSubscription,
} from "@/lib/server/schnell-push";
import {
  enforceRateLimit,
  forbiddenResponse,
  hasTrustedMutationOrigin,
  readRequestCookie,
} from "@/lib/server/request-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const NO_STORE_HEADERS = { "Cache-Control": "private, no-store" };

function objectValue(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, any>)
    : {};
}

function cleanOrderId(value: unknown) {
  return String(value || "")
    .replace(/[^a-zA-Z0-9_-]/g, "")
    .slice(0, 120);
}

function sessionForRequest(req: Request, settings: Awaited<ReturnType<typeof getSchnellSettings>>) {
  return verifySessionToken(readRequestCookie(req, SCHNELL_COOKIE), settings);
}

export async function GET(req: Request) {
  const rate = await enforceRateLimit(req, "schnell:push:get", 60, 10 * 60_000);
  if (rate) return rate;

  const settings = await getSchnellSettings();
  const session = sessionForRequest(req, settings);
  if (!session) {
    return NextResponse.json(
      { ok: false, error: "session_expired" },
      { status: 401, headers: NO_STORE_HEADERS },
    );
  }

  const config = getSchnellPushConfig();
  const url = new URL(req.url);
  const pending = url.searchParams.get("pending") === "1";

  if (!pending) {
    return NextResponse.json(
      {
        ok: true,
        enabled: settings.backgroundReadyPushEnabled,
        configured: config.configured,
        publicKey:
          settings.backgroundReadyPushEnabled && config.configured
            ? config.publicKey
            : "",
      },
      { headers: NO_STORE_HEADERS },
    );
  }

  if (!settings.backgroundReadyPushEnabled || !config.configured) {
    return NextResponse.json(
      { ok: true, event: null },
      { headers: NO_STORE_HEADERS },
    );
  }

  const tenantId = await getTenantId();
  const since = new Date(Date.now() - 24 * 60 * 60_000);
  const rows = await prisma.order.findMany({
    where: {
      tenantId,
      channel: "schnellbestellung",
      ts: { gte: since },
    },
    orderBy: { ts: "desc" },
    take: 50,
    select: { id: true, meta: true },
  });

  const deviceId = String(session.deviceId || "");
  const newest = rows
    .map((row) => ({ row, meta: objectValue(row.meta) }))
    .filter(({ meta }) => {
      const readyEventAt = Number(meta.readyEventAt || 0);
      return (
        String(meta.deviceId || "") === deviceId &&
        String(meta.readyEventId || "") &&
        readyEventAt > Date.now() - 20 * 60_000
      );
    })
    .sort(
      (left, right) =>
        Number(right.meta.readyEventAt || 0) -
        Number(left.meta.readyEventAt || 0),
    )[0];

  if (!newest) {
    return NextResponse.json(
      { ok: true, event: null },
      { headers: NO_STORE_HEADERS },
    );
  }

  const eventId = String(newest.meta.readyEventId || "");
  const customerNumber = Number(newest.meta.customerNumber || 0);

  return NextResponse.json(
    {
      ok: true,
      event: {
        id: eventId,
        orderId: newest.row.id,
        customerNumber,
        title: "Ihre Bestellung ist fertig!",
        body: customerNumber > 0
          ? `Nummer ${customerNumber} kann abgeholt werden.`
          : "Ihre Bestellung kann abgeholt werden.",
        url: `/schnellbestellung/success?number=${encodeURIComponent(
          customerNumber || "",
        )}&order=${encodeURIComponent(newest.row.id)}`,
        readyEventAt: Number(newest.meta.readyEventAt || 0),
      },
    },
    { headers: NO_STORE_HEADERS },
  );
}

export async function POST(req: Request) {
  if (!hasTrustedMutationOrigin(req)) {
    return forbiddenResponse("origin_not_allowed");
  }

  const rate = await enforceRateLimit(req, "schnell:push:subscribe", 20, 10 * 60_000);
  if (rate) return rate;

  const settings = await getSchnellSettings();
  const session = sessionForRequest(req, settings);
  if (!session) {
    return NextResponse.json(
      { ok: false, error: "session_expired" },
      { status: 401, headers: NO_STORE_HEADERS },
    );
  }

  const config = getSchnellPushConfig();
  if (!settings.backgroundReadyPushEnabled || !config.configured) {
    return NextResponse.json(
      { ok: false, error: "push_not_available" },
      { status: 409, headers: NO_STORE_HEADERS },
    );
  }

  const body = await req.json().catch(() => ({}));
  const orderId = cleanOrderId(body.orderId);
  const subscription = normalizeSchnellPushSubscription(body.subscription);

  if (!orderId || !subscription) {
    return NextResponse.json(
      { ok: false, error: "invalid_subscription" },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  const tenantId = await getTenantId();
  const order = await prisma.order.findFirst({
    where: {
      id: orderId,
      tenantId,
      channel: "schnellbestellung",
    },
    select: { id: true, meta: true },
  });

  if (!order) {
    return NextResponse.json(
      { ok: false, error: "order_not_found" },
      { status: 404, headers: NO_STORE_HEADERS },
    );
  }

  const meta = objectValue(order.meta);
  if (String(meta.deviceId || "") !== String(session.deviceId || "")) {
    return NextResponse.json(
      { ok: false, error: "order_forbidden" },
      { status: 403, headers: NO_STORE_HEADERS },
    );
  }

  const nextMeta = {
    ...meta,
    readyPushSubscription: {
      ...subscription,
      createdAt: new Date().toISOString(),
      userAgent: String(req.headers.get("user-agent") || "").slice(0, 300),
    },
    readyPushSubscribedAt: Date.now(),
  };

  await prisma.order.update({
    where: { id: order.id },
    data: {
      meta: nextMeta as unknown as Prisma.InputJsonValue,
    },
  });

  return NextResponse.json(
    { ok: true },
    { headers: NO_STORE_HEADERS },
  );
}
