"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  isSamsungInternetBrowser,
  markSamsungSafeInstallIntent,
} from "@/lib/client/pwa-compat";

type BeforeInstallPromptEvent = Event & {
  prompt(): Promise<void>;
  userChoice: Promise<{
    outcome: "accepted" | "dismissed";
    platform: string;
  }>;
};

type InstallWindow = Window &
  typeof globalThis & {
    __bbAndroidInstallPrompt?: BeforeInstallPromptEvent | null;
  };

type InstallState =
  | "preparing"
  | "ready"
  | "prompting"
  | "accepted"
  | "dismissed"
  | "manual";

const INSTALL_READY_EVENT = "bb:android-install-ready";
const SCHNELL_MANIFEST = "/api/schnellbestellung/manifest?v=4";
const SCHNELL_START = "/schnellbestellung/enter?homescreen=1";

function isStandaloneMode() {
  const nav = navigator as Navigator & { standalone?: boolean };
  return (
    window.matchMedia?.("(display-mode: standalone)").matches === true ||
    nav.standalone === true
  );
}

function readCapturedPrompt() {
  return (window as InstallWindow).__bbAndroidInstallPrompt || null;
}

function storeCapturedPrompt(prompt: BeforeInstallPromptEvent | null) {
  (window as InstallWindow).__bbAndroidInstallPrompt = prompt;
}

function forceSchnellManifest() {
  const links = Array.from(
    document.querySelectorAll<HTMLLinkElement>('link[rel="manifest"]'),
  );

  if (links.length === 0) {
    const link = document.createElement("link");
    link.rel = "manifest";
    link.href = SCHNELL_MANIFEST;
    document.head.appendChild(link);
    return;
  }

  links[0].href = SCHNELL_MANIFEST;
  links.slice(1).forEach((link) => link.remove());
}

