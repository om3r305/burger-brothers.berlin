// app/api/orders/claim/route.ts
import { NextResponse } from "next/server";
import { prisma, getTenantId } from "@/lib/db";
import {
  getSessionSubject,
  requireMutationRole,
  securityJson,
} from "@/lib/server/request-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type OrderStatus =
  | "new"
  | "preparing"
  | "ready"
  | "out_for_delivery"
  | "done"
  | "cancelled";

const VALID_STATUSES: OrderStatus[] = [
  "new",
  "preparing",
  "ready",
  "out_for_delivery",
  "done",
  "cancelled",
];

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate",
};

const ORDER_SCHEMA_FIELDS = new Set<string>([
  "id",
  "tenantId",
  "mode",
  "channel",
  "status",
  "merchandise",
  "discount",
  "surcharges",
  "total",
  "coupon",
  "couponDiscount",
  "customer",
  "items",
  "meta",
  "ts",
  "planned",
  "etaMin",
  "etaAdjustMin",
  "driver",
  "doneAt",
  "cancelledAt",
  "archivedAt",
  "anonymizedAt",
  "history",
  "print",
  "createdAt",
  "updatedAt",
]);

function hasOrderField(fieldName: string) {
  return ORDER_SCHEMA_FIELDS.has(fieldName);
}

function isDecimalLike(value: any): value is { toNumber: () => number } {
  return Boolean(
    value &&
      typeof value === "object" &&
      typeof value.toNumber === "function" &&
      value.constructor?.name === "Decimal",
  );
}

function cleanId(value: any) {
  return String(value || "")
    .trim()
    .replace(/^#+/, "")
    .replace(/\s+/g, "")
    .replace(/[^a-zA-Z0-9_-]/g, "");
}

function cleanText(value: any, fallback = "") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function ensureObj(value: any): Record<string, any> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, any>;
  }

  return {};
}

function ensureArr(value: any): any[] {
  return Array.isArray(value) ? value : [];
}

function toNum(value: any, fallback = 0) {
  if (typeof value === "number" && Number.isFinite(value)) return value;

  if (isDecimalLike(value)) {
    return value.toNumber();
  }

  if (value == null) return fallback;

  const text = String(value).trim().replace(/[€\s]/g, "").replace(",", ".");
  const match = text.match(/-?\d+(\.\d+)?/);
  const number = match ? Number(match[0]) : Number(text);

  return Number.isFinite(number) ? number : fallback;
}

function toDate(value: any): Date | null {
  if (!value && value !== 0) return null;

  if (value instanceof Date) {
    return Number.isFinite(value.valueOf()) ? value : null;
  }

  if (typeof value === "number") {
    const date = new Date(value);
    return Number.isFinite(date.valueOf()) ? date : null;
  }

  if (typeof value === "string") {
    const text = value.trim();
    if (!text) return null;

    const asNumber = Number(text);

    if (Number.isFinite(asNumber) && asNumber > 0) {
      const byNumber = new Date(asNumber);
      if (Number.isFinite(byNumber.valueOf())) return byNumber;
    }

    const parsed = new Date(text);
    if (Number.isFinite(parsed.valueOf())) return parsed;
  }

  return null;
}

function toMs(value: any, fallback = Date.now()) {
  const date = toDate(value);
  return date ? date.getTime() : fallback;
}

function toIso(value: any): string | null {
  const date = toDate(value);
  return date ? date.toISOString() : null;
}

function sanitizeJson(value: any): any {
  if (value === undefined) return null;
  if (value === null) return null;

  if (value instanceof Date) {
    return Number.isFinite(value.valueOf()) ? value.toISOString() : null;
  }

  if (isDecimalLike(value)) {
    return value.toNumber();
  }

  if (typeof value === "bigint") return value.toString();
  if (typeof value === "function" || typeof value === "symbol") return null;

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeJson(item));
  }

  if (value && typeof value === "object") {
    const out: Record<string, any> = {};

    for (const [key, item] of Object.entries(value)) {
      if (key === "__proto__" || key === "prototype" || key === "constructor") continue;
      if (item === undefined) continue;

      out[key] = sanitizeJson(item);
    }

    return out;
  }

  return value;
}

