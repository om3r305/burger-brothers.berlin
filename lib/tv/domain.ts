import { normalizeStreet, type BrianData } from "@/lib/brian";
import type {
  Adjustment,
  Customer,
  Driver,
  DiscountRow,
  Fees,
  OrderMeta,
  OrderMode,
  OrderStatus,
  Pricing,
  ProductAvailabilityAction,
  ProductAvailabilityEntry,
  ProductAvailabilityMap,
  StoredOrder,
  StoredOrderExtra,
  StoredOrderItem,
  TvFirstSeenEntry,
  TvOrderClockEntry,
  TvProduct,
  TvSoundKind,
} from "@/types/tv";

/* ───────────────── Brian gate ───────────────── */
export const BRIAN_ALLOWED_HOSTS = ["burger-brothers.berlin", "www.burger-brothers.berlin"];
export const GO_LIVE_AT = "2025-10-26T00:00:00Z";
export const ENABLE_AFTER_DAYS = 30;
export const BRIAN_FORCE: "on" | "off" | undefined = undefined;

export const TV_CLOCK_KEY = "bb_tv_order_clock_v4";
export const TV_FIRST_SEEN_KEY = "bb_tv_order_first_seen_v1";
export const UNKNOWN_ORDER_GRACE_MS = 6 * 60 * 60 * 1000;
export const DONE_LOCK_AFTER_MS = 3 * 60 * 1000;

export const TV_SOUND_ENABLED_KEY = "bb_tv_sound_enabled_v1";
export const TV_SOUND_VOLUME_KEY = "bb_tv_sound_volume_v1";
export const TV_SOUND_SOURCES: Record<TvSoundKind, string[]> = {
  delivery: [
    "/sounds/delivery.mp3",
    "/sounds/delivery.wav",
    "/sounds/delivery.m4a",
    "/sounds/delivery.ogg",
    "/sounds/delivery.m3u",
    "/sounds/delivery",
  ],
  pickup: [
    "/sounds/pickup.mp3",
    "/sounds/pickup.wav",
    "/sounds/pickup.m4a",
    "/sounds/pickup.ogg",
    "/sounds/pickup.m3u",
    "/sounds/pickup",
  ],
};

/* ───────────────── UI classes ───────────────── */
export const glass =
  "backdrop-blur-xl bg-white/[0.06] border border-white/15 " +
  "shadow-[inset_0_1px_0_0_rgba(255,255,255,.20)] ring-1 ring-black/10";

export const chip =
  "px-2.5 py-1 rounded-full border font-semibold text-[11px] tracking-wide";

export const iconBtn =
  "rounded-md border border-white/10 px-2.5 py-1.5 hover:bg-white/10";

/* ───────────────── Labels ───────────────── */
export const statusLabel: Record<OrderStatus, string> = {
  new: "Eingegangen",
  preparing: "In Vorbereitung",
  ready: "Abholbereit",
  out_for_delivery: "Unterwegs",
  done: "Abgeschlossen",
  cancelled: "Storniert",
};

export function chipColor(status: OrderStatus) {
  switch (status) {
    case "new":
      return "border-sky-400/60 bg-sky-500/20 text-sky-100";
    case "preparing":
      return "border-amber-400/60 bg-amber-500/20 text-amber-100";
    case "ready":
      return "border-emerald-400/60 bg-emerald-500/20 text-emerald-100";
    case "out_for_delivery":
      return "border-indigo-400/60 bg-indigo-500/20 text-indigo-100";
    case "done":
      return "border-lime-400/60 bg-lime-500/20 text-lime-100";
    case "cancelled":
      return "border-rose-400/60 bg-rose-500/20 text-rose-100";
  }
}

/* ───────────────── Utils ───────────────── */
export function appTZ(settings: unknown) {
  const root = cleanObj(settings);
  const hours = cleanObj(root.hours);
  return String(hours.timezone || hours.tz || "Europe/Berlin");
}

export const pad2 = (n: number) => (n < 10 ? `0${n}` : String(n));

export const formatMinuteValue = (value: number) => {
  const safe = Number.isFinite(Number(value)) ? Math.trunc(Number(value)) : 0;
  const abs = Math.abs(safe);
  return safe < 0 ? `-${pad2(abs)}` : pad2(abs);
};

export const num = (value: unknown) => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value == null) return 0;

  const text = String(value)
    .trim()
    .replace(/[€\s]/g, "")
    .replace(",", ".");

  const match = text.match(/-?\d+(\.\d+)?/);
  return match ? parseFloat(match[0]) : 0;
};

export const numOrNull = (value: unknown): number | null => {
  if (value == null || value === "") return null;

  const n = num(value);
  return Number.isFinite(n) && n > 0 ? n : null;
};

export const money = (value: unknown) => `${num(value).toFixed(2)}€`;

export type UnknownRecord = Record<string, unknown>;

export function cleanObj(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};
}

export function cleanArr(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function normalizeProductText(value: unknown) {
  return String(value ?? "").trim();
}

export function normalizeProductKey(value: unknown) {
  return normalizeProductText(value)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function productAvailabilityKey(product: Partial<TvProduct>) {
  return (
    normalizeProductKey(product?.id) ||
    normalizeProductKey(product?.sku) ||
    normalizeProductKey(product?.code) ||
    normalizeProductKey(product?.name)
  );
}

export function normalizeTvProducts(value: unknown): TvProduct[] {
  const root = cleanObj(value);
  const nestedData = cleanObj(root.data);

  const list: unknown[] = Array.isArray(value)
    ? value
    : Array.isArray(root.products)
      ? root.products
      : Array.isArray(root.items)
        ? root.items
        : Array.isArray(root.data)
          ? root.data
          : Array.isArray(nestedData.products)
            ? nestedData.products
            : Array.isArray(nestedData.items)
              ? nestedData.items
              : [];

  return list
    .map((entry) => cleanObj(entry))
    .filter((item) => Boolean(item.id || item.sku || item.code || item.name))
    .map((item) => ({
      id: item.id != null ? String(item.id) : undefined,
      sku: item.sku != null ? String(item.sku) : undefined,
      code: item.code != null ? String(item.code) : undefined,
      name: normalizeProductText(item.name || item.title || "Artikel"),
      category: normalizeProductText(item.category || "burger") || "burger",
      active: item.active !== false,
      price: num(item.price),
    }));
}

export function normalizeProductAvailabilityMap(value: unknown): ProductAvailabilityMap {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};

  const out: ProductAvailabilityMap = {};

  for (const [key, entry] of Object.entries(value)) {
    const cleanKey = normalizeProductKey(key);
    if (!cleanKey) continue;

    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      out[cleanKey] = null;
      continue;
    }

    const record = cleanObj(entry);

    out[cleanKey] = {
      disabled: record.disabled === true,
      mode: normalizeProductText(record.mode) || "manual",
      until: record.until ? String(record.until) : null,
      by: normalizeProductText(record.by) || undefined,
      updatedAt: Number(record.updatedAt) || undefined,
      productId: normalizeProductText(record.productId) || undefined,
      name: normalizeProductText(record.name) || undefined,
    };
  }

  return out;
}

