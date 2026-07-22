import {
  setOrderStatus,
  upsertOrder,
  type OrderMode,
  type OrderStatus,
  type StoredOrder,
} from "@/lib/orders";
import type {
  DriverAssignment,
  DriverCustomer,
  DriverIdentity,
  DriverMapPlatform,
  DriverMapProvider,
  DriverOrder,
  DriverOrderExtra,
  DriverOrderItem,
  DriverOrderMeta,
  UnknownRecord,
} from "@/types/driver";

export const CURRENT_DRIVER_KEY = "bb_current_driver_v1";
export const REMEMBER_KEY = "bb_driver_remember";
export const LASTNAME_KEY = "bb_driver_lastname";
export const DRIVER_LAST_REFRESH_KEY = "bb_driver_last_refresh_v1";

export const DEFAULT_ACTIVE_UNKNOWN_GRACE_MS = 6 * 60 * 60 * 1000;
export const DEFAULT_DRIVER_REFRESH_MS = 6500;
export const PULL_REFRESH_TRIGGER_PX = 72;
export const PULL_REFRESH_MAX_PX = 96;
export const NOTE_PREVIEW_MAX = 92;

export const DEFAULT_STORE_ADDRESS = "Burger Brothers Berlin, Berlin Tegel";

export const DEFAULT_ROUTE_PLZ_PRIORITY = [
  "13403",
  "13405",
  "13407",
  "13409",
  "13437",
  "13469",
  "13467",
  "13505",
  "13503",
  "13507",
] as const;

export const glass =
  "backdrop-blur-xl bg-white/5 border border-white/15 " +
  "shadow-[inset_0_1px_0_0_rgba(255,255,255,.18)] ring-1 ring-black/20";

export function cleanObj(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};
}

export function cleanArr(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringValue(value: unknown) {
  return String(value ?? "").trim();
}

export function num(value: unknown, fallback = 0) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value == null || value === "") return fallback;

  const text = String(value)
    .trim()
    .replace(/[€\s]/g, "")
    .replace(",", ".");

  const match = text.match(/-?\d+(\.\d+)?/);
  const parsed = match ? Number(match[0]) : Number(text);

  return Number.isFinite(parsed) ? parsed : fallback;
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

export function normalizeStatus(value: unknown): OrderStatus {
  const text = String(value || "").toLowerCase().trim();

  if (text === "new" || text === "received" || text === "eingegangen") {
    return "new";
  }

  if (
    text === "preparing" ||
    text === "prepare" ||
    text === "zubereitung" ||
    text === "in_vorbereitung" ||
    text === "in vorbereitung"
  ) {
    return "preparing";
  }

  if (text === "ready" || text === "bereit" || text === "abholbereit") {
    return "ready";
  }

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

  if (
    text === "cancelled" ||
    text === "canceled" ||
    text === "storniert"
  ) {
    return "cancelled";
  }

  return "new";
}

