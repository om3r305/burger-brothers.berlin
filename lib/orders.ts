// lib/orders.ts
// ✅ Client-side order model cache helper
// DB is the main source of truth.
// localStorage is only a fast local snapshot/cache for old UI parts.
//
// Unified DB status schema:
// new / preparing / ready / out_for_delivery / done / cancelled

export const LS_ORDERS = "bb_orders_v1";

/* ───────── Types ───────── */

export type OrderStatus =
  | "new"
  | "preparing"
  | "ready"
  | "out_for_delivery"
  | "done"
  | "cancelled";

export type OrderChannel = "abholung" | "lieferung";

export type OrderMode = "pickup" | "delivery";

export type OrderItem = {
  id?: string;
  sku?: string;
  name: string;
  category?: string;
  price: number;
  qty: number;
  add?: { name?: string; label?: string; price?: number }[];
  note?: string;
  rm?: string[];
  [key: string]: any;
};

export type OrderHistoryEntry = {
  ts: number;
  action: string;
  note?: string;
  by?: string;
};

export type PrintBucket = {
  count: number;
  lastAt?: number;
};

export type OrderPrintStats = {
  label?: PrintBucket;
  kitchen?: PrintBucket;
  barcode?: PrintBucket;
};

export type StoredOrder = {
  id: string;
  orderId?: string;
  ts: number;
  mode: OrderMode;
  channel?: OrderChannel;

  merchandise?: number;
  discount?: number;
  surcharges?: number;
  total: number;
  coupon?: string | null;
  couponDiscount?: number;

  items: OrderItem[];

  customer: {
    name: string;
    phone?: string;
    address?: string;
    addressLine?: string;
    street?: string;
    house?: string;
    zip?: string;
    plz?: string;
    city?: string;
    email?: string;
    deliveryHint?: string;
    note?: string;
    [key: string]: any;
  };

  planned?: string;

  status?: OrderStatus;
  legacyStatus?: string;

  etaMin?: number;
  etaAdjustMin?: number;

  driver?: {
    name?: string;
    id?: string;
    deviceId?: string;
    assignedAt?: number;
    lastPos?: any;
    position?: any;
    [key: string]: any;
  };

  doneAt?: number;
  cancelledAt?: number;

  meta?: Record<string, any>;
  history?: OrderHistoryEntry[];
  print?: OrderPrintStats;

  addressLine?: string;
  note?: string;
  createdAt?: string | null;
  updatedAt?: string | null;

  [key: string]: any;
};

type ServerOrderPayload = {
  id?: string;
  orderId?: string;
  status?: string | null;
  legacyStatus?: string | null;

  ts?: number | string | Date | null;
  createdAt?: number | string | Date | null;
  updatedAt?: number | string | Date | null;

  etaMin?: number | null;
  etaAdjustMin?: number | null;

  mode?: "pickup" | "delivery" | string | null;
  channel?: string | null;
  planned?: string | null;

  items?: any;
  customer?: any;
  meta?: any;
  driver?: any;
  print?: any;
  history?: any;

  total?: any;
  merchandise?: any;
  discount?: any;
  surcharges?: any;
  coupon?: string | null;
  couponDiscount?: any;

  doneAt?: any;
  cancelledAt?: any;

  order?: any;
  item?: any;
  data?: any;
  [key: string]: any;
};

/* ───────── Route guard ───────── */

const ORDER_DB_SYNC_ROUTES = [
  "/admin",
  "/tv",
  "/dashboard",
  "/driver",
  "/scan",
  "/qr",
  "/print",
] as const;

/* ───────── Small helpers ───────── */

const now = () => Date.now();

const rid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

function hasWindow() {
  return typeof window !== "undefined" && typeof localStorage !== "undefined";
}

function getCurrentPathname() {
  if (typeof window === "undefined") return "";
  return window.location?.pathname || "";
}

