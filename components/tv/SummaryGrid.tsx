"use client";

import { useMemo } from "react";
import type { StoredOrder } from "@/types/tv";
import { getPaymentKind, glass } from "@/lib/tv/domain";

export function SummaryGrid({ orders }: { orders: StoredOrder[] }) {
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