function normalizeMode(value: any): "pickup" | "delivery" {
  const text = String(value || "").toLowerCase().trim();

  if (
    text === "pickup" ||
    text === "abholung" ||
    text === "apollo" ||
    text === "apollon"
  ) {
    return "pickup";
  }

  return "delivery";
}

function normalizeChannel(value: any, mode?: "pickup" | "delivery") {
  const text = String(value || "").toLowerCase().trim();

  if (text === "lieferando" || text === "liferando") return "lieferando";

  if (
    text === "apollo" ||
    text === "apollon" ||
    text === "abholung" ||
    text === "pickup"
  ) {
    return "apollo";
  }

  if (text === "web" || text === "online" || text === "direct") return "web";

  return mode === "pickup" ? "apollo" : text || "web";
}

function normalizeStatus(value: any): OrderStatus {
  const text = String(value || "").toLowerCase().trim();

  if (text === "received" || text === "eingegangen") return "new";

  if (
    text === "prepare" ||
    text === "zubereitung" ||
    text === "in_vorbereitung" ||
    text === "in vorbereitung"
  ) {
    return "preparing";
  }

  if (text === "bereit" || text === "abholbereit") return "ready";
  if (text === "on_the_way" || text === "unterwegs") return "out_for_delivery";
  if (text === "delivered" || text === "completed" || text === "geliefert") return "done";
  if (text === "canceled" || text === "storniert") return "cancelled";

  if (VALID_STATUSES.includes(text as OrderStatus)) {
    return text as OrderStatus;
  }

  return "new";
}

function toLegacyStatus(value: any) {
  const status = normalizeStatus(value);

  switch (status) {
    case "new":
      return "received";
    case "out_for_delivery":
      return "on_the_way";
    case "done":
      return "completed";
    case "preparing":
    case "ready":
    case "cancelled":
      return status;
    default:
      return "received";
  }
}

function normalizeCustomerFromRaw(raw: any) {
  const order = ensureObj(raw?.order);
  const customer = ensureObj(raw?.customer ?? order?.customer);

  const name =
    raw?.customerName ??
    raw?.name ??
    order?.customerName ??
    order?.name ??
    customer?.name ??
    customer?.customerName ??
    "";

  const phone =
    raw?.phone ??
    raw?.telephone ??
    order?.phone ??
    order?.telephone ??
    customer?.phone ??
    customer?.telephone ??
    "";

  const streetHouse = [customer?.street, customer?.house ?? customer?.houseNo]
    .map((part) => cleanText(part))
    .filter(Boolean)
    .join(" ");

  const addressLine =
    raw?.addressLine ??
    raw?.address ??
    order?.addressLine ??
    order?.address ??
    customer?.addressLine ??
    customer?.address ??
    streetHouse ??
    "";

  const plz =
    raw?.plz ??
    raw?.zip ??
    order?.plz ??
    order?.zip ??
    customer?.plz ??
    customer?.zip ??
    customer?.postalCode ??
    "";

  const email = raw?.email ?? order?.email ?? customer?.email ?? "";

  const note =
    raw?.note ??
    raw?.orderNote ??
    order?.note ??
    order?.orderNote ??
    customer?.note ??
    customer?.deliveryHint ??
    "";

  return sanitizeJson({
    ...customer,
    name: cleanText(name, ""),
    phone: cleanText(phone, ""),
    address: cleanText(customer?.address ?? addressLine, ""),
    addressLine: cleanText(addressLine, ""),
    street: cleanText(customer?.street, ""),
    house: cleanText(customer?.house ?? customer?.houseNo, ""),
    plz: cleanText(plz, "") || null,
    zip: cleanText(customer?.zip ?? plz, "") || null,
    city: cleanText(customer?.city, ""),
    email: cleanText(email, ""),
    deliveryHint: cleanText(customer?.deliveryHint ?? note, ""),
    note: cleanText(customer?.note ?? note, ""),
  });
}

