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

export async function findEligibleRouteDealForCustomer(
  params: RouteDealEligibilityParams,
) {
  if (params.mode !== "delivery") return null;

  const candidateIdentity = identity(params.customer);
  if (!candidateIdentity.phone && !candidateIdentity.email) {
    return null;
  }

  const now = params.now ?? new Date();
  const candidates = activeDeals(params.settings, now).filter((deal) =>
    dealMatchesAddress(deal, params.customer, params.order),
  );
  if (!candidates.length) return null;

  const sourceOrderIds = Array.from(
    new Set(
      candidates
        .map((deal) => text(deal?.orderId, 160))
        .filter(Boolean),
    ),
  );

  const earliestStartedAt =
    candidates
      .map((deal) => date(deal?.startedAt))
      .filter((value): value is Date => Boolean(value))
      .sort((left, right) => left.valueOf() - right.valueOf())[0] ??
    new Date(now.getTime() - 60 * 60_000);

  const [sourceOrders, recentOrders] = await Promise.all([
    sourceOrderIds.length
      ? (prisma as any).order.findMany({
          where: {
            tenantId: params.tenantId,
            id: { in: sourceOrderIds },
          },
          select: {
            id: true,
            customer: true,
          },
          take: 20,
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
        ts: true,
      },
      orderBy: {
        ts: "desc",
      },
      take: 2_000,
    }),
  ]);

  const sourceById = new Map<string, any>(
    sourceOrders.map((order: any) => [String(order.id), order]),
  );

  for (const deal of candidates) {
    const dealId = text(deal?.id, 160);
    const sourceOrderId = text(deal?.orderId, 160);
    const sourceOrder = sourceById.get(sourceOrderId);

    /*
      Fırsatı oluşturan ilk müşteri, aynı telefon/e-posta ile başka cihazdan
      girse bile kendi teslimatını "ikiz sokak" fırsatı olarak göremez.
    */
    if (sourceOrder && sameIdentity(candidateIdentity, identity(sourceOrder))) {
      continue;
    }

    /*
      Aynı müşteri bu fırsatla daha önce sipariş verdiyse fırsat o müşteri için
      tüketilmiştir. Global fırsat diğer uygun müşteriler için süresi bitene
      kadar açık kalabilir.
    */
    const consumed = recentOrders.some((order: any) => {
      if (!sameIdentity(candidateIdentity, identity(order))) return false;
      return routeDealWasApplied(order, dealId);
    });

    if (consumed) continue;

    return deal;
  }

  return null;
}
