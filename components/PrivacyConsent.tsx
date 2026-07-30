"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import {
  ANALYTICS_CONSENT_EVENT,
  ANALYTICS_CONSENT_KEY,
} from "@/components/AnalyticsPing";

type Decision = "granted" | "denied" | null;
export const ANALYTICS_CONSENT_RESET_EVENT = "bb:analytics-consent-reset";

export default function PrivacyConsent() {
  const pathname = usePathname();
  const [decision, setDecision] = useState<Decision>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(ANALYTICS_CONSENT_KEY);
      setDecision(stored === "granted" || stored === "denied" ? stored : null);
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    const reset = () => setDecision(null);
    window.addEventListener(ANALYTICS_CONSENT_RESET_EVENT, reset);
    return () =>
      window.removeEventListener(ANALYTICS_CONSENT_RESET_EVENT, reset);
  }, []);

  function choose(next: Exclude<Decision, null>) {
    localStorage.setItem(ANALYTICS_CONSENT_KEY, next);
    if (next === "denied") {
      sessionStorage.removeItem("bb_analytics_session_id");
    }
    setDecision(next);
    window.dispatchEvent(new Event(ANALYTICS_CONSENT_EVENT));
  }

  const operationalRoute =
    pathname === "/admin" ||
    pathname.startsWith("/admin/") ||
    pathname === "/tv" ||
    pathname.startsWith("/tv/") ||
    pathname === "/showcase" ||
    pathname.startsWith("/showcase/") ||
    pathname === "/driver" ||
    pathname.startsWith("/driver/") ||
    pathname === "/schnellbestellung" ||
    pathname.startsWith("/schnellbestellung/");

  if (!ready || decision || operationalRoute) return null;

  return (
    <aside
      role="dialog"
      aria-label="Datenschutz-Einstellung"
      className="fixed inset-x-3 bottom-3 z-[2147483000] mx-auto max-w-3xl rounded-2xl border border-stone-700 bg-stone-950/95 p-4 text-sm text-stone-100 shadow-2xl backdrop-blur"
    >
      <p className="font-semibold">Datenschutz-Einstellung</p>
      <p className="mt-1 text-stone-300">
        Wir möchten anonyme Seitenaufrufe messen. Das ist freiwillig; Bestellung
        und App funktionieren auch ohne Statistik. Es werden keine Suchparameter,
        Roh-IP-Adressen oder vollständigen Gerätekennungen gespeichert.{" "}
        <a className="underline" href="/datenschutz">
          Details
        </a>
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          className="rounded-xl bg-emerald-500 px-4 py-2 font-semibold text-black"
          onClick={() => choose("granted")}
        >
          Statistik erlauben
        </button>
        <button
          type="button"
          className="rounded-xl border border-stone-600 px-4 py-2"
          onClick={() => choose("denied")}
        >
          Nur notwendige Funktionen
        </button>
      </div>
    </aside>
  );
}