function canFetchOrdersFromDb() {
  if (!hasWindow()) return false;

  const path = getCurrentPathname();

  return ORDER_DB_SYNC_ROUTES.some(
    (route) => path === route || path.startsWith(`${route}/`),
  );
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

/**
 * Sadece local karşılaştırmalar için case-insensitive key.
 */
function idKey(value: any) {
  return cleanId(value).toLowerCase();
}

function normalizeChannel(value: any): OrderChannel {
  const text = String(value || "").toLowerCase().trim();

  if (
    text === "apollo" ||
    text === "apollon" ||
    text === "abholung" ||
    text === "pickup"
  ) {
    return "abholung";
  }

  return "lieferung";
}

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

function modeFromChannel(channel: any): OrderMode {
  return normalizeChannel(channel) === "abholung" ? "pickup" : "delivery";
}

function makeBucket(bucket?: PrintBucket | null): PrintBucket {
  return {
    count: Math.max(0, Number(bucket?.count || 0)) || 0,
    lastAt: Number.isFinite(Number(bucket?.lastAt))
      ? Number(bucket!.lastAt)
      : undefined,
  };
}

function toNum(value: any, fallback = 0) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value == null) return fallback;

  const text = String(value)
    .trim()
    .replace(/[€\s]/g, "")
    .replace(",", ".");

  const match = text.match(/-?\d+(\.\d+)?/);
  const parsed = match ? Number(match[0]) : Number(text);

  return Number.isFinite(parsed) ? parsed : fallback;
}

function toTs(value: any): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;

  if (value instanceof Date && Number.isFinite(value.valueOf())) {
    return value.getTime();
  }

  if (typeof value === "string" && value.trim()) {
    const n = Number(value);
    if (Number.isFinite(n) && n > 0) return n;

    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }

  return now();
}

function toOptionalTs(value: any): number | undefined {
  if (value == null || value === "") return undefined;

  const ts = toTs(value);
  return Number.isFinite(ts) ? ts : undefined;
}

function isPlainObject(value: any): value is Record<string, any> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function ensureObj(value: any): Record<string, any> {
  return isPlainObject(value) ? value : {};
}

function ensureArr(value: any): any[] {
  return Array.isArray(value) ? value : [];
}

function mapFromServerStatus(status: string | null | undefined): OrderStatus {
  const text = String(status || "").toLowerCase().trim();

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
  if (text === "completed" || text === "delivered" || text === "geliefert") return "done";
  if (text === "canceled" || text === "storniert") return "cancelled";

  switch (text) {
    case "new":
      return "new";
    case "preparing":
      return "preparing";
    case "ready":
      return "ready";
    case "out_for_delivery":
      return "out_for_delivery";
    case "done":
      return "done";
    case "cancelled":
      return "cancelled";
    default:
      return "new";
  }
}

function makePrintStats(value: any): OrderPrintStats | undefined {
  if (!value || typeof value !== "object") return undefined;

  return {
    label: value.label ? makeBucket(value.label) : undefined,
    kitchen: value.kitchen ? makeBucket(value.kitchen) : undefined,
    barcode: value.barcode ? makeBucket(value.barcode) : undefined,
  };
}

function normalizeItems(value: any): OrderItem[] {
  const items = ensureArr(value);

  return items.map((item: any, index) => ({
    ...item,
    id:
      item?.id != null
        ? String(item.id)
        : item?.sku != null
          ? String(item.sku)
          : `${item?.name || "item"}-${index}`,
    sku:
      item?.sku != null
        ? String(item.sku)
        : item?.id != null
          ? String(item.id)
          : undefined,
    name: String(item?.name || item?.title || item?.label || "Artikel"),
    category: item?.category != null ? String(item.category) : undefined,
    price: toNum(item?.price ?? item?.unitPrice ?? item?.amount, 0),
    qty: Math.max(1, toNum(item?.qty ?? item?.quantity, 1)),
    add: Array.isArray(item?.add ?? item?.extras)
      ? (item.add ?? item.extras).map((extra: any) => ({
          ...extra,
          name: extra?.name != null ? String(extra.name) : undefined,
          label: extra?.label != null ? String(extra.label) : undefined,
          price: toNum(extra?.price, 0),
        }))
      : undefined,
    note: item?.note != null ? String(item.note) : undefined,
    rm: Array.isArray(item?.rm ?? item?.remove)
      ? (item.rm ?? item.remove).map((entry: any) => String(entry))
      : undefined,
  }));
}

