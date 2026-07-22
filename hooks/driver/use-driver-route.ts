"use client";

import { useCallback, useMemo, useState } from "react";
import { openMultiStopMapsRoute } from "@/lib/driver/domain";
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
}: {
  orders: DriverOrder[];
  routePlzPriority: string[];
  notify: Notify;
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

    const result = openMultiStopMapsRoute(
      selectedOrders,
      routePlzPriority,
    );

    if (!result.ok) {
      notify(result.message || "Route konnte nicht erstellt werden.", "error");
      return false;
    }

    return true;
  }, [
    notify,
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
