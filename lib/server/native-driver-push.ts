import { createHash, randomBytes } from "node:crypto";
import { prisma, getTenantId } from "@/lib/db";
import { driverCanSeeOrder } from "@/lib/server/driver-order";
import { driverSessionIsCurrent } from "@/lib/server/driver-session";
import { parseFcmEndpoint, sendFcmAlert } from "@/lib/server/fcm";
import type { SessionPayload } from "@/lib/server/session";
export const DRIVER_PUSH_SCOPE = "driver_app";
export function newDriverDeviceHash() {
  return createHash("sha256").update(randomBytes(32)).digest("hex");
}
async function sendDriverEvent(event: any) {
  const device = event.subscription;
  const cancel = async () => {
    await prisma.notificationEvent.update({
      where: { id: event.id },
      data: { status: "expired" },
    });
    return false;
  };
  if (
    !device?.active ||
    device.appScope !== DRIVER_PUSH_SCOPE ||
    !device.deviceId ||
    !device.expirationTime ||
    new Date(device.expirationTime) <= new Date() ||
    !event.order ||
    !["new", "preparing", "ready", "out_for_delivery"].includes(
      String(event.order.status),
    ) ||
    !driverCanSeeOrder(event.order, device.deviceId) ||
    parseFcmEndpoint(device.endpoint)?.kind !== "driver" ||
    (event.expiresAt && new Date(event.expiresAt) <= new Date())
  )
    return cancel();
  const current = await driverSessionIsCurrent({
    role: "driver",
    sub: device.deviceId,
    credential: device.auth,
  } as SessionPayload);
  if (!current) {
    await prisma.pushSubscription.update({
      where: { id: device.id },
      data: { active: false },
    });
    return cancel();
  }
  const result = await sendFcmAlert(device.endpoint, {
    title: event.title,
    body: event.body,
    url: "/driver",
    type: "driver_order",
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
      where: { id: device.id },
      data: { active: false },
    });
  return result.ok;
}
export async function flushNativeDriverNotifications() {
  const tenantId = await getTenantId();
  const events = await prisma.notificationEvent.findMany({
    where: {
      tenantId,
      status: "queued",
      type: "driver_order",
      availableAt: { lte: new Date() },
      subscription: { appScope: DRIVER_PUSH_SCOPE },
    },
    include: { subscription: true, order: true },
    take: 30,
  });
  let sent = 0;
  for (const event of events) if (await sendDriverEvent(event)) sent++;
  return { sent, checked: events.length };
}
export async function notifyNativeDriversForOrder(
  order: any,
  previousStatus: string,
  nextStatus: string,
) {
  if (
    !order?.id ||
    previousStatus === nextStatus ||
    !["new", "preparing", "ready", "out_for_delivery"].includes(nextStatus) ||
    String(order.mode).toLowerCase() !== "delivery"
  )
    return { sent: 0 };
  const tenantId = await getTenantId();
  const devices = await prisma.pushSubscription.findMany({
    where: {
      tenantId,
      appScope: DRIVER_PUSH_SCOPE,
      active: true,
      expirationTime: { gt: new Date() },
    },
    take: 200,
  });
  let sent = 0;
  for (const device of devices) {
    if (!device.deviceId || !driverCanSeeOrder(order, device.deviceId))
      continue;
    const dedupeKey = `driver:${order.id}:${nextStatus}:${device.id}`;
    let event;
    try {
      event = await prisma.notificationEvent.create({
        data: {
          tenantId,
          subscriptionId: device.id,
          orderId: order.id,
          type: "driver_order",
          title:
            nextStatus === "new" ? "Neue Lieferung" : "Lieferung aktualisiert",
          body: "Bitte öffnen Sie BB Driver für die aktuellen Lieferungen.",
          url: "/driver",
          status: "queued",
          dedupeKey,
          expiresAt: new Date(Date.now() + 15 * 60_000),
        },
      });
    } catch (error: any) {
      if (error?.code === "P2002") continue;
      throw error;
    }
    if (await sendDriverEvent({ ...event, subscription: device, order }))
      sent++;
  }
  return { sent };
}
