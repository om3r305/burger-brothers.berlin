"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  detectDriverMapPlatform,
  DRIVER_MAP_PREFERENCE_KEY,
  mapProviderLabel,
  mapProviderOptions,
  openMapPreview,
  uniqueRouteAddresses,
} from "@/lib/driver/domain";
import type {
  DriverMapOption,
  DriverMapPlatform,
  DriverMapProvider,
  DriverMapRequest,
  DriverOrder,
  DriverToastTone,
} from "@/types/driver";

type Notify = (
  message: string,
  tone?: DriverToastTone,
  durationMs?: number,
) => void;

function isDriverMapProvider(value: unknown): value is DriverMapProvider {
  return value === "apple" || value === "google" || value === "system";
}

function providerSupported(
  provider: DriverMapProvider,
  platform: DriverMapPlatform,
  multiStop: boolean,
) {
  return mapProviderOptions(platform, multiStop).some(
    (option) => option.id === provider,
  );
}

export function useDriverMapPreference({
  notify,
}: {
  notify: Notify;
}) {
  const [platform, setPlatform] =
    useState<DriverMapPlatform>("desktop");
  const [preference, setPreference] =
    useState<DriverMapProvider | null>(null);
  const [pendingRequest, setPendingRequest] =
    useState<DriverMapRequest | null>(null);
  const [chooserOpen, setChooserOpen] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const nextPlatform = detectDriverMapPlatform();
    setPlatform(nextPlatform);

    try {
      const saved = localStorage.getItem(DRIVER_MAP_PREFERENCE_KEY);

      if (isDriverMapProvider(saved)) {
        setPreference(saved);
      } else if (nextPlatform === "desktop") {
        setPreference("google");
      }
    } catch {
      if (nextPlatform === "desktop") {
        setPreference("google");
      }
    }

    setHydrated(true);
  }, []);

  const options = useMemo<DriverMapOption[]>(() => {
    const multiStop = (pendingRequest?.addresses.length || 0) > 1;
    return mapProviderOptions(platform, multiStop);
  }, [pendingRequest, platform]);

  const openWithProvider = useCallback(
    (
      provider: DriverMapProvider,
      request: DriverMapRequest,
    ) => {
      const result = openMapPreview({
        provider,
        addresses: request.addresses,
        platform,
      });

      if (!result.ok) {
        notify(
          result.message || "Karte konnte nicht geöffnet werden.",
          "error",
        );
      }

      return result.ok;
    },
    [notify, platform],
  );

  const requestOpen = useCallback(
    (request: DriverMapRequest) => {
      const addresses = request.addresses
        .map((address) => String(address || "").trim())
        .filter(Boolean);

      if (!addresses.length) {
        notify("Keine Adresse gefunden.", "warning");
        return false;
      }

      const normalizedRequest: DriverMapRequest = {
        ...request,
        addresses,
      };
      const multiStop = addresses.length > 1;

      if (!hydrated) {
        setPendingRequest(normalizedRequest);
        setChooserOpen(true);
        return true;
      }

      if (
        preference &&
        providerSupported(preference, platform, multiStop)
      ) {
        return openWithProvider(preference, normalizedRequest);
      }

      if (platform === "desktop") {
        return openWithProvider("google", normalizedRequest);
      }

      setPendingRequest(normalizedRequest);
      setChooserOpen(true);
      return true;
    },
    [
      hydrated,
      notify,
      openWithProvider,
      platform,
      preference,
    ],
  );

  const openAddress = useCallback(
    (address: string) =>
      requestOpen({
        addresses: [address],
        source: "single",
      }),
    [requestOpen],
  );

  const openRoute = useCallback(
    (orders: DriverOrder[], priority: string[]) =>
      requestOpen({
        addresses: uniqueRouteAddresses(orders, priority),
        source: "route",
      }),
    [requestOpen],
  );

  const selectProvider = useCallback(
    (provider: DriverMapProvider) => {
      const request = pendingRequest;

      try {
        localStorage.setItem(DRIVER_MAP_PREFERENCE_KEY, provider);
      } catch {
        notify(
          "Karten-App konnte nicht dauerhaft gespeichert werden.",
          "warning",
        );
      }

      setPreference(provider);
      setChooserOpen(false);
      setPendingRequest(null);

      if (request && request.source !== "settings") {
        return openWithProvider(provider, request);
      }

      notify(`${mapProviderLabel(provider)} wurde gespeichert.`, "success");
      return true;
    },
    [notify, openWithProvider, pendingRequest],
  );

  const cancelChooser = useCallback(() => {
    setChooserOpen(false);
    setPendingRequest(null);
  }, []);

  const changePreference = useCallback(() => {
    setPendingRequest({
      addresses: [],
      source: "settings",
    });
    setChooserOpen(true);
  }, []);

  const resetPreference = useCallback(() => {
    try {
      localStorage.removeItem(DRIVER_MAP_PREFERENCE_KEY);
    } catch {
      // Local storage cleanup failure does not block chooser display.
    }

    setPreference(null);
    changePreference();
  }, [changePreference]);

  return {
    hydrated,
    platform,
    preference,
    preferenceLabel: mapProviderLabel(preference),
    options,
    chooserOpen,
    chooserRequest: pendingRequest,
    openAddress,
    openRoute,
    selectProvider,
    cancelChooser,
    changePreference,
    resetPreference,
  };
}
