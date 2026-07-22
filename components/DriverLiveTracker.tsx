"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { DriverIdentity, DriverPosition } from "@/types/driver";

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
    throw new Error(
      String(record.error || `HTTP ${response.status}`),
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
  const activeOrderIdsRef = useRef<string[]>([]);
  const previousActiveIdsRef = useRef<string[]>([]);
  const driverRef = useRef<DriverIdentity | null>(null);
  const lastPublishRef = useRef<DriverPosition | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const publish = useCallback(async (position: GeolocationPosition) => {
    const currentDriver = driverRef.current;
    const currentOrderIds = activeOrderIdsRef.current;

    if (!currentDriver || !currentOrderIds.length) return;

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
      setErrorMessage(
        `Trackingfehler: ${
          error instanceof Error ? error.message : "unbekannt"
        }`,
      );
    }
  }, []);

  const pushOnce = useCallback(() => {
    if (
      !active ||
      !driverRef.current ||
      !navigator.geolocation ||
      !activeOrderIdsRef.current.length
    ) {
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => void publish(position),
      (error) =>
        setErrorMessage(`Standortfehler: ${error.message}`),
      {
        enableHighAccuracy: true,
        maximumAge: 1_500,
        timeout: 10_000,
      },
    );
  }, [active, publish]);

  const orderIdsKey = orderIds.join("|");

  useEffect(() => {
    driverRef.current = driver;

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

    previousActiveIdsRef.current = active ? uniqueIds : [];
  }, [active, driver, orderIdsKey, pushOnce]);

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

      setErrorMessage(null);
      return;
    }

    if (!("geolocation" in navigator)) {
      setErrorMessage("Geolocation nicht verfügbar.");
      return;
    }

    if (watchIdRef.current == null) {
      watchIdRef.current = navigator.geolocation.watchPosition(
        (position) => void publish(position),
        (error) =>
          setErrorMessage(`Standortfehler: ${error.message}`),
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
  }, [active, driver?.id, driver?.name, publish, pushOnce]);

  if (!errorMessage) return null;

  return (
    <div className="fixed inset-x-0 bottom-0 z-50 m-3 rounded-md bg-rose-600/90 px-3 py-2 text-sm text-white shadow-lg">
      {errorMessage}
    </div>
  );
}