export function normalizeMode(value: unknown): OrderMode {
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

export function pad2(value: number) {
  return value < 10 ? `0${value}` : String(value);
}

export function dayKeyForMs(ms: number, timezone: string) {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date(ms));

    const year = parts.find((part) => part.type === "year")?.value || "0000";
    const month = parts.find((part) => part.type === "month")?.value || "00";
    const day = parts.find((part) => part.type === "day")?.value || "00";

    return `${year}-${month}-${day}`;
  } catch {
    const date = new Date(ms);
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(
      date.getDate(),
    )}`;
  }
}

export function todayKey(timezone: string) {
  return dayKeyForMs(Date.now(), timezone);
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

function firstHistoryMs(value: unknown): number | null {
  for (const rawEntry of cleanArr(value)) {
    const entry = cleanObj(rawEntry);
    const ms = toMsStrict(
      entry.ts ??
        entry.at ??
        entry.createdAt ??
        entry.created_at ??
        entry.time,
    );

    if (ms != null) return ms;
  }

  return null;
}

function statusHistoryMs(value: unknown, status: OrderStatus): number | null {
  const entries = cleanArr(value);

  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = cleanObj(entries[index]);

    const rawStatus =
      entry.status ??
      entry.to ??
      entry.nextStatus ??
      entry.newStatus ??
      entry.value;

    if (rawStatus && normalizeStatus(rawStatus) !== status) continue;

    const ms = toMsStrict(
      entry.ts ??
        entry.at ??
        entry.createdAt ??
        entry.created_at ??
        entry.updatedAt ??
        entry.updated_at ??
        entry.time,
    );

    if (ms != null) return ms;
  }

  return null;
}

export function getOrderCreatedMs(order: Partial<DriverOrder>): number | null {
  const meta = cleanObj(order.meta);

  const candidates: unknown[] = [
    order.createdAt,
    order.created_at,
    meta.createdAt,
    meta.created_at,
    meta.orderCreatedAt,
    meta.order_created_at,
    meta.submittedAt,
    meta.submitted_at,
    meta.checkoutAt,
    meta.checkout_at,
    firstHistoryMs(order.history),
    firstHistoryMs(meta.history),
    meta.createdAtMs,
    meta.ts,
    order.ts,
  ];

  for (const candidate of candidates) {
    const ms = toMsStrict(candidate);
    if (ms != null) return ms;
  }

  return null;
}

export function getOrderDoneMs(order: Partial<DriverOrder>): number | null {
  const meta = cleanObj(order.meta);

  const candidates: unknown[] = [
    order.doneAt,
    order.done_at,
    order.completedAt,
    order.completed_at,
    order.deliveredAt,
    order.delivered_at,
    meta.doneAt,
    meta.done_at,
    meta.completedAt,
    meta.completed_at,
    meta.deliveredAt,
    meta.delivered_at,
    meta.deliveredAtMs,
    statusHistoryMs(order.history, "done"),
    statusHistoryMs(meta.history, "done"),
    order.updatedAt,
    order.updated_at,
    meta.updatedAt,
    meta.updated_at,
  ];

  for (const candidate of candidates) {
    const ms = toMsStrict(candidate);
    if (ms != null) return ms;
  }

  return null;
}

export function isOrderForTodayOrFresh(
  order: DriverOrder,
  timezone: string,
  activeUnknownGraceMs: number,
) {
  const status = normalizeStatus(order.status);
  const isFinal = status === "done" || status === "cancelled";
  const today = todayKey(timezone);

  const idDay = orderDateFromId(order.orderId || order.id);
  const created = getOrderCreatedMs(order);
  const done = getOrderDoneMs(order);
  const mainMs = done ?? idDay ?? created ?? toMsStrict(order.ts);

  if (mainMs != null) {
    return dayKeyForMs(mainMs, timezone) === today;
  }

  if (!isFinal) {
    const firstSeen = toMsStrict(order.meta.firstSeenAt);
    if (firstSeen != null) {
      return Date.now() - firstSeen <= activeUnknownGraceMs;
    }
  }

  return false;
}

function normalizeExtra(value: unknown): DriverOrderExtra {
  const item = cleanObj(value);

  return {
    ...item,
    label: item.label ? String(item.label) : undefined,
    name: item.name ? String(item.name) : undefined,
    price: num(item.price),
  };
}

export function normalizeItems(value: unknown): DriverOrderItem[] {
  return cleanArr(value).map((rawItem, index) => {
    const item = cleanObj(rawItem);
    const itemId =
      item.id || item.sku || item.name || item.title || `item-${index}`;

    return {
      ...item,
      id: item.id ? String(item.id) : String(itemId),
      sku: item.sku ? String(item.sku) : undefined,
      code: item.code ? String(item.code) : undefined,
      name: String(item.name || item.title || "Artikel"),
      title: item.title ? String(item.title) : undefined,
      category: item.category ? String(item.category) : undefined,
      price: num(item.price ?? item.unitPrice),
      unitPrice:
        item.unitPrice != null ? num(item.unitPrice) : undefined,
      qty: Math.max(1, num(item.qty ?? item.quantity, 1)),
      quantity:
        item.quantity != null ? Math.max(1, num(item.quantity, 1)) : undefined,
      add: cleanArr(item.add ?? item.extras).map(normalizeExtra),
      extras: cleanArr(item.extras).map(normalizeExtra),
      rm: cleanArr(item.rm ?? item.remove).map(String),
      remove: cleanArr(item.remove).map(String),
      note: item.note ? String(item.note) : undefined,
    };
  });
}

function normalizeDriverAssignment(value: unknown): DriverAssignment | null {
  const record = cleanObj(value);
  const id = stringValue(record.id);
  const name = stringValue(record.name);

  if (!id && !name) return null;

  return {
    ...record,
    id: id || undefined,
    name: name || undefined,
  };
}

function normalizeCustomer(value: unknown): DriverCustomer {
  const customer = cleanObj(value);

  return {
    ...customer,
    name: stringValue(customer.name || customer.customerName),
    phone: stringValue(customer.phone || customer.telephone) || undefined,
    address: stringValue(customer.address) || undefined,
    addressLine: stringValue(customer.addressLine) || undefined,
    street: stringValue(customer.street) || undefined,
    house: stringValue(customer.house || customer.houseNo) || undefined,
    houseNo: stringValue(customer.houseNo) || undefined,
    zip: stringValue(customer.zip || customer.plz || customer.postalCode) || undefined,
    plz: stringValue(customer.plz || customer.zip || customer.postalCode) || undefined,
    postalCode:
      stringValue(customer.postalCode || customer.plz || customer.zip) || undefined,
    deliveryHint:
      stringValue(customer.deliveryHint || customer.deliveryNote || customer.note) ||
      undefined,
    note: stringValue(customer.note) || undefined,
  };
}

export function normalizeOrdersPayload(data: unknown): DriverOrder[] {
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
                  : [];

  return list
    .map((rawValue): DriverOrder | null => {
      try {
        const raw = cleanObj(rawValue);
        const nestedOrder = cleanObj(raw.order);
        const nestedItem = cleanObj(raw.item);
        const nestedValueData = cleanObj(raw.data);

        const source =
          (nestedOrder.id || nestedOrder.orderId
            ? nestedOrder
            : nestedItem.id || nestedItem.orderId
              ? nestedItem
              : nestedValueData.id || nestedValueData.orderId
                ? nestedValueData
                : raw);

        const meta = cleanObj(source.meta) as DriverOrderMeta;
        const customer = normalizeCustomer(source.customer);
        const items = normalizeItems(source.items);

        const id = stringValue(source.id || source.orderId);
        if (!id) return null;

        const orderId = stringValue(source.orderId || id);
        const directAddress =
          stringValue(source.addressLine) ||
          customer.addressLine ||
          customer.address ||
          [customer.street, customer.house].filter(Boolean).join(" ");

        const plz =
          stringValue(
            source.plz || customer.plz || customer.zip || customer.postalCode,
          ) || null;

        const note =
          stringValue(
            source.note ||
              source.orderNote ||
              customer.deliveryHint ||
              customer.note ||
              meta.note ||
              meta.orderNote,
          ) || "";

        const directDriver =
          normalizeDriverAssignment(source.driver) ||
          normalizeDriverAssignment(meta.driver) ||
          normalizeDriverAssignment({
            id: meta.driverId,
            name: meta.driverName,
          });

        const createdMs = getOrderCreatedMs({
          id,
          orderId,
          ts: toMsStrict(source.ts) ?? 0,
          mode: normalizeMode(source.mode),
          status: normalizeStatus(meta.statusManual ?? source.status),
          customer,
          items,
          meta,
          createdAt:
            stringValue(source.createdAt || source.created_at || meta.createdAt) ||
            null,
        });

        const totalValue = num(source.total, 0);

        return {
          ...source,
          id,
          orderId,
          ts: createdMs ?? toMsStrict(source.ts) ?? 0,
          createdAt:
            stringValue(source.createdAt || source.created_at || meta.createdAt) ||
            null,
          updatedAt:
            stringValue(source.updatedAt || source.updated_at) || null,
          mode: normalizeMode(source.mode),
          channel: stringValue(source.channel || "web"),
          status: normalizeStatus(meta.statusManual ?? source.status),
          planned: stringValue(source.planned) || null,
          etaMin:
            source.etaMin != null ? num(source.etaMin, 0) : null,
          etaAdjustMin:
            source.etaAdjustMin != null
              ? num(source.etaAdjustMin, 0)
              : num(
                  meta.etaAdjustMin ??
                    meta.etaAdjust ??
                    meta.etaDeltaMin,
                  0,
                ),
          customer: {
            ...customer,
            name: customer.name || "",
            phone: customer.phone || "",
            addressLine: directAddress,
            address: directAddress,
            plz: plz || undefined,
            zip: plz || undefined,
            deliveryHint: note,
          },
          items,
          meta,
          driver: directDriver,
          driverName:
            stringValue(
              source.driverName ||
                cleanObj(source.driver).name ||
                cleanObj(meta.driver).name ||
                meta.driverName,
            ) || undefined,
          plz,
          note,
          orderNote: stringValue(source.orderNote) || undefined,
          total: totalValue || undefined,
          amount: source.amount != null ? num(source.amount) : undefined,
          payable: source.payable != null ? num(source.payable) : undefined,
          toPay: source.toPay != null ? num(source.toPay) : undefined,
          archivedAt: source.archivedAt as string | number | null | undefined,
          anonymizedAt: source.anonymizedAt as
            | string
            | number
            | null
            | undefined,
          doneAt: source.doneAt as number | string | null | undefined,
          done_at: source.done_at as number | string | null | undefined,
          completedAt: source.completedAt as
            | number
            | string
            | null
            | undefined,
          completed_at: source.completed_at as
            | number
            | string
            | null
            | undefined,
          deliveredAt: source.deliveredAt as
            | number
            | string
            | null
            | undefined,
          delivered_at: source.delivered_at as
            | number
            | string
            | null
            | undefined,
        };
      } catch {
        return null;
      }
    })
    .filter((order): order is DriverOrder => Boolean(order));
}

export async function fetchDriverOrdersFromDb(
  signal?: AbortSignal,
): Promise<DriverOrder[]> {
  const endpoints = [
    `/api/orders/list?view=driver&includeDone=1&take=500&t=${Date.now()}`,
    `/api/orders/list?includeDone=1&take=500&t=${Date.now()}`,
  ];

  let lastError: unknown = null;

  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint, {
        cache: "no-store",
        signal,
        headers: { accept: "application/json" },
      });

      const data: unknown = await response.json().catch(() => ({}));

      if (!response.ok || cleanObj(data).ok === false) {
        throw new Error(
          stringValue(cleanObj(data).error) || `HTTP ${response.status}`,
        );
      }

      return normalizeOrdersPayload(data);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        throw error;
      }

      if (error instanceof Error && error.name === "AbortError") {
        throw error;
      }

      lastError = error;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("DRIVER_ORDERS_FETCH_FAILED");
}

export function prettyDeliveryLine(order: DriverOrder) {
  const customer = order.customer;
  const raw = String(customer.address || customer.addressLine || "");

  if (!raw && (customer.zip || customer.plz || customer.street)) {
    return [
      customer.zip || customer.plz,
      [customer.street, customer.house].filter(Boolean).join(" "),
    ]
      .filter(Boolean)
      .join(" ");
  }

  if (!raw) return "";

  const parts = raw.split("|").map((part) => part.trim());

  if (parts.length >= 2) {
    const street = parts[0] || "";
    const zipMatch = (parts[1] || "").match(/\b\d{5}\b/);
    const zip =
      zipMatch?.[0] || parts[1] || customer.zip || customer.plz || "";

    return [zip, street].filter(Boolean).join(" ");
  }

  return raw;
}

export function orderPlzValue(order: DriverOrder) {
  const direct = String(
    order.customer.plz || order.customer.zip || order.plz || "",
  ).trim();

  if (/^\d{5}$/.test(direct)) return direct;

  const match = prettyDeliveryLine(order).match(/\b\d{5}\b/);
  return match?.[0] || "";
}

export function normalizeRoutePriority(value: unknown): string[] {
  const values = cleanArr(value)
    .map((entry) => String(entry || "").trim())
    .filter((entry) => /^\d{5}$/.test(entry));

  return values.length
    ? Array.from(new Set(values))
    : [...DEFAULT_ROUTE_PLZ_PRIORITY];
}

export function routePriorityFromSettings(settings: unknown): string[] {
  const root = cleanObj(settings);
  const driver = cleanObj(root.driver);
  const delivery = cleanObj(root.delivery);

  return normalizeRoutePriority(
    driver.routePlzPriority ??
      driver.routePriority ??
      delivery.routePlzPriority ??
      delivery.routePriority,
  );
}

export function storeOriginFromSettings(settings: unknown) {
  const root = cleanObj(settings);
  const driver = cleanObj(root.driver);
  const contact = cleanObj(root.contact);

  const candidates: unknown[] = [
    driver.storeOrigin,
    driver.storeAddress,
    contact.mapsAddress,
    contact.routeOrigin,
    contact.address,
    root.storeAddress,
    root.restaurantAddress,
    DEFAULT_STORE_ADDRESS,
  ];

  for (const candidate of candidates) {
    const text = stringValue(candidate);
    if (text) return text;
  }

  return DEFAULT_STORE_ADDRESS;
}

export function getOrderRouteAddress(order: DriverOrder) {
  const customer = order.customer;

  return String(
    prettyDeliveryLine(order) ||
      customer.address ||
      customer.addressLine ||
      [customer.plz || customer.zip, customer.street, customer.house]
        .filter(Boolean)
        .join(" "),
  ).trim();
}

function routeRankForOrder(order: DriverOrder, priority: string[]) {
  const plz = orderPlzValue(order);
  const index = priority.indexOf(plz);
  return index >= 0 ? index : priority.length + 99;
}

export function sortOrdersForRoute(
  orders: DriverOrder[],
  priority: string[],
) {
  return orders
    .map((order, index) => ({ order, index }))
    .sort((left, right) => {
      const rankDiff =
        routeRankForOrder(left.order, priority) -
        routeRankForOrder(right.order, priority);

      if (rankDiff !== 0) return rankDiff;

      const leftPlz = orderPlzValue(left.order);
      const rightPlz = orderPlzValue(right.order);
      if (leftPlz !== rightPlz) return leftPlz.localeCompare(rightPlz);

      const leftCreated = getOrderCreatedMs(left.order) ?? left.order.ts ?? 0;
      const rightCreated =
        getOrderCreatedMs(right.order) ?? right.order.ts ?? 0;

      if (leftCreated !== rightCreated) return leftCreated - rightCreated;
      return left.index - right.index;
    })
    .map((entry) => entry.order);
}

export function uniqueRouteAddresses(
  orders: DriverOrder[],
  priority: string[],
) {
  const seen = new Set<string>();
  const addresses: string[] = [];

  for (const order of sortOrdersForRoute(orders, priority)) {
    const address = getOrderRouteAddress(order);
    const key = address.toLowerCase().replace(/\s+/g, " ").trim();

    if (!address || seen.has(key)) continue;

    seen.add(key);
    addresses.push(address);
  }

  return addresses;
}

export const DRIVER_MAP_PREFERENCE_KEY =
  "bb_driver_map_preference_v1";

type StandaloneNavigator = Navigator & {
  standalone?: boolean;
  maxTouchPoints?: number;
};

export function detectDriverMapPlatform(): DriverMapPlatform {
  if (typeof navigator === "undefined") return "desktop";

  const extendedNavigator = navigator as StandaloneNavigator;
  const ua = navigator.userAgent || "";
  const platform = navigator.platform || "";

  if (
    /iPad|iPhone|iPod/i.test(ua) ||
    (platform === "MacIntel" &&
      Number(extendedNavigator.maxTouchPoints || 0) > 1)
  ) {
    return "ios";
  }

  if (/Android/i.test(ua)) return "android";
  return "desktop";
}

export function isStandalonePwa() {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return false;
  }

  const extendedNavigator = navigator as StandaloneNavigator;

  return Boolean(
    window.matchMedia?.("(display-mode: standalone)")?.matches ||
      window.matchMedia?.("(display-mode: fullscreen)")?.matches ||
      extendedNavigator.standalone,
  );
}

export function mapProviderLabel(provider: DriverMapProvider | null) {
  if (provider === "apple") return "Apple Karten";
  if (provider === "system") return "Andere Karten-App";
  if (provider === "google") return "Google Maps";
  return "Noch nicht gewählt";
}

export function mapProviderOptions(
  platform: DriverMapPlatform,
  multiStop: boolean,
) {
  if (platform === "ios") {
    return [
      {
        id: "apple" as const,
        label: "Apple Karten",
        description: multiStop
          ? "Mehrere Stopps als Routen-Vorschau öffnen."
          : "Route in Apple Karten voranzeigen.",
        icon: "",
      },
      {
        id: "google" as const,
        label: "Google Maps",
        description: multiStop
          ? "Mehrere Stopps als Google-Route voranzeigen."
          : "Route in Google Maps voranzeigen.",
        icon: "G",
      },
    ];
  }

  if (platform === "android") {
    return [
      {
        id: "google" as const,
        label: "Google Maps",
        description: multiStop
          ? "Mehrere Stopps als Google-Route voranzeigen."
          : "Route in Google Maps voranzeigen.",
        icon: "G",
      },
      ...(multiStop
        ? []
        : [
            {
              id: "system" as const,
              label: "Andere Karten-App",
              description:
                "Android lässt eine installierte Karten-App wählen.",
              icon: "🗺️",
            },
          ]),
    ];
  }

  return [
    {
      id: "google" as const,
      label: "Google Maps",
      description: "Route im Browser voranzeigen.",
      icon: "G",
    },
  ];
}

function cleanRouteAddresses(addresses: string[]) {
  const seen = new Set<string>();

  return addresses
    .map((address) => String(address || "").trim())
    .filter((address) => {
      const key = address.toLowerCase().replace(/\s+/g, " ");

      if (!key || seen.has(key)) return false;

      seen.add(key);
      return true;
    });
}

export function buildGoogleMapsPreviewUrl(addresses: string[]) {
  const stops = cleanRouteAddresses(addresses);
  if (!stops.length) return "";

  const destination = stops[stops.length - 1];
  const waypoints = stops.slice(0, -1);
  const params = new URLSearchParams();

  params.set("api", "1");
  params.set("destination", destination);
  params.set("travelmode", "driving");

  if (waypoints.length) {
    params.set("waypoints", waypoints.join("|"));
  }

  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

export function mapsDirectionWebUrl(address: string) {
  return buildGoogleMapsPreviewUrl([address]) || "https://www.google.com/maps";
}

export function buildMultiStopMapsUrl(
  orders: DriverOrder[],
  priority: string[],
) {
  return buildGoogleMapsPreviewUrl(
    uniqueRouteAddresses(orders, priority),
  );
}

export function buildAppleMapsPreviewUrl(addresses: string[]) {
  const stops = cleanRouteAddresses(addresses);
  if (!stops.length) return "";

  const destination = stops[stops.length - 1];
  const waypoints = stops.slice(0, -1);
  const params = new URLSearchParams();

  params.set("destination", destination);
  params.set("mode", "driving");

  for (const waypoint of waypoints) {
    params.append("waypoint", waypoint);
  }

  return `https://maps.apple.com/directions?${params.toString()}`;
}

