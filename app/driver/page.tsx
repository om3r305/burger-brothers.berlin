// app/driver/page.tsx
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import DriverLiveTracker from "@/components/DriverLiveTracker";
import { DriverCompletionToast } from "@/components/driver/DriverCompletionToast";
import { DriverConfirmDialog } from "@/components/driver/DriverConfirmDialog";
import { DriverHeader } from "@/components/driver/DriverHeader";
import { DriverLogin } from "@/components/driver/DriverLogin";
import { DriverPullIndicator } from "@/components/driver/DriverPullIndicator";
import { DriverRouteBar } from "@/components/driver/DriverRouteBar";
import { DriverToastViewport } from "@/components/driver/DriverToastViewport";
import { OrderWithDetails } from "@/components/driver/OrderWithDetails";
import { PendingOrderCard } from "@/components/driver/PendingOrderCard";
import { useDriverAuth } from "@/hooks/driver/use-driver-auth";
import { useDriverClock } from "@/hooks/driver/use-driver-clock";
import { useDriverFeedback } from "@/hooks/driver/use-driver-feedback";
import { useDriverOrders } from "@/hooks/driver/use-driver-orders";
import { useDriverRoute } from "@/hooks/driver/use-driver-route";
import { useDriverSettings } from "@/hooks/driver/use-driver-settings";
import { usePullToRefresh } from "@/hooks/driver/use-pull-to-refresh";
import {
  glass,
  openExternalMap,
  plannedClaimDetails,
  prettyDeliveryLine,
  sanitizePhone,
  tabButtonClass,
} from "@/lib/driver/domain";
import type { DriverOrder, DriverTab } from "@/types/driver";

