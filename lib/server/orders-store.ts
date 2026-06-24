// lib/server/orders-store.ts
import fs from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import { Prisma } from "@prisma/client";
import { prisma, getTenantId } from "@/lib/db";

export type Mode = "delivery" | "pickup";

export type Category =
  | "burger"
  | "vegan"
  | "extras"
  | "sauces"
  | "drinks"
  | "hotdogs"
  | "donuts"
  | "bubbletea"
  | "bubbleTea"
  | string;

export type OrderStatus =
  | "new"
  | "preparing"
  | "ready"
  | "out_for_delivery"
  | "done"
  | "cancelled"
  | "delivered"
  | "canceled";

export type OrderItem = {
  id?: string;
  sku?: string;
  name: string;
  category?: Category;
  price: number;
  qty: number;
  add?: { label?: string; name?: string; price?: number }[];
  rm?: any[];
  note?: string;
};

export type OrderLog = {
  id: string;
  ts: number;
  mode: Mode;
  plz?: string | null;
  customerName?: string;
  phone?: string;
  addressLine?: string;
  note?: string;
  items: OrderItem[];
  merchandise?: number;
  discount?: number;
  surcharges?: number;
  coupon?: string | null;
  couponDiscount?: number;
  total: number;
  status?: OrderStatus;

  orderId?: string;
  channel?: string;
  customer?: Record<string, any>;
  meta?: Record<string, any>;
  history?: any[];
  planned?: string | null;
  etaMin?: number | null;
  etaAdjustMin?: number;
  driver?: any;
  print?: any;
  doneAt?: string | null;
  cancelledAt?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  order?: any;
  item?: any;
};

export type VisitorPing = {
  ts: number;
  path?: string;
  sessionId?: string;
};

const DATA_DIR = path.join(process.cwd(), ".data");
const VISITORS_FILE = path.join(DATA_DIR, "visitors.json");

const rid = () => {
  try {
    return randomUUID();
  } catch {
    return String(Date.now() + Math.random());
  }
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
  const n = match ? Number(match[0]) : Number(text);

  return Number.isFinite(n) ? n : fallback;
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
      if (key === "__proto__" || key === "prototype" || key === "constructor") {
        continue;
      }

      out[key] = sanitizeJson(item);
    }

    return out;
  }

  return value;
}