function normalizeItems(value: any) {
  return ensureArr(value).map((item, index) =>
    sanitizeJson({
      id: item?.id ? String(item.id) : undefined,
      sku: item?.sku ? String(item.sku) : item?.code ? String(item.code) : undefined,
      name: cleanText(item?.name || item?.title || "Artikel"),
      category: item?.category ? String(item.category) : undefined,
      price: toNum(item?.price ?? item?.unitPrice, 0),
      qty: Math.max(1, toNum(item?.qty ?? item?.quantity ?? 1, 1)),
      add: ensureArr(item?.add ?? item?.extras).map((extra: any) => ({
        id: extra?.id ? String(extra.id) : undefined,
        label: cleanText(extra?.label ?? extra?.name ?? "Extra"),
        name: cleanText(extra?.name ?? extra?.label ?? "Extra"),
        price: toNum(extra?.price, 0),
      })),
      rm: ensureArr(item?.rm ?? item?.remove).map((entry: any) => String(entry)),
      note: item?.note ? String(item.note) : undefined,
      _idx: index,
    }),
  );
}

function lineTotal(item: any) {
  const qty = Math.max(1, toNum(item?.qty ?? item?.quantity ?? 1, 1));
  const base = toNum(item?.price ?? item?.unitPrice, 0);

  const extrasTotal = ensureArr(item?.add ?? item?.extras).reduce(
    (sum, extra) => sum + toNum(extra?.price, 0),
    0,
  );

  return (base + extrasTotal) * qty;
}

function computeMerchandise(items: any[]) {
  return items.reduce((sum, item) => sum + lineTotal(item), 0);
}

function normalizeHistory(value: any) {
  return ensureArr(value).map((entry) =>
    sanitizeJson({
      ts: toNum(entry?.ts ?? entry?.createdAt, Date.now()),
      action: cleanText(entry?.action ?? entry?.status ?? "event"),
      by: cleanText(entry?.by) || undefined,
      note: cleanText(entry?.note) || undefined,
    }),
  );
}

function buildOrderSelect() {
  const select: Record<string, boolean> = {
    id: true,
    tenantId: true,
    mode: true,
    channel: true,
    status: true,
    merchandise: true,
    discount: true,
    surcharges: true,
    total: true,
    coupon: true,
    couponDiscount: true,
    customer: true,
    items: true,
    meta: true,
    ts: true,
    planned: true,
    etaMin: true,
    createdAt: true,
    updatedAt: true,
  };

  const optionalFields = [
    "etaAdjustMin",
    "driver",
    "doneAt",
    "cancelledAt",
    "archivedAt",
    "anonymizedAt",
    "history",
    "print",
  ];

  for (const field of optionalFields) {
    if (hasOrderField(field)) {
      select[field] = true;
    }
  }

  return select;
}