function normalizeCustomer(value: any): StoredOrder["customer"] {
  const customer = ensureObj(value);

  const address =
    customer.address ??
    customer.addressLine ??
    [
      customer.street && customer.house ? `${customer.street} ${customer.house}` : "",
      customer.zip || customer.plz || "",
    ]
      .filter(Boolean)
      .join(" ")
      .trim();

  return {
    ...customer,
    name: String(customer.name || customer.customerName || ""),
    phone: customer.phone != null ? String(customer.phone) : undefined,
    address: address || undefined,
    addressLine: customer.addressLine || address || undefined,
    street: customer.street != null ? String(customer.street) : undefined,
    house:
      customer.house != null
        ? String(customer.house)
        : customer.houseNo != null
          ? String(customer.houseNo)
          : undefined,
    zip:
      customer.zip != null
        ? String(customer.zip)
        : customer.plz != null
          ? String(customer.plz)
          : undefined,
    plz:
      customer.plz != null
        ? String(customer.plz)
        : customer.zip != null
          ? String(customer.zip)
          : undefined,
    city: customer.city != null ? String(customer.city) : undefined,
    email: customer.email != null ? String(customer.email) : undefined,
    deliveryHint:
      customer.deliveryHint != null ? String(customer.deliveryHint) : undefined,
    note: customer.note != null ? String(customer.note) : undefined,
  };
}

function dispatchOrdersChanged(list: StoredOrder[]) {
  if (!hasWindow()) return;

  try {
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: LS_ORDERS,
        newValue: JSON.stringify(list),
        storageArea: window.localStorage,
      }),
    );
  } catch {
    try {
      window.dispatchEvent(new Event("storage"));
    } catch {}
  }

  try {
    window.dispatchEvent(new CustomEvent("bb_orders_changed", { detail: list }));
    window.dispatchEvent(new CustomEvent("bb:orders-sync", { detail: list }));
  } catch {}
}