export function productAvailabilityLookupKeys(product: Partial<TvProduct>) {
  return [
    product?.id,
    product?.sku,
    product?.code,
    product?.name,
  ]
    .map(normalizeProductKey)
    .filter(Boolean);
}

export function getProductAvailabilityEntry(
  product: Partial<TvProduct>,
  availability: ProductAvailabilityMap,
) {
  for (const key of productAvailabilityLookupKeys(product)) {
    const entry = availability[key];
    if (entry) return entry;
  }

  return null;
}

export function isProductClosedByEntry(entry: ProductAvailabilityEntry | null | undefined, nowMs = Date.now()) {
  if (!entry?.disabled) return false;

  if (!entry.until) return true;

  const untilMs = Date.parse(String(entry.until));
  if (!Number.isFinite(untilMs)) return true;

  return untilMs > nowMs;
}

export function isProductTemporarilyClosed(
  product: Partial<TvProduct>,
  availability: ProductAvailabilityMap,
  nowMs = Date.now(),
) {
  return isProductClosedByEntry(getProductAvailabilityEntry(product, availability), nowMs);
}

export function productCloseLabel(entry: ProductAvailabilityEntry | null | undefined, nowMs = Date.now()) {
  if (!isProductClosedByEntry(entry, nowMs)) return "Verfügbar";
  if (entry?.mode === "today") return "Heute geschlossen";
  return "Dauerhaft geschlossen";
}

export function endOfTodayIso(tz: string) {
  try {
    const now = new Date();
    const local = new Date(now.toLocaleString("en-US", { timeZone: tz }));
    local.setHours(23, 59, 59, 999);
    return local.toISOString();
  } catch {
    const local = new Date();
    local.setHours(23, 59, 59, 999);
    return local.toISOString();
  }
}

export const TV_PRODUCT_CATEGORY_ORDER = [
  "burger",
  "vegan",
  "hotdogs",
  "extras",
  "sauces",
  "drinks",
  "donuts",
  "bubbletea",
];

export const TV_PRODUCT_CATEGORY_LABELS: Record<string, string> = {
  burger: "Burger",
  vegan: "Vegan",
  hotdogs: "Hot Dogs",
  extras: "Extras",
  sauces: "Soßen",
  drinks: "Getränke",
  donuts: "Donuts",
  bubbletea: "Bubble Tea",
};

export function productCategoryLabel(value: unknown) {
  const key = normalizeProductText(value || "burger").toLowerCase();
  return TV_PRODUCT_CATEGORY_LABELS[key] || key || "Artikel";
}

export function normalizeStatus(value: unknown): OrderStatus {
  const text = String(value || "").toLowerCase().trim();

  if (text === "new" || text === "received" || text === "eingegangen") return "new";

  if (
    text === "preparing" ||
    text === "prepare" ||
    text === "zubereitung" ||
    text === "in_vorbereitung" ||
    text === "in vorbereitung"
  ) {
    return "preparing";
  }

  if (text === "ready" || text === "bereit" || text === "abholbereit") return "ready";

  if (text === "out_for_delivery" || text === "on_the_way" || text === "unterwegs") {
    return "out_for_delivery";
  }

  if (text === "done" || text === "completed" || text === "delivered" || text === "geliefert") {
    return "done";
  }

  if (text === "cancelled" || text === "canceled" || text === "storniert") return "cancelled";

  return "new";
}

export function normalizeMode(value: unknown): OrderMode {
  const text = String(value || "").toLowerCase().trim();

  if (text === "pickup" || text === "abholung" || text === "apollo" || text === "apollon") {
    return "pickup";
  }

  return "delivery";
}

export function toMsStrict(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value;
  }

  if (value instanceof Date && Number.isFinite(value.valueOf())) {
    return value.getTime();
  }

  if (typeof value === "string" && value.trim()) {
    const text = value.trim();
    const asNumber = Number(text);

    if (Number.isFinite(asNumber) && asNumber > 0) return asNumber;

    const date = new Date(text);
    if (Number.isFinite(date.valueOf())) return date.getTime();
  }

  return null;
}

export function orderDateFromId(value: unknown): number | null {
  const text = String(value || "").trim();
  const match = text.match(/(?:ORD[-_])?(\d{4})(\d{2})(\d{2})/);

  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  if (!year || !month || !day) return null;

  const date = new Date(year, month - 1, day, 0, 1, 0, 0);

  return Number.isFinite(date.valueOf()) ? date.getTime() : null;
}

export function firstHistoryMs(value: unknown): number | null {
  const arr = Array.isArray(value) ? value : [];

  for (const entry of arr) {
    const ms = toMsStrict(
      entry?.ts ??
        entry?.at ??
        entry?.createdAt ??
        entry?.created_at ??
        entry?.time,
    );

    if (ms != null) return ms;
  }

  return null;
}

export function statusHistoryMs(value: unknown, status: OrderStatus): number | null {
  const arr = Array.isArray(value) ? value : [];

  for (let i = arr.length - 1; i >= 0; i--) {
    const entry = arr[i];

    const rawStatus =
      entry?.status ??
      entry?.to ??
      entry?.nextStatus ??
      entry?.newStatus ??
      entry?.value;

    if (rawStatus && normalizeStatus(rawStatus) !== status) continue;

    const ms = toMsStrict(
      entry?.ts ??
        entry?.at ??
        entry?.createdAt ??
        entry?.created_at ??
        entry?.updatedAt ??
        entry?.updated_at ??
        entry?.time,
    );

    if (ms != null) return ms;
  }

  return null;
}

export function getOrderExactCreatedMs(
  order: Partial<StoredOrder>,
  fallback: number | null = null,
): number | null {
  const meta = cleanObj(order?.meta);

  const candidates = [
    order?.createdAt,
    order?.created_at,
    meta?.createdAt,
    meta?.created_at,
    meta?.orderCreatedAt,
    meta?.order_created_at,
    meta?.submittedAt,
    meta?.submitted_at,
    meta?.checkoutAt,
    meta?.checkout_at,
    firstHistoryMs(order?.history),
    firstHistoryMs(meta?.history),
    meta?.ts,
    order?.ts,
  ];

  for (const candidate of candidates) {
    const ms = toMsStrict(candidate);
    if (ms != null) return ms;
  }

  return fallback;
}

