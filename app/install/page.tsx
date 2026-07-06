// app/install/page.tsx
"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{
    outcome: "accepted" | "dismissed";
    platform: string;
  }>;
};

function detectDevice() {
  if (typeof window === "undefined") {
    return {
      isAndroid: false,
      isIOS: false,
      isStandalone: false,
      isMobile: false,
    };
  }

  const nav = window.navigator as Navigator & { standalone?: boolean };
  const ua = nav.userAgent || "";

  const isIOS =
    /iphone|ipad|ipod/i.test(ua) ||
    (nav.platform === "MacIntel" && Number(nav.maxTouchPoints || 0) > 1);

  const isAndroid = /android/i.test(ua);
  const isStandalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    window.matchMedia("(display-mode: fullscreen)").matches ||
    nav.standalone === true;

  return {
    isAndroid,
    isIOS,
    isStandalone,
    isMobile: isAndroid || isIOS,
  };
}

export default function InstallPage() {
  const [installPrompt, setInstallPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [device, setDevice] = useState(() => detectDevice());
  const [message, setMessage] = useState("");

  useEffect(() => {
    setDevice(detectDevice());

    const onBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
      setMessage("");
    };

    const onAppInstalled = () => {
      setInstallPrompt(null);
      setDevice(detectDevice());
      setMessage("Fertig! Burger Brothers wurde zum Startbildschirm hinzugefügt.");
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.addEventListener("appinstalled", onAppInstalled);

    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("appinstalled", onAppInstalled);
    };
  }, []);

  const primaryLabel = useMemo(() => {
    if (device.isStandalone) return "App ist bereits geöffnet";
    if (device.isIOS) return "iPhone-Anleitung anzeigen";
    if (installPrompt) return "Burger Brothers installieren";
    return "Menü öffnen";
  }, [device.isIOS, device.isStandalone, installPrompt]);

  const handleInstall = async () => {
    if (device.isStandalone) {
      setMessage("Die App ist bereits im Standalone-Modus geöffnet.");
      return;
    }

    if (device.isIOS) {
      setMessage(
        "iPhone: In Safari öffnen, Teilen-Symbol antippen und „Zum Home-Bildschirm“ wählen.",
      );
      return;
    }

    if (!installPrompt) {
      setMessage(
        "Falls kein Installationsfenster erscheint: Chrome/Edge Menü öffnen und „App installieren“ oder „Zum Startbildschirm hinzufügen“ wählen.",
      );
      return;
    }

    try {
      await installPrompt.prompt();
      const choice = await installPrompt.userChoice;

      if (choice.outcome === "accepted") {
        setMessage("Danke! Burger Brothers wird als App hinzugefügt.");
      } else {
        setMessage("Installation abgebrochen. Du kannst es später erneut versuchen.");
      }

      setInstallPrompt(null);
    } catch {
      setMessage(
        "Installation konnte nicht automatisch gestartet werden. Bitte Browser-Menü öffnen und „App installieren“ wählen.",
      );
    }
  };

  return (
    <main className="min-h-screen overflow-hidden bg-black text-stone-100">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_top,rgba(251,146,60,0.20),transparent_35%),radial-gradient(circle_at_bottom_right,rgba(239,68,68,0.14),transparent_30%)]" />

      <section className="relative mx-auto flex min-h-screen max-w-5xl flex-col items-center justify-center px-5 py-10 text-center">
        <div className="mb-6 rounded-[2rem] border border-amber-300/20 bg-white/[0.06] p-4 shadow-2xl shadow-orange-950/40 backdrop-blur-xl">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/icon-kurier-512.png?v=5"
            alt="Burger Brothers"
            className="h-24 w-24 rounded-3xl object-cover"
          />
        </div>

        <p className="mb-3 rounded-full border border-amber-300/20 bg-amber-500/10 px-4 py-1.5 text-xs font-bold uppercase tracking-[0.28em] text-amber-200">
          Burger Brothers Berlin
        </p>

        <h1 className="max-w-3xl text-4xl font-black tracking-tight text-white sm:text-6xl">
          Als App speichern
        </h1>

        <p className="mt-5 max-w-2xl text-base leading-7 text-stone-300 sm:text-lg">
          Speichere Burger Brothers direkt auf deinem Handy. Danach kannst du
          schneller bestellen – wie mit einer normalen App.
        </p>

        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <button
            type="button"
            onClick={handleInstall}
            className="rounded-full bg-gradient-to-r from-orange-400 to-amber-300 px-8 py-4 text-base font-black text-black shadow-xl shadow-orange-950/40 transition hover:scale-[1.02] active:scale-95"
          >
            {primaryLabel}
          </button>

          <Link
            href="/menu"
            className="rounded-full border border-white/15 bg-white/10 px-8 py-4 text-base font-bold text-white backdrop-blur transition hover:bg-white/15 active:scale-95"
          >
            Menü öffnen
          </Link>
        </div>

        {message ? (
          <div className="mt-5 max-w-2xl rounded-2xl border border-amber-300/20 bg-amber-500/10 px-5 py-4 text-sm font-medium text-amber-100">
            {message}
          </div>
        ) : null}

        <div className="mt-10 grid w-full gap-4 text-left md:grid-cols-3">
          <div className="rounded-3xl border border-white/10 bg-white/[0.06] p-5 backdrop-blur">
            <div className="text-2xl">🤖</div>
            <h2 className="mt-3 text-lg font-black text-white">Android</h2>
            <p className="mt-2 text-sm leading-6 text-stone-300">
              QR-Code scannen und auf „Burger Brothers installieren“ tippen.
              Falls kein Fenster erscheint: Chrome-Menü öffnen und „App installieren“ wählen.
            </p>
          </div>

          <div className="rounded-3xl border border-white/10 bg-white/[0.06] p-5 backdrop-blur">
            <div className="text-2xl">🍎</div>
            <h2 className="mt-3 text-lg font-black text-white">iPhone</h2>
            <ol className="mt-2 list-inside list-decimal space-y-1 text-sm leading-6 text-stone-300">
              <li>Mit Safari öffnen</li>
              <li>Teilen-Symbol antippen</li>
              <li>„Zum Home-Bildschirm“ wählen</li>
            </ol>
          </div>

          <div className="rounded-3xl border border-white/10 bg-white/[0.06] p-5 backdrop-blur">
            <div className="text-2xl">⚡</div>
            <h2 className="mt-3 text-lg font-black text-white">Schneller bestellen</h2>
            <p className="mt-2 text-sm leading-6 text-stone-300">
              Einmal speichern, danach direkt vom Startbildschirm öffnen und
              Bestellung schneller abschicken.
            </p>
          </div>
        </div>

        <p className="mt-8 max-w-2xl text-xs leading-6 text-stone-500">
          Hinweis: Aus Sicherheitsgründen muss jede Installation vom Kunden
          bestätigt werden. Der QR-Code öffnet die Installationsseite, die App
          kann danach mit einem Tipp gespeichert werden.
        </p>
      </section>
    </main>
  );
}
