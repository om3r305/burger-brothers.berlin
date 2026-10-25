import type { SchnellPushSendResult } from "@/lib/server/schnell-push";
import { createHash, randomBytes } from "node:crypto";
import { prisma, getTenantId } from "@/lib/db";
import { parseFcmEndpoint, sendFcmAlert } from "@/lib/server/fcm";
import { getSchnellSettings } from "@/lib/server/schnellbestellung";
const SCOPE = "schnell_app";
async function deliver(event: any): Promise<SchnellPushSendResult> {
  const subscription = event.subscription;
  const order = event.order;
  const meta = order?.meta || {};
  if (
    !subscription?.active ||
    subscription.appScope !== SCOPE ||
    parseFcmEndpoint(subscription.endpoint)?.kind !== "schnell" ||
    !order ||
    order.channel !== "schnellbestellung" ||
    !["ready", "done"].includes(String(order.status)) ||
    String(meta.deviceId || "") !== String(subscription.deviceId || "") ||
    String(meta.readyEventId || "") !==
      String(event.payload?.readyEventId || "") ||
    new Date(event.expiresAt || 0) <= new Date()
  ) {
    await prisma.notificationEvent.update({
      where: { id: event.id },
      data: { status: "expired" },
    });
    return { attempted: false, ok: false, expired: false, status: 0 };
  }
  const result = await sendFcmAlert(subscription.endpoint, {
    title: event.title,
    body: event.body,
    url: event.url,
    type: "schnell_ready",
    eventId: event.dedupeKey,
    ttlSeconds: 300,
  });
  await prisma.notificationEvent.update({
    where: { id: event.id },
    data: {
      status: result.ok ? "sent" : result.expired ? "failed" : "queued",
      availableAt: new Date(Date.now() + 60_000),
    },
  });
  if (result.expired)
    await prisma.pushSubscription.update({
      where: { id: subscription.id },
      data: { active: false },
    });
  return result;
}
export async function queueNativeSchnellReady(
  order: any,
  subscriptionValue: any,
): Promise<SchnellPushSendResult> {
  const target = parseFcmEndpoint(subscriptionValue?.endpoint);
  const meta = order?.meta || {};
  if (
    order?.channel !== "schnellbestellung" ||
    target?.kind !== "schnell" ||
    !meta.deviceId ||
    !meta.readyEventId
  )
    return { attempted: false, ok: false, expired: false, status: 0 };
  const tenantId = await getTenantId();
  if (String(order.tenantId) !== tenantId)
    return { attempted: false, ok: false, expired: false, status: 0 };
  const fields = {
    p256dh: "",
    auth: "",
    platform: "android",
    appScope: SCOPE,
    deviceId: String(meta.deviceId),
    active: true,
    lastSeenAt: new Date(),
  };
  const subscription = await prisma.pushSubscription.upsert({
    where: {
      tenantId_endpoint: { tenantId, endpoint: subscriptionValue.endpoint },
    },
    create: {
      tenantId,
      endpoint: subscriptionValue.endpoint,
      ...fields,
      deviceTokenHash: createHash("sha256")
        .update(randomBytes(32))
        .digest("hex"),
    },
    update: fields,
  });
  const dedupeKey = `schnell:${order.id}:${meta.readyEventId}:${subscription.id}`;
  let event;
  try {
    event = await prisma.notificationEvent.create({
      data: {
        tenantId,
        subscriptionId: subscription.id,
        orderId: order.id,
        type: "schnell_ready",
        title: "Ihre Bestellung ist fertig",
        body: "Bitte holen Sie Ihre Bestellung am Tresen ab.",
        url: `/schnellbestellung/success?order=${encodeURIComponent(order.id)}`,
        status: "queued",
        dedupeKey,
        payload: { readyEventId: String(meta.readyEventId) },
        expiresAt: new Date(Date.now() + 15 * 60_000),
      },
    });
  } catch (error: any) {
    if (error?.code === "P2002")
      return { attempted: false, ok: true, expired: false, status: 0 };
    throw error;
  }
  return deliver({ ...event, subscription, order });
}
export async function flushNativeSchnellNotifications() {
  const settings = await getSchnellSettings({ includeTvPause: false });
  if (!settings.backgroundReadyPushEnabled) return { checked: 0, sent: 0 };
  const tenantId = await getTenantId();
  const events = await prisma.notificationEvent.findMany({
    where: {
      tenantId,
      type: "schnell_ready",
      status: "queued",
      availableAt: { lte: new Date() },
      subscription: { appScope: SCOPE },
    },
    include: { order: true, subscription: true },
    take: 30,
  });
  let sent = 0;
  for (const event of events) {
    if ((await deliver(event)).ok) sent++;
  }
  return { checked: events.length, sent };
}