function serializeOrder(row: any) {
  const rawMeta = ensureObj(row?.meta);
  const customer = normalizeCustomerFromRaw({ customer: row?.customer });
  const items = normalizeItems(row?.items);
  const history = normalizeHistory(row?.history ?? rawMeta?.history);

  const status = normalizeStatus(rawMeta?.statusManual ?? row?.status);
  const legacyStatus = toLegacyStatus(status);

  const merchandise = toNum(row?.merchandise, computeMerchandise(items));
  const discount = toNum(row?.discount, 0);
  const surcharges = toNum(row?.surcharges, 0);
  const couponDiscount = toNum(row?.couponDiscount, rawMeta?.couponDiscount ?? 0);
  const total = toNum(
    row?.total,
    Math.max(0, merchandise + surcharges - discount - couponDiscount),
  );

  const archivedAt = toIso(row?.archivedAt ?? rawMeta?.archivedAt);
  const anonymizedAt = toIso(row?.anonymizedAt ?? rawMeta?.anonymizedAt);

  const meta = sanitizeJson({
    ...rawMeta,
    history,
    coupon: row?.coupon ?? rawMeta?.coupon ?? null,
    couponDiscount,
    couponMeta: rawMeta?.couponMeta ?? null,
    couponLifecycle: rawMeta?.couponLifecycle ?? null,
    archivedAt,
    anonymizedAt,
  });

  const payload = sanitizeJson({
    items,
    customer,
    planned: row?.planned ?? undefined,
    meta,
    merchandise,
    discount,
    surcharges,
    total,
    coupon: row?.coupon ?? rawMeta?.coupon ?? null,
    couponDiscount,
  });

  return sanitizeJson({
    id: String(row?.id ?? ""),
    orderId: String(row?.id ?? ""),
    ts: toMs(row?.ts ?? row?.createdAt),
    createdAt: toIso(row?.createdAt ?? row?.ts),
    updatedAt: toIso(row?.updatedAt),
    mode: normalizeMode(row?.mode),
    channel: normalizeChannel(row?.channel, normalizeMode(row?.mode)),
    status,
    legacyStatus,
    statusLegacy: legacyStatus,
    etaMin: row?.etaMin ?? undefined,
    etaAdjustMin: row?.etaAdjustMin ?? rawMeta?.etaAdjustMin ?? 0,
    planned: row?.planned ?? null,
    plz: customer?.plz ?? customer?.zip ?? null,
    customerName: customer?.name ?? "",
    phone: customer?.phone ?? "",
    addressLine: customer?.addressLine || customer?.address || "",
    note: cleanText(rawMeta?.note ?? rawMeta?.orderNote ?? customer?.deliveryHint ?? customer?.note, ""),
    items,
    customer,
    meta,
    history,
    merchandise,
    discount,
    surcharges,
    total,
    coupon: row?.coupon ?? rawMeta?.coupon ?? null,
    couponDiscount,
    couponMeta: meta?.couponMeta ?? null,
    couponLifecycle: meta?.couponLifecycle ?? null,
    driver: row?.driver ?? rawMeta?.driver ?? null,
    print: row?.print ?? rawMeta?.print ?? null,
    doneAt: toIso(row?.doneAt ?? rawMeta?.doneAt),
    cancelledAt: toIso(row?.cancelledAt ?? rawMeta?.cancelledAt),
    archivedAt,
    anonymizedAt,
    order: payload,
    item: payload,
  });
}

