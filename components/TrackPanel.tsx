// components/TrackPanel.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { readAllOrders } from "@/lib/orders";
import type { StoredOrder } from "@/lib/types";

const statusLabel = {
  new: "Eingegangen",
  preparing: "In Vorbereitung",
  ready: "Abholbereit",
  out_for_delivery: "Unterwegs",
  done: "Abgeschlossen",
  cancelled: "Storniert",
} as const;

export default function TrackPanel({ orderId }: { orderId: string }) {
  const [order, setOrder] = useState<StoredOrder | undefined>(() =>
    readAllOrders().find((o) => o.id === orderId)
  );
  useEffect(() => {
    const id = setInterval(() => {
      const o = readAllOrders().find((x) => x.id === orderId);
      setOrder(o);
    }, 3000);
    return () => clearInterval(id);
  }, [orderId]);

  const eta = useMemo(() => {
    if (!order) return null;
    const avgPickup = 15;
    const avgDelivery = 35;
    const e = order.etaMin ?? (order.mode === "pickup" ? avgPickup : avgDelivery);
    const end = (order.ts || Date.now()) + e * 60000;
    const ms = Math.max(0, end - Date.now());
    const mm = Math.floor(ms / 60000);
    const ss = Math.floor((ms % 60000) / 1000);
    return `${String(mm).padStart(2,"0")}:${String(ss).padStart(2,"0")}`;
  }, [order]);

  if (!order) return <div className="text-sm opacity-80">Bestellung nicht gefunden.</div>;

  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-2">
      <div className="text-lg font-semibold">Bestellung #{order.id}</div>
      <div>Status: <b>{statusLabel[order.status]}</b></div>
      {eta && order.status!=="done" && <div>ETA: <b>{eta}</b></div>}
      {order.status==="out_for_delivery" && <div>🚚 Ihre Bestellung ist unterwegs.</div>}
      {order.status==="done" && <div>✅ Abgeschlossen. Guten Appetit!</div>}
    </div>
  );
}
