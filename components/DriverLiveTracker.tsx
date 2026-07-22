"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { DriverIdentity, DriverPosition } from "@/types/driver";

const ASSIGNMENT_RETRY_DELAYS_MS = [800, 1_800, 3_500] as const;
const ASSIGNMENT_WARNING_AFTER_MS = 18_000;

type TrackingErrorTone = "warning" | "error";

class TrackingPostError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = "TrackingPostError";
    this.code = code;
  }
}

function clearDriverPosFor(id: string | number) {
  try {
    localStorage.removeItem(`bb_driverpos_${id}`);
  } catch {
    // Position cache cleanup is best-effort.
  }
}

function safeSessionPart(value: unknown) {
  return (
    String(value || "driver")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, "-")
      .replace(/-+/g, "-")
      .slice(0, 64) || "driver"
  );
}

function trackingSessionId(driver: DriverIdentity | null) {
  const date = new Date();
  const day = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");

  return `driver_${day}_${safeSessionPart(driver?.id || driver?.name)}`;
}

function trackingErrorCode(error: unknown) {
  if (error instanceof TrackingPostError) return error.code;
  if (error instanceof Error) return error.message;
  return "unknown";
}

function publicTrackingErrorMessage(code: string) {
  if (code === "order_not_assigned_to_driver") {
    return "Tracking wartet noch auf die bestätigte Fahrerzuordnung. Bitte kurz aktualisieren.";
  }

  if (code === "tracking_session_owned_by_other_driver") {
    return "Tracking-Sitzung gehört zu einem anderen Fahrer. Bitte neu anmelden.";
  }

  if (code === "driver_identity_mismatch") {
    return "Fahrer-Anmeldung konnte nicht bestätigt werden. Bitte neu anmelden.";
  }

  if (code === "invalid_tracking_orders") {
    return "Tracking-Aufträge konnten nicht bestätigt werden. Bitte aktualisieren.";
  }

  return "Live-Standort konnte nicht übertragen werden. Verbindung bitte prüfen.";
}

async function postTracking(params: {
  driver: DriverIdentity;
  orderIds: string[];
  active: boolean;
  position?: DriverPosition | null;
}) {
  const response = await fetch(
    `/api/track/${encodeURIComponent(trackingSessionId(params.driver))}`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({
        active: params.active,
        orderIds: params.orderIds,
        driverId: params.driver.id,
        ...(params.position
          ? {
              lat: params.position.lat,
              lng: params.position.lng,
            }
          : {}),
      }),
      keepalive: true,
    },
  );

  const data: unknown = await response.json().catch(() => ({}));
  const record =
    data && typeof data === "object" && !Array.isArray(data)
      ? (data as Record<string, unknown>)
      : {};

  if (!response.ok || record.ok === false) {
    throw new TrackingPostError(
      String(record.error || `HTTP_${response.status}`),
    );
  }
}

