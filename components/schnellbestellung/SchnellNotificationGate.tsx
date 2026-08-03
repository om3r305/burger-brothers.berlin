"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import {
  activateSchnellPushFromGesture,
  prewarmSchnellPush,
  type SchnellPushActivationResult,
  type SchnellPushActivationStage,
} from "@/lib/client/schnell-push";
import { isStandaloneDisplayMode } from "@/lib/client/pwa-compat";

type GateMode = "checking" | "hidden" | "prompt";

const SKIP_COOKIE = "bb_schnell_push_skip";
const SKIP_SECONDS = 30 * 60;

function supportsPush() {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "Notification" in window &&
    "PushManager" in window
  );
}

function hasSkipCookie() {
  try {
    return document.cookie
      .split(";")
      .some((entry) => entry.trim() === `${SKIP_COOKIE}=1`);
  } catch {
    return false;
  }
}

function setSkipCookie(skipped: boolean) {
  try {
    document.cookie = skipped
      ? `${SKIP_COOKIE}=1; Path=/; Max-Age=${SKIP_SECONDS}; SameSite=Lax; Secure`
      : `${SKIP_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax; Secure`;
  } catch {
    // Cookie kullanılamasa bile ekran akışı çalışmaya devam eder.
  }
}

function resultMessage(result: SchnellPushActivationResult | null) {
  if (!result || result.ok) return "";

  switch (result.code) {
    case "permission_denied":
      return "Benachrichtigungen sind blockiert. Öffnen Sie die Geräte-Einstellungen → Apps beziehungsweise Mitteilungen → BB Schnell und erlauben Sie Benachrichtigungen.";
    case "permission_default":
      return "Die Freigabe wurde noch nicht bestätigt. Tippen Sie erneut auf „Ja, aktivieren“.";
    case "permission_timeout":
      return "Die Berechtigungsabfrage hat zu lange gedauert. Bitte versuchen Sie es erneut.";
    case "not_configured":
      return "Der Benachrichtigungsdienst ist auf dem Server noch nicht vollständig eingerichtet.";
    case "disabled":
      return "Fertig-Benachrichtigungen sind momentan deaktiviert.";
    case "service_worker_failed":
    case "service_worker_timeout":
      return "Der Benachrichtigungsdienst konnte nicht gestartet werden. Schließen und öffnen Sie BB Schnell erneut.";
    case "subscription_failed":
    case "subscription_timeout":
      return "Das Gerät konnte nicht für Benachrichtigungen angemeldet werden. Bitte prüfen Sie Internet und Geräteeinstellungen.";
    default:
      return "Dieses Gerät unterstützt die benötigte Hintergrundbenachrichtigung nicht.";
  }
}

export default function SchnellNotificationGate({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [mode, setMode] = useState<GateMode>("checking");
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<SchnellPushActivationStage | null>(null);
  const [result, setResult] = useState<SchnellPushActivationResult | null>(null);

  const eligiblePath =
    pathname === "/schnellbestellung" ||
    pathname === "/schnellbestellung/enter" ||
    pathname === "/schnellbestellung/install";

  useEffect(() => {
    if (!eligiblePath || !isStandaloneDisplayMode() || !supportsPush()) {
      setMode("hidden");
      return;
    }

    prewarmSchnellPush();

    if (Notification.permission === "granted") {
      setSkipCookie(false);
      setMode("hidden");
      return;
    }

    if (hasSkipCookie()) {
      setMode("hidden");
      return;
    }

    setMode("prompt");
  }, [eligiblePath]);

  const activate = useCallback(async () => {
    if (busy) return;

    setBusy(true);
    setResult(null);
    setStage("permission");
    setSkipCookie(false);

    const next = await activateSchnellPushFromGesture(setStage);
    setResult(next);
    setStage(null);
    setBusy(false);

    if (next.ok) {
      setSkipCookie(false);
      setMode("hidden");
    }
  }, [busy]);

  const continueWithoutPush = useCallback(() => {
    setSkipCookie(true);
    setResult(null);
    setStage(null);
    setMode("hidden");
  }, []);

  if (mode === "hidden") return <>{children}</>;

  if (mode === "checking") {
    return (
      <main className="bb-schnell-page grid min-h-dvh place-items-center bg-stone-950 p-6 text-white">
        <div className="text-center">
          <div className="mx-auto h-12 w-12 animate-spin rounded-full border-4 border-white/20 border-t-amber-300" />
          <p className="mt-4 font-bold text-stone-300">BB Schnell wird vorbereitet …</p>
        </div>
      </main>
    );
  }

  const message = resultMessage(result);
  const stageLabel =
    stage === "permission"
      ? "Berechtigung wird geöffnet …"
      : stage === "config"
        ? "Benachrichtigungsdienst wird geprüft …"
        : stage === "service_worker"
          ? "App wird vorbereitet …"
          : stage === "subscription"
            ? "Gerät wird angemeldet …"
            : "Wird aktiviert …";

  return (
    <main className="bb-schnell-page grid min-h-dvh place-items-center bg-stone-950 p-5 text-white">
      <section className="bb-schnell-sheet w-full max-w-md rounded-3xl border border-emerald-300/25 p-6 shadow-2xl shadow-black/30">
        <div className="text-center">
          <img
            src="/schnell-icon-180.png?v=1"
            className="mx-auto h-24 w-24 rounded-[24px]"
            alt="Burger Brothers"
          />
          <p className="mt-5 text-sm font-black uppercase tracking-[0.18em] text-emerald-300">
            BB Schnell
          </p>
          <h1 className="mt-2 text-3xl font-black">
            Benachrichtigungen aktivieren?
          </h1>
          <p className="mt-3 leading-6 text-stone-300">
            Möchten Sie eine Benachrichtigung erhalten, sobald Ihre Bestellung
            fertig ist? Danach können Sie die App schließen.
          </p>
        </div>

        <button
          type="button"
          disabled={busy}
          onClick={() => void activate()}
          className="mt-7 w-full rounded-2xl bg-emerald-400 px-5 py-4 text-lg font-black text-black disabled:opacity-60"
        >
          {busy ? stageLabel : "Ja, aktivieren"}
        </button>

        {message ? (
          <div
            className="mt-4 rounded-2xl border border-red-300/30 bg-red-400/10 p-4 text-sm leading-6 text-red-100"
            role="alert"
          >
            {message}
          </div>
        ) : null}

        <button
          type="button"
          disabled={busy}
          onClick={continueWithoutPush}
          className="mt-4 w-full rounded-2xl border border-white/15 bg-white/5 px-5 py-4 font-bold text-white disabled:opacity-50"
        >
          Ohne Benachrichtigung fortfahren
        </button>

        <p className="mt-5 text-center text-xs leading-5 text-stone-500">
          Die Systemabfrage erscheint nur nach Ihrer Zustimmung. Die
          Einstellung kann später in Android oder iPhone geändert werden.
        </p>
      </section>
    </main>
  );
}