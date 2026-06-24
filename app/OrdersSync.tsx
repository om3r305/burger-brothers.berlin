// app/OrdersSync.tsx
"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

const LS_ORDERS = "bb_orders_v1";

const REFRESH_MS = 5_000;

const ORDER_SYNC_ROUTES = [
  "/admin/orders",
  "/tv",
  "/dashboard",
  "/driver",
] as const;

type OrdersPayload = {
  ok?: boolean;
  source?: string;
  orders?: any[];
  doneOrders?: any[];
  allOrders?: any[];
  items?: any[];
  data?: any[] | { orders?: any[]; items?: any[]; allOrders?: any[]; doneOrders?: any[] };
  error?: string;
};

type CanonicalStatus =
  | "new"
  | "preparing"
  | "ready"
  | "out_for_delivery"
  | "done"
  | "cancelled";

type OrderMode = "pickup" | "delivery";

function shouldSyncOrders(pathname: string | null | undefined) {
  const path = String(pathname || "");

  return ORDER_SYNC_ROUTES.some(
    (route) => path === route || path.startsWith(`${route}/`),
  );
}

function hash(value: string) {
  let h = 0;

  for (let i = 0; i < value.length; i += 1) {
    h = (h * 31 + value.charCodeAt(i)) | 0;
  }

  return String(h >>> 0);
}

function safeStringify(value: any) {
  try {
    return JSON.stringify(value ?? []);
  } catch {
    return "[]";
  }
}

function asArray(value: any): any[] {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.orders)) return value.orders;
  if (Array.isArray(value?.items)) return value.items;
  if (Array.isArray(value?.allOrders)) return value.allOrders;
  if (Array.isArray(value?.doneOrders)) return value.doneOrders;
  if (Array.isArray(value?.data?.orders)) return value.data.orders;
  if (Array.isArray(value?.data?.items)) return value.data.items;
  if (Array.isArray(value?.data?.allOrders)) return value.data.allOrders;
  if (Array.isArray(value?.data?.doneOrders)) return value.data.doneOrders;
  if (Array.isArray(value?.data)) return value.data;

  return [];
}

function readOrdersFromPayload(payload: OrdersPayload | null | undefined): any[] {
  const primary = asArray(payload);

  if (primary.length > 0) return primary;

  const merged = [
    ...(Array.isArray(payload?.orders) ? payload.orders : []),
    ...(Array.isArray(payload?.doneOrders) ? payload.doneOrders : []),
    ...(Array.isArray(payload?.allOrders) ? payload.allOrders : []),
    ...(Array.isArray(payload?.items) ? payload.items : []),
  ];

  return merged;
}

function num(value: any, fallback = 0) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value == null || value === "") return fallback;

  const text = String(value).trim().replace(/[€\s]/g, "").replace(",", ".");
  const match = text.match(/-?\d+(\.\d+)?/);
  const parsed = match ? Number(match[0]) : Number(text);

  return Number.isFinite(parsed) ? parsed : fallback;
}

function toMs(value: any, fallback = Date.now()) {
  if (typeof value === "number" && Number.isFinite(value)) return value;

  if (value instanceof Date && Number.isFinite(value.valueOf())) {
    return value.getTime();
  }

  if (typeof value === "string") {
    const text = value.trim();
    if (!text) return fallback;

    const asNumber = Number(text);
    if (Number.isFinite(asNumber) && asNumber > 0) return asNumber;

    const parsed = Date.parse(text);
    if (Number.isFinite(parsed)) return parsed;
  }

  return fallback;
}

function normalizeStatus(value: any): CanonicalStatus {
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

  if (text === "canceled" || text === "cancelled" || text === "storniert") return "cancelled";

  if (text === "new") return "new";

  return "new";
}

function normalizeMode(value: any): OrderMode {
  const text = String(value || "").toLowerCase().trim();

  if (text === "pickup" || text === "abholung" || text === "apollo" || text === "apollon") {
    return "pickup";
  }

  return "delivery";
}

