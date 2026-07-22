"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { upsertOrder, type StoredOrder } from "@/lib/orders";
import {
  DRIVER_LAST_REFRESH_KEY,
  claimOrderOnServer,
  clearPosKey,
  dayKeyForMs,
  fetchDriverOrdersFromDb,
  getOrderCreatedMs,
  getOrderDoneMs,
  isDriverOrder,
  isOrderForTodayOrFresh,
  normalizeMode,
  normalizeStatus,
  orderDisplayTotal,
  orderDriver,
  orderPayableTotal,
  orderTipAmount,
  persistDriverOrderSnapshot,
  todayKey,
  updateOrderStatusOnServer,
  withDriverState,
} from "@/lib/driver/domain";
import type {
  DriverCompletionToast,
  DriverIdentity,
  DriverOrder,
  DriverStats,
  DriverToastTone,
} from "@/types/driver";

type Notify = (
  message: string,
  tone?: DriverToastTone,
  durationMs?: number,
) => void;

function toStoredOrder(order: DriverOrder): StoredOrder {
  return order as unknown as StoredOrder;
}

export function useDriverOrders({
  current,
  timezone,
  refreshMs,
  activeUnknownGraceMs,
  notify,
}: {
  current: DriverIdentity | null;
  timezone: string;
  refreshMs: number;
  activeUnknownGraceMs: number;
  notify: Notify;
}) {
  const [orders, setOrders] = useState<DriverOrder[]>([]);
  const [lastRefreshAt, setLastRefreshAt] = useState<number | null>(null);
  const [refreshError, setRefreshError] = useState("");
  const [manualRefreshing, setManualRefreshing] = useState(false);
  const [batchBusy, setBatchBusy] = useState(false);
  const [busyOrderIds, setBusyOrderIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [completion, setCompletion] =
    useState<DriverCompletionToast | null>(null);

  const refreshAbortRef = useRef<AbortController | null>(null);
  const refreshRunningRef = useRef(false);
  const refreshSequenceRef = useRef(0);
  const latestOrdersRef = useRef<DriverOrder[]>([]);
  const completionTimerRef = useRef<number | null>(null);

  const markBusy = useCallback((id: string, busy: boolean) => {
    setBusyOrderIds((currentIds) => {
      const nextIds = new Set(currentIds);

      if (busy) nextIds.add(id);
      else nextIds.delete(id);

      return nextIds;
    });
  }, []);

  const showCompletion = useCallback((value: DriverCompletionToast) => {
    setCompletion(value);

    if (completionTimerRef.current != null) {
      window.clearTimeout(completionTimerRef.current);
    }

    completionTimerRef.current = window.setTimeout(() => {
      setCompletion(null);
      completionTimerRef.current = null;
    }, 4500);
  }, []);

  useEffect(() => {
    return () => {
      if (completionTimerRef.current != null) {
        window.clearTimeout(completionTimerRef.current);
      }
    };
  }, []);

  const refresh = useCallback(
    async (force = false) => {
      if (refreshRunningRef.current && !force) return;

      if (force && refreshAbortRef.current) {
        refreshAbortRef.current.abort();
      }

      const sequence = ++refreshSequenceRef.current;
      const controller = new AbortController();

      refreshAbortRef.current = controller;
      refreshRunningRef.current = true;

      try {
        const allOrders = await fetchDriverOrdersFromDb(controller.signal);

        if (sequence !== refreshSequenceRef.current) return;

        const visibleOrders = allOrders
          .filter((order) => normalizeMode(order.mode) === "delivery")
          .filter((order) => !order.archivedAt && !order.anonymizedAt)
          .filter((order) =>
            isOrderForTodayOrFresh(
              order,
              timezone,
              activeUnknownGraceMs,
            ),
          );

        latestOrdersRef.current = visibleOrders;
        setOrders(visibleOrders);
        setRefreshError("");

        const now = Date.now();
        setLastRefreshAt(now);

        try {
          localStorage.setItem(
            DRIVER_LAST_REFRESH_KEY,
            String(now),
          );
        } catch {
          // Local refresh timestamp is only a convenience.
        }
      } catch (error) {
        if (
          !(error instanceof Error && error.name === "AbortError")
        ) {
          console.error("Driver refresh failed", error);
          setRefreshError(
            "Bestellungen konnten nicht aktualisiert werden. Bitte Verbindung prüfen.",
          );
        }
      } finally {
        if (refreshAbortRef.current === controller) {
          refreshAbortRef.current = null;
          refreshRunningRef.current = false;
        }
      }
    },
    [activeUnknownGraceMs, timezone],
  );

  useEffect(() => {
    const previousRefresh = Number(
      localStorage.getItem(DRIVER_LAST_REFRESH_KEY) || 0,
    );

    if (Number.isFinite(previousRefresh) && previousRefresh > 0) {
      setLastRefreshAt(previousRefresh);
    }

    void refresh(true);

    const intervalId = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void refresh(false);
      }
    }, refreshMs);

    const onFocus = () => void refresh(true);
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        void refresh(true);
      }
    };
    const onOrders = () => void refresh(true);

    window.addEventListener("focus", onFocus);
    window.addEventListener(
      "bb:refresh-orders",
      onOrders as EventListener,
    );
    window.addEventListener(
      "bb_orders_changed",
      onOrders as EventListener,
    );
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      window.clearInterval(intervalId);
      refreshAbortRef.current?.abort();
      window.removeEventListener("focus", onFocus);
      window.removeEventListener(
        "bb:refresh-orders",
        onOrders as EventListener,
      );
      window.removeEventListener(
        "bb_orders_changed",
        onOrders as EventListener,
      );
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [refresh, refreshMs]);

  const pending = useMemo(
    () =>
      orders
        .filter((order) => {
          const status = normalizeStatus(order.status);

          return (
            normalizeMode(order.mode) === "delivery" &&
            !orderDriver(order)?.id &&
            status !== "out_for_delivery" &&
            status !== "done" &&
            status !== "cancelled"
          );
        })
        .sort(
          (left, right) =>
            (getOrderCreatedMs(left) ?? left.ts ?? 0) -
            (getOrderCreatedMs(right) ?? right.ts ?? 0),
        ),
    [orders],
  );

  const mine = useMemo(() => {
    if (!current) return [];

    return orders
      .filter((order) => {
        const status = normalizeStatus(order.status);

        return (
          isDriverOrder(order, current) &&
          status !== "done" &&
          status !== "cancelled"
        );
      })
      .sort(
        (left, right) =>
          (getOrderCreatedMs(left) ?? left.ts ?? 0) -
          (getOrderCreatedMs(right) ?? right.ts ?? 0),
      );
  }, [current, orders]);

  const stats = useMemo<DriverStats>(() => {
    if (!current) return { count: 0, total: 0, tip: 0 };

    const today = todayKey(timezone);
    const completedToday = orders.filter((order) => {
      if (!isDriverOrder(order, current)) return false;
      if (normalizeStatus(order.status) !== "done") return false;

      const doneMs = getOrderDoneMs(order);
      return doneMs != null && dayKeyForMs(doneMs, timezone) === today;
    });

    return {
      count: completedToday.length,
      total: completedToday.reduce(
        (sum, order) => sum + orderDisplayTotal(order),
        0,
      ),
      tip: completedToday.reduce(
        (sum, order) => sum + orderTipAmount(order),
        0,
      ),
    };
  }, [current, orders, timezone]);

  const claimOne = useCallback(
    async (order: DriverOrder) => {
      if (!current) {
        notify("Bitte zuerst anmelden.", "warning");
        return false;
      }

      const id = String(order.id);
      markBusy(id, true);

      try {
        const claimed = await claimOrderOnServer(order, current);

        setOrders((existing) =>
          existing.map((item) =>
            String(item.id) === id ? claimed : item,
          ),
        );

        await refresh(true);
        notify(`Auftrag #${id} übernommen.`, "success");
        return true;
      } catch (error) {
        await refresh(true);
        notify(
          error instanceof Error
            ? error.message
            : "Dieser Auftrag konnte nicht übernommen werden.",
          "error",
        );
        return false;
      } finally {
        markBusy(id, false);
      }
    },
    [current, markBusy, notify, refresh],
  );

  const claimMany = useCallback(
    async (selectedOrders: DriverOrder[]) => {
      if (!current) {
        notify("Bitte zuerst anmelden.", "warning");
        return { claimed: 0, errors: 1 };
      }

      if (!selectedOrders.length) {
        notify("Keine Auswahl.", "warning");
        return { claimed: 0, errors: 0 };
      }

      setBatchBusy(true);

      try {
        let claimedCount = 0;
        const errors: string[] = [];

        for (const order of selectedOrders) {
          const id = String(order.id);
          markBusy(id, true);

          try {
            const claimed = await claimOrderOnServer(order, current);
            claimedCount += 1;

            setOrders((existing) =>
              existing.map((item) =>
                String(item.id) === id ? claimed : item,
              ),
            );
          } catch (error) {
            errors.push(
              `#${id}: ${
                error instanceof Error
                  ? error.message
                  : "konnte nicht übernommen werden"
              }`,
            );
          } finally {
            markBusy(id, false);
          }
        }

        await refresh(true);

        if (claimedCount > 0) {
          notify(
            `${claimedCount} Auftrag/Aufträge übernommen.`,
            "success",
          );
        }

        if (errors.length) {
          notify(errors.join("\n"), "error", 8000);
        }

        return { claimed: claimedCount, errors: errors.length };
      } finally {
        setBatchBusy(false);
      }
    },
    [current, markBusy, notify, refresh],
  );

  const releaseOne = useCallback(
    async (order: DriverOrder) => {
      if (!current) return false;

      if (!isDriverOrder(order, current)) {
        notify("Dieser Auftrag gehört nicht Ihnen.", "error");
        return false;
      }

      const id = String(order.id);
      markBusy(id, true);

      try {
        clearPosKey(order.id);

        const updated = withDriverState(
          order,
          null,
          "preparing",
          {
            claimedAt: null,
            lastPos: null,
          },
        );

        setOrders((existing) =>
          existing.map((item) =>
            String(item.id) === id ? updated : item,
          ),
        );

        await persistDriverOrderSnapshot(
          updated,
          "preparing",
          current.name,
        );
        await refresh(true);
        notify(`Auftrag #${id} zurückgegeben.`, "info");
        return true;
      } catch (error) {
        await refresh(true);
        notify(
          error instanceof Error
            ? error.message
            : "Auftrag konnte nicht zurückgegeben werden.",
          "error",
        );
        return false;
      } finally {
        markBusy(id, false);
      }
    },
    [current, markBusy, notify, refresh],
  );

  const finishOne = useCallback(
    async (order: DriverOrder) => {
      if (!current) return false;

      const id = String(order.id);
      const previousOrder = order;

      markBusy(id, true);

      try {
        clearPosKey(order.id);

        const now = Date.now();
        const tip = orderTipAmount(order);
        const total = orderPayableTotal(order);
        const updated = withDriverState(
          order,
          current,
          "done",
          {
            deliveredAt: now,
            doneAt: now,
            completedAt: now,
            lastPos: null,
            lastDriverPos: null,
            lastDriverPosAt: null,
          },
        );

        setOrders((existing) =>
          existing.map((item) =>
            String(item.id) === id ? updated : item,
          ),
        );

        const serverOrder = await updateOrderStatusOnServer(
          updated,
          "done",
          current,
          {
            deliveredAt: now,
            doneAt: now,
            completedAt: now,
            lastPos: null,
            lastDriverPos: null,
            lastDriverPosAt: null,
          },
        );

        const finalOrder = serverOrder || updated;

        try {
          upsertOrder(toStoredOrder(finalOrder));
        } catch {
          // Local cache is secondary; DB response remains authoritative.
        }

        setOrders((existing) =>
          existing.map((item) =>
            String(item.id) === id ? finalOrder : item,
          ),
        );

        showCompletion({ id, tip, total });

        window.dispatchEvent(
          new CustomEvent("bb:refresh-orders"),
        );
        window.dispatchEvent(
          new CustomEvent("bb_orders_changed"),
        );

        await refresh(true);
        return true;
      } catch (error) {
        setOrders((existing) =>
          existing.map((item) =>
            String(item.id) === id ? previousOrder : item,
          ),
        );

        await refresh(true);

        notify(
          error instanceof Error
            ? error.message
            : "Status konnte nicht gespeichert werden. Bitte erneut prüfen.",
          "error",
        );
        return false;
      } finally {
        markBusy(id, false);
      }
    },
    [current, markBusy, notify, refresh, showCompletion],
  );

  const manualRefresh = useCallback(async () => {
    setManualRefreshing(true);

    try {
      await refresh(true);
    } finally {
      setManualRefreshing(false);
    }
  }, [refresh]);

  return {
    orders,
    latestOrdersRef,
    pending,
    mine,
    stats,
    lastRefreshAt,
    refreshError,
    manualRefreshing,
    batchBusy,
    busyOrderIds,
    completion,
    refresh,
    manualRefresh,
    claimOne,
    claimMany,
    releaseOne,
    finishOne,
  };
}
