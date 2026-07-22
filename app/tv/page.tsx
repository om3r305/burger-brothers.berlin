// app/tv/page.tsx
"use client";

import "./tv.css";

import clsx from "clsx";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import { analyze, normalizeStreet } from "@/lib/brian";
import type {
  LeftPanel,
  OrderStatus,
  StoredOrder,
  TvView,
} from "@/types/tv";
import {
  autoDisplayStatus,
  clampAcceptEta,
  doneLockTitle,
  etaFor,
  getDoneAtMs,
  getPaymentKind,
  isDoneLocked,
  normalizeOrders,
  normalizePlannedHHMM,
  roundEtaStep,
  sortLeftMinutes,
  updateOrderStatusDbFirst,
} from "@/lib/tv/domain";
import { AcceptOrderOverlay } from "@/components/tv/AcceptOrderOverlay";
import { OrderCard } from "@/components/tv/OrderCard";
import { OrderDetailsModal } from "@/components/tv/OrderDetailsModal";
import { TvConfirmDialog } from "@/components/tv/TvConfirmDialog";
import { TvHeader } from "@/components/tv/TvHeader";
import { TvSidebar } from "@/components/tv/TvSidebar";
import { TvToastViewport } from "@/components/tv/TvToastViewport";
import { useTvBrian } from "@/hooks/tv/use-tv-brian";
import { useTvClock } from "@/hooks/tv/use-tv-clock";
import { useTvFeedback } from "@/hooks/tv/use-tv-feedback";
import { useTvOrders } from "@/hooks/tv/use-tv-orders";
import { useTvPause } from "@/hooks/tv/use-tv-pause";
import { useTvPrint } from "@/hooks/tv/use-tv-print";
import { useTvProducts } from "@/hooks/tv/use-tv-products";
import {
  usePendingOrderAlarm,
  useTvSound,
} from "@/hooks/tv/use-tv-sound";
import { useTvSettings } from "@/hooks/tv/use-tv-settings";

