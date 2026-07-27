"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import QRCode from "react-qr-code";
import {
  activateGeneralPushFromGesture,
  ALL_GENERAL_PUSH_PREFERENCES,
  disableGeneralPush,
  ensureCustomerAppPushRegistration,
  isIOSDevice,
  isStandaloneApp,
  loadGeneralPushState,
} from "@/lib/client/general-push";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{
    outcome: "accepted" | "dismissed";
    platform: string;
  }>;
};

type DeviceState = {
  isAndroid: boolean;
  isIOS: boolean;
  isStandalone: boolean;
  isMobile: boolean;
};

type NotificationDecision = "accepted" | "declined" | null;

const NOTIFICATION_DECISION_KEY = "bb_notification_prompt_decision_v1";
const LEGACY_ONBOARDING_KEY = "bb_general_install_done_v1";
const HOME_URL = "/";

function detectDevice(): DeviceState {
  if (typeof window === "undefined") {
    return {
      isAndroid: false,
      isIOS: false,
      isStandalone: false,
      isMobile: false,
    };
  }

  const ua = navigator.userAgent || "";
  const isAndroid = /android/i.test(ua);
  const isIOS = isIOSDevice();
  const standalone = isStandaloneApp();

  return {
    isAndroid,
    isIOS,
    isStandalone: standalone,
    isMobile: isAndroid || isIOS,
  };
}

function readDecision(): NotificationDecision {
  try {
    const stored = localStorage.getItem(NOTIFICATION_DECISION_KEY);
    if (stored === "accepted" || stored === "declined") return stored;
  } catch {}
  return null;
}

function saveDecision(decision: Exclude<NotificationDecision, null>) {
  try {
    localStorage.setItem(NOTIFICATION_DECISION_KEY, decision);
    localStorage.setItem(LEGACY_ONBOARDING_KEY, "1");
  } catch {}
}


function messageForActivation(code: string) {
  switch (code) {
    case "ios_home_screen_required":
      return "Bitte zuerst über Safari zum Home-Bildschirm hinzufügen und Burger Brothers danach über das neue Symbol öffnen.";
    case "not_configured":
      return "Der Benachrichtigungsdienst ist auf dem Server noch nicht vollständig eingerichtet.";
    case "disabled":
      return "Benachrichtigungen sind zurzeit deaktiviert.";
    case "unsupported":
      return "Dieser Browser unterstützt keine App-Benachrichtigungen.";
    case "service_worker_failed":
      return "Die App-Komponente konnte nicht gestartet werden.";
    case "subscription_failed":
    case "server_failed":
      return "Die Geräteanmeldung konnte noch nicht abgeschlossen werden.";
    default:
      return "Benachrichtigungen wurden nicht aktiviert.";
  }
}

