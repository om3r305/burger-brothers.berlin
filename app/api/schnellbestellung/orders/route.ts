import { NextResponse } from "next/server";
import {
  createCashSchnellOrder,
  getSchnellSettings,
  isAndroidUserAgent,
  SCHNELL_COOKIE,
  schnellSessionIsInstalledApp,
  verifySessionToken,
} from "@/lib/server/schnellbestellung";
import {
  enforceRateLimit,
  forbiddenResponse,
  hasTrustedMutationOrigin,
  readRequestCookie,
} from "@/lib/server/request-security";
import { getShopStatusFresh } from "@/lib/server/shop-status";

export async function POST(req: Request) {
  const requestStartedAt = performance.now();
  if (!hasTrustedMutationOrigin(req)) {
    return forbiddenResponse("origin_not_allowed");
  }

  const rate = await enforceRateLimit(req, "schnell:orders", 10, 10 * 60 * 1000);
  if (rate) return rate;

  try {
    const shopStatus = await getShopStatusFresh();
    if (shopStatus.closed) {
      return NextResponse.json(
        {
          ok: false,
          error: "SHOP_CLOSED",
          message:
            shopStatus.message ||
            "Der Online-Shop ist vorübergehend geschlossen.",
        },
        {
          status: 503,
          headers: {
            "Cache-Control": "no-store",
            "Retry-After": "5",
          },
        },
      );
    }
  } catch (error) {
    console.error("[schnell/orders] shop status unavailable", error);
    return NextResponse.json(
      {
        ok: false,
        error: "SHOP_STATUS_UNAVAILABLE",
        message: "Der Online-Shop ist vorübergehend nicht verfügbar.",
      },
      {
        status: 503,
        headers: {
          "Cache-Control": "no-store",
          "Retry-After": "5",
        },
      },
    );
  }

  const settings = await getSchnellSettings();
  const session = verifySessionToken(
    readRequestCookie(req, SCHNELL_COOKIE),
    settings,
  );

  if (!session) {
    return NextResponse.json({ ok: false, error: "session_expired" }, { status: 401 });
  }

  if (
    isAndroidUserAgent(req.headers.get("user-agent")) &&
    !schnellSessionIsInstalledApp(session)
  ) {
    return NextResponse.json(
      { ok: false, error: "android_install_required" },
      {
        status: 403,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }

  if (
    settings.locationCheckEnabled &&
    Date.now() - Number(session.locAt) > settings.recheckMinutes * 60_000
  ) {
    return NextResponse.json(
      { ok: false, error: "location_recheck_required" },
      { status: 428 },
    );
  }

  const body = await req.json().catch(() => ({}));

  if (String(body.paymentMethod || "cash") !== "cash") {
    return NextResponse.json(
      { ok: false, error: "payment_method_not_available" },
      { status: 409 },
    );
  }

  const idempotencyKey = String(
    req.headers.get("idempotency-key") || body.idempotencyKey || "",
  )
    .replace(/[^a-zA-Z0-9_-]/g, "")
    .slice(0, 100);

  if (idempotencyKey.length < 12) {
    return NextResponse.json(
      { ok: false, error: "idempotency_required" },
      { status: 400 },
    );
  }

  try {
    const result = await createCashSchnellOrder({
      items: Array.isArray(body.items) ? body.items : [],
      idempotencyKey,
      deviceId: String(session.deviceId),
      session,
      takeaway: body.takeaway === true,
    });

    const totalMs = Math.round(performance.now() - requestStartedAt);
    if (totalMs >= 2_000) {
      console.warn("[schnell/orders] slow request", {
        totalMs,
        reused: result.reused,
        rewarded: Boolean(result.reward),
      });
    }

    return NextResponse.json(
      {
        ok: true,
        orderId: result.order.id,
        customerNumber: result.customerNumber,
        reused: result.reused,
        total: Number(result.order.total),
        reward: result.reward || null,
      },
      {
        headers: {
          "Cache-Control": "no-store",
          "Server-Timing": `schnell-order;dur=${totalMs}`,
        },
      },
    );
  } catch (error: any) {
    const code = String(error?.message || "order_failed");
    const status =
      code === "DEVICE_RATE_LIMIT"
        ? 429
        : code === "SCHNELL_UNAVAILABLE" || code === "DB_BUSY"
          ? 503
          : 400;
    const retryAfterSeconds =
      code === "DEVICE_RATE_LIMIT"
        ? Math.max(1, Math.ceil(Number(error?.retryAfterSeconds) || 60))
        : code === "DB_BUSY"
          ? Math.max(1, Math.ceil(Number(error?.retryAfterSeconds) || 3))
          : 0;

    return NextResponse.json(
      {
        ok: false,
        error: code,
        ...(retryAfterSeconds > 0 ? { retryAfterSeconds } : {}),
      },
      {
        status,
        headers:
          retryAfterSeconds > 0
            ? {
                "Cache-Control": "no-store",
                "Retry-After": String(retryAfterSeconds),
              }
            : { "Cache-Control": "no-store" },
      },
    );
  }
}
