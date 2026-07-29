import { createHash, randomBytes } from "node:crypto";
import type { NextResponse } from "next/server";
import { prisma, getTenantId } from "@/lib/db";
import { readRequestCookie } from "@/lib/server/request-security";
import { runAfterResponse } from "@/lib/server/after-response";
import {
  getSchnellPushConfig,
  normalizeSchnellPushSubscription,
  sendEmptySchnellPush,
  type StoredSchnellPushSubscription,
} from "@/lib/server/schnell-push";

export const ADMIN_PUSH_COOKIE = "bb_admin_push_device_v1";
export const ADMIN_PUSH_APP_SCOPE = "admin_app";

declare global {
  // eslint-disable-next-line no-var
  var __bbAdminPushWakeScheduledAt: number | undefined;
}


function tokenHash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function cleanText(value: unknown, max = 500) {
  return String(value ?? "").replace(/[\u0000-\u001f]/g, "").trim().slice(0, max);
}

function platformFromUserAgent(value: string) {
  const ua = value.toLowerCase();
  if (/iphone|ipad|ipod/.test(ua)) return "ios";
  if (/android/.test(ua)) return "android";
  if (/windows/.test(ua)) return "windows";
  if (/mac os|macintosh/.test(ua)) return "macos";
  return "web";
}

function rowToSubscription(row: any): StoredSchnellPushSubscription {
  return {
    endpoint: String(row.endpoint || ""),
    expirationTime: row.expirationTime
      ? new Date(row.expirationTime).getTime()
      : null,
    keys: {
      p256dh: String(row.p256dh || ""),
      auth: String(row.auth || ""),
    },
    createdAt: row.createdAt
      ? new Date(row.createdAt).toISOString()
      : undefined,
    userAgent: String(row.userAgent || ""),
  };
}

export function getAdminPushConfig() {
  const config = getSchnellPushConfig();
  return {
    enabled: config.configured,
    configured: config.configured,
    publicKey: config.configured ? config.publicKey : "",
  };
}

export async function findAdminPushSubscriptionForRequest(
  req: Request,
  tenantIdInput?: string,
) {
  const token = readRequestCookie(req, ADMIN_PUSH_COOKIE);
  if (!token || token.length < 20) return null;
  const tenantId = tenantIdInput || (await getTenantId());

  return (prisma as any).pushSubscription.findFirst({
    where: {
      tenantId,
      deviceTokenHash: tokenHash(token),
      appScope: ADMIN_PUSH_APP_SCOPE,
      active: true,
    },
  });
}

export async function upsertAdminPushSubscription(
  req: Request,
  subscriptionValue: unknown,
) {
  const config = getAdminPushConfig();
  if (!config.configured) throw new Error("push_not_configured");

  const normalized = normalizeSchnellPushSubscription(subscriptionValue);
  if (!normalized?.keys?.p256dh || !normalized.keys.auth) {
    throw new Error("invalid_subscription");
  }

  const tenantId = await getTenantId();
  const existingCookie = readRequestCookie(req, ADMIN_PUSH_COOKIE);
  const currentByCookie = existingCookie
    ? await (prisma as any).pushSubscription.findFirst({
        where: {
          tenantId,
          deviceTokenHash: tokenHash(existingCookie),
          appScope: ADMIN_PUSH_APP_SCOPE,
        },
      })
    : null;

  const endpointRow = await (prisma as any).pushSubscription.findFirst({
    where: { tenantId, endpoint: normalized.endpoint },
  });

  if (endpointRow && endpointRow.appScope !== ADMIN_PUSH_APP_SCOPE) {
    throw new Error("subscription_scope_conflict");
  }

  const current = endpointRow || currentByCookie;
  const mayReuseCookie =
    Boolean(existingCookie) &&
    Boolean(currentByCookie?.id) &&
    currentByCookie?.id === current?.id;
  const rawToken = mayReuseCookie
    ? String(existingCookie)
    : randomBytes(32).toString("base64url");

  const userAgent = cleanText(req.headers.get("user-agent"), 500);
  const locale =
    cleanText(req.headers.get("accept-language")?.split(",")[0] || "de", 24) ||
    "de";
  const expirationTime = normalized.expirationTime
    ? new Date(normalized.expirationTime)
    : null;
  const data = {
    endpoint: normalized.endpoint,
    p256dh: normalized.keys.p256dh,
    auth: normalized.keys.auth,
    expirationTime:
      expirationTime && Number.isFinite(expirationTime.valueOf())
        ? expirationTime
        : null,
    deviceTokenHash: tokenHash(rawToken),
    platform: platformFromUserAgent(userAgent),
    userAgent,
    locale,
    appScope: ADMIN_PUSH_APP_SCOPE,
    active: true,
    lastSeenAt: new Date(),
    failureCount: 0,
  };

  const subscription = current
    ? await (prisma as any).pushSubscription.update({
        where: { id: current.id },
        data,
      })
    : await (prisma as any).pushSubscription.create({
        data: { tenantId, ...data },
      });

  return { token: rawToken, subscription };
}

