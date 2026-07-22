"use client";

import { useEffect } from "react";

export default function TvRouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("TV_ROUTE_ERROR", {
      message: error.message,
      digest: error.digest || null,
    });
  }, [error.digest, error.message]);

  return (
    <main className="flex min-h-[100dvh] items-center justify-center bg-slate-950 p-5 text-slate-100">
      <section className="w-full max-w-xl rounded-3xl border border-rose-400/30 bg-slate-900/90 p-6 text-center shadow-2xl">
        <img
          src="/logo-burger-brothers.png"
          alt="Burger Brothers"
          className="mx-auto h-16 w-16"
        />

        <h1 className="mt-4 text-2xl font-black text-rose-200">
          TV konnte nicht geladen werden
        </h1>

        <p className="mt-3 text-sm leading-relaxed text-slate-300">
          Die Bestellseite hatte einen unerwarteten Fehler. Bitte zuerst
          erneut versuchen. Falls das Problem bleibt, die Seite neu laden.
        </p>

        <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <button
            type="button"
            onClick={reset}
            className="rounded-2xl border border-sky-300/50 bg-sky-600 px-4 py-3 font-black text-white hover:bg-sky-500"
          >
            Erneut versuchen
          </button>

          <button
            type="button"
            onClick={() => window.location.reload()}
            className="rounded-2xl border border-white/15 bg-white/5 px-4 py-3 font-black text-slate-100 hover:bg-white/10"
          >
            Seite neu laden
          </button>
        </div>

        {error.digest ? (
          <div className="mt-4 text-xs text-slate-500">
            Fehlerreferenz: {error.digest}
          </div>
        ) : null}
      </section>
    </main>
  );
}
