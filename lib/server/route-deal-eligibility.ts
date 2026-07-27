import { prisma } from "@/lib/db";
import { normalizePlz } from "@/lib/streets";

type RouteDealMode = "pickup" | "delivery";

type RouteDealEligibilityParams = {
  tenantId: string;
  settings: any;
  mode: RouteDealMode;
  customer: any;
  order?: any;
  now?: Date;
};

function object(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, any>)
    : {};
}

function array(value: unknown): any[] {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown, max = 250) {
  return String(value ?? "").trim().slice(0, max);
}

function normalizePhone(value: unknown) {
  const digits = String(value ?? "").replace(/\D/g, "");
  return digits.slice(0, 32) || null;
}

function normalizeEmail(value: unknown) {
  const email = text(value, 200).toLowerCase();
  return email && email.includes("@") ? email : null;
}

function normalizeStreet(value: unknown) {
  return text(value, 180)
    .toLocaleLowerCase("de-DE")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/strasse/g, "str")
    .replace(/straße/g, "str")
    .replace(/\bstr\.?\b/g, "str")
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+\d+[a-z]?(?:\s*[-/]\s*\d+[a-z]?)?\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim() || null;
}

function date(value: unknown) {
  const parsed = value ? new Date(String(value)) : null;
  return parsed && Number.isFinite(parsed.valueOf()) ? parsed : null;
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

function identity(value: any) {
  const customer = object(value?.customer ?? value);
  return {
    phone: normalizePhone(customer.phone ?? value?.phone),
    email: normalizeEmail(customer.email ?? value?.email),
  };
}

function sameIdentity(
  left: { phone: string | null; email: string | null },
  right: { phone: string | null; email: string | null },
) {
  return Boolean(
    (left.phone && right.phone && left.phone === right.phone) ||
      (left.email && right.email && left.email === right.email),
  );
}

function routeDealIdFromOrder(order: any) {
  const meta = object(order?.meta);
  const pricing = object(meta.pricing);
  const canonicalDeal = object(pricing.routeDeal);
  const submittedDeal = object(meta.routeDeal);

  return (
    text(canonicalDeal.id, 160) ||
    text(submittedDeal.id, 160) ||
    text(meta.routeDealId, 160) ||
    null
  );
}

function routeDealWasApplied(order: any, dealId: string) {
  if (!dealId || routeDealIdFromOrder(order) !== dealId) return false;

  const meta = object(order?.meta);
  const pricing = object(meta.pricing);
  const canonicalDeal = object(pricing.routeDeal);

  if (canonicalDeal.id) return canonicalDeal.applied !== false;

  const submittedDeal = object(meta.routeDeal);
  return submittedDeal.id === dealId;
}

function dealMatchesAddress(deal: any, customer: any, order?: any) {
  const customerObject = object(customer);
  const orderObject = object(order);
  const plz = normalizePlz(
    customerObject.plz ??
      customerObject.zip ??
      orderObject.plz ??
      orderObject.zip ??
      "",
  );
  const street = normalizeStreet(
    customerObject.street ??
      customerObject.addressLine ??
      customerObject.address ??
      orderObject.street ??
      orderObject.addressLine,
  );

  if (!plz || normalizePlz(deal?.plz) !== plz) return false;

  const explicitStreets = stringList(deal?.streets);
  const mustMatchStreet =
    deal?.matchMode === "street" ||
    deal?.requireStreet === true ||
    explicitStreets.length > 0;

  if (!mustMatchStreet) return true;

  const allowed = explicitStreets.length
    ? explicitStreets
    : [deal?.street].filter(Boolean);

  if (!allowed.length) return true;
  if (!street) return false;

  return allowed.some((candidate) => normalizeStreet(candidate) === street);
}

function activeDeals(settings: any, now: Date) {
  const config = object(settings?.routeDeals);
  if (config.enabled !== true) return [];

  return array(config.active)
    .filter((deal) => {
      const expiresAt = date(deal?.expiresAt);
      return Boolean(
        text(deal?.id, 160) &&
          text(deal?.orderId, 160) &&
          text(deal?.status, 30) !== "closed" &&
          expiresAt &&
          expiresAt > now,
      );
    })
    .sort(
      (left, right) =>
        Number(date(left?.expiresAt)?.valueOf() || 0) -
        Number(date(right?.expiresAt)?.valueOf() || 0),
    );
}

function recentlyClosedDeals(settings: any, now: Date) {
  const config = object(settings?.routeDeals);
  if (config.enabled !== true) return [];

  return array(config.closed)
    .filter((deal) => {
      const noticeExpiresAt = date(
        deal?.noticeExpiresAt ?? deal?.closedAt,
      );
      return Boolean(
        text(deal?.id, 160) &&
          text(deal?.orderId, 160) &&
          text(deal?.closedReason, 80) ===
            "source_order_out_for_delivery" &&
          noticeExpiresAt &&
          noticeExpiresAt > now,
      );
    })
    .sort(
      (left, right) =>
        Number(date(right?.closedAt)?.valueOf() || 0) -
        Number(date(left?.closedAt)?.valueOf() || 0),
    );
}

export type RouteDealEvaluationReason =
  | "source_customer"
  | "source_order_out_for_delivery"
  | "active_order"
  | "active_order_out_for_delivery"
  | "consumed"
  | null;

export type RouteDealEvaluation = {
  deal: any | null;
  reason: RouteDealEvaluationReason;
  activeOrderStatus: string | null;
};

function normalizedOrderStatus(order: any) {
  const meta = object(order?.meta);
  const raw = text(meta.statusManual ?? order?.status, 60).toLowerCase();

  if (["on_the_way", "unterwegs"].includes(raw)) {
    return "out_for_delivery";
  }
  if (["delivered", "completed"].includes(raw)) {
    return "done";
  }

  return raw;
}

export async function evaluateRouteDealForCustomer(
  params: RouteDealEligibilityParams,
): Promise<RouteDealEvaluation> {
  const empty = {
    deal: null,
    reason: null,
    activeOrderStatus: null,
  } satisfies RouteDealEvaluation;

  if (params.mode !== "delivery") return empty;

  const candidateIdentity = identity(params.customer);
  if (!candidateIdentity.phone && !candidateIdentity.email) {
    return empty;
  }

  const now = params.now ?? new Date();
  const candidates = activeDeals(params.settings, now).filter((deal) =>
    dealMatchesAddress(deal, params.customer, params.order),
  );
  const closedCandidates = recentlyClosedDeals(
    params.settings,
    now,
  ).filter((deal) =>
    dealMatchesAddress(deal, params.customer, params.order),
  );

  if (!candidates.length && !closedCandidates.length) return empty;

  const relevantDeals = [...candidates, ...closedCandidates];
  const sourceOrderIds = Array.from(
    new Set(
      relevantDeals
        .map((deal) => text(deal?.orderId, 160))
        .filter(Boolean),
    ),
  );

  const earliestStartedAt =
    relevantDeals
      .map((deal) => date(deal?.startedAt ?? deal?.closedAt))
      .filter((value): value is Date => Boolean(value))
      .sort((left, right) => left.valueOf() - right.valueOf())[0] ??
    new Date(now.getTime() - 60 * 60_000);

  const [sourceOrders, recentOrders, activeOrders] = await Promise.all([
    sourceOrderIds.length
      ? (prisma as any).order.findMany({
          where: {
            tenantId: params.tenantId,
            id: { in: sourceOrderIds },
          },
          select: {
            id: true,
            customer: true,
            status: true,
            meta: true,
          },
          take: 50,
        })
      : [],
    (prisma as any).order.findMany({
      where: {
        tenantId: params.tenantId,
        ts: { gte: new Date(earliestStartedAt.getTime() - 60_000) },
        status: { not: "cancelled" },
      },
      select: {
        id: true,
        customer: true,
        meta: true,
        status: true,
        ts: true,
      },
      orderBy: {
        ts: "desc",
      },
      take: 2_000,
    }),
    (prisma as any).order.findMany({
      where: {
        tenantId: params.tenantId,
        status: { notIn: ["done", "cancelled"] },
      },
      select: {
        id: true,
        customer: true,
        meta: true,
        status: true,
        planned: true,
        ts: true,
      },
      orderBy: {
        ts: "desc",
      },
      take: 5_000,
    }),
  ]);

  const sourceById = new Map<string, any>(
    sourceOrders.map((order: any) => [String(order.id), order]),
  );

  /*
    Kaynak sipariş sahibi, aktif veya yeni kapanmış fırsatı kendi kampanyası
    gibi görmez.
  */
  const isSourceCustomer = relevantDeals.some((deal) => {
    const sourceOrder = sourceById.get(text(deal?.orderId, 160));
    return Boolean(
      sourceOrder &&
        sameIdentity(candidateIdentity, identity(sourceOrder)),
    );
  });

  if (isSourceCustomer) {
    return {
      deal: null,
      reason: "source_customer",
      activeOrderStatus: null,
    };
  }

  /*
    Aktif siparişi olan müşteri yeni ikiz-sokak indirimi kullanamaz.
    Kendi siparişi yoldaysa mevcut “Bestellung unterwegs” bilgi kutusu korunur.
  */
  const blockingOrder = activeOrders.find((order: any) =>
    sameIdentity(candidateIdentity, identity(order)),
  );

  if (blockingOrder) {
    const status = normalizedOrderStatus(blockingOrder);

    return {
      deal: null,
      reason:
        status === "out_for_delivery"
          ? "active_order_out_for_delivery"
          : "active_order",
      activeOrderStatus: status || null,
    };
  }

  const dealWasConsumed = (deal: any) => {
    const dealId = text(deal?.id, 160);
    return recentOrders.some((order: any) => {
      if (!sameIdentity(candidateIdentity, identity(order))) return false;
      return routeDealWasApplied(order, dealId);
    });
  };

  for (const deal of candidates) {
    if (dealWasConsumed(deal)) continue;

    return {
      deal,
      reason: null,
      activeOrderStatus: null,
    };
  }

  /*
    Kaynak teslimat restorandan çıktıysa indirim artık geçerli değildir.
    Müşteri bu fırsatı kullanmadıysa kısa süreli açıklayıcı bilgi gösterilir.
  */
  const unusedClosedDeal = closedCandidates.find(
    (deal) => !dealWasConsumed(deal),
  );

  if (unusedClosedDeal) {
    return {
      deal: null,
      reason: "source_order_out_for_delivery",
      activeOrderStatus: null,
    };
  }

  const consumedAny = relevantDeals.some(dealWasConsumed);

  return {
    deal: null,
    reason: consumedAny ? "consumed" : null,
    activeOrderStatus: null,
  };
}

export async function findEligibleRouteDealForCustomer(
  params: RouteDealEligibilityParams,
) {
  const result = await evaluateRouteDealForCustomer(params);
  return result.deal;
}
