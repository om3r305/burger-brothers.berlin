// components/ui/TrackPanel.tsx
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type TrackPanelProps = {
  variant?: "default" | "emphasized";
};

const LS_LAST_TRACK_ID = "bb_last_track_order_id";

function cleanOrderId(value: string) {
  return String(value || "")
    .trim()
    .replace(/^#+/, "")
    .replace(/\s+/g, "")
    .replace(/[^a-zA-Z0-9_-]/g, "");
}

export default function TrackPanel({ variant = "default" }: TrackPanelProps) {
  const router = useRouter();

  const [val, setVal] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    try {
      const last = localStorage.getItem(LS_LAST_TRACK_ID) || "";
      if (last) setVal(last);
    } catch {}
  }, []);

  const go = async () => {
    const clean = cleanOrderId(val);

    setError("");

    if (!clean) {
      setError("Bitte eine Bestellnummer eingeben.");
      return;
    }

    try {
      localStorage.setItem(LS_LAST_TRACK_ID, clean);
    } catch {}

    setBusy(true);

    try {
      const res = await fetch(`/api/track/lookup?id=${encodeURIComponent(clean)}`, {
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
          const id = cleanOrderId(
            String(json?.orderId || json?.id || json?.order?.id || clean),
          );

          router.push(`/track/${encodeURIComponent(id || clean)}`);
          return;
        }

        setError("Bestellung wurde nicht gefunden.");
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
              if (error) setError("");
            }}
            placeholder="Bestellnummer eingeben"
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
          <div className="text-xs text-stone-400">
            Hier können Sie den Status Ihrer Bestellung mit der Bestellnummer prüfen.
          </div>
        )}
      </form>
    </div>
  );
}