export default function SchnellInstallClient() {
  const promptRef = useRef<BeforeInstallPromptEvent | null>(null);
  const [state, setState] = useState<InstallState>("preparing");
  const [message, setMessage] = useState(
    "Die Schnellbestellung-App wird vorbereitet …",
  );
  const [isSamsung, setIsSamsung] = useState(false);

  const adoptPrompt = useCallback((prompt: BeforeInstallPromptEvent | null) => {
    if (!prompt) return;
    promptRef.current = prompt;
    storeCapturedPrompt(prompt);
    setState("ready");
    setMessage(
      "Tippen Sie auf „Schnellbestellung installieren“ und bestätigen Sie anschließend die Android-Installation.",
    );
  }, []);

  useEffect(() => {
    forceSchnellManifest();

    if (isStandaloneMode()) {
      window.location.replace(SCHNELL_START);
      return;
    }

    const samsung = isSamsungInternetBrowser();
    setIsSamsung(samsung);

    if ("serviceWorker" in navigator) {
      void navigator.serviceWorker
        .register("/sw.js", { scope: "/" })
        .catch(() => undefined);
    }

    const onBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      adoptPrompt(event as BeforeInstallPromptEvent);
    };

    const onCapturedPrompt = () => {
      adoptPrompt(readCapturedPrompt());
    };

    const onInstalled = () => {
      promptRef.current = null;
      storeCapturedPrompt(null);
      setState("accepted");
      setMessage(
        "BB Schnell wurde installiert. Öffnen Sie jetzt das neue Symbol auf Ihrem Startbildschirm und scannen Sie den Restaurant-QR erneut.",
      );
    };

    adoptPrompt(readCapturedPrompt());

    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.addEventListener(INSTALL_READY_EVENT, onCapturedPrompt);
    window.addEventListener("appinstalled", onInstalled);

    const manualTimer = window.setTimeout(() => {
      if (!promptRef.current) {
        setState("manual");
        setMessage(
          samsung
            ? "Samsung Internet: Fügen Sie diese Seite bitte über das Browser-Menü zum Startbildschirm hinzu."
            : "Falls kein Android-Installationsfenster erscheint, wählen Sie im Browser-Menü „App installieren“ oder „Zum Startbildschirm hinzufügen“.",
        );
      }
    }, 3_000);

    return () => {
      window.clearTimeout(manualTimer);
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener(INSTALL_READY_EVENT, onCapturedPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, [adoptPrompt]);

  const install = useCallback(async () => {
    if (state === "prompting" || state === "accepted") return;

    if (isSamsung) {
      markSamsungSafeInstallIntent();
      setState("manual");
      setMessage(
        "Samsung Internet: Menü ☰ → „Seite hinzufügen zu“ → „Startbildschirm“.",
      );
      return;
    }

    setState("prompting");
    setMessage("Das Android-Installationsfenster wird geöffnet …");

    let prompt = promptRef.current || readCapturedPrompt();
    if (!prompt) {
      const deadline = Date.now() + 2_500;
      while (!prompt && Date.now() < deadline) {
        await new Promise((resolve) => window.setTimeout(resolve, 100));
        prompt = promptRef.current || readCapturedPrompt();
      }
    }

    if (!prompt) {
      setState("manual");
      setMessage(
        "Das automatische Fenster ist in diesem Browser nicht verfügbar. Öffnen Sie das Browser-Menü und wählen Sie „App installieren“ oder „Zum Startbildschirm hinzufügen“.",
      );
      return;
    }

    try {
      await prompt.prompt();
      const choice = await prompt.userChoice;
      promptRef.current = null;
      storeCapturedPrompt(null);

      if (choice.outcome === "accepted") {
        setState("accepted");
        setMessage(
          "Installation bestätigt. Öffnen Sie danach „BB Schnell“ über das neue Symbol auf Ihrem Startbildschirm.",
        );
      } else {
        setState("dismissed");
        setMessage(
          "Die Installation wurde abgebrochen. Ohne installierte BB-Schnell-App kann auf Android keine Schnellbestellung aufgegeben werden.",
        );
      }
    } catch {
      setState("manual");
      setMessage(
        "Das Installationsfenster konnte nicht geöffnet werden. Bitte verwenden Sie das Browser-Menü: „App installieren“ oder „Zum Startbildschirm hinzufügen“.",
      );
    }
  }, [isSamsung, state]);

  const buttonLabel =
    state === "prompting"
      ? "Installation wird geöffnet …"
      : state === "accepted"
        ? "BB Schnell installiert"
        : "Schnellbestellung installieren";

  return (
    <main className="relative min-h-dvh overflow-hidden bg-[#03151f] px-5 py-8 text-stone-100">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_top,rgba(14,165,233,0.18),transparent_38%),radial-gradient(circle_at_bottom,rgba(245,158,11,0.12),transparent_38%)]" />

      <section className="relative mx-auto flex min-h-[calc(100dvh-4rem)] max-w-xl items-center justify-center">
        <div className="w-full rounded-[2rem] border border-sky-300/25 bg-black/35 p-6 text-center shadow-2xl shadow-black/40 backdrop-blur-xl sm:p-8">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/schnell-icon-512.png?v=2"
            alt="Burger Brothers Schnellbestellung"
            className="mx-auto h-32 w-32 rounded-[2rem] object-cover shadow-xl shadow-black/40"
          />

          <p className="mt-7 text-sm font-black tracking-[0.24em] text-amber-300">
            SCHNELLBESTELLUNG
          </p>

          <h1 className="mt-3 text-4xl font-black leading-tight text-white">
            BB Schnell installieren
          </h1>

          <p className="mx-auto mt-4 max-w-md text-base leading-7 text-stone-300">
            Auf Android ist die Schnellbestellung nur über die installierte
            Schnellbestellung-App möglich. Die normale Burger-Brothers-Menü-App
            wird dabei nicht installiert.
          </p>

          <button
            type="button"
            onClick={() => void install()}
            disabled={state === "prompting" || state === "accepted"}
            className="mt-7 w-full rounded-2xl bg-gradient-to-r from-amber-400 to-yellow-300 px-5 py-5 text-lg font-black text-black shadow-xl shadow-amber-950/30 transition active:scale-[0.99] disabled:cursor-default disabled:opacity-70"
          >
            {buttonLabel}
          </button>

          <div
            className={`mt-5 rounded-2xl border p-4 text-left text-sm leading-6 ${
              state === "accepted"
                ? "border-emerald-300/30 bg-emerald-300/10 text-emerald-100"
                : state === "dismissed"
                  ? "border-amber-300/30 bg-amber-300/10 text-amber-100"
                  : "border-white/15 bg-white/[0.05] text-stone-300"
            }`}
          >
            {message}
          </div>

          {state === "manual" ? (
            <div className="mt-4 rounded-2xl border border-white/15 bg-black/25 p-4 text-left text-sm leading-7 text-stone-300">
              <p className="font-black text-white">Manuell installieren</p>
              {isSamsung ? (
                <p className="mt-2">
                  Samsung Internet: Menü ☰ → „Seite hinzufügen zu“ →
                  „Startbildschirm“.
                </p>
              ) : (
                <p className="mt-2">
                  Chrome: Menü ⋮ → „App installieren“ oder „Zum Startbildschirm
                  hinzufügen“.
                </p>
              )}
            </div>
          ) : null}

          <p className="mt-5 text-xs leading-5 text-stone-500">
            Nach der Installation öffnen Sie „BB Schnell“ vom Startbildschirm
            und scannen den aktuellen QR-Code im Restaurant erneut.
          </p>
        </div>
      </section>
    </main>
  );
}
