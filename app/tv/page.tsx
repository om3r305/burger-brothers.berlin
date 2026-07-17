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
type TvSoundKind = "delivery" | "pickup";

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

type TvProduct = {
  id?: string;
  sku?: string;
  code?: string;
  name: string;
  category?: string;
  active?: boolean;
  price?: number;
};

type ProductAvailabilityEntry = {
  disabled?: boolean;
  mode?: "today" | "manual" | string;
  until?: string | null;
  by?: string;
  updatedAt?: number;
  productId?: string;
  name?: string;
};

type ProductAvailabilityMap = Record<string, ProductAvailabilityEntry | null | undefined>;

type ProductAvailabilityAction = "open" | "today" | "manual";
type LeftPanel = "overview" | "articles";

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

const TV_SOUND_ENABLED_KEY = "bb_tv_sound_enabled_v1";
const TV_SOUND_VOLUME_KEY = "bb_tv_sound_volume_v1";
const TV_SOUND_SOURCES: Record<TvSoundKind, string[]> = {
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

const numOrNull = (value: any): number | null => {
  if (value == null || value === "") return null;

  const n = num(value);
  return Number.isFinite(n) && n > 0 ? n : null;
};

const money = (value: any) => `${num(value).toFixed(2)}€`;

function cleanObj(value: any): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function cleanArr(value: any): any[] {
  return Array.isArray(value) ? value : [];
}

function normalizeProductText(value: any) {
  return String(value ?? "").trim();
}

function normalizeProductKey(value: any) {
  return normalizeProductText(value)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function productAvailabilityKey(product: Partial<TvProduct> | any) {
  return (
    normalizeProductKey(product?.id) ||
    normalizeProductKey(product?.sku) ||
    normalizeProductKey(product?.code) ||
    normalizeProductKey(product?.name)
  );
}

function normalizeTvProducts(value: any): TvProduct[] {
  const list = Array.isArray(value)
    ? value
    : Array.isArray(value?.products)
      ? value.products
      : Array.isArray(value?.items)
        ? value.items
        : Array.isArray(value?.data)
          ? value.data
          : Array.isArray(value?.data?.products)
            ? value.data.products
            : Array.isArray(value?.data?.items)
              ? value.data.items
              : [];

  return list
    .filter((item: any) => item && (item.id || item.sku || item.code || item.name))
    .map((item: any) => ({
      id: item?.id != null ? String(item.id) : undefined,
      sku: item?.sku != null ? String(item.sku) : undefined,
      code: item?.code != null ? String(item.code) : undefined,
      name: normalizeProductText(item?.name || item?.title || "Artikel"),
      category: normalizeProductText(item?.category || "burger") || "burger",
      active: item?.active !== false,
      price: num(item?.price),
    }));
}

function normalizeProductAvailabilityMap(value: any): ProductAvailabilityMap {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};

  const out: ProductAvailabilityMap = {};

  for (const [key, entry] of Object.entries(value)) {
    const cleanKey = normalizeProductKey(key);
    if (!cleanKey) continue;

    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      out[cleanKey] = null;
      continue;
    }

    out[cleanKey] = {
      disabled: (entry as any)?.disabled === true,
      mode: normalizeProductText((entry as any)?.mode) || "manual",
      until: (entry as any)?.until ? String((entry as any).until) : null,
      by: normalizeProductText((entry as any)?.by) || undefined,
      updatedAt: Number((entry as any)?.updatedAt) || undefined,
      productId: normalizeProductText((entry as any)?.productId) || undefined,
      name: normalizeProductText((entry as any)?.name) || undefined,
    };
  }

  return out;
}

function productAvailabilityLookupKeys(product: Partial<TvProduct> | any) {
  return [
    product?.id,
    product?.sku,
    product?.code,
    product?.name,
  ]
    .map(normalizeProductKey)
    .filter(Boolean);
}

function getProductAvailabilityEntry(
  product: Partial<TvProduct> | any,
  availability: ProductAvailabilityMap,
) {
  for (const key of productAvailabilityLookupKeys(product)) {
    const entry = availability[key];
    if (entry) return entry;
  }

  return null;
}

function isProductClosedByEntry(entry: ProductAvailabilityEntry | null | undefined, nowMs = Date.now()) {
  if (!entry?.disabled) return false;

  if (!entry.until) return true;

  const untilMs = Date.parse(String(entry.until));
  if (!Number.isFinite(untilMs)) return true;

  return untilMs > nowMs;
}

function isProductTemporarilyClosed(
  product: Partial<TvProduct> | any,
  availability: ProductAvailabilityMap,
  nowMs = Date.now(),
) {
  return isProductClosedByEntry(getProductAvailabilityEntry(product, availability), nowMs);
}

function productCloseLabel(entry: ProductAvailabilityEntry | null | undefined, nowMs = Date.now()) {
  if (!isProductClosedByEntry(entry, nowMs)) return "Verfügbar";
  if (entry?.mode === "today") return "Heute geschlossen";
  return "Dauerhaft geschlossen";
}

function endOfTodayIso(tz: string) {
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

const TV_PRODUCT_CATEGORY_ORDER = [
  "burger",
  "vegan",
  "hotdogs",
  "extras",
  "sauces",
  "drinks",
  "donuts",
  "bubbletea",
];

const TV_PRODUCT_CATEGORY_LABELS: Record<string, string> = {
  burger: "Burger",
  vegan: "Vegan",
  hotdogs: "Hot Dogs",
  extras: "Extras",
  sauces: "Soßen",
  drinks: "Getränke",
  donuts: "Donuts",
  bubbletea: "Bubble Tea",
};

function productCategoryLabel(value: any) {
  const key = normalizeProductText(value || "burger").toLowerCase();
  return TV_PRODUCT_CATEGORY_LABELS[key] || key || "Artikel";
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

function readTvSoundEnabled() {
  if (typeof window === "undefined") return true;

  try {
    const stored = localStorage.getItem(TV_SOUND_ENABLED_KEY);
    return stored == null ? true : stored === "1";
  } catch {
    return true;
  }
}

function readTvSoundVolume() {
  if (typeof window === "undefined") return 100;

  try {
    const raw = Number(localStorage.getItem(TV_SOUND_VOLUME_KEY) || "100");

    if (!Number.isFinite(raw)) return 100;

    return Math.max(0, Math.min(100, Math.round(raw)));
  } catch {
    return 100;
  }
}

function saveTvSoundEnabled(enabled: boolean) {
  if (typeof window === "undefined") return;

  try {
    localStorage.setItem(TV_SOUND_ENABLED_KEY, enabled ? "1" : "0");
  } catch {}
}

function saveTvSoundVolume(volume: number) {
  if (typeof window === "undefined") return;

  try {
    localStorage.setItem(TV_SOUND_VOLUME_KEY, String(Math.max(0, Math.min(100, Math.round(volume)))));
  } catch {}
}

function isSoundCandidateOrder(order: StoredOrder) {
  return order.status !== "done" && order.status !== "cancelled";
}

function getTvSoundKind(order: StoredOrder): TvSoundKind {
  return order.mode === "pickup" ? "pickup" : "delivery";
}

function getTvSoundErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "");

  if (/notallowed|permission|interact|user gesture|gesture/i.test(message)) {
    return "Ton blockiert: Bitte einmal auf „Ton freischalten“ klicken.";
  }

  return "Ton konnte nicht abgespielt werden. Bitte Datei und Lautstärke prüfen.";
}