export function buildSystemMapPreviewUrl(addresses: string[]) {
  const stops = cleanRouteAddresses(addresses);

  if (stops.length !== 1) return "";

  return `geo:0,0?q=${encodeURIComponent(stops[0])}`;
}

function openMapUrl(url: string, platform: DriverMapPlatform) {
  if (typeof window === "undefined") return false;

  if (platform === "desktop") {
    const opened = window.open(url, "_blank", "noopener,noreferrer");

    if (!opened) {
      window.location.href = url;
    }

    return true;
  }

  window.location.href = url;
  return true;
}

export function openMapPreview({
  provider,
  addresses,
  platform = detectDriverMapPlatform(),
}: {
  provider: DriverMapProvider;
  addresses: string[];
  platform?: DriverMapPlatform;
}): { ok: boolean; message?: string } {
  const stops = cleanRouteAddresses(addresses);

  if (!stops.length) {
    return { ok: false, message: "Keine Adresse gefunden." };
  }

  const url =
    provider === "apple"
      ? buildAppleMapsPreviewUrl(stops)
      : provider === "system"
        ? buildSystemMapPreviewUrl(stops)
        : buildGoogleMapsPreviewUrl(stops);

  if (!url) {
    return {
      ok: false,
      message:
        provider === "system" && stops.length > 1
          ? "Mehrere Stopps werden mit dieser Karten-App nicht unterstützt."
          : "Karte konnte nicht vorbereitet werden.",
    };
  }

  openMapUrl(url, platform);
  return { ok: true };
}