export function getDoneAtMs(order: Partial<StoredOrder>): number | null {
  const meta = cleanObj(order?.meta);

  const candidates = [
    order?.doneAt,
    order?.done_at,
    order?.completedAt,
    order?.completed_at,
    order?.deliveredAt,
    order?.delivered_at,
    meta?.doneAt,
    meta?.done_at,
    meta?.completedAt,
    meta?.completed_at,
    meta?.deliveredAt,
    meta?.delivered_at,
    statusHistoryMs(order?.history, "done"),
    statusHistoryMs(meta?.history, "done"),
    order?.updatedAt,
    order?.updated_at,
    meta?.updatedAt,
    meta?.updated_at,
  ];

  for (const candidate of candidates) {
    const ms = toMsStrict(candidate);
    if (ms != null) return ms;
  }

  return null;
}

export function doneLockRemainingMs(order: Partial<StoredOrder>, nowMs = Date.now()) {
  if (normalizeStatus(order?.status) !== "done") return 0;

  const doneAt = getDoneAtMs(order);
  if (doneAt == null) return DONE_LOCK_AFTER_MS;

  return Math.max(0, DONE_LOCK_AFTER_MS - (nowMs - doneAt));
}

export function isDoneLocked(order: Partial<StoredOrder>, nowMs = Date.now()) {
  if (normalizeStatus(order?.status) !== "done") return false;

  const doneAt = getDoneAtMs(order);
  if (doneAt == null) return false;

  return nowMs - doneAt >= DONE_LOCK_AFTER_MS;
}

export function doneLockTitle(order: Partial<StoredOrder>, nowMs = Date.now()) {
  if (normalizeStatus(order?.status) !== "done") return undefined;
  if (isDoneLocked(order, nowMs)) {
    return "Diese Bestellung ist abgeschlossen und nach 3 Minuten gesperrt.";
  }

  const seconds = Math.ceil(doneLockRemainingMs(order, nowMs) / 1000);
  return seconds > 0
    ? `Änderungen noch ca. ${seconds} Sek. möglich. Danach gesperrt.`
    : undefined;
}

export function dayKeyForMs(ms: number, tz: string) {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date(ms));

    const year = parts.find((p) => p.type === "year")?.value || "0000";
    const month = parts.find((p) => p.type === "month")?.value || "00";
    const day = parts.find((p) => p.type === "day")?.value || "00";

    return `${year}-${month}-${day}`;
  } catch {
    const d = new Date(ms);
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  }
}

export function dayBoundsMs(tz: string) {
  const nowDate = new Date();
  const local = new Date(nowDate.toLocaleString("en-US", { timeZone: tz }));

  const start = new Date(local);
  start.setHours(0, 0, 0, 0);

  const end = new Date(local);
  end.setHours(23, 59, 59, 999);

  return {
    start: start.getTime(),
    end: end.getTime(),
    key: dayKeyForMs(nowDate.getTime(), tz),
  };
}

export function readTvClockCache(): Record<string, TvOrderClockEntry> {
  if (typeof window === "undefined") return {};

  try {
    const raw = localStorage.getItem(TV_CLOCK_KEY);
    const parsed = raw ? JSON.parse(raw) : {};

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};

    const out: Record<string, TvOrderClockEntry> = {};

    Object.entries(parsed).forEach(([id, rawValue]) => {
      const value = cleanObj(rawValue);
      const startMs = Number(value.startMs);
      const dayKey = String(value.dayKey || "");

      if (!id || !Number.isFinite(startMs) || startMs <= 0 || !dayKey) return;

      out[id] = {
        startMs,
        dayKey,
        orderId: value.orderId ? String(value.orderId) : undefined,
      };
    });

    return out;
  } catch {
    return {};
  }
}

export function saveTvClockCache(cache: Record<string, TvOrderClockEntry>) {
  if (typeof window === "undefined") return;

  try {
    localStorage.setItem(TV_CLOCK_KEY, JSON.stringify(cache));
  } catch {}
}

export function readTvFirstSeenCache(): Record<string, TvFirstSeenEntry> {
  if (typeof window === "undefined") return {};

  try {
    const raw = localStorage.getItem(TV_FIRST_SEEN_KEY);
    const parsed = raw ? JSON.parse(raw) : {};

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};

    const out: Record<string, TvFirstSeenEntry> = {};

    Object.entries(parsed).forEach(([id, rawValue]) => {
      const value = cleanObj(rawValue);
      const firstSeenMs = Number(value.firstSeenMs);
      const dayKey = String(value.dayKey || "");

      if (!id || !Number.isFinite(firstSeenMs) || firstSeenMs <= 0 || !dayKey) return;

      out[id] = {
        firstSeenMs,
        dayKey,
        orderId: value.orderId ? String(value.orderId) : undefined,
      };
    });

    return out;
  } catch {
    return {};
  }
}

export function saveTvFirstSeenCache(cache: Record<string, TvFirstSeenEntry>) {
  if (typeof window === "undefined") return;

  try {
    localStorage.setItem(TV_FIRST_SEEN_KEY, JSON.stringify(cache));
  } catch {}
}

export function readTvSoundEnabled() {
  if (typeof window === "undefined") return true;

  try {
    const stored = localStorage.getItem(TV_SOUND_ENABLED_KEY);
    return stored == null ? true : stored === "1";
  } catch {
    return true;
  }
}

export function readTvSoundVolume() {
  if (typeof window === "undefined") return 100;

  try {
    const raw = Number(localStorage.getItem(TV_SOUND_VOLUME_KEY) || "100");

    if (!Number.isFinite(raw)) return 100;

    return Math.max(0, Math.min(100, Math.round(raw)));
  } catch {
    return 100;
  }
}

export function saveTvSoundEnabled(enabled: boolean) {
  if (typeof window === "undefined") return;

  try {
    localStorage.setItem(TV_SOUND_ENABLED_KEY, enabled ? "1" : "0");
  } catch {}
}

export function saveTvSoundVolume(volume: number) {
  if (typeof window === "undefined") return;

  try {
    localStorage.setItem(TV_SOUND_VOLUME_KEY, String(Math.max(0, Math.min(100, Math.round(volume)))));
  } catch {}
}

export function isSoundCandidateOrder(order: StoredOrder) {
  return order.status !== "done" && order.status !== "cancelled";
}

export function getTvSoundKind(order: StoredOrder): TvSoundKind {
  return order.mode === "pickup" ? "pickup" : "delivery";
}

export function getTvSoundErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "");

  if (/notallowed|permission|interact|user gesture|gesture/i.test(message)) {
    return "Ton blockiert: Bitte einmal auf „Ton freischalten“ klicken.";
  }

  return "Ton konnte nicht abgespielt werden. Bitte Datei und Lautstärke prüfen.";
}

export function getTvSoundTitle(kind: TvSoundKind) {
  return kind === "delivery" ? "Lieferung" : "Abholung";
}

export function getOrderSoundId(order: StoredOrder) {
  return String(order.id || order.orderId || "").trim();
}

export function getOrderSoundStartMs(order: StoredOrder) {
  return getOrderExactCreatedMs(order, null) ?? order.ts ?? 0;
}