export function setAdminPushCookie(response: NextResponse, token: string) {
  response.cookies.set({
    name: ADMIN_PUSH_COOKIE,
    value: token,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 365 * 24 * 60 * 60,
  });
}

export function clearAdminPushCookie(response: NextResponse) {
  response.cookies.set({
    name: ADMIN_PUSH_COOKIE,
    value: "",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}

export async function readPendingAdminPushNotifications(req: Request) {
  const tenantId = await getTenantId();
  const subscription = await findAdminPushSubscriptionForRequest(req, tenantId);
  if (!subscription) return [];

  const items = await (prisma as any).adminInboxNotification.findMany({
    where: {
      tenantId,
      status: "unread",
    },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: {
      id: true,
      type: true,
      title: true,
      body: true,
      url: true,
      createdAt: true,
    },
  });

  await (prisma as any).pushSubscription
    .update({
      where: { id: subscription.id },
      data: { lastSeenAt: new Date() },
    })
    .catch(() => undefined);

  return items.map((item: any) => ({
    id: String(item.id),
    type: String(item.type || "admin_attention"),
    title: String(item.title || "Burger Brothers Admin"),
    body: String(item.body || "Yeni bir admin işlemi bekliyor."),
    url: String(item.url || "/admin"),
    createdAt: item.createdAt,
  }));
}

export async function notifyAdminPushSubscribers() {
  const tenantId = await getTenantId();
  const subscriptions = await (prisma as any).pushSubscription.findMany({
    where: {
      tenantId,
      appScope: ADMIN_PUSH_APP_SCOPE,
      active: true,
    },
    take: 25,
  });

  let successCount = 0;
  let failureCount = 0;

  for (let index = 0; index < subscriptions.length; index += 8) {
    const batch = subscriptions.slice(index, index + 8);
    const results = await Promise.all(
      batch.map(async (subscription: any) => {
        const result = await sendEmptySchnellPush(
          rowToSubscription(subscription),
        ).catch(() => ({
          attempted: true,
          ok: false,
          expired: false,
          status: 0,
        }));

        const now = new Date();
        await (prisma as any).pushSubscription
          .update({
            where: { id: subscription.id },
            data: result.ok
              ? {
                  lastPushAt: now,
                  lastSuccessAt: now,
                  failureCount: 0,
                }
              : {
                  active: result.expired ? false : true,
                  lastPushAt: now,
                  lastFailureAt: now,
                  failureCount: { increment: 1 },
                },
          })
          .catch(() => undefined);

        return result;
      }),
    );

    successCount += results.filter((result: any) => result.ok).length;
    failureCount += results.filter((result: any) => !result.ok).length;
  }

  return {
    recipients: subscriptions.length,
    successCount,
    failureCount,
  };
}

export function scheduleAdminPushWake() {
  const now = Date.now();
  const last = globalThis.__bbAdminPushWakeScheduledAt || 0;
  if (now - last < 1_500) return;
  globalThis.__bbAdminPushWakeScheduledAt = now;

  runAfterResponse(async () => {
    await notifyAdminPushSubscribers();
  });
}