export function openExternalMap(address: string): {
  ok: boolean;
  message?: string;
} {
  return openMapPreview({
    provider: "google",
    addresses: [address],
  });
}

export function openMultiStopMapsRoute(
  orders: DriverOrder[],
  priority: string[],
): { ok: boolean; message?: string } {
  const addresses = uniqueRouteAddresses(orders, priority);

  return openMapPreview({
    provider: "google",
    addresses,
  });
}

export function sanitizePhone(phone?: string) {
  return String(phone || "").replace(/[^+\d]/g, "");
}

export function clearPosKey(id: string | number) {
  try {
    localStorage.removeItem(`bb_driverpos_${id}`);
  } catch {
    // Local cache cleanup failure must not block order operations.
  }
}

export function orderDriver(order: DriverOrder): DriverAssignment | null {
  const direct = normalizeDriverAssignment(order.driver);
  if (direct) return direct;

  const metaDriver = normalizeDriverAssignment(order.meta.driver);
  if (metaDriver) return metaDriver;

  return normalizeDriverAssignment({
    id: order.meta.driverId,
    name: order.meta.driverName,
  });
}

export function isDriverOrder(
  order: DriverOrder,
  current: DriverIdentity | null,
) {
  if (!current) return false;

  const driver = orderDriver(order);

  return Boolean(
    String(driver?.id || "") === String(current.id) ||
      String(driver?.name || "") === String(current.name),
  );
}

