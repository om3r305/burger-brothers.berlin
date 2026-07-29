"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import {
  activateGeneralPushFromGesture,
  ALL_GENERAL_PUSH_PREFERENCES,
  ensureCustomerAppPushRegistration,
  isStandaloneApp,
  type GeneralPushActivationStage,
} from "@/lib/client/general-push";
import {
  hasSamsungSafeInstallIntent,
  isSamsungInternetBrowser,
} from "@/lib/client/pwa-compat";

type Decision = "accepted" | "declined" | null;

const DECISION_KEY = "bb_notification_prompt_decision_v1";
const LEGACY_KEY = "bb_general_install_done_v1";

const STAGE_LABELS: Record<GeneralPushActivationStage, string> = {
  permission: "Berechtigung wird geprüft …",
  config: "Benachrichtigungsdienst wird geprüft …",
  service_worker: "App-Komponente wird vorbereitet …",
  subscription: "Gerät wird angemeldet …",
  server: "Anmeldung wird gespeichert …",
  done: "Benachrichtigungen sind aktiv.",
};

function readDecision(): Decision {
  try {
    const value = localStorage.getItem(DECISION_KEY);
    return value === "accepted" || value === "declined" ? value : null;
  } catch {
    return null;
  }
}

function saveDecision(value: Exclude<Decision, null>) {
  try {
    localStorage.setItem(DECISION_KEY, value);
    localStorage.setItem(LEGACY_KEY, "1");
  } catch {}

  try {
    document.cookie = `${DECISION_KEY}=${value}; Path=/; Max-Age=31536000; SameSite=Lax; Secure`;
  } catch {}
}

function isOperationalPath(pathname: string) {
  return [
    "/admin",
    "/dashboard",
    "/tv",
    "/driver",
    "/print",
    "/showcase",
    "/schnellbestellung",
  ].some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

async function repairCustomerPushInBackground() {
  await ensureCustomerAppPushRegistration().catch(() => false);
}

export default function CustomerAppBootstrap() {
  const pathname = usePathname();
  const [showPrompt, setShowPrompt] = useState(false);
  const [busy, setBusy] = useState(false);
  const [stageText, setStageText] = useState("");

  useEffect(() => {
    const samsungShortcutFlow =
      isSamsungInternetBrowser() && hasSamsungSafeInstallIntent();

    if (
      typeof window === "undefined" ||
      (!isStandaloneApp() && !samsungShortcutFlow) ||
      isOperationalPath(pathname) ||
      pathname === "/install"
    ) {
      return;
    }

    let decision = readDecision();

    if (!decision && typeof Notification !== "undefined") {
      if (Notification.permission === "granted") {
        decision = "accepted";
        saveDecision("accepted");
      } else if (Notification.permission === "denied") {
        decision = "declined";
        saveDecision("declined");
      }
    }

    if (decision === "accepted") {
      void repairCustomerPushInBackground();
      return;
    }

    if (!decision && pathname === "/") {
      setShowPrompt(true);
    }
  }, [pathname]);

  const accept = async () => {
    if (busy) return;

    setBusy(true);
    setStageText(STAGE_LABELS.permission);
    saveDecision("accepted");

    try {
      const result = await activateGeneralPushFromGesture(
        ALL_GENERAL_PUSH_PREFERENCES,
        {
          onStage: (stage) => setStageText(STAGE_LABELS[stage]),
        },
      );

      if (
        !result.ok &&
        (result.code === "permission_denied" ||
          result.code === "permission_default" ||
          result.code === "unsupported")
      ) {
        saveDecision("declined");
      }
    } catch {
      // The user's Yes choice is preserved. A later launch repairs the
      // registration silently, while this screen is never allowed to hang.
    } finally {
      setShowPrompt(false);
      setBusy(false);
      setStageText("");
    }
  };

  const decline = () => {
    saveDecision("declined");
    setShowPrompt(false);
  };

  if (!showPrompt) return null;

  return (
    <div className="fixed inset-0 z-[2147483000] grid place-items-center bg-black/70 p-5 backdrop-blur-sm">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="bb-notification-prompt-title"
        className="w-full max-w-sm rounded-[2rem] border border-white/15 bg-stone-950 p-6 text-center text-white shadow-2xl"
      >
        <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-emerald-400 text-2xl text-black">
          🔔
        </div>
        <h2
          id="bb-notification-prompt-title"
          className="mt-5 text-2xl font-black"
        >
          Benachrichtigungen aktivieren?
        </h2>
        <p className="mt-3 text-sm leading-6 text-stone-300">
          Möchten Sie Benachrichtigungen von Burger Brothers erhalten?
        </p>

        {busy && stageText ? (
          <p
            className="mt-4 rounded-2xl border border-emerald-300/20 bg-emerald-400/10 px-4 py-3 text-sm font-bold text-emerald-100"
            aria-live="polite"
          >
            {stageText}
          </p>
        ) : null}

        <div className="mt-6 grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => void accept()}
            disabled={busy}
            className="rounded-2xl bg-emerald-400 px-5 py-4 text-lg font-black text-black disabled:opacity-60"
          >
            {busy ? "Bitte warten …" : "Ja"}
          </button>
          <button
            type="button"
            onClick={decline}
            disabled={busy}
            className="rounded-2xl border border-white/15 bg-white/[0.08] px-5 py-4 text-lg font-black text-white disabled:opacity-60"
          >
            Nein
          </button>
        </div>

        {busy ? (
          <p className="mt-4 text-xs leading-5 text-stone-500">
            Falls ein Browser-Schritt nicht antwortet, wird automatisch beendet
            und die Anmeldung später im Hintergrund repariert.
          </p>
        ) : null}
      </section>
    </div>
  );
}
