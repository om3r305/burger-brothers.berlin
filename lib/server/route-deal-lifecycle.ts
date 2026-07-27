import { prisma } from "@/lib/db";
import { getServerSettings, saveServerSettings } from "@/lib/server/settings";
import {
  normalizePlz,
  routeDealMatchesAddress,
  routeDealStreetLabel,
} from "@/lib/streets";

function object(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, any>)
    : {};
}

function array(value: unknown): any[] {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown, max = 180) {
  return String(value ?? "").trim().slice(0, max);
}

function number(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function stringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => text(item, 180)).filter(Boolean);
  }

  if (typeof value === "string") {
    return value
      .split(/[;,\n]/g)
      .map((item) => text(item, 180))
      .filter(Boolean);
  }

  return [];
}

function orderMode(order: any) {
  const raw = text(order?.mode, 40).toLowerCase();
  return ["delivery", "lieferung"].includes(raw) ? "delivery" : "pickup";
}

function orderCustomer(order: any) {
  return object(order?.customer);
}

function orderMeta(order: any) {
  return object(order?.meta);
}

function routeDealWasAppliedToOrder(order: any) {
  const meta = orderMeta(order);
  const pricing = object(meta.pricing);
  const canonical = object(pricing.routeDeal);
  const submitted = object(meta.routeDeal);

  return Boolean(
    canonical.applied === true ||
      number(canonical.discountAmount ?? canonical.discount, 0) > 0 ||
      text(canonical.id, 160) ||
      text(submitted.id, 160),
  );
}

function normalizeReward(value: unknown) {
  const raw = object(value);
  const type = [
    "percent",
    "fixed",
    "free_delivery",
    "free_sauce",
    "free_drink",
  ].includes(text(raw.type, 40))
    ? text(raw.type, 40)
    : "percent";

  return {
    ...raw,
    type,
    percent: Math.min(
      100,
      Math.max(0, number(raw.percent ?? raw.value, 15)),
    ),
    amount: Math.max(0, number(raw.amount ?? raw.fixedAmount, 0)),
    maxDiscount: Math.max(0, number(raw.maxDiscount, 0)),
    freeItemName: text(raw.freeItemName, 180),
    freeItemCategory:
      text(raw.freeItemCategory, 80) ||
      (type === "free_drink"
        ? "drinks"
        : type === "free_sauce"
          ? "sauces"
          : ""),
  };
}

function makeRouteDealId(ruleId: string, orderId: string, nowMs: number) {
  const cleanRule = String(ruleId || "route-deal")
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);

  return `rd-${cleanRule || "deal"}-${orderId}-${nowMs.toString(36)}`;
}

async function loadOrder(orderOrId: unknown) {
  if (
    orderOrId &&
    typeof orderOrId === "object" &&
    !Array.isArray(orderOrId)
  ) {
    return orderOrId as Record<string, any>;
  }

  const orderId = text(orderOrId, 160);
  if (!orderId) return null;

  return (prisma as any).order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      tenantId: true,
      status: true,
      mode: true,
      customer: true,
      meta: true,
      planned: true,
      ts: true,
      createdAt: true,
    },
  });
}

function orderAddress(order: any) {
  const customer = orderCustomer(order);

  return {
    plz: customer.plz ?? customer.zip ?? order?.plz ?? order?.zip ?? null,
    zip: customer.zip ?? customer.plz ?? order?.zip ?? order?.plz ?? null,
    postalCode: customer.postalCode ?? null,
    street: customer.street ?? null,
    addressLine: customer.addressLine ?? order?.addressLine ?? null,
    address: customer.address ?? order?.address ?? null,
  };
}

/**
 * Aktif rota fırsatını kaynak sipariş kimliğiyle bulur.
 *
 * Fırsat yalnız sipariş restorandayken geçerlidir. Geplant siparişler create
 * aşamasında zaten fırsat oluşturmaz; yola çıkan siparişin fırsatı da kapatılır.
 */
