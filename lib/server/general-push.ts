import { createHash, randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { prisma, getTenantId } from "@/lib/db";
import {
  getSchnellPushConfig,
  normalizeSchnellPushSubscription,
  sendEmptySchnellPush,
  type StoredSchnellPushSubscription,
} from "@/lib/server/schnell-push";
import { readRequestCookie } from "@/lib/server/request-security";
import {
  readAdminRouteStreetGroups,
  readNearbyDeliverySettings,
} from "@/lib/server/nearby-delivery-settings";
import {
  groupAcceptsNearbyAddress,
  rankNearbyDeliveryMatch,
  type NearbyAddressSnapshot,
} from "@/lib/server/nearby-delivery-matcher";

export const GENERAL_PUSH_COOKIE = "bb_push_device_v1";
export const GENERAL_PUSH_CONSENT_VERSION = "3-single-prompt";
export const GENERAL_PUSH_APP_SCOPE = "customer_app";

export type GeneralPushPreferences = {
  allNotifications: boolean;
  orderUpdates: boolean;
  campaigns: boolean;
  coupons: boolean;
  nearbyDelivery: boolean;
  plz?: string | null;
  street?: string | null;
  lat?: number | null;
  lng?: number | null;
  nearbyRadiusM: number;
  nearbyCooldownDays: number;
};

export type GeneralNotificationInput = {
  subscriptionId: string;
  type: string;
  title: string;
  body: string;
  url?: string | null;
  imageUrl?: string | null;
  orderId?: string | null;
  campaignId?: string | null;
  dedupeKey?: string | null;
  payload?: Record<string, unknown> | null;
  availableAt?: Date;
  expiresAt?: Date | null;
};

function plainObject(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, any>)
    : {};
}

function cleanText(value: unknown, max = 500) {
  return String(value ?? "").trim().slice(0, max);
}

function normalizeNotificationUrl(value: unknown, fallback = "/menu") {
  const raw = cleanText(value, 500);
  if (!raw) return fallback;
  if (raw.startsWith("/") && !raw.startsWith("//")) return raw;
  return fallback;
}

function normalizeImageUrl(value: unknown) {
  const raw = cleanText(value, 1000);
  if (!raw) return null;
  if (raw.startsWith("/") && !raw.startsWith("//")) return raw;
  try {
    const parsed = new URL(raw);
    return parsed.protocol === "https:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function normalizePhone(value: unknown) {
  const digits = String(value ?? "").replace(/\D/g, "");
  return digits.slice(0, 32) || null;
}

function normalizeEmail(value: unknown) {
  const email = cleanText(value, 200).toLowerCase();
  return email && email.includes("@") ? email : null;
}

function normalizePlz(value: unknown) {
  const plz = String(value ?? "").replace(/\D/g, "").slice(0, 5);
  return plz.length === 5 ? plz : null;
}

function normalizeStreet(value: unknown) {
  return cleanText(value, 180)
    .toLocaleLowerCase("de-DE")
    .replace(/ß/g, "ss")
    .replace(/strasse/g, "str")
    .replace(/straße/g, "str")
    .replace(/[^a-z0-9äöü\s-]/gi, " ")
    .replace(/\s+\d+[a-z]?(?:\s*[-/]\s*\d+[a-z]?)?\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim() || null;
}

function finiteNumber(value: unknown, min: number, max: number) {
  const number = Number(value);
  return Number.isFinite(number) && number >= min && number <= max
    ? number
    : null;
}

function boundedInteger(value: unknown, fallback: number, min: number, max: number) {
  const number = Number(value);
  return Number.isFinite(number)
    ? Math.max(min, Math.min(max, Math.round(number)))
    : fallback;
}

function tokenHash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function platformFromUserAgent(userAgent: string) {
  const ua = userAgent.toLowerCase();
  if (/iphone|ipad|ipod/.test(ua)) return "ios";
  if (/android/.test(ua)) return "android";
  if (/windows/.test(ua)) return "windows";
  if (/macintosh|mac os/.test(ua)) return "macos";
  return "web";
}

function jsonForDb(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? {})) as Prisma.InputJsonValue;
}

export function getGeneralPushConfig() {
  const base = getSchnellPushConfig();
  const enabled = !["0", "false", "off", "no"].includes(
    String(process.env.GENERAL_PUSH_ENABLED ?? "true").toLowerCase().trim(),
  );

  return {
    enabled,
    configured: enabled && base.configured,
    publicKey: enabled && base.configured ? base.publicKey : "",
  };
}

