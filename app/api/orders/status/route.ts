// app/api/orders/status/route.ts
import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma, getTenantId } from "@/lib/db";

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

type LegacyOrderStatus =
  | "received"
  | "preparing"
  | "ready"
  | "on_the_way"
  | "delivered"
  | "completed"
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

function hasOrderField(fieldName: string) {
  try {
    const model = Prisma.dmmf.datamodel.models.find((item) => item.name === "Order");
    return Boolean(model?.fields?.some((field) => field.name === fieldName));
  } catch {
    return false;
  }
}

/**
 * DB id değerini bozma.
 * Önemli: uppercase yapmıyoruz. Lowercase/cuid id gelirse DB lookup kırılmasın.
 */
function cleanId(input: any) {
  return String(input || "")
    .trim()
    .replace(/^#+/, "")
    .replace(/\s+/g, "")
    .replace(/[^a-zA-Z0-9_-]/g, "");
}

function toNumber(value: any, fallback = 0) {
  if (typeof value === "number" && Number.isFinite(value)) return value;

  if (value instanceof Prisma.Decimal) {
    return value.toNumber();
  }

  if (value == null) return fallback;

  const text = String(value)
    .trim()
    .replace(/[€\s]/g, "")
    .replace(",", ".");

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

function toTs(value: any, fallback = Date.now()) {
  const date = toDate(value);
  return date ? date.getTime() : fallback;
}

function toIso(value: any): string | null {
  const date = toDate(value);
  return date ? date.toISOString() : null;
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

function cleanText(value: any, fallback = "") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function sanitizeJson(value: any): any {
  if (value === undefined) return null;
  if (value === null) return null;

  if (value instanceof Date) {
    return Number.isFinite(value.valueOf()) ? value.toISOString() : null;
  }

  if (value instanceof Prisma.Decimal) {
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
      if (key === "__proto__" || key === "prototype" || key === "constructor") {
        continue;
      }

      if (item === undefined) continue;

      out[key] = sanitizeJson(item);
    }

    return out;
  }

  return value;
}

function normalizeStatus(input: any): OrderStatus | null {
  const text = String(input || "").toLowerCase().trim();

  if (text === "received" || text === "eingegangen") return "new";

  if (
    text === "prepare" ||
    text === "preparing" ||
    text === "in_vorbereitung" ||
    text === "in vorbereitung" ||
    text === "zubereitung"
  ) {
    return "preparing";
  }

  if (text === "ready" || text === "bereit" || text === "abholbereit") return "ready";
  if (text === "on_the_way" || text === "unterwegs") return "out_for_delivery";
  if (text === "delivered" || text === "completed" || text === "geliefert") return "done";
  if (text === "canceled" || text === "cancelled" || text === "storniert") return "cancelled";

  if (VALID_STATUSES.includes(text as OrderStatus)) {
    return text as OrderStatus;
  }

  return null;
}

function toLegacyStatus(input: any): LegacyOrderStatus {
  const status = normalizeStatus(input) || "new";

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

function normalizeChannel(value: any) {
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

  return text || "web";
}

function normalizeHistory(value: any): any[] {
  return ensureArr(value).map((entry) => ({
    ts: toNumber(entry?.ts ?? entry?.createdAt, Date.now()),
    action: String(entry?.action ?? entry?.status ?? "event"),
    by: entry?.by ? String(entry.by) : undefined,
    note: entry?.note ? String(entry.note) : undefined,
  }));
}

function normalizeItems(value: any): any[] {
  return ensureArr(value).map((item, index) => ({
    id: item?.id ? String(item.id) : undefined,
    sku: item?.sku ? String(item.sku) : item?.code ? String(item.code) : undefined,
    name: String(item?.name || item?.title || "Artikel"),
    category: item?.category ? String(item.category) : undefined,
    price: toNumber(item?.price ?? item?.unitPrice, 0),
    qty: Math.max(1, toNumber(item?.qty ?? item?.quantity ?? 1, 1)),
    add: ensureArr(item?.add ?? item?.extras).map((extra: any) => ({
      id: extra?.id ? String(extra.id) : undefined,
      label: String(extra?.label ?? extra?.name ?? "Extra"),
      name: String(extra?.name ?? extra?.label ?? "Extra"),
      price: toNumber(extra?.price, 0),
    })),
    rm: ensureArr(item?.rm ?? item?.remove).map((entry: any) => String(entry)),
    note: item?.note ? String(item.note) : undefined,
    _idx: index,
  }));
}

function lineTotal(item: any) {
  const qty = Math.max(1, toNumber(item?.qty ?? item?.quantity ?? 1, 1));
  const base = toNumber(item?.price ?? item?.unitPrice, 0);

  const extrasTotal = ensureArr(item?.add ?? item?.extras).reduce(
    (sum, extra) => sum + toNumber(extra?.price, 0),
    0,
  );

  return (base + extrasTotal) * qty;
}

function computeMerchandise(items: any[]) {
  return items.reduce((sum, item) => sum + lineTotal(item), 0);
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
  const customer = ensureObj(row?.customer);
  const meta = ensureObj(row?.meta);
  const items = normalizeItems(row?.items);
  const history = normalizeHistory(row?.history ?? meta?.history);

  const status = normalizeStatus(meta?.statusManual ?? row?.status) || "new";
  const legacyStatus = toLegacyStatus(status);

  const merchandise = toNumber(row?.merchandise, computeMerchandise(items));
  const discount = toNumber(row?.discount, 0);
  const surcharges = toNumber(row?.surcharges, 0);
  const couponDiscount = toNumber(row?.couponDiscount, meta?.couponDiscount ?? 0);

  const total = toNumber(
    row?.total,
    Math.max(0, merchandise + surcharges - discount - couponDiscount),
  );

  const addressLine =
    customer?.addressLine ??
    customer?.address ??
    [
      customer?.street && (customer?.house || customer?.houseNo)
        ? `${customer.street} ${customer.house || customer.houseNo}`
        : "",
      customer?.zip || customer?.plz || "",
    ]
      .filter(Boolean)
      .join(" ")
      .trim();

  const note = meta?.note ?? meta?.orderNote ?? customer?.deliveryHint ?? customer?.note ?? "";

  const payload = {
    items,
    customer,
    planned: row?.planned ?? undefined,
    meta: {
      ...meta,
      history,
    },
    merchandise,
    discount,
    surcharges,
    total,
    coupon: row?.coupon ?? meta?.coupon ?? null,
    couponDiscount,
  };

  return sanitizeJson({
    id: String(row?.id ?? ""),
    orderId: String(row?.id ?? ""),
    ts: toTs(row?.ts ?? row?.createdAt),
    createdAt: toIso(row?.createdAt ?? row?.ts),
    updatedAt: toIso(row?.updatedAt),
    mode: normalizeMode(row?.mode),
    channel: normalizeChannel(row?.channel),
    status,
    legacyStatus,
    statusLegacy: legacyStatus,
    etaMin: row?.etaMin ?? undefined,
    etaAdjustMin: row?.etaAdjustMin ?? meta?.etaAdjustMin ?? 0,
    planned: row?.planned ?? null,
    plz: customer?.plz ?? customer?.zip ?? null,
    customerName: customer?.name ?? "",
    phone: customer?.phone ?? "",
    addressLine,
    note,
    items,
    customer,
    meta: payload.meta,
    history,
    merchandise,
    discount,
    surcharges,
    total,
    coupon: row?.coupon ?? meta?.coupon ?? null,
    couponDiscount,
    driver:
      row?.driver ??
      meta?.driver ??
      (meta?.driverId || meta?.driverName
        ? {
            id: meta?.driverId ?? null,
            name: meta?.driverName ?? null,
          }
        : null),
    print: row?.print ?? meta?.print ?? null,
    doneAt: toIso(row?.doneAt ?? meta?.doneAt),
    cancelledAt: toIso(row?.cancelledAt ?? meta?.cancelledAt),
    archivedAt: toIso(row?.archivedAt ?? meta?.archivedAt),
    anonymizedAt: toIso(row?.anonymizedAt ?? meta?.anonymizedAt),
    order: payload,
    item: payload,
  });
}

function couponCodeFromRow(row: any, meta: Record<string, any>) {
  return String(
    row?.coupon ??
      meta?.coupon ??
      meta?.couponCode ??
      meta?.activeCoupon ??
      "",
  ).trim();
}

function buildCouponLifecycleMeta(
  row: any,
  meta: Record<string, any>,
  next: OrderStatus,
  body: any,
  nowMs: number,
  by: string,
) {
  const coupon = couponCodeFromRow(row, meta);
  if (!coupon) return {};

  const previous = ensureObj(meta?.couponLifecycle);

  const policy = String(
    body?.couponCancelPolicy ??
      meta?.couponCancelPolicy ??
      previous?.cancelPolicy ??
      "restore_if_not_redeemed",
  );

  if (next === "done") {
    return {
      couponLifecycle: {
        ...previous,
        code: coupon,
        state: "redeemed",
        redeemedAt: nowMs,
        redeemedBy: by,
        policy: "redeem_on_done",
      },
      couponRedeemedAt: nowMs,
      couponRestoredAt: null,
      couponVoidedAt: null,
    };
  }

  if (next === "cancelled") {
    const state = policy === "void_on_cancel" ? "voided" : "restored";

    return {
      couponLifecycle: {
        ...previous,
        code: coupon,
        state,
        cancelledAt: nowMs,
        cancelledBy: by,
        cancelPolicy: policy,
      },
      couponRedeemedAt: previous?.redeemedAt ?? null,
      couponRestoredAt: state === "restored" ? nowMs : null,
      couponVoidedAt: state === "voided" ? nowMs : null,
    };
  }

  return {
    couponLifecycle: {
      ...previous,
      code: coupon,
      state: previous?.state || "reserved",
      lastStatus: next,
      lastStatusAt: nowMs,
      lastStatusBy: by,
    },
  };
}

function hasEtaPatch(body: any) {
  return (
    body?.etaAdjustMin !== undefined ||
    body?.etaAdjust !== undefined ||
    body?.etaDeltaMin !== undefined ||
    body?.etaDelta !== undefined ||
    body?.etaAdjustDelta !== undefined
  );
}

function hasEtaMinPatch(body: any) {
  return (
    body?.etaMin !== undefined ||
    body?.eta !== undefined ||
    body?.finalEtaMin !== undefined ||
    body?.acceptedEtaMin !== undefined ||
    body?.confirmedEtaMin !== undefined ||
    body?.deliveryEtaMin !== undefined
  );
}

function normalizeEtaMinPatch(body: any, fallback = 35) {
  const raw =
    body?.etaMin ??
    body?.eta ??
    body?.finalEtaMin ??
    body?.acceptedEtaMin ??
    body?.confirmedEtaMin ??
    body?.deliveryEtaMin ??
    fallback;

  const minutes = toNumber(raw, fallback);

  return Math.max(1, Math.min(240, Math.round(minutes || fallback || 35)));
}

function normalizeDriverPatch(driver: any) {
  if (driver === null) return null;

  const object = ensureObj(driver);
  const id = cleanText(object?.id ?? object?.driverId ?? object?.deviceId, "");
  const name = cleanText(object?.name ?? object?.driverName ?? object?.title, "");
  const deviceId = cleanText(object?.deviceId, "");

  return sanitizeJson({
    ...object,
    id: id || name || deviceId || null,
    name: name || id || deviceId || null,
    deviceId: deviceId || object?.deviceId || undefined,
    assignedAt: object?.assignedAt ?? Date.now(),
  });
}

function pickDriverPatch(body: any, meta: Record<string, any>) {
  if (body?.clearDriver === true || body?.driver === null) {
    return {
      hasPatch: true,
      driver: null,
    };
  }

  if (body?.driver && typeof body.driver === "object") {
    return {
      hasPatch: true,
      driver: normalizeDriverPatch(body.driver),
    };
  }

  if (body?.driverName || body?.driverId || body?.deviceId) {
    const previous = ensureObj(meta?.driver);

    return {
      hasPatch: true,
      driver: normalizeDriverPatch({
        ...previous,
        name: body?.driverName ? String(body.driverName) : previous?.name,
        id: body?.driverId ? String(body.driverId) : previous?.id,
        deviceId: body?.deviceId ? String(body.deviceId) : previous?.deviceId,
        assignedAt: previous?.assignedAt ?? Date.now(),
      }),
    };
  }

  return {
    hasPatch: false,
    driver: undefined,
  };
}

function applyDriverMetaPatch(
  meta: Record<string, any>,
  driver: any,
  status: OrderStatus,
  nowMs: number,
  by: string,
) {
  if (driver === null) {
    meta.driver = null;
    meta.driverId = null;
    meta.driverName = null;
    meta.claimedAt = null;
    meta.claimedBy = null;
    meta.lastPos = null;
    meta.lastDriverPos = null;
    meta.lastDriverPosAt = null;
    meta.lastDriverPosBy = null;
    return;
  }

  const normalized = normalizeDriverPatch(driver);

  meta.driver = normalized;
  meta.driverId = normalized?.id ?? null;
  meta.driverName = normalized?.name ?? null;

  if (status === "out_for_delivery") {
    meta.claimedAt = meta.claimedAt ?? nowMs;
    meta.claimedBy = meta.claimedBy ?? by;
  }
}

function hasDriverPatch(body: any) {
  return (
    body?.clearDriver === true ||
    body?.driver === null ||
    Boolean(body?.driver && typeof body.driver === "object") ||
    Boolean(body?.driverName || body?.driverId || body?.deviceId)
  );
}

function buildStatusUpdateData(
  row: any,
  next: OrderStatus,
  body: any,
  opts?: { statusChanged?: boolean },
) {
  const nowDate = new Date();
  const nowMs = nowDate.getTime();

  const statusChanged = opts?.statusChanged === true;
  const isDone = next === "done";
  const isCancelled = next === "cancelled";
  const isFinal = isDone || isCancelled;
  const isOutForDelivery = next === "out_for_delivery";

  const metaObj = ensureObj(row?.meta);
  const oldHistory = normalizeHistory(row?.history ?? metaObj?.history);
  const by = body?.by ? String(body.by) : "api";

  const etaPatch = hasEtaPatch(body);
  const etaMinPatch = hasEtaMinPatch(body);
  const currentEtaAdjust = toNumber(row?.etaAdjustMin ?? metaObj?.etaAdjustMin, 0);
  const currentEtaMin = toNumber(row?.etaMin ?? metaObj?.etaMin ?? metaObj?.eta, 35);
  let etaAdjustMin: number | undefined;
  let etaMin: number | undefined;

  if (etaMinPatch) {
    etaMin = normalizeEtaMinPatch(body, currentEtaMin || 35);
    etaAdjustMin = body?.etaAdjustMin !== undefined || body?.etaAdjust !== undefined
      ? toNumber(body?.etaAdjustMin ?? body?.etaAdjust, 0)
      : 0;
  }

  if (etaPatch && !etaMinPatch) {
    if (body?.etaAdjustMin !== undefined || body?.etaAdjust !== undefined) {
      etaAdjustMin = toNumber(body?.etaAdjustMin ?? body?.etaAdjust, currentEtaAdjust);
    } else {
      etaAdjustMin =
        currentEtaAdjust +
        toNumber(body?.etaDeltaMin ?? body?.etaDelta ?? body?.etaAdjustDelta, 0);
    }
  }

  const driverPatch = pickDriverPatch(body, metaObj);

  const historyAction = statusChanged
    ? `status:${next}`
    : etaMinPatch
      ? `etaMin:${etaMin ?? currentEtaMin}`
      : etaPatch
        ? `eta:${etaAdjustMin ?? currentEtaAdjust}`
        : driverPatch.hasPatch
          ? driverPatch.driver === null
            ? "driver:clear"
            : "driver:set"
          : "order:touch";

  const historyEntry = {
    ts: nowMs,
    action: historyAction,
    by,
    note: body?.note ? String(body.note) : undefined,
  };

  const history = [...oldHistory, historyEntry];

  const nextMeta: Record<string, any> = {
    ...metaObj,
    history,
    statusUpdatedAt: statusChanged ? nowMs : metaObj?.statusUpdatedAt,
    lastUpdatedAt: nowMs,
    lastUpdatedBy: by,
  };

  if (statusChanged) {
    nextMeta.lastStatusAt = nowMs;
    nextMeta.lastStatusBy = by;
    nextMeta.lastStatus = next;

    if (next === "preparing" && (body?.acceptAndPrint === true || body?.accepted === true || etaMinPatch)) {
      nextMeta.acceptedAt = nowMs;
      nextMeta.acceptedBy = by;
      nextMeta.acceptSource = body?.acceptSource ? String(body.acceptSource) : "tv";
    }

    if (isFinal) {
      delete nextMeta.statusManual;
    } else {
      nextMeta.statusManual = next;
    }

    if (isOutForDelivery) {
      nextMeta.outForDeliveryAt =
        toNumber(body?.outSince, 0) > 0
          ? toNumber(body.outSince, nowMs)
          : nextMeta.outForDeliveryAt ?? nowMs;
    }

    if (isCancelled) {
      nextMeta.cancelledAt = nowMs;
    } else {
      delete nextMeta.cancelledAt;
    }

    if (isDone) {
      nextMeta.doneAt = nowMs;
    } else {
      delete nextMeta.doneAt;
    }

    Object.assign(
      nextMeta,
      buildCouponLifecycleMeta(row, metaObj, next, body, nowMs, by),
    );
  }

  if (etaMinPatch) {
    nextMeta.etaMin = etaMin;
    nextMeta.finalEtaMin = etaMin;
    nextMeta.acceptedEtaMin = etaMin;
    nextMeta.etaConfirmedAt = nowMs;
    nextMeta.etaConfirmedBy = by;
    nextMeta.etaAdjustMin = etaAdjustMin ?? 0;
  } else if (etaPatch) {
    nextMeta.etaAdjustMin = etaAdjustMin ?? 0;
  }

  if (driverPatch.hasPatch) {
    applyDriverMetaPatch(nextMeta, driverPatch.driver, next, nowMs, by);
  }

  if (statusChanged && isFinal) {
    nextMeta.lastPos = null;
    nextMeta.lastDriverPos = null;
    nextMeta.lastDriverPosAt = null;
    nextMeta.lastDriverPosBy = null;
  }

  const data: Record<string, any> = {
    status: next,
    meta: sanitizeJson(nextMeta),
  };

  if (hasOrderField("history")) {
    data.history = sanitizeJson(history);
  }

  if (statusChanged && hasOrderField("doneAt")) {
    data.doneAt = isDone ? nowDate : null;
  }

  if (statusChanged && hasOrderField("cancelledAt")) {
    data.cancelledAt = isCancelled ? nowDate : null;
  }

  if (etaMinPatch && hasOrderField("etaMin")) {
    data.etaMin = etaMin;
  }

  if ((etaPatch || etaMinPatch) && hasOrderField("etaAdjustMin")) {
    data.etaAdjustMin = etaAdjustMin ?? 0;
  }

  if (driverPatch.hasPatch && hasOrderField("driver")) {
    data.driver = sanitizeJson(driverPatch.driver);
  }

  return data;
}

function jsonResponse(payload: Record<string, any>, status = 200) {
  return NextResponse.json(payload, {
    status,
    headers: NO_STORE_HEADERS,
  });
}

function errorResponse(error: any, fallback: string, status = 500) {
  return jsonResponse(
    {
      ok: false,
      source: "db",
      error: error?.message || fallback,
    },
    status,
  );
}

async function findOrderByIdOrCode(
  tenantId: string,
  idRaw: string,
  select: Record<string, boolean>,
) {
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

  const byId = await prisma.order.findFirst({
    where: {
      tenantId,
      id: {
        in: candidates,
      },
    },
    select: select as any,
  });

  if (byId) return byId;

  const rows = await prisma.$queryRaw<any[]>`
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

  return prisma.order.findFirst({
    where: {
      tenantId,
      id: String(id),
    },
    select: select as any,
  });
}

async function handleStatusUpdate(req: Request) {
  try {
    const body = await req.json().catch(() => ({} as any));

    const id = String(body?.id ?? body?.orderId ?? body?.code ?? "").trim();

    const statusProvided =
      (body?.status !== undefined &&
        body?.status !== null &&
        String(body.status).trim() !== "") ||
      (body?.nextStatus !== undefined &&
        body?.nextStatus !== null &&
        String(body.nextStatus).trim() !== "");

    const requestedStatus = normalizeStatus(body?.status ?? body?.nextStatus);
    const etaPatch = hasEtaPatch(body);
    const etaMinPatch = hasEtaMinPatch(body);
    const driverPatch = hasDriverPatch(body);

    if (!id) {
      return jsonResponse(
        {
          ok: false,
          source: "db",
          error: "bad_request",
          message: "id/orderId ist erforderlich.",
        },
        400,
      );
    }

    if (statusProvided && !requestedStatus) {
      return jsonResponse(
        {
          ok: false,
          source: "db",
          error: "bad_status",
          message: "Ungültiger Status.",
        },
        400,
      );
    }

    if (!statusProvided && !etaPatch && !etaMinPatch && !driverPatch) {
      return jsonResponse(
        {
          ok: false,
          source: "db",
          error: "bad_request",
          message: "status, ETA oder Fahrer-Patch ist erforderlich.",
        },
        400,
      );
    }

    const tenantId = await getTenantId();
    const select = buildOrderSelect();

    const row = await findOrderByIdOrCode(tenantId, id, select);

    if (!row) {
      return jsonResponse(
        {
          ok: false,
          source: "db",
          error: "not_found",
          message: "Bestellung nicht gefunden.",
        },
        404,
      );
    }

    const metaObj = ensureObj((row as any)?.meta);
    const currentStatus = normalizeStatus(metaObj?.statusManual ?? (row as any)?.status) || "new";
    const next = requestedStatus || currentStatus;

    const data = buildStatusUpdateData(row, next, body, {
      statusChanged: Boolean(requestedStatus),
    });

    const updated = await prisma.order.update({
      where: {
        id: String((row as any).id),
      },
      data,
      select: select as any,
    });

    const order = serializeOrder(updated);

    return jsonResponse({
      ok: true,
      source: "db",
      id: order.id,
      orderId: order.orderId,
      status: order.status,
      legacyStatus: order.legacyStatus,
      order,
      item: order,
      data: order,
    });
  } catch (error: any) {
    console.error("[orders/status] update failed:", error);
    return errorResponse(error, "ORDERS_STATUS_UPDATE_FAILED");
  }
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);

    const id =
      url.searchParams.get("id") ||
      url.searchParams.get("orderId") ||
      url.searchParams.get("code") ||
      "";

    if (!id) {
      return jsonResponse(
        {
          ok: false,
          source: "db",
          error: "id_required",
        },
        400,
      );
    }

    const tenantId = await getTenantId();
    const select = buildOrderSelect();
    const row = await findOrderByIdOrCode(tenantId, id, select);

    if (!row) {
      return jsonResponse(
        {
          ok: false,
          source: "db",
          error: "not_found",
        },
        404,
      );
    }

    const order = serializeOrder(row);

    return jsonResponse({
      ok: true,
      source: "db",
      id: order.id,
      orderId: order.orderId,
      status: order.status,
      legacyStatus: order.legacyStatus,
      order,
      item: order,
      data: order,
    });
  } catch (error: any) {
    console.error("[orders/status] GET failed:", error);
    return errorResponse(error, "ORDERS_STATUS_GET_FAILED");
  }
}

export async function POST(req: Request) {
  return handleStatusUpdate(req);
}

export async function PUT(req: Request) {
  return handleStatusUpdate(req);
}

export async function PATCH(req: Request) {
  return handleStatusUpdate(req);
}