"use client";

import { useEffect, useRef, useState } from "react";
import { fetchOrdersFromDb } from "@/lib/orders";

/**
 * Driver sayfasına mount edildiğinde:
 * - watchPosition + periyodik heartbeat ile canlı konumu alır
 * - yalnızca imzalı driver session ile /api/track/[session] endpoint'ine yazar
 * - yalnızca sürücüye atanmış aktif teslimat siparişlerini gönderir
 * - legacy /api/orders mutation endpoint'ini kullanmaz
 */

type LivePos = { lat: number; lng: number; ts: number };

type DriverIdentity = {
  id?: string;
  name?: string;
};

const CURRENT_DRIVER_KEY = "bb_current_driver_v1";

function getCurrentDriver(): DriverIdentity | null {
  try {
    const value = JSON.parse(localStorage.getItem(CURRENT_DRIVER_KEY) || "null");
    return value && typeof value === "object" ? value : null;
  } catch {
    return null;
  }
}

function clearDriverPosFor(id: string | number) {
  try {
    localStorage.removeItem(`bb_driverpos_${id}`);
  } catch {}
}

function getOrderDriver(order: any) {
  return (
    order?.driver ||
    order?.meta?.driver ||
    (order?.meta?.driverId || order?.meta?.driverName
      ? {
          id: order?.meta?.driverId,
          name: order?.meta?.driverName,
        }
      : null)
  );
}

function isMine(order: any, driver: DriverIdentity | null) {
  if (!order || !driver) return false;

  const orderDriver = getOrderDriver(order);
  const driverId = String(driver?.id || "").trim();
  const driverName = String(driver?.name || "").trim();

  return Boolean(
    (driverId && String(orderDriver?.id || "") === driverId) ||
      (driverName && String(orderDriver?.name || "") === driverName),
  );
}

function isActiveDeliveryOrder(order: any) {
  const mode = String(order?.mode || order?.meta?.mode || order?.type || "")
    .toLowerCase()
    .trim();
  const status = String(order?.status || order?.meta?.status || "")
    .toLowerCase()
    .trim();

  return (
    (mode === "delivery" || mode === "lieferung" || mode.includes("liefer")) &&
    status !== "done" &&
    status !== "cancelled" &&
    status !== "canceled"
  );
}

function normalizeOrdersPayload(data: any): any[] {
  const raw = Array.isArray(data)
    ? data
    : Array.isArray(data?.orders)
      ? data.orders
      : Array.isArray(data?.items)
        ? data.items
        : Array.isArray(data?.list)
          ? data.list
          : Array.isArray(data?.data)
            ? data.data
            : [];

  return raw.filter(Boolean);
}

function mergeOrders(...lists: any[][]) {
  const map = new Map<string, any>();

  for (const list of lists) {
    for (const order of list || []) {
      const id = String(order?.id || order?.orderId || "").trim();
      if (!id) continue;

      const previous = map.get(id);

      map.set(id, {
        ...(previous || {}),
        ...order,
        customer: {
          ...(previous?.customer || {}),
          ...(order?.customer || {}),
        },
        meta: {
          ...(previous?.meta || {}),
          ...(order?.meta || {}),
        },
        items:
          Array.isArray(order?.items) && order.items.length
            ? order.items
            : previous?.items || order?.items || [],
      });
    }
  }

  return Array.from(map.values());
}

async function fetchDriverOrders(): Promise<any[]> {
  let fromLib: any[] = [];

  try {
    fromLib = await fetchOrdersFromDb();
  } catch {
    fromLib = [];
  }

  try {
    const response = await fetch(
      "/api/orders/list?view=driver&includeDone=1&take=500",
      {
        method: "GET",
        cache: "no-store",
        headers: { accept: "application/json" },
      },
    );

    if (!response.ok) return fromLib;

    const data = await response.json().catch(() => ({}));
    return mergeOrders(fromLib, normalizeOrdersPayload(data));
  } catch {
    return fromLib;
  }
}

function safeSessionPart(value: any) {
  return String(value || "driver")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 64) || "driver";
}

function trackingSessionId(driver: DriverIdentity | null) {
  const date = new Date();
  const day = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");

  return `driver_${day}_${safeSessionPart(driver?.id || driver?.name)}`;
}

async function postTracking(params: {
  driver: DriverIdentity | null;
  orderIds: string[];
  active: boolean;
  position?: LivePos | null;
}) {
  if (!params.driver?.id && !params.driver?.name) return false;

  const response = await fetch(
    `/api/track/${encodeURIComponent(trackingSessionId(params.driver))}`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({
        active: params.active,
        orderIds: params.orderIds,
        driverId: params.driver.id || undefined,
        ...(params.position
          ? {
              lat: params.position.lat,
              lng: params.position.lng,
            }
          : {}),
      }),
      keepalive: true,
    },
  );

  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.ok === false) {
    throw new Error(data?.error || `HTTP ${response.status}`);
  }

  return true;
}

