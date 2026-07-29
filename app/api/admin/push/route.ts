import { NextResponse } from "next/server";
import {
  clearAdminPushCookie,
  findAdminPushSubscriptionForRequest,
  getAdminPushConfig,
  setAdminPushCookie,
  upsertAdminPushSubscription,
} from "@/lib/server/admin-push";
import {
  enforceRateLimit,
  forbiddenResponse,
  hasTrustedMutationOrigin,
  requireMutationRole,
  requireSessionRole,
} from "@/lib/server/request-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const HEADERS = {
  "Cache-Control": "private, no-store, no-cache, must-revalidate",
};

function json(payload: Record<string, unknown>, status = 200) {
  return NextResponse.json(payload, { status, headers: HEADERS });
}

export async function GET(req: Request) {
  const auth = await requireSessionRole(req, "admin");
  if (auth) return auth;

  const rate = await enforceRateLimit(req, "admin:push:config", 120, 10 * 60_000);
  if (rate) return rate;

  const config = getAdminPushConfig();
  const subscription = await findAdminPushSubscriptionForRequest(req);

  return json({
    ok: true,
    enabled: config.enabled,
    configured: config.configured,
    publicKey: config.publicKey,
    subscribed: Boolean(subscription),
  });
}

export async function POST(req: Request) {
  const auth = await requireMutationRole(req, ["admin"]);
  if (auth) return auth;

  if (!hasTrustedMutationOrigin(req)) {
    return forbiddenResponse("origin_not_allowed");
  }

  const rate = await enforceRateLimit(req, "admin:push:subscribe", 20, 10 * 60_000);
  if (rate) return rate;

  const body = await req.json().catch(() => ({}));

  try {
    const saved = await upsertAdminPushSubscription(req, body?.subscription);
    const response = json({ ok: true, subscribed: true });
    setAdminPushCookie(response, saved.token);
    return response;
  } catch (error) {
    const code = error instanceof Error ? error.message : "push_save_failed";
    const status =
      code === "push_not_configured" || code === "subscription_scope_conflict"
        ? 409
        : 400;
    return json({ ok: false, error: code }, status);
  }
}

export async function DELETE(req: Request) {
  const auth = await requireMutationRole(req, ["admin"]);
  if (auth) return auth;

  if (!hasTrustedMutationOrigin(req)) {
    return forbiddenResponse("origin_not_allowed");
  }

  const subscription = await findAdminPushSubscriptionForRequest(req);
  if (subscription) {
    const { prisma } = await import("@/lib/db");
    await (prisma as any).pushSubscription.update({
      where: { id: subscription.id },
      data: { active: false, lastSeenAt: new Date() },
    });
  }

  const response = json({ ok: true, subscribed: false });
  clearAdminPushCookie(response);
  return response;
}