export function orderTipAmount(order: DriverOrder): number {
  const payment = cleanObj(order.meta.payment || order.payment);

  const candidates: unknown[] = [
    payment.tip,
    payment.trinkgeld,
    payment.tipAmount,
    payment.trinkgeldAmount,
    order.meta.tip,
    order.meta.trinkgeld,
    order.meta.tipAmount,
    order.meta.trinkgeldAmount,
    order.tip,
    order.trinkgeld,
    order.gratuity,
  ];

  for (const value of candidates) {
    const result = num(value);
    if (result > 0) return +result.toFixed(2);
  }

  return 0;
}

export function orderPayableTotal(order: DriverOrder): number {
  const payment = cleanObj(order.meta.payment || order.payment);

  const candidates: unknown[] = [
    payment.payableTotal,
    payment.total,
    order.meta.payableTotal,
    order.meta.total,
    order.payable,
    order.toPay,
    order.total,
    order.amount,
  ];

  for (const value of candidates) {
    const result = num(value);
    if (result > 0) return +result.toFixed(2);
  }

  return 0;
}

export function orderNote(order: DriverOrder): string {
  const customer = order.customer;
  const meta = order.meta;

  const candidates: unknown[] = [
    meta.lieferhinweis,
    meta.deliveryNote,
    meta.orderNote,
    meta.note,
    meta.customerNote,
    customer.lieferhinweis,
    customer.deliveryNote,
    customer.orderNote,
    customer.deliveryHint,
    customer.note,
    order.deliveryNote,
    order.orderNote,
    order.note,
  ];

  for (const value of candidates) {
    const text = stringValue(value);
    if (text) return text;
  }

  return "";
}

