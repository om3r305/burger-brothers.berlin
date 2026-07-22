"use client";

import { useEffect } from "react";

export default function DriverRouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("DRIVER_ROUTE_ERROR", {
      name: error.name,
      digest: error.digest || null,
    });
  }, [error.digest, error.name]);

  return (
    <main className="flex min-h-[100dvh] items-center justify-center bg-stone-950 px-4 text-stone-100">
      <section className="w-full max-w-md rounded-3xl border border-rose-400/30 bg-stone-900 p-6 text-center shadow-2xl">
        <div className="text-4xl" aria-hidden="true">
          ⚠️
        </div>
        <h1 className="mt-3 text-2xl font-black">
          Fahrerbereich konnte nicht geladen werden
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-stone-300">
          Bitte erneut versuchen. Falls der Fehler bleibt, Seite neu laden
          und den Admin informieren.
        </p>

        <div className="mt-5 grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={reset}
            className="rounded-2xl bg-emerald-400 px-4 py-3 font-black text-black"
          >
            Erneut versuchen
          </button>

          <button
            type="button"
            onClick={() => window.location.reload()}
            className="rounded-2xl border border-white/15 bg-white/[0.06] px-4 py-3 font-bold text-stone-100"
          >
            Neu laden
          </button>
        </div>
      </section>
    </main>
  );
}
