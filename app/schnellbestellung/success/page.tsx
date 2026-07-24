"use client";

import { useSearchParams } from "next/navigation";
import { useState } from "react";

export default function SuccessPage() {
  const searchParams = useSearchParams();
  const [closing, setClosing] = useState(false);

  function finish() {
    setClosing(true);
    try {
      window.close();
    } catch {
      // Safari may block window.close for tabs not opened by script.
    }

    window.setTimeout(() => {
      window.location.replace("/");
    }, 350);
  }

  return (
    <main className="grid min-h-dvh place-items-center bg-stone-950 p-6 text-white">
      <section className="w-full max-w-lg text-center">
        <p className="text-2xl font-bold text-emerald-400 sm:text-3xl">
          Bestellung aufgenommen
        </p>
        <p className="mt-8 text-xl text-stone-300">Ihre Nummer</p>
        <div className="my-4 text-[9rem] font-black leading-none text-amber-400 sm:text-[11rem]">
          {searchParams.get("number") || "–"}
        </div>
        <p className="mx-auto max-w-sm text-xl text-stone-300">
          Bitte warten Sie, bis Ihre Nummer aufgerufen wird.
        </p>
        <p className="mt-8 text-sm text-stone-500">
          Barzahlung an der Ausgabe · BAR OFFEN
        </p>

        <button
          type="button"
          onClick={finish}
          disabled={closing}
          className="mt-10 w-full rounded-2xl bg-amber-400 px-5 py-4 text-lg font-black text-black disabled:opacity-60"
        >
          {closing ? "Wird geschlossen …" : "Bestellung beenden"}
        </button>
        <p className="mt-3 text-xs text-stone-500">
          Falls Safari den Tab nicht schließen kann, werden Sie zur Startseite weitergeleitet.
        </p>
      </section>
    </main>
  );
}