function getTvSoundTitle(kind: TvSoundKind) {
  return kind === "delivery" ? "Lieferung" : "Abholung";
}

function getOrderSoundId(order: StoredOrder) {
  return String(order.id || order.orderId || "").trim();
}

function getOrderSoundStartMs(order: StoredOrder) {
  return getOrderExactCreatedMs(order, null) ?? order.ts ?? 0;
}

function getOrderSoundKey(order: StoredOrder) {
  const id = getOrderSoundId(order);
  return id ? `${id}:${getTvSoundKind(order)}:${getOrderSoundStartMs(order)}` : "";
}

function getOrderSoundLabel(order: StoredOrder) {
  const id = getOrderSoundId(order);
  return id || "Bestellung";
}

function getSoundButtonLabel(enabled: boolean, unlocked: boolean) {
  if (!enabled) return "🔇 Ton aus";
  if (!unlocked) return "🔈 Ton freischalten";
  return "🔊 Ton aktiv";
}

function getSoundButtonTitle(enabled: boolean, unlocked: boolean) {
  if (!enabled) return "TV-Bestelltöne einschalten";
  if (!unlocked) return "Browser-Tonsperre durch Klick öffnen";
  return "TV-Bestelltöne ausschalten";
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
        /*
          /api/orders/list response'unda top-level raw içinde id/status/etaMin var.
          raw.order ise bazen sadece payload (items/customer/meta) oluyor ve etaMin taşımayabiliyor.
          Bu yüzden nested kaynak sadece kendi id/orderId taşıyorsa ana kaynak yapılır.
          Aksi halde top-level raw korunur; böylece yoğunluğa göre oluşan etaMin TV'de kaybolmaz.
        */
        const nestedOrder =
          raw?.order && typeof raw.order === "object" && (raw.order.id || raw.order.orderId)
            ? raw.order
            : null;

        const nestedItem =
          raw?.item && typeof raw.item === "object" && (raw.item.id || raw.item.orderId)
            ? raw.item
            : null;

        const nestedData =
          raw?.data && typeof raw.data === "object" && (raw.data.id || raw.data.orderId)
            ? raw.data
            : null;

        const source = nestedOrder || nestedItem || nestedData || raw;

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
          etaMin: numOrNull(source?.etaMin ?? meta?.etaMin ?? meta?.eta),
          etaAdjustMin: num(source?.etaAdjustMin ?? meta?.etaAdjustMin ?? meta?.etaAdjust ?? 0),
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
          driver:
            source?.driver ??
            meta?.driver ??
            (meta?.driverId || meta?.driverName
              ? {
                  id: meta?.driverId ?? null,
                  name: meta?.driverName ?? null,
                }
              : null),
          driverName:
            source?.driverName ||
            source?.driver?.name ||
            meta?.driver?.name ||
            meta?.driverName ||
            "",
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

async function persistStatusToDb(
  id: string,
  status: OrderStatus,
  by = "tv",
  extra: Record<string, any> = {},
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

function firstNonEmptyText(...values: any[]) {
  for (const value of values) {
    const text = String(value ?? "").trim();
    if (text) return text;
  }

  return "";
}

function buildDiscountDetails(order: StoredOrder, totals: ReturnType<typeof getOrderTotals>): DiscountRow[] {
  const meta = cleanObj(order?.meta);
  const pricing = cleanObj(order?.pricing);
  const fees = cleanObj(order?.fees);
  const couponMeta = cleanObj(meta?.couponMeta);
  const couponLifecycle = cleanObj(meta?.couponLifecycle);

  const rows: DiscountRow[] = [];

  const addRow = (label: string, amount: any) => {
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

  for (const adjustment of cleanArr((order as any)?.adjustments)) {
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
  const planned = normalizePlannedHHMM(order?.planned);
  if (!planned) return null;

  const [hh, mm] = planned.split(":").map((x) => parseInt(x, 10));

  const base = new Date(new Date().toLocaleString("en-US", { timeZone: tz }));
  const date = new Date(base);

  date.setHours(hh || 0, mm || 0, 0, 0);

  return date.getTime();
}

function etaFor(order: StoredOrder, avgPickup: number, avgDelivery: number) {
  const meta = cleanObj(order?.meta);
  const base =
    numOrNull(order.etaMin ?? meta?.etaMin ?? meta?.eta) ??
    (order.mode === "pickup" ? avgPickup : avgDelivery);
  const adjust = num(order.etaAdjustMin ?? meta?.etaAdjustMin ?? meta?.etaAdjust ?? 0);

  return Math.max(1, base + adjust);
}

function remainingMinutes(
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

function sortLeftMinutes(
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
  const meta = cleanObj(order?.meta);
  const driver = order?.driver || meta?.driver || null;

  return (
    (driver && (driver.name || driver.id)) ||
    order?.driverName ||
    meta?.driverName ||
    meta?.driverId ||
    ""
  );
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
  extra: Record<string, any> = {},
) {
  return persistStatusToDb(id, status, by, extra);
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


function clampAcceptEta(value: any) {
  const n = Number(value);
  const safe = Number.isFinite(n) ? Math.round(n) : 35;
  return Math.max(5, Math.min(180, safe));
}

function roundEtaStep(value: any, step = 5) {
  const n = clampAcceptEta(value);
  return Math.max(step, Math.min(180, Math.round(n / step) * step));
}

function normalizePlannedHHMM(value: any): string {
  const match = String(value || "")
    .trim()
    .match(/^(\d{1,2}):(\d{2})$/);

  if (!match) return "";

  const hours = Math.max(0, Math.min(23, Number(match[1]) || 0));
  const minutes = Math.max(0, Math.min(59, Number(match[2]) || 0));

  return `${pad2(hours)}:${pad2(minutes)}`;
}

function addMinutesToHHMM(value: any, deltaMin: number): string {
  const clean = normalizePlannedHHMM(value) || "00:00";
  const [hours, minutes] = clean.split(":").map((part) => Number(part) || 0);
  const dayMinutes = 24 * 60;
  const total = (((hours * 60 + minutes + deltaMin) % dayMinutes) + dayMinutes) % dayMinutes;

  return `${pad2(Math.floor(total / 60))}:${pad2(total % 60)}`;
}

function isPlannedOrder(order: StoredOrder) {
  return Boolean(normalizePlannedHHMM(order?.planned));
}

function plannedAcceptLabel(order: StoredOrder) {
  return order.mode === "pickup" ? "Geplante Abholzeit" : "Geplante Lieferzeit";
}

function acceptanceTitle(order: StoredOrder) {
  const planned = normalizePlannedHHMM(order.planned);
  const plannedLabel = planned ? `Geplant ${planned}` : "";

  if (order.mode === "pickup") {
    return plannedLabel ? `${plannedLabel} · Abholung` : "Abholung";
  }

  return plannedLabel ? `${plannedLabel} · Lieferung` : "Lieferung";
}

function acceptanceSubtitle(order: StoredOrder) {
  if (order.mode === "pickup") {
    const name = String(order.customer?.name || "").trim();
    const phone = String(order.customer?.phone || "").trim();

    return [name, phone].filter(Boolean).join(" · ") || "Abholung im Laden";
  }

  return formatDeliveryLine(order) || "Adresse prüfen";
}

function acceptanceZip(order: StoredOrder) {
  return String(
    order.plz ||
      order.customer?.plz ||
      order.customer?.zip ||
      "",
  ).trim();
}

function AcceptOrderOverlay({
  order,
  etaValue,
  plannedValue,
  busy,
  onEtaChange,
  onPlannedChange,
  onAccept,
}: {
  order: StoredOrder;
  etaValue: number;
  plannedValue?: string;
  busy: boolean;
  onEtaChange: (value: number) => void;
  onPlannedChange?: (value: string) => void;
  onAccept: () => void | Promise<void>;
}) {
  const paymentBadge = getPaymentBadge(order);
  const zip = acceptanceZip(order);
  const title = acceptanceTitle(order);
  const subtitle = acceptanceSubtitle(order);
  const totals = getOrderTotals(order);
  const itemCount = order.items.reduce((sum, item) => sum + Math.max(1, num(item.qty || 1)), 0);
  const plannedMode = isPlannedOrder(order);
  const visiblePlannedValue = normalizePlannedHHMM(plannedValue || order.planned) || "00:00";

  const changeEta = (delta: number) => {
    if (plannedMode) {
      // Geplante Bestellungen dürfen im TV nur nach hinten verschoben werden.
      // So kann niemand versehentlich eine frühere Kundenzeit bestätigen.
      if (delta <= 0) return;

      onPlannedChange?.(addMinutesToHHMM(visiblePlannedValue, delta));
      return;
    }

    onEtaChange(clampAcceptEta(etaValue + delta));
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/80 p-3 backdrop-blur-md sm:p-6">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(900px_500px_at_50%_0%,rgba(251,146,60,.20),transparent),radial-gradient(800px_500px_at_80%_80%,rgba(16,185,129,.15),transparent)]" />

      <div className={`relative w-full max-w-5xl overflow-hidden rounded-[2rem] border-orange-300/35 p-5 shadow-2xl sm:p-7 ${glass}`}>
        <div className="absolute right-5 top-5 flex items-center gap-2">
          <span className="h-3.5 w-3.5 animate-pulse rounded-full bg-rose-400 shadow-[0_0_18px_rgba(251,113,133,.85)]" />
          <span className="text-xs font-bold uppercase tracking-[0.24em] text-rose-100">Neu</span>
        </div>

        <div className="pr-24">
          <div className="text-sm font-semibold uppercase tracking-[0.22em] text-orange-200/90">
            Neue Bestellung
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-3">
            <h1 className="text-4xl font-black tracking-tight text-white sm:text-6xl">
              {title}
            </h1>

            <span className={`${chip} ${paymentBadge.className}`}>
              <span className="mr-1" aria-hidden="true">{paymentBadge.icon}</span>
              {paymentBadge.label}
            </span>
          </div>
        </div>

        <div className="mt-6 grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="rounded-3xl border border-white/10 bg-black/25 p-5">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-400">
              Adresse / Kunde
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-3">
              {zip ? (
                <div className="rounded-2xl border border-orange-300/35 bg-orange-500/15 px-4 py-3 text-3xl font-black text-orange-100">
                  {zip}
                </div>
              ) : null}

              <div className="min-w-0 flex-1 text-2xl font-bold leading-tight text-white sm:text-3xl">
                {subtitle}
              </div>
            </div>

            {extractOrderNote(order) ? (
              <div className="mt-4 rounded-2xl border border-amber-300/25 bg-amber-400/10 p-3 text-amber-100">
                <div className="text-xs font-bold uppercase tracking-wider text-amber-200/80">
                  Hinweis
                </div>
                <div className="mt-1 whitespace-pre-wrap text-base font-semibold">
                  {extractOrderNote(order)}
                </div>
              </div>
            ) : null}

            <div className="mt-4 max-h-52 overflow-y-auto rounded-2xl border border-white/10 bg-white/[0.04] p-3">
              <div className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-stone-400">
                Artikel
              </div>
              <div className="space-y-2">
                {order.items.map((item, index) => (
                  <div key={`${item.name}-${index}`} className="flex gap-3 rounded-xl bg-black/20 px-3 py-2">
                    <div className="min-w-8 text-xl font-black text-orange-100">{item.qty}×</div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-base font-bold text-white">{item.name}</div>
                      {item.note ? <div className="text-xs text-amber-100">{item.note}</div> : null}
                      {Array.isArray(item.add) && item.add.length > 0 ? (
                        <div className="text-xs text-stone-300">
                          Extras: {item.add.map((extra) => extra?.label || extra?.name).filter(Boolean).join(", ")}
                        </div>
                      ) : null}
                      {Array.isArray(item.rm) && item.rm.length > 0 ? (
                        <div className="text-xs text-stone-400">Ohne: {item.rm.join(", ")}</div>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-4 grid grid-cols-3 gap-3 text-center text-sm">
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3">
                <div className="text-stone-400">Bestellung</div>
                <div className="mt-1 font-bold">#{order.id}</div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3">
                <div className="text-stone-400">Artikel</div>
                <div className="mt-1 font-bold">{itemCount}</div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3">
                <div className="text-stone-400">Gesamt</div>
                <div className="mt-1 font-bold">{money(totals.total)}</div>
              </div>
            </div>
          </div>

          <div className="rounded-3xl border border-emerald-300/20 bg-emerald-500/10 p-5">
            <div className="text-center text-xs font-semibold uppercase tracking-[0.2em] text-emerald-100/80">
              {plannedMode ? plannedAcceptLabel(order) : "Zeit bestätigen"}
            </div>

            <div className="mt-4 flex items-center justify-center gap-4">
              <button
                type="button"
                disabled={busy || plannedMode}
                onClick={() => changeEta(plannedMode ? -15 : -5)}
                className="h-20 w-20 rounded-3xl border border-white/15 bg-white/10 text-5xl font-black hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-25"
                aria-label="Zeit reduzieren"
                title={plannedMode ? "Geplante Zeiten können nur nach hinten verschoben werden." : "Zeit reduzieren"}
              >
                −
              </button>

              <div className="min-w-[210px] rounded-[2rem] border border-emerald-300/30 bg-black/35 px-6 py-5 text-center shadow-inner">
                <div className={`${plannedMode ? "text-6xl" : "text-7xl"} font-black leading-none text-white tabular-nums`}>
                  {plannedMode ? visiblePlannedValue : etaValue}
                </div>
                <div className="mt-1 text-lg font-bold uppercase tracking-wider text-emerald-100">
                  {plannedMode ? "Uhr" : "Min"}
                </div>
              </div>

              <button
                type="button"
                disabled={busy}
                onClick={() => changeEta(plannedMode ? 15 : 5)}
                className="h-20 w-20 rounded-3xl border border-white/15 bg-white/10 text-5xl font-black hover:bg-white/15 disabled:opacity-40"
                aria-label="Zeit erhöhen"
              >
                +
              </button>
            </div>

            <div className="mt-5 grid grid-cols-4 gap-2">
              {plannedMode
                ? [
                    { label: "+15′", delta: 15 },
                    { label: "+30′", delta: 30 },
                    { label: "+45′", delta: 45 },
                    { label: "+60′", delta: 60 },
                  ].map((item) => (
                    <button
                      key={item.label}
                      type="button"
                      disabled={busy}
                      onClick={() => changeEta(item.delta)}
                      className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm font-bold text-stone-200 transition hover:bg-white/10 disabled:opacity-40"
                    >
                      {item.label}
                    </button>
                  ))
                : [25, 35, 45, 60].map((minute) => (
                    <button
                      key={minute}
                      type="button"
                      disabled={busy}
                      onClick={() => onEtaChange(minute)}
                      className={`rounded-2xl border px-3 py-2 text-sm font-bold transition disabled:opacity-40 ${
                        etaValue === minute
                          ? "border-emerald-300/60 bg-emerald-400/20 text-emerald-50"
                          : "border-white/10 bg-white/5 text-stone-200 hover:bg-white/10"
                      }`}
                    >
                      {minute}′
                    </button>
                  ))}
            </div>

            <button
              type="button"
              disabled={busy}
              onClick={onAccept}
              className="mt-5 w-full rounded-3xl border border-emerald-300/50 bg-emerald-500 px-5 py-5 text-2xl font-black text-white shadow-[0_18px_45px_rgba(16,185,129,.25)] transition hover:bg-emerald-400 disabled:cursor-wait disabled:opacity-60"
            >
              {busy ? "Wird angenommen …" : "Annehmen & Drucken"}
            </button>

          </div>
        </div>

        <div className="mt-4 text-center text-sm text-stone-300/85">
          Der Ton wiederholt sich alle 4 Sekunden, bis die Bestellung angenommen wird.
        </div>
      </div>
    </div>
  );
}

/* ─────────────── Printing ─────────────── */
async function silentPrint(
  order: StoredOrder,
  opts: { showSuccessAlert?: boolean; throwOnError?: boolean } = {},
) {
  const showSuccessAlert = opts.showSuccessAlert !== false;
  const throwOnError = opts.throwOnError === true;

  try {
    const proxy =
      (typeof window !== "undefined" &&
        (localStorage.getItem("bb_print_proxy_url") || "")) ||
      "http://127.0.0.1:7777";

    const res = await fetch(`${proxy}/print/full`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        order,
        options: {
          paper: "80mm",
          copies: 1,
          maskName: false,
          maskPhone: false,
        },
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Proxy ${res.status}: ${text}`);
    }

    if (showSuccessAlert) {
      alert("🖨️ Druckauftrag gesendet.");
    }
  } catch (error: any) {
    console.error(error);

    if (throwOnError) {
      throw error;
    }

    alert(
      `Drucken fehlgeschlagen: ${error?.message || error}\n` +
        `• Läuft der print-proxy?\n` +
        `• Firewall/CORS blockiert?\n` +
        `• bb_print_proxy_url korrekt?`,
    );
  }
}

function TvSoundControls({
  enabled,
  unlocked,
  volume,
  error,
  onToggle,
  onVolume,
  onTestDelivery,
  onTestPickup,
}: {
  enabled: boolean;
  unlocked: boolean;
  volume: number;
  error: string;
  onToggle: () => void | Promise<void>;
  onVolume: (volume: number) => void;
  onTestDelivery: () => void | Promise<void>;
  onTestPickup: () => void | Promise<void>;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-white/10 bg-black/15 px-2 py-2 text-xs">
      <button
        type="button"
        onClick={onToggle}
        className={`rounded-full border px-3 py-1 font-semibold transition ${
          enabled
            ? unlocked
              ? "border-emerald-400/50 bg-emerald-500/15 text-emerald-100 hover:bg-emerald-500/25"
              : "border-amber-400/50 bg-amber-500/15 text-amber-100 hover:bg-amber-500/25"
            : "border-white/10 bg-white/5 text-stone-300 hover:bg-white/10"
        }`}
        title={getSoundButtonTitle(enabled, unlocked)}
      >
        {getSoundButtonLabel(enabled, unlocked)}
      </button>

      <label className="flex items-center gap-2 text-stone-300">
        <span className="hidden sm:inline">Lautstärke</span>
        <input
          type="range"
          min={0}
          max={100}
          step={5}
          value={volume}
          onChange={(event) => onVolume(Number(event.target.value))}
          className="h-1 w-20 accent-emerald-400"
          aria-label="Ton-Lautstärke"
        />
        <span className="w-8 text-right tabular-nums">{volume}%</span>
      </label>

      <button
        type="button"
        onClick={onTestDelivery}
        className="rounded-full border border-orange-400/40 bg-orange-500/10 px-2 py-1 text-orange-100 hover:bg-orange-500/20"
        title="Lieferungston testen"
      >
        L
      </button>

      <button
        type="button"
        onClick={onTestPickup}
        className="rounded-full border border-cyan-400/40 bg-cyan-500/10 px-2 py-1 text-cyan-100 hover:bg-cyan-500/20"
        title="Abholton testen"
      >
        A
      </button>

      {error ? (
        <span className="max-w-[260px] truncate text-amber-300" title={error}>
          {error}
        </span>
      ) : null}
    </div>
  );
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
  const [leftPanel, setLeftPanel] = useState<LeftPanel>("overview");

  const [products, setProducts] = useState<TvProduct[]>([]);
  const [productBusyKey, setProductBusyKey] = useState("");
  const [productError, setProductError] = useState("");

  const [pause, setPause] = useState<PauseState>({ delivery: false, pickup: false });
  const [brianData, setBrianData] = useState<BrianData | null>(null);

  const [etaOverrides, setEtaOverrides] = useState<Record<string, number>>({});
  const [acceptEtaDrafts, setAcceptEtaDrafts] = useState<Record<string, number>>({});
  const [acceptPlannedDrafts, setAcceptPlannedDrafts] = useState<Record<string, string>>({});
  const [acceptBusyId, setAcceptBusyId] = useState("");
  const [outSince, setOutSince] = useState<Record<string, number>>({});
  const minuteCacheRef = useRef<Record<string, MinuteCacheEntry>>({});
  const orderClockRef = useRef<Record<string, TvOrderClockEntry>>({});

  const deliveryAudioRef = useRef<HTMLAudioElement | null>(null);
  const pickupAudioRef = useRef<HTMLAudioElement | null>(null);
  const soundSourceIndexRef = useRef<Record<TvSoundKind, number>>({
    delivery: 0,
    pickup: 0,
  });
  const soundKnownOrdersRef = useRef<Set<string> | null>(null);
  const soundEnabledRef = useRef(true);
  const soundVolumeRef = useRef(1);

  const [soundEnabled, setSoundEnabled] = useState(true);
  const [soundUnlocked, setSoundUnlocked] = useState(true);
  const [soundVolume, setSoundVolume] = useState(100);
  const [soundError, setSoundError] = useState("");

  const getAudioRef = useCallback((kind: TvSoundKind) => {
    return kind === "delivery" ? deliveryAudioRef : pickupAudioRef;
  }, []);

  const getAudioForKind = useCallback(
    (kind: TvSoundKind) => {
      if (typeof window === "undefined") return null;

      const ref = getAudioRef(kind);
      const sources = TV_SOUND_SOURCES[kind];
      const index = soundSourceIndexRef.current[kind] % sources.length;
      const src = sources[index];

      if (!ref.current || ref.current.dataset.src !== src) {
        const audio = new Audio(src);

        audio.preload = "auto";
        audio.dataset.src = src;
        audio.volume = soundVolumeRef.current;

        ref.current = audio;
      }

      return ref.current;
    },
    [getAudioRef],
  );

  const setSoundEnabledSafe = useCallback((enabled: boolean) => {
    soundEnabledRef.current = enabled;
    setSoundEnabled(enabled);
    saveTvSoundEnabled(enabled);

    if (!enabled) {
      setSoundError("");
    }
  }, []);

  const setSoundVolumeSafe = useCallback(
    (volume: number) => {
      const next = Math.max(0, Math.min(100, Math.round(volume)));
      const asAudioVolume = next / 100;

      soundVolumeRef.current = asAudioVolume;
      setSoundVolume(next);
      saveTvSoundVolume(next);

      for (const kind of ["delivery", "pickup"] as TvSoundKind[]) {
        const audio = getAudioRef(kind).current;
        if (audio) audio.volume = asAudioVolume;
      }
    },
    [getAudioRef],
  );

  const playTvSound = useCallback(
    async (kind: TvSoundKind, force = false) => {
      if (!force && !soundEnabledRef.current) return false;

      const sources = TV_SOUND_SOURCES[kind];
      let lastError: unknown = null;

      for (let attempt = 0; attempt < sources.length; attempt += 1) {
        const audio = getAudioForKind(kind);

        if (!audio) return false;

        try {
          audio.pause();
          audio.currentTime = 0;
          audio.volume = soundVolumeRef.current;

          await audio.play();

          setSoundUnlocked(true);
          setSoundError("");

          return true;
        } catch (error) {
          lastError = error;

          const message = error instanceof Error ? error.message : String(error || "");

          if (/notallowed|permission|interact|user gesture|gesture/i.test(message)) {
            setSoundError(getTvSoundErrorMessage(error));
            return false;
          }

          const ref = getAudioRef(kind);

          try {
            ref.current?.pause();
          } catch {}

          ref.current = null;
          soundSourceIndexRef.current[kind] =
            (soundSourceIndexRef.current[kind] + 1) % sources.length;
        }
      }

      console.warn(`${getTvSoundTitle(kind)} sound failed`, lastError);
      setSoundError(getTvSoundErrorMessage(lastError));

      return false;
    },
    [getAudioForKind, getAudioRef],
  );

  const stopTvSounds = useCallback(() => {
    for (const kind of ["delivery", "pickup"] as TvSoundKind[]) {
      const audio = getAudioRef(kind).current;

      if (!audio) continue;

      try {
        audio.pause();
        audio.currentTime = 0;
      } catch {}
    }
  }, [getAudioRef]);

  const unlockTvSounds = useCallback(async () => {
    setSoundEnabledSafe(true);

    /*
      Chrome/Android TV gibi tarayıcılar kullanıcı tıklaması olmadan ses çaldırmaz.
      Bu buton ilk tıklamada ses kilidini açar ve Abholung sesini test eder.
    */
    await playTvSound("pickup", true);
  }, [playTvSound, setSoundEnabledSafe]);

  const toggleTvSounds = useCallback(async () => {
    if (!soundEnabledRef.current || !soundUnlocked) {
      await unlockTvSounds();
      return;
    }

    setSoundEnabledSafe(false);
  }, [soundUnlocked, unlockTvSounds, setSoundEnabledSafe]);

  useEffect(() => {
    const enabled = true;
    const volume = 100;

    soundEnabledRef.current = enabled;
    soundVolumeRef.current = volume / 100;

    setSoundEnabled(enabled);
    setSoundUnlocked(true);
    setSoundVolume(volume);
    saveTvSoundEnabled(true);
    saveTvSoundVolume(volume);

    try {
      if (!localStorage.getItem("bb_print_proxy_url")) {
        localStorage.setItem("bb_print_proxy_url", "http://127.0.0.1:7777");
      }
    } catch {}

    // Sipariş ekrana düştüğü anda ses gecikmesin diye dosyaları TV açılışında ısıtıyoruz.
    for (const kind of ["delivery", "pickup"] as TvSoundKind[]) {
      try {
        getAudioForKind(kind)?.load();
      } catch {}
    }
  }, [getAudioForKind]);

  const handleNewOrderSounds = useCallback(
    (nextOrders: StoredOrder[]) => {
      const candidates = nextOrders.filter(isSoundCandidateOrder);
      const currentKeys = new Set(
        candidates
          .map(getOrderSoundKey)
          .filter((key): key is string => Boolean(key)),
      );

      if (!soundKnownOrdersRef.current) {
        soundKnownOrdersRef.current = currentKeys;
        return;
      }

      const previousKeys = soundKnownOrdersRef.current;
      const newOrders = candidates.filter((order: any) => {
        const key = getOrderSoundKey(order);
        return key && !previousKeys.has(key);
      });

      soundKnownOrdersRef.current = currentKeys;

      if (!newOrders.length || !soundEnabledRef.current) return;

      const hasDelivery = newOrders.some((order: any) => getTvSoundKind(order) === "delivery");
      const hasPickup = newOrders.some((order: any) => getTvSoundKind(order) === "pickup");

      if (hasDelivery) {
        void playTvSound("delivery");
      }

      if (hasPickup) {
        window.setTimeout(() => {
          void playTvSound("pickup");
        }, hasDelivery ? 900 : 0);
      }

      const labels = newOrders.map(getOrderSoundLabel).join(", ");
      console.info(`TV order sound: ${labels}`);
    },
    [playTvSound],
  );

  useEffect(() => {
    orderClockRef.current = readTvClockCache();
  }, []);

  useEffect(() => {
    return () => {
      for (const audio of [deliveryAudioRef.current, pickupAudioRef.current]) {
        try {
          audio?.pause();
        } catch {}
      }
    };
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
  const productAvailability = useMemo(
    () => normalizeProductAvailabilityMap(settings?.productAvailability),
    [settings?.productAvailability],
  );
  const tz = appTZ(settings);
  const avgPickup = Number(settings?.hours?.avgPickupMinutes ?? 15);
  const avgDelivery = Number(settings?.hours?.avgDeliveryMinutes ?? 35);
  const newGraceMin = Math.max(0, Number(settings?.hours?.newGraceMinutes ?? 5));

  const refreshProducts = useCallback(async () => {
    try {
      const res = await fetch("/api/products", {
        method: "GET",
        cache: "no-store",
        headers: {
          accept: "application/json",
        },
      });

      if (!res.ok) throw new Error(`products_${res.status}`);

      const json = await res.json();
      setProducts(normalizeTvProducts(json));
    } catch (error) {
      console.error("TV products load failed", error);
      setProductError("Artikel konnten nicht geladen werden.");
    }
  }, []);

  useEffect(() => {
    let active = true;

    const load = async () => {
      if (!active) return;
      await refreshProducts();
    };

    load();

    const onFocus = () => load();
    const onVisibility = () => {
      if (document.visibilityState === "visible") load();
    };

    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      active = false;
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [refreshProducts]);

  const updateProductAvailability = useCallback(
    async (product: TvProduct, action: ProductAvailabilityAction) => {
      const key = productAvailabilityKey(product);
      if (!key) return;

      const nextEntry =
        action === "open"
          ? null
          : {
              disabled: true,
              mode: action === "today" ? "today" : "manual",
              until: action === "today" ? endOfTodayIso(tz) : null,
              by: "tv",
              updatedAt: Date.now(),
              productId: key,
              name: product.name,
            };

      const nextAvailability = {
        ...productAvailability,
        [key]: nextEntry,
      };

      setProductBusyKey(key);
      setProductError("");

      try {
        const res = await fetch("/api/settings", {
          method: "POST",
          cache: "no-store",
          headers: {
            "Content-Type": "application/json",
            accept: "application/json",
          },
          body: JSON.stringify({
            productAvailability: nextAvailability,
          }),
        });

        if (!res.ok) {
          const payload = await res.json().catch(() => null);
          throw new Error(payload?.message || payload?.error || `settings_${res.status}`);
        }

        await fetchAndApplyRemoteSettings();
        setSettingsTick((x) => x + 1);

        try {
          window.dispatchEvent(new Event("bb_settings_changed"));
          window.dispatchEvent(new Event("bb:settings-sync"));
        } catch {}
      } catch (error) {
        console.error("TV product availability update failed", error);
        setProductError("Artikel-Status konnte nicht gespeichert werden.");
      } finally {
        setProductBusyKey("");
      }
    },
    [productAvailability, tz],
  );

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
          etaMin: order.etaMin ?? previous.etaMin ?? null,
          etaAdjustMin: order.etaAdjustMin ?? previous.etaAdjustMin ?? 0,
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

      const advanced = all.map((order: any) => ({
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

      const today = advanced.filter((order: any) => {
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
      handleNewOrderSounds(today);

      minuteCacheRef.current = Object.fromEntries(
        Object.entries(minuteCacheRef.current).filter(([id]) =>
          today.some((order: any) => order.id === id),
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
  }, [avgPickup, avgDelivery, newGraceMin, tz, handleNewOrderSounds]);

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
    const incoming = orders.filter((order: any) => {
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
      .filter((order: any) => {
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
        if (view === "finished") {
          const aDone = getDoneAtMs(a) ?? getOrderStartMs(a, orderClockRef.current, a.ts) ?? a.ts ?? 0;
          const bDone = getDoneAtMs(b) ?? getOrderStartMs(b, orderClockRef.current, b.ts) ?? b.ts ?? 0;
          return bDone - aDone;
        }

        const aLeft = sortLeftMinutes(a, avgPickup, avgDelivery, tz, nowMs, etaOverrides[a.id]);
        const bLeft = sortLeftMinutes(b, avgPickup, avgDelivery, tz, nowMs, etaOverrides[b.id]);

        if (aLeft !== bLeft) return aLeft - bLeft;

        const aStart = getOrderStartMs(a, orderClockRef.current, a.ts) ?? a.ts ?? 0;
        const bStart = getOrderStartMs(b, orderClockRef.current, b.ts) ?? b.ts ?? 0;
        return aStart - bStart;
      });
  }, [orders, view, avgPickup, avgDelivery, tz, nowMs, etaOverrides]);


  const pendingAcceptOrder = useMemo(() => {
    return orders
      .filter((order: any) => order.status === "new")
      .sort((a, b) => {
        const aStart = getOrderStartMs(a, orderClockRef.current, a.ts) ?? a.ts ?? 0;
        const bStart = getOrderStartMs(b, orderClockRef.current, b.ts) ?? b.ts ?? 0;
        return aStart - bStart;
      })[0] ?? null;
  }, [orders]);

  const pendingAcceptEta = pendingAcceptOrder
    ? acceptEtaDrafts[pendingAcceptOrder.id] ??
      roundEtaStep(etaFor(pendingAcceptOrder, avgPickup, avgDelivery))
    : 0;

  const pendingAcceptPlanned = pendingAcceptOrder
    ? acceptPlannedDrafts[pendingAcceptOrder.id] ?? normalizePlannedHHMM(pendingAcceptOrder.planned)
    : "";

  useEffect(() => {
    if (!pendingAcceptOrder) return;

    setAcceptEtaDrafts((prev) => {
      if (prev[pendingAcceptOrder.id] != null) return prev;

      return {
        ...prev,
        [pendingAcceptOrder.id]: roundEtaStep(etaFor(pendingAcceptOrder, avgPickup, avgDelivery)),
      };
    });

    const planned = normalizePlannedHHMM(pendingAcceptOrder.planned);
    if (planned) {
      setAcceptPlannedDrafts((prev) => {
        if (prev[pendingAcceptOrder.id]) return prev;

        return {
          ...prev,
          [pendingAcceptOrder.id]: planned,
        };
      });
    }
  }, [pendingAcceptOrder?.id, pendingAcceptOrder, avgPickup, avgDelivery]);

  useEffect(() => {
    if (!pendingAcceptOrder) return;
    if (acceptBusyId === pendingAcceptOrder.id) return;

    let stopped = false;
    const kind = getTvSoundKind(pendingAcceptOrder);

    const ring = () => {
      if (stopped) return;
      void playTvSound(kind);
    };

    // İlk zil modal açılır açılmaz çalsın; sonraki uyarılar 4 saniyede bir devam etsin.
    ring();
    const id = window.setInterval(ring, 4000);

    return () => {
      stopped = true;
      window.clearInterval(id);
    };
  }, [pendingAcceptOrder?.id, pendingAcceptOrder?.mode, acceptBusyId, playTvSound]);

  const handleAcceptAndPrint = async (order: StoredOrder) => {
    const plannedTime = normalizePlannedHHMM(
      acceptPlannedDrafts[order.id] || order.planned,
    );
    const plannedMode = Boolean(plannedTime);
    const etaMin = clampAcceptEta(
      acceptEtaDrafts[order.id] ?? roundEtaStep(etaFor(order, avgPickup, avgDelivery)),
    );

    setAcceptBusyId(order.id);
    stopTvSounds();
    delete minuteCacheRef.current[order.id];

    const acceptedLocal: StoredOrder = {
      ...order,
      status: "preparing",
      planned: plannedMode ? plannedTime : order.planned,
      etaMin,
      etaAdjustMin: 0,
      meta: {
        ...(order.meta || {}),
        etaMin,
        finalEtaMin: etaMin,
        acceptedEtaMin: etaMin,
        ...(plannedMode
          ? {
              planned: plannedTime,
              confirmedPlanned: plannedTime,
              acceptedPlanned: plannedTime,
            }
          : {}),
        acceptedAt: Date.now(),
        acceptedBy: "tv",
      },
    };

    setOrders((prev) => prev.map((item) => (item.id === order.id ? acceptedLocal : item)));
    setEtaOverrides((prev) => ({ ...prev, [order.id]: etaMin }));

    try {
      const data = await updateOrderStatusDbFirst(order.id, "preparing", "tv", {
        etaMin,
        etaAdjustMin: 0,
        ...(plannedMode
          ? {
              planned: plannedTime,
              confirmedPlanned: plannedTime,
              acceptedPlanned: plannedTime,
            }
          : {}),
        accepted: true,
        acceptAndPrint: true,
        acceptSource: "tv",
      });

      const printCandidate = normalizeOrders([
        data?.order || data?.data || data?.item || acceptedLocal,
      ])[0] ?? acceptedLocal;

      await silentPrint(
        {
          ...printCandidate,
          planned: plannedMode ? plannedTime : printCandidate.planned,
          etaMin,
          etaAdjustMin: 0,
          status: "preparing",
          meta: {
            ...(printCandidate.meta || {}),
            etaMin,
            finalEtaMin: etaMin,
            acceptedEtaMin: etaMin,
            ...(plannedMode
              ? {
                  planned: plannedTime,
                  confirmedPlanned: plannedTime,
                  acceptedPlanned: plannedTime,
                }
              : {}),
          },
        },
        { showSuccessAlert: false, throwOnError: true },
      );

      setAcceptEtaDrafts((prev) => {
        const next = { ...prev };
        delete next[order.id];
        return next;
      });
      setAcceptPlannedDrafts((prev) => {
        const next = { ...prev };
        delete next[order.id];
        return next;
      });

      await refresh();
    } catch (error: any) {
      console.error("Accept and print failed", error);
      alert(
        `Bestellung wurde nicht sauber angenommen/gedruckt: ${error?.message || error}`,
      );
      await refresh();
    } finally {
      setAcceptBusyId("");
    }
  };

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

      {pendingAcceptOrder && (
        <AcceptOrderOverlay
          order={pendingAcceptOrder}
          etaValue={pendingAcceptEta}
          plannedValue={pendingAcceptPlanned}
          busy={acceptBusyId === pendingAcceptOrder.id}
          onEtaChange={(value) => {
            setAcceptEtaDrafts((prev) => ({
              ...prev,
              [pendingAcceptOrder.id]: clampAcceptEta(value),
            }));
          }}
          onPlannedChange={(value) => {
            setAcceptPlannedDrafts((prev) => ({
              ...prev,
              [pendingAcceptOrder.id]: normalizePlannedHHMM(value),
            }));
          }}
          onAccept={() => handleAcceptAndPrint(pendingAcceptOrder)}
        />
      )}

      <header className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button
            className={`${iconBtn} mr-1`}
            onClick={() => {
              setLeftPanel("overview");
              setLeftOpen(true);
            }}
            title="Menü"
          >
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
                const response = await fetch("/api/tv/logout", {
                  method: "POST",
                  headers: { accept: "application/json" },
                });

                if (!response.ok) {
                  throw new Error(`TV_LOGOUT_${response.status}`);
                }
              } catch {
                window.location.assign("/api/tv/logout");
                return;
              }

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
          filtered.map((order: any) => {
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
              const discountDetails = buildDiscountDetails(sel, totals);
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

                      {discountDetails.length > 0 || totals.discountSum > 0 ? (
                        <>
                          <tr className="border-b border-white/10">
                            <td className="p-2">Rabatte</td>
                            <td className="p-2 text-right">
                              -{money(totals.discountSum)}
                            </td>
                          </tr>

                          {discountDetails.map((discount, index) => (
                            <tr key={index} className="border-b border-white/10 text-emerald-200/95">
                              <td className="p-2 pl-6">
                                <div className="font-medium">- {discount.label}</div>
                                <div className="mt-0.5 text-xs text-stone-400">
                                  Grund der Ermäßigung
                                </div>
                              </td>
                              <td className="p-2 text-right">-{money(discount.amount)}</td>
                            </tr>
                          ))}
                        </>
                      ) : null}

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
            className={`absolute left-0 top-0 h-full w-[380px] max-w-[92vw] overflow-y-auto p-4 ${glass}`}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <div className="text-lg font-semibold">Bestellübersicht</div>
              <button className="btn-ghost" onClick={() => setLeftOpen(false)}>
                Schließen
              </button>
            </div>

            <div className="mb-4 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setLeftPanel("overview")}
                className={`rounded-xl border px-3 py-2 text-sm font-semibold ${
                  leftPanel === "overview"
                    ? "border-emerald-400/50 bg-emerald-500/15 text-emerald-100"
                    : "border-white/10 bg-white/5 text-stone-200"
                }`}
              >
                Übersicht
              </button>

              <button
                type="button"
                onClick={() => {
                  setLeftPanel("articles");
                  refreshProducts();
                }}
                className={`rounded-xl border px-3 py-2 text-sm font-semibold ${
                  leftPanel === "articles"
                    ? "border-emerald-400/50 bg-emerald-500/15 text-emerald-100"
                    : "border-white/10 bg-white/5 text-stone-200"
                }`}
              >
                Artikel
              </button>
            </div>

            {leftPanel === "overview" ? (
              <div className="space-y-4">
                <div>
                  <div className="mb-1 text-xs uppercase tracking-wider text-stone-300/70">
                    Zusammenfassung
                  </div>
                  <SummaryGrid orders={orders} />
                </div>

                <div>
                  <div className="mb-1 text-xs uppercase tracking-wider text-stone-300/70">
                    Ton & Druck
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3">
                    <TvSoundControls
                      enabled={soundEnabled}
                      unlocked={soundUnlocked}
                      volume={soundVolume}
                      error={soundError}
                      onToggle={toggleTvSounds}
                      onVolume={setSoundVolumeSafe}
                      onTestDelivery={async () => {
                        await playTvSound("delivery", true);
                      }}
                      onTestPickup={async () => {
                        await playTvSound("pickup", true);
                      }}
                    />
                    <div className="mt-2 text-xs text-stone-400">
                      Standard: Ton aktiv, Lautstärke {soundVolume}%, Druck über lokalen Print-Proxy.
                    </div>
                  </div>
                </div>

                <PauseBlock pause={pause} setPause={setPause} />
              </div>
            ) : (
              <ProductAvailabilityBlock
                products={products}
                availability={productAvailability}
                nowMs={nowMs}
                busyKey={productBusyKey}
                error={productError}
                onChange={updateProductAvailability}
                onRefresh={refreshProducts}
              />
            )}
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
    const lifa = orders.filter((order: any) => order.mode === "delivery").length;
    const apollon = orders.filter((order: any) => order.mode === "pickup").length;
    const online = orders.filter((order: any) => getPaymentKind(order) === "online").length;
    const cash = orders.filter((order: any) => getPaymentKind(order) === "cash").length;
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

function ProductAvailabilityBlock({
  products,
  availability,
  nowMs,
  busyKey,
  error,
  onChange,
  onRefresh,
}: {
  products: TvProduct[];
  availability: ProductAvailabilityMap;
  nowMs: number;
  busyKey: string;
  error: string;
  onChange: (product: TvProduct, action: ProductAvailabilityAction) => void | Promise<void>;
  onRefresh: () => void | Promise<void>;
}) {
  const [search, setSearch] = useState("");
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});

  const stats = useMemo(() => {
    let adminPassive = 0;
    let tvClosed = 0;
    let todayClosed = 0;
    let manualClosed = 0;

    for (const product of products) {
      const entry = getProductAvailabilityEntry(product, availability);
      const closed = isProductClosedByEntry(entry, nowMs);

      if (product.active === false) adminPassive += 1;

      if (closed) {
        tvClosed += 1;
        if (entry?.mode === "today") todayClosed += 1;
        else manualClosed += 1;
      }
    }

    return {
      total: products.length,
      available: Math.max(0, products.length - adminPassive - tvClosed),
      closed: adminPassive + tvClosed,
      tvClosed,
      todayClosed,
      manualClosed,
      adminPassive,
    };
  }, [availability, nowMs, products]);

  const grouped = useMemo(() => {
    const q = normalizeProductText(search).toLowerCase();
    const map = new Map<string, TvProduct[]>();

    for (const product of products) {
      const name = normalizeProductText(product.name).toLowerCase();
      const category = normalizeProductText(product.category || "burger").toLowerCase();
      const sku = normalizeProductText(product.sku || product.code || product.id).toLowerCase();

      if (q && !name.includes(q) && !category.includes(q) && !sku.includes(q)) {
        continue;
      }

      const key = category || "burger";
      const arr = map.get(key) || [];
      arr.push(product);
      map.set(key, arr);
    }

    for (const arr of map.values()) {
      arr.sort((a, b) => normalizeProductText(a.name).localeCompare(normalizeProductText(b.name), "de"));
    }

    const keys = Array.from(map.keys()).sort((a, b) => {
      const ai = TV_PRODUCT_CATEGORY_ORDER.indexOf(a);
      const bi = TV_PRODUCT_CATEGORY_ORDER.indexOf(b);
      const ax = ai >= 0 ? ai : 999;
      const bx = bi >= 0 ? bi : 999;

      if (ax !== bx) return ax - bx;

      return a.localeCompare(b);
    });

    return keys.map((key) => ({
      key,
      label: productCategoryLabel(key),
      items: map.get(key) || [],
    }));
  }, [products, search]);

  const searchActive = normalizeProductText(search).length > 0;

  const toggleGroup = (key: string) => {
    setOpenGroups((current) => ({
      ...current,
      [key]: current[key] !== true,
    }));
  };

  const CountBox = ({ label, value }: { label: string; value: number }) => (
    <div className="rounded-xl border border-white/10 bg-white/[0.04] px-2.5 py-2">
      <div className="text-[10px] uppercase tracking-wide text-stone-400">{label}</div>
      <div className="mt-0.5 text-lg font-bold tabular-nums">{value}</div>
    </div>
  );

  return (
    <div className="space-y-3">
      <div>
        <div className="text-xs uppercase tracking-wider text-stone-300/70">Artikel</div>
        <div className="mt-1 text-xs text-stone-400">
          Admin-Aktiv bleibt unverändert. Änderungen hier werden in den DB-Settings gespeichert.
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <CountBox label="Gesamt" value={stats.total} />
        <CountBox label="Geschlossen" value={stats.closed} />
        <CountBox label="Heute" value={stats.todayClosed} />
        <CountBox label="Dauerhaft" value={stats.manualClosed + stats.adminPassive} />
      </div>

      <div className="rounded-2xl border border-white/10 bg-black/20 p-2">
        <label className="mb-1 block text-[11px] uppercase tracking-wide text-stone-400">
          Suche
        </label>
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Artikel suchen, z. B. Big"
          className="w-full rounded-xl border border-white/10 bg-black/35 px-3 py-2 text-sm text-stone-100 outline-none placeholder:text-stone-500 focus:border-emerald-400/60"
        />
        {searchActive && (
          <div className="mt-1 flex items-center justify-between text-[11px] text-stone-400">
            <span>{grouped.reduce((sum, group) => sum + group.items.length, 0)} Treffer</span>
            <button
              type="button"
              onClick={() => setSearch("")}
              className="rounded-full border border-white/10 px-2 py-0.5 hover:bg-white/10"
            >
              Suche löschen
            </button>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => onRefresh()}
          className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs hover:bg-white/10"
        >
          Aktualisieren
        </button>

        <div className="text-xs text-stone-400">
          Verfügbar: <span className="font-semibold text-emerald-100">{stats.available}</span>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-rose-400/40 bg-rose-500/15 p-2 text-xs text-rose-100">
          {error}
        </div>
      )}

      {grouped.length === 0 ? (
        <div className="rounded-xl border border-white/10 bg-white/[0.04] p-3 text-sm text-stone-300">
          Keine Artikel gefunden.
        </div>
      ) : (
        grouped.map((group) => {
          const groupClosed = group.items.filter((product) => {
            const entry = getProductAvailabilityEntry(product, availability);
            return product.active === false || isProductClosedByEntry(entry, nowMs);
          }).length;
          const collapsed = !searchActive && openGroups[group.key] !== true;

          return (
            <div key={group.key} className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.04]">
              <button
                type="button"
                onClick={() => toggleGroup(group.key)}
                className="flex w-full items-center justify-between gap-3 px-3 py-3 text-left hover:bg-white/[0.04]"
              >
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold">{group.label}</span>
                  <span className="rounded-full border border-white/10 bg-black/20 px-2 py-0.5 text-[11px] text-stone-300">
                    {group.items.length}
                  </span>
                  {groupClosed > 0 && (
                    <span className="rounded-full border border-rose-400/40 bg-rose-500/15 px-2 py-0.5 text-[11px] text-rose-100">
                      {groupClosed} geschlossen
                    </span>
                  )}
                </div>

                <span className="text-lg leading-none text-stone-300">
                  {collapsed ? "▸" : "▾"}
                </span>
              </button>

              {!collapsed && (
                <div className="space-y-2 border-t border-white/10 p-3 pt-2">
                  {group.items.map((product) => {
                    const key = productAvailabilityKey(product);
                    const entry = getProductAvailabilityEntry(product, availability);
                    const closed = isProductClosedByEntry(entry, nowMs);
                    const busy = busyKey === key;
                    const adminPassive = product.active === false;

                    return (
                      <div key={key || product.name} className="rounded-xl border border-white/10 bg-black/20 p-2">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <div className="font-medium leading-tight">{product.name}</div>
                            <div className="mt-0.5 text-[11px] text-stone-400">
                              {adminPassive ? "Admin: passiv" : productCloseLabel(entry, nowMs)}
                            </div>
                          </div>

                          <span
                            className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${
                              adminPassive
                                ? "border-stone-500/60 bg-stone-500/20 text-stone-200"
                                : closed
                                  ? "border-rose-400/50 bg-rose-500/15 text-rose-100"
                                  : "border-emerald-400/50 bg-emerald-500/15 text-emerald-100"
                            }`}
                          >
                            {adminPassive ? "Passiv" : closed ? "Geschlossen" : "Verfügbar"}
                          </span>
                        </div>

                        <div className="mt-2 grid grid-cols-3 gap-1.5 text-[11px]">
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => onChange(product, "open")}
                            className="rounded-lg border border-emerald-400/40 bg-emerald-500/10 px-2 py-1 text-emerald-100 disabled:opacity-40"
                          >
                            Öffnen
                          </button>

                          <button
                            type="button"
                            disabled={busy || adminPassive}
                            onClick={() => onChange(product, "today")}
                            className="rounded-lg border border-amber-400/40 bg-amber-500/10 px-2 py-1 text-amber-100 disabled:opacity-40"
                          >
                            Heute schließen
                          </button>

                          <button
                            type="button"
                            disabled={busy || adminPassive}
                            onClick={() => onChange(product, "manual")}
                            className="rounded-lg border border-rose-400/40 bg-rose-500/10 px-2 py-1 text-rose-100 disabled:opacity-40"
                          >
                            Dauerhaft schließen
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })
      )}
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