function normalizeItems(value: any): any[] {
  const items = Array.isArray(value) ? value : [];

  return items.map((item, index) => ({
    ...item,
    id: item?.id != null ? String(item.id) : item?.sku ? String(item.sku) : `item-${index}`,
    sku: item?.sku != null ? String(item.sku) : item?.code != null ? String(item.code) : undefined,
    name: String(item?.name || item?.title || "Artikel"),
    category: item?.category ? String(item.category) : undefined,
    price: num(item?.price ?? item?.unitPrice, 0),
    qty: Math.max(1, num(item?.qty ?? item?.quantity ?? 1, 1)),
    add: Array.isArray(item?.add ?? item?.extras) ? item.add ?? item.extras : undefined,
    rm: Array.isArray(item?.rm ?? item?.remove)
      ? (item.rm ?? item.remove).map((entry: any) => String(entry))
      : undefined,
    note: item?.note ? String(item.note) : undefined,
  }));
}

function normalizeCustomer(value: any) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const addressLine =
    value.addressLine ||
    value.address ||
    [value.street, value.house || value.houseNo].filter(Boolean).join(" ");

  return {
    ...value,
    name: value.name ? String(value.name) : "",
    phone: value.phone ? String(value.phone) : "",
    address: addressLine ? String(addressLine) : "",
    addressLine: addressLine ? String(addressLine) : "",
    plz: value.plz ?? value.zip ?? null,
    zip: value.zip ?? value.plz ?? null,
    deliveryHint: value.deliveryHint ? String(value.deliveryHint) : undefined,
    note: value.note ? String(value.note) : undefined,
  };
}

function normalizeOrderForCache(order: any) {
  if (!order || typeof order !== "object") return order;

  const raw =
    order?.order && typeof order.order === "object"
      ? order.order
      : order?.item && typeof order.item === "object"
        ? order.item
        : order?.data && typeof order.data === "object"
          ? order.data
          : order;

  const id = String(raw.id ?? raw.orderId ?? "");
  const customer = normalizeCustomer(raw.customer);
  const meta = raw?.meta && typeof raw.meta === "object" && !Array.isArray(raw.meta) ? raw.meta : {};

  return {
    ...raw,
    id,
    orderId: String(raw.orderId ?? raw.id ?? id),
    status: normalizeStatus(meta?.statusManual ?? meta?.manualStatus ?? raw.status),
    mode: normalizeMode(raw.mode ?? raw.orderMode),
    channel: raw.channel ?? raw.source ?? meta?.source ?? "web",
    total: num(raw.total ?? raw.totalPrice ?? raw.amount, 0),
    merchandise: num(raw.merchandise, 0),
    discount: num(raw.discount, 0),
    surcharges: num(raw.surcharges, 0),
    couponDiscount: num(raw.couponDiscount ?? meta?.couponDiscount, 0),
    coupon: raw.coupon ?? meta?.coupon ?? null,
    ts: toMs(raw.ts ?? raw.createdAt),
    createdAt: raw.createdAt ?? raw.created_at ?? null,
    updatedAt: raw.updatedAt ?? raw.updated_at ?? null,
    planned: raw.planned ?? null,
    etaMin: raw.etaMin ?? null,
    etaAdjustMin: num(raw.etaAdjustMin ?? meta?.etaAdjustMin, 0),
    items: normalizeItems(raw.items),
    customer,
    customerName: raw.customerName ?? customer?.name ?? "",
    phone: raw.phone ?? customer?.phone ?? "",
    addressLine: raw.addressLine ?? customer?.addressLine ?? customer?.address ?? "",
    plz: raw.plz ?? customer?.plz ?? customer?.zip ?? null,
    note:
      raw.note ??
      raw.orderNote ??
      meta?.note ??
      meta?.orderNote ??
      customer?.deliveryHint ??
      customer?.note ??
      "",
    meta,
    driver: raw.driver ?? meta?.driver ?? null,
    print: raw.print ?? meta?.print ?? null,
    history: Array.isArray(raw.history ?? meta?.history) ? raw.history ?? meta.history : [],
    doneAt: raw.doneAt ?? meta?.doneAt ?? null,
    cancelledAt: raw.cancelledAt ?? meta?.cancelledAt ?? null,
  };
}