export default function DriverLiveTracker({
  active,
  driver,
  orderIds,
}: {
  active: boolean;
  driver: DriverIdentity | null;
  orderIds: string[];
}) {
  const watchIdRef = useRef<number | null>(null);
  const heartbeatRef = useRef<number | null>(null);
  const retryTimerRef = useRef<number | null>(null);
  const activeRef = useRef(false);
  const lifecycleRef = useRef(0);
  const activeOrderIdsRef = useRef<string[]>([]);
  const previousActiveIdsRef = useRef<string[]>([]);
  const driverRef = useRef<DriverIdentity | null>(null);
  const lastPublishRef = useRef<DriverPosition | null>(null);
  const assignmentFailureStartedRef = useRef<number | null>(null);
  const assignmentFailureCountRef = useRef(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [errorTone, setErrorTone] =
    useState<TrackingErrorTone>("error");

  const clearRetryTimer = useCallback(() => {
    if (retryTimerRef.current != null) {
      window.clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
  }, []);

  const resetAssignmentFailure = useCallback(() => {
    assignmentFailureStartedRef.current = null;
    assignmentFailureCountRef.current = 0;
  }, []);

  const publish = useCallback(
    async (position: GeolocationPosition) => {
      const requestLifecycle = lifecycleRef.current;
      const currentDriver = driverRef.current;
      const currentOrderIds = [...activeOrderIdsRef.current];

      if (
        !activeRef.current ||
        !currentDriver ||
        !currentOrderIds.length
      ) {
        return;
      }

      const payload: DriverPosition = {
        lat: position.coords.latitude,
        lng: position.coords.longitude,
        ts: Date.now(),
      };

      const previous = lastPublishRef.current;
      const tooSoon =
        previous?.ts != null &&
        payload.ts != null &&
        payload.ts - previous.ts < 5_000;
      const sameSpot =
        previous != null &&
        Math.abs(previous.lat - payload.lat) < 0.00005 &&
        Math.abs(previous.lng - payload.lng) < 0.00005;

      if (tooSoon && sameSpot) return;

      for (const id of currentOrderIds) {
        try {
          localStorage.setItem(
            `bb_driverpos_${id}`,
            JSON.stringify(payload),
          );
        } catch {
          // Local position cache is secondary.
        }
      }

      try {
        await postTracking({
          driver: currentDriver,
          orderIds: currentOrderIds,
          active: true,
          position: payload,
        });

        if (
          requestLifecycle !== lifecycleRef.current ||
          !activeRef.current
        ) {
          return;
        }

        clearRetryTimer();
        resetAssignmentFailure();
        lastPublishRef.current = payload;
        setErrorMessage(null);

        try {
          localStorage.setItem(
            "bb_driverpos_ping",
            String(Date.now()),
          );
          window.dispatchEvent(
            new CustomEvent("bb:driver-pos-ping"),
          );
        } catch {
          // Cross-tab notification is best-effort.
        }
      } catch (error) {
        if (
          requestLifecycle !== lifecycleRef.current ||
          !activeRef.current
        ) {
          return;
        }

        const code = trackingErrorCode(error);

        if (code === "order_not_assigned_to_driver") {
          const now = Date.now();

          if (assignmentFailureStartedRef.current == null) {
            assignmentFailureStartedRef.current = now;
          }

          const attempt = assignmentFailureCountRef.current;
          assignmentFailureCountRef.current = attempt + 1;

          const elapsed =
            now - (assignmentFailureStartedRef.current || now);
          const retryDelay =
            ASSIGNMENT_RETRY_DELAYS_MS[
              Math.min(
                attempt,
                ASSIGNMENT_RETRY_DELAYS_MS.length - 1,
              )
            ];

          if (
            attempt < ASSIGNMENT_RETRY_DELAYS_MS.length &&
            retryTimerRef.current == null
          ) {
            retryTimerRef.current = window.setTimeout(() => {
              retryTimerRef.current = null;

              if (
                !activeRef.current ||
                lifecycleRef.current !== requestLifecycle ||
                !navigator.geolocation
              ) {
                return;
              }

              navigator.geolocation.getCurrentPosition(
                (nextPosition) => void publish(nextPosition),
                () => undefined,
                {
                  enableHighAccuracy: true,
                  maximumAge: 1_500,
                  timeout: 10_000,
                },
              );
            }, retryDelay);
          }

          if (elapsed < ASSIGNMENT_WARNING_AFTER_MS) {
            setErrorMessage(null);
            return;
          }

          setErrorTone("warning");
          setErrorMessage(publicTrackingErrorMessage(code));
          return;
        }

        clearRetryTimer();
        resetAssignmentFailure();
        setErrorTone("error");
        setErrorMessage(publicTrackingErrorMessage(code));
      }
    },
    [clearRetryTimer, resetAssignmentFailure],
  );

  const pushOnce = useCallback(() => {
    if (
      !activeRef.current ||
      !driverRef.current ||
      !navigator.geolocation ||
      !activeOrderIdsRef.current.length
    ) {
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => void publish(position),
      (error) => {
        if (!activeRef.current) return;
        setErrorTone("error");
        setErrorMessage(`Standortfehler: ${error.message}`);
      },
      {
        enableHighAccuracy: true,
        maximumAge: 1_500,
        timeout: 10_000,
      },
    );
  }, [publish]);

  const orderIdsKey = orderIds.join("|");

  useEffect(() => {
    lifecycleRef.current += 1;
    activeRef.current = active;
    driverRef.current = driver;
    clearRetryTimer();
    resetAssignmentFailure();

    const uniqueIds = Array.from(
      new Set(orderIds.map(String).filter(Boolean)),
    );

    const removed = previousActiveIdsRef.current.filter(
      (id) => !uniqueIds.includes(id),
    );

    for (const id of removed) clearDriverPosFor(id);

    activeOrderIdsRef.current = active ? uniqueIds : [];

    const added = uniqueIds.some(
      (id) => !previousActiveIdsRef.current.includes(id),
    );

    if (active && driver && added) {
      pushOnce();
    }

    if (
      previousActiveIdsRef.current.length > 0 &&
      (!active || uniqueIds.length === 0) &&
      driver
    ) {
      void postTracking({
        driver,
        orderIds: [],
        active: false,
      }).catch(() => undefined);

      lastPublishRef.current = null;
    }

    if (!active || !uniqueIds.length) {
      setErrorMessage(null);
    }

    previousActiveIdsRef.current = active ? uniqueIds : [];

    return () => {
      lifecycleRef.current += 1;
    };
  }, [
    active,
    clearRetryTimer,
    driver,
    orderIdsKey,
    pushOnce,
    resetAssignmentFailure,
  ]);

  useEffect(() => {
    if (!active || !driver || !orderIds.length) {
      if (watchIdRef.current != null) {
        navigator.geolocation?.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }

      if (heartbeatRef.current != null) {
        window.clearInterval(heartbeatRef.current);
        heartbeatRef.current = null;
      }

      clearRetryTimer();
      setErrorMessage(null);
      return;
    }

    if (!("geolocation" in navigator)) {
      setErrorTone("error");
      setErrorMessage("Geolocation nicht verfügbar.");
      return;
    }

    if (watchIdRef.current == null) {
      watchIdRef.current = navigator.geolocation.watchPosition(
        (position) => void publish(position),
        (error) => {
          if (!activeRef.current) return;
          setErrorTone("error");
          setErrorMessage(`Standortfehler: ${error.message}`);
        },
        {
          enableHighAccuracy: true,
          maximumAge: 1_500,
          timeout: 10_000,
        },
      );
    }

    if (heartbeatRef.current == null) {
      heartbeatRef.current = window.setInterval(pushOnce, 12_000);
    }

    const onVisibility = () => {
      if (document.visibilityState === "visible") pushOnce();
    };

    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      document.removeEventListener(
        "visibilitychange",
        onVisibility,
      );

      if (watchIdRef.current != null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }

      if (heartbeatRef.current != null) {
        window.clearInterval(heartbeatRef.current);
        heartbeatRef.current = null;
      }

      clearRetryTimer();

      const currentDriver = driverRef.current;
      const activeIds = previousActiveIdsRef.current;

      for (const id of activeIds) clearDriverPosFor(id);

      if (currentDriver && activeIds.length) {
        void postTracking({
          driver: currentDriver,
          orderIds: [],
          active: false,
        }).catch(() => undefined);
      }
    };
  }, [
    active,
    clearRetryTimer,
    driver,
    orderIds.length,
    publish,
    pushOnce,
  ]);

  if (!errorMessage) return null;

  const toneClass =
    errorTone === "warning"
      ? "border-amber-300/50 bg-amber-500/95 text-stone-950"
      : "border-rose-300/50 bg-rose-600/95 text-white";

  return (
    <div
      role="status"
      className={`fixed inset-x-0 bottom-0 z-50 m-3 rounded-xl border px-3 py-2 text-sm font-semibold shadow-lg ${toneClass}`}
    >
      {errorMessage}
    </div>
  );
}