async function findOrder(client: any, tenantId: string, idRaw: string) {
  const original = String(idRaw || "").trim().replace(/^#+/, "");
  const cleaned = cleanId(original);

  if (!cleaned) return null;

  const candidates = Array.from(
    new Set(
      [
        original,
        cleaned,
        cleaned.toLowerCase(),
        cleaned.toUpperCase(),
      ].filter(Boolean),
    ),
  );

  const byId = await client.order.findFirst({
    where: {
      tenantId,
      id: {
        in: candidates,
      },
    },
    select: buildOrderSelect() as any,
  });

  if (byId) return byId;

  const rows = await client.$queryRaw<any[]>`
    SELECT "id"
    FROM "Order"
    WHERE "tenantId" = ${tenantId}
      AND (
        LOWER("meta" ->> 'orderNo') = LOWER(${cleaned})
        OR LOWER("meta" ->> 'orderNumber') = LOWER(${cleaned})
        OR LOWER("meta" ->> 'code') = LOWER(${cleaned})
        OR LOWER("meta" ->> 'trackingCode') = LOWER(${cleaned})
        OR LOWER("meta" ->> 'orderId') = LOWER(${cleaned})
        OR LOWER("meta" ->> 'displayId') = LOWER(${cleaned})
        OR LOWER("meta" ->> 'shortId') = LOWER(${cleaned})
      )
    ORDER BY "ts" DESC
    LIMIT 1;
  `;

  const id = rows?.[0]?.id;
  if (!id) return null;

  return client.order.findFirst({
    where: {
      tenantId,
      id: String(id),
    },
    select: buildOrderSelect() as any,
  });
}

function extractDriver(body: any) {
  const raw = ensureObj(body?.driver);

  const id = cleanText(
    body?.driverId ??
      body?.driver_id ??
      raw?.id ??
      body?.idDriver ??
      raw?.driverId ??
      "",
  );

  const name = cleanText(
    body?.driverName ??
      body?.driver_name ??
      body?.by ??
      raw?.name ??
      raw?.title ??
      raw?.driverName ??
      "",
  );

  const password = cleanText(body?.driverPassword ?? raw?.password ?? "");

  if (!id && !name) return null;

  return sanitizeJson({
    id: id || name,
    name: name || id,
    password: password || undefined,
  });
}

function getOrderDriver(row: any) {
  const meta = ensureObj(row?.meta);
  const driver = row?.driver ?? meta?.driver ?? null;

  if (driver && typeof driver === "object") return driver;

  if (meta?.driverId || meta?.driverName) {
    return {
      id: meta.driverId,
      name: meta.driverName,
    };
  }

  return null;
}

function isSameDriver(left: any, right: any) {
  if (!left || !right) return false;

  const leftId = cleanText(left?.id);
  const rightId = cleanText(right?.id);
  const leftName = cleanText(left?.name);
  const rightName = cleanText(right?.name);

  return Boolean(
    (leftId && rightId && leftId === rightId) ||
      (leftName && rightName && leftName === rightName),
  );
}

function driverLabel(driver: any) {
  return cleanText(driver?.name || driver?.id || "anderer Fahrer");
}

function buildClaimPatch(row: any, driver: any, by: string) {
  const now = Date.now();
  const rawMeta = ensureObj(row?.meta);
  const history = normalizeHistory(row?.history ?? rawMeta?.history);

  const nextHistory = [
    ...history,
    {
      ts: now,
      action: "driver:claim",
      by,
      note: `Fahrer: ${driverLabel(driver)}`,
    },
    {
      ts: now,
      action: "status:out_for_delivery",
      by,
    },
  ];

  const nextMeta = sanitizeJson({
    ...rawMeta,
    driver,
    driverId: driver?.id ?? null,
    driverName: driver?.name ?? null,
    claimedAt: rawMeta?.claimedAt ?? now,
    claimedBy: by,
    lastPos: null,
    statusManual: "out_for_delivery",
    statusUpdatedAt: now,
    history: nextHistory,
  });

  const data: Record<string, any> = {
    status: "out_for_delivery",
    meta: nextMeta,
  };

  if (hasOrderField("driver")) {
    data.driver = sanitizeJson(driver);
  }

  if (hasOrderField("history")) {
    data.history = sanitizeJson(nextHistory);
  }

  return data;
}

function jsonResponse(payload: Record<string, any>, status = 200) {
  return NextResponse.json(payload, {
    status,
    headers: NO_STORE_HEADERS,
  });
}

function claimError(error: string, message: string, status = 409, order: any = null) {
  return jsonResponse(
    {
      ok: false,
      source: "db",
      error,
      message,
      order,
      item: order,
      data: order,
    },
    status,
  );
}

export async function POST(req: Request) {
  const authError = await requireMutationRole(req, ["admin", "driver"]);
  if (authError) return authError;

  try {
    const tenantId = await getTenantId();
    const body = await req.json().catch(() => ({} as any));

    const id = String(body?.id || body?.orderId || body?.code || "").trim();
    const requestedDriver = extractDriver(body);
    const driverSubject = await getSessionSubject(req, "driver");

    if (driverSubject && requestedDriver?.id && requestedDriver.id !== driverSubject) {
      return securityJson({ ok: false, error: "driver_identity_mismatch" }, 403);
    }

    const driver = requestedDriver
      ? {
          ...requestedDriver,
          id: driverSubject || requestedDriver.id,
        }
      : null;
    const by = cleanText(body?.by || driver?.name || "driver", "driver");

    if (!id) {
      return claimError("id_missing", "Bestellung fehlt.", 400);
    }

    if (!driver) {
      return claimError("driver_missing", "Fahrer fehlt.", 400);
    }

    const result = await prisma.$transaction(async (tx: any) => {
      const row = await findOrder(tx, tenantId, id);

      if (!row) {
        return {
          type: "error",
          status: 404,
          error: "not_found",
          message: "Bestellung wurde nicht gefunden.",
          order: null,
        };
      }

      const order = serializeOrder(row);
      const status = normalizeStatus((row as any).status);
      const mode = normalizeMode((row as any).mode);
      const assigned = getOrderDriver(row);

      if (mode !== "delivery") {
        return {
          type: "error",
          status: 409,
          error: "not_delivery",
          message: "Diese Bestellung ist keine Lieferung.",
          order,
        };
      }

      if (status === "done") {
        return {
          type: "error",
          status: 409,
          error: "already_done",
          message: "Diese Bestellung ist bereits abgeschlossen.",
          order,
        };
      }

      if (status === "cancelled") {
        return {
          type: "error",
          status: 409,
          error: "cancelled",
          message: "Diese Bestellung wurde storniert.",
          order,
        };
      }

      if (assigned && (assigned?.id || assigned?.name)) {
        if (isSameDriver(assigned, driver)) {
          return {
            type: "ok",
            alreadyMine: true,
            order,
          };
        }

        return {
          type: "error",
          status: 409,
          error: "already_claimed",
          message: `Dieser Auftrag wurde bereits von ${driverLabel(assigned)} übernommen.`,
          order,
        };
      }

      /*
        Race-condition kilidi:
        İki kurye aynı anda aynı siparişe basarsa sadece ilk update başarılı olur.
        İlk başarılı update status'u out_for_delivery yapar.
        İkinci istek aynı anda gelse bile bu şartı geçemez ve conflict döner.
      */
      const updateResult = await tx.order.updateMany({
        where: {
          tenantId,
          id: String((row as any).id),
          mode: "delivery",
          status: {
            notIn: ["out_for_delivery", "done", "cancelled"],
          },
        },
        data: buildClaimPatch(row, driver, by) as any,
      });

      if (updateResult.count !== 1) {
        const latest = await findOrder(tx, tenantId, id);
        const latestOrder = latest ? serializeOrder(latest) : order;
        const latestDriver = latest ? getOrderDriver(latest) : null;

        return {
          type: "error",
          status: 409,
          error: "claim_conflict",
          message: latestDriver
            ? `Dieser Auftrag wurde bereits von ${driverLabel(latestDriver)} übernommen.`
            : "Dieser Auftrag wurde gerade geändert. Bitte aktualisieren.",
          order: latestOrder,
        };
      }

      const updated = await findOrder(tx, tenantId, id);
      const updatedOrder = updated ? serializeOrder(updated) : order;

      return {
        type: "ok",
        alreadyMine: false,
        order: updatedOrder,
      };
    });

    if (result.type !== "ok") {
      return claimError(
        String(result.error || "claim_failed"),
        String(result.message || "Auftrag konnte nicht übernommen werden."),
        Number(result.status || 409),
        result.order ?? null,
      );
    }

    return jsonResponse({
      ok: true,
      source: "db",
      claimed: true,
      alreadyMine: result.alreadyMine === true,
      id: result.order?.id,
      orderId: result.order?.orderId || result.order?.id,
      status: result.order?.status || "out_for_delivery",
      order: result.order,
      item: result.order,
      data: result.order,
    });
  } catch (error: any) {
    console.error("[orders/claim] POST failed:", error);

    return jsonResponse(
      {
        ok: false,
        source: "db",
        error: error?.message || "ORDER_CLAIM_FAILED",
        message: "Auftrag konnte nicht übernommen werden.",
      },
      500,
    );
  }
}