function normalizeOne(raw: any): StoredOrder {
  const nested = isPlainObject(raw?.order)
    ? raw.order
    : isPlainObject(raw?.item)
      ? raw.item
      : isPlainObject(raw?.data)
        ? raw.data
        : {};

  const source = {
    ...nested,
    ...raw,
  };

  const meta = ensureObj(source.meta);

  const mergedCustomer = {
    ...(ensureObj(nested.customer)),
    ...(ensureObj(raw?.customer)),
  };

  const customer = normalizeCustomer({
    ...mergedCustomer,
    name:
      mergedCustomer.name ??
      source.customerName ??
      source.name ??
      nested.customerName,
    phone:
      mergedCustomer.phone ??
      source.phone ??
      source.telephone ??
      nested.phone,
    addressLine:
      mergedCustomer.addressLine ??
      source.addressLine ??
      source.address ??
      nested.addressLine,
    address:
      mergedCustomer.address ??
      source.address ??
      source.addressLine ??
      nested.address,
    plz:
      mergedCustomer.plz ??
      source.plz ??
      source.zip ??
      nested.plz ??
      nested.zip,
    zip:
      mergedCustomer.zip ??
      source.zip ??
      source.plz ??
      nested.zip ??
      nested.plz,
    deliveryHint:
      mergedCustomer.deliveryHint ??
      source.note ??
      source.orderNote ??
      nested.note,
    note:
      mergedCustomer.note ??
      source.note ??
      source.orderNote ??
      meta.note ??
      meta.orderNote,
  });

  const channel = normalizeChannel(source.channel ?? nested.channel ?? source.mode);
  const mode = normalizeMode(source.mode ?? nested.mode ?? modeFromChannel(channel));
  const id = cleanId(source.orderId || source.id || source.no || nested.orderId || nested.id || rid());

  const history: OrderHistoryEntry[] = ensureArr(source.history ?? meta.history).map(
    (entry: any) => ({
      ts: toTs(entry?.ts ?? entry?.createdAt),
      action: String(entry?.action || entry?.status || "event"),
      note: entry?.note != null ? String(entry.note) : undefined,
      by: entry?.by != null ? String(entry.by) : undefined,
    }),
  );

  const items = normalizeItems(source.items);

  const merchandise = toNum(
    source.merchandise,
    items.reduce((total, item) => {
      const extras = ensureArr(item.add).reduce((sum, extra) => sum + toNum(extra?.price, 0), 0);
      return total + (toNum(item.price, 0) + extras) * Math.max(1, toNum(item.qty, 1));
    }, 0),
  );

  const discount = toNum(source.discount, 0);
  const surcharges = toNum(source.surcharges, 0);
  const couponDiscount = toNum(source.couponDiscount ?? meta.couponDiscount, 0);
  const total = toNum(source.total, Math.max(0, merchandise + surcharges - discount - couponDiscount));

  return {
    ...source,
    id,
    orderId: id,
    ts: toTs(source.ts ?? source.createdAt ?? source.time),
    createdAt: source.createdAt ?? null,
    updatedAt: source.updatedAt ?? null,
    mode,
    channel,
    merchandise,
    discount,
    surcharges,
    total,
    coupon: source.coupon ?? meta.coupon ?? null,
    couponDiscount,
    items,
    customer,
    planned: source.planned || undefined,
    status: mapFromServerStatus(meta.statusManual ?? meta.manualStatus ?? source.status ?? source.legacyStatus),
    legacyStatus: source.legacyStatus ?? undefined,
    etaMin:
      source.etaMin != null && Number.isFinite(Number(source.etaMin))
        ? Number(source.etaMin)
        : undefined,
    etaAdjustMin: Number(source.etaAdjustMin ?? meta.etaAdjustMin ?? 0) || 0,
    driver:
      source.driver && typeof source.driver === "object"
        ? source.driver
        : meta.driver && typeof meta.driver === "object"
          ? meta.driver
          : undefined,
    doneAt: toOptionalTs(source.doneAt ?? meta.doneAt),
    cancelledAt: toOptionalTs(source.cancelledAt ?? meta.cancelledAt),
    meta,
    history,
    print: makePrintStats(source.print ?? meta.print),
    addressLine: source.addressLine ?? customer.addressLine ?? customer.address,
    note:
      source.note ??
      source.orderNote ??
      customer.note ??
      customer.deliveryHint ??
      meta.note ??
      meta.orderNote,
  };
}

function normalize(list: unknown): StoredOrder[] {
  const arr = Array.isArray(list) ? (list as any[]) : [];

  return arr
    .map((item) => {
      try {
        return normalizeOne(item);
      } catch {
        return null;
      }
    })
    .filter(Boolean) as StoredOrder[];
}

function pushHistory(order: StoredOrder, action: string, note?: string, by?: string) {
  if (!order.history) order.history = [];

  order.history.push({
    ts: now(),
    action,
    note,
    by,
  });
}

/* ───────── Public helpers ───────── */

export function isToday(ms: number): boolean {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  return ms >= start.getTime();
}

export function effectiveEtaFor(
  order: StoredOrder,
  fallbackPickup = 15,
  fallbackDelivery = 35,
): number {
  const base = order.etaMin ?? (order.mode === "pickup" ? fallbackPickup : fallbackDelivery);
  const adj = Number(order.etaAdjustMin || 0);

  return Math.max(0, base + adj);
}

/* ───────── Local cache CRUD ───────── */

export function readAllOrders(): StoredOrder[] {
  if (!hasWindow()) return [];

  try {
    const raw = localStorage.getItem(LS_ORDERS);
    const parsed = raw ? JSON.parse(raw) : [];

    return normalize(parsed);
  } catch {
    return [];
  }
}

