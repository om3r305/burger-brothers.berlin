// app/driver/page.tsx
"use client";

import DriverLiveTracker from "@/components/DriverLiveTracker";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  upsertOrder,
  setOrderStatus,
  type StoredOrder,
  type OrderStatus,
} from "@/lib/orders";
import { readSettings } from "@/lib/settings";

type Driver = { id: string; name: string; password: string };

type DriverTab = "new" | "mine";

type ApiOrderList = StoredOrder[];

const DRIVERS_KEY = "bb_drivers_v1";
const CURRENT_DRIVER_KEY = "bb_current_driver_v1";
const REMEMBER_KEY = "bb_driver_remember";
const LASTNAME_KEY = "bb_driver_lastname";
const LASTPASS_KEY = "bb_driver_lastpass_v2";
const DRIVER_LAST_REFRESH_KEY = "bb_driver_last_refresh_v1";

const SALT = "bb$kurier!2025";
const ACTIVE_UNKNOWN_GRACE_MS = 6 * 60 * 60 * 1000;
const REFRESH_MS = 6500;
const PULL_REFRESH_TRIGGER_PX = 72;
const PULL_REFRESH_MAX_PX = 96;
const COMPLETE_TOAST_MS = 4500;
const NOTE_PREVIEW_MAX = 92;

function enc(s: string) {
  try {
    return btoa(unescape(encodeURIComponent(SALT + s)));
  } catch {
    return "";
  }
}

function dec(s: string) {
  try {
    const raw = decodeURIComponent(escape(atob(s || "")));
    return raw.startsWith(SALT) ? raw.slice(SALT.length) : "";
  } catch {
    return "";
  }
}

function readDriversLocal(): Driver[] {
  try {
    return JSON.parse(localStorage.getItem(DRIVERS_KEY) || "[]");
  } catch {
    return [];
  }
}

async function readDriversFromDb(): Promise<Driver[]> {
  try {
    const res = await fetch("/api/drivers", {
      cache: "no-store",
      headers: {
        accept: "application/json",
      },
    });

    if (!res.ok) return readDriversLocal();

    const data = await res.json().catch(() => ({}));
    const raw = Array.isArray(data)
      ? data
      : Array.isArray(data?.drivers)
        ? data.drivers
        : Array.isArray(data?.items)
          ? data.items
          : [];

    const list = raw
      .map((driver: any) => ({
        id: String(driver?.id || driver?.name || "").trim(),
        name: String(driver?.name || driver?.title || "").trim(),
        password: String(driver?.password || driver?.pin || driver?.code || "").trim(),
      }))
      .filter((driver: Driver) => driver.id && driver.name && driver.password);

    if (list.length) {
      localStorage.setItem(DRIVERS_KEY, JSON.stringify(list));
      return list;
    }

    return readDriversLocal();
  } catch {
    return readDriversLocal();
  }
}

function getCurrentDriver(): Driver | null {
  try {
    return JSON.parse(localStorage.getItem(CURRENT_DRIVER_KEY) || "null");
  } catch {
    return null;
  }
}

function setCurrentDriver(driver: Driver | null) {
  if (driver) {
    localStorage.setItem(CURRENT_DRIVER_KEY, JSON.stringify(driver));
  } else {
    localStorage.removeItem(CURRENT_DRIVER_KEY);
  }
}

function sanitizePhone(phone?: string) {
  return String(phone || "").replace(/[^+\d]/g, "");
}

function mapsDirectionWebUrl(address: string) {
  return address
    ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}&travelmode=driving`
    : "https://www.google.com/maps";
}

function appleMapsUrl(address: string) {
  return address
    ? `https://maps.apple.com/?daddr=${encodeURIComponent(address)}&dirflg=d`
    : "https://maps.apple.com/";
}

function androidGeoUrl(address: string) {
  return address
    ? `geo:0,0?q=${encodeURIComponent(address)}`
    : "geo:0,0";
}

function googleNavigationUrl(address: string) {
  return address
    ? `google.navigation:q=${encodeURIComponent(address)}&mode=d`
    : "google.navigation:q=";
}

function isIOSDevice() {
  if (typeof navigator === "undefined") return false;

  const ua = navigator.userAgent || "";
  const platform = navigator.platform || "";

  return (
    /iPad|iPhone|iPod/i.test(ua) ||
    (platform === "MacIntel" && Number((navigator as any).maxTouchPoints || 0) > 1)
  );
}

function isAndroidDevice() {
  if (typeof navigator === "undefined") return false;
  return /Android/i.test(navigator.userAgent || "");
}

function isStandalonePwa() {
  if (typeof window === "undefined") return false;

  return (
    window.matchMedia?.("(display-mode: standalone)")?.matches ||
    window.matchMedia?.("(display-mode: fullscreen)")?.matches ||
    Boolean((navigator as any).standalone)
  );
}

function openExternalMap(address: string) {
  const cleanAddress = String(address || "").trim();

  if (!cleanAddress) {
    alert("Keine Adresse gefunden.");
    return;
  }

  /*
    Wichtig für iPhone/Android Home-Screen-App:
    Nicht window.open(..., "_blank") benutzen.
    In iOS-PWA öffnet das manchmal eine leere Browser-Ansicht, aus der man erst mit X zurückkommt.
    Deshalb auf Smartphones im gleichen Klick direkt in die jeweilige Maps-App / System-Maps wechseln.
  */
  if (isIOSDevice()) {
    window.location.href = appleMapsUrl(cleanAddress);
    return;
  }

  if (isAndroidDevice()) {
    const fallback = mapsDirectionWebUrl(cleanAddress);

    try {
      window.location.href = googleNavigationUrl(cleanAddress);

      window.setTimeout(() => {
        if (document.visibilityState === "visible") {
          window.location.href = androidGeoUrl(cleanAddress);
        }
      }, 700);

      window.setTimeout(() => {
        if (document.visibilityState === "visible") {
          window.location.href = fallback;
        }
      }, 1500);
    } catch {
      window.location.href = fallback;
    }

    return;
  }

  const webUrl = mapsDirectionWebUrl(cleanAddress);

  if (isStandalonePwa()) {
    window.location.href = webUrl;
    return;
  }

  const opened = window.open(webUrl, "_blank", "noopener,noreferrer");

  if (!opened) {
    window.location.href = webUrl;
  }
}

function cleanObj(value: any): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function cleanArr(value: any): any[] {
  return Array.isArray(value) ? value : [];
}

