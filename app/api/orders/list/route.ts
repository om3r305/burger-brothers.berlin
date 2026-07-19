// app/api/orders/list/route.ts
import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma, getTenantId } from "@/lib/db";
import {
  getSessionSubject,
  hasSessionRole,
  requireAnySessionRole,
  securityJson,
} from "@/lib/server/request-security";
import {
  driverCanSeeOrder,
  sanitizeOrderForDriver,
} from "@/lib/server/driver-order";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type OrderMode = "pickup" | "delivery";

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

type NormalizedCustomer = Record<string, any> & {
  name: string;
  phone: string;
  address: string;
  addressLine: string;
  plz: string | null;
  zip: string | null;
  email: string;
  deliveryHint: string;
  note: string;
};

const DEFAULT_TZ = "Europe/Berlin";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate",
};

function hasOrderField(fieldName: string) {
  try {
    const model = Prisma.dmmf.datamodel.models.find((item: any) => item.name === "Order");
    return Boolean(model?.fields?.some((field: any) => field.name === fieldName));
  } catch {
    return false;
  }
}

function toNum(value: any, fallback = 0) {
  if (typeof value === "number" && Number.isFinite(value)) return value;

  if (value instanceof Prisma.Decimal) {
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

function isAllFilter(value: any) {
  const text = String(value ?? "").toLowerCase().trim();
  return !text || text === "all" || text === "alle" || text === "*" || text === "any";
}

function tryMode(value: any): OrderMode | null {
  if (isAllFilter(value)) return null;

  const text = String(value || "").toLowerCase().trim();

  if (
    text === "pickup" ||
    text === "abholung" ||
    text === "apollo" ||
    text === "apollon"
  ) {
    return "pickup";
  }

  if (
    text === "delivery" ||
    text === "lieferung" ||
    text === "lieferando" ||
    text === "lifa"
  ) {
    return "delivery";
  }

  return null;
}

function normalizeMode(value: any): OrderMode {
  return tryMode(value) ?? "delivery";
}

function tryChannel(value: any): string | null {
  if (isAllFilter(value)) return null;

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

  return text || null;
}

function normalizeChannel(value: any) {
  return tryChannel(value) ?? "web";
}

function tryStatus(value: any): OrderStatus | null {
  if (isAllFilter(value)) return null;

  const text = String(value || "").toLowerCase().trim();

  if (text === "new" || text === "received" || text === "eingegangen") return "new";

  if (
    text === "preparing" ||
    text === "prepare" ||
    text === "in_vorbereitung" ||
    text === "in vorbereitung" ||
    text === "zubereitung"
  ) {
    return "preparing";
  }

  if (text === "ready" || text === "bereit" || text === "abholbereit") return "ready";

  if (
    text === "out_for_delivery" ||
    text === "on_the_way" ||
    text === "unterwegs"
  ) {
    return "out_for_delivery";
  }

  if (
    text === "done" ||
    text === "completed" ||
    text === "delivered" ||
    text === "geliefert"
  ) {
    return "done";
  }

  if (text === "cancelled" || text === "canceled" || text === "storniert") {
    return "cancelled";
  }

  return null;
}

function normalizeStatus(value: any): OrderStatus {
  return tryStatus(value) ?? "new";
}

function toLegacyStatus(value: any): LegacyOrderStatus {
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

function readManualStatus(meta: any): OrderStatus | null {
  const object = ensureObj(meta);
  const manual = object.statusManual ?? object.manualStatus;

  if (!manual) return null;

  return tryStatus(manual);
}

function normalizeHistory(value: any): any[] {
  return ensureArr(value).map((entry) =>
    sanitizeJson({
      ts: toNum(entry?.ts ?? entry?.createdAt, Date.now()),
      action: String(entry?.action ?? entry?.status ?? "event"),
      by: entry?.by ? String(entry.by) : undefined,
      note: entry?.note ? String(entry.note) : undefined,
    }),
  );
}

function normalizeItems(value: any): any[] {
  return ensureArr(value).map((item, index) =>
    sanitizeJson({
      id: item?.id ? String(item.id) : undefined,
      sku: item?.sku ? String(item.sku) : item?.code ? String(item.code) : undefined,
      name: String(item?.name || item?.title || "Artikel"),
      category: item?.category ? String(item.category) : undefined,
      price: toNum(item?.price ?? item?.unitPrice, 0),
      qty: Math.max(1, toNum(item?.qty ?? item?.quantity ?? 1, 1)),
      add: ensureArr(item?.add ?? item?.extras).map((extra: any) => ({
        id: extra?.id ? String(extra.id) : undefined,
        label: String(extra?.label ?? extra?.name ?? "Extra"),
        name: String(extra?.name ?? extra?.label ?? "Extra"),
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

function getTzParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);

  const map = new Map(parts.map((part) => [part.type, part.value]));

  return {
    year: Number(map.get("year")),
    month: Number(map.get("month")),
    day: Number(map.get("day")),
    hour: Number(map.get("hour")),
    minute: Number(map.get("minute")),
    second: Number(map.get("second")),
  };
}

function getTimeZoneOffsetMs(date: Date, timeZone: string) {
  const parts = getTzParts(date, timeZone);

  const utcLike = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );

  return utcLike - date.getTime();
}

function zonedWallTimeToUtcDate(
  timeZone: string,
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  ms: number,
) {
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, second, ms);
  const offset1 = getTimeZoneOffsetMs(new Date(utcGuess), timeZone);

  let utc = utcGuess - offset1;

  const offset2 = getTimeZoneOffsetMs(new Date(utc), timeZone);

  if (offset2 !== offset1) {
    utc = utcGuess - offset2;
  }

  return new Date(utc);
}

function berlinDayBounds(timeZone = DEFAULT_TZ) {
  const now = new Date();
  const parts = getTzParts(now, timeZone);

  const start = zonedWallTimeToUtcDate(
    timeZone,
    parts.year,
    parts.month,
    parts.day,
    0,
    0,
    0,
    0,
  );

  const end = zonedWallTimeToUtcDate(
    timeZone,
    parts.year,
    parts.month,
    parts.day,
    23,
    59,
    59,
    999,
  );

  return {
    start,
    end,
    startMs: start.getTime(),
    endMs: end.getTime(),
    nowMs: now.getTime(),
  };
}

function parseBool(value: any) {
  const text = String(value || "").toLowerCase().trim();
  return text === "1" || text === "true" || text === "yes" || text === "ja";
}

function readView(url: URL) {
  const text = String(
    url.searchParams.get("view") ||
      url.searchParams.get("client") ||
      url.searchParams.get("target") ||
      url.searchParams.get("shape") ||
      "",
  )
    .toLowerCase()
    .trim();

  if (text === "driver" || text === "kurier" || text === "courier" || text === "fahrer") {
    return "driver";
  }

  if (text === "tv" || text === "dashboard" || text === "monitor") {
    return "tv";
  }

  return "default";
}

function isArchivedOrder(order: any) {
  const meta = ensureObj(order?.meta);

  return Boolean(
    order?.archivedAt ||
      order?.anonymizedAt ||
      meta?.archivedAt ||
      meta?.anonymizedAt,
  );
}

function normalizeCustomer(row: any): NormalizedCustomer {
  const customer = ensureObj(row?.customer);

  const plzRaw =
    customer?.plz ??
    customer?.zip ??
    customer?.postalCode ??
    row?.plz ??
    null;

  const plz = plzRaw == null ? null : cleanText(plzRaw, "");

  const streetHouse = [customer?.street, customer?.house ?? customer?.houseNo]
    .map((item) => cleanText(item))
    .filter(Boolean)
    .join(" ")
    .trim();

  const addressLine = cleanText(
    customer?.addressLine ??
      customer?.address ??
      streetHouse ??
      customer?.street,
    "",
  );

  const deliveryHint = cleanText(
    customer?.deliveryHint ??
      customer?.hint ??
      customer?.deliveryNote,
    "",
  );

  const note = cleanText(
    customer?.note ??
      customer?.customerNote ??
      deliveryHint,
    "",
  );

  return sanitizeJson({
    ...customer,
    name: cleanText(customer?.name ?? customer?.customerName, ""),
    phone: cleanText(customer?.phone ?? customer?.telephone, ""),
    address: cleanText(customer?.address ?? addressLine, ""),
    addressLine,
    street: cleanText(customer?.street, ""),
    house: cleanText(customer?.house ?? customer?.houseNo, ""),
    plz: plz || null,
    zip: cleanText(customer?.zip ?? plz, "") || null,
    email: cleanText(customer?.email, ""),
    deliveryHint,
    note,
  });
}

function serializeOrder(row: any) {
  const rawMeta = ensureObj(row?.meta);
  const customer = normalizeCustomer(row);
  const items = normalizeItems(row?.items);
  const history = normalizeHistory(row?.history ?? rawMeta?.history);

  const baseStatus = normalizeStatus(row?.status);
  const manualStatus = readManualStatus(rawMeta);
  const status = manualStatus ?? baseStatus;
  const legacyStatus = toLegacyStatus(status);

  const merchandise = toNum(row?.merchandise, computeMerchandise(items));
  const discount = toNum(row?.discount, 0);
  const surcharges = toNum(row?.surcharges, 0);
  const couponDiscount = toNum(row?.couponDiscount, rawMeta?.couponDiscount ?? 0);

  const total = toNum(
    row?.total,
    Math.max(0, merchandise + surcharges - discount - couponDiscount),
  );

  const ts = toMs(row?.ts ?? row?.createdAt);
  const mode = normalizeMode(row?.mode);
  const channel = normalizeChannel(row?.channel);

  const note = cleanText(
    rawMeta?.note ??
      rawMeta?.orderNote ??
      customer.deliveryHint ??
      customer.note,
    "",
  );

  const meta = sanitizeJson({
    ...rawMeta,
    history,
    coupon: row?.coupon ?? rawMeta?.coupon ?? null,
    couponDiscount,
    couponMeta: rawMeta?.couponMeta ?? null,
    couponLifecycle: rawMeta?.couponLifecycle ?? null,
    archivedAt: toIso(row?.archivedAt ?? rawMeta?.archivedAt),
    anonymizedAt: toIso(row?.anonymizedAt ?? rawMeta?.anonymizedAt),
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
    ts,
    createdAt: toIso(row?.createdAt ?? row?.ts),
    updatedAt: toIso(row?.updatedAt),
    mode,
    channel,
    status,
    legacyStatus,
    statusLegacy: legacyStatus,
    etaMin: row?.etaMin ?? undefined,
    etaAdjustMin: row?.etaAdjustMin ?? rawMeta?.etaAdjustMin ?? 0,
    planned: row?.planned ?? null,
    plz: customer.plz ?? customer.zip ?? null,
    customerName: customer.name,
    phone: customer.phone,
    addressLine: customer.addressLine || customer.address,
    note,
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
    archivedAt: toIso(row?.archivedAt ?? rawMeta?.archivedAt),
    anonymizedAt: toIso(row?.anonymizedAt ?? rawMeta?.anonymizedAt),
    order: payload,
    item: payload,
  });
}

function channelCounts(orders: any[]) {
  return {
    lieferando: orders.filter((order: any) => order.channel === "lieferando").length,
    apollo: orders.filter((order: any) => order.channel === "apollo").length,
    web: orders.filter((order: any) => order.channel === "web").length,
  };
}

function statusCounts(orders: any[]) {
  const done = orders.filter((order: any) => order.status === "done").length;
  const cancelled = orders.filter((order: any) => order.status === "cancelled").length;

  return {
    new: orders.filter((order: any) => order.status === "new").length,
    preparing: orders.filter((order: any) => order.status === "preparing").length,
    ready: orders.filter((order: any) => order.status === "ready").length,
    out_for_delivery: orders.filter((order: any) => order.status === "out_for_delivery").length,
    done,
    cancelled,
    finished: done + cancelled,
  };
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

function jsonResponse(payload: Record<string, any>, status = 200) {
  return NextResponse.json(sanitizeJson(payload), {
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

export async function GET(req: Request) {
  const authError = await requireAnySessionRole(req, ["admin", "tv", "driver"]);
  if (authError) return authError;

  // Rol önceliği önemlidir: tarayıcıda eski bir driver cookie'si kalsa bile
  // geçerli admin/TV oturumu daraltılmış driver görünümüne düşmez.
  const isAdmin = await hasSessionRole(req, "admin");
  const isTv = !isAdmin && (await hasSessionRole(req, "tv"));
  const driverSubject = !isAdmin && !isTv
    ? await getSessionSubject(req, "driver")
    : "";
  const isDriver = Boolean(driverSubject);

  if (!isAdmin && !isTv && !isDriver) {
    return securityJson({ ok: false, error: "driver_session_subject_missing" }, 401);
  }

  try {
    const tenantId = await getTenantId();
    const url = new URL(req.url);

    const tz = isDriver ? DEFAULT_TZ : url.searchParams.get("tz") || DEFAULT_TZ;
    const view = isDriver ? "driver" : readView(url);
    const driverView = view === "driver";

    const all = isDriver
      ? false
      : parseBool(url.searchParams.get("all")) ||
        url.searchParams.get("scope") === "all";

    const includeDone = url.searchParams.get("includeDone") !== "0";
    const onlyActive = parseBool(url.searchParams.get("active"));

    const includeArchived = !isDriver && (
      parseBool(url.searchParams.get("includeArchived")) ||
      parseBool(url.searchParams.get("archived"))
    );

    const statusFilter = tryStatus(url.searchParams.get("status"));
    const modeFilter = isDriver ? "delivery" : tryMode(url.searchParams.get("mode"));
    const channelFilter = isDriver ? null : tryChannel(url.searchParams.get("channel"));

    const take = Math.min(
      Math.max(toNum(url.searchParams.get("take"), 300), 1),
      isDriver ? 500 : 1000,
    );

    const fromParam = isDriver ? null : url.searchParams.get("from");
    const toParam = isDriver ? null : url.searchParams.get("to");

    const day = berlinDayBounds(tz);

    const fromDate = toDate(fromParam);
    const toDateValue = toDate(toParam);

    const where: any = {
      tenantId,
      // Ödeme henüz tamamlanmamış Stripe taslakları operasyon ekranına sipariş
      // gibi düşmemelidir.
      status: {
        not: "payment_pending",
      },
    };

    if (hasOrderField("archivedAt") && !includeArchived) {
      where.archivedAt = null;
    }

    if (fromDate || toDateValue) {
      where.ts = {};
      if (fromDate) where.ts.gte = fromDate;
      if (toDateValue) where.ts.lte = toDateValue;
    } else if (!all) {
      where.ts = {
        gte: day.start,
        lte: day.end,
      };
    }

    if (modeFilter) {
      where.mode = modeFilter;
    }

    if (channelFilter) {
      where.channel = channelFilter;
    }

    /*
      Status filtresi DB where içine koyulmuyor.
      Sebep: meta.statusManual varsa gerçek gösterilen status row.status'tan farklı olabilir.
      Bu yüzden status filtresini serialize sonrası uyguluyoruz.
    */
    const rows = await prisma.order.findMany({
      where,
      orderBy: {
        ts: "desc",
      },
      take,
      select: buildOrderSelect() as any,
    });

    // Stripe ödeme taslakları gerçek operasyon siparişi değildir. Özellikle
    // includeArchived=1 kullanıldığında payment_completed kayıtlarının status
    // normalizasyonuyla yanlışlıkla "new" görünmesini engelle.
    let allOrders = rows
      .filter(
        (row: any) =>
          !String(row?.status || "")
            .toLowerCase()
            .startsWith("payment_"),
      )
      .map(serializeOrder);

    /*
      Güvenlik filtresi:
      Eğer schema alanı yoksa veya eski siparişlerde arşiv bilgisi meta içinde duruyorsa,
      DB where yetmeyebilir. Bu yüzden serialize sonrası da arşiv/anonymized temizliği yapıyoruz.
    */
    if (!includeArchived) {
      allOrders = allOrders.filter((order: any) => !isArchivedOrder(order));
    }

    if (statusFilter) {
      allOrders = allOrders.filter((order: any) => order.status === statusFilter);
    }

    if (modeFilter) {
      allOrders = allOrders.filter((order: any) => order.mode === modeFilter);
    }

    if (channelFilter) {
      allOrders = allOrders.filter((order: any) => order.channel === channelFilter);
    }

    if (isDriver) {
      allOrders = allOrders
        .filter((order: any) => driverCanSeeOrder(order, driverSubject))
        .map((order: any) => sanitizeOrderForDriver(order));
    }

    const activeOrders = allOrders.filter(
      (order: any) => order.status !== "done" && order.status !== "cancelled",
    );

    const finishedOrders = allOrders.filter(
      (order: any) => order.status === "done" || order.status === "cancelled",
    );

    const items = onlyActive
      ? activeOrders
      : includeDone
        ? allOrders
        : activeOrders;

    const tvOrders = activeOrders;
    const doneOrders = includeDone ? finishedOrders : [];

    /*
      view=driver:
      Driver ekranı done siparişlerini de günlük sayaç için okuyabilsin diye,
      driver view'da orders alanı delivery + includeDone mantığına göre döner.
      Varsayılan/TV görünümü bozulmasın diye normalde orders hâlâ sadece aktif siparişlerdir.
    */
    const driverOrders = items.filter((order: any) => order.mode === "delivery");
    const driverDoneOrders = includeDone
      ? driverOrders.filter(
          (order: any) => order.status === "done" || order.status === "cancelled",
        )
      : [];

    const responseOrders = driverView ? driverOrders : tvOrders;
    const responseDoneOrders = driverView ? driverDoneOrders : doneOrders;
    const responseItems = driverView ? driverOrders : items;

    const counts = {
      ...channelCounts(allOrders),
      ...statusCounts(allOrders),
      active: activeOrders.length,
      done: finishedOrders.length,
      total: allOrders.length,
      driver: driverOrders.length,
      driverDone: driverDoneOrders.length,
    };

    return jsonResponse({
      ok: true,
      source: "db",
      view,
      tz,
      now: day.nowMs,
      range: {
        all,
        from: fromDate ? fromDate.toISOString() : !all ? day.start.toISOString() : null,
        to: toDateValue ? toDateValue.toISOString() : !all ? day.end.toISOString() : null,
      },
      archived: {
        included: includeArchived,
      },
      counts,

      // TV / legacy shape
      orders: responseOrders,
      doneOrders: responseDoneOrders,

      // Extra safe shapes
      tvOrders,
      activeOrders,
      finishedOrders,
      driverOrders,
      driverDoneOrders,

      // Generic shape
      items: responseItems,
      allOrders,
      count: responseOrders.length,
      totalCount: allOrders.length,
    });
  } catch (error: any) {
    return errorResponse(error, "ORDERS_LIST_FAILED");
  }
}
