"use client";

import { useCallback, useEffect, useState } from "react";

export type EligibleRouteDealInput = {
  enabled: boolean;
  mode: "pickup" | "delivery";
  zip: string;
  street?: string;
  phone?: string;
  email?: string;
};

export type EligibleRouteDealState = {
  deal: Record<string, any> | null;
  loading: boolean;
};

const CONSUMED_KEY = "bb_route_deal_consumed_v1";
export const ROUTE_DEAL_CHANGED_EVENT = "bb:route-deal-changed";

function normalizePhone(value: unknown) {
  return String(value ?? "").replace(/\D/g, "").slice(0, 32);
}

function normalizeEmail(value: unknown) {
  const email = String(value ?? "").trim().toLowerCase().slice(0, 200);
  return email.includes("@") ? email : "";
}

function normalizeZip(value: unknown) {
  return String(value ?? "").replace(/\D/g, "").slice(0, 5);
}

function readConsumedMap() {
  if (typeof window === "undefined") return {} as Record<string, number>;

  try {
    const raw = localStorage.getItem(CONSUMED_KEY);
    const parsed = raw ? JSON.parse(raw) : null;

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {} as Record<string, number>;
    }

    const cutoff = Date.now() - 7 * 24 * 60 * 60_000;
    const out: Record<string, number> = {};

    for (const [dealId, value] of Object.entries(parsed)) {
      const timestamp = Number(value);
      if (dealId && Number.isFinite(timestamp) && timestamp >= cutoff) {
        out[dealId] = timestamp;
      }
    }

    return out;
  } catch {
    return {} as Record<string, number>;
  }
}

export function routeDealWasConsumedOnDevice(dealId: unknown) {
  const cleanId = String(dealId ?? "").trim();
  return Boolean(cleanId && readConsumedMap()[cleanId]);
}

export function markRouteDealConsumedOnDevice(dealId: unknown) {
  if (typeof window === "undefined") return;

  const cleanId = String(dealId ?? "").trim();
  if (!cleanId) return;

  const next = {
    ...readConsumedMap(),
    [cleanId]: Date.now(),
  };

  try {
    localStorage.setItem(CONSUMED_KEY, JSON.stringify(next));
  } catch {}

  try {
    window.dispatchEvent(
      new CustomEvent(ROUTE_DEAL_CHANGED_EVENT, {
        detail: {
          dealId: cleanId,
          consumed: true,
        },
      }),
    );
  } catch {}
}

export async function loadEligibleRouteDeal(
  input: EligibleRouteDealInput,
): Promise<Record<string, any> | null> {
  if (!input.enabled || input.mode !== "delivery") return null;

  const zip = normalizeZip(input.zip);
  const phone = normalizePhone(input.phone);
  const email = normalizeEmail(input.email);

  /*
    Telefon/e-posta henüz local profile'da yoksa server, yalnız customer_app
    cihaz çereziyle doğrulanmış PushSubscription kimliğini kullanabilir.
  */
  if (zip.length !== 5) return null;

  const response = await fetch("/api/route-deals/eligible", {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({
      mode: input.mode,
      customer: {
        phone: phone || undefined,
        email: email || undefined,
        plz: zip,
        zip,
        street: String(input.street ?? "").trim() || undefined,
      },
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.ok === false) return null;

  const deal =
    payload?.deal && typeof payload.deal === "object" && !Array.isArray(payload.deal)
      ? payload.deal
      : null;

  if (!deal || routeDealWasConsumedOnDevice(deal.id)) return null;
  return deal;
}

export function useEligibleRouteDeal(
  input: EligibleRouteDealInput,
): EligibleRouteDealState & { refresh: () => Promise<void> } {
  const [deal, setDeal] = useState<Record<string, any> | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (
      !input.enabled ||
      input.mode !== "delivery" ||
      normalizeZip(input.zip).length !== 5
    ) {
      setDeal(null);
      return;
    }

    setLoading(true);
    try {
      setDeal(await loadEligibleRouteDeal(input));
    } catch {
      setDeal(null);
    } finally {
      setLoading(false);
    }
  }, [
    input.enabled,
    input.mode,
    input.zip,
    input.street,
    input.phone,
    input.email,
  ]);

  useEffect(() => {
    let active = true;
    let running = false;

    const run = async () => {
      if (!active || running) return;
      running = true;
      try {
        const next = await loadEligibleRouteDeal(input);
        if (active) setDeal(next);
      } catch {
        if (active) setDeal(null);
      } finally {
        running = false;
        if (active) setLoading(false);
      }
    };

    setLoading(true);
    void run();

    const intervalId = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void run();
      }
    }, 10_000);

    const onVisible = () => {
      if (document.visibilityState === "visible") void run();
    };
    const onRefresh = () => {
      void run();
    };

    window.addEventListener("focus", onRefresh);
    window.addEventListener("pageshow", onRefresh);
    window.addEventListener(
      ROUTE_DEAL_CHANGED_EVENT,
      onRefresh as EventListener,
    );
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      active = false;
      window.clearInterval(intervalId);
      window.removeEventListener("focus", onRefresh);
      window.removeEventListener("pageshow", onRefresh);
      window.removeEventListener(
        ROUTE_DEAL_CHANGED_EVENT,
        onRefresh as EventListener,
      );
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [
    input.enabled,
    input.mode,
    input.zip,
    input.street,
    input.phone,
    input.email,
  ]);

  return { deal, loading, refresh };
}