export function normalizeGeneralPushPreferences(
  value: unknown,
  previous?: Partial<GeneralPushPreferences> | null,
): GeneralPushPreferences {
  const raw = plainObject(value);
  const prev = previous || {};
  const allNotifications =
    typeof raw.allNotifications === "boolean"
      ? raw.allNotifications
      : prev.allNotifications === true;

  return {
    allNotifications,
    orderUpdates: allNotifications
      ? true
      : typeof raw.orderUpdates === "boolean"
        ? raw.orderUpdates
        : prev.orderUpdates !== false,
    campaigns: allNotifications
      ? true
      : typeof raw.campaigns === "boolean"
        ? raw.campaigns
        : prev.campaigns === true,
    coupons: allNotifications
      ? true
      : typeof raw.coupons === "boolean"
        ? raw.coupons
        : prev.coupons === true,
    nearbyDelivery: allNotifications
      ? true
      : typeof raw.nearbyDelivery === "boolean"
        ? raw.nearbyDelivery
        : prev.nearbyDelivery === true,
    // Address/location values are never accepted from the permission screen.
    // They are populated only from real delivery orders.
    plz: normalizePlz(prev.plz),
    street: normalizeStreet(prev.street),
    lat: finiteNumber(prev.lat, -90, 90),
    lng: finiteNumber(prev.lng, -180, 180),
    nearbyRadiusM: boundedInteger(prev.nearbyRadiusM, 800, 200, 5_000),
    nearbyCooldownDays: boundedInteger(prev.nearbyCooldownDays, 7, 1, 60),
  };
}

export async function findGeneralPushSubscriptionForRequest(
  req: Request,
  tenantIdInput?: string,
) {
  const token = readRequestCookie(req, GENERAL_PUSH_COOKIE);
  if (!token || token.length < 20) return null;

  const tenantId = tenantIdInput || (await getTenantId());
  return (prisma as any).pushSubscription.findFirst({
    where: {
      tenantId,
      deviceTokenHash: tokenHash(token),
      appScope: GENERAL_PUSH_APP_SCOPE,
      active: true,
    },
    include: {
      preference: true,
    },
  });
}

export async function upsertGeneralPushSubscription(
  req: Request,
  subscriptionValue: unknown,
  preferenceValue: unknown,
) {
  const config = getGeneralPushConfig();
  if (!config.configured) {
    throw new Error("push_not_configured");
  }

  const normalized = normalizeSchnellPushSubscription(subscriptionValue);
  if (!normalized?.keys?.p256dh || !normalized.keys.auth) {
    throw new Error("invalid_subscription");
  }

  const tenantId = await getTenantId();
  const existingCookie = readRequestCookie(req, GENERAL_PUSH_COOKIE);
  const currentByCookie = existingCookie
    ? await (prisma as any).pushSubscription.findFirst({
        where: {
          tenantId,
          deviceTokenHash: tokenHash(existingCookie),
        },
        include: { preference: true },
      })
    : null;
  const currentByEndpoint = await (prisma as any).pushSubscription.findFirst({
    where: {
      tenantId,
      endpoint: normalized.endpoint,
    },
    include: { preference: true },
  });
  const current = currentByEndpoint || currentByCookie;
  const mayReuseCookie =
    Boolean(existingCookie) &&
    Boolean(currentByCookie?.id) &&
    currentByCookie?.id === current?.id;
  const rawToken = mayReuseCookie
    ? existingCookie
    : randomBytes(32).toString("base64url");
  const userAgent = cleanText(req.headers.get("user-agent"), 500);
  const locale = cleanText(req.headers.get("accept-language")?.split(",")[0] || "de", 24) || "de";
  const expirationTime = normalized.expirationTime
    ? new Date(normalized.expirationTime)
    : null;

  const subscription = current
    ? await (prisma as any).pushSubscription.update({
        where: { id: current.id },
        data: {
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
          appScope: GENERAL_PUSH_APP_SCOPE,
          active: true,
          lastSeenAt: new Date(),
          failureCount: 0,
        },
        include: { preference: true },
      })
    : await (prisma as any).pushSubscription.create({
        data: {
          tenantId,
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
          appScope: GENERAL_PUSH_APP_SCOPE,
          active: true,
          lastSeenAt: new Date(),
        },
        include: { preference: true },
      });

  const preferences = normalizeGeneralPushPreferences(
    preferenceValue,
    subscription.preference,
  );
  const marketingEnabled =
    preferences.campaigns || preferences.coupons || preferences.nearbyDelivery;
  const now = new Date();

  const preference = await (prisma as any).notificationPreference.upsert({
    where: { subscriptionId: subscription.id },
    update: {
      ...preferences,
      consentVersion: GENERAL_PUSH_CONSENT_VERSION,
      orderConsentedAt: preferences.orderUpdates
        ? subscription.preference?.orderConsentedAt || now
        : null,
      marketingConsentedAt: marketingEnabled
        ? subscription.preference?.marketingConsentedAt || now
        : null,
    },
    create: {
      tenantId,
      subscriptionId: subscription.id,
      ...preferences,
      consentVersion: GENERAL_PUSH_CONSENT_VERSION,
      orderConsentedAt: preferences.orderUpdates ? now : null,
      marketingConsentedAt: marketingEnabled ? now : null,
    },
  });

  return {
    token: rawToken,
    subscription: {
      ...subscription,
      preference,
    },
  };
}

