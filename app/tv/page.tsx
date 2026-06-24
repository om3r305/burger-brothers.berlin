// app/tv/page.tsx
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { fetchAndApplyRemoteSettings, readSettings } from "@/lib/settings";
import { fetchOrdersFromDb as fetchOrdersFromOrdersCache } from "@/lib/orders";

import type { BrianData } from "@/lib/brian";
import { analyze, brianIsActive, loadBrian, refreshBrian, normalizeStreet } from "@/lib/brian";

import { fetchPause, setPauseRemote, type PauseState } from "@/lib/pause";

/* ───────────────── Brian gate ───────────────── */
const BRIAN_ALLOWED_HOSTS = ["burger-brothers.berlin", "www.burger-brothers.berlin"];
const GO_LIVE_AT = "2025-10-26T00:00:00Z";
const ENABLE_AFTER_DAYS = 30;
const BRIAN_FORCE: "on" | "off" | undefined = undefined;

/* ─────────────── Types ─────────────── */
type OrderStatus =
  | "new"
  | "preparing"
  | "ready"
  | "out_for_delivery"
  | "done"
  | "cancelled";

type OrderMode = "pickup" | "delivery";

type StoredOrderItem = {
  id?: string;
  sku?: string;
  name: string;
  category?: string;
  price: number;
  qty: number;
  add?: { label?: string; name?: string; price?: number }[];
  rm?: string[];
  note?: string;
};

type StoredOrder = {
  id: string;
  orderId?: string;
  ts: number;
  createdAt?: string | null;
  updatedAt?: string | null;
  doneAt?: string | null;
  done_at?: string | null;
  completedAt?: string | null;
  deliveredAt?: string | null;
  mode: OrderMode;
  channel?: string;
  status: OrderStatus;
  planned?: string | null;
  etaMin?: number | null;
  etaAdjustMin?: number | null;
  customer?: Record<string, any>;
  items: StoredOrderItem[];
  meta?: Record<string, any>;
  pricing?: Record<string, any>;
  fees?: Record<string, any>;
  adjustments?: any[];
  merchandise?: number;
  discount?: number;
  surcharges?: number;
  couponDiscount?: number;
  coupon?: string | null;
  total?: number;
  amount?: number;
  payable?: number;
  toPay?: number;
  driver?: any;
  driverName?: string;
  plz?: string | null;
  note?: string;
  orderNote?: string;
  deliveryNote?: string;
  comment?: string;
  comments?: string;
};

type DiscountRow = {
  label: string;
  amount: number;
};

type MinuteCacheEntry = {
  deadlineMs: number;
  etaKey: number;
  plannedKey: string;
};

type TvOrderClockEntry = {
  startMs: number;
  dayKey: string;
  orderId?: string;
};

type TvFirstSeenEntry = {
  firstSeenMs: number;
  dayKey: string;
  orderId?: string;
};

/* ───────────────── Storage keys ───────────────── */
const TV_CLOCK_KEY = "bb_tv_order_clock_v4";
const TV_FIRST_SEEN_KEY = "bb_tv_order_first_seen_v1";
const UNKNOWN_ORDER_GRACE_MS = 6 * 60 * 60 * 1000;
const DONE_LOCK_AFTER_MS = 3 * 60 * 1000;

/* ───────────────── UI classes ───────────────── */
const glass =
  "backdrop-blur-xl bg-white/[0.06] border border-white/15 " +
  "shadow-[inset_0_1px_0_0_rgba(255,255,255,.20)] ring-1 ring-black/10";

const chip =
  "px-2.5 py-1 rounded-full border font-semibold text-[11px] tracking-wide";

const iconBtn =
  "rounded-md border border-white/10 px-2.5 py-1.5 hover:bg-white/10";

/* ───────────────── Labels ───────────────── */
const statusLabel: Record<OrderStatus, string> = {
  new: "Eingegangen",
  preparing: "In Vorbereitung",
  ready: "Abholbereit",
  out_for_delivery: "Unterwegs",
  done: "Abgeschlossen",
  cancelled: "Storniert",
};

function chipColor(status: OrderStatus) {
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
function appTZ(settings: any) {
  return String(settings?.hours?.timezone || settings?.hours?.tz || "Europe/Berlin");
}

const pad2 = (n: number) => (n < 10 ? `0${n}` : String(n));

const formatMinuteValue = (value: number) => {
  const safe = Number.isFinite(Number(value)) ? Math.trunc(Number(value)) : 0;
  const abs = Math.abs(safe);
  return safe < 0 ? `-${pad2(abs)}` : pad2(abs);
};

const num = (value: any) => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value == null) return 0;

  const text = String(value)
    .trim()
    .replace(/[€\s]/g, "")
    .replace(",", ".");

  const match = text.match(/-?\d+(\.\d+)?/);
  return match ? parseFloat(match[0]) : 0;
};

const money = (value: any) => `${num(value).toFixed(2)}€`;

function cleanObj(value: any): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function cleanArr(value: any): any[] {
  return Array.isArray(value) ? value : [];
}