export default function TVPage() {
  const router = useRouter();
  const nowMs = useTvClock();

  const {
    messages,
    dismiss,
    notify,
    confirm: requestConfirmation,
    confirmRequest,
    acceptConfirm,
    cancelConfirm,
  } = useTvFeedback();

  useEffect(() => {
    const hasUi = document.cookie
      .split("; ")
      .some((cookie) => cookie.trim().startsWith("bb_tv_ui=1"));

    if (!hasUi) {
      router.replace("/tv/login?next=/tv");
      return;
    }

    try {
      sessionStorage.setItem("bb_tv_tab", "1");
    } catch {
      // Session marker is only a client convenience.
    }
  }, [router]);

  const {
    productAvailability,
    timezone,
    avgPickup,
    avgDelivery,
    newGraceMin,
    refreshSettings,
  } = useTvSettings();

  const sound = useTvSound();

  const {
    orders,
    refresh,
    etaOverrides,
    etaBusyIds,
    outSince,
    getStableLeftMin,
    adjustEta,
    setOptimisticAcceptedOrder,
    setDeliveryDeparture,
    getStartTime,
  } = useTvOrders({
    avgPickup,
    avgDelivery,
    newGraceMin,
    timezone,
    nowMs,
    onNewOrders: sound.handleNewOrders,
    notify,
  });

  const brian = useTvBrian();
  const { pause, setPause } = useTvPause();
  const { printOrder, printingOrderId } = useTvPrint(notify);

  const products = useTvProducts({
    productAvailability,
    timezone,
    onSettingsChanged: () => {
      void refreshSettings();
    },
  });

  const [view, setView] = useState<TvView>("incoming");
  const [selectedOrderId, setSelectedOrderId] = useState("");
  const [leftOpen, setLeftOpen] = useState(false);
  const [leftPanel, setLeftPanel] = useState<LeftPanel>("overview");
  const [acceptEtaDrafts, setAcceptEtaDrafts] = useState<
    Record<string, number>
  >({});
  const [acceptPlannedDrafts, setAcceptPlannedDrafts] = useState<
    Record<string, string>
  >({});
  const [acceptBusyId, setAcceptBusyId] = useState("");
  const [statusBusyIds, setStatusBusyIds] = useState<Set<string>>(
    () => new Set(),
  );
  const statusBusyRef = useRef<Set<string>>(new Set());
  const [cancelBusyId, setCancelBusyId] = useState("");

  const selectedOrder = useMemo(
    () => orders.find((order) => order.id === selectedOrderId) ?? null,
    [orders, selectedOrderId],
  );

  useEffect(() => {
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setLeftOpen(false);
      if (!cancelBusyId) setSelectedOrderId("");
    };

    window.addEventListener("keydown", onEscape);
    return () => window.removeEventListener("keydown", onEscape);
  }, [cancelBusyId]);

  const tabStats = useMemo(() => {
    const incoming = orders.filter((order) => {
      const pickupReady =
        order.mode === "pickup" && order.status === "ready";

      return (
        order.status !== "done" &&
        order.status !== "cancelled" &&
        order.status !== "out_for_delivery" &&
        !pickupReady
      );
    }).length;

    const onroad = orders.filter(
      (order) =>
        order.status === "out_for_delivery" ||
        (order.mode === "pickup" && order.status === "ready"),
    ).length;

    const finished = orders.filter(
      (order) =>
        order.status === "done" || order.status === "cancelled",
    ).length;

    return { incoming, onroad, finished };
  }, [orders]);

  const filteredOrders = useMemo(() => {
    return orders
      .filter((order) => {
        const pickupReady =
          order.mode === "pickup" && order.status === "ready";

        if (view === "incoming") {
          return (
            order.status !== "done" &&
            order.status !== "cancelled" &&
            order.status !== "out_for_delivery" &&
            !pickupReady
          );
        }

        if (view === "onroad") {
          return order.status === "out_for_delivery" || pickupReady;
        }

        return (
          order.status === "done" || order.status === "cancelled"
        );
      })
      .sort((left, right) => {
        if (view === "finished") {
          const leftDone =
            getDoneAtMs(left) ?? getStartTime(left) ?? left.ts ?? 0;
          const rightDone =
            getDoneAtMs(right) ?? getStartTime(right) ?? right.ts ?? 0;
          return rightDone - leftDone;
        }

        const leftMinutes = sortLeftMinutes(
          left,
          avgPickup,
          avgDelivery,
          timezone,
          nowMs,
          etaOverrides[left.id],
        );
        const rightMinutes = sortLeftMinutes(
          right,
          avgPickup,
          avgDelivery,
          timezone,
          nowMs,
          etaOverrides[right.id],
        );

        if (leftMinutes !== rightMinutes) {
          return leftMinutes - rightMinutes;
        }

        return getStartTime(left) - getStartTime(right);
      });
  }, [
    avgDelivery,
    avgPickup,
    etaOverrides,
    getStartTime,
    nowMs,
    orders,
    timezone,
    view,
  ]);

  const pendingAcceptOrder = useMemo(() => {
    return (
      orders
        .filter((order) => order.status === "new")
        .sort((left, right) => getStartTime(left) - getStartTime(right))[0] ??
      null
    );
  }, [getStartTime, orders]);

  const pendingAcceptEta = pendingAcceptOrder
    ? acceptEtaDrafts[pendingAcceptOrder.id] ??
      roundEtaStep(
        etaFor(pendingAcceptOrder, avgPickup, avgDelivery),
      )
    : 0;

  const pendingAcceptPlanned = pendingAcceptOrder
    ? acceptPlannedDrafts[pendingAcceptOrder.id] ??
      normalizePlannedHHMM(pendingAcceptOrder.planned)
    : "";

  useEffect(() => {
    if (!pendingAcceptOrder) return;

    setAcceptEtaDrafts((current) => {
      if (current[pendingAcceptOrder.id] != null) return current;

      return {
        ...current,
        [pendingAcceptOrder.id]: roundEtaStep(
          etaFor(pendingAcceptOrder, avgPickup, avgDelivery),
        ),
      };
    });

    const planned = normalizePlannedHHMM(pendingAcceptOrder.planned);

    if (planned) {
      setAcceptPlannedDrafts((current) => {
        if (current[pendingAcceptOrder.id]) return current;
        return { ...current, [pendingAcceptOrder.id]: planned };
      });
    }
  }, [
    avgDelivery,
    avgPickup,
    pendingAcceptOrder?.id,
    pendingAcceptOrder?.planned,
  ]);

  usePendingOrderAlarm({
    order: pendingAcceptOrder,
    busy: Boolean(
      pendingAcceptOrder &&
        acceptBusyId === pendingAcceptOrder.id,
    ),
    play: sound.play,
  });

  const handleAcceptAndPrint = useCallback(
    async (order: StoredOrder) => {
      const plannedTime = normalizePlannedHHMM(
        acceptPlannedDrafts[order.id] || order.planned,
      );
      const plannedMode = Boolean(plannedTime);
      const etaMin = clampAcceptEta(
        acceptEtaDrafts[order.id] ??
          roundEtaStep(etaFor(order, avgPickup, avgDelivery)),
      );

      setAcceptBusyId(order.id);
      sound.stop();

      const acceptedLocal: StoredOrder = {
        ...order,
        status: "preparing",
        planned: plannedMode ? plannedTime : order.planned,
        etaMin,
        etaAdjustMin: 0,
        meta: {
          ...(order.meta || {}),
          etaMin,
          finalEtaMin: etaMin,
          acceptedEtaMin: etaMin,
          ...(plannedMode
            ? {
                planned: plannedTime,
                confirmedPlanned: plannedTime,
                acceptedPlanned: plannedTime,
              }
            : {}),
          acceptedAt: Date.now(),
          acceptedBy: "tv",
        },
      };

      setOptimisticAcceptedOrder(acceptedLocal, etaMin);

      try {
        const response = await updateOrderStatusDbFirst(
          order.id,
          "preparing",
          "tv",
          {
            etaMin,
            etaAdjustMin: 0,
            ...(plannedMode
              ? {
                  planned: plannedTime,
                  confirmedPlanned: plannedTime,
                  acceptedPlanned: plannedTime,
                }
              : {}),
            accepted: true,
            acceptAndPrint: true,
            acceptSource: "tv",
          },
        );

        const printCandidate =
          normalizeOrders([
            response?.order ||
              response?.data ||
              response?.item ||
              acceptedLocal,
          ])[0] ?? acceptedLocal;

        await printOrder(
          {
            ...printCandidate,
            planned: plannedMode
              ? plannedTime
              : printCandidate.planned,
            etaMin,
            etaAdjustMin: 0,
            status: "preparing",
            meta: {
              ...(printCandidate.meta || {}),
              etaMin,
              finalEtaMin: etaMin,
              acceptedEtaMin: etaMin,
              ...(plannedMode
                ? {
                    planned: plannedTime,
                    confirmedPlanned: plannedTime,
                    acceptedPlanned: plannedTime,
                  }
                : {}),
            },
          },
          {
            notifySuccess: false,
            throwOnError: true,
          },
        );

        setAcceptEtaDrafts((current) => {
          const next = { ...current };
          delete next[order.id];
          return next;
        });

        setAcceptPlannedDrafts((current) => {
          const next = { ...current };
          delete next[order.id];
          return next;
        });

        await refresh();
      } catch (caught) {
        const message =
          caught instanceof Error ? caught.message : String(caught || "");

        console.error("Accept and print failed", caught);
        notify(
          `Bestellung wurde nicht sauber angenommen/gedruckt: ${message}`,
          "error",
          7000,
        );
        await refresh();
      } finally {
        setAcceptBusyId("");
      }
    },
    [
      acceptEtaDrafts,
      acceptPlannedDrafts,
      avgDelivery,
      avgPickup,
      notify,
      printOrder,
      refresh,
      setOptimisticAcceptedOrder,
      sound,
    ],
  );

  const handleStatusChange = useCallback(
    async (order: StoredOrder, status: OrderStatus) => {
      if (isDoneLocked(order, nowMs)) {
        notify(
          "Diese Bestellung ist abgeschlossen und nach 3 Minuten gesperrt.",
          "warning",
        );
        return;
      }

      if (statusBusyRef.current.has(order.id)) return;

      statusBusyRef.current.add(order.id);
      setStatusBusyIds(new Set(statusBusyRef.current));

      try {
        if (status === "out_for_delivery") {
          setDeliveryDeparture(order.id, true);

          try {
            await brian.learnDeliveryDeparture(order, filteredOrders);
          } catch (caught) {
            console.error("brian.learn failed", caught);
          }
        } else if (order.status === "out_for_delivery") {
          setDeliveryDeparture(order.id, false);
        }

        await updateOrderStatusDbFirst(order.id, status, "tv");
        await refresh();
      } catch (caught) {
        const message =
          caught instanceof Error ? caught.message : String(caught || "");

        notify(
          `Status konnte nicht gespeichert werden: ${message}`,
          "error",
          6000,
        );
      } finally {
        statusBusyRef.current.delete(order.id);
        setStatusBusyIds(new Set(statusBusyRef.current));
      }
    },
    [
      brian,
      filteredOrders,
      notify,
      nowMs,
      refresh,
      setDeliveryDeparture,
    ],
  );

  const handleCancelOrder = useCallback(
    async (order: StoredOrder) => {
      if (isDoneLocked(order, nowMs)) {
        notify(
          "Diese Bestellung ist abgeschlossen und nach 3 Minuten gesperrt.",
          "warning",
        );
        return;
      }

      const onlinePaid = getPaymentKind(order) === "online";
      const accepted = await requestConfirmation({
        title: `Bestellung #${order.id} stornieren?`,
        message: onlinePaid
          ? "Die Bestellung wird storniert.\n\nDie Rückerstattung muss anschließend im Stripe-Dashboard geprüft und manuell durchgeführt werden."
          : "Die Bestellung wird storniert. Bei Barzahlung wird keine Stripe-Rückerstattung ausgelöst.",
        confirmLabel: "Stornieren",
        cancelLabel: "Zurück",
        danger: true,
      });

      if (!accepted) return;

      setCancelBusyId(order.id);

      try {
        await updateOrderStatusDbFirst(
          order.id,
          "cancelled",
          "tv",
        );
        setSelectedOrderId("");
        notify("Bestellung wurde storniert.", "success");
        await refresh();
      } catch (caught) {
        const message =
          caught instanceof Error ? caught.message : String(caught || "");

        notify(
          `Stornierung fehlgeschlagen: ${message}`,
          "error",
          7000,
        );
      } finally {
        setCancelBusyId("");
      }
    },
    [notify, nowMs, refresh, requestConfirmation],
  );

  const handleLogout = useCallback(async () => {
    try {
      const response = await fetch("/api/tv/logout", {
        method: "POST",
        headers: { accept: "application/json" },
      });

      if (!response.ok) {
        throw new Error(`TV_LOGOUT_${response.status}`);
      }
    } catch {
      window.location.assign("/api/tv/logout");
      return;
    }

    try {
      sessionStorage.removeItem("bb_tv_tab");
    } catch {
      // Session marker is only a client convenience.
    }

    router.replace("/tv/login");
  }, [router]);

  return (
    <main className="relative mx-auto max-w-7xl space-y-6 p-4 text-stone-100 antialiased [font-feature-settings:'liga','kern'] [text-rendering:optimizeLegibility] sm:p-6">
      <div className="pointer-events-none fixed inset-0 -z-10 select-none">
        <div className="absolute inset-0 bg-[radial-gradient(1200px_700px_at_10%_-10%,rgba(59,130,246,.18),transparent),radial-gradient(1000px_600px_at_90%_0%,rgba(16,185,129,.14),transparent),linear-gradient(180deg,#0b0f14_0%,#0f1318_50%,#0a0d11_100%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(80%_80%_at_50%_20%,transparent,rgba(0,0,0,.45))]" />
      </div>

      {pendingAcceptOrder ? (
        <AcceptOrderOverlay
          order={pendingAcceptOrder}
          etaValue={pendingAcceptEta}
          plannedValue={pendingAcceptPlanned}
          busy={acceptBusyId === pendingAcceptOrder.id}
          onEtaChange={(value) => {
            setAcceptEtaDrafts((current) => ({
              ...current,
              [pendingAcceptOrder.id]: clampAcceptEta(value),
            }));
          }}
          onPlannedChange={(value) => {
            setAcceptPlannedDrafts((current) => ({
              ...current,
              [pendingAcceptOrder.id]: normalizePlannedHHMM(value),
            }));
          }}
          onAccept={() => handleAcceptAndPrint(pendingAcceptOrder)}
        />
      ) : null}

      <TvHeader
        nowMs={nowMs}
        onMenu={() => {
          setLeftPanel("overview");
          setLeftOpen(true);
        }}
        onLogout={handleLogout}
      />

      {pause.delivery || pause.pickup ? (
        <div className="rounded-xl border border-amber-400/40 bg-amber-500/15 p-3 text-sm text-amber-100">
          {pause.delivery ? (
            <div>
              Aufgrund hoher Auslastung ist <b>Lieferung</b>{" "}
              vorübergehend pausiert.
            </div>
          ) : null}

          {pause.pickup ? (
            <div>
              Aufgrund hoher Auslastung ist <b>Abholung</b>{" "}
              vorübergehend pausiert.
            </div>
          ) : null}
        </div>
      ) : null}

      <section className="flex items-center gap-2">
        {(
          [
            ["incoming", `Neu ${tabStats.incoming}`],
            ["onroad", `Unterwegs ${tabStats.onroad}`],
            ["finished", `Fertig ${tabStats.finished}`],
          ] as const
        ).map(([tab, label]) => (
          <button
            key={tab}
            onClick={() => setView(tab)}
            className={clsx(
              "rounded-full border border-white/10 px-4 py-1.5",
              view === tab
                ? "bg-white/10 font-semibold"
                : "opacity-70",
            )}
          >
            {label}
          </button>
        ))}

        {brian.daysLeft != null && brian.daysLeft > 0 ? (
          <span className="ml-auto text-xs text-stone-400">
            Brian aktiv in {brian.daysLeft} Tagen
          </span>
        ) : null}
      </section>

      <section className="grid grid-cols-1 gap-4">
        {filteredOrders.length === 0 ? (
          <div className="text-sm text-stone-400">
            Keine Einträge.
          </div>
        ) : (
          filteredOrders.map((order) => {
            const peers = filteredOrders
              .filter(
                (item) =>
                  item.id !== order.id &&
                  item.mode === "delivery",
              )
              .map(
                (item) =>
                  item.customer?.address ||
                  item.customer?.addressLine ||
                  "",
              )
              .map(normalizeStreet);

            const brianResult =
              order.mode === "delivery"
                ? analyze(
                    order.customer?.address ||
                      order.customer?.addressLine ||
                      "",
                    peers,
                    brian.data,
                    brian.gateOn,
                  )
                : {
                    led: "gray" as const,
                    clusterColor: undefined,
                  };

            return (
              <OrderCard
                key={order.id}
                order={order}
                display={{
                  avgPickup,
                  avgDelivery,
                  timezone,
                  led: brianResult.led,
                  clusterDot: brianResult.clusterColor,
                  etaOverride: etaOverrides[order.id],
                  outSince: outSince[order.id],
                  leftMin: getStableLeftMin(
                    order,
                    etaOverrides[order.id],
                  ),
                  etaBusy: etaBusyIds.has(order.id),
                  statusBusy: statusBusyIds.has(order.id),
                }}
                actions={{
                  open: () => setSelectedOrderId(order.id),
                  changeStatus: (status) =>
                    handleStatusChange(order, status),
                  adjustEta: (delta) => adjustEta(order, delta),
                  refresh: () => void refresh(),
                }}
              />
            );
          })
        )}
      </section>

      {selectedOrder ? (
        <OrderDetailsModal
          order={selectedOrder}
          startMs={getStartTime(selectedOrder)}
          doneLocked={isDoneLocked(selectedOrder, nowMs)}
          doneLockTitle={doneLockTitle(selectedOrder, nowMs)}
          printing={printingOrderId === selectedOrder.id}
          cancelling={cancelBusyId === selectedOrder.id}
          onClose={() => setSelectedOrderId("")}
          onPrint={async () => {
            await printOrder(selectedOrder);
          }}
          onCancel={() => handleCancelOrder(selectedOrder)}
        />
      ) : null}

      <TvSidebar
        open={leftOpen}
        panel={leftPanel}
        nowMs={nowMs}
        orders={orders}
        pause={pause}
        products={products.products}
        productAvailability={productAvailability}
        productBusyKey={products.busyKey}
        productError={products.error}
        sound={{
          enabled: sound.enabled,
          unlocked: sound.unlocked,
          volume: sound.volume,
          error: sound.error,
          onToggle: sound.toggle,
          onVolume: sound.setVolume,
          onTestDelivery: async () => {
            await sound.play("delivery", true);
          },
          onTestPickup: async () => {
            await sound.play("pickup", true);
          },
        }}
        onClose={() => setLeftOpen(false)}
        onPanelChange={setLeftPanel}
        onPauseChange={setPause}
        onProductChange={products.updateAvailability}
        onProductsRefresh={products.refreshProducts}
      />

      <TvToastViewport
        messages={messages}
        onDismiss={dismiss}
      />

      <TvConfirmDialog
        request={confirmRequest}
        busy={Boolean(cancelBusyId)}
        onConfirm={acceptConfirm}
        onCancel={cancelConfirm}
      />
    </main>
  );
}
