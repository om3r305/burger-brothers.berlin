import { NextResponse } from "next/server";
import {
  createCashSchnellOrder,
  getSchnellSettings,
  SCHNELL_COOKIE,
  verifySessionToken,
} from "@/lib/server/schnellbestellung";
import {
  enforceRateLimit,
  forbiddenResponse,
  hasTrustedMutationOrigin,
  readRequestCookie,
} from "@/lib/server/request-security";

export async function POST(req: Request) {
  if (!hasTrustedMutationOrigin(req)) {
    return forbiddenResponse("origin_not_allowed");
  }

  const rate = await enforceRateLimit(req, "schnell:orders", 10, 10 * 60 * 1000);
  if (rate) return rate;

  const settings = await getSchnellSettings();
  const session = verifySessionToken(
    readRequestCookie(req, SCHNELL_COOKIE),
    settings,
  );

  if (!session) {
    return NextResponse.json({ ok: false, error: "session_expired" }, { status: 401 });
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

    return NextResponse.json(
      {
        ok: true,
        orderId: result.order.id,
        customerNumber: result.customerNumber,
        reused: result.reused,
        total: Number(result.order.total),
        reward: result.reward || null,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error: any) {
    const code = String(error?.message || "order_failed");
    const status =
      code === "DEVICE_RATE_LIMIT"
        ? 429
        : code === "SCHNELL_UNAVAILABLE"
          ? 503
          : 400;
    const retryAfterSeconds =
      code === "DEVICE_RATE_LIMIT"
        ? Math.max(1, Math.ceil(Number(error?.retryAfterSeconds) || 60))
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