export function setGeneralPushCookie(response: NextResponse, token: string) {
  response.cookies.set({
    name: GENERAL_PUSH_COOKIE,
    value: token,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 365 * 24 * 60 * 60,
  });
}

export function clearGeneralPushCookie(response: NextResponse) {
  response.cookies.set({
    name: GENERAL_PUSH_COOKIE,
    value: "",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}

function rowToPushSubscription(row: any): StoredSchnellPushSubscription {
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

export async function queueGeneralNotification(input: GeneralNotificationInput) {
  const subscription = await (prisma as any).pushSubscription.findFirst({
    where: {
      id: input.subscriptionId,
      appScope: GENERAL_PUSH_APP_SCOPE,
      active: true,
    },
    select: {
      id: true,
      tenantId: true,
    },
  });

  if (!subscription) return null;

  if (input.dedupeKey) {
    const existing = await (prisma as any).notificationEvent.findFirst({
      where: {
        tenantId: subscription.tenantId,
        dedupeKey: input.dedupeKey,
      },
      include: { subscription: true },
    });
    if (existing) return { ...existing, __deduped: true };
  }

  try {
    return await (prisma as any).notificationEvent.create({
      data: {
        tenantId: subscription.tenantId,
        subscriptionId: subscription.id,
        campaignId: input.campaignId || null,
        orderId: input.orderId || null,
        type: cleanText(input.type, 60) || "general",
        dedupeKey: input.dedupeKey || null,
        title: cleanText(input.title, 160),
        body: cleanText(input.body, 600),
        url: normalizeNotificationUrl(input.url, "/menu"),
        imageUrl: normalizeImageUrl(input.imageUrl),
        payload: input.payload ? jsonForDb(input.payload) : undefined,
        status: "queued",
        availableAt: input.availableAt || new Date(),
        expiresAt: input.expiresAt || null,
      },
      include: {
        subscription: true,
      },
    });
  } catch (error: any) {
    if (error?.code === "P2002" && input.dedupeKey) {
      const existing = await (prisma as any).notificationEvent.findFirst({
        where: {
          tenantId: subscription.tenantId,
          dedupeKey: input.dedupeKey,
        },
        include: { subscription: true },
      });
      return existing ? { ...existing, __deduped: true } : null;
    }
    throw error;
  }
}

export async function sendGeneralNotificationEvent(eventOrId: any) {
  const event =
    typeof eventOrId === "string"
      ? await (prisma as any).notificationEvent.findUnique({
          where: { id: eventOrId },
          include: { subscription: true },
        })
      : eventOrId?.subscription
        ? eventOrId
        : await (prisma as any).notificationEvent.findUnique({
            where: { id: eventOrId?.id },
            include: { subscription: true },
          });

  if (event?.expiresAt && new Date(event.expiresAt) <= new Date()) {
    await (prisma as any).notificationEvent
      .update({ where: { id: event.id }, data: { status: "expired" } })
      .catch(() => undefined);
    return { ok: false, skipped: true, expired: true };
  }

  if (
    !event?.subscription?.active ||
    event.subscription.appScope !== GENERAL_PUSH_APP_SCOPE
  ) {
    return { ok: false, skipped: true, expired: false };
  }

  const result = await sendEmptySchnellPush(
    rowToPushSubscription(event.subscription),
  );
  const now = new Date();
  const deliveryStatus = result.ok
    ? "accepted"
    : result.expired
      ? "expired"
      : "failed";

  await (prisma as any).$transaction([
    (prisma as any).notificationDelivery.create({
      data: {
        tenantId: event.tenantId,
        eventId: event.id,
        subscriptionId: event.subscriptionId,
        campaignId: event.campaignId || null,
        status: deliveryStatus,
        httpStatus: result.status || null,
        error: result.error || null,
        attemptedAt: now,
        deliveredAt: result.ok ? now : null,
      },
    }),
    (prisma as any).notificationEvent.update({
      where: { id: event.id },
      data: result.ok
        ? { status: "sent" }
        : result.expired
          ? { status: "failed" }
          : {
              // Geçici ağ/push-servisi hatasında olayı kaybetme. Sonraki başarılı
              // push uyanışında Service Worker kuyruğu tekrar çekebilir.
              status: "queued",
              availableAt: new Date(now.getTime() + 5 * 60_000),
            },
    }),
    (prisma as any).pushSubscription.update({
      where: { id: event.subscriptionId },
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
    }),
  ]);

  return {
    ok: result.ok,
    skipped: !result.attempted,
    expired: result.expired,
    status: result.status,
  };
}

export async function queueAndSendGeneralNotification(
  input: GeneralNotificationInput,
) {
  const event = await queueGeneralNotification(input);
  if (!event) return { ok: false, skipped: true };
  if ((event as any).__deduped) {
    return { ok: true, skipped: true, deduped: true };
  }
  if (event.status && event.status !== "queued") {
    return { ok: true, skipped: true, deduped: true };
  }
  return sendGeneralNotificationEvent(event);
}

export async function readPendingGeneralNotifications(req: Request) {
  const tenantId = await getTenantId();
  const subscription = await findGeneralPushSubscriptionForRequest(req, tenantId);
  if (!subscription) return [];

  const now = new Date();
  const events = await (prisma as any).notificationEvent.findMany({
    where: {
      tenantId,
      subscriptionId: subscription.id,
      status: { in: ["queued", "sent"] },
      availableAt: { lte: now },
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
    orderBy: { createdAt: "asc" },
    take: 10,
  });

  if (events.length) {
    await (prisma as any).notificationEvent.updateMany({
      where: { id: { in: events.map((event: any) => event.id) } },
      data: {
        status: "fetched",
        fetchedAt: now,
      },
    });
  }

  return events.map((event: any) => ({
    id: event.id,
    type: event.type,
    title: event.title,
    body: event.body,
    url: event.url || "/menu",
    imageUrl: event.imageUrl || null,
    tag: `bb-${event.type}-${event.id}`,
    payload: plainObject(event.payload),
    expiresAt: event.expiresAt || null,
    createdAt: event.createdAt,
  }));
}

function orderCustomer(order: any) {
  return plainObject(order?.customer);
}

function orderMeta(order: any) {
  return plainObject(order?.meta);
}

function trackingUrl(order: any) {
  const meta = orderMeta(order);
  const token = cleanText(meta.trackingToken || meta.publicTrackingToken, 160);
  return token ? `/track/${encodeURIComponent(token)}` : "/menu";
}

function orderMode(order: any) {
  return cleanText(order?.mode, 30).toLowerCase();
}

function statusNotificationText(order: any, status: string) {
  const delivery = orderMode(order) === "delivery";
  const meta = orderMeta(order);
  const payment = plainObject(meta.payment);

  switch (status) {
    case "new":
      return {
        title: "Bestellung eingegangen ✅",
        body: "Wir haben Ihre Bestellung erhalten.",
      };
    case "preparing":
      return {
        title: "Bestellung wird vorbereitet 🍔",
        body: "Unsere Küche arbeitet jetzt an Ihrer Bestellung.",
      };
    case "ready":
      return delivery
        ? {
            title: "Ihre Bestellung ist bereit",
            body: "Ihre Bestellung wartet auf die Abholung durch den Fahrer.",
          }
        : {
            title: "Bestellung ist abholbereit!",
            body: "Sie können Ihre Bestellung jetzt abholen.",
          };
    case "out_for_delivery":
      return {
        title: "Bestellung ist unterwegs! 🚗",
        body: "Unser Fahrer ist mit Ihrer Bestellung auf dem Weg zu Ihnen.",
      };
    case "done":
      return delivery
        ? {
            title: "Bestellung wurde geliefert ✅",
            body: "Guten Appetit und vielen Dank für Ihre Bestellung!",
          }
        : {
            title: "Bestellung abgeschlossen ✅",
            body: "Vielen Dank für Ihre Bestellung!",
          };
    case "cancelled": {
      const refundStatus = cleanText(
        payment?.refund?.status || meta.paymentStatus,
        80,
      );
      const refunded = /refund|erstatt/.test(refundStatus.toLowerCase());
      return {
        title: "Bestellung wurde storniert",
        body: refunded
          ? "Die Rückerstattung wurde veranlasst."
          : "Ihre Bestellung wurde storniert. Bei Fragen rufen Sie uns bitte an.",
      };
    }
    default:
      return null;
  }
}

async function subscriptionsForOrder(order: any) {
  const tenantId = order.tenantId || (await getTenantId());
  const meta = orderMeta(order);
  const customer = orderCustomer(order);
  const directId = cleanText(meta.generalPushSubscriptionId, 100);
  const phone = normalizePhone(customer.phone);
  const email = normalizeEmail(customer.email);
  const where: Record<string, any> = {
    tenantId,
    appScope: GENERAL_PUSH_APP_SCOPE,
    active: true,
    preference: {
      is: { OR: [{ allNotifications: true }, { orderUpdates: true }] },
    },
  };

  if (directId) {
    where.id = directId;
  } else if (phone || email) {
    where.OR = [
      ...(phone ? [{ phone }] : []),
      ...(email ? [{ email }] : []),
    ];
  } else {
    return [];
  }

  return (prisma as any).pushSubscription.findMany({
    where,
    include: { preference: true },
    take: 5,
  });
}

export async function notifyGeneralOrderStatus(
  order: any,
  previousStatus: string,
  nextStatus: string,
) {
  if (!nextStatus || previousStatus === nextStatus) return { queued: 0 };
  if (cleanText(order?.channel, 60).toLowerCase() === "schnellbestellung") {
    return { queued: 0 };
  }

  const text = statusNotificationText(order, nextStatus);
  if (!text) return { queued: 0 };
  const subscriptions = await subscriptionsForOrder(order);
  let queued = 0;

  for (const subscription of subscriptions) {
    const result = await queueAndSendGeneralNotification({
      subscriptionId: subscription.id,
      type: `order_${nextStatus}`,
      title: text.title,
      body: text.body,
      url: trackingUrl(order),
      orderId: order.id,
      dedupeKey: `order:${order.id}:${nextStatus}:${subscription.id}`,
      payload: {
        orderId: order.id,
        status: nextStatus,
      },
    });
    if (!(result as any)?.deduped) queued += 1;
  }

  return { queued };
}

export async function notifyOrderRefundExecuted(order: any, refundResult?: any) {
  if (cleanText(order?.channel, 60).toLowerCase() === "schnellbestellung") {
    return { queued: 0 };
  }
  const status = cleanText(refundResult?.status, 80).toLowerCase();
  if (!["refunded", "partially_refunded"].includes(status)) {
    return { queued: 0 };
  }

  const subscriptions = await subscriptionsForOrder(order);
  let queued = 0;
  for (const subscription of subscriptions) {
    const result = await queueAndSendGeneralNotification({
      subscriptionId: subscription.id,
      type: "order_refunded",
      title: "Erstattung wurde ausgeführt ✅",
      body:
        status === "partially_refunded"
          ? "Die teilweise Rückerstattung wurde erfolgreich ausgeführt."
          : "Die Rückerstattung wurde erfolgreich ausgeführt.",
      url: trackingUrl(order),
      orderId: order.id,
      dedupeKey: `order:${order.id}:refunded:${subscription.id}`,
      payload: { orderId: order.id, status: "refunded" },
    });
    if (!(result as any)?.deduped) queued += 1;
  }
  return { queued };
}

export async function bindGeneralPushToOrder(
  subscription: any,
  order: any,
) {
  const tenantId = order.tenantId || (await getTenantId());
  const customer = orderCustomer(order);
  const meta = orderMeta(order);
  const phone = normalizePhone(customer.phone);
  const email = normalizeEmail(customer.email);
  const plz = normalizePlz(customer.plz || customer.zip || order.plz);
  const street = normalizeStreet(
    customer.street || customer.address || customer.addressLine,
  );
  const customerRow = phone
    ? await (prisma as any).customer.findFirst({
        where: { tenantId, phone },
        select: { id: true },
      })
    : null;

  await (prisma as any).$transaction([
    (prisma as any).pushSubscription.update({
      where: { id: subscription.id },
      data: {
        customerId: customerRow?.id || subscription.customerId || null,
        phone,
        email,
        appScope: GENERAL_PUSH_APP_SCOPE,
        lastSeenAt: new Date(),
      },
    }),
    (prisma as any).notificationPreference.upsert({
      where: { subscriptionId: subscription.id },
      update: {
        plz,
        street,
      },
      create: {
        tenantId,
        subscriptionId: subscription.id,
        allNotifications: false,
        orderUpdates: true,
        orderConsentedAt: new Date(),
        plz,
        street,
      },
    }),
    (prisma as any).order.update({
      where: { id: order.id },
      data: {
        meta: jsonForDb({
          ...meta,
          generalPushSubscriptionId: subscription.id,
          generalPushBoundAt: Date.now(),
        }),
      },
    }),
  ]);

  const text = statusNotificationText(order, "new");
  if (text) {
    await queueAndSendGeneralNotification({
      subscriptionId: subscription.id,
      type: "order_new",
      title: text.title,
      body: text.body,
      url: trackingUrl(order),
      orderId: order.id,
      dedupeKey: `order:${order.id}:new:${subscription.id}`,
      payload: { orderId: order.id, status: "new" },
    });
  }
}

export async function notifyCouponAssigned(input: {
  tenantId?: string;
  phone?: unknown;
  email?: unknown;
  code: string;
  expiresAt?: Date | number | string | null;
}) {
  const tenantId = input.tenantId || (await getTenantId());
  const phone = normalizePhone(input.phone);
  const email = normalizeEmail(input.email);
  if (!phone && !email) return { queued: 0 };

  const subscriptions = await (prisma as any).pushSubscription.findMany({
    where: {
      tenantId,
      appScope: GENERAL_PUSH_APP_SCOPE,
      active: true,
      OR: [
        ...(phone ? [{ phone }] : []),
        ...(email ? [{ email }] : []),
      ],
      preference: {
        is: {
          marketingConsentedAt: { not: null },
          OR: [{ allNotifications: true }, { coupons: true }],
        },
      },
    },
    take: 10,
  });
  const expiry = input.expiresAt ? new Date(input.expiresAt) : null;
  const expiryText =
    expiry && Number.isFinite(expiry.valueOf())
      ? ` Gültig bis ${new Intl.DateTimeFormat("de-DE").format(expiry)}.`
      : "";

  for (const subscription of subscriptions) {
    await queueAndSendGeneralNotification({
      subscriptionId: subscription.id,
      type: "coupon_assigned",
      title: "Ihr persönlicher Gutschein ist da! 🎁",
      body: `Code ${cleanText(input.code, 80)} wurde für Sie freigeschaltet.${expiryText}`,
      url: "/menu",
      dedupeKey: `coupon:${cleanText(input.code, 100)}:${subscription.id}`,
      payload: { code: cleanText(input.code, 100) },
    });
  }

  return { queued: subscriptions.length };
}

function identityKeys(value: any) {
  const customer = orderCustomer(value);
  return {
    phone: normalizePhone(customer.phone || value?.phone),
    email: normalizeEmail(customer.email || value?.email),
  };
}

function streetClusterMap(value: unknown) {
  const model = plainObject(value);
  const clusters = Array.isArray(model.clusters) ? model.clusters : [];
  const map = new Map<string, string>();
  clusters.forEach((cluster: any, index: number) => {
    const id = cleanText(cluster?.id, 100) || `cluster-${index + 1}`;
    const streets = Array.isArray(cluster?.streets) ? cluster.streets : [];
    streets.forEach((street: unknown) => {
      const normalized = normalizeStreet(street);
      if (normalized) map.set(normalized, id);
    });
  });
  return map;
}

type DeliveryAddressSnapshot = NearbyAddressSnapshot & {
  ts: number;
};

type DeliveryHistory = {
  count: number;
  addresses: DeliveryAddressSnapshot[];
};

function orderAddressSnapshot(order: any): DeliveryAddressSnapshot | null {
  const customer = orderCustomer(order);
  const meta = orderMeta(order);
  const plz = normalizePlz(customer.plz || customer.zip || order?.plz);
  const street = normalizeStreet(
    customer.street || customer.address || customer.addressLine,
  );
  if (!plz && !street) return null;

  return {
    plz,
    street,
    lat: finiteNumber(
      customer.lat ?? customer.latitude ?? meta.deliveryLat ?? meta.lat,
      -90,
      90,
    ),
    lng: finiteNumber(
      customer.lng ?? customer.longitude ?? meta.deliveryLng ?? meta.lng,
      -180,
      180,
    ),
    ts: new Date(order?.ts || order?.createdAt || 0).valueOf() || 0,
  };
}

function addDeliveryHistory(
  map: Map<string, DeliveryHistory>,
  key: string | null,
  address: DeliveryAddressSnapshot | null,
) {
  if (!key) return;
  const current = map.get(key) || { count: 0, addresses: [] };
  current.count += 1;

  if (address) {
    const addressKey = `${address.plz || ""}|${address.street || ""}`;
    const exists = current.addresses.some(
      (item) => `${item.plz || ""}|${item.street || ""}` === addressKey,
    );
    if (!exists) current.addresses.push(address);
    current.addresses.sort((left, right) => right.ts - left.ts);
    current.addresses = current.addresses.slice(0, 20);
  }

  map.set(key, current);
}

export async function notifyNearbyDelivery(order: any) {
  const status = cleanText(order?.status, 40).toLowerCase();
  if (status !== "out_for_delivery" || orderMode(order) !== "delivery") {
    return { queued: 0 };
  }

  const tenantId = order.tenantId || (await getTenantId());
  const [settings, adminRouteGroups] = await Promise.all([
    readNearbyDeliverySettings(tenantId),
    readAdminRouteStreetGroups(),
  ]);
  if (!settings.enabled) return { queued: 0 };

  const sourceAddress = orderAddressSnapshot(order);
  if (!sourceAddress) return { queued: 0 };

  const customer = orderCustomer(order);
  const meta = orderMeta(order);
  const currentPhone = normalizePhone(customer.phone);
  const currentEmail = normalizeEmail(customer.email);
  const excludedSubscriptionId = cleanText(meta.generalPushSubscriptionId, 100);

  const candidates = await (prisma as any).pushSubscription.findMany({
    where: {
      tenantId,
      appScope: GENERAL_PUSH_APP_SCOPE,
      active: true,
      ...(excludedSubscriptionId ? { id: { not: excludedSubscriptionId } } : {}),
      preference: {
        is: {
          marketingConsentedAt: { not: null },
          OR: [{ allNotifications: true }, { nearbyDelivery: true }],
        },
      },
    },
    include: { preference: true, customer: true },
    take: 500,
  });
  if (!candidates.length) return { queued: 0 };

  const activeOrders = await (prisma as any).order.findMany({
    where: {
      tenantId,
      status: { notIn: ["done", "cancelled"] },
      id: { not: order.id },
    },
    select: { customer: true },
    take: 5_000,
  });
  const activePhones = new Set<string>();
  const activeEmails = new Set<string>();
  activeOrders.forEach((activeOrder: any) => {
    const identity = identityKeys(activeOrder);
    if (identity.phone) activePhones.add(identity.phone);
    if (identity.email) activeEmails.add(identity.email);
  });

  // The recipient address is derived only from previous completed delivery orders.
  // No street, PLZ or device location is requested during notification permission.
  const completedOrders = await (prisma as any).order.findMany({
    where: {
      tenantId,
      status: "done",
      id: { not: order.id },
    },
    select: { customer: true, meta: true, mode: true, ts: true, createdAt: true },
    orderBy: { ts: "desc" },
    take: 20_000,
  });

  const historyByPhone = new Map<string, DeliveryHistory>();
  const historyByEmail = new Map<string, DeliveryHistory>();
  completedOrders.forEach((completedOrder: any) => {
    if (orderMode(completedOrder) !== "delivery") return;
    const identity = identityKeys(completedOrder);
    const address = orderAddressSnapshot(completedOrder);
    addDeliveryHistory(historyByPhone, identity.phone, address);
    addDeliveryHistory(historyByEmail, identity.email, address);
  });

  const brianModel = settings.routeCluster
    ? await (prisma as any).brianRouteModel.findFirst({
        where: { tenantId, key: "current" },
        orderBy: { generatedAt: "desc" },
        select: { model: true },
      })
    : null;
  const clusters = streetClusterMap(brianModel?.model);
  const sourceCluster = sourceAddress.street
    ? clusters.get(sourceAddress.street) || null
    : null;

  const allGroups = [...adminRouteGroups, ...settings.streetGroups];
  const normalizedGroups = allGroups.map((group) => ({
    id: group.id,
    plz: new Set(group.plz || []),
    streets: new Set(
      group.streets.map(normalizeStreet).filter(Boolean) as string[],
    ),
  }));
  const sourceGroups = normalizedGroups
    .filter((group) => groupAcceptsNearbyAddress(group, sourceAddress))
    .map((group) => group.id);
  const streetGroupsEnabled =
    settings.streetGroupsEnabled || adminRouteGroups.length > 0;

  const ranked: Array<{ subscription: any; rank: number; matchType: string }> = [];
  for (const subscription of candidates) {
    const phone = normalizePhone(subscription.phone || subscription.customer?.phone);
    const email = normalizeEmail(subscription.email || subscription.customer?.email);
    if ((currentPhone && phone === currentPhone) || (currentEmail && email === currentEmail)) {
      continue;
    }
    if ((phone && activePhones.has(phone)) || (email && activeEmails.has(email))) {
      continue;
    }

    const phoneHistory = phone ? historyByPhone.get(phone) : null;
    const emailHistory = email ? historyByEmail.get(email) : null;
    const historyCount = Math.max(phoneHistory?.count || 0, emailHistory?.count || 0);
    if (historyCount < settings.minimumPastOrders) continue;

    const addressMap = new Map<string, DeliveryAddressSnapshot>();
    for (const address of [
      ...(phoneHistory?.addresses || []),
      ...(emailHistory?.addresses || []),
    ]) {
      addressMap.set(`${address.plz || ""}|${address.street || ""}`, address);
    }
    const addresses = Array.from(addressMap.values());
    if (!addresses.length) continue;

    let bestMatch = { rank: 0, matchType: "" };
    for (const candidateAddress of addresses) {
      const match = rankNearbyDeliveryMatch({
        source: sourceAddress,
        candidate: candidateAddress,
        settings: {
          sameStreet: settings.sameStreet,
          streetGroupsEnabled,
          samePlz: settings.samePlz,
          routeCluster: settings.routeCluster,
          radiusEnabled: settings.radiusEnabled,
          radiusM: settings.radiusM,
        },
        groups: normalizedGroups,
        sourceGroupIds: sourceGroups,
        sourceCluster,
        clusterByStreet: clusters,
      });
      if (match.rank > bestMatch.rank) bestMatch = match;
    }

    if (bestMatch.rank > 0) {
      ranked.push({
        subscription,
        rank: bestMatch.rank,
        matchType: bestMatch.matchType,
      });
    }
  }

  ranked.sort((a, b) => b.rank - a.rank);
  const now = new Date();
  const cooldownSince = new Date(
    now.getTime() - settings.cooldownHours * 60 * 60_000,
  );
  const recentEvents = await (prisma as any).notificationEvent.findMany({
    where: {
      tenantId,
      type: "nearby_delivery",
      createdAt: { gte: cooldownSince },
    },
    include: {
      subscription: {
        select: { id: true, phone: true, email: true, customerId: true },
      },
    },
    take: 5_000,
  });
  const recentSubscriptionIds = new Set<string>();
  const recentCustomerIds = new Set<string>();
  const recentPhones = new Set<string>();
  const recentEmails = new Set<string>();
  recentEvents.forEach((event: any) => {
    const recentSubscription = event.subscription;
    if (recentSubscription?.id) recentSubscriptionIds.add(recentSubscription.id);
    if (recentSubscription?.customerId) recentCustomerIds.add(recentSubscription.customerId);
    const phone = normalizePhone(recentSubscription?.phone);
    const email = normalizeEmail(recentSubscription?.email);
    if (phone) recentPhones.add(phone);
    if (email) recentEmails.add(email);
  });

  const expiresAt = new Date(now.getTime() + settings.opportunityMinutes * 60_000);
  let queued = 0;

  for (const candidate of ranked) {
    if (queued >= settings.maxRecipients) break;

    const candidatePhone = normalizePhone(
      candidate.subscription.phone || candidate.subscription.customer?.phone,
    );
    const candidateEmail = normalizeEmail(
      candidate.subscription.email || candidate.subscription.customer?.email,
    );
    const recentlyNotified =
      recentSubscriptionIds.has(candidate.subscription.id) ||
      Boolean(
        candidate.subscription.customerId &&
          recentCustomerIds.has(candidate.subscription.customerId),
      ) ||
      Boolean(candidatePhone && recentPhones.has(candidatePhone)) ||
      Boolean(candidateEmail && recentEmails.has(candidateEmail));
    if (recentlyNotified) continue;

    const result = await queueAndSendGeneralNotification({
      subscriptionId: candidate.subscription.id,
      type: "nearby_delivery",
      title: "Wir liefern gerade in Ihre Nähe! 🍔",
      body: `Nur für die nächsten ${settings.opportunityMinutes} Minuten: Jetzt direkt bei Burger Brothers bestellen.`,
      url: "/menu",
      orderId: order.id,
      dedupeKey: `nearby:${order.id}:${candidate.subscription.id}`,
      expiresAt,
      payload: {
        matchType: candidate.matchType,
        expiresAt: expiresAt.toISOString(),
      },
    });
    if (!(result as any)?.deduped) queued += 1;
  }

  return { queued };
}

export type AdminBroadcastInput = {
  kind: "campaign" | "offer" | "announcement" | "coupon" | "nearby";
  title: string;
  body: string;
  url?: string | null;
  imageUrl?: string | null;
  audience?: "all" | "plz" | "phone";
  plz?: string | null;
  phone?: string | null;
  createdBy?: string | null;
};

export async function createAdminBroadcast(input: AdminBroadcastInput) {
  const tenantId = await getTenantId();
  const kind = input.kind;
  const preferenceField =
    kind === "coupon"
      ? "coupons"
      : kind === "nearby"
        ? "nearbyDelivery"
        : "campaigns";
  const plz = normalizePlz(input.plz);
  const phone = normalizePhone(input.phone);
  const audience = input.audience || "all";
  if (audience === "plz" && !plz) throw new Error("invalid_plz");
  if (audience === "phone" && !phone) throw new Error("invalid_phone");

  const relationFilter: Record<string, any> = {
    marketingConsentedAt: { not: null },
    OR: [{ allNotifications: true }, { [preferenceField]: true }],
  };
  if (audience === "plz") relationFilter.plz = plz;

  const subscriptions = await (prisma as any).pushSubscription.findMany({
    where: {
      tenantId,
      appScope: GENERAL_PUSH_APP_SCOPE,
      active: true,
      ...(audience === "phone" && phone ? { phone } : {}),
      preference: { is: relationFilter },
    },
    take: 500,
  });

  const campaign = await (prisma as any).notificationCampaign.create({
    data: {
      tenantId,
      kind,
      title: cleanText(input.title, 160),
      body: cleanText(input.body, 600),
      url: normalizeNotificationUrl(input.url, "/menu"),
      imageUrl: normalizeImageUrl(input.imageUrl),
      audience: jsonForDb({ audience, plz, phone: phone ? "targeted" : null }),
      status: "sending",
      recipientCount: subscriptions.length,
      createdBy: cleanText(input.createdBy, 100) || "admin",
    },
  });

  const eventIds: string[] = [];
  for (const subscription of subscriptions) {
    const event = await queueGeneralNotification({
      subscriptionId: subscription.id,
      campaignId: campaign.id,
      type: kind === "offer" ? "offer" : kind,
      title: input.title,
      body: input.body,
      url: normalizeNotificationUrl(input.url, "/menu"),
      imageUrl: normalizeImageUrl(input.imageUrl),
      dedupeKey: `campaign:${campaign.id}:${subscription.id}`,
      payload: { campaignId: campaign.id, kind },
    });
    if (event?.id) eventIds.push(event.id);
  }

  return { campaign, eventIds, recipientCount: subscriptions.length };
}

export async function deliverAdminBroadcast(
  campaignId: string,
  eventIds: string[],
) {
  let successCount = 0;
  let failureCount = 0;

  for (let index = 0; index < eventIds.length; index += 10) {
    const batch = eventIds.slice(index, index + 10);
    const results = await Promise.all(
      batch.map((id) => sendGeneralNotificationEvent(id).catch(() => ({ ok: false }))),
    );
    successCount += results.filter((result: any) => result.ok).length;
    failureCount += results.filter((result: any) => !result.ok).length;
  }

  await (prisma as any).notificationCampaign.update({
    where: { id: campaignId },
    data: {
      status: failureCount > 0 && successCount === 0 ? "failed" : "sent",
      sentAt: new Date(),
      successCount,
      failureCount,
    },
  });

  return { successCount, failureCount };
}
