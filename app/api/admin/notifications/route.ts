import { NextResponse } from "next/server";
import { runAfterResponse } from "@/lib/server/after-response";
import { prisma, getTenantId } from "@/lib/db";
import {
  createAdminBroadcast,
  deliverAdminBroadcast,
  findGeneralPushSubscriptionForRequest,
  queueAndSendGeneralNotification,
} from "@/lib/server/general-push";
import { processDueAutomaticNotifications } from "@/lib/server/automatic-notifications";
import {
  readAdminRouteStreetGroups,
  readNearbyDeliverySettings,
  saveNearbyDeliverySettings,
} from "@/lib/server/nearby-delivery-settings";
import {
  enforceRateLimit,
  getSessionSubject,
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

function cleanText(value: unknown, max: number) {
  return String(value ?? "").trim().slice(0, max);
}

function normalizeKind(value: unknown) {
  const kind = cleanText(value, 30).toLowerCase();
  return ["campaign", "offer", "announcement", "coupon", "nearby"].includes(kind)
    ? (kind as "campaign" | "offer" | "announcement" | "coupon" | "nearby")
    : "announcement";
}

export async function GET(req: Request) {
  const auth = await requireSessionRole(req, "admin");
  if (auth) return auth;

  const rate = await enforceRateLimit(req, "admin:notifications:get", 120, 10 * 60_000);
  if (rate) return rate;

  const tenantId = await getTenantId();
  const [
    activeSubscriptions,
    marketingSubscriptions,
    orderSubscriptions,
    recent,
    nearbySettings,
    adminRouteStreetGroups,
  ] = await Promise.all([
      (prisma as any).pushSubscription.count({
        where: { tenantId, active: true },
      }),
      (prisma as any).pushSubscription.count({
        where: {
          tenantId,
          active: true,
          preference: {
            is: {
              marketingConsentedAt: { not: null },
              OR: [
                { allNotifications: true },
                { campaigns: true },
                { coupons: true },
                { nearbyDelivery: true },
              ],
            },
          },
        },
      }),
      (prisma as any).pushSubscription.count({
        where: {
          tenantId,
          active: true,
          preference: { is: { OR: [{ allNotifications: true }, { orderUpdates: true }] } },
        },
      }),
      (prisma as any).notificationCampaign.findMany({
        where: { tenantId },
        orderBy: { createdAt: "desc" },
        take: 20,
      }),
      readNearbyDeliverySettings(tenantId),
      readAdminRouteStreetGroups(),
    ]);

  runAfterResponse(async () => {
    await processDueAutomaticNotifications(tenantId).catch((error) => {
      console.error("[admin/notifications] scheduled dispatch failed", error);
    });
  });

  return json({
    ok: true,
    stats: {
      activeSubscriptions,
      marketingSubscriptions,
      orderSubscriptions,
    },
    nearbySettings,
    adminRouteStreetGroups,
    recent: recent.map((item: any) => ({
      id: item.id,
      kind: item.kind,
      title: item.title,
      body: item.body,
      status: item.status,
      recipientCount: item.recipientCount,
      successCount: item.successCount,
      failureCount: item.failureCount,
      createdAt: item.createdAt,
      sentAt: item.sentAt,
    })),
  });
}

export async function POST(req: Request) {
  const auth = await requireMutationRole(req, ["admin"]);
  if (auth) return auth;

  const rate = await enforceRateLimit(req, "admin:notifications:send", 30, 10 * 60_000);
  if (rate) return rate;

  const body = await req.json().catch(() => ({}));
  const action = cleanText(body?.action, 30) || "send";
  if (action === "save_nearby_settings") {
    const tenantId = await getTenantId();
    const nearbySettings = await saveNearbyDeliverySettings(
      body?.nearbySettings,
      tenantId,
    );
    return json({ ok: true, nearbySettings });
  }

  const title = cleanText(body?.title, 160);
  const message = cleanText(body?.body, 600);

  if (!title || !message) {
    return json({ ok: false, error: "title_and_body_required" }, 400);
  }

  if (action === "test") {
    const subscription = await findGeneralPushSubscriptionForRequest(req);
    if (!subscription) {
      return json(
        {
          ok: false,
          error: "admin_device_not_subscribed",
          message:
            "Bu cihazda önce /install sayfasından bildirimleri etkinleştirin.",
        },
        409,
      );
    }

    const result = await queueAndSendGeneralNotification({
      subscriptionId: subscription.id,
      type: "test",
      title,
      body: message,
      url: cleanText(body?.url, 500) || "/menu",
      imageUrl: cleanText(body?.imageUrl, 1000) || null,
      dedupeKey: `test:${subscription.id}:${Date.now()}`,
      payload: { source: "admin_test" },
    });

    return json({ ok: result.ok === true, test: true, result });
  }

  const audience =
    body?.audience === "plz" || body?.audience === "phone"
      ? body.audience
      : "all";
  const plz = cleanText(body?.plz, 10).replace(/\D/g, "").slice(0, 5);
  const phone = cleanText(body?.phone, 40).replace(/\D/g, "");

  if (audience === "plz" && plz.length !== 5) {
    return json({ ok: false, error: "invalid_plz" }, 400);
  }
  if (audience === "phone" && phone.length < 8) {
    return json({ ok: false, error: "invalid_phone" }, 400);
  }

  const createdBy = (await getSessionSubject(req, "admin")) || "admin";
  let broadcast;
  try {
    broadcast = await createAdminBroadcast({
      kind: normalizeKind(body?.kind),
      title,
      body: message,
      url: cleanText(body?.url, 500) || "/menu",
      imageUrl: cleanText(body?.imageUrl, 1000) || null,
      audience,
      plz: plz || null,
      phone: phone || null,
      createdBy,
    });
  } catch (error) {
    const code = error instanceof Error ? error.message : "notification_send_failed";
    const status = code === "invalid_plz" || code === "invalid_phone" ? 400 : 500;
    console.error("[admin/notifications] create failed", error);
    return json({ ok: false, error: code }, status);
  }

  runAfterResponse(async () => {
    await deliverAdminBroadcast(
      broadcast.campaign.id,
      broadcast.eventIds,
    ).catch((error) => {
      console.error("[admin/notifications] delivery failed", error);
    });
  });

  return json({
    ok: true,
    queued: true,
    campaignId: broadcast.campaign.id,
    recipientCount: broadcast.recipientCount,
  });
}
