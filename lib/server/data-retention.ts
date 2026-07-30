import { prisma } from "@/lib/db";
import { Prisma } from "@prisma/client";

type JsonObject = Record<string, any>;

const SENSITIVE_META_KEY =
  /(customer|name|phone|email|address|street|house|zip|plz|note|hint|token|secret|subscription|endpoint|location|latitude|longitude|(^|_)lat($|_)|(^|_)lng($|_)|driver|device|useragent|ip(hash)?|intent|refundid|chargeid|paymentid)/i;

function objectValue(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : {};
}

function scrubMetadata(value: unknown, depth = 0): unknown {
  if (depth > 8) return null;
  if (Array.isArray(value)) {
    return value.slice(0, 1000).map((item) => scrubMetadata(item, depth + 1));
  }
  if (!value || typeof value !== "object") return value;

  const output: JsonObject = {};
  for (const [key, item] of Object.entries(value as JsonObject)) {
    if (
      key === "__proto__" ||
      key === "prototype" ||
      key === "constructor" ||
      key.toLowerCase() === "id" ||
      SENSITIVE_META_KEY.test(key)
    ) {
      continue;
    }
    output[key] = scrubMetadata(item, depth + 1);
  }
  return output;
}

function scrubHistory(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.slice(-500).map((entry) => {
    const item = objectValue(entry);
    return {
      ts: item.ts ?? item.at ?? item.createdAt ?? null,
      action: String(item.action ?? item.status ?? "event").slice(0, 80),
    };
  });
}

function boundedDays(
  value: unknown,
  fallback: number,
  minimum: number,
) {
  const parsed = Math.trunc(Number(value));
  return Number.isFinite(parsed) ? Math.max(minimum, parsed) : fallback;
}

export async function enforcePersonalDataRetention(params?: {
  tenantId?: string;
  orderRetentionDays?: number;
  customerRetentionDays?: number;
  analyticsRetentionDays?: number;
  batchSize?: number;
}) {
  const orderRetentionDays = boundedDays(
    params?.orderRetentionDays ??
      process.env.ORDER_PII_RETENTION_DAYS ??
      90,
    90,
    30,
  );
  const customerRetentionDays = boundedDays(
    params?.customerRetentionDays ??
      process.env.CUSTOMER_PII_RETENTION_DAYS ??
      365,
    365,
    orderRetentionDays,
  );
  const analyticsRetentionDays = boundedDays(
    params?.analyticsRetentionDays ??
      process.env.ANALYTICS_RETENTION_DAYS ??
      30,
    30,
    1,
  );
  const parsedBatchSize = Math.trunc(Number(params?.batchSize ?? 250));
  const batchSize = Math.max(
    1,
    Math.min(1000, Number.isFinite(parsedBatchSize) ? parsedBatchSize : 250),
  );
  const orderCutoff = new Date(
    Date.now() - orderRetentionDays * 24 * 60 * 60 * 1000,
  );
  const customerCutoff = new Date(
    Date.now() - customerRetentionDays * 24 * 60 * 60 * 1000,
  );
  const analyticsCutoff = new Date(
    Date.now() - analyticsRetentionDays * 24 * 60 * 60 * 1000,
  );

  const orderWhere: any = {
    status: { in: ["done", "cancelled"] },
    anonymizedAt: null,
    updatedAt: { lt: orderCutoff },
  };
  const customerWhere: any = {
    blocked: false,
    emailOptIn: false,
    name: { not: "Anonymisiert" },
    OR: [
      { lastOrderAt: { lt: customerCutoff } },
      { lastOrderAt: null, createdAt: { lt: customerCutoff } },
    ],
  };
  if (params?.tenantId) {
    orderWhere.tenantId = params.tenantId;
    customerWhere.tenantId = params.tenantId;
  }

  const orders = await prisma.order.findMany({
    where: orderWhere,
    orderBy: { updatedAt: "asc" },
    take: batchSize,
    select: {
      id: true,
      meta: true,
      history: true,
    },
  });

  const anonymizedAt = new Date();
  for (const order of orders) {
    const history = scrubHistory(order.history ?? objectValue(order.meta).history);
    const meta = scrubMetadata(order.meta) as JsonObject;
    await prisma.order.update({
      where: { id: order.id },
      data: {
        customer: {
          anonymized: true,
          anonymizedAt: anonymizedAt.toISOString(),
        },
        meta: {
          ...meta,
          history,
          personalDataAnonymizedAt: anonymizedAt.toISOString(),
        },
        history,
        driver: Prisma.DbNull,
        print: Prisma.DbNull,
        anonymizedAt,
      },
    });
  }

  const customers = await prisma.customer.findMany({
    where: customerWhere,
    orderBy: { updatedAt: "asc" },
    take: batchSize,
    select: { id: true },
  });

  for (const customer of customers) {
    await prisma.$transaction([
      prisma.pushSubscription.deleteMany({
        where: { customerId: customer.id },
      }),
      prisma.customer.update({
        where: { id: customer.id },
        data: {
          name: "Anonymisiert",
          phone: null,
          email: null,
          address: null,
          plz: null,
          notes: null,
          vip: false,
          emailOptIn: false,
          stats: {
            anonymizedAt: anonymizedAt.toISOString(),
          },
        },
      }),
    ]);
  }

  const analyticsCleanup = await prisma.analyticsEvent.deleteMany({
    where: {
      ...(params?.tenantId ? { tenantId: params.tenantId } : {}),
      createdAt: { lt: analyticsCutoff },
    },
  });

  return {
    orderRetentionDays,
    customerRetentionDays,
    analyticsRetentionDays,
    ordersAnonymized: orders.length,
    customersAnonymized: customers.length,
    analyticsEventsDeleted: analyticsCleanup.count,
    moreOrdersPending: orders.length === batchSize,
    moreCustomersPending: customers.length === batchSize,
  };
}