function normalizeStatus(value: any): OrderStatus {
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

function normalizeMode(value: any): OrderMode {
  const text = String(value || "").toLowerCase().trim();

  if (text === "pickup" || text === "abholung" || text === "apollo" || text === "apollon") {
    return "pickup";
  }

  return "delivery";
}

function toMsStrict(value: any): number | null {
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

function orderDateFromId(value: any): number | null {
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

function firstHistoryMs(value: any): number | null {
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

function statusHistoryMs(value: any, status: OrderStatus): number | null {
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

function getOrderExactCreatedMs(
  order: Partial<StoredOrder> | any,
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

function getDoneAtMs(order: Partial<StoredOrder> | any): number | null {
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

function doneLockRemainingMs(order: Partial<StoredOrder> | any, nowMs = Date.now()) {
  if (normalizeStatus(order?.status) !== "done") return 0;

  const doneAt = getDoneAtMs(order);
  if (doneAt == null) return DONE_LOCK_AFTER_MS;

  return Math.max(0, DONE_LOCK_AFTER_MS - (nowMs - doneAt));
}

function isDoneLocked(order: Partial<StoredOrder> | any, nowMs = Date.now()) {
  if (normalizeStatus(order?.status) !== "done") return false;

  const doneAt = getDoneAtMs(order);
  if (doneAt == null) return false;

  return nowMs - doneAt >= DONE_LOCK_AFTER_MS;
}

function doneLockTitle(order: Partial<StoredOrder> | any, nowMs = Date.now()) {
  if (normalizeStatus(order?.status) !== "done") return undefined;
  if (isDoneLocked(order, nowMs)) {
    return "Diese Bestellung ist abgeschlossen und nach 3 Minuten gesperrt.";
  }

  const seconds = Math.ceil(doneLockRemainingMs(order, nowMs) / 1000);
  return seconds > 0
    ? `Änderungen noch ca. ${seconds} Sek. möglich. Danach gesperrt.`
    : undefined;
}

function dayKeyForMs(ms: number, tz: string) {
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

function dayBoundsMs(tz: string) {
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

function readTvClockCache(): Record<string, TvOrderClockEntry> {
  if (typeof window === "undefined") return {};

  try {
    const raw = localStorage.getItem(TV_CLOCK_KEY);
    const parsed = raw ? JSON.parse(raw) : {};

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};

    const out: Record<string, TvOrderClockEntry> = {};

    Object.entries(parsed).forEach(([id, value]: [string, any]) => {
      const startMs = Number(value?.startMs);
      const dayKey = String(value?.dayKey || "");

      if (!id || !Number.isFinite(startMs) || startMs <= 0 || !dayKey) return;

      out[id] = {
        startMs,
        dayKey,
        orderId: value?.orderId ? String(value.orderId) : undefined,
      };
    });

    return out;
  } catch {
    return {};
  }
}

function saveTvClockCache(cache: Record<string, TvOrderClockEntry>) {
  if (typeof window === "undefined") return;

  try {
    localStorage.setItem(TV_CLOCK_KEY, JSON.stringify(cache));
  } catch {}
}

function readTvFirstSeenCache(): Record<string, TvFirstSeenEntry> {
  if (typeof window === "undefined") return {};

  try {
    const raw = localStorage.getItem(TV_FIRST_SEEN_KEY);
    const parsed = raw ? JSON.parse(raw) : {};

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};

    const out: Record<string, TvFirstSeenEntry> = {};

    Object.entries(parsed).forEach(([id, value]: [string, any]) => {
      const firstSeenMs = Number(value?.firstSeenMs);
      const dayKey = String(value?.dayKey || "");

      if (!id || !Number.isFinite(firstSeenMs) || firstSeenMs <= 0 || !dayKey) return;

      out[id] = {
        firstSeenMs,
        dayKey,
        orderId: value?.orderId ? String(value.orderId) : undefined,
      };
    });

    return out;
  } catch {
    return {};
  }
}

function saveTvFirstSeenCache(cache: Record<string, TvFirstSeenEntry>) {
  if (typeof window === "undefined") return;

  try {
    localStorage.setItem(TV_FIRST_SEEN_KEY, JSON.stringify(cache));
  } catch {}
}

function getOrderDayMs(
  order: Partial<StoredOrder> | any,
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

function getOrderStartMs(
  order: Partial<StoredOrder> | any,
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

function normalizeItems(value: any): StoredOrderItem[] {
  return cleanArr(value).map((item, index) => ({
    id: item?.id ? String(item.id) : `${item?.sku || item?.name || "item"}-${index}`,
    sku: item?.sku ? String(item.sku) : undefined,
    name: String(item?.name || item?.title || "Artikel"),
    category: item?.category ? String(item.category) : undefined,
    price: num(item?.price ?? item?.unitPrice),
    qty: Math.max(1, num(item?.qty ?? item?.quantity ?? 1)),
    add: cleanArr(item?.add ?? item?.extras).map((extra: any) => ({
      label: extra?.label ? String(extra.label) : extra?.name ? String(extra.name) : undefined,
      name: extra?.name ? String(extra.name) : undefined,
      price: num(extra?.price),
    })),
    rm: cleanArr(item?.rm ?? item?.remove).map((entry) => String(entry)),
    note: item?.note ? String(item.note) : undefined,
  }));
}

function normalizeOrders(data: any): StoredOrder[] {
  const list = Array.isArray(data)
    ? data
    : Array.isArray(data?.orders)
      ? data.orders
      : Array.isArray(data?.items)
        ? data.items
        : Array.isArray(data?.allOrders)
          ? data.allOrders
          : Array.isArray(data?.doneOrders)
            ? data.doneOrders
            : Array.isArray(data?.data)
              ? data.data
              : Array.isArray(data?.data?.orders)
                ? data.data.orders
                : Array.isArray(data?.data?.items)
                  ? data.data.items
                  : Array.isArray(data?.data?.allOrders)
                    ? data.data.allOrders
                    : Array.isArray(data?.data?.doneOrders)
                      ? data.data.doneOrders
                      : [];

  return list
    .map((raw: any): StoredOrder | null => {
      try {
        const source =
          raw?.order && typeof raw.order === "object"
            ? raw.order
            : raw?.item && typeof raw.item === "object"
              ? raw.item
              : raw?.data && typeof raw.data === "object"
                ? raw.data
                : raw;

        const customer = cleanObj(source?.customer);
        const meta = cleanObj(source?.meta);
        const items = normalizeItems(source?.items);

        const id = String(source?.id || source?.orderId || "").trim();
        if (!id) return null;

        const orderId = String(source?.orderId || id);

        const customerName =
          source?.customerName || customer?.name || customer?.customerName || "";

        const phone = source?.phone || customer?.phone || customer?.telephone || "";

        const addressLine =
          source?.addressLine ||
          customer?.addressLine ||
          customer?.address ||
          [customer?.street, customer?.house || customer?.houseNo].filter(Boolean).join(" ");

        const plz =
          source?.plz ??
          customer?.plz ??
          customer?.zip ??
          customer?.postalCode ??
          null;

        const note =
          source?.note ||
          source?.orderNote ||
          customer?.deliveryHint ||
          customer?.note ||
          meta?.note ||
          meta?.orderNote ||
          "";

        const merchandise =
          num(source?.merchandise) ||
          items.reduce((sum, item) => {
            const extras = (item.add || []).reduce((a, b) => a + num(b?.price), 0);
            return sum + (num(item.price) + extras) * num(item.qty || 1);
          }, 0);

        const discount = num(source?.discount);
        const surcharges = num(source?.surcharges);
        const couponDiscount = num(source?.couponDiscount ?? meta?.couponDiscount);
        const total =
          num(source?.total) ||
          Math.max(0, merchandise + surcharges - discount - couponDiscount);

        const createdAt =
          source?.createdAt ||
          source?.created_at ||
          meta?.createdAt ||
          meta?.created_at ||
          meta?.orderCreatedAt ||
          meta?.submittedAt ||
          null;

        const exactTs =
          getOrderExactCreatedMs(
            {
              ...source,
              id,
              orderId,
              createdAt,
              meta,
            },
            null,
          ) ?? 0;

        return {
          id,
          orderId,
          ts: exactTs,
          createdAt,
          updatedAt: source?.updatedAt || source?.updated_at || null,
          doneAt:
            source?.doneAt ||
            source?.done_at ||
            source?.completedAt ||
            source?.completed_at ||
            source?.deliveredAt ||
            source?.delivered_at ||
            meta?.doneAt ||
            meta?.done_at ||
            meta?.completedAt ||
            meta?.completed_at ||
            meta?.deliveredAt ||
            meta?.delivered_at ||
            null,
          completedAt: source?.completedAt || source?.completed_at || null,
          deliveredAt: source?.deliveredAt || source?.delivered_at || null,
          mode: normalizeMode(source?.mode),
          channel: source?.channel ? String(source.channel) : "web",
          status: normalizeStatus(meta?.statusManual ?? source?.status),
          planned: source?.planned ?? null,
          etaMin: source?.etaMin ?? null,
          etaAdjustMin: source?.etaAdjustMin ?? meta?.etaAdjustMin ?? 0,
          customer: {
            ...customer,
            name: String(customerName || ""),
            phone: String(phone || ""),
            addressLine: String(addressLine || ""),
            address: String(addressLine || ""),
            plz: plz ? String(plz) : null,
            zip: plz ? String(plz) : null,
            deliveryHint: String(note || ""),
          },
          items,
          meta,
          pricing: cleanObj(source?.pricing),
          fees: cleanObj(source?.fees),
          adjustments: cleanArr(source?.adjustments),
          merchandise,
          discount,
          surcharges,
          couponDiscount,
          coupon: source?.coupon ?? meta?.coupon ?? null,
          total,
          driver: source?.driver ?? meta?.driver ?? null,
          driverName: source?.driverName || source?.driver?.name || meta?.driver?.name || "",
          plz: plz ? String(plz) : null,
          note: String(note || ""),
          orderNote: source?.orderNote ? String(source.orderNote) : undefined,
        };
      } catch {
        return null;
      }
    })
    .filter(Boolean) as StoredOrder[];
}

async function fetchOrdersFromTvEndpoint(): Promise<StoredOrder[]> {
  const endpoints = [
    "/api/orders/list?all=1&take=1000",
    "/api/orders/list?take=1000",
    "/api/orders?take=1000",
    "/api/admin/orders?take=1000",
  ];

  const merged = new Map<string, StoredOrder>();
  let lastError: unknown = null;
  let anyResponse = false;

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

      anyResponse = true;

      for (const order of normalizeOrders(data)) {
        const previous = merged.get(order.id);

        if (!previous) {
          merged.set(order.id, order);
          continue;
        }

        const previousTs = getOrderExactCreatedMs(previous, null) ?? previous.ts ?? 0;
        const nextTs = getOrderExactCreatedMs(order, null) ?? order.ts ?? 0;
        const stableTs =
          previousTs > 0 && nextTs > 0
            ? Math.min(previousTs, nextTs)
            : previousTs || nextTs;

        merged.set(order.id, {
          ...previous,
          ...order,
          ts: stableTs || order.ts || previous.ts,
          createdAt: previous.createdAt || order.createdAt || null,
          updatedAt: order.updatedAt || previous.updatedAt || null,
          customer: {
            ...(previous.customer || {}),
            ...(order.customer || {}),
          },
          meta: {
            ...(previous.meta || {}),
            ...(order.meta || {}),
          },
          items: order.items?.length ? order.items : previous.items,
        });
      }
    } catch (error) {
      lastError = error;
    }
  }

  if (merged.size > 0 || anyResponse) return Array.from(merged.values());

  throw lastError instanceof Error ? lastError : new Error("TV_ORDERS_FETCH_FAILED");
}

async function persistStatusToDb(id: string, status: OrderStatus, by = "tv") {
  const primary = await fetch("/api/orders/status", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({
      id,
      status,
      by,
    }),
  });

  const primaryData = await primary.json().catch(() => ({}));

  if (primary.ok && primaryData?.ok !== false) {
    return primaryData;
  }

  const fallback = await fetch("/api/admin/orders", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({
      action: "setStatus",
      id,
      status,
      by,
    }),
  });

  const fallbackData = await fallback.json().catch(() => ({}));

  if (!fallback.ok || fallbackData?.ok === false) {
    throw new Error(
      fallbackData?.error ||
        primaryData?.error ||
        `HTTP ${fallback.status}`,
    );
  }

  return fallbackData;
}

async function persistEtaAdjustToDb(id: string, deltaMin: number, by = "tv") {
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

function findDeliveryFeeDeep(order: any) {
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

function findTipAmountDeep(order: any) {
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

function getOrderTotals(order: StoredOrder): {
  subtotal: number;
  deliveryFee: number;
  serviceFee: number;
  otherFee: number;
  discountSum: number;
  discountItems: DiscountRow[];
  total: number;
} {
  const items = Array.isArray(order?.items) ? order.items : [];
  const pricing = (order as any)?.pricing || {};
  const fees = (order as any)?.fees || {};

  const itemsSum = items.reduce(
    (sum: number, item: any) => sum + num(item.price) * num(item.qty || 1),
    0,
  );

  const subtotal = num(pricing.subtotal) > 0 ? num(pricing.subtotal) : itemsSum;
  const deliveryFee = findDeliveryFeeDeep(order);
  const serviceFee = num(pricing.service ?? fees.service);
  const otherFee = num(pricing.other ?? pricing.misc ?? fees.other);

  let explicitTotal = num(
    pricing.total ??
      (order as any).total ??
      (order as any).amount ??
      (order as any).payable ??
      (order as any).toPay,
  );

  if (explicitTotal <= 0) {
    explicitTotal =
      subtotal + deliveryFee + serviceFee + otherFee - num(pricing.discount ?? fees.discount);
  }

  let discountSum = num(pricing.discount ?? fees.discount ?? (order as any).discount);
  const allFees = deliveryFee + serviceFee + otherFee;
  const derivedDiscount = Math.max(0, subtotal + allFees - explicitTotal);

  if (Math.abs(subtotal + allFees - explicitTotal - discountSum) > 0.01) {
    discountSum = derivedDiscount;
  }

  const discountItems: DiscountRow[] = Array.isArray((order as any)?.adjustments)
    ? (order as any).adjustments
        .filter((a: any) => String(a?.type || "").toLowerCase() === "discount")
        .map((a: any) => ({
          label: [a?.code, a?.reason].filter(Boolean).join(" – ") || a?.source || "Rabatt",
          amount: num(a?.amount),
        }))
    : [];

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

function extractOrderNote(order: any): string {
  const customer = order?.customer || {};
  const meta = order?.meta || {};
  const delivery = order?.delivery || {};
  const addressInfo = customer?.addressInfo || customer?.addresses || {};

  const candidates: any[] = [
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

function plannedStartMs(order: StoredOrder, tz: string) {
  if (!order?.planned) return null;

  const [hh, mm] = String(order.planned)
    .split(":")
    .map((x) => parseInt(x, 10));

  if (Number.isNaN(hh)) return null;

  const base = new Date(new Date().toLocaleString("en-US", { timeZone: tz }));
  const date = new Date(base);

  date.setHours(hh || 0, mm || 0, 0, 0);

  return date.getTime();
}

function etaFor(order: StoredOrder, avgPickup: number, avgDelivery: number) {
  const base = order.etaMin ?? (order.mode === "pickup" ? avgPickup : avgDelivery);
  const adjust = Number(order.etaAdjustMin ?? order.meta?.etaAdjustMin ?? 0);

  return Math.max(1, Number(base) + (Number.isFinite(adjust) ? adjust : 0));
}

function remainingMinutes(
  order: StoredOrder,
  etaMinutes: number,
  tz: string,
  nowMs = Date.now(),
) {
  const planned = plannedStartMs(order, tz);
  const start = planned && planned > nowMs
    ? planned
    : getOrderExactCreatedMs(order, null) ?? order.ts ?? nowMs;

  const end = start + etaMinutes * 60_000;
  const ms = end - nowMs;

  return Math.floor(ms / 60_000);
}

function autoDisplayStatus(
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

function Clock() {
  const [, setTick] = useState(0);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const id = window.setInterval(() => setTick((x) => x + 1), 1000);
    return () => window.clearInterval(id);
  }, []);

  return (
    <span suppressHydrationWarning className="opacity-80">
      {mounted ? new Date().toLocaleString("de-DE") : ""}
    </span>
  );
}

function formatDeliveryLine(order: StoredOrder) {
  const customer = order?.customer || {};
  const direct =
    customer.addressLine ||
    customer.address ||
    (order as any).addressLine ||
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

function brianStreetFromOrder(order: StoredOrder): string {
  const customer = order?.customer || {};
  const raw = String(
    customer.street ||
      customer.addressLine ||
      customer.address ||
      (order as any).addressLine ||
      "",
  );

  const firstPart = raw.split("|")[0] || raw;
  const withoutZip = firstPart.replace(/^\s*\d{5}\s+/, "");

  return normalizeStreet(withoutZip);
}

function getDriverName(order: any): string {
  return (order?.driver && order.driver.name) || order?.driverName || "";
}

function getPaymentKind(order: any): "online" | "cash" | "other" {
  const meta = cleanObj(order?.meta);
  const pricing = cleanObj(order?.pricing);
  const fees = cleanObj(order?.fees);
  const payment = cleanObj(order?.payment);
  const customer = cleanObj(order?.customer);

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

function getPaymentBadge(order: any): {
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

function daysUntilActive(meta: BrianData["meta"] | undefined): number | null {
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

async function updateOrderStatusDbFirst(
  id: string,
  status: OrderStatus,
  by = "tv",
) {
  await persistStatusToDb(id, status, by);
}

function OrderCard({
  o,
  avgPickup,
  avgDelivery,
  tz,
  onOpen,
  onStatus,
  onAdjust,
  onRefresh,
  led,
  clusterDot,
  etaOverride,
  outSince,
  displayLeftMin,
}: {
  o: StoredOrder;
  avgPickup: number;
  avgDelivery: number;
  tz: string;
  onOpen: () => void;
  onStatus: (status: OrderStatus) => void | Promise<void>;
  onAdjust: (deltaMin: number) => void | Promise<void>;
  onRefresh: () => void;
  led: "green" | "red" | "gray";
  clusterDot?: string | null;
  etaOverride?: number | null;
  outSince?: number | null;
  displayLeftMin?: number | null;
}) {
  const effectiveEta = etaOverride ?? etaFor(o, avgPickup, avgDelivery);
  const rawLeftMin = remainingMinutes(o, effectiveEta, tz);
  const leftMin = displayLeftMin ?? rawLeftMin;
  const plannedMs = plannedStartMs(o, tz);
  const plannedFuture = !!plannedMs && plannedMs > Date.now();
  const driverName = getDriverName(o);
  const isFinal = o.status === "done" || o.status === "cancelled";
  const doneLocked = isDoneLocked(o);
  const lockedTitle = doneLockTitle(o);
  const disabledActionClass = doneLocked ? "cursor-not-allowed opacity-40 hover:bg-transparent" : "";
  const paymentBadge = getPaymentBadge(o);

  const modeChip =
    o.mode === "pickup"
      ? "border-cyan-400/60 bg-cyan-500/15 text-cyan-200"
      : "border-orange-400/60 bg-orange-500/15 text-orange-200";

  const addressLine = o.mode === "delivery" ? formatDeliveryLine(o) : "";

  const ledColor =
    led === "green" ? "#22c55e" : led === "red" ? "#ef4444" : "#94a3b8";

  const timeClass =
    !plannedFuture && !isFinal
      ? leftMin <= 10
        ? "tv-minutes tv-minutes--crit"
        : leftMin <= 20
          ? "tv-minutes tv-minutes--warn"
          : "tv-minutes"
      : "tv-minutes";

  const startTime = outSince ?? o.ts;

  return (
    <div className={`relative rounded-2xl p-4 ${glass}`}>
      <span
        className="absolute right-2 top-2 h-5 w-5 rounded-full ring-2 ring-stone-900"
        style={{ backgroundColor: ledColor }}
        title={led.toUpperCase()}
      />

      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className={`${chip} ${modeChip}`}>
            {o.mode === "pickup" ? "Abholung" : "Lieferung"}
          </span>

          {plannedFuture && (
            <span className={`${chip} border-amber-400/60 bg-amber-500/15 text-amber-100`}>
              Geplant {o.planned}
            </span>
          )}
        </div>

        {o.status === "out_for_delivery" && startTime && (
          <div className="ml-auto mt-1 text-[11px] font-medium text-stone-400">
            {(() => {
              const since = Math.floor((Date.now() - startTime) / 60000);
              if (since < 1) return "Gerade eben";
              if (since < 60) return `vor ${since} Min`;
              const h = Math.floor(since / 60);
              const m = since % 60;
              return m > 0 ? `vor ${h} Std ${m} Min` : `vor ${h} Std`;
            })()}
          </div>
        )}

        <div className="flex items-center gap-2">
          {driverName && (o.status === "out_for_delivery" || o.status === "done") && (
            <span className={`${chip} border-indigo-300/60 bg-indigo-400/15 text-indigo-100`}>
              Fahrer: {driverName}
            </span>
          )}

          <span className={`${chip} ${chipColor(o.status || "new")}`}>
            {statusLabel[o.status || "new"]}
          </span>
        </div>
      </div>

      {!isFinal && (
        <div className="mt-3 flex items-end justify-between">
          <div className={timeClass} aria-live="polite">
            {plannedFuture ? (
              <span>{o.planned!.split(":").map((n) => pad2(+n || 0)).join(":")}</span>
            ) : (
              <span>{formatMinuteValue(leftMin)}</span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button className={iconBtn} onClick={() => onAdjust(-5)} title="-5 Min">
              −5′
            </button>
            <button className={iconBtn} onClick={() => onAdjust(+5)} title="+5 Min">
              +5′
            </button>
          </div>
        </div>
      )}

      {o.mode === "delivery" && addressLine && (
        <div className="mt-3 flex items-center gap-2 text-lg font-semibold">
          {addressLine}
          {clusterDot && (
            <span
              className="inline-block h-3.5 w-3.5 rounded-full"
              style={{ backgroundColor: clusterDot }}
              title="Brian group"
            />
          )}
        </div>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <span className={`${chip} ${paymentBadge.className}`}>
          <span className="mr-1" aria-hidden="true">
            {paymentBadge.icon}
          </span>
          {paymentBadge.label}
        </span>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {o.mode === "pickup" ? (
          <>
            <button
              className={`btn-ghost ${disabledActionClass}`}
              disabled={doneLocked}
              title={lockedTitle}
              onClick={() => !doneLocked && onStatus("preparing")}
            >
              In Vorbereitung
            </button>
            <button
              className={`btn-ghost ${disabledActionClass}`}
              disabled={doneLocked}
              title={lockedTitle}
              onClick={() => !doneLocked && onStatus("ready")}
            >
              Abholbereit
            </button>
            <button
              className={`card-cta ${disabledActionClass}`}
              disabled={doneLocked}
              title={lockedTitle}
              onClick={() => !doneLocked && onStatus("done")}
            >
              Abgeschlossen
            </button>
          </>
        ) : (
          <>
            <button
              className={`btn-ghost ${disabledActionClass}`}
              disabled={doneLocked}
              title={lockedTitle}
              onClick={() => !doneLocked && onStatus("preparing")}
            >
              In Vorbereitung
            </button>
            <button
              className={`btn-ghost ${disabledActionClass}`}
              disabled={doneLocked}
              onClick={() => !doneLocked && onStatus("out_for_delivery")}
              title={lockedTitle || "Wird nach Fahrer-QR genutzt"}
            >
              Unterwegs
            </button>
            <button
              className={`card-cta ${disabledActionClass}`}
              disabled={doneLocked}
              title={lockedTitle}
              onClick={() => !doneLocked && onStatus("done")}
            >
              Abgeschlossen
            </button>
          </>
        )}

        {o.status === "out_for_delivery" && driverName ? (
          <button
            className="btn-ghost"
            onClick={async () => {
              await onStatus("preparing");
              onRefresh();
            }}
            title="Fahrer entfernen"
          >
            Fahrer entfernen
          </button>
        ) : null}

        <button className="btn-ghost ml-auto" onClick={onOpen}>
          Details
        </button>
      </div>
    </div>
  );
}

/* ─────────────── Printing ─────────────── */
async function silentPrint(order: StoredOrder) {
  try {
    const proxy =
      (typeof window !== "undefined" &&
        (localStorage.getItem("bb_print_proxy_url") || "")) ||
      "https://www.burger-brothers.berlin";

    const res = await fetch(`${proxy}/print/full`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        order,
        options: {
          paper: "80mm",
          copies: 1,
          maskName: true,
          maskPhone: true,
        },
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Proxy ${res.status}: ${text}`);
    }

    alert("🖨️ Druckauftrag gesendet.");
  } catch (error: any) {
    console.error(error);
    alert(
      `Drucken fehlgeschlagen: ${error?.message || error}\n` +
        `• Läuft der print-proxy?\n` +
        `• Firewall/CORS blockiert?\n` +
        `• bb_print_proxy_url korrekt?`,
    );
  }
}

export default function TVPage() {
  const router = useRouter();

  useEffect(() => {
    const hasUi = document.cookie
      .split("; ")
      .some((cookie) => cookie.trim().startsWith("bb_tv_ui=1"));

    if (!hasUi) {
      router.replace("/tv/login?next=/tv");
      return;
    }

    try {
      if (sessionStorage.getItem("bb_tv_tab") !== "1") {
        sessionStorage.setItem("bb_tv_tab", "1");
      }
    } catch {}
  }, [router]);

  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const [settingsTick, setSettingsTick] = useState(0);

  useEffect(() => {
    let stopped = false;

    const refreshSettings = async () => {
      try {
        await fetchAndApplyRemoteSettings();
      } catch {}

      if (!stopped) {
        setSettingsTick((x) => x + 1);
      }
    };

    refreshSettings();

    const onFocus = () => refreshSettings();
    const onVisibility = () => {
      if (document.visibilityState === "visible") refreshSettings();
    };
    const onSettings = () => setSettingsTick((x) => x + 1);

    window.addEventListener("focus", onFocus);
    window.addEventListener("bb_settings_changed", onSettings as EventListener);
    window.addEventListener("bb:settings-sync", onSettings as EventListener);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      stopped = true;
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("bb_settings_changed", onSettings as EventListener);
      window.removeEventListener("bb:settings-sync", onSettings as EventListener);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  const [orders, setOrders] = useState<StoredOrder[]>([]);
  const [sel, setSel] = useState<StoredOrder | null>(null);

  type View = "incoming" | "onroad" | "finished";
  const [view, setView] = useState<View>("incoming");

  const [leftOpen, setLeftOpen] = useState(false);

  const [pause, setPause] = useState<PauseState>({ delivery: false, pickup: false });
  const [brianData, setBrianData] = useState<BrianData | null>(null);

  const [etaOverrides, setEtaOverrides] = useState<Record<string, number>>({});
  const [outSince, setOutSince] = useState<Record<string, number>>({});
  const minuteCacheRef = useRef<Record<string, MinuteCacheEntry>>({});
  const orderClockRef = useRef<Record<string, TvOrderClockEntry>>({});

  useEffect(() => {
    orderClockRef.current = readTvClockCache();
  }, []);

  useEffect(() => {
    let active = true;

    const load = () => {
      loadBrian()
        .then((data) => {
          if (active) setBrianData(data);
        })
        .catch(() => {
          if (active) setBrianData({ clusters: [], pairs: [], meta: {} } as any);
        });
    };

    load();

    const id = window.setInterval(load, 30_000);

    return () => {
      active = false;
      window.clearInterval(id);
    };
  }, []);

  const settings = useMemo(() => readSettings() as any, [settingsTick]);
  const tz = appTZ(settings);
  const avgPickup = Number(settings?.hours?.avgPickupMinutes ?? 15);
  const avgDelivery = Number(settings?.hours?.avgDeliveryMinutes ?? 35);
  const newGraceMin = Math.max(0, Number(settings?.hours?.newGraceMinutes ?? 5));

  useEffect(() => {
    let active = true;

    fetchPause()
      .then((state) => {
        if (active) setPause(state);
      })
      .catch(() => {});

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const onEsc = (event: KeyboardEvent) => {
      if (event.key === "Escape") setLeftOpen(false);
    };

    window.addEventListener("keydown", onEsc);
    return () => window.removeEventListener("keydown", onEsc);
  }, []);

  const host = typeof window !== "undefined" ? window.location.host : undefined;

  const gateOn = useMemo(
    () =>
      brianIsActive(brianData?.meta, {
        host,
        allowedHosts: BRIAN_ALLOWED_HOSTS,
        goLiveAt: GO_LIVE_AT,
        enableAfterDays: ENABLE_AFTER_DAYS,
        force: BRIAN_FORCE,
      }),
    [host, brianData],
  );

  const daysLeft = useMemo(() => daysUntilActive(brianData?.meta), [brianData]);

  const getStableLeftMin = useCallback(
    (order: StoredOrder, etaOverride?: number | null) => {
      const effectiveEta = etaOverride ?? etaFor(order, avgPickup, avgDelivery);
      const etaKey = Number(effectiveEta || 0);
      const plannedMs = plannedStartMs(order, tz);
      const plannedFuture = !!plannedMs && plannedMs > nowMs;
      const isFinal = order.status === "done" || order.status === "cancelled";
      const plannedKey = String(order.planned || "");
      const raw = remainingMinutes(order, effectiveEta, tz, nowMs);

      if (plannedFuture || isFinal) {
        delete minuteCacheRef.current[order.id];
        return raw;
      }

      const previous = minuteCacheRef.current[order.id];
      const clock = orderClockRef.current[order.id];

      const startMs =
        plannedMs && plannedMs > nowMs
          ? plannedMs
          : getOrderStartMs(order, orderClockRef.current, null) ?? nowMs;

      const calculatedDeadlineMs = startMs + Math.max(1, etaKey) * 60_000;
      const fallbackDeadlineMs = nowMs + raw * 60_000;
      const nextDeadlineMs = Number.isFinite(calculatedDeadlineMs)
        ? calculatedDeadlineMs
        : fallbackDeadlineMs;

      /*
        Stabiler TV-Timer:
        - Timer startı localStorage'da order id bazlı tutulur.
        - Sayfa yenilenince 10 dakika kalan sipariş tekrar 15'e dönmez.
        - Server/cache deadline'ı ileri itemez.
        - 00 sonrası -01, -02 diye devam eder.
        - +5/-5 bilinçli değişikliktir; cache temizlenir.
      */
      if (!previous || previous.plannedKey !== plannedKey || previous.etaKey !== etaKey) {
        const safeDeadline =
          clock?.startMs && Number.isFinite(clock.startMs)
            ? clock.startMs + Math.max(1, etaKey) * 60_000
            : nextDeadlineMs;

        minuteCacheRef.current[order.id] = {
          deadlineMs: safeDeadline,
          etaKey,
          plannedKey,
        };

        return Math.floor((safeDeadline - nowMs) / 60_000);
      }

      const stableDeadlineMs = Math.min(previous.deadlineMs, nextDeadlineMs);

      minuteCacheRef.current[order.id] = {
        ...previous,
        deadlineMs: stableDeadlineMs,
      };

      return Math.floor((stableDeadlineMs - nowMs) / 60_000);
    },
    [avgPickup, avgDelivery, nowMs, tz],
  );

  const refresh = useCallback(async () => {
    try {
      const endpointOrders = await fetchOrdersFromTvEndpoint();

      let sharedOrders: StoredOrder[] = [];

      try {
        const sharedRaw = (await fetchOrdersFromOrdersCache()) as unknown;
        sharedOrders = normalizeOrders(sharedRaw);
      } catch (error) {
        console.warn("TV shared order source failed", error);
      }

      const merged = new Map<string, StoredOrder>();

      /*
        TV order source:
        - Endpoint/DB is the main source.
        - Shared cache is added because new orders can appear there before all DB/list endpoints agree.
        - For duplicate IDs, the oldest reliable timestamp is kept so refresh cannot reset ETA.
      */
      [...endpointOrders, ...sharedOrders].forEach((order) => {
        const previous = merged.get(order.id);

        if (!previous) {
          merged.set(order.id, order);
          return;
        }

        const previousTs =
          getOrderExactCreatedMs(previous, null) ??
          getOrderStartMs(previous, orderClockRef.current, null) ??
          previous.ts ??
          0;

        const nextTs =
          getOrderExactCreatedMs(order, null) ??
          getOrderStartMs(order, orderClockRef.current, null) ??
          order.ts ??
          0;

        const stableTs =
          previousTs > 0 && nextTs > 0
            ? Math.min(previousTs, nextTs)
            : previousTs || nextTs;

        merged.set(order.id, {
          ...previous,
          ...order,
          ts: stableTs || order.ts || previous.ts,
          createdAt: previous.createdAt || order.createdAt || null,
          updatedAt: order.updatedAt || previous.updatedAt || null,
          customer: {
            ...(previous.customer || {}),
            ...(order.customer || {}),
          },
          meta: {
            ...(previous.meta || {}),
            ...(order.meta || {}),
          },
          items: order.items?.length ? order.items : previous.items,
        });
      });

      const all = Array.from(merged.values());

      const advanced = all.map((order) => ({
        ...order,
        status: autoDisplayStatus(order, avgPickup, avgDelivery, newGraceMin, tz),
      }));

      const { start, end, key: todayKey } = dayBoundsMs(tz);
      const now = Date.now();

      const currentClock = {
        ...orderClockRef.current,
        ...readTvClockCache(),
      };

      const firstSeenCache = readTvFirstSeenCache();

      const nextClock: Record<string, TvOrderClockEntry> = {};
      const nextFirstSeen: Record<string, TvFirstSeenEntry> = {};

      const today = advanced.filter((order) => {
        const id = String(order.id || "");
        if (!id) return false;

        const idDayMs = orderDateFromId(order.orderId || order.id);
        const exactMs = getOrderExactCreatedMs(order, null);
        const cachedClock = currentClock[id];
        const cachedSeen = firstSeenCache[id];

        const isFinal = order.status === "done" || order.status === "cancelled";
        const isActive = !isFinal;

        /*
          TV daily logic:
          - If the order ID contains ORD-YYYYMMDD, that date wins.
          - Otherwise use real createdAt/history/ts.
          - If the order has no reliable date but is active, TV may accept it as "new today"
            and freeze its first seen time.
          - planned is only HH:mm; it never brings old orders into today by itself.
        */
        let dayMs: number | null = idDayMs ?? exactMs ?? null;

        if (dayMs == null && cachedClock?.dayKey === todayKey && cachedClock?.startMs > 0) {
          dayMs = cachedClock.startMs;
        }

        if (dayMs == null && cachedSeen?.dayKey === todayKey && cachedSeen?.firstSeenMs > 0) {
          dayMs = cachedSeen.firstSeenMs;
        }

        if (dayMs == null && isActive) {
          const firstSeenMs = now;

          dayMs = firstSeenMs;

          nextFirstSeen[id] = {
            firstSeenMs,
            dayKey: todayKey,
            orderId: order.orderId || order.id,
          };
        } else if (cachedSeen?.dayKey === todayKey && cachedSeen?.firstSeenMs > 0) {
          nextFirstSeen[id] = cachedSeen;
        }

        if (dayMs == null || !Number.isFinite(dayMs)) return false;
        if (dayMs < start || dayMs > end) return false;

        const hasReliableDate = idDayMs != null || exactMs != null;
        const firstSeenMs =
          nextFirstSeen[id]?.firstSeenMs ??
          cachedSeen?.firstSeenMs ??
          cachedClock?.startMs ??
          dayMs;

        if (!hasReliableDate && now - firstSeenMs > UNKNOWN_ORDER_GRACE_MS) {
          return false;
        }

        const cachedSameDay = cachedClock?.dayKey === todayKey && cachedClock?.startMs > 0;

        const startMs =
          exactMs ??
          (cachedSameDay ? cachedClock.startMs : null) ??
          nextFirstSeen[id]?.firstSeenMs ??
          cachedSeen?.firstSeenMs ??
          now;

        nextClock[id] = {
          startMs,
          dayKey: todayKey,
          orderId: order.orderId || order.id,
        };

        if (!nextFirstSeen[id]) {
          nextFirstSeen[id] = {
            firstSeenMs: startMs,
            dayKey: todayKey,
            orderId: order.orderId || order.id,
          };
        }

        return true;
      });

      orderClockRef.current = nextClock;
      saveTvClockCache(nextClock);
      saveTvFirstSeenCache(nextFirstSeen);

      setOrders(today);

      minuteCacheRef.current = Object.fromEntries(
        Object.entries(minuteCacheRef.current).filter(([id]) =>
          today.some((order) => order.id === id),
        ),
      );

      setOutSince((prev) => {
        const next: Record<string, number> = { ...prev };

        today.forEach((order) => {
          if (order.status === "out_for_delivery") {
            if (!next[order.id]) {
              next[order.id] =
                prev[order.id] ??
                getOrderStartMs(order, nextClock, order.ts) ??
                order.ts;
            }
          } else if (next[order.id]) {
            delete next[order.id];
          }
        });

        return next;
      });
    } catch (error) {
      console.error("TV refresh failed", error);
    }
  }, [avgPickup, avgDelivery, newGraceMin, tz]);

  useEffect(() => {
    void refresh();

    const id = window.setInterval(() => {
      void refresh();
    }, 5000);

    const onRefreshOrders = () => {
      void refresh();
    };

    window.addEventListener("bb:refresh-orders", onRefreshOrders as EventListener);

    return () => {
      window.clearInterval(id);
      window.removeEventListener("bb:refresh-orders", onRefreshOrders as EventListener);
    };
  }, [refresh]);

  const tabStats = useMemo(() => {
    const incoming = orders.filter((order) => {
      const pickupReady = order.mode === "pickup" && order.status === "ready";

      return (
        order.status !== "done" &&
        order.status !== "cancelled" &&
        order.status !== "out_for_delivery" &&
        !pickupReady
      );
    }).length;

    const onroad = orders.filter(
      (order) =>
        order.status === "out_for_delivery" ||
        (order.mode === "pickup" && order.status === "ready"),
    ).length;

    const finished = orders.filter(
      (order) => order.status === "done" || order.status === "cancelled",
    ).length;

    return {
      incoming,
      onroad,
      finished,
    };
  }, [orders]);

  const filtered = useMemo(() => {
    return orders
      .filter((order) => {
        const pickupReady = order.mode === "pickup" && order.status === "ready";

        if (view === "incoming") {
          return (
            order.status !== "done" &&
            order.status !== "cancelled" &&
            order.status !== "out_for_delivery" &&
            !pickupReady
          );
        }

        if (view === "onroad") {
          return order.status === "out_for_delivery" || pickupReady;
        }

        return order.status === "done" || order.status === "cancelled";
      })
      .sort((a, b) => {
        const aStart = getOrderStartMs(a, orderClockRef.current, a.ts) ?? a.ts ?? 0;
        const bStart = getOrderStartMs(b, orderClockRef.current, b.ts) ?? b.ts ?? 0;
        return bStart - aStart;
      });
  }, [orders, view]);

  const handleAdjust = async (order: StoredOrder, delta: number) => {
    const previous = etaOverrides[order.id];
    const base = previous ?? etaFor(order, avgPickup, avgDelivery);
    const next = Math.max(1, Math.min(base + delta, (order.etaMin ?? base) + 60, 240));

    delete minuteCacheRef.current[order.id];

    setEtaOverrides((prev) => ({
      ...prev,
      [order.id]: next,
    }));

    try {
      await persistEtaAdjustToDb(order.id, delta, "tv");
      await refresh();
    } catch (error) {
      console.error("ETA update failed", error);

      setEtaOverrides((prev) => {
        const copy = { ...prev };

        if (previous == null) {
          delete copy[order.id];
        } else {
          copy[order.id] = previous;
        }

        return copy;
      });

      alert("ETA konnte nicht gespeichert werden.");
    }
  };

  const selectedDoneLocked = sel ? isDoneLocked(sel, nowMs) : false;
  const selectedDoneLockTitle = sel ? doneLockTitle(sel, nowMs) : undefined;

  return (
    <main
      className={
        "relative mx-auto max-w-7xl space-y-6 p-4 text-stone-100 sm:p-6 " +
        "antialiased [text-rendering:optimizeLegibility] [font-feature-settings:'liga','kern']"
      }
    >
      <div className="pointer-events-none fixed inset-0 -z-10 select-none">
        <div className="absolute inset-0 bg-[radial-gradient(1200px_700px_at_10%_-10%,rgba(59,130,246,.18),transparent),radial-gradient(1000px_600px_at_90%_0%,rgba(16,185,129,.14),transparent),linear-gradient(180deg,#0b0f14_0%,#0f1318_50%,#0a0d11_100%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(80%_80%_at_50%_20%,transparent,rgba(0,0,0,.45))]" />
      </div>

      <header className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button className={`${iconBtn} mr-1`} onClick={() => setLeftOpen(true)} title="Menü">
            ☰
          </button>

          <div className="flex items-center gap-2">
            <img src="/logo-burger-brothers.png" className="h-14 w-14" alt="Logo" />
            <div className="text-2xl font-bold">Burger Brothers</div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Clock />

          <button
            onClick={async () => {
              try {
                await fetch("/api/tv/logout", { method: "POST" });
              } catch {}

              try {
                sessionStorage.removeItem("bb_tv_tab");
              } catch {}

              router.replace("/tv/login");
            }}
            title="Abmelden"
            className={iconBtn}
          >
            ⏻ Abmelden
          </button>
        </div>
      </header>

      {(pause.delivery || pause.pickup) && (
        <div className="rounded-xl border border-amber-400/40 bg-amber-500/15 p-3 text-sm text-amber-100">
          {pause.delivery && (
            <div>
              Aufgrund hoher Auslastung ist <b>Lieferung</b> vorübergehend pausiert.
            </div>
          )}

          {pause.pickup && (
            <div>
              Aufgrund hoher Auslastung ist <b>Abholung</b> vorübergehend pausiert.
            </div>
          )}
        </div>
      )}

      <section className="flex items-center gap-2">
        <button
          onClick={() => setView("incoming")}
          className={`rounded-full border border-white/10 px-4 py-1.5 ${
            view === "incoming" ? "bg-white/10 font-semibold" : "opacity-70"
          }`}
        >
          Neu {tabStats.incoming}
        </button>

        <button
          onClick={() => setView("onroad")}
          className={`rounded-full border border-white/10 px-4 py-1.5 ${
            view === "onroad" ? "bg-white/10 font-semibold" : "opacity-70"
          }`}
        >
          Unterwegs {tabStats.onroad}
        </button>

        <button
          onClick={() => setView("finished")}
          className={`rounded-full border border-white/10 px-4 py-1.5 ${
            view === "finished" ? "bg-white/10 font-semibold" : "opacity-70"
          }`}
        >
          Fertig {tabStats.finished}
        </button>

        {daysLeft != null && daysLeft > 0 && (
          <span className="ml-auto text-xs text-stone-400">
            Brian aktiv in {daysLeft} Tagen
          </span>
        )}
      </section>

      <section className="grid grid-cols-1 gap-4">
        {filtered.length === 0 ? (
          <div className="text-sm text-stone-400">Keine Einträge.</div>
        ) : (
          filtered.map((order) => {
            const peers = filtered
              .filter((item) => item.id !== order.id && item.mode === "delivery")
              .map((item) => item.customer?.address || item.customer?.addressLine || "")
              .map(normalizeStreet);

            const result =
              order.mode === "delivery"
                ? analyze(
                    order.customer?.address || order.customer?.addressLine || "",
                    peers,
                    brianData,
                    gateOn,
                  )
                : { led: "gray" as const, clusterColor: undefined };

            return (
              <OrderCard
                key={order.id}
                o={order}
                avgPickup={avgPickup}
                avgDelivery={avgDelivery}
                tz={tz}
                onOpen={() => setSel(order)}
                onStatus={async (status) => {
                  if (isDoneLocked(order)) {
                    alert("Diese Bestellung ist abgeschlossen und nach 3 Minuten gesperrt.");
                    return;
                  }

                  if (status === "out_for_delivery") {
                    setOutSince((prev) => ({
                      ...prev,
                      [order.id]: Date.now(),
                    }));

                    try {
                      const primaryStreet = brianStreetFromOrder(order);

                      const streets = Array.from(
                        new Set<string>(
                          filtered
                            .filter(
                              (item) =>
                                item.mode === "delivery" &&
                                (item.id === order.id || item.status === "out_for_delivery"),
                            )
                            .map(brianStreetFromOrder)
                            .filter((street): street is string => Boolean(street)),
                        ),
                      );

                      const peerStreets = streets.filter((street) => street !== primaryStreet);

                      if (streets.length > 0) {
                        const learnRes = await fetch("/api/brian/learn", {
                          method: "POST",
                          headers: {
                            "content-type": "application/json",
                            accept: "application/json",
                          },
                          body: JSON.stringify({
                            occurredAt: new Date().toISOString(),
                            mode: "delivery",
                            orderId: order.orderId || order.id,
                            primaryStreet: primaryStreet || streets[0],
                            streets,
                            peerStreets,
                            status: "out_for_delivery",
                            source: "tv_out_for_delivery",
                            driverId:
                              (order.driver && order.driver.id) ||
                              order.meta?.driverId ||
                              order.driverName ||
                              "",
                            driverName: getDriverName(order),
                          }),
                        });

                        const learnData = await learnRes.json().catch(() => ({}));

                        if (!learnRes.ok || learnData?.ok === false) {
                          throw new Error(learnData?.error || `Brian learn HTTP ${learnRes.status}`);
                        }

                        await fetch("/api/brian/export", {
                          method: "POST",
                          headers: {
                            accept: "application/json",
                          },
                          cache: "no-store",
                        }).catch(() => {});

                        refreshBrian()
                          .then(setBrianData)
                          .catch(() => {});
                      }
                    } catch (error) {
                      console.error("brian.learn failed", error);
                    }
                  } else if (order.status === "out_for_delivery") {
                    setOutSince((prev) => {
                      const next = { ...prev };
                      delete next[order.id];
                      return next;
                    });
                  }

                  await updateOrderStatusDbFirst(order.id, status, "tv");
                  await refresh();
                }}
                onAdjust={(delta) => {
                  void handleAdjust(order, delta);
                }}
                onRefresh={() => void refresh()}
                led={result.led}
                clusterDot={result.clusterColor}
                etaOverride={etaOverrides[order.id]}
                outSince={outSince[order.id]}
                displayLeftMin={getStableLeftMin(order, etaOverrides[order.id])}
              />
            );
          })
        )}
      </section>

      {sel && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          onClick={() => setSel(null)}
        >
          <div
            className={`max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl p-5 ${glass}`}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <div className="text-xl font-semibold">
                #{sel.id} • {sel.mode === "pickup" ? "Abholung" : "Lieferung"}
              </div>

              <button className="btn-ghost" onClick={() => setSel(null)}>
                Schließen
              </button>
            </div>

            <div className="space-y-1 text-sm text-stone-300/90">
              <div>
                <b>Zeit:</b>{" "}
                {new Date(
                  getOrderStartMs(sel, orderClockRef.current, sel.ts) || sel.ts,
                ).toLocaleString("de-DE")}
              </div>

              {sel.planned && (
                <div>
                  <b>Geplant:</b> {sel.planned} heute
                </div>
              )}

              <div>
                <b>Kunde:</b> {sel.customer?.name} • {sel.customer?.phone || "-"}
              </div>

              {sel.mode === "delivery" && formatDeliveryLine(sel) && (
                <div>
                  <b>Adresse:</b> {formatDeliveryLine(sel)}
                </div>
              )}

              {getDriverName(sel) && (
                <div>
                  <b>Fahrer:</b> {getDriverName(sel)}
                </div>
              )}
            </div>

            <div className="mt-4">
              <div className="mb-1 font-medium">Artikel</div>

              <div className="overflow-hidden rounded-lg border border-white/10">
                <table className="w-full text-sm">
                  <thead className="bg-white/5 text-stone-300">
                    <tr>
                      <th className="p-2 text-left">Name</th>
                      <th className="p-2 text-right">Menge</th>
                      <th className="p-2 text-right">Summe</th>
                    </tr>
                  </thead>

                  <tbody>
                    {sel.items.map((item: any, index: number) => {
                      const extras = Array.isArray(item.add)
                        ? item.add.reduce((total: number, extra: any) => total + num(extra?.price), 0)
                        : 0;

                      return (
                        <tr key={index} className="border-t border-white/5 align-top">
                          <td className="p-2">
                            <div>{item.name}</div>

                            {item.note && (
                              <div className="mt-0.5 text-xs text-stone-300">
                                {String(item.note)}
                              </div>
                            )}

                            {Array.isArray(item.add) && item.add.length > 0 && (
                              <div className="text-xs text-stone-400">
                                Extras:{" "}
                                {item.add
                                  .map((a: any) => a?.label || a?.name)
                                  .filter(Boolean)
                                  .join(", ")}
                              </div>
                            )}

                            {Array.isArray(item.rm) && item.rm.length > 0 && (
                              <div className="text-xs text-stone-400">
                                Ohne: {item.rm.join(", ")}
                              </div>
                            )}
                          </td>

                          <td className="p-2 text-right">{item.qty}</td>

                          <td className="p-2 text-right">
                            {((num(item.price) + extras) * num(item.qty || 1)).toFixed(2)}€
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {extractOrderNote(sel) && (
              <div className="mt-4 rounded-xl border border-white/10 p-3 text-sm">
                <div className="mb-1 font-medium">Bestellhinweis</div>
                <div className="whitespace-pre-wrap text-stone-200">
                  {extractOrderNote(sel)}
                </div>
              </div>
            )}

            {(() => {
              const totals = getOrderTotals(sel);
              const pickupTip = sel.mode === "pickup" ? findTipAmountDeep(sel) : 0;

              return (
                <div className="mt-4 overflow-hidden rounded-xl border border-white/10">
                  <table className="w-full text-sm">
                    <tbody>
                      <tr className="border-b border-white/10">
                        <td className="p-2">Warenwert</td>
                        <td className="p-2 text-right">{money(totals.subtotal)}</td>
                      </tr>

                      {totals.deliveryFee ? (
                        <tr className="border-b border-white/10">
                          <td className="p-2">Lieferaufschläge</td>
                          <td className="p-2 text-right">{money(totals.deliveryFee)}</td>
                        </tr>
                      ) : null}

                      {totals.serviceFee ? (
                        <tr className="border-b border-white/10">
                          <td className="p-2">Service</td>
                          <td className="p-2 text-right">{money(totals.serviceFee)}</td>
                        </tr>
                      ) : null}

                      {totals.otherFee ? (
                        <tr className="border-b border-white/10">
                          <td className="p-2">Sonstiges</td>
                          <td className="p-2 text-right">{money(totals.otherFee)}</td>
                        </tr>
                      ) : null}

                      <tr className="border-b border-white/10">
                        <td className="p-2">Rabatte</td>
                        <td className="p-2 text-right">
                          {totals.discountSum ? `-${money(totals.discountSum)}` : money(0)}
                        </td>
                      </tr>

                      {totals.discountItems.map((discount, index) => (
                        <tr key={index} className="border-b border-white/10 text-stone-300/90">
                          <td className="p-2 pl-6">- {discount.label}</td>
                          <td className="p-2 text-right">-{money(discount.amount)}</td>
                        </tr>
                      ))}

                      {pickupTip > 0 ? (
                        <tr className="border-b border-white/10">
                          <td className="p-2">Trinkgeld</td>
                          <td className="p-2 text-right">{money(pickupTip)}</td>
                        </tr>
                      ) : null}

                      <tr>
                        <td className="p-2 font-semibold">Gesamt</td>
                        <td className="p-2 text-right font-semibold">{money(totals.total)}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              );
            })()}

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <button
                className="card-cta"
                onClick={() => silentPrint(sel)}
                title="Über Print-Proxy drucken"
              >
                🖨️ Drucken
              </button>

              <a
                className="btn-ghost"
                href={`/print/barcode/${encodeURIComponent(sel.id)}?print=1`}
                target="_blank"
                rel="noreferrer"
                title="PDF/Print-Seite öffnen"
              >
                PDF öffnen
              </a>

              <button
                className={`ml-auto rounded-md border border-rose-400/60 bg-rose-500/20 px-3 py-1.5 text-rose-100 hover:bg-rose-500/30 ${
                  selectedDoneLocked ? "cursor-not-allowed opacity-40 hover:bg-rose-500/20" : ""
                }`}
                disabled={selectedDoneLocked}
                title={selectedDoneLockTitle}
                onClick={async () => {
                  if (selectedDoneLocked) {
                    alert("Diese Bestellung ist abgeschlossen und nach 3 Minuten gesperrt.");
                    return;
                  }

                  const ok = confirm(`Bestellung #${sel.id} stornieren?`);
                  if (!ok) return;

                  await updateOrderStatusDbFirst(sel.id, "cancelled", "tv");
                  setSel(null);
                  await refresh();
                }}
              >
                🛑 Stornieren
              </button>
            </div>
          </div>
        </div>
      )}

      {leftOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50"
          onClick={() => setLeftOpen(false)}
          role="dialog"
          aria-modal="true"
        >
          <div
            className={`absolute left-0 top-0 h-full w-[320px] p-4 ${glass}`}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <div className="text-lg font-semibold">Bestellübersicht</div>
              <button className="btn-ghost" onClick={() => setLeftOpen(false)}>
                Schließen
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <div className="mb-1 text-xs uppercase tracking-wider text-stone-300/70">
                  Zusammenfassung
                </div>
                <SummaryGrid orders={orders} />
              </div>

              <PauseBlock pause={pause} setPause={setPause} />
            </div>
          </div>
        </div>
      )}

      <style jsx global>{`
        .tv-minutes {
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas,
            "Liberation Mono", "Courier New", monospace;
          font-weight: 900;
          line-height: 0.9;
          letter-spacing: -0.02em;
          font-size: 3rem;
        }
        @media (min-width: 768px) {
          .tv-minutes {
            font-size: 3.75rem;
          }
        }
        .tv-minutes--warn {
          color: #fdba74;
          text-shadow: 0 0 16px rgba(253, 186, 116, 0.35);
        }
        .tv-minutes--crit {
          color: #f87171;
          text-shadow: 0 0 18px rgba(248, 113, 113, 0.45);
          animation: bb-blink 1.2s ease-in-out infinite;
        }
        @keyframes bb-blink {
          0%,
          100% {
            filter: drop-shadow(0 0 0 rgba(248, 113, 113, 0));
            opacity: 1;
          }
          50% {
            filter: drop-shadow(0 0 18px rgba(248, 113, 113, 0.6));
            opacity: 0.82;
          }
        }
      `}</style>
    </main>
  );
}

function SummaryGrid({ orders }: { orders: StoredOrder[] }) {
  const stats = useMemo(() => {
    const total = orders.length;
    const lifa = orders.filter((order) => order.mode === "delivery").length;
    const apollon = orders.filter((order) => order.mode === "pickup").length;
    const online = orders.filter((order) => getPaymentKind(order) === "online").length;
    const cash = orders.filter((order) => getPaymentKind(order) === "cash").length;
    const active = orders.filter(
      (order) => order.status !== "done" && order.status !== "cancelled",
    ).length;
    const finished = orders.filter(
      (order) => order.status === "done" || order.status === "cancelled",
    ).length;
    const onroad = orders.filter(
      (order) =>
        order.status === "out_for_delivery" ||
        (order.mode === "pickup" && order.status === "ready"),
    ).length;

    return {
      total,
      lifa,
      apollon,
      online,
      cash,
      active,
      finished,
      onroad,
    };
  }, [orders]);

  const Item = ({ label, value }: { label: string; value: number }) => (
    <div className={`rounded-lg p-2 ${glass}`}>
      <div className="text-[11px] opacity-80">{label}</div>
      <div className="text-lg font-semibold">{value}</div>
    </div>
  );

  return (
    <div className="grid grid-cols-2 gap-2">
      <Item label="Gesamt" value={stats.total} />
      <Item label="Aktiv" value={stats.active} />
      <Item label="Unterwegs" value={stats.onroad} />
      <Item label="Fertig" value={stats.finished} />
      <Item label="Online" value={stats.online} />
      <Item label="Bar" value={stats.cash} />
      <Item label="Lieferung" value={stats.lifa} />
      <Item label="Abholung" value={stats.apollon} />
    </div>
  );
}

function ToggleSwitch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onChange}
      aria-pressed={checked}
      className={`flex w-full items-center justify-between rounded-xl border px-3 py-2 transition ${
        checked ? "border-emerald-400/40 bg-emerald-500/10" : "border-white/10 bg-white/5"
      }`}
    >
      <span>{label}</span>

      <span
        className={`flex h-6 w-11 items-center overflow-hidden rounded-full p-0.5 transition ${
          checked ? "justify-end bg-emerald-400" : "justify-start bg-stone-600"
        }`}
      >
        <span className="h-5 w-5 rounded-full bg-white shadow" />
      </span>
    </button>
  );
}

function PauseBlock({
  pause,
  setPause,
}: {
  pause: PauseState;
  setPause: (pause: PauseState) => void;
}) {
  const toggle = async (key: keyof PauseState) => {
    const nextLocal: PauseState = {
      ...pause,
      [key]: !pause[key],
    };

    setPause(nextLocal);

    try {
      const synced = await setPauseRemote(nextLocal);
      setPause(synced);
    } catch (error) {
      console.error("pause update failed", error);
      setPause(pause);
    }
  };

  return (
    <div className="space-y-2">
      <div className="text-xs uppercase tracking-wider text-stone-300/70">Pause</div>

      <ToggleSwitch
        checked={!!pause.delivery}
        onChange={() => toggle("delivery")}
        label="Lieferung pausieren"
      />

      <ToggleSwitch
        checked={!!pause.pickup}
        onChange={() => toggle("pickup")}
        label="Abholung pausieren"
      />
    </div>
  );
}