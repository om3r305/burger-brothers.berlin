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

function isActiveDeliveryOrder(order: any) {
  return (
    order?.mode === "delivery" &&
    (order?.status === "out_for_delivery" ||
      order?.status === "preparing" ||
      order?.status === "ready")
  );
}

export default function DriverLiveTracker() {
  const watchIdRef = useRef<number | null>(null);
  const heartbeatRef = useRef<number | null>(null);

  const [err, setErr] = useState<string | null>(null);

  const activeOrderIdsRef = useRef<string[]>([]);
  const prevActiveIdsRef = useRef<string[]>([]);
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

      try {
        const all = await fetchOrdersFromDb();
        const order = all.find((x: any) => String(x.id) === id);

        if (order) {
          await upsertOrder({
            ...(order as any),
            meta: {
              ...((order as any).meta || {}),
              lastPos: {
                lat: payload.lat,
                lng: payload.lng,
                ts: payload.ts,
              },
            },
          } as any);
        }
      } catch {}
    }

    try {
      localStorage.setItem("bb_driverpos_ping", String(Date.now()));
    } catch {}
  };

  const pushOnce = () => {
    if (!navigator.geolocation) return;

    navigator.geolocation.getCurrentPosition(
      publish,
      (e) => setErr(`Standortfehler: ${e.message}`),
      { enableHighAccuracy: true, maximumAge: 1500, timeout: 10000 }
    );
  };

  useEffect(() => {
    const tick = async () => {
      const driver = getCurrentDriver();

      let all: any[] = [];

      try {
        all = await fetchOrdersFromDb();
      } catch {
        all = [];
      }

      const mineActive = all.filter(
        (order: any) => isMine(order, driver) && isActiveDeliveryOrder(order)
      );

      const ids = mineActive.map((order: any) => String(order.id));
      activeOrderIdsRef.current = ids;

      const removed = prevActiveIdsRef.current.filter((id) => !ids.includes(id));

      if (removed.length) {
        for (const id of removed) {
          try {
            clearDriverPosFor(id);

            const order = all.find((x: any) => String(x.id) === id);

            if (order) {
              await upsertOrder({
                ...(order as any),
                meta: {
                  ...((order as any).meta || {}),
                  lastPos: null,
                },
              } as any);
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

    watchIdRef.current = navigator.geolocation.watchPosition(
      publish,
      onErr,
      { enableHighAccuracy: true, maximumAge: 1500, timeout: 10000 }
    );

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
    <div className="fixed inset-x-0 bottom-0 z-50 m-3 rounded-md bg-rose-600/90 px-3 py-2 text-sm">
      {err}
    </div>
  );
}