export function getOrderSoundKey(order: StoredOrder) {
  const id = getOrderSoundId(order);
  return id ? `${id}:${getTvSoundKind(order)}:${getOrderSoundStartMs(order)}` : "";
}

export function getOrderSoundLabel(order: StoredOrder) {
  const id = getOrderSoundId(order);
  return id || "Bestellung";
}

export function getSoundButtonLabel(enabled: boolean, unlocked: boolean) {
  if (!enabled) return "🔇 Ton aus";
  if (!unlocked) return "🔈 Ton freischalten";
  return "🔊 Ton aktiv";
}

export function getSoundButtonTitle(enabled: boolean, unlocked: boolean) {
  if (!enabled) return "TV-Bestelltöne einschalten";
  if (!unlocked) return "Browser-Tonsperre durch Klick öffnen";
  return "TV-Bestelltöne ausschalten";
}

export function getOrderDayMs(
  order: Partial<StoredOrder>,
  clock?: Record<string, TvOrderClockEntry>,
): number | null {
  const idDay = orderDateFromId(order?.orderId || order?.id);
  if (idDay != null) return idDay;

  const exact = getOrderExactCreatedMs(order, null);
  if (exact != null) return exact;

  const cached = clock?.[String(order?.id || "")]?.startMs;
  if (cached && Number.isFinite(cached) && cached > 0) return cached;

  return null;
}

export function getOrderStartMs(
  order: Partial<StoredOrder>,
  clock?: Record<string, TvOrderClockEntry>,
  fallback: number | null = null,
): number | null {
  const exact = getOrderExactCreatedMs(order, null);
  if (exact != null) return exact;

  const cached = clock?.[String(order?.id || "")]?.startMs;
  if (cached && Number.isFinite(cached) && cached > 0) return cached;

  const ts = toMsStrict(order?.ts);
  if (ts != null) return ts;

  return fallback;
}

export function normalizeItems(value: unknown): StoredOrderItem[] {
  return cleanArr(value)
    .map((entry, index): StoredOrderItem | null => {
      const item = cleanObj(entry);
      const name = String(item.name || item.title || "Artikel");

      const extras: StoredOrderExtra[] = [];

      for (const extraEntry of cleanArr(item.add ?? item.extras)) {
        const extra = cleanObj(extraEntry);
        const label = extra.label
          ? String(extra.label)
          : extra.name
            ? String(extra.name)
            : undefined;
        const extraName = extra.name ? String(extra.name) : undefined;

        if (!label && !extraName && extra.price == null) continue;

        extras.push({
          label,
          name: extraName,
          price: num(extra.price),
        });
      }

      return {
        id: item.id
          ? String(item.id)
          : `${String(item.sku || name || "item")}-${index}`,
        sku: item.sku ? String(item.sku) : undefined,
        name,
        category: item.category ? String(item.category) : undefined,
        price: num(item.price ?? item.unitPrice),
        qty: Math.max(1, num(item.qty ?? item.quantity ?? 1)),
        add: extras.length ? extras : undefined,
        rm: cleanArr(item.rm ?? item.remove).map((entry) => String(entry)),
        note: item.note ? String(item.note) : undefined,
      };
    })
    .filter((item): item is StoredOrderItem => Boolean(item));
}

function hasOrderIdentity(record: UnknownRecord) {
  return Boolean(record.id || record.orderId);
}

function asOptionalText(value: unknown): string | null {
  if (value == null || value === "") return null;
  return String(value);
}

function normalizeAdjustments(value: unknown): Adjustment[] {
  return cleanArr(value)
    .filter(
      (entry): entry is Record<string, unknown> =>
        Boolean(entry && typeof entry === "object" && !Array.isArray(entry)),
    )
    .map((entry) => ({ ...entry } as Adjustment));
}

export function normalizeOrders(data: unknown): StoredOrder[] {
  const root = cleanObj(data);
  const nestedData = cleanObj(root.data);

  const list: unknown[] = Array.isArray(data)
    ? data
    : Array.isArray(root.orders)
      ? root.orders
      : Array.isArray(root.items)
        ? root.items
        : Array.isArray(root.allOrders)
          ? root.allOrders
          : Array.isArray(root.doneOrders)
            ? root.doneOrders
            : Array.isArray(root.data)
              ? root.data
              : Array.isArray(nestedData.orders)
                ? nestedData.orders
                : Array.isArray(nestedData.items)
                  ? nestedData.items
                  : Array.isArray(nestedData.allOrders)
                    ? nestedData.allOrders
                    : Array.isArray(nestedData.doneOrders)
                      ? nestedData.doneOrders
                      : [];

  return list
    .map((rawValue): StoredOrder | null => {
      try {
        const raw = cleanObj(rawValue);
        const nestedOrder = cleanObj(raw.order);
        const nestedItem = cleanObj(raw.item);
        const nestedRecord = cleanObj(raw.data);

        const source = hasOrderIdentity(nestedOrder)
          ? nestedOrder
          : hasOrderIdentity(nestedItem)
            ? nestedItem
            : hasOrderIdentity(nestedRecord)
              ? nestedRecord
              : raw;

        const customer = cleanObj(source.customer) as unknown as Customer;
        const meta = cleanObj(source.meta) as unknown as OrderMeta;
        const pricing = cleanObj(source.pricing) as unknown as Pricing;
        const fees = cleanObj(source.fees) as unknown as Fees;
        const items = normalizeItems(source.items);

        const id = String(source.id || source.orderId || "").trim();
        if (!id) return null;

        const orderId = String(source.orderId || id);
        const customerName = firstNonEmptyText(
          source.customerName,
          customer.name,
          customer.customerName,
        );
        const phone = firstNonEmptyText(
          source.phone,
          customer.phone,
          customer.telephone,
        );
        const addressLine = firstNonEmptyText(
          source.addressLine,
          customer.addressLine,
          customer.address,
          [customer.street, customer.house || customer.houseNo]
            .filter(Boolean)
            .join(" "),
        );
        const plz = firstNonEmptyText(
          source.plz,
          customer.plz,
          customer.zip,
          customer.postalCode,
        );
        const note = firstNonEmptyText(
          source.note,
          source.orderNote,
          customer.deliveryHint,
          customer.note,
          meta.note,
          meta.orderNote,
        );

        const merchandise =
          num(source.merchandise) ||
          items.reduce((sum, item) => {
            const extras = (item.add || []).reduce(
              (extraSum, extra) => extraSum + num(extra.price),
              0,
            );
            return sum + (num(item.price) + extras) * num(item.qty || 1);
          }, 0);

        const discount = num(source.discount);
        const surcharges = num(source.surcharges);
        const couponDiscount = num(
          source.couponDiscount ?? meta.couponDiscount,
        );
        const total =
          num(source.total) ||
          Math.max(
            0,
            merchandise + surcharges - discount - couponDiscount,
          );

        const createdAtRaw =
          source.createdAt ??
          source.created_at ??
          meta.createdAt ??
          meta.created_at ??
          meta.orderCreatedAt ??
          meta.submittedAt ??
          null;

        const normalizedForTime = {
          ...source,
          id,
          orderId,
          createdAt: createdAtRaw,
          meta,
        } as Partial<StoredOrder>;

        const exactTs =
          getOrderExactCreatedMs(normalizedForTime, null) ?? 0;

        const rawDriver = cleanObj(source.driver);
        const metaDriver = meta.driver || null;
        const driver =
          Object.keys(rawDriver).length > 0
            ? (rawDriver as unknown as Driver)
            : metaDriver ||
              (meta.driverId || meta.driverName
                ? {
                    id: meta.driverId || null,
                    name: meta.driverName || null,
                  }
                : null);

        return {
          id,
          orderId,
          ts: exactTs,
          createdAt: asOptionalText(createdAtRaw),
          updatedAt: asOptionalText(source.updatedAt ?? source.updated_at),
          doneAt: asOptionalText(
            source.doneAt ??
              source.done_at ??
              source.completedAt ??
              source.completed_at ??
              source.deliveredAt ??
              source.delivered_at ??
              meta.doneAt ??
              meta.done_at ??
              meta.completedAt ??
              meta.completed_at ??
              meta.deliveredAt ??
              meta.delivered_at,
          ),
          completedAt: asOptionalText(
            source.completedAt ?? source.completed_at,
          ),
          deliveredAt: asOptionalText(
            source.deliveredAt ?? source.delivered_at,
          ),
          mode: normalizeMode(source.mode),
          channel: source.channel ? String(source.channel) : "web",
          status: normalizeStatus(meta.statusManual ?? source.status),
          planned: source.planned ? String(source.planned) : null,
          etaMin: numOrNull(source.etaMin ?? meta.etaMin ?? meta.eta),
          etaAdjustMin: num(
            source.etaAdjustMin ??
              meta.etaAdjustMin ??
              meta.etaAdjust ??
              0,
          ),
          customer: {
            ...customer,
            name: customerName,
            phone,
            addressLine,
            address: addressLine,
            plz: plz || null,
            zip: plz || null,
            deliveryHint: note,
          },
          items,
          meta,
          pricing,
          fees,
          adjustments: normalizeAdjustments(source.adjustments),
          merchandise,
          discount,
          surcharges,
          couponDiscount,
          coupon: source.coupon
            ? String(source.coupon)
            : meta.coupon || null,
          total,
          driver,
          driverName: firstNonEmptyText(
            source.driverName,
            driver?.name,
            meta.driverName,
          ),
          plz: plz || null,
          note,
          orderNote: source.orderNote
            ? String(source.orderNote)
            : undefined,
        };
      } catch {
        return null;
      }
    })
    .filter((order): order is StoredOrder => Boolean(order));
}