export default function DriverPage() {
  useEffect(() => {
    const footer = document.querySelector("footer") as HTMLElement | null;
    const previousDisplay = footer?.style.display || "";

    if (footer) footer.style.display = "none";

    return () => {
      if (footer) footer.style.display = previousDisplay;
    };
  }, []);

  const [tab, setTab] = useState<DriverTab>("new");
  const [selected, setSelected] = useState<Record<string, boolean>>({});

  const feedback = useDriverFeedback();
  const settings = useDriverSettings();
  const auth = useDriverAuth({ notify: feedback.notify });
  const nowMs = useDriverClock();

  const driverOrders = useDriverOrders({
    current: auth.current,
    timezone: settings.timezone,
    refreshMs: settings.refreshMs,
    activeUnknownGraceMs: settings.activeUnknownGraceMs,
    notify: feedback.notify,
  });

  const route = useDriverRoute({
    orders: driverOrders.mine,
    routePlzPriority: settings.routePlzPriority,
    storeOrigin: settings.storeOrigin,
    notify: feedback.notify,
  });

  const pull = usePullToRefresh({
    disabled:
      driverOrders.manualRefreshing ||
      driverOrders.batchBusy ||
      auth.authBusy,
    onRefresh: driverOrders.manualRefresh,
  });

  const liveOrderIds = useMemo(
    () => driverOrders.mine.map((order) => String(order.id)),
    [driverOrders.mine],
  );
  const liveTrackingActive =
    Boolean(auth.current) && liveOrderIds.length > 0;

  const selectedPendingOrders = useMemo(
    () =>
      driverOrders.pending.filter(
        (order) => selected[String(order.id)],
      ),
    [driverOrders.pending, selected],
  );

  const toggleSelected = useCallback((id: string | number) => {
    const key = String(id);

    setSelected((current) => ({
      ...current,
      [key]: !current[key],
    }));
  }, []);

  const confirmPlannedOrders = useCallback(
    async (orders: DriverOrder[]) => {
      const details = plannedClaimDetails(orders);
      if (!details.length) return true;

      return feedback.confirm({
        title: "Geplante Bestellung übernehmen?",
        message:
          "Bitte prüfen, ob der Kunde die Lieferung wirklich jetzt möchte.",
        details,
        confirmLabel: "Trotzdem übernehmen",
        cancelLabel: "Zurück",
        tone: "warning",
      });
    },
    [feedback],
  );

  const handleLogin = useCallback(async () => {
    const success = await auth.login();

    if (success) {
      await driverOrders.refresh(true);
      setTab("new");
    }

    return success;
  }, [auth, driverOrders]);

  const handleLogout = useCallback(async () => {
    await auth.logout(driverOrders.mine);
    route.clear();
    setSelected({});
    setTab("new");
  }, [auth, driverOrders.mine, route]);

  const claimSelected = useCallback(async () => {
    if (!selectedPendingOrders.length) {
      feedback.notify("Keine Auswahl.", "warning");
      return;
    }

    const accepted = await confirmPlannedOrders(
      selectedPendingOrders,
    );
    if (!accepted) return;

    const result = await driverOrders.claimMany(
      selectedPendingOrders,
    );

    if (result.claimed > 0) {
      setSelected({});
      setTab("mine");
    }
  }, [
    confirmPlannedOrders,
    driverOrders,
    feedback,
    selectedPendingOrders,
  ]);

  const claimOne = useCallback(
    async (order: DriverOrder) => {
      const accepted = await confirmPlannedOrders([order]);
      if (!accepted) return;

      const claimed = await driverOrders.claimOne(order);
      if (claimed) setTab("mine");
    },
    [confirmPlannedOrders, driverOrders],
  );

  const finishOne = useCallback(
    async (order: DriverOrder) => {
      const accepted = await feedback.confirm({
        title: "Lieferung abschließen?",
        message:
          "Bitte nur bestätigen, wenn die Bestellung wirklich an den Kunden übergeben wurde.",
        details: [
          `#${order.orderId || order.id}`,
          prettyDeliveryLine(order),
        ].filter(Boolean),
        confirmLabel: "Ja, abgeschlossen",
        cancelLabel: "Noch nicht",
        tone: "warning",
      });

      if (!accepted) return;
      await driverOrders.finishOne(order);
    },
    [driverOrders, feedback],
  );

  const releaseOne = useCallback(
    async (order: DriverOrder) => {
      await driverOrders.releaseOne(order);

      if (driverOrders.mine.length <= 1) {
        setTab("new");
      }
    },
    [driverOrders],
  );

  const callCustomer = useCallback(
    (order: DriverOrder) => {
      const cleanPhone = sanitizePhone(order.customer.phone);

      if (!cleanPhone) {
        feedback.notify("Keine Telefonnummer.", "warning");
        return;
      }

      window.location.href = `tel:${cleanPhone}`;
    },
    [feedback],
  );

  const openMaps = useCallback(
    (order: DriverOrder) => {
      const result = openExternalMap(
        prettyDeliveryLine(order) ||
          order.customer.address ||
          order.customer.addressLine ||
          "",
      );

      if (!result.ok) {
        feedback.notify(
          result.message || "Karte konnte nicht geöffnet werden.",
          "error",
        );
      }
    },
    [feedback],
  );

  if (!auth.hydrated) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-stone-950 text-stone-200">
        Fahrerbereich wird geladen…
      </main>
    );
  }

  if (!auth.current) {
    return (
      <>
        <DriverLogin
          name={auth.loginName}
          password={auth.loginPass}
          remember={auth.remember}
          busy={auth.authBusy}
          onNameChange={auth.setLoginName}
          onPasswordChange={auth.setLoginPass}
          onRememberChange={auth.setRemember}
          onSubmit={handleLogin}
        />

        <DriverToastViewport
          messages={feedback.messages}
          onDismiss={feedback.dismiss}
        />

        <DriverConfirmDialog
          request={feedback.confirmRequest}
          busy={auth.authBusy}
          onConfirm={feedback.acceptConfirm}
          onCancel={feedback.cancelConfirm}
        />
      </>
    );
  }

  return (
    <main
      className="min-h-screen text-stone-100 antialiased"
      onTouchStart={pull.onPullStart}
      onTouchMove={pull.onPullMove}
      onTouchEnd={pull.onPullEnd}
      onTouchCancel={pull.onPullEnd}
    >
      <DriverLiveTracker
        active={liveTrackingActive}
        driver={auth.current}
        orderIds={liveOrderIds}
      />

      <DriverPullIndicator
        distance={pull.pullDistance}
        visible={pull.pullVisible}
        ready={pull.pullReady}
        refreshing={pull.pullRefreshing}
      />

      <DriverCompletionToast value={driverOrders.completion} />

      <DriverToastViewport
        messages={feedback.messages}
        onDismiss={feedback.dismiss}
      />

      <DriverConfirmDialog
        request={feedback.confirmRequest}
        busy={driverOrders.batchBusy || auth.authBusy}
        onConfirm={feedback.acceptConfirm}
        onCancel={feedback.cancelConfirm}
      />

      <div className="pointer-events-none fixed inset-0 -z-10">
        <div className="absolute inset-0 bg-[radial-gradient(1200px_700px_at_10%_-10%,rgba(59,130,246,.18),transparent),radial-gradient(1000px_600px_at_90%_0%,rgba(16,185,129,.14),transparent),linear-gradient(180deg,#0b0f14_0%,#0f1318_50%,#0a0d11_100%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(80%_80%_at_50%_20%,transparent,rgba(0,0,0,.45))]" />
      </div>

      <div
        className="mx-auto max-w-3xl space-y-3 px-3 pb-3 sm:px-5 sm:pb-5"
        style={{
          paddingTop:
            "max(1rem, calc(env(safe-area-inset-top) + 1rem))",
          paddingBottom:
            "max(0.75rem, env(safe-area-inset-bottom))",
        }}
      >
        <DriverHeader
          current={auth.current}
          stats={driverOrders.stats}
          lastRefreshAt={driverOrders.lastRefreshAt}
          refreshing={driverOrders.manualRefreshing}
          onRefresh={() => void driverOrders.manualRefresh()}
          onLogout={() => void handleLogout()}
        />

        {driverOrders.refreshError ? (
          <div className="rounded-2xl border border-rose-400/40 bg-rose-500/10 p-3 text-sm text-rose-100">
            {driverOrders.refreshError}
          </div>
        ) : null}

        {!liveTrackingActive ? (
          <div className="rounded-xl border border-sky-400/20 bg-sky-500/10 px-3 py-2 text-[11px] leading-relaxed text-sky-100">
            📍 Standort nur bei einer übernommenen Lieferung aktiv.
          </div>
        ) : null}

        <div className={`rounded-2xl p-1.5 ${glass}`}>
          <div className="grid grid-cols-2 gap-1.5">
            <button
              type="button"
              onClick={() => setTab("new")}
              className={tabButtonClass(tab === "new", "new")}
            >
              Neu ({driverOrders.pending.length})
            </button>

            <button
              type="button"
              onClick={() => setTab("mine")}
              className={tabButtonClass(tab === "mine", "mine")}
            >
              Meine ({driverOrders.mine.length})
            </button>
          </div>
        </div>

        <section className="space-y-3">
          {tab === "new" ? (
            driverOrders.pending.length === 0 ? (
              <div
                className={`rounded-2xl p-4 text-sm text-stone-300/90 ${glass}`}
              >
                Keine neuen Aufträge.
              </div>
            ) : (
              <>
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => void claimSelected()}
                    disabled={
                      driverOrders.batchBusy ||
                      selectedPendingOrders.length === 0
                    }
                    className="rounded-xl bg-indigo-400 px-4 py-2 font-bold text-black hover:bg-indigo-300 disabled:cursor-not-allowed disabled:opacity-50"
                    title="Ausgewählte übernehmen"
                  >
                    {driverOrders.batchBusy
                      ? "Übernahme läuft…"
                      : "＋ Übernehmen"}
                  </button>
                </div>

                {driverOrders.pending.map((order) => (
                  <PendingOrderCard
                    key={String(order.id)}
                    order={order}
                    selected={Boolean(selected[String(order.id)])}
                    busy={
                      driverOrders.batchBusy ||
                      driverOrders.busyOrderIds.has(String(order.id))
                    }
                    avgPickup={settings.avgPickup}
                    avgDelivery={settings.avgDelivery}
                    timezone={settings.timezone}
                    nowMs={nowMs}
                    onToggleSelected={toggleSelected}
                    onClaim={(selectedOrder) =>
                      void claimOne(selectedOrder)
                    }
                  />
                ))}
              </>
            )
          ) : driverOrders.mine.length === 0 ? (
            <div
              className={`rounded-2xl p-4 text-sm text-stone-300/90 ${glass}`}
            >
              Keine übernommenen Aufträge.
            </div>
          ) : (
            <>
              <DriverRouteBar
                selectedCount={route.selectedOrders.length}
                onClear={route.clear}
                onOpen={route.open}
              />

              {driverOrders.mine.map((order) => (
                <OrderWithDetails
                  key={String(order.id)}
                  order={order}
                  routeSelected={Boolean(
                    route.selected[String(order.id)],
                  )}
                  busy={driverOrders.busyOrderIds.has(
                    String(order.id),
                  )}
                  avgPickup={settings.avgPickup}
                  avgDelivery={settings.avgDelivery}
                  timezone={settings.timezone}
                  nowMs={nowMs}
                  onToggleRouteSelect={route.toggle}
                  onCall={callCustomer}
                  onMap={openMaps}
                  onFinish={(selectedOrder) =>
                    void finishOne(selectedOrder)
                  }
                  onRelease={(selectedOrder) =>
                    void releaseOne(selectedOrder)
                  }
                />
              ))}
            </>
          )}
        </section>
      </div>
    </main>
  );
}
