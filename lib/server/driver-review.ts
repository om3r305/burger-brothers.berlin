import { NextResponse } from "next/server";
import { prisma, getTenantId } from "@/lib/db";
import { DRIVER_REVIEW_ID } from "@/lib/driver/review-identity";
import { sanitizeOrderForDriver } from "@/lib/server/driver-order";

// Isolated sandbox state: never read or write Order, TrackingSession,
// Customer, payment, printing, or notification tables here.
const KEY = "driver_review_sandbox_v1";
const identity = { id: DRIVER_REVIEW_ID, name: "App Review" };
type DemoOrder = Record<string, any>;

function json(value: Record<string, any>, status = 200) {
  return NextResponse.json({ ...value, review: true }, {
    status, headers: { "Cache-Control": "no-store, no-cache, must-revalidate" },
  });
}
function day() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin" }).format(new Date());
}
export function driverReviewFixtures(now = Date.now()): DemoOrder[] {
  const destinations = [
    ["Demo Auftrag A", "Alexanderplatz 1, 10178 Berlin", 52.5219, 13.4132],
    ["Demo Auftrag B", "Pariser Platz 1, 10117 Berlin", 52.5163, 13.3777],
    ["Demo Auftrag C", "Platz der Republik 1, 11011 Berlin", 52.5186, 13.3762],
    ["Demo Auftrag D", "Museumsinsel 1, 10178 Berlin", 52.5200, 13.4010],
  ];
  return destinations.map(([name, address, lat, lng], index) => {
    const assigned = index >= 2;
    const ts = new Date(now - (index + 1) * 60_000).toISOString();
    const total = 12.5 + index;
    return {
      id: `review-driver-${index + 1}`, orderId: `review-driver-${index + 1}`,
      mode: "delivery", channel: "web", status: index === 3 ? "done" : "ready",
      ts, createdAt: ts, updatedAt: ts, etaMin: 25, etaAdjustMin: 0,
      doneAt: index === 3 ? ts : null, driver: assigned ? identity : null,
      customer: { name, address, addressLine: address, phone: "", city: "Berlin",
        plz: String(address).match(/\d{5}/)?.[0], deliveryHint: "DEMO – keine echte Lieferung. Öffentlicher Beispielort." },
      items: [{ id: "demo-burger", name: "Demo Burger Menü", qty: 1, quantity: 1,
        price: total, unitPrice: total, note: "Nur Testdaten – nicht zubereiten" }],
      merchandise: total, discount: 0, surcharges: 0, total,
      meta: { source: "app-review-demo", note: "DEMO – ausschließlich fiktive Testbestellung",
        paymentMethod: "cash", paymentStatus: "unpaid", createdAtMs: now,
        driver: assigned ? identity : null, driverId: assigned ? identity.id : null,
        deliveryGeo: { lat, lng, source: "demo-public-landmark" } },
    };
  });
}
async function state(): Promise<DemoOrder[]> {
  const tenantId = await getTenantId();
  const row = await prisma.setting.findUnique({ where: { tenantId_key: { tenantId, key: KEY } } });
  const stored = row?.value as any;
  return stored?.day === day() && Array.isArray(stored.orders)
    ? stored.orders : driverReviewFixtures();
}
async function save(orders: DemoOrder[]) {
  const tenantId = await getTenantId();
  const value = { day: day(), orders };
  await prisma.setting.upsert({
    where: { tenantId_key: { tenantId, key: KEY } },
    create: { tenantId, key: KEY, value: value as any }, update: { value: value as any },
  });
}
export async function resetDriverReview() { await save(driverReviewFixtures()); }
function orderResponse(order: DemoOrder) {
  const visible = sanitizeOrderForDriver(order);
  return json({ ok: true, order: visible, item: visible, data: visible });
}
export async function driverReviewList() {
  const orders = (await state()).map(sanitizeOrderForDriver);
  return json({ ok: true, orders, items: orders, allOrders: orders, count: orders.length });
}
export async function driverReviewGet(id: string) {
  const order = (await state()).find((item) => item.id === id);
  return order ? orderResponse(order) : json({ ok: false, error: "not_found" }, 404);
}
export async function driverReviewMutation(action: "claim" | "status", body: any) {
  const orders = await state();
  const id = String(body?.id ?? body?.orderId ?? body?.code ?? "").trim();
  const order = orders.find((item) => item.id === id);
  if (!order) return json({ ok: false, error: "not_found" }, 404);
  if (action === "claim") {
    if (order.status !== "ready") return json({ ok: false, error: "order_not_ready" }, 409);
    order.driver = identity;
    Object.assign(order.meta, { driver: identity, driverId: identity.id, driverName: identity.name, claimedAt: Date.now() });
  } else {
    if (order.driver?.id !== identity.id) return json({ ok: false, error: "order_not_assigned_to_driver" }, 403);
    const next = String(body?.status ?? body?.nextStatus ?? "");
    const allowed = next === order.status ||
      (order.status === "ready" && next === "out_for_delivery") ||
      (order.status === "out_for_delivery" && ["done", "ready"].includes(next));
    if (!allowed) return json({ ok: false, error: "driver_status_transition_not_allowed" }, 403);
    order.status = next;
    if (next === "out_for_delivery") order.meta.outForDeliveryAt = Date.now();
    if (next === "done") order.doneAt = new Date().toISOString();
    if (next === "ready" && body?.clearDriver === true) {
      order.driver = null;
      Object.assign(order.meta, { driver: null, driverId: null, driverName: null });
    }
  }
  order.updatedAt = new Date().toISOString();
  order.meta.statusManual = order.status;
  await save(orders);
  return orderResponse(order);
}
export async function driverReviewNotification(body: any) {
  const id = String(body?.orderId ?? body?.id ?? "");
  const order = (await state()).find((item) => item.id === id && item.driver?.id === identity.id);
  if (!order) return json({ ok: false, error: "not_found" }, 404);
  return json({ ok: true, simulated: true, subscriptions: 0, accepted: 0, queued: 0, deduped: 1 });
}
export async function driverReviewNativeRoute() {
  const orderIds = (await state()).filter((item) => item.driver?.id === identity.id && item.status === "out_for_delivery").map((item) => item.id);
  return json({ ok: true, driverId: identity.id, orderIds });
}
export async function driverReviewTracking(body: any) {
  if (body?.driverId && body.driverId !== identity.id) return json({ ok: false, error: "driver_identity_mismatch" }, 403);
  const ids = Array.isArray(body?.orderIds) ? body.orderIds : [];
  const orders = await state();
  if (ids.some((id: unknown) => !orders.some((o) => o.id === id && o.driver?.id === identity.id && o.status === "out_for_delivery"))) {
    return json({ ok: false, error: "invalid_tracking_orders" }, 403);
  }
  // Deliberately discard coordinates: this sandbox never publishes a live
  // reviewer position or sends anything to a customer.
  return json({ ok: true, simulated: true });
}
export function driverReviewNoop() { return json({ ok: true, simulated: true }); }
