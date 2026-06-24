// lib/server/db.ts
import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { Prisma } from "@prisma/client";
import { prisma, getTenantId } from "@/lib/db";

/**
 * Legacy server DB wrapper.
 *
 * Orders are DB-first now:
 * - readAll / writeAll / upsert / updateStatus / getById use Prisma/Postgres.
 *
 * File storage remains only for:
 * - visitors fallback
 * - generic DBA key/value fallback if Prisma Setting is unavailable
 */

const DATA_DIRS = [
  path.join(process.cwd(), ".data"),
  path.join(process.cwd(), "data"),
  "/tmp",
];

const VISITORS_FILE = "visitors.json";
const KV_FILE = "kv.json";

/* ───────────────── types ───────────────── */

export type OrderChannel = "lieferando" | "liferando" | "apollo" | "web";
export type OrderMode = "pickup" | "delivery";

export type DbOrderStatus =
  | "new"
  | "preparing"
  | "ready"
  | "out_for_delivery"
  | "done"
  | "cancelled";

export type LegacyOrderStatus =
  | "received"
  | "preparing"
  | "ready"
  | "on_the_way"
  | "delivered"
  | "completed"
  | "cancelled"
  | "canceled";

export type OrderStatus = DbOrderStatus | LegacyOrderStatus;

export type StatusHistoryItem = {
  status?: OrderStatus;
  action?: string;
  at?: number;
  ts?: number;
  by?: string;
  note?: string;
};

export type StoredOrder = {
  id: string;
  orderId?: string;
  status: OrderStatus;
  createdAt: number;
  updatedAt?: number;
  completedAt?: number;
  etaMin?: number | null;
  etaAdjustMin?: number;

  channel?: OrderChannel | string;
  mode?: OrderMode;
  plz?: string | null;

  customerName?: string;
  phone?: string;
  addressLine?: string;
  note?: string;

  merchandise?: number;
  discount?: number;
  surcharges?: number;
  coupon?: string | null;
  couponDiscount?: number;
  total?: number;

  items?: any[];
  customer?: Record<string, any>;
  meta?: Record<string, any>;

  order: any;
  item?: any;
  history?: StatusHistoryItem[];

  planned?: string | null;
  driver?: any;
  print?: any;
  doneAt?: string | null;
  cancelledAt?: string | null;
};

export type VisitorPing = {
  ts: number;
  path?: string;
  sessionId?: string;
};

/* ───────────────── generic helpers ───────────────── */

const rid = () => {
  try {
    return randomUUID();
  } catch {
    return String(Date.now() + Math.random());
  }
};

function ensureDir(): string {
  for (const dir of DATA_DIRS) {
    try {
      fs.mkdirSync(dir, { recursive: true });
      return dir;
    } catch {}
  }

  return "/tmp";
}

function kvPath(): string {
  return path.join(ensureDir(), KV_FILE);
}

function visitorsPath(): string {
  return path.join(ensureDir(), VISITORS_FILE);
}

