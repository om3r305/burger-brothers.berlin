"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import QRCode from "react-qr-code";
import {
  activateGeneralPushFromGesture,
  disableGeneralPush,
  isIOSDevice,
  isStandaloneApp,
  loadGeneralPushState,
  updateGeneralPushPreferences,
  type GeneralPushPreferences,
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

const INSTALL_ONBOARDING_KEY = "bb_general_install_done_v1";

const DEFAULT_PREFERENCES: GeneralPushPreferences = {
  orderUpdates: true,
  campaigns: false,
  coupons: false,
  nearbyDelivery: false,
  nearbyRadiusM: 800,
  nearbyCooldownDays: 7,
};

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

function messageForActivation(code: string) {
  switch (code) {
    case "ios_home_screen_required":
      return "Bitte zuerst über Safari zum Home-Bildschirm hinzufügen und Burger Brothers danach über das neue Symbol öffnen.";
    case "permission_denied":
      return "Benachrichtigungen wurden blockiert. Bitte in den iPhone-/Android-Einstellungen für Burger Brothers erlauben.";
    case "not_configured":
      return "Der Benachrichtigungsdienst ist auf dem Server noch nicht vollständig eingerichtet.";
    case "disabled":
      return "Benachrichtigungen sind zurzeit deaktiviert.";
    case "unsupported":
      return "Dieser Browser unterstützt keine App-Benachrichtigungen.";
    case "service_worker_failed":
      return "Die App-Komponente konnte nicht gestartet werden. Bitte die App schließen und erneut öffnen.";
    case "subscription_failed":
      return "Die Geräteanmeldung ist fehlgeschlagen. Bitte erneut versuchen.";
    default:
      return "Benachrichtigungen konnten nicht aktiviert werden. Bitte erneut versuchen.";
  }
}

function ToggleRow({
  checked,
  onChange,
  title,
  description,
  locked,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  title: string;
  description: string;
  locked?: boolean;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-4 rounded-2xl border border-white/10 bg-white/[0.055] p-4 text-left transition hover:bg-white/[0.08]">
      <input
        type="checkbox"
        checked={checked}
        disabled={locked}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-1 h-5 w-5 accent-emerald-400"
      />
      <span>
        <span className="block font-black text-white">{title}</span>
        <span className="mt-1 block text-sm leading-6 text-stone-400">
          {description}
        </span>
      </span>
    </label>
  );
}

export default function InstallPage() {
  const [device, setDevice] = useState<DeviceState>(() => detectDevice());
  const [installPrompt, setInstallPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [installBusy, setInstallBusy] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  const [locationBusy, setLocationBusy] = useState(false);
  const [pushSubscribed, setPushSubscribed] = useState(false);
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<"ok" | "error" | "info">(
    "info",
  );
  const [installUrl, setInstallUrl] = useState("");
  const [preferences, setPreferences] =
    useState<GeneralPushPreferences>(DEFAULT_PREFERENCES);
  const iosStepsRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const currentDevice = detectDevice();
    setDevice(currentDevice);
    setInstallUrl(`${window.location.origin}/install`);

    if (currentDevice.isStandalone) {
      const settingsMode =
        new URLSearchParams(window.location.search).get("settings") === "1";
      let onboardingDone = false;
      try {
        onboardingDone = localStorage.getItem(INSTALL_ONBOARDING_KEY) === "1";
      } catch {}

      if (onboardingDone && !settingsMode) {
        window.location.replace("/menu");
        return;
      }
    }

    if ("serviceWorker" in navigator) {
      void navigator.serviceWorker
        .register("/sw.js", { scope: "/" })
        .catch(() => undefined);
    }

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
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  useEffect(() => {
    if (!device.isStandalone) return;

    void loadGeneralPushState()
      .then((state) => {
        setPushSubscribed(state.subscribed === true);
        if (state.preferences) {
          setPreferences({
            ...DEFAULT_PREFERENCES,
            ...state.preferences,
          });
        }
      })
      .catch(() => undefined);
  }, [device.isStandalone]);

  const installationTitle = useMemo(() => {
    if (device.isStandalone) return "Burger Brothers App";
    if (device.isIOS) return "Auf dem iPhone speichern";
    if (device.isAndroid) return "Auf Android installieren";
    return "Burger Brothers installieren";
  }, [device]);

  const markOnboardingDone = () => {
    try {
      localStorage.setItem(INSTALL_ONBOARDING_KEY, "1");
    } catch {}
  };

  const updatePreference = (
    key: keyof GeneralPushPreferences,
    value: boolean,
  ) => {
    setPreferences((current) => ({ ...current, [key]: value }));
  };

  const captureLocation = () => {
    if (!("geolocation" in navigator)) {
      setMessageTone("error");
      setMessage("Standortbestimmung wird von diesem Gerät nicht unterstützt.");
      return;
    }

    setLocationBusy(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setPreferences((current) => ({
          ...current,
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        }));
        setMessageTone("ok");
        setMessage("Standort wurde nur für die freiwillige Nähe-Funktion gespeichert.");
        setLocationBusy(false);
      },
      () => {
        setMessageTone("error");
        setMessage("Standort konnte nicht übernommen werden. PLZ und Straße können Sie auch manuell eintragen.");
        setLocationBusy(false);
      },
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 15 * 60_000 },
    );
  };

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

  const handlePush = async () => {
    setPushBusy(true);
    setMessage("");

    try {
      const result = await activateGeneralPushFromGesture(preferences);
      if (!result.ok) {
        setMessageTone("error");
        setMessage(messageForActivation(result.code));
        return;
      }

      setPushSubscribed(true);
      markOnboardingDone();
      setMessageTone("ok");
      setMessage(
        "Benachrichtigungen sind aktiviert. Bestellstatus, Angebote und Gutscheine werden entsprechend Ihrer Auswahl angezeigt.",
      );
    } catch {
      setMessageTone("error");
      setMessage(
        "Benachrichtigungen konnten nicht aktiviert werden. Bitte Verbindung prüfen und erneut versuchen.",
      );
    } finally {
      setPushBusy(false);
    }
  };

  const savePreferences = async () => {
    setPushBusy(true);
    setMessage("");
    try {
      await updateGeneralPushPreferences(preferences);
      setMessageTone("ok");
      setMessage("Ihre Benachrichtigungseinstellungen wurden gespeichert.");
    } catch {
      setMessageTone("error");
      setMessage("Einstellungen konnten nicht gespeichert werden. Bitte erneut versuchen.");
    } finally {
      setPushBusy(false);
    }
  };

  const disablePush = async () => {
    setPushBusy(true);
    setMessage("");
    try {
      const ok = await disableGeneralPush();
      if (!ok) throw new Error("unsubscribe_failed");
      setPushSubscribed(false);
      setMessageTone("ok");
      setMessage("Benachrichtigungen wurden für dieses Gerät deaktiviert.");
    } catch {
      setMessageTone("error");
      setMessage("Benachrichtigungen konnten nicht deaktiviert werden. Bitte erneut versuchen.");
    } finally {
      setPushBusy(false);
    }
  };

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
              Einmal auf dem Startbildschirm speichern. Danach bestellen Sie
              wie mit einer normalen App und erhalten auf Wunsch Bestellstatus,
              Angebote und persönliche Gutscheine.
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
          <div className="mt-7 w-full max-w-2xl">
            <div className="rounded-[2rem] border border-emerald-300/20 bg-emerald-950/25 p-5 shadow-2xl backdrop-blur sm:p-7">
              <div className="text-sm font-black uppercase tracking-[0.2em] text-emerald-300">
                App erfolgreich geöffnet
              </div>
              <h2 className="mt-3 text-3xl font-black text-white">
                Benachrichtigungen auswählen
              </h2>
              <p className="mt-3 text-sm leading-6 text-stone-300">
                Bestellmeldungen sind praktisch. Angebote, Gutscheine und
                Lieferungen in Ihrer Nähe sind freiwillig und können jederzeit
                geändert werden.
              </p>

              <div className="mt-6 grid gap-3">
                <ToggleRow
                  checked={preferences.orderUpdates}
                  onChange={(value) => updatePreference("orderUpdates", value)}
                  title="Bestellstatus"
                  description="Eingegangen, in Vorbereitung, abholbereit, unterwegs, geliefert oder storniert."
                />
                <ToggleRow
                  checked={preferences.campaigns}
                  onChange={(value) => updatePreference("campaigns", value)}
                  title="Angebote & Kampagnen"
                  description="Zum Beispiel Vegane Woche, Tagesangebote und besondere Aktionen."
                />
                <ToggleRow
                  checked={preferences.coupons}
                  onChange={(value) => updatePreference("coupons", value)}
                  title="Persönliche Gutscheine"
                  description="Eine Meldung, sobald ein neuer Gutschein für Sie freigeschaltet wurde."
                />
                <ToggleRow
                  checked={preferences.nearbyDelivery}
                  onChange={(value) => updatePreference("nearbyDelivery", value)}
                  title="Lieferung in Ihrer Nähe"
                  description="Eine diskrete Meldung, wenn wir gerade in Ihrer Umgebung liefern. Keine Kundendaten werden angezeigt."
                />

                {preferences.nearbyDelivery ? (
                  <div className="rounded-2xl border border-amber-300/20 bg-amber-500/[0.06] p-4 text-left">
                    <div className="font-black text-white">Ihre Umgebung festlegen</div>
                    <p className="mt-1 text-sm leading-6 text-stone-400">
                      PLZ und Straße oder der Gerätestandort verbessern die Zuordnung. Diese Angaben erscheinen niemals in einer Benachrichtigung.
                    </p>
                    <div className="mt-4 grid gap-3 sm:grid-cols-[140px_1fr]">
                      <input
                        value={preferences.plz || ""}
                        onChange={(event) =>
                          setPreferences((current) => ({
                            ...current,
                            plz: event.target.value.replace(/\D/g, "").slice(0, 5),
                          }))
                        }
                        inputMode="numeric"
                        placeholder="PLZ"
                        className="rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-white outline-none"
                      />
                      <input
                        value={preferences.street || ""}
                        onChange={(event) =>
                          setPreferences((current) => ({
                            ...current,
                            street: event.target.value,
                          }))
                        }
                        placeholder="Straße (ohne Hausnummer ausreichend)"
                        className="rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-white outline-none"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={captureLocation}
                      disabled={locationBusy}
                      className="mt-3 rounded-xl border border-white/15 bg-white/[0.07] px-4 py-3 text-sm font-black text-white disabled:opacity-60"
                    >
                      {locationBusy
                        ? "Standort wird gelesen …"
                        : preferences.lat != null && preferences.lng != null
                          ? "Standort aktualisieren ✓"
                          : "Gerätestandort verwenden"}
                    </button>
                  </div>
                ) : null}
              </div>

              <button
                type="button"
                onClick={pushSubscribed ? savePreferences : handlePush}
                disabled={pushBusy}
                className="mt-6 w-full rounded-2xl bg-emerald-400 px-6 py-4 text-lg font-black text-black transition hover:bg-emerald-300 active:scale-[0.98] disabled:opacity-60"
              >
                {pushBusy
                  ? "Bitte warten …"
                  : pushSubscribed
                    ? "Einstellungen speichern"
                    : "Benachrichtigungen aktivieren"}
              </button>

              <Link
                href="/menu"
                onClick={markOnboardingDone}
                className="mt-3 block w-full rounded-2xl border border-white/15 bg-white/[0.07] px-6 py-4 text-lg font-black text-white transition hover:bg-white/[0.12] active:scale-[0.98]"
              >
                Menü öffnen
              </Link>

              {pushSubscribed ? (
                <button
                  type="button"
                  onClick={() => void disablePush()}
                  disabled={pushBusy}
                  className="mt-3 w-full rounded-2xl px-6 py-3 text-sm font-bold text-stone-400 transition hover:bg-white/[0.05] hover:text-white disabled:opacity-60"
                >
                  Allgemeine App-Benachrichtigungen deaktivieren
                </button>
              ) : null}

              <p className="mt-5 text-xs leading-5 text-stone-500">
                Marketing-Benachrichtigungen werden nur entsprechend Ihrer
                Auswahl gesendet. Ihre Zustimmung kann hier jederzeit geändert
                werden.
              </p>
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