export async function fetchOrdersFromTvEndpoint(): Promise<StoredOrder[]> {
  const endpoints = [
    "/api/orders/list?view=tv&includeDone=1&take=1000",
    "/api/orders/list?includeDone=1&take=1000",
  ];

  let lastError: unknown = null;

  for (const endpoint of endpoints) {
    try {
      const res = await fetch(endpoint, {
        cache: "no-store",
        headers: {
          accept: "application/json",
        },
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok || data?.ok === false) {
        throw new Error(data?.error || `HTTP ${res.status}`);
      }

      /*
        TV / Driver uyumu:
        - Ana kaynak artık /api/orders/list?view=tv.
        - Eski admin fallback ile bütün geçmişi çekmiyoruz.
        - İlk çalışan endpoint yeterli görülür; böylece eski/arşiv siparişler TV'ye geri karışmaz.
      */
      return normalizeOrders(data);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error("TV_ORDERS_FETCH_FAILED");
}

export async function persistStatusToDb(
  id: string,
  status: OrderStatus,
  by = "tv",
  extra: Record<string, unknown> = {},
) {
  const primary = await fetch("/api/orders/status", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({
      ...extra,
      id,
      status,
      by,
      ...(status === "preparing" ? { clearDriver: true } : {}),
    }),
  });

  const primaryData = await primary.json().catch(() => ({}));

  if (!primary.ok || primaryData?.ok === false) {
    throw new Error(primaryData?.error || `HTTP ${primary.status}`);
  }

  return primaryData;
}
export async function persistEtaAdjustToDb(id: string, deltaMin: number, by = "tv") {
  const res = await fetch("/api/orders/status", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({
      id,
      etaDeltaMin: deltaMin,
      etaAdjustDelta: deltaMin,
      by,
    }),
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok || data?.ok === false) {
    throw new Error(data?.error || `HTTP ${res.status}`);
  }

  return data;
}

export function findDeliveryFeeDeep(order: StoredOrder) {
  const pricing = order?.pricing || {};
  const fees = order?.fees || {};

  const direct = [
    pricing.delivery,
    pricing.deliveryFee,
    pricing.deliverySurcharge,
    pricing.surcharges,
    pricing.surcharge,
    pricing.shipping,
    pricing.ship,
    pricing.delivery_cost,
    pricing.zoneFee,
    fees.delivery,
    fees.deliveryFee,
    fees.deliverySurcharge,
    fees.surcharges,
    fees.surcharge,
    fees.shipping,
    order?.surcharges,
  ]
    .map(num)
    .find((x) => x > 0);

  if (direct) return direct;

  const rx =
    /(liefer|lieferung|liefergeb|lieferaufschlag|zustell|versand|shipping|delivery|surcharge|aufschlag|zone)/i;

  const buckets = [
    order?.totals,
    order?.summary,
    order?.surcharges,
    pricing?.totals,
    pricing?.summary,
    pricing?.breakdown,
    pricing?.surcharges,
    fees?.totals,
    fees?.summary,
    fees?.surcharges,
  ].filter(Array.isArray);

  for (const arr of buckets) {
    for (const row of arr) {
      const label = String(row?.label || row?.title || row?.name || "").toLowerCase();
      if (rx.test(label)) {
        const value = num(row?.amount ?? row?.value ?? row?.price ?? row?.total);
        if (value > 0) return value;
      }
    }
  }

  return 0;
}

export function findTipAmountDeep(order: StoredOrder) {
  const pricing = order?.pricing || {};
  const fees = order?.fees || {};
  const meta = order?.meta || {};

  const direct = [
    order?.tip,
    order?.tipAmount,
    order?.tip_amount,
    order?.trinkgeld,
    order?.trinkgeldAmount,
    order?.pickupTip,
    order?.pickupTipAmount,
    order?.kitchenTip,
    order?.kitchenTipAmount,
    order?.tipKitchen,

    pricing?.tip,
    pricing?.tipAmount,
    pricing?.tip_amount,
    pricing?.trinkgeld,
    pricing?.trinkgeldAmount,
    pricing?.pickupTip,
    pricing?.pickupTipAmount,
    pricing?.kitchenTip,
    pricing?.kitchenTipAmount,
    pricing?.tipKitchen,

    fees?.tip,
    fees?.tipAmount,
    fees?.tip_amount,
    fees?.trinkgeld,
    fees?.trinkgeldAmount,
    fees?.pickupTip,
    fees?.pickupTipAmount,
    fees?.kitchenTip,
    fees?.kitchenTipAmount,
    fees?.tipKitchen,

    meta?.tip,
    meta?.tipAmount,
    meta?.tip_amount,
    meta?.trinkgeld,
    meta?.trinkgeldAmount,
    meta?.pickupTip,
    meta?.pickupTipAmount,
    meta?.kitchenTip,
    meta?.kitchenTipAmount,
    meta?.tipKitchen,
  ]
    .map(num)
    .find((x) => x > 0);

  if (direct) return direct;

  const rx = /(trinkgeld|tip|tips|bahşiş|bahsis|kitchen\s*tip|küche)/i;

  const buckets = [
    order?.totals,
    order?.summary,
    order?.breakdown,
    order?.fees,
    order?.adjustments,

    pricing?.totals,
    pricing?.summary,
    pricing?.breakdown,
    pricing?.fees,

    fees?.totals,
    fees?.summary,
    fees?.breakdown,

    meta?.totals,
    meta?.summary,
    meta?.breakdown,
    meta?.fees,
    meta?.adjustments,
  ].filter(Array.isArray);

  for (const arr of buckets) {
    for (const row of arr) {
      const label = String(
        row?.label || row?.title || row?.name || row?.type || row?.key || "",
      ).toLowerCase();

      if (rx.test(label)) {
        const value = num(row?.amount ?? row?.value ?? row?.price ?? row?.total);
        if (value > 0) return value;
      }
    }
  }

  return 0;
}

export function getOrderTotals(order: StoredOrder): {
  subtotal: number;
  deliveryFee: number;
  serviceFee: number;
  otherFee: number;
  discountSum: number;
  discountItems: DiscountRow[];
  total: number;
} {
  const items = order.items || [];
  const pricing = order.pricing || {};
  const fees = order.fees || {};

  const itemsSum = items.reduce(
    (sum, item) => sum + num(item.price) * num(item.qty || 1),
    0,
  );

  const subtotal = num(pricing.subtotal) > 0 ? num(pricing.subtotal) : itemsSum;
  const deliveryFee = findDeliveryFeeDeep(order);
  const serviceFee = num(pricing.service ?? fees.service);
  const otherFee = num(pricing.other ?? pricing.misc ?? fees.other);

  let explicitTotal = num(
    pricing.total ??
      order.total ??
      order.amount ??
      order.payable ??
      order.toPay,
  );

  if (explicitTotal <= 0) {
    explicitTotal =
      subtotal + deliveryFee + serviceFee + otherFee - num(pricing.discount ?? fees.discount);
  }

  let discountSum = num(pricing.discount ?? fees.discount ?? order.discount);
  const allFees = deliveryFee + serviceFee + otherFee;
  const derivedDiscount = Math.max(0, subtotal + allFees - explicitTotal);

  if (Math.abs(subtotal + allFees - explicitTotal - discountSum) > 0.01) {
    discountSum = derivedDiscount;
  }

  const discountItems: DiscountRow[] = (order.adjustments || [])
    .filter((adjustment) => String(adjustment.type || "").toLowerCase() === "discount")
    .map((adjustment) => ({
      label:
        [adjustment.code, adjustment.reason].filter(Boolean).join(" – ") ||
        adjustment.source ||
        "Rabatt",
      amount: num(adjustment.amount),
    }));

  return {
    subtotal,
    deliveryFee,
    serviceFee,
    otherFee,
    discountSum,
    discountItems,
    total: explicitTotal,
  };
}

export function firstNonEmptyText(...values: unknown[]) {
  for (const value of values) {
    const text = String(value ?? "").trim();
    if (text) return text;
  }

  return "";
}

export function buildDiscountDetails(order: StoredOrder, totals: ReturnType<typeof getOrderTotals>): DiscountRow[] {
  const meta = cleanObj(order?.meta);
  const pricing = cleanObj(order?.pricing);
  const fees = cleanObj(order?.fees);
  const couponMeta = cleanObj(meta?.couponMeta);
  const couponLifecycle = cleanObj(meta?.couponLifecycle);

  const rows: DiscountRow[] = [];

  const addRow = (label: string, amount: unknown) => {
    const cleanLabel = firstNonEmptyText(label, "Rabatt");
    const cleanAmount = Math.abs(num(amount));

    if (!cleanLabel || cleanAmount <= 0) return;

    const existing = rows.find(
      (row) => row.label.toLowerCase() === cleanLabel.toLowerCase(),
    );

    if (existing) {
      existing.amount = +(existing.amount + cleanAmount).toFixed(2);
      return;
    }

    rows.push({
      label: cleanLabel,
      amount: +cleanAmount.toFixed(2),
    });
  };

  const couponCode = firstNonEmptyText(
    order?.coupon,
    meta?.coupon,
    couponMeta?.code,
    couponMeta?.couponCode,
    couponLifecycle?.code,
    couponLifecycle?.couponCode,
  );

  const couponTitle = firstNonEmptyText(
    couponMeta?.title,
    couponMeta?.name,
    couponLifecycle?.title,
    couponLifecycle?.name,
    meta?.couponTitle,
    pricing?.couponTitle,
  );

  const couponAmount = Math.abs(
    num(
      order?.couponDiscount ??
        meta?.couponDiscount ??
        couponMeta?.discountAmount ??
        couponMeta?.amount ??
        couponLifecycle?.couponDiscount ??
        couponLifecycle?.discountAmount ??
        couponLifecycle?.amount,
    ),
  );

  const directOrderDiscount = Math.abs(num(order?.discount));
  const fallbackCouponAmount =
    couponAmount > 0
      ? couponAmount
      : couponCode
        ? Math.max(0, totals.discountSum - directOrderDiscount) || totals.discountSum
        : 0;

  if (couponCode || couponAmount > 0) {
    const label = couponCode
      ? `Gutschein (${couponCode})${couponTitle ? ` – ${couponTitle}` : ""}`
      : `Gutschein${couponTitle ? ` – ${couponTitle}` : ""}`;

    addRow(label, fallbackCouponAmount);
  }

  for (const adjustment of order.adjustments || []) {
    const type = String(adjustment?.type || "").toLowerCase();

    if (type && type !== "discount") continue;

    const amount = Math.abs(
      num(adjustment?.amount ?? adjustment?.value ?? adjustment?.price ?? adjustment?.total),
    );

    if (amount <= 0) continue;

    const code = firstNonEmptyText(adjustment?.code, adjustment?.couponCode);
    const campaign = firstNonEmptyText(
      adjustment?.campaignName,
      adjustment?.campaignTitle,
      adjustment?.campaign,
      adjustment?.reason,
      adjustment?.source,
    );

    const label = code
      ? `Kampagne/Rabatt (${code})${campaign ? ` – ${campaign}` : ""}`
      : campaign || "Kampagne/Rabatt";

    addRow(label, amount);
  }

  const campaignName = firstNonEmptyText(
    meta?.campaignName,
    meta?.campaignTitle,
    meta?.campaign,
    meta?.discountReason,
    meta?.discountLabel,
    pricing?.campaignName,
    pricing?.campaignTitle,
    pricing?.campaign,
    pricing?.discountReason,
    pricing?.discountLabel,
    fees?.discountReason,
    fees?.discountLabel,
  );

  const campaignAmount = Math.abs(
    num(
      pricing?.campaignDiscount ??
        pricing?.campaignDiscountAmount ??
        pricing?.discountAmount ??
        pricing?.discount ??
        fees?.discountAmount ??
        fees?.discount ??
        order?.discount,
    ),
  );

  if (campaignAmount > 0) {
    addRow(campaignName || "Rabatt / Angebot", campaignAmount);
  }

  for (const discount of totals.discountItems) {
    addRow(discount.label || "Rabatt", discount.amount);
  }

  const knownAmount = rows.reduce((sum, row) => sum + Math.abs(num(row.amount)), 0);
  const missingAmount = Math.max(0, totals.discountSum - knownAmount);

  if (totals.discountSum > 0 && rows.length === 0) {
    addRow("Rabatt / Angebot", totals.discountSum);
  } else if (missingAmount > 0.01) {
    addRow("Weitere Rabatte", missingAmount);
  }

  return rows;
}

export function extractOrderNote(order: StoredOrder): string {
  const customer = order?.customer || {};
  const meta = order?.meta || {};
  const delivery = order?.delivery || {};
  const addressInfo = customer?.addressInfo || customer?.addresses || {};

  const candidates: unknown[] = [
    order?.note,
    order?.orderNote,
    order?.deliveryNote,
    order?.comment,
    order?.comments,
    order?.checkoutNote,
    order?.basketNote,
    order?.cartNote,
    order?.extraNote,
    delivery?.note,
    meta?.note,
    meta?.deliveryNote,
    meta?.orderNote,
    customer?.note,
    customer?.orderNote,
    customer?.deliveryNote,
    customer?.deliveryHint,
    customer?.hinweis,
    addressInfo?.note,
    addressInfo?.hint,
  ];

  const found = candidates.find((x) => {
    const text = typeof x === "string" ? x.trim() : "";
    return text.length > 0;
  });

  return (found || "").toString();
}

export function plannedStartMs(order: StoredOrder, tz: string) {
  const planned = normalizePlannedHHMM(order?.planned);
  if (!planned) return null;

  const [hh, mm] = planned.split(":").map((x) => parseInt(x, 10));

  const base = new Date(new Date().toLocaleString("en-US", { timeZone: tz }));
  const date = new Date(base);

  date.setHours(hh || 0, mm || 0, 0, 0);

  return date.getTime();
}

export function etaFor(order: StoredOrder, avgPickup: number, avgDelivery: number) {
  const meta = cleanObj(order?.meta);
  const base =
    numOrNull(order.etaMin ?? meta?.etaMin ?? meta?.eta) ??
    (order.mode === "pickup" ? avgPickup : avgDelivery);
  const adjust = num(order.etaAdjustMin ?? meta?.etaAdjustMin ?? meta?.etaAdjust ?? 0);

  return Math.max(1, base + adjust);
}

export function remainingMinutes(
  order: StoredOrder,
  etaMinutes: number,
  tz: string,
  nowMs = Date.now(),
) {
  const planned = plannedStartMs(order, tz);

  if (planned) {
    return Math.floor((planned - nowMs) / 60_000);
  }

  const start = getOrderExactCreatedMs(order, null) ?? order.ts ?? nowMs;
  const end = start + etaMinutes * 60_000;
  const ms = end - nowMs;

  return Math.floor(ms / 60_000);
}

export function sortLeftMinutes(
  order: StoredOrder,
  avgPickup: number,
  avgDelivery: number,
  tz: string,
  nowMs: number,
  etaOverride?: number | null,
) {
  const planned = plannedStartMs(order, tz);
  const effectiveEta = etaOverride ?? etaFor(order, avgPickup, avgDelivery);

  if (planned && planned > nowMs) {
    return Math.floor((planned - nowMs) / 60_000);
  }

  return remainingMinutes(order, effectiveEta, tz, nowMs);
}

export function autoDisplayStatus(
  order: StoredOrder,
  avgPickup: number,
  avgDelivery: number,
  newGraceMin: number,
  tz: string,
): OrderStatus {
  if (order.status === "done" || order.status === "cancelled") return order.status;
  if (order.status && order.status !== "new") return order.status;

  const plannedMs = plannedStartMs(order, tz);
  if (plannedMs && plannedMs > Date.now()) return "new";

  const eta = etaFor(order, avgPickup, avgDelivery);
  const nowMs = Date.now();
  const start = getOrderExactCreatedMs(order, null) ?? order.ts ?? nowMs;
  const elapsedMin = Math.max(0, Math.floor((nowMs - start) / 60_000));

  if (elapsedMin < newGraceMin) return "new";

  if (order.mode === "pickup") {
    const ratio = elapsedMin / Math.max(1, eta);
    return ratio < 0.7 ? "preparing" : "ready";
  }

  return "preparing";
}

export function formatDeliveryLine(order: StoredOrder) {
  const customer = order?.customer || {};
  const direct =
    customer.addressLine ||
    customer.address ||
    order.addressLine ||
    "";

  if (!direct && (customer.zip || customer.plz || customer.street)) {
    return [
      customer.zip || customer.plz,
      [customer.street, customer.house].filter(Boolean).join(" "),
    ]
      .filter(Boolean)
      .join(" ");
  }

  const raw = String(direct || "");
  if (!raw) return "";

  const parts = raw.split("|").map((s) => s.trim());
  const streetHouse = parts[0] || "";
  const zipMatch = (parts[1] || raw).match(/\b\d{5}\b/);
  const zip = zipMatch ? zipMatch[0] : customer.zip || customer.plz || "";

  return [zip, streetHouse].filter(Boolean).join(" ");
}

export function brianStreetFromOrder(order: StoredOrder): string {
  const customer = order?.customer || {};
  const raw = String(
    customer.street ||
      customer.addressLine ||
      customer.address ||
      order.addressLine ||
      "",
  );

  const firstPart = raw.split("|")[0] || raw;
  const withoutZip = firstPart.replace(/^\s*\d{5}\s+/, "");

  return normalizeStreet(withoutZip);
}

export function getDriverName(order: StoredOrder): string {
  const meta = order.meta || {};
  const driver = order.driver || meta.driver || null;

  return String(
    driver?.name ||
      driver?.id ||
      order.driverName ||
      meta.driverName ||
      meta.driverId ||
      "",
  );
}

export function getPaymentKind(order: StoredOrder): "online" | "cash" | "other" {
  const meta = order.meta || {};
  const pricing = order.pricing || {};
  const fees = order.fees || {};
  const payment = order.payment || {};
  const customer = order.customer || {};

  const raw = [
    order?.paymentMethod,
    order?.payment_method,
    order?.paymentType,
    order?.payment_type,
    order?.payMethod,
    order?.pay_method,
    order?.zahlung,
    order?.zahlungsart,
    order?.paymentStatus,
    order?.payment_status,
    order?.paid,
    order?.isPaid,

    payment?.method,
    payment?.type,
    payment?.name,
    payment?.provider,
    payment?.status,
    payment?.paid,
    payment?.isPaid,

    meta?.paymentMethod,
    meta?.payment_method,
    meta?.paymentType,
    meta?.payment_type,
    meta?.payMethod,
    meta?.pay_method,
    meta?.zahlung,
    meta?.zahlungsart,
    meta?.paymentStatus,
    meta?.payment_status,
    meta?.paid,
    meta?.isPaid,
    meta?.payment?.method,
    meta?.payment?.type,
    meta?.payment?.provider,
    meta?.payment?.status,
    meta?.payment?.paid,
    meta?.payment?.isPaid,

    pricing?.paymentMethod,
    pricing?.payment_method,
    pricing?.paymentType,
    pricing?.payment_type,
    pricing?.paymentStatus,
    pricing?.payment_status,

    fees?.paymentMethod,
    fees?.payment_method,
    fees?.paymentType,
    fees?.payment_type,

    customer?.paymentMethod,
    customer?.payment_method,
    customer?.zahlung,
    customer?.zahlungsart,
  ]
    .filter((value) => value != null && String(value).trim().length > 0)
    .map((value) => String(value).toLowerCase().trim())
    .join(" ");

  if (!raw) return "cash";

  const hasCash =
    /\b(cash|bar|barzahlung|bei\s*abholung|bei\s*lieferung|zahlung\s*bei|cod|unbezahlt|offen)\b/i.test(raw);

  const hasOnlineMethod =
    /\b(online|stripe|card|karte|kreditkarte|debit|ec|klarna|sofort|paypal|apple\s*pay|google\s*pay|giropay)\b/i.test(raw);

  const hasPaidStatus =
    /\b(paid|bezahlt|zahlung\s*erfolgreich|payment\s*succeeded|succeeded|success|true)\b/i.test(raw);

  if (hasOnlineMethod || (hasPaidStatus && !hasCash)) return "online";

  return "cash";
}

export function getPaymentBadge(order: StoredOrder): {
  icon: string;
  label: string;
  className: string;
} {
  const kind = getPaymentKind(order);

  if (kind === "online") {
    return {
      icon: "💳",
      label: "Online bezahlt",
      className: "border-emerald-400/60 bg-emerald-500/15 text-emerald-100",
    };
  }

  if (kind === "cash") {
    return {
      icon: "💶",
      label: "Barzahlung offen",
      className: "border-amber-400/60 bg-amber-500/15 text-amber-100",
    };
  }

  return {
    icon: "💰",
    label: "Zahlung offen",
    className: "border-stone-400/50 bg-stone-500/10 text-stone-200",
  };
}

export function daysUntilActive(meta: BrianData["meta"] | undefined): number | null {
  try {
    const startIso = GO_LIVE_AT || meta?.firstLearnAt || null;
    if (!startIso) return null;

    const start = new Date(startIso);
    const nowDate = new Date();
    const diffDays =
      Math.floor((+start - +nowDate) / (1000 * 60 * 60 * 24)) * -1;
    const remain = ENABLE_AFTER_DAYS - diffDays;

    return remain > 0 ? remain : 0;
  } catch {
    return null;
  }
}

export async function updateOrderStatusDbFirst(
  id: string,
  status: OrderStatus,
  by = "tv",
  extra: Record<string, unknown> = {},
) {
  return persistStatusToDb(id, status, by, extra);
}

export function clampAcceptEta(value: unknown) {
  const n = Number(value);
  const safe = Number.isFinite(n) ? Math.round(n) : 35;
  return Math.max(5, Math.min(180, safe));
}

export function roundEtaStep(value: unknown, step = 5) {
  const n = clampAcceptEta(value);
  return Math.max(step, Math.min(180, Math.round(n / step) * step));
}

export function normalizePlannedHHMM(value: unknown): string {
  const match = String(value || "")
    .trim()
    .match(/^(\d{1,2}):(\d{2})$/);

  if (!match) return "";

  const hours = Math.max(0, Math.min(23, Number(match[1]) || 0));
  const minutes = Math.max(0, Math.min(59, Number(match[2]) || 0));

  return `${pad2(hours)}:${pad2(minutes)}`;
}

export function addMinutesToHHMM(value: unknown, deltaMin: number): string {
  const clean = normalizePlannedHHMM(value) || "00:00";
  const [hours, minutes] = clean.split(":").map((part) => Number(part) || 0);
  const dayMinutes = 24 * 60;
  const total = (((hours * 60 + minutes + deltaMin) % dayMinutes) + dayMinutes) % dayMinutes;

  return `${pad2(Math.floor(total / 60))}:${pad2(total % 60)}`;
}

export function isPlannedOrder(order: StoredOrder) {
  return Boolean(normalizePlannedHHMM(order?.planned));
}

export function plannedAcceptLabel(order: StoredOrder) {
  return order.mode === "pickup" ? "Geplante Abholzeit" : "Geplante Lieferzeit";
}

export function acceptanceTitle(order: StoredOrder) {
  const planned = normalizePlannedHHMM(order.planned);
  const plannedLabel = planned ? `Geplant ${planned}` : "";

  if (order.mode === "pickup") {
    return plannedLabel ? `${plannedLabel} · Abholung` : "Abholung";
  }

  return plannedLabel ? `${plannedLabel} · Lieferung` : "Lieferung";
}

export function acceptanceSubtitle(order: StoredOrder) {
  if (order.mode === "pickup") {
    const name = String(order.customer?.name || "").trim();
    const phone = String(order.customer?.phone || "").trim();

    return [name, phone].filter(Boolean).join(" · ") || "Abholung im Laden";
  }

  return formatDeliveryLine(order) || "Adresse prüfen";
}

export function acceptanceZip(order: StoredOrder) {
  return String(
    order.plz ||
      order.customer?.plz ||
      order.customer?.zip ||
      "",
  ).trim();
}