export function writeAllOrders(list: StoredOrder[]) {
  if (!hasWindow()) return;

  try {
    const safe = normalize(list);
    localStorage.setItem(LS_ORDERS, JSON.stringify(safe));
    dispatchOrdersChanged(safe);
  } catch {}
}

export function upsertOrder(order: StoredOrder) {
  const normalized = normalizeOne(order);
  const list = readAllOrders();
  const idx = list.findIndex((item) => idKey(item.id) === idKey(normalized.id));

  if (idx >= 0) {
    list[idx] = normalized;
  } else {
    list.push(normalized);
  }

  writeAllOrders(list);
}

export function getOrder(id: string): StoredOrder | null {
  const target = idKey(id);

  return readAllOrders().find((item) => idKey(item.id) === target) || null;
}

export function setOrderStatus(id: string, status: OrderStatus, by?: string) {
  const target = cleanId(id);
  const targetKey = idKey(id);
  const list = readAllOrders();
  const idx = list.findIndex((item) => idKey(item.id) === targetKey);

  if (idx >= 0) {
    list[idx].status = status;

    if (status === "done") {
      list[idx].doneAt = now();
    }

    if (status === "cancelled") {
      list[idx].cancelledAt = now();
    }

    pushHistory(list[idx], `status:${status}`, undefined, by);
    writeAllOrders(list);
  }

  void persistStatusToDb(target, status, by);
}

export function setOrderChannel(id: string, channel: OrderChannel, by?: string) {
  const targetKey = idKey(id);
  const list = readAllOrders();
  const idx = list.findIndex((item) => idKey(item.id) === targetKey);

  if (idx >= 0) {
    list[idx].channel = normalizeChannel(channel);
    list[idx].mode = modeFromChannel(list[idx].channel);
    pushHistory(list[idx], `channel:${list[idx].channel}`, undefined, by);
    writeAllOrders(list);
  }
}

/* ───────── Advanced ops ───────── */

export function adjustOrderEta(
  id: string,
  deltaMin: number,
  step = 5,
  maxAbs = 60,
  by?: string,
) {
  const target = cleanId(id);
  const targetKey = idKey(id);
  const list = readAllOrders();
  const idx = list.findIndex((item) => idKey(item.id) === targetKey);

  if (idx < 0) return;

  const snapped = Math.round(deltaMin / step) * step;
  const cur = Number(list[idx].etaAdjustMin || 0);

  let next = cur + snapped;

  if (next > maxAbs) next = maxAbs;
  if (next < -maxAbs) next = -maxAbs;

  list[idx].etaAdjustMin = next;
  pushHistory(list[idx], `eta:${snapped >= 0 ? "+" : ""}${snapped}`, `sum=${next}`, by);
  writeAllOrders(list);

  void persistEtaAdjustToDb(target, next, by);
}

export function setOrderDriver(
  id: string,
  driver: { name?: string; id?: string; deviceId?: string },
  opts?: { force?: boolean; by?: string },
) {
  const targetKey = idKey(id);
  const list = readAllOrders();
  const idx = list.findIndex((item) => idKey(item.id) === targetKey);

  if (idx < 0) return false;

  if (!list[idx].driver) list[idx].driver = {};
  if (list[idx].driver?.name && !opts?.force) return false;

  list[idx].driver = {
    ...list[idx].driver,
    ...driver,
    assignedAt: list[idx].driver?.assignedAt || now(),
  };

  pushHistory(list[idx], "driver:set", driver?.name, opts?.by);
  writeAllOrders(list);

  return true;
}

export function clearOrderDriver(id: string, by?: string) {
  const targetKey = idKey(id);
  const list = readAllOrders();
  const idx = list.findIndex((item) => idKey(item.id) === targetKey);

  if (idx < 0) return;

  const prev = list[idx].driver?.name;

  list[idx].driver = undefined;
  pushHistory(list[idx], "driver:clear", prev, by);
  writeAllOrders(list);
}