export default function InstallPage() {
  const [device, setDevice] = useState<DeviceState>(() => detectDevice());
  const [installPrompt, setInstallPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [installBusy, setInstallBusy] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  const [routingHome, setRoutingHome] = useState(false);
  const [decision, setDecision] = useState<NotificationDecision>(null);
  const [pushSubscribed, setPushSubscribed] = useState(false);
  const [settingsMode, setSettingsMode] = useState(false);
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<"ok" | "error" | "info">(
    "info",
  );
  const [installUrl, setInstallUrl] = useState("");
  const iosStepsRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    const currentDevice = detectDevice();
    const currentSettingsMode =
      new URLSearchParams(window.location.search).get("settings") === "1";

    setDevice(currentDevice);
    setSettingsMode(currentSettingsMode);
    setInstallUrl(`${window.location.origin}/install`);

    if ("serviceWorker" in navigator) {
      void navigator.serviceWorker
        .register("/sw.js", { scope: "/" })
        .catch(() => undefined);
    }

    const initializeStandalone = async () => {
      if (!currentDevice.isStandalone) return;

      let storedDecision = readDecision();

      if (!storedDecision) {
        let legacyDone = false;
        try {
          legacyDone = localStorage.getItem(LEGACY_ONBOARDING_KEY) === "1";
        } catch {}

        if (legacyDone) {
          storedDecision =
            typeof Notification !== "undefined" &&
            Notification.permission === "granted"
              ? "accepted"
              : "declined";
          saveDecision(storedDecision);
        } else if (
          typeof Notification !== "undefined" &&
          Notification.permission === "granted"
        ) {
          try {
            const state = await loadGeneralPushState();
            if (state.subscribed) {
              storedDecision = "accepted";
              saveDecision("accepted");
            }
          } catch {}
        }
      }

      if (cancelled) return;
      setDecision(storedDecision);

      if (currentSettingsMode) {
        try {
          const state = await loadGeneralPushState();
          if (!cancelled) setPushSubscribed(state.subscribed === true);
        } catch {}
        return;
      }

      if (!storedDecision) return;

      setRoutingHome(true);
      if (
        storedDecision === "accepted" &&
        typeof Notification !== "undefined" &&
        Notification.permission === "granted"
      ) {
        const registered = await ensureCustomerAppPushRegistration().catch(
          () => false,
        );

        if (!registered) {
          console.warn(
            "Customer app push registration will be retried on the next launch.",
          );
        }
      }

      if (!cancelled) window.location.replace(HOME_URL);
    };

    void initializeStandalone();

    const onBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setInstallPrompt(null);
      setDevice(detectDevice());
      setMessageTone("ok");
      setMessage(
        "Burger Brothers wurde gespeichert. Öffnen Sie jetzt das neue Symbol auf Ihrem Startbildschirm.",
      );
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.addEventListener("appinstalled", onInstalled);

    return () => {
      cancelled = true;
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const installationTitle = useMemo(() => {
    if (device.isStandalone) return "Burger Brothers";
    if (device.isIOS) return "Auf dem iPhone speichern";
    if (device.isAndroid) return "Auf Android installieren";
    return "Burger Brothers installieren";
  }, [device]);

  const handleInstall = async () => {
    if (device.isStandalone) return;

    if (device.isIOS) {
      iosStepsRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
      return;
    }

    if (!installPrompt) {
      setMessageTone("info");
      setMessage(
        "Öffnen Sie das Browser-Menü und wählen Sie „App installieren“ oder „Zum Startbildschirm hinzufügen“.",
      );
      return;
    }

    setInstallBusy(true);
    setMessage("");
    try {
      await installPrompt.prompt();
      const choice = await installPrompt.userChoice;
      setInstallPrompt(null);

      if (choice.outcome === "accepted") {
        setMessageTone("ok");
        setMessage(
          "Installation bestätigt. Öffnen Sie Burger Brothers anschließend über das neue App-Symbol.",
        );
      } else {
        setMessageTone("info");
        setMessage("Installation abgebrochen. Sie können es jederzeit erneut versuchen.");
      }
    } catch {
      setMessageTone("error");
      setMessage(
        "Das Installationsfenster konnte nicht geöffnet werden. Bitte das Browser-Menü verwenden.",
      );
    } finally {
      setInstallBusy(false);
    }
  };

  const goHome = () => {
    setRoutingHome(true);
    window.location.replace(HOME_URL);
  };

  const handleNotificationYes = async () => {
    if (pushBusy) return;

    setPushBusy(true);
    setMessage("");
    saveDecision("accepted");
    setDecision("accepted");

    try {
      const result = await activateGeneralPushFromGesture(
        ALL_GENERAL_PUSH_PREFERENCES,
      );

      if (result.ok) {
        setPushSubscribed(true);
      } else if (
        result.code === "permission_denied" ||
        result.code === "permission_default" ||
        result.code === "unsupported"
      ) {
        saveDecision("declined");
        setDecision("declined");
      } else {
        // The user already chose Yes. Keep that choice and silently repair the
        // customer-app registration on a later launch if the server was temporary unavailable.
        console.warn(messageForActivation(result.code));
      }
    } catch {
      // Preserve the user's Yes choice. A later app launch retries silently.
    } finally {
      goHome();
    }
  };

  const handleNotificationNo = () => {
    saveDecision("declined");
    setDecision("declined");
    goHome();
  };

  const handleDisable = async () => {
    setPushBusy(true);
    setMessage("");
    try {
      const ok = await disableGeneralPush();
      if (!ok) throw new Error("unsubscribe_failed");
      saveDecision("declined");
      setDecision("declined");
      setPushSubscribed(false);
      setMessageTone("ok");
      setMessage("Benachrichtigungen wurden deaktiviert.");
    } catch {
      setMessageTone("error");
      setMessage("Benachrichtigungen konnten nicht deaktiviert werden.");
    } finally {
      setPushBusy(false);
    }
  };

  if (routingHome) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-black text-white">
        <div className="text-center">
          <div className="mx-auto h-10 w-10 animate-spin rounded-full border-4 border-white/20 border-t-emerald-400" />
          <p className="mt-4 text-sm font-semibold text-stone-300">
            Burger Brothers wird geöffnet …
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen overflow-hidden bg-black text-stone-100">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_top,rgba(16,185,129,0.16),transparent_35%),radial-gradient(circle_at_bottom_right,rgba(245,158,11,0.14),transparent_35%)]" />

      <section className="relative mx-auto flex min-h-screen max-w-5xl flex-col items-center px-5 py-10 text-center sm:justify-center">
        <div className="rounded-[2rem] border border-amber-300/20 bg-white/[0.06] p-3 shadow-2xl shadow-orange-950/40 backdrop-blur-xl">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/icon-kurier-512.png?v=6"
            alt="Burger Brothers"
            className="h-24 w-24 rounded-3xl object-cover"
          />
        </div>

        <p className="mt-5 rounded-full border border-amber-300/20 bg-amber-500/10 px-4 py-1.5 text-xs font-bold uppercase tracking-[0.28em] text-amber-200">
          Burger Brothers Berlin
        </p>

        <h1 className="mt-4 max-w-3xl text-4xl font-black tracking-tight text-white sm:text-6xl">
          {installationTitle}
        </h1>

        {!device.isStandalone ? (
          <>
            <p className="mt-5 max-w-2xl text-base leading-7 text-stone-300 sm:text-lg">
              Einmal auf dem Startbildschirm speichern. Danach öffnen und bestellen
              Sie wie mit einer normalen App.
            </p>

            <button
              type="button"
              onClick={handleInstall}
              disabled={installBusy}
              className="mt-8 w-full max-w-md rounded-2xl bg-gradient-to-r from-orange-400 to-amber-300 px-8 py-4 text-lg font-black text-black shadow-xl shadow-orange-950/40 transition hover:scale-[1.01] active:scale-95 disabled:opacity-60"
            >
              {installBusy
                ? "Bitte warten …"
                : device.isIOS
                  ? "iPhone-Anleitung anzeigen"
                  : "Burger Brothers installieren"}
            </button>

            {device.isIOS ? (
              <div
                ref={iosStepsRef}
                className="mt-10 w-full max-w-2xl rounded-[2rem] border border-emerald-300/20 bg-emerald-950/30 p-5 text-left shadow-2xl backdrop-blur"
              >
                <div className="text-center text-sm font-black uppercase tracking-[0.2em] text-emerald-300">
                  iPhone – nur 3 Schritte
                </div>
                <div className="mt-5 grid gap-3">
                  <div className="rounded-2xl bg-white/[0.06] p-4">
                    <b className="text-white">1. Mit Safari öffnen</b>
                    <p className="mt-1 text-sm text-stone-400">
                      Der QR-Code muss in Safari geöffnet sein.
                    </p>
                  </div>
                  <div className="rounded-2xl bg-white/[0.06] p-4">
                    <b className="text-white">2. Teilen-Symbol antippen</b>
                    <p className="mt-1 text-sm text-stone-400">
                      Tippen Sie unten auf das Quadrat mit dem Pfeil nach oben.
                    </p>
                    <div className="mt-3 text-center text-4xl motion-safe:animate-bounce">
                      ⇧
                    </div>
                  </div>
                  <div className="rounded-2xl bg-white/[0.06] p-4">
                    <b className="text-white">3. „Zum Home-Bildschirm“ wählen</b>
                    <p className="mt-1 text-sm text-stone-400">
                      Danach das Burger-Brothers-Symbol auf dem Startbildschirm öffnen.
                    </p>
                  </div>
                </div>
              </div>
            ) : null}

            {!device.isMobile && installUrl ? (
              <div className="mt-10 rounded-3xl border border-white/10 bg-white p-4">
                <QRCode value={installUrl} size={180} />
                <p className="mt-3 text-xs font-bold text-black">
                  Mit dem Handy scannen
                </p>
              </div>
            ) : null}
          </>
        ) : (
          <div className="mt-7 w-full max-w-md">
            <div className="rounded-[2rem] border border-white/10 bg-white/[0.06] p-6 shadow-2xl backdrop-blur sm:p-8">
              {settingsMode && decision === "accepted" && pushSubscribed ? (
                <>
                  <h2 className="text-2xl font-black text-white">
                    Benachrichtigungen sind aktiv
                  </h2>
                  <p className="mt-3 text-sm leading-6 text-stone-300">
                    Sie können diese Einstellung jederzeit wieder ändern.
                  </p>
                  <button
                    type="button"
                    onClick={() => void handleDisable()}
                    disabled={pushBusy}
                    className="mt-6 w-full rounded-2xl border border-white/15 bg-white/[0.08] px-6 py-4 text-base font-black text-white transition hover:bg-white/[0.14] disabled:opacity-60"
                  >
                    Benachrichtigungen deaktivieren
                  </button>
                  <button
                    type="button"
                    onClick={goHome}
                    className="mt-3 w-full rounded-2xl bg-emerald-400 px-6 py-4 text-base font-black text-black transition hover:bg-emerald-300"
                  >
                    Zur Startseite
                  </button>
                </>
              ) : (
                <>
                  <h2 className="text-3xl font-black text-white">
                    Benachrichtigungen aktivieren?
                  </h2>
                  <p className="mt-3 text-sm leading-6 text-stone-300">
                    Wir informieren Sie über Ihre Bestellung und Neuigkeiten von
                    Burger Brothers.
                  </p>

                  <div className="mt-7 grid grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() => void handleNotificationYes()}
                      disabled={pushBusy}
                      className="rounded-2xl bg-emerald-400 px-5 py-4 text-lg font-black text-black transition hover:bg-emerald-300 active:scale-[0.98] disabled:opacity-60"
                    >
                      {pushBusy ? "Bitte warten …" : "Ja"}
                    </button>
                    <button
                      type="button"
                      onClick={handleNotificationNo}
                      disabled={pushBusy}
                      className="rounded-2xl border border-white/15 bg-white/[0.08] px-5 py-4 text-lg font-black text-white transition hover:bg-white/[0.14] active:scale-[0.98] disabled:opacity-60"
                    >
                      Nein
                    </button>
                  </div>

                  <p className="mt-5 text-xs leading-5 text-stone-500">
                    Die Auswahl wird gespeichert und beim nächsten Öffnen nicht erneut
                    angezeigt.
                  </p>
                </>
              )}
            </div>
          </div>
        )}

        {message ? (
          <div
            className={[
              "mt-6 w-full max-w-2xl rounded-2xl border px-5 py-4 text-sm font-semibold",
              messageTone === "ok"
                ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-100"
                : messageTone === "error"
                  ? "border-red-400/30 bg-red-500/10 text-red-100"
                  : "border-amber-300/20 bg-amber-500/10 text-amber-100",
            ].join(" ")}
          >
            {message}
          </div>
        ) : null}
      </section>
    </main>
  );
}
