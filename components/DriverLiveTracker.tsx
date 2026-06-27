"use client";

import { useEffect, useRef, useState } from "react";
import { fetchOrdersFromDb, upsertOrder } from "@/lib/orders";

/**
 * Driver sayfasına mount edildiğinde:
 * - watchPosition + getCurrentPosition ile canlı konumu alır
 * - Sadece sürücüye atanmış ve aktif sipariş ID’lerine bb_driverpos_{ORDERID} yazar
 * - DB’de order.meta.lastPos alanını da günceller
 * - Aktiflikten çıkan siparişlerin konumunu temizler
 */

type LivePos = { lat: number; lng: number; ts: number };

const CURRENT_DRIVER_KEY = "bb_current_driver_v1";

function getCurrentDriver() {
  try {
    return JSON.parse(localStorage.getItem(CURRENT_DRIVER_KEY) || "null");
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

function isMine(order: any, driver: any) {
  if (!order || !driver) return false;

  const orderDriver = getOrderDriver(order);

  return (
    String(orderDriver?.id || "") === String(driver?.id || "") ||
    String(orderDriver?.name || "") === String(driver?.name || "")
  );
}

function normalizeMode(value: any) {
  return String(value || "").toLowerCase().trim();
}

function normalizeStatus(value: any) {
  return String(value || "").toLowerCase().trim();
}

function isDeliveryOrder(order: any) {
  const mode = normalizeMode(order?.mode || order?.meta?.mode || order?.type);

  return mode === "delivery" || mode === "lieferung" || mode.includes("liefer");
}

function isActiveDeliveryOrder(order: any) {
  const status = normalizeStatus(order?.status || order?.meta?.status);

  return (
    isDeliveryOrder(order) &&
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
        items: Array.isArray(order?.items) && order.items.length ? order.items : previous?.items || order?.items || [],
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

  const urls = [
    "/api/orders/list?includeDone=1&includeArchived=1&take=500",
    "/api/orders?includeDone=1&includeArchived=1&take=500",
  ];

  for (const url of urls) {
    try {
      const res = await fetch(url, {
        method: "GET",
        cache: "no-store",
        headers: {
          accept: "application/json",
        },
      });

      if (!res.ok) continue;

      const data = await res.json().catch(() => ({}));
      const fromApi = normalizeOrdersPayload(data);

      if (fromApi.length) {
        return mergeOrders(fromLib, fromApi);
      }
    } catch {}
  }

  return fromLib;
}

async function persistOrderToDb(order: any) {
  try {
    upsertOrder(order);
  } catch {}

  try {
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
      throw new Error(data?.error || `HTTP ${res.status}`);
    }

    try {
      window.dispatchEvent(new CustomEvent("bb:refresh-orders"));
      window.dispatchEvent(new CustomEvent("bb_orders_changed"));
    } catch {}

    return true;
  } catch {
    return false;
  }
}

function withLastPos(order: any, payload: LivePos | null) {
  const meta = order?.meta && typeof order.meta === "object" ? order.meta : {};

  return {
    ...order,
    meta: {
      ...meta,
      lastPos: payload
        ? {
            lat: payload.lat,
            lng: payload.lng,
            ts: payload.ts,
          }
        : null,
      lastDriverPos: payload
        ? {
            lat: payload.lat,
            lng: payload.lng,
            ts: payload.ts,
          }
        : null,
    },
  };
}

export default function DriverLiveTracker() {
  const watchIdRef = useRef<number | null>(null);
  const heartbeatRef = useRef<number | null>(null);

  const [err, setErr] = useState<string | null>(null);

  const activeOrderIdsRef = useRef<string[]>([]);
  const prevActiveIdsRef = useRef<string[]>([]);
  const ordersRef = useRef<any[]>([]);
  const lastWriteRef = useRef<Record<string, LivePos>>({});

  const publish = async (pos: GeolocationPosition) => {
    setErr(null);

    const payload: LivePos = {
      lat: pos.coords.latitude,
      lng: pos.coords.longitude,
      ts: Date.now(),
    };

    const ids = activeOrderIdsRef.current;

    if (!ids.length) return;

    const all = ordersRef.current;

    for (const id of ids) {
      const last = lastWriteRef.current[id];
      const tooSoon = last && payload.ts - last.ts < 5000;
      const sameSpot =
        last &&
        Math.abs(last.lat - payload.lat) < 0.00005 &&
        Math.abs(last.lng - payload.lng) < 0.00005;

      if (tooSoon && sameSpot) continue;

      try {
        localStorage.setItem(`bb_driverpos_${id}`, JSON.stringify(payload));
        lastWriteRef.current[id] = payload;
      } catch {}

      const order = all.find((x: any) => String(x?.id || x?.orderId) === String(id));

      if (order) {
        const updated = withLastPos(order, payload);

        await persistOrderToDb(updated);

        ordersRef.current = ordersRef.current.map((x: any) =>
          String(x?.id || x?.orderId) === String(id) ? updated : x,
        );
      }
    }

    try {
      localStorage.setItem("bb_driverpos_ping", String(Date.now()));
      window.dispatchEvent(new CustomEvent("bb:driver-pos-ping"));
    } catch {}
  };

  const pushOnce = () => {
    if (!navigator.geolocation) return;

    navigator.geolocation.getCurrentPosition(
      publish,
      (e) => setErr(`Standortfehler: ${e.message}`),
      {
        enableHighAccuracy: true,
        maximumAge: 1500,
        timeout: 10000,
      },
    );
  };

  useEffect(() => {
    const tick = async () => {
      const driver = getCurrentDriver();

      let all: any[] = [];

      try {
        all = await fetchDriverOrders();
      } catch {
        all = [];
      }

      ordersRef.current = all;

      const mineActive = all.filter(
        (order: any) => isMine(order, driver) && isActiveDeliveryOrder(order),
      );

      const ids = mineActive.map((order: any) => String(order.id || order.orderId));
      activeOrderIdsRef.current = ids;

      const removed = prevActiveIdsRef.current.filter((id) => !ids.includes(id));

      if (removed.length) {
        for (const id of removed) {
          try {
            clearDriverPosFor(id);

            const order = all.find((x: any) => String(x?.id || x?.orderId) === String(id));

            if (order) {
              const updated = withLastPos(order, null);
              await persistOrderToDb(updated);

              ordersRef.current = ordersRef.current.map((x: any) =>
                String(x?.id || x?.orderId) === String(id) ? updated : x,
              );
            }

            if (lastWriteRef.current[id]) {
              delete lastWriteRef.current[id];
            }
          } catch {}
        }
      }

      const added = ids.filter((id) => !prevActiveIdsRef.current.includes(id));

      if (added.length > 0) {
        pushOnce();
      }

      if (ids.length > 0 && heartbeatRef.current == null) {
        heartbeatRef.current = window.setInterval(() => pushOnce(), 12000);
      } else if (ids.length === 0 && heartbeatRef.current != null) {
        clearInterval(heartbeatRef.current);
        heartbeatRef.current = null;
      }

      prevActiveIdsRef.current = ids;
    };

    tick();

    const id = window.setInterval(tick, 3000);

    return () => {
      clearInterval(id);

      if (heartbeatRef.current != null) {
        clearInterval(heartbeatRef.current);
        heartbeatRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!("geolocation" in navigator)) {
      setErr("Geolocation nicht verfügbar.");
      return;
    }

    const onErr = (e: GeolocationPositionError) => {
      setErr(`Standortfehler: ${e.message}`);
    };

    watchIdRef.current = navigator.geolocation.watchPosition(publish, onErr, {
      enableHighAccuracy: true,
      maximumAge: 1500,
      timeout: 10000,
    });

    const onVis = () => {
      if (document.visibilityState === "visible") pushOnce();
    };

    document.addEventListener("visibilitychange", onVis);

    return () => {
      document.removeEventListener("visibilitychange", onVis);

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