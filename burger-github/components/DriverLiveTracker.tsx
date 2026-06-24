"use client";

import { useEffect, useRef, useState } from "react";
import { readAllOrders, upsertOrder } from "@/lib/orders";

/**
 * Driver sayfasına mount edildiğinde:
 * - watchPosition + getCurrentPosition (anlık/pulse) ile canlı konumu alır
 * - SADECE sürücüye atanmış ve AKTİF (out_for_delivery | preparing | ready) sipariş ID’lerine
 *   bb_driverpos_{ORDERID} altında {lat,lng,ts} yazar
 * - Aktiflikten çıkan / başka şoföre geçen siparişlerin konumunu HEMEN temizler (LS + meta.lastPos=null)
 * - “Bırakıp tekrar aldığında” konum hemen geri gelsin diye: aktif liste dolduğunda veya yeni ID eklendiğinde anında pushOnce()
 * - Hareket yoksa bile 12 sn heartbeat ile yazmaya devam eder
 */

type LivePos = { lat: number; lng: number; ts: number };

const CURRENT_DRIVER_KEY = "bb_current_driver_v1";
function getCurrentDriver() {
  try { return JSON.parse(localStorage.getItem(CURRENT_DRIVER_KEY) || "null"); } catch { return null; }
}
function clearDriverPosFor(id: string | number) {
  try { localStorage.removeItem(`bb_driverpos_${id}`); } catch {}
}

export default function DriverLiveTracker() {
  const watchIdRef = useRef<number | null>(null);
  const heartbeatRef = useRef<number | null>(null);

  const [err, setErr] = useState<string | null>(null);

  // aktif order id’leri
  const activeOrderIdsRef = useRef<string[]>([]);
  const prevActiveIdsRef = useRef<string[]>([]);

  // son yazılan pozisyon (throttle)
  const lastWriteRef = useRef<Record<string, LivePos>>({});

  // ——— yardımcı: konumu yayınla ———
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
      // 5 sn throttle + aynı noktaysa yazma
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

      // yedek: order.meta.lastPos içine de yaz
      try {
        const all = readAllOrders() || [];
        const o = all.find((x: any) => String(x.id) === id);
        if (o) {
          await upsertOrder({
            ...o,
            meta: { ...(o.meta || {}), lastPos: { lat: payload.lat, lng: payload.lng, ts: payload.ts } },
          });
        }
      } catch {}
    }

    // ping (müşteri tarafı dinliyorsa)
    try { localStorage.setItem("bb_driverpos_ping", String(Date.now())); } catch {}
  };

  // ——— yardımcı: tek seferlik push ———
  const pushOnce = () => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      publish,
      (e) => setErr(`Standortfehler: ${e.message}`),
      { enableHighAccuracy: true, maximumAge: 1500, timeout: 10000 }
    );
  };

  // ——— aktif siparişleri takip et (3 sn) + çıkanları temizle + yeni eklenende pushOnce ———
  useEffect(() => {
    const tick = async () => {
      const me = getCurrentDriver();
      const all = readAllOrders() || [];

      const mineActive = all.filter(
        (o: any) =>
          o?.driver?.id === me?.id &&
          (o?.status === "out_for_delivery" || o?.status === "preparing" || o?.status === "ready")
      );

      const ids = mineActive.map((o: any) => String(o.id));
      activeOrderIdsRef.current = ids;

      // listeden çıkanları temizle
      const removed = prevActiveIdsRef.current.filter((id) => !ids.includes(id));
      if (removed.length) {
        for (const id of removed) {
          try {
            clearDriverPosFor(id);
            const o = all.find((x: any) => String(x.id) === id);
            if (o) {
              await upsertOrder({ ...o, meta: { ...(o.meta || {}), lastPos: null } });
            }
            const lw = lastWriteRef.current;
            if (lw[id]) delete lw[id];
          } catch {}
        }
      }

      // yeni eklenen varsa → konumu HEMEN yaz
      const added = ids.filter((id) => !prevActiveIdsRef.current.includes(id));
      if (added.length > 0) {
        pushOnce();
      }

      // heartbeat yönetimi: aktif varsa çalışsın; yoksa dursun
      if (ids.length > 0 && heartbeatRef.current == null) {
        heartbeatRef.current = window.setInterval(() => pushOnce(), 12000);
      } else if (ids.length === 0 && heartbeatRef.current != null) {
        clearInterval(heartbeatRef.current);
        heartbeatRef.current = null;
      }

      prevActiveIdsRef.current = ids;
    };

    tick();
    const id = setInterval(tick, 3000);
    return () => {
      clearInterval(id);
      // sayfadan çıkarken heartbeat’ı da kapat
      if (heartbeatRef.current != null) {
        clearInterval(heartbeatRef.current);
        heartbeatRef.current = null;
      }
    };
  }, []);

  // ——— konum watcher ———
  useEffect(() => {
    if (!("geolocation" in navigator)) {
      setErr("Geolocation nicht verfügbar.");
      return;
    }

    const onErr = (e: GeolocationPositionError) => setErr(`Standortfehler: ${e.message}`);

    // watch: hareket edince yakala
    watchIdRef.current = navigator.geolocation.watchPosition(
      publish,
      onErr,
      { enableHighAccuracy: true, maximumAge: 1500, timeout: 10000 }
    );

    // iOS: görünürlük değişiminde ek bir push
    const onVis = () => {
      if (document.visibilityState === "visible") pushOnce();
    };
    document.addEventListener("visibilitychange", onVis);

    return () => {
      document.removeEventListener("visibilitychange", onVis);
      if (watchIdRef.current != null) navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    };
  }, []);

  // küçük hata bandı
  if (!err) return null;
  return (
    <div className="fixed inset-x-0 bottom-0 z-50 m-3 rounded-md bg-rose-600/90 px-3 py-2 text-sm">
      {err}
    </div>
  );
}
