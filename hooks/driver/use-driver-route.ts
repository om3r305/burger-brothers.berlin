"use client";

import { useCallback, useMemo, useState } from "react";
import type {
  DriverOrder,
  DriverToastTone,
} from "@/types/driver";

type Notify = (
  message: string,
  tone?: DriverToastTone,
  durationMs?: number,
) => void;

export function useDriverRoute({
  orders,
  routePlzPriority,
  notify,
  openRoute,
}: {
  orders: DriverOrder[];
  routePlzPriority: string[];
  notify: Notify;
  openRoute: (
    orders: DriverOrder[],
    priority: string[],
  ) => boolean;
}) {
  const [selected, setSelected] = useState<Record<string, boolean>>({});

  const selectedOrders = useMemo(
    () => orders.filter((order) => selected[String(order.id)]),
    [orders, selected],
  );

  const toggle = useCallback((id: string | number) => {
    const key = String(id);

    setSelected((current) => ({
      ...current,
      [key]: !current[key],
    }));
  }, []);

  const clear = useCallback(() => {
    setSelected({});
  }, []);

  const open = useCallback(() => {
    if (!selectedOrders.length) {
      notify(
        "Bitte zuerst eine oder mehrere Lieferungen für die Route auswählen.",
        "warning",
      );
      return false;
    }

    return openRoute(selectedOrders, routePlzPriority);
  }, [
    notify,
    openRoute,
    routePlzPriority,
    selectedOrders,
  ]);

  return {
    selected,
    selectedOrders,
    toggle,
    clear,
    open,
  };
}