export function compactText(value: unknown) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[ä]/g, "a")
    .replace(/[ö]/g, "o")
    .replace(/[ü]/g, "u")
    .replace(/[ß]/g, "ss")
    .trim();
}

function paymentTextFromOrder(order: DriverOrder) {
  const payment = cleanObj(order.meta.payment || order.payment);
  const checkout = cleanObj(order.meta.checkout || order.checkout);

  return compactText(
    [
      order.paymentMethod,
      order.payment_method,
      order.paymentType,
      order.payment_type,
      order.paymentProvider,
      order.payment_provider,
      order.paymentStatus,
      order.payment_status,
      payment.method,
      payment.type,
      payment.provider,
      payment.status,
      payment.paymentMethod,
      payment.payment_method,
      payment.paymentStatus,
      payment.payment_status,
      checkout.paymentMethod,
      checkout.payment_method,
      checkout.paymentStatus,
      checkout.payment_status,
      order.meta.paymentMethod,
      order.meta.payment_method,
      order.meta.paymentType,
      order.meta.payment_type,
      order.meta.paymentProvider,
      order.meta.payment_provider,
      order.meta.paymentStatus,
      order.meta.payment_status,
      order.meta.stripePaymentIntentId,
      order.meta.paymentIntentId,
      order.meta.checkoutSessionId,
    ]
      .filter((value) => value != null && value !== "")
      .join(" "),
  );
}

export function orderIsOnlinePaid(order: DriverOrder) {
  const paymentText = paymentTextFromOrder(order);

  const cashLike =
    /(^|\b)(cash|bar|barzahlung|bargeld|bei\s*lieferung|zahlung\s*bei\s*lieferung)(\b|$)/i.test(
      paymentText,
    );

  if (cashLike) return false;

  const onlineLike =
    /(^|\b)(online|stripe|card|karte|kreditkarte|debit|klarna|sofort|paypal|apple\s*pay|applepay|google\s*pay|googlepay|kontaktlos|contactless|paymentintent|checkoutsession)(\b|$)/i.test(
      paymentText,
    );

  const paidLike =
    /(^|\b)(paid|bezahlt|bezahlt_online|succeeded|success|successful|completed|complete|captured|approved|erfolgreich)(\b|$)/i.test(
      paymentText,
    );

  return onlineLike || paidLike;
}

export function isDrinkLikeItem(item: DriverOrderItem) {
  const category = compactText(
    item.category ??
      item.categoryKey ??
      item.type ??
      item.group ??
      item.section,
  ).replace(/[\s_-]+/g, "");

  if (
    [
      "drink",
      "drinks",
      "getrank",
      "getranke",
      "getraenk",
      "getraenke",
      "beverage",
      "beverages",
      "bubbletea",
      "bubbleteas",
      "boba",
      "milktea",
    ].includes(category)
  ) {
    return true;
  }

  const text = compactText(
    [
      item.sku,
      item.code,
      item.id,
      item.name,
      item.title,
    ]
      .filter(Boolean)
      .join(" "),
  );

  return /\b(drink|drinks|getrank|getranke|getraenk|getraenke|cola|coca|fanta|sprite|mezzo|wasser|water|ayran|uludag|jarritos|mate|club\s*mate|nestea|lipton|eistee|iced\s*tea|ice\s*tea|bubble\s*tea|bubbletea|boba|milk\s*tea|milktea|pepsi|capri|red\s*bull|vitamalz|fritz|schorle|saft|juice|limonade)\b/i.test(
    text,
  );
}