export async function findActiveRouteDealOpportunityForOrder(
  orderOrId: unknown,
) {
  const order = await loadOrder(orderOrId);
  const orderId = text(order?.id ?? orderOrId, 160);
  if (!orderId) return null;

  const settings = await getServerSettings();
  const routeDeals = object(settings?.routeDeals);
  if (routeDeals.enabled !== true) return null;

  const nowMs = Date.now();

  return (
    array(routeDeals.active).find((deal) => {
      const expiresAtMs = Date.parse(text(deal?.expiresAt, 80));
      return Boolean(
        text(deal?.orderId, 160) === orderId &&
          text(deal?.status, 30) !== "closed" &&
          Number.isFinite(expiresAtMs) &&
          expiresAtMs > nowMs,
      );
    }) || null
  );
}

/**
 * Kaynak sipariş Unterwegs olduğunda fırsatı anında kapatır.
 *
 * Kapanan fırsat kısa süreli bir bilgi kaydı olarak tutulur. Böylece aynı
 * PLZ/sokaktaki uygun müşteri yeşil indirim yerine “Fahrer bereits unterwegs”
 * bilgisini görür; ancak indirim artık server-side uygun sayılmaz.
 */
export async function closeRouteDealOpportunityForOrder(
  orderOrId: unknown,
  reason = "source_order_out_for_delivery",
) {
  const order = await loadOrder(orderOrId);
  const orderId = text(order?.id ?? orderOrId, 160);
  if (!orderId) return null;

  const settings = await getServerSettings();
  const routeDeals = object(settings?.routeDeals);
  if (routeDeals.enabled !== true) return null;

  const active = array(routeDeals.active);
  const currentIndex = active.findIndex(
    (deal) => text(deal?.orderId, 160) === orderId,
  );
  if (currentIndex < 0) return null;

  const now = new Date();
  const nowMs = now.getTime();
  const current = object(active[currentIndex]);
  const durationMinutes = Math.max(
    1,
    Math.min(
      60,
      Math.round(
        number(
          current.durationMinutes,
          number(routeDeals.defaultDurationMinutes, 12),
        ),
      ),
    ),
  );

  const closedDeal: Record<string, any> = {
    ...current,
    status: "closed",
    closedAt: now.toISOString(),
    closedReason: text(reason, 80) || "source_order_out_for_delivery",
    originalExpiresAt: current.expiresAt || null,
    expiresAt: now.toISOString(),
    noticeExpiresAt: new Date(
      nowMs + Math.max(15, durationMinutes) * 60_000,
    ).toISOString(),
    trigger: {
      ...object(current.trigger),
      source: "out_for_delivery",
      orderId,
    },
  };

  const nextActive = active.filter((deal) => {
    if (text(deal?.orderId, 160) === orderId) return false;
    const expiresAtMs = Date.parse(text(deal?.expiresAt, 80));
    return Number.isFinite(expiresAtMs) && expiresAtMs > nowMs;
  });

  const previousClosed = array(routeDeals.closed).filter((deal) => {
    if (text(deal?.id, 160) === text(closedDeal.id, 160)) return false;
    const noticeExpiresAtMs = Date.parse(
      text(deal?.noticeExpiresAt ?? deal?.closedAt, 80),
    );
    return (
      Number.isFinite(noticeExpiresAtMs) &&
      noticeExpiresAtMs > nowMs - 24 * 60 * 60_000
    );
  });

  await saveServerSettings({
    routeDeals: {
      ...routeDeals,
      active: nextActive,
      closed: [closedDeal, ...previousClosed].slice(0, 50),
    },
  } as any);

  return closedDeal;
}

/**
 * Geriye dönük uyumluluk:
 * - Restorandaki siparişte mevcut aktif fırsatı döndürür.
 * - Sipariş Unterwegs ise fırsatı yenilemek yerine kapatır.
 *
 * Yeni kod doğrudan findActive... veya close... fonksiyonlarını kullanmalıdır.
 */
export async function refreshRouteDealOpportunityForOrder(
  orderOrId: unknown,
  _opportunityMinutesInput?: unknown,
) {
  const order = await loadOrder(orderOrId);
  const status = text(order?.status, 40).toLowerCase();

  if (status === "out_for_delivery") {
    await closeRouteDealOpportunityForOrder(
      order,
      "source_order_out_for_delivery",
    );
    return null;
  }

  return findActiveRouteDealOpportunityForOrder(order);
}
