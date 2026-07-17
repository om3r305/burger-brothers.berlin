// components/ui/TrackPanel.tsx
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type TrackPanelProps = {
  variant?: "default" | "emphasized";
};

const LS_LAST_TRACK_ID = "bb_last_track_order_id";
const LS_LAST_TRACK_ID_LEGACY = "bb_last_tracking_order_id";
const TRACK_EVENT = "bb:last-track-order-updated";

function cleanTrackingToken(value: string) {
  return String(value || "")
    .trim()
    .replace(/^#+/, "")
    .replace(/\s+/g, "")
    .replace(/[^a-zA-Z0-9_-]/g, "");
}

function isTrackingToken(value: string) {
  const clean = cleanTrackingToken(value);
  return clean.length >= 32 && clean.length <= 160;
}

function readLastTrackId() {
  try {
    const current = cleanTrackingToken(localStorage.getItem(LS_LAST_TRACK_ID) || "");
    if (isTrackingToken(current)) return current;

    const legacy = cleanTrackingToken(localStorage.getItem(LS_LAST_TRACK_ID_LEGACY) || "");
    if (isTrackingToken(legacy)) {
      localStorage.setItem(LS_LAST_TRACK_ID, legacy);
      return legacy;
    }
  } catch {}

  return "";
}

export default function TrackPanel({ variant = "default" }: TrackPanelProps) {
  const router = useRouter();

  const [val, setVal] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [autoFilled, setAutoFilled] = useState(false);

  useEffect(() => {
    const applyLastId = (nextId: string) => {
      const clean = cleanTrackingToken(nextId);

      if (!isTrackingToken(clean)) return;

      setVal(clean);
      setAutoFilled(true);
      setError("");

      try {
        localStorage.setItem(LS_LAST_TRACK_ID, clean);
      } catch {}
    };

    const initial = readLastTrackId();
    if (initial) {
      applyLastId(initial);
    }

    const onStorage = (event: StorageEvent) => {
      if (
        !event.key ||
        event.key === LS_LAST_TRACK_ID ||
        event.key === LS_LAST_TRACK_ID_LEGACY
      ) {
        const next = readLastTrackId();
        if (next) applyLastId(next);
      }
    };

    const onCustomTrackEvent = (event: Event) => {
      const custom = event as CustomEvent<{ id?: string; orderId?: string }>;
      const next = custom.detail?.id || custom.detail?.orderId || readLastTrackId();

      if (next) {
        applyLastId(next);
      }
    };

    window.addEventListener("storage", onStorage);
    window.addEventListener(TRACK_EVENT, onCustomTrackEvent as EventListener);

    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(TRACK_EVENT, onCustomTrackEvent as EventListener);
    };
  }, []);

  const go = async () => {
    const clean = cleanTrackingToken(val);

    setError("");

    if (!isTrackingToken(clean)) {
      setError("Bitte einen gültigen persönlichen Tracking-Code eingeben.");
      return;
    }

    try {
      localStorage.setItem(LS_LAST_TRACK_ID, clean);
    } catch {}

    setBusy(true);

    try {
      const res = await fetch(`/api/track/lookup?trackingToken=${encodeURIComponent(clean)}`, {
        method: "GET",
        cache: "no-store",
        headers: {
          accept: "application/json",
        },
      });

      if (res.ok) {
        const json = await res.json().catch(() => ({} as any));

        const found =
          json?.ok !== false &&
          (json?.order || json?.item || json?.id || json?.orderId || json?.status);

        if (found) {
          router.push(`/track/${encodeURIComponent(clean)}`);
          return;
        }

        setError("Tracking-Code wurde nicht gefunden oder ist abgelaufen.");
        return;
      }

      router.push(`/track/${encodeURIComponent(clean)}`);
    } catch {
      router.push(`/track/${encodeURIComponent(clean)}`);
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
          go();
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
            placeholder="Tracking-Code eingeben"
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
              Hier können Sie den Status Ihrer Bestellung mit Ihrem persönlichen Tracking-Code prüfen.
            </div>

            {autoFilled && val && (
              <div className="text-emerald-300">
                Hinweis: Dies ist der Tracking-Code Ihrer letzten Lieferung.
              </div>
            )}
          </div>
        )}
      </form>
    </div>
  );
}