export function orderHasDrinks(order: DriverOrder) {
  return order.items.some(isDrinkLikeItem);
}

export function plannedValue(order: DriverOrder) {
  return String(
    order.planned ??
      order.meta.planned ??
      order.meta.plannedTime ??
      order.meta.planned_time ??
      order.meta.preorderTime ??
      order.meta.preorder_time ??
      "",
  ).trim();
}

export function isPlannedClaimOrder(order: DriverOrder) {
  return Boolean(plannedValue(order));
}

export function plannedClaimDetails(orders: DriverOrder[]) {
  const plannedOrders = orders.filter(isPlannedClaimOrder);

  const lines = plannedOrders.slice(0, 6).map((order) => {
    const planned = plannedValue(order);
    const address = prettyDeliveryLine(order);

    return `#${order.orderId || order.id}${
      planned ? ` · Geplant: ${planned}` : ""
    }${address ? ` · ${address}` : ""}`;
  });

  if (plannedOrders.length > lines.length) {
    lines.push(
      `… und ${plannedOrders.length - lines.length} weitere geplante Bestellung(en).`,
    );
  }

  return lines;
}

export function withDriverState(
  order: DriverOrder,
  current: DriverIdentity | null,
  status: OrderStatus,
  metaPatch: UnknownRecord = {},
): DriverOrder {
  const driver = current
    ? {
        id: current.id,
        name: current.name,
      }
    : null;

  return {
    ...order,
    status,
    driver,
    meta: {
      ...order.meta,
      ...metaPatch,
      driver,
      driverId: current ? current.id : null,
      driverName: current ? current.name : null,
      statusManual: status,
      statusUpdatedAt: Date.now(),
    },
  };
}

function toStoredOrder(order: DriverOrder): StoredOrder {
  return order as unknown as StoredOrder;
}

export async function persistDriverOrderSnapshot(
  order: DriverOrder,
  fallbackStatus: OrderStatus,
  by = "driver",
) {
  upsertOrder(toStoredOrder(order));

  const response = await fetch("/api/orders/status", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({
      id: order.id,
      orderId: order.orderId || order.id,
      status: fallbackStatus,
      by,
      clearDriver: true,
    }),
  });

  const data: unknown = await response.json().catch(() => ({}));
  const record = cleanObj(data);

  if (!response.ok || record.ok === false) {
    throw new Error(stringValue(record.error) || `HTTP ${response.status}`);
  }

  window.dispatchEvent(new CustomEvent("bb:refresh-orders"));
  return data;
}

export async function claimOrderOnServer(
  order: DriverOrder,
  current: DriverIdentity,
) {
  const response = await fetch("/api/orders/claim", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({
      id: order.id,
      orderId: order.orderId || order.id,
      driver: {
        id: current.id,
        name: current.name,
      },
      by: current.name,
    }),
  });

  const data: unknown = await response.json().catch(() => ({}));
  const record = cleanObj(data);

  if (!response.ok || record.ok === false) {
    throw new Error(
      stringValue(record.message || record.error) ||
        "Dieser Auftrag konnte nicht übernommen werden.",
    );
  }

  const claimed = normalizeOrdersPayload([
    record.order || record.item || record.data,
  ])[0];

  if (!claimed?.id) {
    throw new Error(
      "Auftrag wurde übernommen, aber die Antwort war unvollständig.",
    );
  }

  upsertOrder(toStoredOrder(claimed));
  window.dispatchEvent(new CustomEvent("bb:refresh-orders"));

  return claimed;
}

export async function updateOrderStatusOnServer(
  order: DriverOrder,
  status: OrderStatus,
  current: DriverIdentity | null,
  metaPatch: UnknownRecord = {},
) {
  const by = current?.name || "driver";
  const driver = current
    ? {
        id: current.id,
        name: current.name,
      }
    : null;

  const nextMeta = {
    ...order.meta,
    ...metaPatch,
    driver,
    driverId: current ? current.id : null,
    driverName: current ? current.name : null,
    statusManual: status,
    statusUpdatedAt: Date.now(),
  };

  const response = await fetch("/api/orders/status", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({
      id: order.id,
      orderId: order.orderId || order.id,
      status,
      nextStatus: status,
      by,
      driver,
      driverId: current ? current.id : null,
      driverName: current ? current.name : null,
      metaPatch,
      meta: nextMeta,
    }),
  });

  const data: unknown = await response.json().catch(() => ({}));
  const record = cleanObj(data);

  if (response.ok && record.ok !== false) {
    const serverOrder = normalizeOrdersPayload([
      record.order || record.item || record.data,
    ])[0];

    return serverOrder || null;
  }

  const serverMessage =
    stringValue(record.message || record.error) ||
    `POST /api/orders/status HTTP ${response.status}`;

  try {
    await setOrderStatus(order.id, status, by);
    return null;
  } catch (fallbackError) {
    throw new Error(
      serverMessage ||
        (fallbackError instanceof Error
          ? fallbackError.message
          : "Status konnte nicht gespeichert werden."),
    );
  }
}