export function markOrderOutForDelivery(id: string, by?: string) {
  setOrderStatus(id, "out_for_delivery", by);
}

export function markOrderDone(id: string, by?: string) {
  setOrderStatus(id, "done", by);
}

export function cancelOrder(id: string, reason?: string, by?: string) {
  const target = cleanId(id);
  const targetKey = idKey(id);
  const list = readAllOrders();
  const idx = list.findIndex((item) => idKey(item.id) === targetKey);

  if (idx < 0) return;

  list[idx].status = "cancelled";
  list[idx].cancelledAt = now();

  pushHistory(list[idx], "status:cancelled", reason, by);
  writeAllOrders(list);

  void persistStatusToDb(target, "cancelled", by);
}

export function isOrderClaimed(order: StoredOrder): boolean {
  return !!order?.driver?.name;
}

/* ───────── Print stats ───────── */

export function markPrinted(
  id: string,
  type: "label" | "kitchen" | "barcode" = "label",
  by?: string,
) {
  const targetKey = idKey(id);
  const list = readAllOrders();
  const idx = list.findIndex((item) => idKey(item.id) === targetKey);

  if (idx < 0) return;

  const order = list[idx];

  if (!order.print) order.print = {};

  const bucket = order.print[type] ? makeBucket(order.print[type]) : makeBucket();

  bucket.count = (bucket.count || 0) + 1;
  bucket.lastAt = now();

  order.print[type] = bucket;

  pushHistory(order, `print:${type}`, `count=${bucket.count}`, by);
  writeAllOrders(list);
}

export function getPrintStats(id: string): OrderPrintStats {
  const order = getOrder(id);

  return {
    label: order?.print?.label ? makeBucket(order.print.label) : undefined,
    kitchen: order?.print?.kitchen ? makeBucket(order.print.kitchen) : undefined,
    barcode: order?.print?.barcode ? makeBucket(order.print.barcode) : undefined,
  };
}

/* ───────── DB-backed helpers ───────── */

function serverToStored(payload: ServerOrderPayload): StoredOrder {
  const raw =
    payload?.order && typeof payload.order === "object"
      ? payload.order
      : payload?.item && typeof payload.item === "object"
        ? payload.item
        : payload?.data && typeof payload.data === "object"
          ? payload.data
          : payload;

  return normalizeOne({
    ...raw,
    id: raw?.id || payload?.id || payload?.orderId,
    orderId: raw?.orderId || payload?.orderId || payload?.id,
    status: raw?.status ?? payload?.status,
    legacyStatus: raw?.legacyStatus ?? payload?.legacyStatus,
    mode: raw?.mode ?? payload?.mode,
    channel: raw?.channel ?? payload?.channel,
    customer: raw?.customer ?? payload?.customer,
    items: raw?.items ?? payload?.items,
    meta: raw?.meta ?? payload?.meta,
  });
}

function extractOrdersFromPayload(data: any): StoredOrder[] {
  const buckets = [
    data?.orders,
    data?.doneOrders,
    data?.items,
    data?.allOrders,
    Array.isArray(data) ? data : null,
  ];

  const raw: any[] = [];

  for (const bucket of buckets) {
    if (Array.isArray(bucket)) {
      raw.push(...bucket);
    }
  }

  const unique = new Map<string, StoredOrder>();

  for (const item of raw) {
    const stored = serverToStored(item);
    unique.set(idKey(stored.id), stored);
  }

  return Array.from(unique.values()).sort((a, b) => (b.ts || 0) - (a.ts || 0));
}

function extractSingleOrderFromPayload(data: any, id: string): StoredOrder | null {
  const target = idKey(id);

  const candidates = [data?.order, data?.item, data?.data, data];

  for (const candidate of candidates) {
    if (!candidate || Array.isArray(candidate)) continue;

    const stored = serverToStored(candidate);

    if (idKey(stored.id) === target || idKey(stored.orderId) === target) {
      return stored;
    }
  }

  const list = extractOrdersFromPayload(data);

  return list.find((item) => idKey(item.id) === target || idKey(item.orderId) === target) || null;
}

