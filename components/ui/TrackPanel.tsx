"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CUSTOMER_TRACKING_EVENT,
  cleanCustomerTrackingValue,
  isPersonalTrackingToken,
  readLastCustomerTracking,
  rememberCustomerTracking,
  resolveCustomerTrackingToken,
} from "@/lib/customer-tracking";

type TrackPanelProps = {
  variant?: "default" | "emphasized";
};

export default function TrackPanel({ variant = "default" }: TrackPanelProps) {
  const router = useRouter();

  const [val, setVal] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [autoFilled, setAutoFilled] = useState(false);

  useEffect(() => {
    const applyLastTracking = () => {
      const last = readLastCustomerTracking();

      if (!last.displayValue || !isPersonalTrackingToken(last.trackingToken)) {
        return;
      }

      setVal(last.displayValue);
      setAutoFilled(true);
      setError("");
    };

    applyLastTracking();

    const onStorage = () => {
      applyLastTracking();
    };

    const onCustomTrackEvent = (event: Event) => {
      const custom = event as CustomEvent<{
        id?: string;
        trackingToken?: string;
        orderId?: string;
      }>;
      const trackingToken = cleanCustomerTrackingValue(
        custom.detail?.trackingToken || custom.detail?.id || "",
      );
      const orderId = cleanCustomerTrackingValue(custom.detail?.orderId || "");

      if (isPersonalTrackingToken(trackingToken)) {
        rememberCustomerTracking({
          trackingToken,
          orderId: orderId || undefined,
          dispatch: false,
        });
      }

      applyLastTracking();
    };

    window.addEventListener("storage", onStorage);
    window.addEventListener(
      CUSTOMER_TRACKING_EVENT,
      onCustomTrackEvent as EventListener,
    );

    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(
        CUSTOMER_TRACKING_EVENT,
        onCustomTrackEvent as EventListener,
      );
    };
  }, []);

  const go = async () => {
    const cleanInput = cleanCustomerTrackingValue(val);
    const trackingToken = resolveCustomerTrackingToken(cleanInput);

    setError("");

    if (!trackingToken) {
      setError(
        cleanInput
          ? "Diese Bestellnummer ist auf diesem Gerät nicht gespeichert. Bitte verwenden Sie den persönlichen Link aus der Bestellbestätigung."
          : "Bitte eine Bestellnummer oder einen persönlichen Tracking-Code eingeben.",
      );
      return;
    }

    setBusy(true);

    try {
      const res = await fetch(
        `/api/track/lookup?trackingToken=${encodeURIComponent(trackingToken)}`,
        {
          method: "GET",
          cache: "no-store",
          headers: {
            accept: "application/json",
          },
        },
      );

      if (res.ok) {
        const json = await res.json().catch(() => ({} as any));

        const found =
          json?.ok !== false &&
          (json?.order ||
            json?.item ||
            json?.id ||
            json?.orderId ||
            json?.status);

        if (found) {
          const orderId = cleanCustomerTrackingValue(
            json?.orderId ||
              json?.id ||
              json?.order?.orderId ||
              json?.order?.id ||
              cleanInput,
          );

          rememberCustomerTracking({
            trackingToken,
            orderId:
              orderId && !isPersonalTrackingToken(orderId)
                ? orderId
                : undefined,
            dispatch: false,
          });

          router.push(`/track/${encodeURIComponent(trackingToken)}`);
          return;
        }

        setError("Bestellung wurde nicht gefunden oder der Zugriff ist abgelaufen.");
        return;
      }

      if (res.status === 401 || res.status === 403 || res.status === 410) {
        setError("Der persönliche Tracking-Zugriff ist ungültig oder abgelaufen.");
        return;
      }

      router.push(`/track/${encodeURIComponent(trackingToken)}`);
    } catch {
      router.push(`/track/${encodeURIComponent(trackingToken)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className={
        variant === "emphasized"
          ? "rounded-2xl border border-stone-700/60 bg-stone-900/60 p-4"
          : "rounded-md border border-stone-700/60 p-3"
      }
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void go();
        }}
        className="space-y-2"
      >
        <div className="flex items-center gap-2">
          <input
            value={val}
            onChange={(event) => {
              setVal(event.target.value);
              setAutoFilled(false);

              if (error) {
                setError("");
              }
            }}
            placeholder="Bestellnummer oder Tracking-Code"
            autoComplete="off"
            inputMode="text"
            className="flex-1 rounded-md bg-stone-800/60 px-3 py-2 outline-none"
          />

          <button
            type="submit"
            disabled={busy}
            className={`rounded-md bg-amber-500 px-4 py-2 font-semibold text-black hover:bg-amber-400 ${
              busy ? "pointer-events-none opacity-60" : ""
            }`}
          >
            {busy ? "Prüfen…" : "Anzeigen"}
          </button>
        </div>

        {error && <div className="text-xs text-rose-300">{error}</div>}

        {variant === "emphasized" && (
          <div className="space-y-1 text-xs text-stone-400">
            <div>
              Hier können Sie den Status Ihrer Bestellung sicher prüfen.
            </div>

            {autoFilled && val && (
              <div className="text-emerald-300">
                Ihre letzte Bestellnummer wurde automatisch übernommen.
              </div>
            )}
          </div>
        )}
      </form>
    </div>
  );
}