function writeJsonAtomic(targetPath: string, data: unknown) {
  const tmpPath = `${targetPath}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), "utf8");
  fs.renameSync(tmpPath, targetPath);
}

function hasOrderField(fieldName: string) {
  try {
    const model = Prisma.dmmf.datamodel.models.find((item) => item.name === "Order");
    return Boolean(model?.fields?.some((field) => field.name === fieldName));
  } catch {
    return false;
  }
}

/**
 * DB id değerini bozmadan temizler.
 * Önemli: uppercase yapmıyoruz. CUID/lowercase id gelirse DB lookup kırılmasın.
 */
function cleanId(value: any) {
  return String(value || "")
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

    const parsed = new Date(text);
    if (Number.isFinite(parsed.valueOf())) return parsed;

    const asNumber = Number(text);
    if (Number.isFinite(asNumber)) {
      const byNumber = new Date(asNumber);
      return Number.isFinite(byNumber.valueOf()) ? byNumber : null;
    }
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
      if (key === "__proto__" || key === "prototype" || key === "constructor") continue;
      out[key] = sanitizeJson(item);
    }

    return out;
  }

  return value;
}

/* ───────────────── date helpers Europe/Berlin ───────────────── */

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
  if (offset2 !== offset1) utc = utcGuess - offset2;

  return new Date(utc);
}

function berlinDayBounds() {
  const timeZone = "Europe/Berlin";
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
  };
}

/* ───────────────── order mapping ───────────────── */

function normalizeMode(value: any): OrderMode {
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

function normalizeChannel(value: any): OrderChannel {
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

  return "web";
}

function normalizeDbStatus(value: any): DbOrderStatus {
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

  if (
    text === "new" ||
    text === "preparing" ||
    text === "ready" ||
    text === "out_for_delivery" ||
    text === "done" ||
    text === "cancelled"
  ) {
    return text;
  }

  return "new";
}

function toLegacyStatus(value: any): LegacyOrderStatus {
  const status = normalizeDbStatus(value);

  switch (status) {
    case "new":
      return "received";
    case "out_for_delivery":
      return "on_the_way";
    case "done":
      return "completed";
    case "cancelled":
      return "cancelled";
    case "preparing":
    case "ready":
      return status;
    default:
      return "received";
  }
}

function normalizeHistory(value: any): StatusHistoryItem[] {
  return ensureArr(value).map((entry) =>
    sanitizeJson({
      status: entry?.status ? normalizeDbStatus(entry.status) : undefined,
      action: cleanText(entry?.action ?? entry?.status ?? "event"),
      at: toNumber(entry?.at ?? entry?.ts ?? entry?.createdAt, Date.now()),
      ts: toNumber(entry?.ts ?? entry?.at ?? entry?.createdAt, Date.now()),
      by: cleanText(entry?.by) || undefined,
      note: cleanText(entry?.note) || undefined,
    }),
  );
}

function normalizeItems(value: any): any[] {
  return ensureArr(value).map((item, index) =>
    sanitizeJson({
      id: item?.id ? String(item.id) : undefined,
      sku: item?.sku ? String(item.sku) : item?.code ? String(item.code) : undefined,
      name: cleanText(item?.name ?? item?.title, "Artikel"),
      category: item?.category ? String(item.category) : undefined,
      price: toNumber(item?.price ?? item?.unitPrice, 0),
      qty: Math.max(1, toNumber(item?.qty ?? item?.quantity ?? 1, 1)),
      add: ensureArr(item?.add ?? item?.extras).map((extra: any) => ({
        label: extra?.label ? String(extra.label) : extra?.name ? String(extra.name) : undefined,
        name: extra?.name ? String(extra.name) : extra?.label ? String(extra.label) : undefined,
        price: toNumber(extra?.price, 0),
      })),
      rm: ensureArr(item?.rm ?? item?.remove).map((entry: any) => String(entry)),
      note: item?.note ? String(item.note) : undefined,
      _idx: index,
    }),
  );
}

function lineTotal(item: any) {
  const qty = Math.max(1, toNumber(item?.qty ?? item?.quantity ?? 1, 1));
  const base = toNumber(item?.price ?? item?.unitPrice, 0);

  const extrasTotal = ensureArr(item?.add ?? item?.extras).reduce(
    (total, extra) => total + toNumber(extra?.price, 0),
    0,
  );

  return (base + extrasTotal) * qty;
}

function computeMerchandise(items: any[]) {
  return items.reduce((total, item) => total + lineTotal(item), 0);
}

function normalizeCustomer(raw: any) {
  const customer = ensureObj(raw?.customer ?? raw);

  const name =
    raw?.customerName ??
    raw?.name ??
    customer?.name ??
    customer?.customerName ??
    "";

  const phone =
    raw?.phone ??
    raw?.telephone ??
    customer?.phone ??
    customer?.telephone ??
    "";

  const streetHouse = [customer?.street, customer?.house ?? customer?.houseNo]
    .map((part) => cleanText(part))
    .filter(Boolean)
    .join(" ");

  const address =
    raw?.addressLine ??
    raw?.address ??
    customer?.addressLine ??
    customer?.address ??
    streetHouse ??
    "";

  const plz =
    raw?.plz ??
    raw?.zip ??
    customer?.plz ??
    customer?.zip ??
    customer?.postalCode ??
    "";

  const email = raw?.email ?? customer?.email ?? "";

  const note =
    raw?.note ??
    raw?.orderNote ??
    customer?.note ??
    customer?.deliveryHint ??
    "";

  return sanitizeJson({
    ...customer,
    name: cleanText(name, ""),
    phone: cleanText(phone, ""),
    address: cleanText(address, ""),
    addressLine: cleanText(address, ""),
    street: cleanText(customer?.street, ""),
    house: cleanText(customer?.house ?? customer?.houseNo, ""),
    plz: cleanText(plz, "") || null,
    zip: cleanText(customer?.zip ?? plz, "") || null,
    city: cleanText(customer?.city, ""),
    email: cleanText(email, ""),
    deliveryHint: cleanText(note, ""),
    note: cleanText(customer?.note ?? note, ""),
  });
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
    "history",
    "print",
  ];

  for (const field of optionalFields) {
    if (hasOrderField(field)) select[field] = true;
  }

  return select;
}

function serializeOrder(row: any): StoredOrder {
  const meta = ensureObj(row?.meta);
  const customer = normalizeCustomer(row?.customer);
  const items = normalizeItems(row?.items);
  const history = normalizeHistory(row?.history ?? meta?.history);

  const dbStatus = normalizeDbStatus(meta?.statusManual ?? meta?.manualStatus ?? row?.status);
  const legacyStatus = toLegacyStatus(dbStatus);

  const merchandise = toNumber(row?.merchandise, computeMerchandise(items));
  const discount = toNumber(row?.discount, 0);
  const surcharges = toNumber(row?.surcharges, 0);
  const couponDiscount = toNumber(row?.couponDiscount, meta?.couponDiscount ?? 0);

  const total = toNumber(
    row?.total,
    Math.max(0, merchandise + surcharges - discount - couponDiscount),
  );

  const addressLine = cleanText(
    customer?.addressLine ?? customer?.address ?? customer?.street,
    "",
  );

  const note = cleanText(
    meta?.note ?? meta?.orderNote ?? customer?.deliveryHint ?? customer?.note,
    "",
  );

  const enrichedMeta = sanitizeJson({
    ...meta,
    history,
    coupon: row?.coupon ?? meta?.coupon ?? null,
    couponDiscount,
    couponMeta: meta?.couponMeta ?? null,
    couponLifecycle: meta?.couponLifecycle ?? null,
  });

  const payload = sanitizeJson({
    items,
    customer,
    planned: row?.planned ?? null,
    meta: enrichedMeta,
    merchandise,
    discount,
    surcharges,
    total,
    coupon: row?.coupon ?? meta?.coupon ?? null,
    couponDiscount,
  });

  return sanitizeJson({
    id: String(row?.id ?? ""),
    orderId: String(row?.id ?? ""),
    status: dbStatus,
    legacyStatus,
    statusLegacy: legacyStatus,
    createdAt: toMs(row?.createdAt ?? row?.ts),
    updatedAt: row?.updatedAt ? toMs(row.updatedAt) : undefined,
    completedAt:
      dbStatus === "done"
        ? toMs(row?.doneAt ?? enrichedMeta?.doneAt ?? row?.updatedAt, Date.now())
        : undefined,
    etaMin: row?.etaMin ?? null,
    etaAdjustMin: row?.etaAdjustMin ?? enrichedMeta?.etaAdjustMin ?? 0,
    channel: normalizeChannel(row?.channel),
    mode: normalizeMode(row?.mode),
    plz: customer?.plz ?? customer?.zip ?? null,
    customerName: customer?.name ?? "",
    phone: customer?.phone ?? "",
    addressLine,
    note,
    items,
    merchandise,
    discount,
    surcharges,
    coupon: row?.coupon ?? enrichedMeta?.coupon ?? null,
    couponDiscount,
    total,
    customer,
    meta: enrichedMeta,
    history,
    planned: row?.planned ?? null,
    driver: row?.driver ?? enrichedMeta?.driver ?? null,
    print: row?.print ?? enrichedMeta?.print ?? null,
    doneAt: toIso(row?.doneAt ?? enrichedMeta?.doneAt),
    cancelledAt: toIso(row?.cancelledAt ?? enrichedMeta?.cancelledAt),
    order: payload,
    item: payload,
  }) as StoredOrder;
}

async function findOrderRow(tenantId: string, idRaw: any, select?: Record<string, boolean>) {
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
    select: (select ?? buildOrderSelect()) as any,
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

  const foundId = rows?.[0]?.id;
  if (!foundId) return null;

  return prisma.order.findFirst({
    where: {
      tenantId,
      id: String(foundId),
    },
    select: (select ?? buildOrderSelect()) as any,
  });
}

function buildCreateData(tenantId: string, raw: any) {
  const now = Date.now();
  const order = ensureObj(raw?.order);
  const metaRaw = ensureObj(raw?.meta ?? order?.meta);

  const id = cleanId(raw?.id || raw?.orderId || rid()) || rid();
  const mode = normalizeMode(raw?.mode ?? raw?.orderMode ?? order?.mode);
  const channel = normalizeChannel(raw?.channel ?? raw?.source ?? order?.channel ?? order?.source);
  const status = normalizeDbStatus(raw?.status ?? metaRaw?.statusManual);

  const items = normalizeItems(raw?.items ?? order?.items);
  const customer = normalizeCustomer(raw?.customer ?? order?.customer ?? raw);

  const merchandise = toNumber(raw?.merchandise ?? order?.merchandise, computeMerchandise(items));
  const discount = toNumber(raw?.discount ?? order?.discount, 0);
  const surcharges = toNumber(raw?.surcharges ?? order?.surcharges, 0);
  const couponDiscount = toNumber(
    raw?.couponDiscount ?? order?.couponDiscount ?? metaRaw?.couponDiscount,
    0,
  );

  const total = toNumber(
    raw?.total ?? order?.total,
    Math.max(0, merchandise + surcharges - discount - couponDiscount),
  );

  const ts = toDate(raw?.ts ?? raw?.createdAt ?? order?.ts) ?? new Date(now);
  const history = normalizeHistory(raw?.history ?? metaRaw?.history);

  const finalHistory = history.length
    ? history
    : [
        {
          status,
          action: `status:${status}`,
          at: ts.getTime(),
          ts: ts.getTime(),
          by: channel || "api",
        },
      ];

  const note =
    raw?.note ??
    raw?.orderNote ??
    order?.note ??
    order?.orderNote ??
    metaRaw?.note ??
    customer?.deliveryHint ??
    null;

  const coupon = raw?.coupon ?? order?.coupon ?? metaRaw?.coupon ?? null;

  const meta = sanitizeJson({
    ...metaRaw,
    source: channel,
    note,
    orderNote: note,
    history: finalHistory,
    coupon: coupon ? String(coupon) : null,
    couponDiscount,
    couponMeta: metaRaw?.couponMeta ?? raw?.couponMeta ?? order?.couponMeta ?? null,
    couponLifecycle: metaRaw?.couponLifecycle ?? raw?.couponLifecycle ?? order?.couponLifecycle ?? null,
    orderId: metaRaw?.orderId ?? raw?.orderId ?? id,
    trackingCode: metaRaw?.trackingCode ?? id,
    code: metaRaw?.code ?? id,
  });

  const data: Record<string, any> = {
    id,
    tenantId,
    mode,
    channel,
    status,
    merchandise,
    discount,
    surcharges,
    total,
    coupon: coupon ? String(coupon) : null,
    couponDiscount,
    customer,
    items,
    meta,
    ts,
    planned: raw?.planned ?? order?.planned ?? null,
    etaMin: raw?.etaMin ?? order?.etaMin ?? (mode === "pickup" ? 15 : 35),
  };

  if (hasOrderField("etaAdjustMin")) {
    data.etaAdjustMin = toNumber(raw?.etaAdjustMin ?? metaRaw?.etaAdjustMin, 0);
  }

  if (hasOrderField("driver")) {
    data.driver = sanitizeJson(raw?.driver ?? metaRaw?.driver ?? null);
  }

  if (hasOrderField("doneAt")) {
    data.doneAt = status === "done" ? toDate(raw?.doneAt ?? metaRaw?.doneAt) || new Date() : null;
  }

  if (hasOrderField("cancelledAt")) {
    data.cancelledAt =
      status === "cancelled" ? toDate(raw?.cancelledAt ?? metaRaw?.cancelledAt) || new Date() : null;
  }

  if (hasOrderField("history")) {
    data.history = sanitizeJson(finalHistory);
  }

  if (hasOrderField("print")) {
    data.print = sanitizeJson(raw?.print ?? metaRaw?.print ?? null);
  }

  return data;
}

function toUpdateData(createData: Record<string, any>) {
  const data = { ...createData };
  delete data.id;
  delete data.tenantId;
  return data;
}

/* ───────────────── ORDERS / DB-FIRST ───────────────── */

export function normalizeOrders(arr: any[]): StoredOrder[] {
  if (!Array.isArray(arr)) return [];

  const safe: StoredOrder[] = [];

  for (const raw of arr) {
    try {
      const built = buildCreateData("__tenant__", raw);
      safe.push(
        serializeOrder({
          ...built,
          createdAt: built.ts,
          updatedAt: built.ts,
        }),
      );
    } catch {
      // skip malformed order
    }
  }

  safe.sort((a, b) => b.createdAt - a.createdAt);
  return safe;
}

export async function readAll(): Promise<StoredOrder[]> {
  const tenantId = await getTenantId();

  const rows = await prisma.order.findMany({
    where: { tenantId },
    orderBy: { ts: "desc" },
    take: 1000,
    select: buildOrderSelect() as any,
  });

  return rows.map(serializeOrder);
}

export async function writeAll(list: StoredOrder[]) {
  const tenantId = await getTenantId();
  const normalized = normalizeOrders(list);

  /*
    DB-first güvenlik:
    Eski JSON mantığında writeAll tüm listeyi replace ediyordu.
    Postgres'te bu davranış stale client/cache yüzünden geçmiş siparişleri silebilir.
    Bu yüzden burada silme yok; gelen siparişler tenant + id ile upsert edilir.
  */
  await prisma.$transaction(async (tx) => {
    const usedIds = new Set<string>();

    for (const raw of normalized) {
      let id = cleanId(raw?.id || raw?.orderId || rid()) || rid();

      while (usedIds.has(id)) {
        id = rid();
      }

      usedIds.add(id);

      const data = buildCreateData(tenantId, { ...raw, id });

      const existing = await tx.order.findFirst({
        where: { tenantId, id },
        select: { id: true },
      });

      if (existing?.id) {
        await tx.order.update({
          where: { id: existing.id },
          data: toUpdateData(data) as any,
        });
      } else {
        await tx.order.create({
          data: data as any,
        });
      }
    }
  });
}

export async function upsert(order: StoredOrder) {
  const tenantId = await getTenantId();
  const id = cleanId(order?.id || order?.orderId || rid()) || rid();
  const data = buildCreateData(tenantId, { ...order, id });

  const existing = await prisma.order.findFirst({
    where: { tenantId, id },
    select: { id: true },
  });

  if (existing?.id) {
    await prisma.order.update({
      where: { id: existing.id },
      data: toUpdateData(data) as any,
    });
  } else {
    await prisma.order.create({
      data: data as any,
    });
  }
}

export async function upsertMany(arr: StoredOrder[]) {
  if (!Array.isArray(arr) || arr.length === 0) return;

  for (const order of arr) {
    await upsert(order);
  }
}

export async function updateStatus(id: string, status: OrderStatus | string) {
  const tenantId = await getTenantId();
  const next = normalizeDbStatus(status);

  const row = await findOrderRow(tenantId, id);

  if (!row) return;

  const meta = ensureObj((row as any).meta);
  const history = normalizeHistory((row as any).history ?? meta?.history);
  const now = Date.now();

  const nextHistory = [
    ...history,
    {
      status: next,
      action: `status:${next}`,
      at: now,
      ts: now,
      by: "server-db",
    },
  ];

  const nextMeta: Record<string, any> = {
    ...meta,
    history: nextHistory,
    lastStatus: next,
    lastStatusAt: now,
    lastStatusBy: "server-db",
  };

  if (next === "done" || next === "cancelled") {
    delete nextMeta.statusManual;
  } else {
    nextMeta.statusManual = next;
  }

  if (next === "done") nextMeta.doneAt = now;
  else delete nextMeta.doneAt;

  if (next === "cancelled") nextMeta.cancelledAt = now;
  else delete nextMeta.cancelledAt;

  const data: Record<string, any> = {
    status: next,
    meta: sanitizeJson(nextMeta),
  };

  if (hasOrderField("history")) {
    data.history = sanitizeJson(nextHistory);
  }

  if (hasOrderField("doneAt")) {
    data.doneAt = next === "done" ? new Date(now) : null;
  }

  if (hasOrderField("cancelledAt")) {
    data.cancelledAt = next === "cancelled" ? new Date(now) : null;
  }

  await prisma.order.update({
    where: {
      id: String((row as any).id),
    },
    data: data as any,
  });
}

export async function setEta(id: string, etaMin: number | undefined) {
  const tenantId = await getTenantId();

  const row = await findOrderRow(tenantId, id);

  if (!row) return;

  const meta = ensureObj((row as any).meta);
  const nextEta = etaMin == null ? null : Math.round(toNumber(etaMin, 0));

  const data: Record<string, any> = {
    etaMin: nextEta,
    meta: sanitizeJson({
      ...meta,
      etaMin: nextEta,
      etaUpdatedAt: Date.now(),
    }),
  };

  await prisma.order.update({
    where: {
      id: String((row as any).id),
    },
    data: data as any,
  });
}

export async function setChannelAndMode(
  id: string,
  channel?: OrderChannel,
  mode?: OrderMode,
) {
  const tenantId = await getTenantId();

  const row = await findOrderRow(tenantId, id, {
    id: true,
    meta: true,
    channel: true,
    mode: true,
  });

  if (!row) return;

  const meta = ensureObj((row as any).meta);

  const data: Record<string, any> = {
    meta: sanitizeJson({
      ...meta,
      channel: channel ? normalizeChannel(channel) : (row as any).channel,
      mode: mode ? normalizeMode(mode) : (row as any).mode,
      routingUpdatedAt: Date.now(),
    }),
  };

  if (channel) data.channel = normalizeChannel(channel);
  if (mode) data.mode = normalizeMode(mode);

  await prisma.order.update({
    where: {
      id: String((row as any).id),
    },
    data: data as any,
  });
}

export async function getById(id: string): Promise<StoredOrder | null> {
  const tenantId = await getTenantId();

  const row = await findOrderRow(tenantId, id);

  return row ? serializeOrder(row) : null;
}

export async function readByDateRange(startMs: number, endMs: number): Promise<StoredOrder[]> {
  const tenantId = await getTenantId();

  const rows = await prisma.order.findMany({
    where: {
      tenantId,
      ts: {
        gte: new Date(startMs),
        lte: new Date(endMs),
      },
    },
    orderBy: {
      ts: "desc",
    },
    take: 1000,
    select: buildOrderSelect() as any,
  });

  return rows.map(serializeOrder);
}

export async function readToday(): Promise<StoredOrder[]> {
  const bounds = berlinDayBounds();
  return readByDateRange(bounds.startMs, bounds.endMs);
}

export async function pruneHinweisToday() {
  /*
    DB-first sistemde sipariş geçmişi kalıcıdır.
    Eski JSON/TV mantığındaki "bugün dışını temizle" davranışı
    Postgres üzerinde veri kaybına sebep olabilir.
    Bu yüzden artık no-op.
  */
  return;
}

export async function readActiveToday(): Promise<StoredOrder[]> {
  const today = await readToday();

  return today.filter((order) => {
    const status = normalizeDbStatus(order.status);
    return status !== "done" && status !== "cancelled";
  });
}

export async function readCompletedToday(): Promise<StoredOrder[]> {
  const today = await readToday();

  return today.filter((order) => {
    const status = normalizeDbStatus(order.status);
    return status === "done" || status === "cancelled";
  });
}

export async function countsByChannelToday(): Promise<Record<OrderChannel, number>> {
  const base: Record<OrderChannel, number> = {
    lieferando: 0,
    liferando: 0,
    apollo: 0,
    web: 0,
  };

  const today = await readToday();

  for (const order of today) {
    const channel = normalizeChannel(order.channel) as OrderChannel;
    base[channel] = (base[channel] || 0) + 1;

    if (channel === "lieferando") {
      base.liferando = base.lieferando;
    }
  }

  return base;
}

/* ───────────────── VISITORS / legacy file store ───────────────── */

export function normalizeVisitors(arr: any[]): VisitorPing[] {
  if (!Array.isArray(arr)) return [];

  const safe: VisitorPing[] = [];

  for (const raw of arr) {
    try {
      const ts = Number(raw?.ts) || Date.now();
      const visitorPath = raw?.path ? String(raw.path) : undefined;
      const sessionId = raw?.sessionId ? String(raw.sessionId) : undefined;

      safe.push({
        ts,
        path: visitorPath,
        sessionId,
      });
    } catch {
      // skip malformed visitor ping
    }
  }

  safe.sort((a, b) => a.ts - b.ts);
  return safe;
}

export function readVisitors(): VisitorPing[] {
  try {
    const txt = fs.readFileSync(visitorsPath(), "utf8");
    const raw = JSON.parse(txt);
    return normalizeVisitors(raw);
  } catch {
    return [];
  }
}

export function writeVisitors(list: VisitorPing[]) {
  try {
    writeJsonAtomic(visitorsPath(), normalizeVisitors(list));
  } catch {}
}

/* ───────────────── key/value fallback ───────────────── */

function readJSON(key: string, fallback: any) {
  try {
    const raw = fs.readFileSync(kvPath(), "utf8");
    const obj = JSON.parse(raw) || {};
    return Object.prototype.hasOwnProperty.call(obj, key) ? obj[key] : fallback;
  } catch {
    return fallback;
  }
}

function writeJSON(key: string, data: any) {
  try {
    let obj: any = {};

    try {
      obj = JSON.parse(fs.readFileSync(kvPath(), "utf8")) || {};
    } catch {}

    obj[key] = data;
    writeJsonAtomic(kvPath(), obj);
  } catch {}
}

async function readSettingKv(key: string, fallback: any) {
  try {
    const tenantId = await getTenantId();
    const settingKey = `kv:${key}`;

    const row = await prisma.setting.findFirst({
      where: {
        tenantId,
        key: settingKey,
      },
      select: {
        value: true,
      },
    });

    return row?.value ?? fallback;
  } catch {
    return fallback;
  }
}

async function writeSettingKv(key: string, data: any) {
  const tenantId = await getTenantId();
  const settingKey = `kv:${key}`;

  const existing = await prisma.setting.findFirst({
    where: {
      tenantId,
      key: settingKey,
    },
    select: {
      id: true,
    },
  });

  const value = sanitizeJson(data);

  if (existing?.id) {
    await prisma.setting.update({
      where: {
        id: existing.id,
      },
      data: {
        value,
      },
    });
  } else {
    await prisma.setting.create({
      data: {
        tenantId,
        key: settingKey,
        value,
      },
    });
  }
}

export function usingSQLite(): boolean {
  return false;
}

export function usingPrisma(): boolean {
  return true;
}

export const DBA = {
  async read(key: string, fallback: any) {
    try {
      return await readSettingKv(key, fallback);
    } catch {
      return readJSON(key, fallback);
    }
  },

  async write(key: string, data: any) {
    try {
      await writeSettingKv(key, data);
      return;
    } catch {
      writeJSON(key, data);
    }
  },
};

export function currentMode(): "prisma" | "sqlite" | "json" {
  return "prisma";
}