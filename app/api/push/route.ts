import { NextResponse } from "next/server";
import { getTenantId } from "@/lib/db";
import {
  clearGeneralPushCookie,
  findGeneralPushSubscriptionForRequest,
  getGeneralPushConfig,
  normalizeGeneralPushPreferences,
  setGeneralPushCookie,
  upsertGeneralPushSubscription,
} from "@/lib/server/general-push";
import {
  enforceRateLimit,
  forbiddenResponse,
  hasTrustedMutationOrigin,
} from "@/lib/server/request-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store, no-cache, must-revalidate",
};

function response(payload: Record<string, unknown>, status = 200) {
  return NextResponse.json(payload, {
    status,
    headers: NO_STORE_HEADERS,
  });
}

function publicPreference(value: any) {
  const normalized = normalizeGeneralPushPreferences(value, value);
  return {
    allNotifications: normalized.allNotifications,
    orderUpdates: normalized.orderUpdates,
    campaigns: normalized.campaigns,
    coupons: normalized.coupons,
    nearbyDelivery: normalized.nearbyDelivery,
  };
}

export async function GET(req: Request) {
  const rate = await enforceRateLimit(req, "push:config", 120, 10 * 60_000);
  if (rate) return rate;

  const config = getGeneralPushConfig();
  const tenantId = await getTenantId();
  const subscription = await findGeneralPushSubscriptionForRequest(req, tenantId);

  return response({
    ok: true,
    enabled: config.enabled,
    configured: config.configured,
    publicKey: config.publicKey,
    subscribed: Boolean(subscription),
    platform: subscription?.platform || null,
    preferences: subscription
      ? publicPreference(subscription.preference)
      : publicPreference({ allNotifications: true }),
  });
}

async function save(req: Request) {
  if (!hasTrustedMutationOrigin(req)) {
    return forbiddenResponse("origin_not_allowed");
  }

  const rate = await enforceRateLimit(req, "push:subscribe", 30, 10 * 60_000);
  if (rate) return rate;

  const body = await req.json().catch(() => ({}));

  try {
    const saved = await upsertGeneralPushSubscription(
      req,
      body?.subscription,
      body?.preferences,
    );
    const result = response({
      ok: true,
      subscribed: true,
      platform: saved.subscription.platform || null,
      preferences: publicPreference(saved.subscription.preference),
    });
    setGeneralPushCookie(result, saved.token);
    return result;
  } catch (error) {
    const code = error instanceof Error ? error.message : "push_save_failed";
    const status = code === "push_not_configured" ? 409 : 400;
    return response({ ok: false, error: code }, status);
  }
}

export async function POST(req: Request) {
  return save(req);
}

export async function PATCH(req: Request) {
  return save(req);
}

export async function DELETE(req: Request) {
  if (!hasTrustedMutationOrigin(req)) {
    return forbiddenResponse("origin_not_allowed");
  }

  const rate = await enforceRateLimit(req, "push:unsubscribe", 20, 10 * 60_000);
  if (rate) return rate;

  const subscription = await findGeneralPushSubscriptionForRequest(req);
  if (subscription) {
    const { prisma } = await import("@/lib/db");
    await (prisma as any).pushSubscription.update({
      where: { id: subscription.id },
      data: { active: false, lastSeenAt: new Date() },
    });
  }

  const result = response({ ok: true, subscribed: false });
  clearGeneralPushCookie(result);
  return result;
}
