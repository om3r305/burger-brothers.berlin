"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import {
  activateGeneralPushFromGesture,
  ALL_GENERAL_PUSH_PREFERENCES,
  ensureCustomerAppPushRegistration,
  isStandaloneApp,
} from "@/lib/client/general-push";

type Decision = "accepted" | "declined" | null;

const DECISION_KEY = "bb_notification_prompt_decision_v1";
const LEGACY_KEY = "bb_general_install_done_v1";

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

  useEffect(() => {
    if (
      typeof window === "undefined" ||
      !isStandaloneApp() ||
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
    saveDecision("accepted");

    try {
      const result = await activateGeneralPushFromGesture(
        ALL_GENERAL_PUSH_PREFERENCES,
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
      // Kullanıcı Evet dedi. Geçici sunucu hatasında sonraki açılış sessizce onarır.
    } finally {
      setShowPrompt(false);
      setBusy(false);
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
      </section>
    </div>
  );
}