export default function DriverLiveTracker() {
  const watchIdRef = useRef<number | null>(null);
  const heartbeatRef = useRef<number | null>(null);
  const activeOrderIdsRef = useRef<string[]>([]);
  const previousActiveIdsRef = useRef<string[]>([]);
  const driverRef = useRef<DriverIdentity | null>(null);
  const lastPublishRef = useRef<LivePos | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const publish = async (position: GeolocationPosition) => {
    const driver = driverRef.current || getCurrentDriver();
    const orderIds = activeOrderIdsRef.current;

    if (!driver || !orderIds.length) return;

    const payload: LivePos = {
      lat: position.coords.latitude,
      lng: position.coords.longitude,
      ts: Date.now(),
    };

    const previous = lastPublishRef.current;
    const tooSoon = previous && payload.ts - previous.ts < 5_000;
    const sameSpot =
      previous &&
      Math.abs(previous.lat - payload.lat) < 0.00005 &&
      Math.abs(previous.lng - payload.lng) < 0.00005;

    if (tooSoon && sameSpot) return;

    for (const id of orderIds) {
      try {
        localStorage.setItem(`bb_driverpos_${id}`, JSON.stringify(payload));
      } catch {}
    }

    try {
      await postTracking({
        driver,
        orderIds,
        active: true,
        position: payload,
      });
      lastPublishRef.current = payload;
      setErr(null);

      try {
        localStorage.setItem("bb_driverpos_ping", String(Date.now()));
        window.dispatchEvent(new CustomEvent("bb:driver-pos-ping"));
      } catch {}
    } catch (error: any) {
      setErr(`Trackingfehler: ${error?.message || "unbekannt"}`);
    }
  };

  const pushOnce = () => {
    if (!navigator.geolocation || !activeOrderIdsRef.current.length) return;

    navigator.geolocation.getCurrentPosition(
      publish,
      (error) => setErr(`Standortfehler: ${error.message}`),
      {
        enableHighAccuracy: true,
        maximumAge: 1_500,
        timeout: 10_000,
      },
    );
  };

  useEffect(() => {
    const tick = async () => {
      const driver = getCurrentDriver();
      driverRef.current = driver;

      let orders: any[] = [];
      try {
        orders = await fetchDriverOrders();
      } catch {
        orders = [];
      }

      const ids = orders
        .filter((order: any) => isMine(order, driver) && isActiveDeliveryOrder(order))
        .map((order: any) => String(order?.id || order?.orderId || "").trim())
        .filter(Boolean);

      const uniqueIds = Array.from(new Set(ids));
      activeOrderIdsRef.current = uniqueIds;

      const removed = previousActiveIdsRef.current.filter(
        (id) => !uniqueIds.includes(id),
      );

      for (const id of removed) clearDriverPosFor(id);

      if (previousActiveIdsRef.current.length && !uniqueIds.length && driver) {
        try {
          await postTracking({
            driver,
            orderIds: [],
            active: false,
          });
        } catch {}

        lastPublishRef.current = null;
      }

      const added = uniqueIds.some(
        (id) => !previousActiveIdsRef.current.includes(id),
      );

      if (added) pushOnce();

      if (uniqueIds.length && heartbeatRef.current == null) {
        heartbeatRef.current = window.setInterval(pushOnce, 12_000);
      } else if (!uniqueIds.length && heartbeatRef.current != null) {
        window.clearInterval(heartbeatRef.current);
        heartbeatRef.current = null;
      }

      previousActiveIdsRef.current = uniqueIds;
    };

    void tick();
    const interval = window.setInterval(() => void tick(), 3_000);

    return () => {
      window.clearInterval(interval);
      if (heartbeatRef.current != null) {
        window.clearInterval(heartbeatRef.current);
        heartbeatRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!("geolocation" in navigator)) {
      setErr("Geolocation nicht verfügbar.");
      return;
    }

    watchIdRef.current = navigator.geolocation.watchPosition(
      publish,
      (error) => setErr(`Standortfehler: ${error.message}`),
      {
        enableHighAccuracy: true,
        maximumAge: 1_500,
        timeout: 10_000,
      },
    );

    const onVisibility = () => {
      if (document.visibilityState === "visible") pushOnce();
    };

    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);

      if (watchIdRef.current != null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
      }

      watchIdRef.current = null;
    };
  }, []);

  if (!err) return null;

  return (
    <div className="fixed inset-x-0 bottom-0 z-50 m-3 rounded-md bg-rose-600/90 px-3 py-2 text-sm text-white shadow-lg">
      {err}
    </div>
  );
}