export async function fetchOrdersFromDb(): Promise<StoredOrder[]> {
  if (!canFetchOrdersFromDb()) {
    return readAllOrders();
  }

  try {
    const url = new URL("/api/admin/orders", window.location.origin);
    url.searchParams.set("take", "1000");
    url.searchParams.set("t", String(Date.now()));

    const res = await fetch(url.toString(), {
      method: "GET",
      cache: "no-store",
      headers: {
        accept: "application/json",
      },
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok || data?.ok === false) {
      throw new Error(data?.error || `HTTP ${res.status}`);
    }

    const stored = extractOrdersFromPayload(data);

    try {
      writeAllOrders(stored);
    } catch {}

    return stored;
  } catch (error) {
    console.error("fetchOrdersFromDb failed, falling back to localStorage", error);
    return readAllOrders();
  }
}

export async function fetchOrderFromDb(id: string): Promise<StoredOrder | null> {
  const target = cleanId(id);

  if (!target) return null;

  const endpoints = [
    `/api/track/lookup?id=${encodeURIComponent(target)}`,
    `/api/admin/orders?id=${encodeURIComponent(target)}`,
    `/api/orders?id=${encodeURIComponent(target)}`,
  ];

  for (const endpoint of endpoints) {
    try {
      const res = await fetch(endpoint, {
        method: "GET",
        cache: "no-store",
        headers: {
          accept: "application/json",
        },
      });

      if (!res.ok) continue;

      const data = await res.json().catch(() => ({}));

      if (data?.ok === false) continue;

      const stored = extractSingleOrderFromPayload(data, target);

      if (stored) {
        try {
          upsertOrder(stored);
        } catch {}

        return stored;
      }
    } catch {}
  }

  try {
    const all = await fetchOrdersFromDb();

    const found =
      all.find((order) => idKey(order.id) === idKey(target) || idKey(order.orderId) === idKey(target)) ||
      null;

    if (found) return found;
  } catch {}

  return getOrder(target);
}

export async function persistStatusToDb(
  id: string,
  status: OrderStatus,
  by?: string,
  patch?: Record<string, any>,
) {
  const target = cleanId(id);

  if (!target) return;

  try {
    const res = await fetch("/api/orders/status", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({
        id: target,
        status,
        by,
        ...(patch || {}),
      }),
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok || data?.ok === false) {
      throw new Error(data?.error || `HTTP ${res.status}`);
    }

    const stored = extractSingleOrderFromPayload(data, target);

    if (stored) {
      try {
        upsertOrder(stored);
      } catch {}
    } else {
      try {
        const refreshed = await fetchOrderFromDb(target);
        if (refreshed) upsertOrder(refreshed);
      } catch {}
    }
  } catch (error) {
    console.error("persistStatusToDb failed", error);
  }
}

async function persistEtaAdjustToDb(id: string, etaAdjustMin: number, by?: string) {
  const target = cleanId(id);

  if (!target) return;

  try {
    const res = await fetch("/api/orders/status", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({
        id: target,
        etaAdjustMin,
        by,
      }),
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok || data?.ok === false) {
      throw new Error(data?.error || `HTTP ${res.status}`);
    }

    const stored = extractSingleOrderFromPayload(data, target);

    if (stored) {
      try {
        upsertOrder(stored);
      } catch {}
    } else {
      try {
        const refreshed = await fetchOrderFromDb(target);
        if (refreshed) upsertOrder(refreshed);
      } catch {}
    }
  } catch (error) {
    console.error("persistEtaAdjustToDb failed", error);
  }
}

/* ───────── Convenience sync ───────── */

export async function refreshOrdersCacheFromDb(): Promise<StoredOrder[]> {
  return fetchOrdersFromDb();
}

export function clearOrdersCache() {
  if (!hasWindow()) return;

  try {
    localStorage.removeItem(LS_ORDERS);
    dispatchOrdersChanged([]);
  } catch {}
}