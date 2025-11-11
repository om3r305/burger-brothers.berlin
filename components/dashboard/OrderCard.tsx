"use client";
import { useEffect, useState } from "react";

export default function OrderCard({ order, settings }: any) {
  const [remaining, setRemaining] = useState<string>("");

  const lead =
    order.mode === "pickup"
      ? settings?.leadTimes?.pickupLeadMin || 10
      : settings?.leadTimes?.deliveryLeadMin || 35;

  useEffect(() => {
    const tick = () => {
      const start = new Date(order.createdAt).getTime();
      const end = start + lead * 60000;
      const now = Date.now();
      const diff = end - now;
      const late = diff < 0;
      const abs = Math.abs(diff);
      const m = Math.floor(abs / 60000);
      const s = Math.floor((abs % 60000) / 1000);
      setRemaining(`${late ? "+" : "−"}${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`);
    };
    tick();
    const i = setInterval(tick, 1000);
    return () => clearInterval(i);
  }, [order.createdAt, lead]);

  const bg =
    order.status === "done"
      ? "bg-green-600"
      : order.status === "cancel"
      ? "bg-rose-600"
      : "bg-stone-800";

  return (
    <div className={`mb-3 rounded-lg ${bg} p-3 text-sm shadow`}>
      <div className="flex justify-between">
        <span className="font-semibold">{order.id}</span>
        <span className="font-semibold text-amber-300">
          {order.mode === "pickup" ? "Apollon" : "Lifa"}
        </span>
      </div>
      <div className="text-stone-300">{order.name}</div>
      <div className="flex justify-between text-xs mt-1">
        <span>{order.total.toFixed(2)} €</span>
        <span className="font-mono">{remaining}</span>
      </div>
    </div>
  );
}
