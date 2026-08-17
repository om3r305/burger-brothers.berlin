"use client";

import { useEffect, useState } from "react";
import { readSettings } from "@/lib/settings";
import type { OrderMode } from "@/components/store";
import type { PublicEtaSummary } from "@/lib/server/smart-eta";

const CLIENT_TTL_MS = 30_000;
const VISIBLE_REFRESH_MS = 60_000;

let cache: { value: PublicEtaSummary; expiresAt: number } | null = null;
let inFlight: Promise<PublicEtaSummary> | null = null;
const listeners = new Set<(value: PublicEtaSummary) => void>();

function fallbackEta(): PublicEtaSummary {
  const settings = readSettings();
  const pickup = Math.max(1, Number(settings?.hours?.avgPickupMinutes ?? 15) || 15);
  const delivery = Math.max(1, Number(settings?.hours?.avgDeliveryMinutes ?? 35) || 35);

  return {
    delivery: { min: delivery, max: delivery + 10, label: `ca. ${delivery}–${delivery + 10} Min` },
    pickup: { min: pickup, max: pickup, label: `ca. ${pickup} Min` },
    generatedAt: new Date(0).toISOString(),
    ttlSeconds: 15,
  };
}

async function refreshEta() {
  if (cache && cache.expiresAt > Date.now()) return cache.value;
  if (inFlight) return inFlight;

  inFlight = fetch("/api/public/eta", { headers: { accept: "application/json" } })
    .then(async (response) => {
      if (!response.ok) throw new Error(`eta_${response.status}`);
      return (await response.json()) as PublicEtaSummary;
    })
    .then((value) => {
      cache = { value, expiresAt: Date.now() + CLIENT_TTL_MS };
      listeners.forEach((listener) => listener(value));
      return value;
    })
    .catch(() => cache?.value ?? fallbackEta())
    .finally(() => {
      inFlight = null;
    });

  return inFlight;
}

export function useSmartEta() {
  const [eta, setEta] = useState<PublicEtaSummary>(() => cache?.value ?? fallbackEta());

  useEffect(() => {
    let active = true;
    const update = (value: PublicEtaSummary) => active && setEta(value);
    listeners.add(update);
    void refreshEta().then(update);

    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refreshEta().then(update);
    }, VISIBLE_REFRESH_MS);

    const onVisibility = () => {
      if (document.visibilityState === "visible" && (!cache || cache.expiresAt <= Date.now())) {
        void refreshEta().then(update);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      active = false;
      listeners.delete(update);
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return eta;
}

export function etaLabelForMode(eta: PublicEtaSummary, mode: OrderMode) {
  return eta[mode].label;
}