function num(value: any, fallback = 0) {
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

function normalizeMode(value: any): StoredOrder["mode"] {
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

function appTZ(settings: any) {
  return String(settings?.hours?.timezone || settings?.hours?.tz || "Europe/Berlin");
}

function pad2(n: number) {
  return n < 10 ? `0${n}` : String(n);
}

function dayKeyForMs(ms: number, tz: string) {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
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
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
  }
}

function todayKey(tz: string) {
  return dayKeyForMs(Date.now(), tz);
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

  for (let i = arr.length - 1; i >= 0; i -= 1) {
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

function getOrderCreatedMs(order: Partial<StoredOrder> | any): number | null {
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
    meta?.createdAtMs,
    meta?.ts,
    order?.ts,
  ];

  for (const candidate of candidates) {
    const ms = toMsStrict(candidate);
    if (ms != null) return ms;
  }

  return null;
}

function getOrderDoneMs(order: Partial<StoredOrder> | any): number | null {
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
    meta?.deliveredAtMs,
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

function isOrderForTodayOrFresh(order: StoredOrder, tz: string) {
  const status = normalizeStatus(order.status);
  const isFinal = status === "done" || status === "cancelled";
  const now = Date.now();
  const today = todayKey(tz);

  const idDay = orderDateFromId((order as any).orderId || order.id);
  const created = getOrderCreatedMs(order);
  const done = getOrderDoneMs(order);
  const mainMs = done ?? idDay ?? created ?? toMsStrict((order as any).ts);

  if (mainMs != null) {
    return dayKeyForMs(mainMs, tz) === today;
  }

  if (!isFinal) {
    const firstSeen = toMsStrict((order as any).meta?.firstSeenAt);
    if (firstSeen != null) return now - firstSeen <= ACTIVE_UNKNOWN_GRACE_MS;
  }

  return false;
}

function normalizeItems(value: any): StoredOrder["items"] {
  return cleanArr(value).map((item: any, index) => ({
    id: item?.id ? String(item.id) : `${item?.sku || item?.name || "item"}-${index}`,
    sku: item?.sku ? String(item.sku) : undefined,
    name: String(item?.name || item?.title || "Artikel"),
    category: item?.category ? String(item.category) : undefined,
    price: num(item?.price ?? item?.unitPrice),
    qty: Math.max(1, num(item?.qty ?? item?.quantity ?? 1, 1)),
    add: cleanArr(item?.add ?? item?.extras).map((extra: any) => ({
      label: extra?.label ? String(extra.label) : extra?.name ? String(extra.name) : undefined,
      name: extra?.name ? String(extra.name) : undefined,
      price: num(extra?.price),
    })),
    rm: cleanArr(item?.rm ?? item?.remove).map((entry) => String(entry)),
    note: item?.note ? String(item.note) : undefined,
  })) as StoredOrder["items"];
}

function normalizeOrdersPayload(data: any): ApiOrderList {
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
                  : [];

  return list
    .map((raw: any): StoredOrder | null => {
      try {
        /*
          Önemli:
          /api/orders/list response'unda top-level raw içinde id/status/mode var,
          raw.order ise bazen sadece payload (items/customer/meta) oluyor ve id içermeyebiliyor.
          Bu yüzden nested order/item/data sadece id veya orderId taşıyorsa ana kaynak yapılır.
          Aksi halde top-level raw korunur ki driver ekranında sipariş düşmeme problemi olmasın.
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

        const meta = cleanObj(source?.meta);
        const customer = cleanObj(source?.customer);
        const items = normalizeItems(source?.items);

        const id = String(source?.id || source?.orderId || "").trim();
        if (!id) return null;

        const orderId = String(source?.orderId || id);
        const mode = normalizeMode(source?.mode);
        const status = normalizeStatus(meta?.statusManual ?? source?.status);

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

        const createdMs = getOrderCreatedMs({
          ...source,
          id,
          orderId,
          meta,
        });

        return {
          ...(source as any),
          id,
          orderId,
          ts: createdMs ?? toMsStrict(source?.ts) ?? 0,
          createdAt: source?.createdAt || source?.created_at || meta?.createdAt || null,
          updatedAt: source?.updatedAt || source?.updated_at || null,
          mode,
          channel: source?.channel ? String(source.channel) : "web",
          status,
          planned: source?.planned ?? null,
          etaMin: source?.etaMin ?? null,
          etaAdjustMin:
            source?.etaAdjustMin ??
            meta?.etaAdjustMin ??
            meta?.etaAdjust ??
            meta?.etaDeltaMin ??
            0,
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
          driver: source?.driver ?? meta?.driver ?? null,
          driverName: source?.driverName || source?.driver?.name || meta?.driver?.name || "",
          note: String(note || ""),
          orderNote: source?.orderNote ? String(source.orderNote) : undefined,
        } as StoredOrder;
      } catch {
        return null;
      }
    })
    .filter(Boolean) as ApiOrderList;
}

async function fetchDriverOrdersFromDb(signal?: AbortSignal): Promise<ApiOrderList> {
  const endpoints = [
    `/api/orders/list?view=driver&includeDone=1&take=500&t=${Date.now()}`,
    `/api/orders/list?includeDone=1&take=500&t=${Date.now()}`,
    `/api/orders?includeDone=1&take=500&t=${Date.now()}`,
  ];

  let lastError: unknown = null;

  for (const endpoint of endpoints) {
    try {
      const res = await fetch(endpoint, {
        cache: "no-store",
        signal,
        headers: {
          accept: "application/json",
        },
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok || data?.ok === false) {
        throw new Error(data?.error || `HTTP ${res.status}`);
      }

      return normalizeOrdersPayload(data);
    } catch (error: any) {
      if (error?.name === "AbortError") throw error;
      lastError = error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error("DRIVER_ORDERS_FETCH_FAILED");
}

function prettyDeliveryLine(order: StoredOrder) {
  const customer = cleanObj(order?.customer);
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
    const zip = zipMatch ? zipMatch[0] : parts[1] || customer.zip || customer.plz || "";
    return [zip, street].filter(Boolean).join(" ");
  }

  return raw;
}


const STORE_ADDRESS_FALLBACK = "Burger Brothers Berlin, Berlin Tegel";

const ROUTE_PLZ_PRIORITY = [
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
];

function orderPlzValue(order: StoredOrder) {
  const customer = cleanObj(order?.customer);
  const direct = String(customer.plz || customer.zip || (order as any)?.plz || "").trim();
  if (/^\d{5}$/.test(direct)) return direct;

  const line = prettyDeliveryLine(order);
  const match = line.match(/\b\d{5}\b/);
  return match ? match[0] : "";
}

function routeRankForOrder(order: StoredOrder) {
  const plz = orderPlzValue(order);
  const index = ROUTE_PLZ_PRIORITY.indexOf(plz);
  return index >= 0 ? index : ROUTE_PLZ_PRIORITY.length + 99;
}

function getOrderRouteAddress(order: StoredOrder) {
  const customer = cleanObj(order?.customer);
  const line = prettyDeliveryLine(order);
  const address = String(
    line ||
      customer.address ||
      customer.addressLine ||
      [customer.plz || customer.zip, customer.street, customer.house].filter(Boolean).join(" "),
  ).trim();

  return address;
}

function storeOriginFromSettings(settings: any) {
  const contact = cleanObj(settings?.contact);
  const candidates = [
    contact.mapsAddress,
    contact.routeOrigin,
    contact.address,
    settings?.storeAddress,
    settings?.restaurantAddress,
    STORE_ADDRESS_FALLBACK,
  ];

  for (const candidate of candidates) {
    const text = String(candidate ?? "").trim();
    if (text) return text;
  }

  return STORE_ADDRESS_FALLBACK;
}

function sortOrdersForRoute(ordersToRoute: StoredOrder[]) {
  return ordersToRoute
    .map((order, index) => ({ order, index }))
    .sort((a, b) => {
      const rankDiff = routeRankForOrder(a.order) - routeRankForOrder(b.order);
      if (rankDiff !== 0) return rankDiff;

      const aPlz = orderPlzValue(a.order);
      const bPlz = orderPlzValue(b.order);
      if (aPlz !== bPlz) return aPlz.localeCompare(bPlz);

      const aCreated = getOrderCreatedMs(a.order) ?? a.order.ts ?? 0;
      const bCreated = getOrderCreatedMs(b.order) ?? b.order.ts ?? 0;
      if (aCreated !== bCreated) return aCreated - bCreated;

      return a.index - b.index;
    })
    .map((entry) => entry.order);
}

function uniqueRouteAddresses(ordersToRoute: StoredOrder[]) {
  const seen = new Set<string>();
  const addresses: string[] = [];

  for (const order of sortOrdersForRoute(ordersToRoute)) {
    const address = getOrderRouteAddress(order);
    const key = address.toLowerCase().replace(/\s+/g, " ").trim();

    if (!address || seen.has(key)) continue;

    seen.add(key);
    addresses.push(address);
  }

  return addresses;
}

function buildMultiStopMapsUrl(ordersToRoute: StoredOrder[], settings: any) {
  const stops = uniqueRouteAddresses(ordersToRoute);

  if (!stops.length) return "";

  if (stops.length === 1) {
    return mapsDirectionWebUrl(stops[0]);
  }

  const origin = storeOriginFromSettings(settings);
  const destination = stops[stops.length - 1];
  const waypoints = stops.slice(0, -1);
  const params = new URLSearchParams();

  params.set("api", "1");
  params.set("origin", origin);
  params.set("destination", destination);
  params.set("travelmode", "driving");

  if (waypoints.length) {
    params.set("waypoints", waypoints.join("|"));
  }

  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

function openMultiStopMapsRoute(ordersToRoute: StoredOrder[], settings: any) {
  const validOrders = ordersToRoute.filter((order) => getOrderRouteAddress(order));

  if (!validOrders.length) {
    alert("Keine Adresse für die Route gefunden.");
    return;
  }

  const url = buildMultiStopMapsUrl(validOrders, settings);

  if (!url) {
    alert("Route konnte nicht erstellt werden.");
    return;
  }

  if (isStandalonePwa() || isIOSDevice() || isAndroidDevice()) {
    window.location.href = url;
    return;
  }

  const opened = window.open(url, "_blank", "noopener,noreferrer");

  if (!opened) {
    window.location.href = url;
  }
}

function clearPosKey(id: string | number) {
  try {
    localStorage.removeItem(`bb_driverpos_${id}`);
  } catch {}
}

function orderDriver(order: StoredOrder): any {
  const meta = cleanObj((order as any).meta);
  const direct = cleanObj((order as any).driver);
  const metaDriver = cleanObj(meta?.driver);

  if (direct?.id || direct?.name) return direct;
  if (metaDriver?.id || metaDriver?.name) return metaDriver;

  return meta?.driverId || meta?.driverName
    ? {
        id: meta?.driverId,
        name: meta?.driverName,
      }
    : null;
}

function isDriverOrder(order: StoredOrder, current: Driver | null) {
  if (!current) return false;

  const driver = orderDriver(order);

  return (
    String(driver?.id || "") === String(current.id) ||
    String(driver?.name || "") === String(current.name)
  );
}

function orderTipAmount(order: StoredOrder): number {
  const meta = cleanObj((order as any).meta);
  const payment = cleanObj(meta.payment || (order as any).payment);

  const candidates = [
    payment.tip,
    payment.trinkgeld,
    payment.tipAmount,
    payment.trinkgeldAmount,
    meta.tip,
    meta.trinkgeld,
    meta.tipAmount,
    meta.trinkgeldAmount,
    (order as any).tip,
    (order as any).trinkgeld,
    (order as any).gratuity,
  ];

  for (const value of candidates) {
    const n = num(value);
    if (n > 0) return +n.toFixed(2);
  }

  return 0;
}

function orderPayableTotal(order: StoredOrder): number {
  const meta = cleanObj((order as any).meta);
  const payment = cleanObj(meta.payment || (order as any).payment);

  const candidates = [
    payment.payableTotal,
    payment.total,
    meta.payableTotal,
    meta.total,
    (order as any).payable,
    (order as any).toPay,
    (order as any).total,
    (order as any).amount,
  ];

  for (const value of candidates) {
    const n = num(value);
    if (n > 0) return +n.toFixed(2);
  }

  return 0;
}

function orderNote(order: StoredOrder): string {
  const meta = cleanObj((order as any).meta);
  const customer = cleanObj((order as any).customer);

  const candidates = [
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
    (order as any).lieferhinweis,
    (order as any).deliveryNote,
    (order as any).orderNote,
    (order as any).note,
  ];

  for (const value of candidates) {
    const text = String(value ?? "").trim();
    if (text) return text;
  }

  return "";
}

function compactText(value: any) {
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

function paymentTextFromOrder(order: StoredOrder) {
  const meta = cleanObj((order as any).meta);
  const payment = cleanObj(meta?.payment || (order as any)?.payment);
  const checkout = cleanObj(meta?.checkout || (order as any)?.checkout);

  return compactText(
    [
      (order as any)?.paymentMethod,
      (order as any)?.payment_method,
      (order as any)?.paymentType,
      (order as any)?.payment_type,
      (order as any)?.paymentProvider,
      (order as any)?.payment_provider,
      (order as any)?.paymentStatus,
      (order as any)?.payment_status,
      payment?.method,
      payment?.type,
      payment?.provider,
      payment?.status,
      payment?.paymentMethod,
      payment?.payment_method,
      payment?.paymentStatus,
      payment?.payment_status,
      checkout?.paymentMethod,
      checkout?.payment_method,
      checkout?.paymentStatus,
      checkout?.payment_status,
      meta?.paymentMethod,
      meta?.payment_method,
      meta?.paymentType,
      meta?.payment_type,
      meta?.paymentProvider,
      meta?.payment_provider,
      meta?.paymentStatus,
      meta?.payment_status,
      meta?.stripePaymentIntentId,
      meta?.paymentIntentId,
      meta?.checkoutSessionId,
    ]
      .filter((value) => value !== undefined && value !== null && value !== "")
      .join(" "),
  );
}

function orderIsOnlinePaid(order: StoredOrder) {
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

function DriverPaymentBadge({ order }: { order: StoredOrder }) {
  if (orderIsOnlinePaid(order)) {
    return (
      <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-emerald-300/45 bg-emerald-400/15 px-2.5 py-1 text-[11px] font-extrabold uppercase tracking-wide text-emerald-100 shadow-[0_0_16px_rgba(52,211,153,.12)]">
        <span aria-hidden="true">💶</span>
        Online
      </span>
    );
  }

  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-rose-300/45 bg-rose-500/15 px-2.5 py-1 text-[11px] font-extrabold uppercase tracking-wide text-rose-100 shadow-[0_0_16px_rgba(244,63,94,.12)]">
      <span>Bar</span>
      <span className="rounded-full bg-rose-300/20 px-1.5 py-0.5 text-[9px] leading-none text-rose-100">
        offen
      </span>
    </span>
  );
}

function isDrinkLikeItem(item: any) {
  const category = compactText(
    item?.category ??
      item?.categoryKey ??
      item?.cat ??
      item?.type ??
      item?.group ??
      item?.section,
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
      item?.sku,
      item?.code,
      item?.id,
      item?.name,
      item?.title,
      item?.label,
      item?.variant,
      item?.variantName,
    ]
      .filter(Boolean)
      .join(" "),
  );

  return /\b(drink|drinks|getrank|getranke|getraenk|getraenke|cola|coca|fanta|sprite|mezzo|wasser|water|ayran|uludag|jarritos|mate|club\s*mate|nestea|lipton|eistee|iced\s*tea|ice\s*tea|bubble\s*tea|bubbletea|boba|milk\s*tea|milktea|pepsi|capri|red\s*bull|vitamalz|fritz|schorle|saft|juice|limonade)\b/i.test(
    text,
  );
}

function orderHasDrinks(order: StoredOrder) {
  return cleanArr((order as any)?.items).some(isDrinkLikeItem);
}

function plannedValue(order: StoredOrder) {
  const meta = cleanObj((order as any).meta);

  return String(
    (order as any)?.planned ??
      meta?.planned ??
      meta?.plannedTime ??
      meta?.planned_time ??
      meta?.preorderTime ??
      meta?.preorder_time ??
      "",
  ).trim();
}

function isPlannedClaimOrder(order: StoredOrder) {
  return Boolean(plannedValue(order));
}

function confirmPlannedClaim(ordersToClaim: StoredOrder[]) {
  const plannedOrders = ordersToClaim.filter(isPlannedClaimOrder);

  if (!plannedOrders.length) return true;

  const lines = plannedOrders.slice(0, 6).map((order) => {
    const planned = plannedValue(order);
    const address = prettyDeliveryLine(order);
    return `#${(order as any).orderId || order.id}${planned ? ` · Geplant: ${planned}` : ""}${
      address ? ` · ${address}` : ""
    }`;
  });

  const rest =
    plannedOrders.length > lines.length
      ? [`… und ${plannedOrders.length - lines.length} weitere geplante Bestellung(en).`]
      : [];

  return window.confirm(
    [
      "Achtung: Sie übernehmen eine geplante Bestellung.",
      "Bitte prüfen, ob der Kunde die Lieferung wirklich jetzt möchte.",
      "",
      ...lines,
      ...rest,
      "",
      "Möchten Sie wirklich übernehmen?",
    ].join("\n"),
  );
}

function DrinkOrderNotice({ order }: { order: StoredOrder }) {
  if (!orderHasDrinks(order)) return null;

  return (
    <div className="mt-2 rounded-xl border border-amber-300/35 bg-amber-400/10 px-3 py-2 text-sm font-semibold text-amber-50">
      ⚠️ Getränke dabei – bitte beachten.
    </div>
  );
}

function withDriverState(
  order: StoredOrder,
  current: Driver | null,
  status: OrderStatus,
  metaPatch: Record<string, any> = {},
): StoredOrder {
  const previousMeta = cleanObj((order as any).meta);
  const driver = current
    ? {
        id: current.id,
        name: current.name,
      }
    : null;

  return {
    ...(order as any),
    status,
    driver,
    meta: {
      ...previousMeta,
      ...metaPatch,
      driver,
      driverId: current ? current.id : null,
      driverName: current ? current.name : null,
      statusManual: status,
      statusUpdatedAt: Date.now(),
    },
  } as StoredOrder;
}

async function persistDriverOrderSnapshot(
  order: StoredOrder,
  fallbackStatus: OrderStatus,
  by = "driver",
) {
  upsertOrder(order as any);

  const res = await fetch("/api/orders", {
    method: "PUT",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({
      orders: [order],
      replace: false,
    }),
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok || data?.ok === false) {
    await setOrderStatus(order.id, fallbackStatus, by);
    throw new Error(data?.error || `HTTP ${res.status}`);
  }

  try {
    window.dispatchEvent(new CustomEvent("bb:refresh-orders"));
  } catch {}

  return data;
}

async function claimOrderOnServer(order: StoredOrder, current: Driver) {
  const res = await fetch("/api/orders/claim", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({
      id: order.id,
      orderId: (order as any).orderId || order.id,
      driver: {
        id: current.id,
        name: current.name,
      },
      by: current.name,
    }),
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok || data?.ok === false) {
    throw new Error(
      data?.message ||
        data?.error ||
        "Dieser Auftrag konnte nicht übernommen werden.",
    );
  }

  const claimed = (data?.order || data?.item || data?.data) as StoredOrder | undefined;

  if (!claimed?.id) {
    throw new Error("Auftrag wurde übernommen, aber die Antwort war unvollständig.");
  }

  try {
    upsertOrder(claimed as any);
    window.dispatchEvent(new CustomEvent("bb:refresh-orders"));
  } catch {}

  return claimed;
}

async function updateOrderStatusOnServer(
  order: StoredOrder,
  status: OrderStatus,
  current: Driver | null,
  metaPatch: Record<string, any> = {},
) {
  const by = current?.name || "driver";
  const driver = current
    ? {
        id: current.id,
        name: current.name,
      }
    : null;

  const nextMeta = {
    ...cleanObj((order as any).meta),
    ...metaPatch,
    driver,
    driverId: current ? current.id : null,
    driverName: current ? current.name : null,
    statusManual: status,
    statusUpdatedAt: Date.now(),
  };

  const body = {
    id: order.id,
    orderId: (order as any).orderId || order.id,
    status,
    nextStatus: status,
    by,
    driver,
    driverId: current ? current.id : null,
    driverName: current ? current.name : null,
    metaPatch,
    meta: nextMeta,
  };

  const attempts: Array<{ url: string; method: "POST" | "PUT" | "PATCH" }> = [
    { url: "/api/orders/status", method: "POST" },
    { url: "/api/orders/status", method: "PUT" },
    { url: "/api/orders/status", method: "PATCH" },
  ];

  let lastMessage = "";

  for (const attempt of attempts) {
    try {
      const res = await fetch(attempt.url, {
        method: attempt.method,
        headers: {
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify(body),
      });

      const data = await res.json().catch(() => ({}));

      if (res.ok && data?.ok !== false) {
        return (data?.order || data?.item || data?.data || null) as StoredOrder | null;
      }

      lastMessage =
        data?.message ||
        data?.error ||
        `${attempt.method} ${attempt.url} HTTP ${res.status}`;
    } catch (error: any) {
      lastMessage = error?.message || String(error);
    }
  }

  /*
    Fallback:
    Localde çalışan eski helper bazı ortamlarda yeterli oluyor.
    Vercel'de asıl güvenli yol /api/orders/status olduğu için önce onu deniyoruz.
  */
  try {
    await setOrderStatus(order.id, status, by);
    return null;
  } catch (error: any) {
    throw new Error(lastMessage || error?.message || "Status konnte nicht gespeichert werden.");
  }
}

const glass =
  "backdrop-blur-xl bg-white/5 border border-white/15 " +
  "shadow-[inset_0_1px_0_0_rgba(255,255,255,.18)] ring-1 ring-black/20";

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
  const meta = cleanObj((order as any).meta);
  const base = num(
    (order as any).etaMin ??
      meta?.etaMin ??
      meta?.eta ??
      (order.mode === "pickup" ? avgPickup : avgDelivery),
    order.mode === "pickup" ? avgPickup : avgDelivery,
  );

  /*
    TV tarafındaki -5 / +5 genelde etaAdjustMin alanına yazılıyor.
    Driver ekranı da aynı süreyi göstersin diye bu değeri burada hesaba katıyoruz.
  */
  const adjust = num(
    (order as any).etaAdjustMin ??
      meta?.etaAdjustMin ??
      meta?.etaAdjust ??
      meta?.etaDeltaMin,
    0,
  );

  return Math.max(0, base + adjust);
}

function remainingMinutes(
  order: StoredOrder,
  avgPickup: number,
  avgDelivery: number,
  tz: string,
) {
  const eta = etaFor(order, avgPickup, avgDelivery);
  const planned = plannedStartMs(order, tz);
  const start = planned && planned > Date.now()
    ? planned
    : getOrderCreatedMs(order) ?? order.ts ?? Date.now();

  return Math.max(0, Math.floor((start + eta * 60_000 - Date.now()) / 60_000));
}

function formatMoney(value: number | undefined) {
  const number = Number.isFinite(Number(value)) ? Number(value) : 0;
  return `${number.toFixed(2)}€`;
}

function orderItemsTotal(order: StoredOrder) {
  const items = Array.isArray(order.items) ? order.items : [];

  return items.reduce((sum: number, item: any) => {
    const qty = Math.max(1, num(item?.qty, 1));
    const extras = cleanArr(item?.add).reduce((extraSum, extra: any) => {
      return extraSum + num(extra?.price);
    }, 0);

    return sum + (num(item?.price) + extras) * qty;
  }, 0);
}

function orderDisplayTotal(order: StoredOrder) {
  const total = orderPayableTotal(order);
  if (total > 0) return total;
  return orderItemsTotal(order);
}

function shortText(value: string, max = NOTE_PREVIEW_MAX) {
  const text = String(value || "").replace(/\s+/g, " ").trim();

  if (text.length <= max) return text;

  return `${text.slice(0, max).trim()}…`;
}

function actionButtonClass(kind: "ghost" | "map" | "finish" | "danger" = "ghost") {
  const base =
    "rounded-xl px-3 py-2.5 text-sm font-bold transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50";

  if (kind === "finish") {
    return `${base} border border-emerald-300/60 bg-gradient-to-b from-emerald-300 to-emerald-500 text-black shadow-[0_0_20px_rgba(52,211,153,.24)] hover:from-emerald-200 hover:to-emerald-400`;
  }

  if (kind === "map") {
    return `${base} border border-sky-300/45 bg-sky-400/15 text-sky-100 shadow-[0_0_16px_rgba(56,189,248,.10)] hover:bg-sky-400/25`;
  }

  if (kind === "danger") {
    return `${base} border border-rose-300/35 bg-rose-500/10 text-rose-100 hover:bg-rose-500/20`;
  }

  return `${base} border border-white/15 bg-white/[0.06] text-stone-100 hover:bg-white/12`;
}

function tabButtonClass(active: boolean, tone: "new" | "mine") {
  const base =
    "rounded-2xl py-2 text-sm font-extrabold tracking-wide transition active:scale-[0.99]";

  if (!active) {
    return `${base} border border-transparent text-stone-300/90 hover:border-white/10 hover:bg-white/[0.06]`;
  }

  if (tone === "new") {
    return `${base} border border-amber-300/45 bg-gradient-to-b from-amber-400/35 to-orange-500/25 text-amber-50 shadow-[0_0_18px_rgba(251,146,60,.18)]`;
  }

  return `${base} border border-emerald-300/45 bg-gradient-to-b from-emerald-400/30 to-sky-500/20 text-emerald-50 shadow-[0_0_18px_rgba(52,211,153,.16)]`;
}


function DriverStatCard({
  icon,
  label,
  value,
  tone,
}: {
  icon: string;
  label: string;
  value: React.ReactNode;
  tone: "blue" | "gold" | "green";
}) {
  const toneClass = {
    blue: {
      card: "border-sky-300/15 bg-sky-500/10",
      icon: "border-sky-300/25 bg-sky-400/15 text-sky-200 shadow-[0_0_16px_rgba(56,189,248,.10)]",
      label: "text-sky-100/70",
    },
    gold: {
      card: "border-amber-300/15 bg-amber-400/10",
      icon: "border-amber-300/25 bg-amber-400/15 text-amber-200 shadow-[0_0_16px_rgba(251,191,36,.10)]",
      label: "text-amber-100/70",
    },
    green: {
      card: "border-emerald-300/15 bg-emerald-400/10",
      icon: "border-emerald-300/25 bg-emerald-400/15 text-emerald-200 shadow-[0_0_16px_rgba(52,211,153,.10)]",
      label: "text-emerald-100/70",
    },
  }[tone];

  return (
    <div className={`rounded-xl border px-2.5 py-2 ${toneClass.card}`}>
      <div className="flex items-center gap-2.5">
        <div
          className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl border text-lg ${toneClass.icon}`}
          aria-hidden="true"
        >
          {icon}
        </div>

        <div className="min-w-0">
          <div className={`text-[10px] font-bold uppercase tracking-wide ${toneClass.label}`}>
            {label}
          </div>
          <div className="mt-0.5 truncate text-sm font-extrabold text-stone-50 sm:text-base">
            {value}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function DriverPage() {
  useEffect(() => {
    const footer = document.querySelector("footer") as HTMLElement | null;
    const previous = footer?.style.display || "";

    if (footer) footer.style.display = "none";

    return () => {
      if (footer) footer.style.display = previous;
    };
  }, []);

  const [tab, setTab] = useState<DriverTab>("new");
  const [loading, setLoading] = useState(false);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [current, setCurrent] = useState<Driver | null>(null);
  const [remember, setRemember] = useState(true);
  const [loginName, setLoginName] = useState("");
  const [loginPass, setLoginPass] = useState("");
  const [orders, setOrders] = useState<StoredOrder[]>([]);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [routeSelected, setRouteSelected] = useState<Record<string, boolean>>({});
  const [openMap, setOpenMap] = useState<Record<string, boolean>>({});
  const [noteExpanded, setNoteExpanded] = useState<Record<string, boolean>>({});
  const [completeToast, setCompleteToast] = useState<{
    id: string;
    tip: number;
    total: number;
  } | null>(null);
  const [lastRefreshAt, setLastRefreshAt] = useState<number | null>(null);
  const [refreshError, setRefreshError] = useState("");
  const [manualRefreshing, setManualRefreshing] = useState(false);
  const [pullDistance, setPullDistance] = useState(0);
  const [pullRefreshing, setPullRefreshing] = useState(false);

  const settings = readSettings() as any;
  const tz = appTZ(settings);
  const avgPickup = Number(settings?.hours?.avgPickupMinutes ?? 15);
  const avgDelivery = Number(settings?.hours?.avgDeliveryMinutes ?? 35);

  const refreshAbortRef = useRef<AbortController | null>(null);
  const refreshRunningRef = useRef(false);
  const latestOrdersRef = useRef<StoredOrder[]>([]);
  const pullStartYRef = useRef<number | null>(null);
  const pullActiveRef = useRef(false);
  const completeToastTimerRef = useRef<number | null>(null);

  const [, setTick] = useState(0);

  useEffect(() => {
    const id = window.setInterval(() => setTick((value) => value + 1), 30_000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    return () => {
      if (completeToastTimerRef.current != null) {
        window.clearTimeout(completeToastTimerRef.current);
      }
    };
  }, []);

  const refresh = useCallback(
    async (force = false) => {
      if (refreshRunningRef.current && !force) return;

      if (force && refreshAbortRef.current) {
        refreshAbortRef.current.abort();
      }

      const controller = new AbortController();

      refreshAbortRef.current = controller;
      refreshRunningRef.current = true;

      try {
        const all = await fetchDriverOrdersFromDb(controller.signal);

        const visible = all
          .filter((order) => normalizeMode(order.mode) === "delivery")
          .filter((order) => !((order as any).archivedAt || (order as any).anonymizedAt))
          .filter((order) => isOrderForTodayOrFresh(order, tz));

        latestOrdersRef.current = visible;
        setOrders(visible);
        setRefreshError("");

        const now = Date.now();
        setLastRefreshAt(now);

        try {
          localStorage.setItem(DRIVER_LAST_REFRESH_KEY, String(now));
        } catch {}
      } catch (error: any) {
        if (error?.name !== "AbortError") {
          console.error("Driver refresh failed", error);
          setRefreshError("Siparişler yenilenemedi. Bağlantıyı kontrol et.");
        }
      } finally {
        if (refreshAbortRef.current === controller) {
          refreshAbortRef.current = null;
        }

        refreshRunningRef.current = false;
      }
    },
    [tz],
  );

  useEffect(() => {
    let alive = true;

    readDriversFromDb().then((list) => {
      if (alive) setDrivers(list);
    });

    const remembered = localStorage.getItem(REMEMBER_KEY);
    if (remembered !== null) setRemember(remembered === "1");

    const lastName = localStorage.getItem(LASTNAME_KEY);
    if (lastName) setLoginName(lastName);

    const lastPass = localStorage.getItem(LASTPASS_KEY);
    if (lastPass && remembered === "1") setLoginPass(dec(lastPass));

    const currentDriver = getCurrentDriver();
    if (currentDriver) setCurrent(currentDriver);

    const previousRefresh = toMsStrict(localStorage.getItem(DRIVER_LAST_REFRESH_KEY));
    if (previousRefresh) setLastRefreshAt(previousRefresh);

    void refresh(true);

    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void refresh(false);
      }
    }, REFRESH_MS);

    const onFocus = () => {
      void refresh(true);
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        void refresh(true);
      }
    };

    const onOrders = () => {
      void refresh(true);
    };

    window.addEventListener("focus", onFocus);
    window.addEventListener("bb:refresh-orders", onOrders as EventListener);
    window.addEventListener("bb_orders_changed", onOrders as EventListener);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      alive = false;
      window.clearInterval(interval);
      refreshAbortRef.current?.abort();
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("bb:refresh-orders", onOrders as EventListener);
      window.removeEventListener("bb_orders_changed", onOrders as EventListener);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [refresh]);

  useEffect(() => {
    if (!current) {
      const remembered = localStorage.getItem(REMEMBER_KEY) === "1";
      const lastName = localStorage.getItem(LASTNAME_KEY);
      const lastPass = localStorage.getItem(LASTPASS_KEY);

      if (lastName) setLoginName(lastName);
      if (remembered && lastPass) setLoginPass(dec(lastPass));
    }
  }, [current]);

  const pending = useMemo(
    () =>
      orders
        .filter((order) => {
          const status = normalizeStatus(order.status);
          return (
            normalizeMode(order.mode) === "delivery" &&
            !orderDriver(order)?.id &&
            status !== "out_for_delivery" &&
            status !== "done" &&
            status !== "cancelled"
          );
        })
        .sort((a, b) => {
          const left = getOrderCreatedMs(a) ?? a.ts ?? 0;
          const right = getOrderCreatedMs(b) ?? b.ts ?? 0;
          return left - right;
        }),
    [orders],
  );

  const mine = useMemo(() => {
    if (!current) return [];

    return orders
      .filter((order) => {
        const status = normalizeStatus(order.status);
        return (
          isDriverOrder(order, current) &&
          status !== "done" &&
          status !== "cancelled"
        );
      })
      .sort((a, b) => {
        const left = getOrderCreatedMs(a) ?? a.ts ?? 0;
        const right = getOrderCreatedMs(b) ?? b.ts ?? 0;
        return left - right;
      });
  }, [orders, current]);

  const selectedRouteOrders = useMemo(
    () => mine.filter((order) => routeSelected[String(order.id)]),
    [mine, routeSelected],
  );

  const eod = useMemo(() => {
    if (!current) return { count: 0, total: 0, tip: 0 };

    const today = todayKey(tz);

    const list = orders.filter((order) => {
      if (!isDriverOrder(order, current)) return false;
      if (normalizeStatus(order.status) !== "done") return false;

      const doneMs = getOrderDoneMs(order);
      if (doneMs == null) return false;

      return dayKeyForMs(doneMs, tz) === today;
    });

    return {
      count: list.length,
      total: list.reduce((sum, order) => sum + orderDisplayTotal(order), 0),
      tip: list.reduce((sum, order) => sum + orderTipAmount(order), 0),
    };
  }, [orders, current, tz]);

  const liveTrackingActive = current && mine.length > 0;

  function handleLogin(event?: React.FormEvent) {
    event?.preventDefault();

    const driver = drivers.find(
      (item) => item.name === loginName && item.password === loginPass,
    );

    if (!driver) {
      alert("Ungültiger Benutzer / Passwort. Bitte Admin kontaktieren.");
      return;
    }

    setCurrent(driver);
    localStorage.setItem(LASTNAME_KEY, loginName || driver.name);

    if (remember) {
      setCurrentDriver(driver);
      localStorage.setItem(REMEMBER_KEY, "1");
      localStorage.setItem(LASTPASS_KEY, enc(loginPass));
    } else {
      setCurrentDriver(null);
      localStorage.setItem(REMEMBER_KEY, "0");
      localStorage.removeItem(LASTPASS_KEY);
    }

    setLoginPass("");
    void refresh(true);
  }

  function handleLogout() {
    try {
      const me = getCurrentDriver();

      const active = latestOrdersRef.current.filter(
        (order) =>
          isDriverOrder(order, me) &&
          normalizeStatus(order.status) !== "done" &&
          normalizeStatus(order.status) !== "cancelled",
      );

      for (const order of active) clearPosKey(order.id);
    } catch {}

    setCurrent(null);
    setCurrentDriver(null);
  }

  function toggleSelect(id: string | number) {
    setSelected((state) => ({
      ...state,
      [String(id)]: !state[String(id)],
    }));
  }


  function toggleRouteSelect(id: string | number) {
    setRouteSelected((state) => ({
      ...state,
      [String(id)]: !state[String(id)],
    }));
  }

  function clearRouteSelection() {
    setRouteSelected({});
  }

  function openSelectedRoute() {
    if (!selectedRouteOrders.length) {
      alert("Bitte zuerst eine oder mehrere Lieferungen für die Route auswählen.");
      return;
    }

    openMultiStopMapsRoute(selectedRouteOrders, settings);
  }

  async function claimSelected() {
    if (!current) {
      alert("Bitte zuerst anmelden.");
      return;
    }

    const ids = Object.keys(selected).filter((key) => selected[key]);

    if (!ids.length) {
      alert("Keine Auswahl.");
      return;
    }

    const selectedOrders = ids
      .map((id) => orders.find((item) => String(item.id) === id))
      .filter(Boolean) as StoredOrder[];

    if (!confirmPlannedClaim(selectedOrders)) {
      return;
    }

    setLoading(true);

    try {
      const errors: string[] = [];

      for (const order of selectedOrders) {
        const id = String(order.id);

        try {
          const claimed = await claimOrderOnServer(order, current);

          setOrders((prev) =>
            prev.map((item) => (String(item.id) === String(order.id) ? claimed : item)),
          );
        } catch (error: any) {
          errors.push(`#${id}: ${error?.message || "konnte nicht übernommen werden"}`);
        }
      }

      setSelected({});
      await refresh(true);
      setTab("mine");

      if (errors.length) {
        alert(errors.join("\n"));
      }
    } finally {
      setLoading(false);
    }
  }

  async function claimOne(order: StoredOrder) {
    if (!current) {
      alert("Bitte zuerst anmelden.");
      return;
    }

    if (!confirmPlannedClaim([order])) {
      return;
    }

    setLoading(true);

    try {
      const claimed = await claimOrderOnServer(order, current);

      setOrders((prev) =>
        prev.map((item) => (String(item.id) === String(order.id) ? claimed : item)),
      );

      await refresh(true);
      setTab("mine");
    } catch (error: any) {
      await refresh(true);
      alert(error?.message || "Dieser Auftrag konnte nicht übernommen werden.");
    } finally {
      setLoading(false);
    }
  }

  function showCompleteToast(info: { id: string; tip: number; total: number }) {
    setCompleteToast(info);

    if (completeToastTimerRef.current != null) {
      window.clearTimeout(completeToastTimerRef.current);
    }

    completeToastTimerRef.current = window.setTimeout(() => {
      setCompleteToast(null);
      completeToastTimerRef.current = null;
    }, COMPLETE_TOAST_MS);
  }

  async function releaseOne(order: StoredOrder) {
    if (!current) return;

    if (!isDriverOrder(order, current)) {
      alert("Dieser Auftrag gehört nicht Ihnen.");
      return;
    }

    setLoading(true);

    try {
      clearPosKey(order.id);

      const updated = withDriverState(order, null, "preparing", {
        claimedAt: null,
        lastPos: null,
      });

      setOrders((prev) =>
        prev.map((item) => (String(item.id) === String(order.id) ? updated : item)),
      );

      await persistDriverOrderSnapshot(updated, "preparing", current.name);
      await refresh(true);
      setTab("new");
    } finally {
      setLoading(false);
    }
  }

  async function finishOne(order: StoredOrder) {
    if (!current) return;
    if (!confirm("Bestätigung: Lieferung abgeschlossen?")) return;

    setLoading(true);

    const before = order;

    try {
      clearPosKey(order.id);

      const now = Date.now();
      const tip = orderTipAmount(order);
      const total = orderPayableTotal(order);
      const updated = withDriverState(order, current, "done", {
        deliveredAt: now,
        doneAt: now,
        completedAt: now,
        lastPos: null,
        lastDriverPos: null,
        lastDriverPosAt: null,
      });

      // Optimistisch aus "Meine" entfernen, damit der Fahrer sofort Feedback bekommt.
      setOrders((prev) =>
        prev.map((item) => (String(item.id) === String(order.id) ? updated : item)),
      );

      const serverOrder = await updateOrderStatusOnServer(updated, "done", current, {
        deliveredAt: now,
        doneAt: now,
        completedAt: now,
        lastPos: null,
        lastDriverPos: null,
        lastDriverPosAt: null,
      });

      const normalizedServerOrder = serverOrder
        ? normalizeOrdersPayload([serverOrder])[0]
        : null;

      const finalOrder = normalizedServerOrder || updated;

      try {
        upsertOrder(finalOrder as any);
      } catch {}

      setOrders((prev) =>
        prev.map((item) => (String(item.id) === String(order.id) ? finalOrder : item)),
      );

      showCompleteToast({
        id: String(order.id),
        tip,
        total,
      });

      try {
        window.dispatchEvent(new CustomEvent("bb:refresh-orders"));
        window.dispatchEvent(new CustomEvent("bb_orders_changed"));
      } catch {}

      await refresh(true).catch(() => undefined);
    } catch (error: any) {
      setOrders((prev) =>
        prev.map((item) => (String(item.id) === String(order.id) ? before : item)),
      );

      await refresh(true).catch(() => undefined);

      alert(
        error?.message ||
          "Status konnte nicht gespeichert werden. Bitte erneut prüfen.",
      );
    } finally {
      setLoading(false);
    }
  }

  function callCustomer(phone?: string) {
    const clean = sanitizePhone(phone);

    if (!clean) {
      alert("Keine Telefonnummer.");
      return;
    }

    window.location.href = `tel:${clean}`;
  }

  function openMaps(order: StoredOrder) {
    const address = prettyDeliveryLine(order) || order.customer?.address || "";
    openExternalMap(address);
  }

  async function manualRefresh() {
    setManualRefreshing(true);

    try {
      await refresh(true);
    } finally {
      setManualRefreshing(false);
    }
  }

  async function pullRefresh() {
    if (pullRefreshing || manualRefreshing) return;

    setPullRefreshing(true);

    try {
      await refresh(true);
    } finally {
      setPullRefreshing(false);
      setPullDistance(0);
      pullStartYRef.current = null;
      pullActiveRef.current = false;
    }
  }

  function onPullStart(event: React.TouchEvent<HTMLElement>) {
    if (window.scrollY > 0 || loading || pullRefreshing || manualRefreshing) return;

    pullStartYRef.current = event.touches[0]?.clientY ?? null;
    pullActiveRef.current = true;
  }

  function onPullMove(event: React.TouchEvent<HTMLElement>) {
    if (!pullActiveRef.current || pullStartYRef.current == null) return;

    if (window.scrollY > 0) {
      setPullDistance(0);
      pullActiveRef.current = false;
      pullStartYRef.current = null;
      return;
    }

    const currentY = event.touches[0]?.clientY ?? 0;
    const diff = currentY - pullStartYRef.current;

    if (diff <= 0) {
      setPullDistance(0);
      return;
    }

    setPullDistance(Math.min(PULL_REFRESH_MAX_PX, Math.round(diff * 0.55)));
  }

  function onPullEnd() {
    if (!pullActiveRef.current) return;

    const shouldRefresh = pullDistance >= PULL_REFRESH_TRIGGER_PX;

    pullActiveRef.current = false;
    pullStartYRef.current = null;

    if (shouldRefresh) {
      void pullRefresh();
    } else {
      setPullDistance(0);
    }
  }

  function TimeBadge({ order }: { order: StoredOrder }) {
    const left = remainingMinutes(order, avgPickup, avgDelivery, tz);
    const plannedMs = plannedStartMs(order, tz);
    const plannedFuture = !!plannedMs && plannedMs > Date.now();
    const createdMs = getOrderCreatedMs(order) ?? order.ts;
    const created = createdMs
      ? new Date(createdMs).toLocaleTimeString("de-DE", {
          hour: "2-digit",
          minute: "2-digit",
        })
      : "-";

    return (
      <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] text-stone-300/90">
        {plannedFuture ? (
          <span className="rounded-full border border-amber-400/40 bg-amber-500/15 px-2 py-0.5">
            Geplant: <b>{String(order.planned)}</b>
          </span>
        ) : (
          <span
            className={`rounded-full border px-2 py-0.5 ${
              left <= 5
                ? "border-rose-400/50 bg-rose-500/15 text-rose-100"
                : left <= 15
                  ? "border-amber-400/50 bg-amber-500/15 text-amber-100"
                  : "border-sky-400/40 bg-sky-500/15 text-sky-100"
            }`}
          >
            Rest: <b>{pad2(left)}′</b>
          </span>
        )}

        <span className="rounded-full border border-stone-500/40 bg-stone-500/10 px-2 py-0.5">
          Erstellt: {created}
        </span>
      </div>
    );
  }

  function OrderWithDetails({
    order,
    routeSelected: isRouteSelected,
    onToggleRouteSelect,
  }: {
    order: StoredOrder;
    routeSelected: boolean;
    onToggleRouteSelect: (id: string | number) => void;
  }) {
    const open = !!openMap[String(order.id)];
    const noteOpen = !!noteExpanded[String(order.id)];
    const items = Array.isArray(order.items) ? order.items : [];
    const sum = orderItemsTotal(order);
    const noteText = orderNote(order);
    const notePreview = shortText(noteText);
    const noteLong = noteText.trim().length > NOTE_PREVIEW_MAX;

    return (
      <div className={`rounded-2xl p-3 sm:p-4 ${glass}`}>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-start gap-2">
              <div className="break-all text-[15px] font-extrabold sm:text-base">#{order.id}</div>
              <span className="rounded-full border border-orange-400/50 bg-orange-500/15 px-2 py-0.5 text-xs text-orange-100">
                Lieferung
              </span>
              <div className="ml-auto flex shrink-0 items-center gap-2">
                <label className="inline-flex items-center gap-1.5 rounded-full border border-sky-300/25 bg-sky-400/10 px-2.5 py-1 text-[11px] font-extrabold uppercase tracking-wide text-sky-100">
                  <input
                    type="checkbox"
                    className="h-3.5 w-3.5 accent-sky-400"
                    checked={isRouteSelected}
                    onChange={() => onToggleRouteSelect(order.id)}
                  />
                  Route
                </label>
                <DriverPaymentBadge order={order} />
              </div>
            </div>

            <div className="mt-1.5 text-sm">
              {order.customer?.name || "-"} · {order.customer?.phone || "-"}
            </div>

            <div className="mt-0.5 text-sm font-semibold text-stone-200">
              {prettyDeliveryLine(order)}
            </div>

            <DrinkOrderNotice order={order} />

            {noteText && (
              <div className="mt-2 rounded-xl border border-amber-300/35 bg-amber-400/10 p-2.5 text-sm text-amber-50">
                <div className="mb-1 text-[11px] font-extrabold uppercase tracking-wide text-amber-200">
                  Lieferhinweis
                </div>
                <div className="whitespace-pre-wrap leading-relaxed">
                  {noteOpen ? noteText : notePreview}
                </div>

                {noteLong && (
                  <button
                    type="button"
                    className="mt-2 text-xs font-semibold text-amber-200 underline underline-offset-4"
                    onClick={() =>
                      setNoteExpanded((state) => ({
                        ...state,
                        [String(order.id)]: !noteOpen,
                      }))
                    }
                  >
                    {noteOpen ? "Weniger anzeigen" : "Mehr anzeigen"}
                  </button>
                )}
              </div>
            )}

            <TimeBadge order={order} />

            <button
              className="mt-2 text-sm underline underline-offset-4 opacity-90 hover:opacity-100"
              type="button"
              onClick={() =>
                setOpenMap((state) => ({
                  ...state,
                  [String(order.id)]: !open,
                }))
              }
            >
              {open ? "Details verbergen" : "Details anzeigen"}
            </button>

            {open && (
              <div className="mt-3 space-y-3">
                <div className="overflow-hidden rounded-xl border border-white/10">
                  <table className="w-full text-sm">
                    <thead className="bg-white/5">
                      <tr>
                        <th className="p-2 text-left">Artikel</th>
                        <th className="p-2 text-right">Menge</th>
                        <th className="p-2 text-right">Summe</th>
                      </tr>
                    </thead>

                    <tbody>
                      {items.map((item: any, index: number) => {
                        const qty = Math.max(1, num(item.qty, 1));
                        const extras = cleanArr(item.add);
                        const remove = cleanArr(item.rm);
                        const extrasTotal = extras.reduce((total: number, extra: any) => {
                          return total + num(extra?.price);
                        }, 0);
                        const line = qty * (num(item.price) + extrasTotal);
                        const itemNote = item.note ? String(item.note) : "";

                        return (
                          <tr key={`${item?.id || item?.sku || item?.name || "item"}-${index}`} className="border-t border-white/10 align-top">
                            <td className="p-2">
                              <div className="font-medium">{item.name}</div>

                              {itemNote && (
                                <div className="mt-0.5 text-xs opacity-90">
                                  Hinweis: {itemNote}
                                </div>
                              )}

                              {extras.length > 0 && (
                                <div className="text-xs opacity-70">
                                  Extras:{" "}
                                  {extras
                                    .map((extra: any) => extra?.label || extra?.name)
                                    .filter(Boolean)
                                    .join(", ")}
                                </div>
                              )}

                              {remove.length > 0 && (
                                <div className="text-xs opacity-70">Ohne: {remove.join(", ")}</div>
                              )}
                            </td>

                            <td className="p-2 text-right">{qty}</td>
                            <td className="p-2 text-right">{formatMoney(line)}</td>
                          </tr>
                        );
                      })}
                    </tbody>

                    <tfoot>
                      <tr className="border-t border-white/10">
                        <td className="p-2 text-right font-semibold" colSpan={2}>
                          Gesamt
                        </td>
                        <td className="p-2 text-right font-semibold">{formatMoney(sum)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            )}
          </div>

          <div className="grid shrink-0 grid-cols-2 gap-2 lg:min-w-[210px]">
            <button
              className={actionButtonClass("ghost")}
              type="button"
              onClick={() => callCustomer(order.customer?.phone)}
            >
              📞 Anrufen
            </button>

            <button
              className={actionButtonClass("map")}
              type="button"
              onClick={() => openMaps(order)}
            >
              🗺️ Karte
            </button>

            <button
              className={actionButtonClass("finish")}
              type="button"
              disabled={loading}
              onClick={() => finishOne(order)}
            >
              ✅ Fertig
            </button>

            <button
              className={actionButtonClass("danger")}
              type="button"
              disabled={loading}
              onClick={() => releaseOne(order)}
            >
              ↩ Zurück
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!current) {
    return (
      <main className="min-h-screen text-stone-100 antialiased">
        <div className="pointer-events-none fixed inset-0 -z-10">
          <div className="absolute inset-0 bg-[radial-gradient(1200px_700px_at_10%_-10%,rgba(59,130,246,.18),transparent),radial-gradient(1000px_600px_at_90%_0%,rgba(16,185,129,.14),transparent),linear-gradient(180deg,#0b0f14_0%,#0f1318_50%,#0a0d11_100%)]" />
          <div className="absolute inset-0 bg-[radial-gradient(80%_80%_at_50%_20%,transparent,rgba(0,0,0,.45))]" />
        </div>

        <div className="mx-auto max-w-md px-4 py-16">
          <div className={`rounded-2xl p-6 ${glass}`}>
            <div className="mb-6 text-center">
              <img src="/logo-burger-brothers.png" className="mx-auto h-16 w-16" alt="" />
              <h1 className="mt-3 text-2xl font-bold">Fahrer-Login</h1>
              <p className="mt-1 text-sm text-stone-300/90">
                Bitte mit vom Admin vergebenen Zugangsdaten anmelden.
              </p>
            </div>

            <form onSubmit={handleLogin} className="space-y-3">
              <input
                className="w-full rounded-xl border border-white/20 bg-white/10 px-3 py-3 outline-none focus:ring-2 focus:ring-white/30"
                placeholder="Benutzername"
                value={loginName}
                onChange={(event) => {
                  setLoginName(event.target.value);
                  localStorage.setItem(LASTNAME_KEY, event.target.value || "");
                }}
                autoComplete="username"
              />

              <input
                type="password"
                className="w-full rounded-xl border border-white/20 bg-white/10 px-3 py-3 outline-none focus:ring-2 focus:ring-white/30"
                placeholder="Passwort"
                value={loginPass}
                onChange={(event) => {
                  setLoginPass(event.target.value);
                  if (remember) localStorage.setItem(LASTPASS_KEY, enc(event.target.value));
                }}
                autoComplete="current-password"
              />

              <label className="flex items-center gap-2 text-sm opacity-90">
                <input
                  type="checkbox"
                  checked={remember}
                  onChange={(event) => {
                    setRemember(event.target.checked);
                    localStorage.setItem(REMEMBER_KEY, event.target.checked ? "1" : "0");

                    if (event.target.checked) {
                      localStorage.setItem(LASTPASS_KEY, enc(loginPass));
                    } else {
                      localStorage.removeItem(LASTPASS_KEY);
                    }
                  }}
                />
                Angemeldet bleiben
              </label>

              <button
                type="submit"
                className="w-full rounded-xl bg-amber-500 py-3 font-bold text-black transition hover:bg-amber-400"
              >
                Anmelden
              </button>
            </form>
          </div>
        </div>
      </main>
    );
  }

  const pullReady = pullDistance >= PULL_REFRESH_TRIGGER_PX;
  const pullVisible = pullDistance > 8 || pullRefreshing;

  return (
    <main
      className="min-h-screen text-stone-100 antialiased"
      onTouchStart={onPullStart}
      onTouchMove={onPullMove}
      onTouchEnd={onPullEnd}
      onTouchCancel={onPullEnd}
    >
      {liveTrackingActive ? <DriverLiveTracker /> : null}

      <div
        className={`fixed left-1/2 top-3 z-50 -translate-x-1/2 rounded-full border px-4 py-2 text-xs font-semibold shadow-xl transition-all ${
          pullVisible ? "translate-y-0 opacity-100" : "-translate-y-6 opacity-0"
        } ${
          pullRefreshing || pullReady
            ? "border-emerald-300/50 bg-emerald-500/90 text-black"
            : "border-white/15 bg-stone-900/90 text-stone-100"
        }`}
        style={{
          transform: `translate(-50%, ${Math.max(0, Math.min(24, pullDistance / 4))}px)`,
        }}
      >
        {pullRefreshing
          ? "Aktualisiere…"
          : pullReady
            ? "Loslassen zum Aktualisieren"
            : "Zum Aktualisieren nach unten ziehen"}
      </div>

      {completeToast && (
        <div className="fixed left-3 right-3 top-[max(1rem,env(safe-area-inset-top))] z-50 mx-auto max-w-md rounded-2xl border border-emerald-300/45 bg-emerald-500/95 px-4 py-3 text-sm text-black shadow-2xl">
          <div className="font-extrabold">Lieferung abgeschlossen ✅</div>
          <div className="mt-0.5">
            #{completeToast.id} · Trinkgeld: <b>{completeToast.tip.toFixed(2)}€</b>
            {completeToast.total > 0 ? (
              <>
                <span className="mx-1">·</span>
                Gesamt: <b>{completeToast.total.toFixed(2)}€</b>
              </>
            ) : null}
          </div>
        </div>
      )}

      <div className="pointer-events-none fixed inset-0 -z-10">
        <div className="absolute inset-0 bg-[radial-gradient(1200px_700px_at_10%_-10%,rgba(59,130,246,.18),transparent),radial-gradient(1000px_600px_at_90%_0%,rgba(16,185,129,.14),transparent),linear-gradient(180deg,#0b0f14_0%,#0f1318_50%,#0a0d11_100%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(80%_80%_at_50%_20%,transparent,rgba(0,0,0,.45))]" />
      </div>

      <div className="mx-auto max-w-3xl space-y-3 px-3 py-3 sm:p-5">
        <div className={`rounded-2xl p-3 sm:p-4 ${glass}`}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-base font-extrabold sm:text-lg">
                Willkommen, {current.name}
              </div>
              <div className="mt-0.5 text-xs text-stone-300/90 sm:text-sm">
                Nur Lieferaufträge von heute werden angezeigt.
              </div>
              <div className="mt-1 text-[11px] text-stone-500">
                {lastRefreshAt ? (
                  <>Aktualisiert: {new Date(lastRefreshAt).toLocaleTimeString("de-DE")}</>
                ) : (
                  <>Wird geladen…</>
                )}
              </div>
            </div>

            <div className="flex shrink-0 gap-2">
              <button
                className="rounded-xl border border-amber-300/25 bg-amber-400/10 px-3 py-1.5 text-xs font-bold text-amber-100 transition hover:bg-amber-400/20 disabled:opacity-50"
                type="button"
                disabled={manualRefreshing}
                onClick={manualRefresh}
              >
                {manualRefreshing ? "Lädt…" : "Aktualisieren"}
              </button>

              <button
                className="rounded-xl border border-white/15 bg-white/[0.04] px-3 py-1.5 text-xs font-bold text-stone-200 transition hover:bg-white/10"
                type="button"
                onClick={handleLogout}
              >
                Abmelden
              </button>
            </div>
          </div>

          <div className="mt-3 grid grid-cols-3 gap-2">
            <DriverStatCard icon="📅" label="Heute" value={eod.count} tone="blue" />
            <DriverStatCard icon="🪙" label="Umsatz" value={`${eod.total.toFixed(2)}€`} tone="gold" />
            <DriverStatCard icon="🤲" label="Trinkgeld" value={`${eod.tip.toFixed(2)}€`} tone="green" />
          </div>
        </div>

        {refreshError && (
          <div className="rounded-2xl border border-rose-400/40 bg-rose-500/10 p-3 text-sm text-rose-100">
            {refreshError}
          </div>
        )}

        {!liveTrackingActive && (
          <div className="rounded-xl border border-sky-400/20 bg-sky-500/10 px-3 py-2 text-[11px] leading-relaxed text-sky-100">
            📍 Standort nur bei einer übernommenen Lieferung aktiv.
          </div>
        )}

        <div className={`rounded-2xl p-1.5 ${glass}`}>
          <div className="grid grid-cols-2 gap-1.5">
            <button
              type="button"
              onClick={() => setTab("new")}
              className={tabButtonClass(tab === "new", "new")}
            >
              Neu ({pending.length})
            </button>

            <button
              type="button"
              onClick={() => setTab("mine")}
              className={tabButtonClass(tab === "mine", "mine")}
            >
              Meine ({mine.length})
            </button>
          </div>
        </div>

        <section className="space-y-3">
          {tab === "new" ? (
            pending.length === 0 ? (
              <div className={`rounded-2xl p-4 text-sm text-stone-300/90 ${glass}`}>
                Keine neuen Aufträge.
              </div>
            ) : (
              <>
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={claimSelected}
                    disabled={loading}
                    className="rounded-xl bg-indigo-400 px-4 py-2 font-bold text-black hover:bg-indigo-300 disabled:opacity-50"
                    title="Ausgewählte übernehmen"
                  >
                    ＋ Übernehmen
                  </button>
                </div>

                {pending.map((order) => {
                  return (
                    <div key={String(order.id)} className={`rounded-2xl p-3 sm:p-4 ${glass}`}>
                      <div className="flex flex-col gap-3">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-start gap-2">
                            <div className="break-all text-[15px] font-extrabold sm:text-base">
                              #{order.id}
                            </div>
                            <span className="rounded-full border border-orange-400/50 bg-orange-500/15 px-2 py-0.5 text-xs text-orange-100">
                              Lieferung
                            </span>
                            <div className="ml-auto shrink-0">
                              <DriverPaymentBadge order={order} />
                            </div>
                          </div>

                          <div className="mt-1.5 text-sm">
                            {order.customer?.name || "-"} · {order.customer?.phone || "-"}
                          </div>
                          <div className="mt-0.5 text-sm font-semibold text-stone-200">
                            {prettyDeliveryLine(order)}
                          </div>

                          <DrinkOrderNotice order={order} />

                          <TimeBadge order={order} />
                        </div>

                        <div className="grid grid-cols-[auto_1fr] items-center gap-2">
                          <label className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-semibold text-stone-200">
                            <input
                              type="checkbox"
                              checked={!!selected[String(order.id)]}
                              onChange={() => toggleSelect(order.id)}
                            />
                            Auswahl
                          </label>

                          <button
                            className="rounded-xl border border-amber-300/45 bg-gradient-to-b from-amber-300 to-orange-500 px-4 py-2 text-sm font-extrabold text-black shadow-[0_0_18px_rgba(251,146,60,.18)] transition hover:from-amber-200 hover:to-orange-400 disabled:opacity-50"
                            type="button"
                            disabled={loading}
                            onClick={() => claimOne(order)}
                            title="Übernehmen"
                          >
                            ＋ Übernehmen
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </>
            )
          ) : mine.length === 0 ? (
            <div className={`rounded-2xl p-4 text-sm text-stone-300/90 ${glass}`}>
              Keine übernommenen Aufträge.
            </div>
          ) : (
            <>
              <div className={`rounded-2xl p-3 ${glass}`}>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div className="text-sm text-stone-200">
                    <div className="font-extrabold">🗺️ Route planen</div>
                    <div className="mt-0.5 text-xs text-stone-400">
                      {selectedRouteOrders.length
                        ? `${selectedRouteOrders.length} Lieferung(en) ausgewählt`
                        : "Lieferungen markieren und gemeinsame Google-Route starten."}
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {selectedRouteOrders.length > 0 && (
                      <button
                        type="button"
                        onClick={clearRouteSelection}
                        className="rounded-xl border border-white/15 bg-white/[0.04] px-3 py-2 text-xs font-bold text-stone-200 transition hover:bg-white/10"
                      >
                        Auswahl löschen
                      </button>
                    )}

                    <button
                      type="button"
                      disabled={selectedRouteOrders.length === 0}
                      onClick={openSelectedRoute}
                      className="rounded-xl border border-sky-300/45 bg-sky-400/15 px-3 py-2 text-xs font-extrabold text-sky-100 transition hover:bg-sky-400/25 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      🗺️ Ausgewählte Route starten
                    </button>
                  </div>
                </div>
              </div>

              {mine.map((order) => (
                <OrderWithDetails
                  key={String(order.id)}
                  order={order}
                  routeSelected={!!routeSelected[String(order.id)]}
                  onToggleRouteSelect={toggleRouteSelect}
                />
              ))}
            </>
          )}
        </section>
      </div>
    </main>
  );
}
