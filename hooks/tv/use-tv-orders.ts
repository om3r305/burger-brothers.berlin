"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { fetchOrdersFromDb as fetchOrdersFromOrdersCache } from "@/lib/orders";
import type {
  MinuteCacheEntry,
  StoredOrder,
  TvFirstSeenEntry,
  TvOrderClockEntry,
  TvToastTone,
} from "@/types/tv";
import {
  UNKNOWN_ORDER_GRACE_MS,
  autoDisplayStatus,
  dayBoundsMs,
  etaFor,
  fetchOrdersFromTvEndpoint,
  getOrderExactCreatedMs,
  getOrderStartMs,
  normalizeOrders,
  orderDateFromId,
  persistEtaAdjustToDb,
  plannedStartMs,
  readTvClockCache,
  readTvFirstSeenCache,
  remainingMinutes,
  saveTvClockCache,
  saveTvFirstSeenCache,
} from "@/lib/tv/domain";

type Notify = (
  message: string,
  tone?: TvToastTone,
  durationMs?: number,
) => void;

export function useTvOrders({
  avgPickup,
  avgDelivery,
  newGraceMin,
  timezone,
  nowMs,
  onNewOrders,
  notify,
}: {
  avgPickup: number;
  avgDelivery: number;
  newGraceMin: number;
  timezone: string;
  nowMs: number;
  onNewOrders: (orders: StoredOrder[]) => void;
  notify: Notify;
}) {
  const [orders, setOrders] = useState<StoredOrder[]>([]);
  const [etaOverrides, setEtaOverridesState] = useState<Record<string, number>>(
    {},
  );
  const [etaBusyIds, setEtaBusyIds] = useState<Set<string>>(() => new Set());
  const [outSince, setOutSince] = useState<Record<string, number>>({});

  const etaOverridesRef = useRef<Record<string, number>>({});
  const etaBusyRef = useRef<Set<string>>(new Set());
  const minuteCacheRef = useRef<Record<string, MinuteCacheEntry>>({});
  const orderClockRef = useRef<Record<string, TvOrderClockEntry>>({});
  const refreshSequenceRef = useRef(0);

  const setEtaOverrides = useCallback(
    (
      updater:
        | Record<string, number>
        | ((current: Record<string, number>) => Record<string, number>),
    ) => {
      setEtaOverridesState((current) => {
        const next =
          typeof updater === "function" ? updater(current) : updater;
        etaOverridesRef.current = next;
        return next;
      });
    },
    [],
  );

  useEffect(() => {
    orderClockRef.current = readTvClockCache();
  }, []);

  const getStableLeftMin = useCallback(
    (order: StoredOrder, etaOverride?: number | null) => {
      const effectiveEta = etaOverride ?? etaFor(order, avgPickup, avgDelivery);
      const etaKey = Number(effectiveEta || 0);
      const plannedMs = plannedStartMs(order, timezone);
      const plannedFuture = Boolean(plannedMs && plannedMs > nowMs);
      const isFinal =
        order.status === "done" || order.status === "cancelled";
      const plannedKey = String(order.planned || "");
      const raw = remainingMinutes(
        order,
        effectiveEta,
        timezone,
        nowMs,
      );

      if (plannedFuture || isFinal) {
        delete minuteCacheRef.current[order.id];
        return raw;
      }

      const previous = minuteCacheRef.current[order.id];
      const clock = orderClockRef.current[order.id];
      const startMs =
        plannedMs && plannedMs > nowMs
          ? plannedMs
          : getOrderStartMs(order, orderClockRef.current, null) ?? nowMs;

      const calculatedDeadlineMs =
        startMs + Math.max(1, etaKey) * 60_000;
      const fallbackDeadlineMs = nowMs + raw * 60_000;
      const nextDeadlineMs = Number.isFinite(calculatedDeadlineMs)
        ? calculatedDeadlineMs
        : fallbackDeadlineMs;

      if (
        !previous ||
        previous.plannedKey !== plannedKey ||
        previous.etaKey !== etaKey
      ) {
        const safeDeadline =
          clock?.startMs && Number.isFinite(clock.startMs)
            ? clock.startMs + Math.max(1, etaKey) * 60_000
            : nextDeadlineMs;

        minuteCacheRef.current[order.id] = {
          deadlineMs: safeDeadline,
          etaKey,
          plannedKey,
        };

        return Math.floor((safeDeadline - nowMs) / 60_000);
      }

      const stableDeadlineMs = Math.min(
        previous.deadlineMs,
        nextDeadlineMs,
      );

      minuteCacheRef.current[order.id] = {
        ...previous,
        deadlineMs: stableDeadlineMs,
      };

      return Math.floor((stableDeadlineMs - nowMs) / 60_000);
    },
    [avgDelivery, avgPickup, nowMs, timezone],
  );

  const refresh = useCallback(async () => {
    const refreshSequence = ++refreshSequenceRef.current;

    try {
      const endpointOrders = await fetchOrdersFromTvEndpoint();
      let sharedOrders: StoredOrder[] = [];

      try {
        const sharedRaw: unknown = await fetchOrdersFromOrdersCache();
        sharedOrders = normalizeOrders(sharedRaw);
      } catch (caught) {
        console.warn("TV shared order source failed", caught);
      }

      const merged = new Map<string, StoredOrder>();

      for (const order of [...endpointOrders, ...sharedOrders]) {
        const previous = merged.get(order.id);

        if (!previous) {
          merged.set(order.id, order);
          continue;
        }

        const previousTs =
          getOrderExactCreatedMs(previous, null) ??
          getOrderStartMs(previous, orderClockRef.current, null) ??
          previous.ts ??
          0;

        const nextTs =
          getOrderExactCreatedMs(order, null) ??
          getOrderStartMs(order, orderClockRef.current, null) ??
          order.ts ??
          0;

        const stableTs =
          previousTs > 0 && nextTs > 0
            ? Math.min(previousTs, nextTs)
            : previousTs || nextTs;

        merged.set(order.id, {
          ...previous,
          ...order,
          ts: stableTs || order.ts || previous.ts,
          createdAt: previous.createdAt || order.createdAt || null,
          updatedAt: order.updatedAt || previous.updatedAt || null,
          etaMin: order.etaMin ?? previous.etaMin ?? null,
          etaAdjustMin:
            order.etaAdjustMin ?? previous.etaAdjustMin ?? 0,
          customer: {
            ...(previous.customer || {}),
            ...(order.customer || {}),
          },
          meta: {
            ...(previous.meta || {}),
            ...(order.meta || {}),
          },
          items: order.items.length ? order.items : previous.items,
        });
      }

      const advanced = Array.from(merged.values()).map((order) => ({
        ...order,
        status: autoDisplayStatus(
          order,
          avgPickup,
          avgDelivery,
          newGraceMin,
          timezone,
        ),
      }));

      const { start, end, key: todayKey } = dayBoundsMs(timezone);
      const currentTime = Date.now();
      const currentClock = {
        ...orderClockRef.current,
        ...readTvClockCache(),
      };
      const firstSeenCache = readTvFirstSeenCache();
      const nextClock: Record<string, TvOrderClockEntry> = {};
      const nextFirstSeen: Record<string, TvFirstSeenEntry> = {};

      const today = advanced.filter((order) => {
        const id = String(order.id || "");
        if (!id) return false;

        const idDayMs = orderDateFromId(order.orderId || order.id);
        const exactMs = getOrderExactCreatedMs(order, null);
        const cachedClock = currentClock[id];
        const cachedSeen = firstSeenCache[id];
        const isFinal =
          order.status === "done" || order.status === "cancelled";
        const isActive = !isFinal;

        let dayMs: number | null = idDayMs ?? exactMs ?? null;

        if (
          dayMs == null &&
          cachedClock?.dayKey === todayKey &&
          cachedClock.startMs > 0
        ) {
          dayMs = cachedClock.startMs;
        }

        if (
          dayMs == null &&
          cachedSeen?.dayKey === todayKey &&
          cachedSeen.firstSeenMs > 0
        ) {
          dayMs = cachedSeen.firstSeenMs;
        }

        if (dayMs == null && isActive) {
          dayMs = currentTime;
          nextFirstSeen[id] = {
            firstSeenMs: currentTime,
            dayKey: todayKey,
            orderId: order.orderId || order.id,
          };
        }

        if (dayMs == null || !Number.isFinite(dayMs)) return false;
        if (dayMs < start || dayMs > end) return false;

        const hasReliableDate = idDayMs != null || exactMs != null;
        const firstSeenMs =
          nextFirstSeen[id]?.firstSeenMs ??
          cachedSeen?.firstSeenMs ??
          cachedClock?.startMs ??
          dayMs;

        if (
          !hasReliableDate &&
          currentTime - firstSeenMs > UNKNOWN_ORDER_GRACE_MS
        ) {
          return false;
        }

        const cachedSameDay =
          cachedClock?.dayKey === todayKey && cachedClock.startMs > 0;

        const startMs =
          exactMs ??
          (cachedSameDay ? cachedClock.startMs : null) ??
          nextFirstSeen[id]?.firstSeenMs ??
          cachedSeen?.firstSeenMs ??
          currentTime;

        nextClock[id] = {
          startMs,
          dayKey: todayKey,
          orderId: order.orderId || order.id,
        };

        if (!nextFirstSeen[id]) {
          nextFirstSeen[id] = {
            firstSeenMs: startMs,
            dayKey: todayKey,
            orderId: order.orderId || order.id,
          };
        }

        return true;
      });

      if (refreshSequence !== refreshSequenceRef.current) {
        return;
      }

      orderClockRef.current = nextClock;
      saveTvClockCache(nextClock);
      saveTvFirstSeenCache(nextFirstSeen);

      setOrders(today);
      onNewOrders(today);

      const activeIds = new Set(today.map((order) => order.id));
      minuteCacheRef.current = Object.fromEntries(
        Object.entries(minuteCacheRef.current).filter(([id]) =>
          activeIds.has(id),
        ),
      );

      setOutSince((current) => {
        const next = { ...current };

        for (const order of today) {
          if (order.status === "out_for_delivery") {
            if (!next[order.id]) {
              next[order.id] =
                current[order.id] ??
                getOrderStartMs(order, nextClock, order.ts) ??
                order.ts;
            }
          } else {
            delete next[order.id];
          }
        }

        return next;
      });
    } catch (caught) {
      console.error("TV refresh failed", caught);
    }
  }, [
    avgDelivery,
    avgPickup,
    newGraceMin,
    onNewOrders,
    timezone,
  ]);

  useEffect(() => {
    void refresh();

    const timerId = window.setInterval(() => void refresh(), 5000);
    const onRefreshOrders = () => void refresh();

    window.addEventListener(
      "bb:refresh-orders",
      onRefreshOrders as EventListener,
    );

    return () => {
      window.clearInterval(timerId);
      window.removeEventListener(
        "bb:refresh-orders",
        onRefreshOrders as EventListener,
      );
    };
  }, [refresh]);

  const adjustEta = useCallback(
    async (order: StoredOrder, delta: number) => {
      if (etaBusyRef.current.has(order.id)) {
        notify("ETA wird bereits gespeichert.", "warning");
        return;
      }

      const previous = etaOverridesRef.current[order.id];
      const base = previous ?? etaFor(order, avgPickup, avgDelivery);
      const next = Math.max(
        1,
        Math.min(
          base + delta,
          (order.etaMin ?? base) + 60,
          240,
        ),
      );

      etaBusyRef.current.add(order.id);
      setEtaBusyIds(new Set(etaBusyRef.current));
      delete minuteCacheRef.current[order.id];

      setEtaOverrides((current) => ({
        ...current,
        [order.id]: next,
      }));

      try {
        await persistEtaAdjustToDb(order.id, delta, "tv");
        await refresh();
      } catch (caught) {
        console.error("ETA update failed", caught);

        setEtaOverrides((current) => {
          const copy = { ...current };

          if (previous == null) delete copy[order.id];
          else copy[order.id] = previous;

          return copy;
        });

        notify("ETA konnte nicht gespeichert werden.", "error");
      } finally {
        etaBusyRef.current.delete(order.id);
        setEtaBusyIds(new Set(etaBusyRef.current));
      }
    },
    [avgDelivery, avgPickup, notify, refresh, setEtaOverrides],
  );

  const clearTimer = useCallback((orderId: string) => {
    delete minuteCacheRef.current[orderId];
  }, []);

  const setOptimisticAcceptedOrder = useCallback(
    (acceptedOrder: StoredOrder, etaMin: number) => {
      clearTimer(acceptedOrder.id);

      setOrders((current) =>
        current.map((order) =>
          order.id === acceptedOrder.id ? acceptedOrder : order,
        ),
      );

      setEtaOverrides((current) => ({
        ...current,
        [acceptedOrder.id]: etaMin,
      }));
    },
    [clearTimer, setEtaOverrides],
  );

  const setDeliveryDeparture = useCallback(
    (orderId: string, departed: boolean) => {
      setOutSince((current) => {
        const next = { ...current };

        if (departed) next[orderId] = Date.now();
        else delete next[orderId];

        return next;
      });
    },
    [],
  );

  const getStartTime = useCallback((order: StoredOrder) => {
    return (
      getOrderStartMs(order, orderClockRef.current, order.ts) || order.ts
    );
  }, []);

  return {
    orders,
    setOrders,
    refresh,
    etaOverrides,
    etaBusyIds,
    outSince,
    getStableLeftMin,
    adjustEta,
    clearTimer,
    setOptimisticAcceptedOrder,
    setDeliveryDeparture,
    getStartTime,
  };
}