export async function authenticateDriver(
  name: string,
  password: string,
  remember: boolean,
): Promise<DriverIdentity | null> {
  try {
    const response = await fetch("/api/drivers", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({
        action: "login",
        name,
        password,
        remember,
      }),
    });

    const data: unknown = await response.json().catch(() => ({}));
    const record = cleanObj(data);
    const rawDriver = cleanObj(record.driver);

    if (!response.ok || record.ok === false) return null;

    const id = stringValue(rawDriver.id);
    const driverName = stringValue(rawDriver.name);

    if (!id || !driverName) return null;

    // Password/role/hash gibi alanlar bilinçli olarak client state'e alınmaz.
    return { id, name: driverName };
  } catch {
    return null;
  }
}

export function readCurrentDriver(): DriverIdentity | null {
  try {
    const raw: unknown = JSON.parse(
      localStorage.getItem(CURRENT_DRIVER_KEY) || "null",
    );
    const record = cleanObj(raw);
    const id = stringValue(record.id);
    const name = stringValue(record.name);

    return id && name ? { id, name } : null;
  } catch {
    return null;
  }
}

export function writeCurrentDriver(driver: DriverIdentity | null) {
  if (driver) {
    localStorage.setItem(
      CURRENT_DRIVER_KEY,
      JSON.stringify({
        id: driver.id,
        name: driver.name,
      }),
    );
  } else {
    localStorage.removeItem(CURRENT_DRIVER_KEY);
  }
}

export function plannedStartMs(order: DriverOrder, timezone: string) {
  if (!order.planned) return null;

  const [hours, minutes] = String(order.planned)
    .split(":")
    .map((value) => parseInt(value, 10));

  if (Number.isNaN(hours)) return null;

  const base = new Date(
    new Date().toLocaleString("en-US", { timeZone: timezone }),
  );
  const date = new Date(base);

  date.setHours(hours || 0, minutes || 0, 0, 0);
  return date.getTime();
}

export function etaFor(
  order: DriverOrder,
  avgPickup: number,
  avgDelivery: number,
) {
  const base = num(
    order.etaMin ??
      order.meta.etaMin ??
      order.meta.eta ??
      (order.mode === "pickup" ? avgPickup : avgDelivery),
    order.mode === "pickup" ? avgPickup : avgDelivery,
  );

  const adjust = num(
    order.etaAdjustMin ??
      order.meta.etaAdjustMin ??
      order.meta.etaAdjust ??
      order.meta.etaDeltaMin,
    0,
  );

  return Math.max(0, base + adjust);
}

export function remainingMinutes(
  order: DriverOrder,
  avgPickup: number,
  avgDelivery: number,
  timezone: string,
  nowMs = Date.now(),
) {
  const eta = etaFor(order, avgPickup, avgDelivery);
  const planned = plannedStartMs(order, timezone);
  const start =
    planned && planned > nowMs
      ? planned
      : getOrderCreatedMs(order) ?? order.ts ?? nowMs;

  return Math.max(0, Math.floor((start + eta * 60_000 - nowMs) / 60_000));
}

export function formatMoney(value: number | undefined) {
  const safe = Number.isFinite(Number(value)) ? Number(value) : 0;
  return `${safe.toFixed(2)}€`;
}

export function orderItemsTotal(order: DriverOrder) {
  return order.items.reduce((sum, item) => {
    const qty = Math.max(1, num(item.qty, 1));
    const extras = (item.add || []).reduce(
      (extraSum, extra) => extraSum + num(extra.price),
      0,
    );

    return sum + (num(item.price) + extras) * qty;
  }, 0);
}

export function orderDisplayTotal(order: DriverOrder) {
  const total = orderPayableTotal(order);
  return total > 0 ? total : orderItemsTotal(order);
}

export function shortText(value: string, max = NOTE_PREVIEW_MAX) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length <= max ? text : `${text.slice(0, max).trim()}…`;
}

export function actionButtonClass(
  kind: "ghost" | "map" | "finish" | "danger" = "ghost",
) {
  const base =
    "rounded-xl px-3 py-2.5 text-sm font-bold transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50";

  const variants = {
    finish:
      "border border-emerald-300/60 bg-gradient-to-b from-emerald-300 to-emerald-500 text-black shadow-[0_0_20px_rgba(52,211,153,.24)] hover:from-emerald-200 hover:to-emerald-400",
    map:
      "border border-sky-300/45 bg-sky-400/15 text-sky-100 shadow-[0_0_16px_rgba(56,189,248,.10)] hover:bg-sky-400/25",
    danger:
      "border border-rose-300/35 bg-rose-500/10 text-rose-100 hover:bg-rose-500/20",
    ghost:
      "border border-white/15 bg-white/[0.06] text-stone-100 hover:bg-white/12",
  } as const;

  return `${base} ${variants[kind]}`;
}

export function tabButtonClass(
  active: boolean,
  tone: "new" | "mine",
) {
  const base =
    "rounded-2xl py-2 text-sm font-extrabold tracking-wide transition active:scale-[0.99]";

  if (!active) {
    return `${base} border border-transparent text-stone-300/90 hover:border-white/10 hover:bg-white/[0.06]`;
  }

  return tone === "new"
    ? `${base} border border-amber-300/45 bg-gradient-to-b from-amber-400/35 to-orange-500/25 text-amber-50 shadow-[0_0_18px_rgba(251,146,60,.18)]`
    : `${base} border border-emerald-300/45 bg-gradient-to-b from-emerald-400/30 to-sky-500/20 text-emerald-50 shadow-[0_0_18px_rgba(52,211,153,.16)]`;
}