function dispatchLocalStorageUpdate(key: string, oldValue: string | null, newValue: string) {
  try {
    window.dispatchEvent(
      new StorageEvent("storage", {
        key,
        oldValue,
        newValue,
        storageArea: window.localStorage,
      }),
    );
  } catch {
    try {
      window.dispatchEvent(new Event("storage"));
    } catch {}
  }
}

function writeOrdersCacheIfChanged(orders: any[]) {
  const normalized = orders.map(normalizeOrderForCache).filter((order) => order?.id);
  const next = safeStringify(normalized);
  const prev = localStorage.getItem(LS_ORDERS);

  if (hash(prev || "[]") === hash(next)) {
    return false;
  }

  localStorage.setItem(LS_ORDERS, next);
  dispatchLocalStorageUpdate(LS_ORDERS, prev, next);

  try {
    window.dispatchEvent(
      new CustomEvent("bb:orders-sync", {
        detail: {
          source: "db",
          orders: normalized,
        },
      }),
    );
  } catch {}

  return true;
}

export default function OrdersSync() {
  const pathname = usePathname();
  const runningRef = useRef(false);
  const lastOrdersHashRef = useRef("");

  useEffect(() => {
    if (!shouldSyncOrders(pathname)) {
      return;
    }

    let alive = true;
    let intervalId: ReturnType<typeof setInterval> | null = null;

    const pullOrdersFromDb = async () => {
      if (!alive) return;
      if (runningRef.current) return;

      runningRef.current = true;

      try {
        const res = await fetch("/api/admin/orders?take=1000", {
          method: "GET",
          cache: "no-store",
          headers: {
            accept: "application/json",
          },
        });

        const payload = (await res.json().catch(() => ({}))) as OrdersPayload;

        if (!res.ok || payload?.ok === false) {
          throw new Error(payload?.error || `ORDERS_${res.status}`);
        }

        const orders = readOrdersFromPayload(payload);
        const normalized = orders.map(normalizeOrderForCache).filter((order) => order?.id);

        const ordersHash = hash(safeStringify(normalized));

        if (ordersHash === lastOrdersHashRef.current) {
          return;
        }

        lastOrdersHashRef.current = ordersHash;
        writeOrdersCacheIfChanged(normalized);
      } catch {
        /*
          DB-first kuralı:
          - API başarısızsa localStorage siparişlerini server'a basmıyoruz.
          - Eski /api/orders PUT route'una fallback yapmıyoruz.
          - Mevcut cache'i silmiyoruz.
        */
      } finally {
        runningRef.current = false;
      }
    };

    pullOrdersFromDb();

    const onFocus = () => {
      pullOrdersFromDb();
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        pullOrdersFromDb();
      }
    };

    const onManualRefresh = () => {
      pullOrdersFromDb();
    };

    const onStorage = (event: StorageEvent) => {
      /*
        Eski component'ler bb_orders_v1'e yazarsa DB'yi ezmiyoruz.
        Bunun yerine server'daki gerçek listeyi tekrar çekiyoruz.
      */
      if (!event.key || event.key === LS_ORDERS) {
        pullOrdersFromDb();
      }
    };

    window.addEventListener("focus", onFocus);
    window.addEventListener("storage", onStorage);
    window.addEventListener("bb:refresh-orders", onManualRefresh as EventListener);
    document.addEventListener("visibilitychange", onVisibility);

    intervalId = setInterval(pullOrdersFromDb, REFRESH_MS);

    return () => {
      alive = false;

      if (intervalId) {
        clearInterval(intervalId);
      }

      window.removeEventListener("focus", onFocus);
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("bb:refresh-orders", onManualRefresh as EventListener);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [pathname]);

  return null;
}