function normalizeMode(value: any): Mode {
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

function normalizeDbStatus(
  value: any,
): "new" | "preparing" | "ready" | "out_for_delivery" | "done" | "cancelled" {
  const text = String(value || "").toLowerCase().trim();

  if (text === "received" || text === "eingegangen") return "new";

  if (
    text === "prepare" ||
    text === "preparing" ||
    text === "zubereitung" ||
    text === "in_vorbereitung" ||
    text === "in vorbereitung"
  ) {
    return "preparing";
  }

  if (text === "ready" || text === "bereit" || text === "abholbereit") return "ready";

  if (text === "on_the_way" || text === "unterwegs" || text === "out_for_delivery") {
    return "out_for_delivery";
  }

  if (text === "delivered" || text === "completed" || text === "geliefert" || text === "done") {
    return "done";
  }

  if (text === "cancelled" || text === "canceled" || text === "storniert") {
    return "cancelled";
  }

  if (text === "new") return "new";

  return "new";
}

function normalizeHistory(value: any): any[] {
  return ensureArr(value).map((entry) =>
    sanitizeJson({
      ts: toNumber(entry?.ts ?? entry?.createdAt, Date.now()),
      action: cleanText(entry?.action ?? entry?.status ?? "event"),
      by: cleanText(entry?.by) || undefined,
      note: cleanText(entry?.note) || undefined,
    }),
  );
}

function normalizeItems(value: any): OrderItem[] {
  return ensureArr(value).map((item) =>
    sanitizeJson({
      id: item?.id ? String(item.id) : undefined,
      sku: item?.sku ? String(item.sku) : item?.code ? String(item.code) : undefined,
      name: cleanText(item?.name ?? item?.title, "Artikel"),
      category: item?.category ? String(item.category) : undefined,
      price: toNumber(item?.price ?? item?.unitPrice, 0),
      qty: Math.max(1, toNumber(item?.qty ?? item?.quantity ?? 1, 1)),
      note: item?.note ? String(item.note) : undefined,
      add: Array.isArray(item?.add ?? item?.extras)
        ? ensureArr(item?.add ?? item?.extras).map((extra: any) => ({
            label: extra?.label ? String(extra.label) : extra?.name ? String(extra.name) : undefined,
            name: extra?.name ? String(extra.name) : extra?.label ? String(extra.label) : undefined,
            price: toNumber(extra?.price, 0),
          }))
        : undefined,
      rm: Array.isArray(item?.rm ?? item?.remove)
        ? ensureArr(item?.rm ?? item?.remove).map((entry: any) => String(entry))
        : undefined,
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
    if (hasOrderField(field)) {
      select[field] = true;
    }
  }

  return select;
}

function serializeOrder(row: any): OrderLog {
  const meta = ensureObj(row?.meta);
  const customer = normalizeCustomer(row?.customer);
  const items = normalizeItems(row?.items);
  const history = normalizeHistory(row?.history ?? meta?.history);

  const status = normalizeDbStatus(meta?.statusManual ?? meta?.manualStatus ?? row?.status);
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
    ts: toMs(row?.ts ?? row?.createdAt),
    createdAt: toIso(row?.createdAt ?? row?.ts),
    updatedAt: toIso(row?.updatedAt),
    mode: normalizeMode(row?.mode),
    channel: normalizeChannel(row?.channel),
    plz: customer?.plz ?? customer?.zip ?? null,
    customerName: customer?.name ?? "",
    phone: customer?.phone ?? "",
    addressLine,
    note,
    items,
    merchandise,
    discount,
    surcharges,
    coupon: row?.coupon ?? meta?.coupon ?? null,
    couponDiscount,
    total,
    status,
    customer,
    meta: enrichedMeta,
    history,
    planned: row?.planned ?? null,
    etaMin: row?.etaMin ?? null,
    etaAdjustMin: row?.etaAdjustMin ?? meta?.etaAdjustMin ?? 0,
    driver: row?.driver ?? meta?.driver ?? null,
    print: row?.print ?? meta?.print ?? null,
    doneAt: toIso(row?.doneAt ?? meta?.doneAt),
    cancelledAt: toIso(row?.cancelledAt ?? meta?.cancelledAt),
    order: payload,
    item: payload,
  }) as OrderLog;
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
          ts: ts.getTime(),
          action: `status:${status}`,
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

/* ============ ORDERS / DB-FIRST LEGACY WRAPPER ============ */

export function normalizeOrders(arr: any[]): OrderLog[] {
  if (!Array.isArray(arr)) return [];

  const safe: OrderLog[] = [];

  for (const raw of arr) {
    try {
      const items = normalizeItems(raw?.items ?? raw?.order?.items);
      const customer = normalizeCustomer(raw?.customer ?? raw?.order?.customer ?? raw);
      const meta = ensureObj(raw?.meta ?? raw?.order?.meta);

      const merchandise = toNumber(
        raw?.merchandise ?? raw?.order?.merchandise,
        computeMerchandise(items),
      );

      const discount = toNumber(raw?.discount ?? raw?.order?.discount, 0);
      const surcharges = toNumber(raw?.surcharges ?? raw?.order?.surcharges, 0);
      const couponDiscount = toNumber(raw?.couponDiscount ?? raw?.order?.couponDiscount ?? meta?.couponDiscount, 0);

      const total = toNumber(
        raw?.total ?? raw?.order?.total,
        Math.max(0, merchandise + surcharges - discount - couponDiscount),
      );

      const id = cleanId(raw?.id || raw?.orderId || rid()) || rid();

      safe.push({
        id,
        orderId: String(raw?.orderId || raw?.id || id),
        ts: toMs(raw?.ts ?? raw?.createdAt),
        mode: normalizeMode(raw?.mode ?? raw?.order?.mode),
        plz: raw?.plz != null ? String(raw.plz) : customer?.plz ?? customer?.zip ?? null,
        customerName: cleanText(raw?.customerName ?? customer?.name, ""),
        phone: cleanText(raw?.phone ?? customer?.phone, ""),
        addressLine: cleanText(raw?.addressLine ?? customer?.addressLine ?? customer?.address, ""),
        note: cleanText(raw?.note ?? meta?.note ?? customer?.deliveryHint ?? customer?.note, ""),
        items,
        merchandise,
        discount,
        surcharges,
        coupon: raw?.coupon ?? meta?.coupon ?? null,
        couponDiscount,
        total,
        status: normalizeDbStatus(raw?.status ?? meta?.statusManual ?? meta?.manualStatus),
        channel: normalizeChannel(raw?.channel ?? raw?.source),
        customer,
        meta,
        history: normalizeHistory(raw?.history ?? meta?.history),
        planned: raw?.planned ?? raw?.order?.planned ?? null,
        etaMin: raw?.etaMin ?? raw?.order?.etaMin ?? null,
        etaAdjustMin: toNumber(raw?.etaAdjustMin ?? meta?.etaAdjustMin, 0),
        driver: raw?.driver ?? meta?.driver ?? null,
        print: raw?.print ?? meta?.print ?? null,
        doneAt: toIso(raw?.doneAt ?? meta?.doneAt),
        cancelledAt: toIso(raw?.cancelledAt ?? meta?.cancelledAt),
      });
    } catch {
      // skip malformed order
    }
  }

  safe.sort((a, b) => b.ts - a.ts);
  return safe;
}

export async function readOrders(): Promise<OrderLog[]> {
  const tenantId = await getTenantId();

  const rows = await prisma.order.findMany({
    where: {
      tenantId,
    },
    orderBy: {
      ts: "desc",
    },
    take: 1000,
    select: buildOrderSelect() as any,
  });

  return rows.map(serializeOrder);
}

export async function writeOrders(list: OrderLog[]): Promise<void> {
  const tenantId = await getTenantId();
  const normalized = normalizeOrders(list);

  /*
    DB-first güvenlik:
    Eski JSON/file-store mantığında writeOrders tüm listeyi replace ediyordu.
    Postgres'te bu davranış stale local cache yüzünden geçmiş siparişleri silebilir.
    Bu yüzden artık silme yok; gelen siparişler tenant + id ile upsert edilir.
  */
  await prisma.$transaction(async (tx) => {
    const usedIds = new Set<string>();

    for (const raw of normalized) {
      let id = cleanId(raw?.id || raw?.orderId || rid()) || rid();

      while (usedIds.has(id)) {
        id = rid();
      }

      usedIds.add(id);

      const data = buildCreateData(tenantId, {
        ...raw,
        id,
      });

      const existing = await tx.order.findFirst({
        where: {
          tenantId,
          id,
        },
        select: {
          id: true,
        },
      });

      if (existing?.id) {
        await tx.order.update({
          where: {
            id: existing.id,
          },
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

export async function findOrderById(id: string): Promise<OrderLog | null> {
  const tenantId = await getTenantId();
  const row = await findOrderRow(tenantId, id);

  return row ? serializeOrder(row) : null;
}

/* ============ VISITORS / LEGACY FILE STORE ============ */

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

async function ensureDir() {
  try {
    await fs.mkdir(DATA_DIR, {
      recursive: true,
    });
  } catch {}
}

export async function readVisitors(): Promise<VisitorPing[]> {
  await ensureDir();

  try {
    const txt = await fs.readFile(VISITORS_FILE, "utf8");
    const raw = JSON.parse(txt);
    return normalizeVisitors(raw);
  } catch {
    return [];
  }
}

export async function writeVisitors(list: VisitorPing[]): Promise<void> {
  await ensureDir();
  await fs.writeFile(VISITORS_FILE, JSON.stringify(normalizeVisitors(list), null, 2), "utf8");
}