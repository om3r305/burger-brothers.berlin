"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { BrianData } from "@/lib/brian";
import {
  brianIsActive,
  loadBrian,
  refreshBrian,
} from "@/lib/brian";
import type { StoredOrder } from "@/types/tv";
import {
  BRIAN_ALLOWED_HOSTS,
  BRIAN_FORCE,
  ENABLE_AFTER_DAYS,
  GO_LIVE_AT,
  brianStreetFromOrder,
  daysUntilActive,
  getDriverName,
} from "@/lib/tv/domain";

const BRIAN_BACKGROUND_REFRESH_MS = 5 * 60_000;
const BRIAN_MIN_REFRESH_GAP_MS = 30_000;

const EMPTY_BRIAN_DATA: BrianData = {
  clusters: [],
  pairs: [],
  meta: {},
};

export function useTvBrian() {
  const [data, setData] = useState<BrianData | null>(null);
  const [host, setHost] = useState<string | undefined>(undefined);

  useEffect(() => {
    setHost(window.location.host);
  }, []);

  const brianLoadRunningRef = useRef(false);
  const brianLastLoadAtRef = useRef(0);

  useEffect(() => {
    let active = true;
    let timerId = 0;

    const load = async (force = false) => {
      const now = Date.now();

      if (brianLoadRunningRef.current) return;
      if (
        !force &&
        now - brianLastLoadAtRef.current < BRIAN_MIN_REFRESH_GAP_MS
      ) {
        return;
      }

      brianLoadRunningRef.current = true;
      brianLastLoadAtRef.current = now;

      try {
        const next = force ? await refreshBrian() : await loadBrian();
        if (active) setData(next);
      } catch {
        if (active) setData(EMPTY_BRIAN_DATA);
      } finally {
        brianLoadRunningRef.current = false;
      }
    };

    const schedule = () => {
      if (!active) return;

      timerId = window.setTimeout(async () => {
        if (document.visibilityState === "visible") {
          await load(true);
        }
        schedule();
      }, BRIAN_BACKGROUND_REFRESH_MS);
    };

    void load().finally(schedule);

    const onVisibility = () => {
      if (document.visibilityState === "visible") void load();
    };
    const onFocus = () => void load();

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onFocus);

    return () => {
      active = false;
      window.clearTimeout(timerId);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  const gateOn = useMemo(
    () =>
      brianIsActive(data?.meta, {
        host,
        allowedHosts: BRIAN_ALLOWED_HOSTS,
        goLiveAt: GO_LIVE_AT,
        enableAfterDays: ENABLE_AFTER_DAYS,
        force: BRIAN_FORCE,
      }),
    [data?.meta, host],
  );

  const daysLeft = useMemo(() => daysUntilActive(data?.meta), [data?.meta]);

  const learnDeliveryDeparture = useCallback(
    async (order: StoredOrder, visibleOrders: StoredOrder[]) => {
      const primaryStreet = brianStreetFromOrder(order);
      const streets = Array.from(
        new Set(
          visibleOrders
            .filter(
              (item) =>
                item.mode === "delivery" &&
                (item.id === order.id || item.status === "out_for_delivery"),
            )
            .map(brianStreetFromOrder)
            .filter((street): street is string => Boolean(street)),
        ),
      );

      const peerStreets = streets.filter((street) => street !== primaryStreet);
      if (!streets.length) return;

      const response = await fetch("/api/brian/learn", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify({
          occurredAt: new Date().toISOString(),
          mode: "delivery",
          orderId: order.orderId || order.id,
          primaryStreet: primaryStreet || streets[0],
          streets,
          peerStreets,
          status: "out_for_delivery",
          source: "tv_out_for_delivery",
          driverId:
            order.driver?.id ||
            order.meta?.driverId ||
            order.driverName ||
            "",
          driverName: getDriverName(order),
        }),
      });

      const payload = await response.json().catch(() => ({}));

      if (!response.ok || payload?.ok === false) {
        throw new Error(
          payload?.error || `Brian learn HTTP ${response.status}`,
        );
      }

      await fetch("/api/brian/export", {
        method: "POST",
        headers: { accept: "application/json" },
        cache: "no-store",
      }).catch(() => {});

      try {
        setData(await refreshBrian());
      } catch {
        // Mevcut Brian verisi korunur.
      }
    },
    [],
  );

  return {
    data,
    setData,
    gateOn,
    daysLeft,
    learnDeliveryDeparture,
  };
}
