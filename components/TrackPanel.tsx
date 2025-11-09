// components/TrackPanel.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { readAllOrders } from "@/lib/orders";
import type { StoredOrder } from "@/lib/orders";

/* ───────────── Status metinleri ───────────── */
const statusLabel = {
  received: "Eingegangen",
  preparing: "In Vorbereitung",
  ready: "Abholbereit",
  out_for_delivery: "Unterwegs",
  done: "Abgeschlossen",
  cancelled: "Storniert",
} as const;

type StatusKey = keyof typeof statusLabel;

export default function TrackPanel({ orderId }: { orderId: string }) {
  // Başlangıçta local kayıtları kontrol et
  const initial = (() => {
    try {
      return readAllOrders().find((o) => o.id === orderId);
    } catch {
      return undefined;
    }
  })();

  const [order, setOrder] = useState<typeof initial>(initial);

  // Her 3 saniyede bir güncelle
  useEffect(() => {
    const id = setInterval(() => {
      try {
        const o = readAllOrders().find((x) => x.id === orderId);
        setOrder(o);
      } catch {}
    }, 3000);
    return () => clearInterval(id);
  }, [orderId]);

  // ETA hesaplama
  const eta = useMemo(() => {
    if (!order) return null;
    const avgPickup = 15;
    const avgDelivery = 35;
    const e = order.etaMin ?? (order.mode === "pickup" ? avgPickup : avgDelivery);
    const created = (order as any).createdAt ?? (order as any).ts ?? Date.now();
    const end = created + e * 60000;
    const diff = Math.max(0, end - Date.now());
    const mm = Math.floor(diff / 60000);
    const ss = Math.floor((diff % 60000) / 1000);
    return `${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
  }, [order]);

  if (!order) {
    return <div className="text-sm opacity-80">Bestellung nicht gefunden.</div>;
  }

  const label = statusLabel[order.status as StatusKey] ?? order.status;

  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-2">
      <div className="text-lg font-semibold">Bestellung #{order.id}</div>
      <div>Status: <b>{label}</b></div>
      {eta && order.status !== "done" && (
        <div>ETA: <b>{eta}</b></div>
      )}
      {order.status === "out_for_delivery" && (
        <div>🚚 Ihre Bestellung ist unterwegs.</div>
      )}
      {order.status === "done" && (
        <div>✅ Abgeschlossen. Guten Appetit!</div>
      )}
    </div>
  );
}
