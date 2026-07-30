"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type ProblemKind =
  | "permission_denied"
  | "position_unavailable"
  | "timeout"
  | "unsupported"
  | "insecure_context"
  | "policy_blocked"
  | "accuracy_low"
  | "network"
  | "server"
  | null;

type EnterScreen = "status" | "choice" | "install";
type RetryMode = "qr" | "homescreen" | null;
type SessionRequestResult =
  | "done"
  | "location_required"
  | "invalid_qr"
  | "failed";

type GeoFailure = { code: number; message?: string };

type VerifyResponse = {
  ok?: boolean;
  error?: string;
  locationSkipped?: boolean;
  accuracy?: number;
  maxAccuracy?: number;
};

type SessionResponse = {
  ok?: boolean;
  enabled?: boolean;
  paused?: boolean;
  recheckRequired?: boolean;
  locationCheckEnabled?: boolean;
  iosHomeScreenFlowEnabled?: boolean;
  backgroundReadyPushEnabled?: boolean;
};

const TARGET_ACCURACY_METERS = 75;
const LOCATION_DEADLINE_MS = 18_000;
const IOS_INSTALL_MARKER = "bb_schnell_ios_home_screen_hint_v1";
let fallbackDeviceId = "";

function createFallbackDeviceId() {
  if (!fallbackDeviceId) {
    fallbackDeviceId = `ephemeral-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 14)}`;
  }
  return fallbackDeviceId;
}

function getDeviceId() {
  try {
    const key = "bb_schnell_device";
    const existing = window.localStorage.getItem(key);
    if (existing) return existing;

    const generated =
      typeof window.crypto?.randomUUID === "function"
        ? window.crypto.randomUUID()
        : createFallbackDeviceId();
    window.localStorage.setItem(key, generated);
    return generated;
  } catch {
    return createFallbackDeviceId();
  }
}

async function readGeolocationPermission() {
  if (!navigator.permissions?.query) return "unsupported" as const;
  try {
    const status = await navigator.permissions.query({
      name: "geolocation" as PermissionName,
    });
    return status.state;
  } catch {
    return "unsupported" as const;
  }
}

function geolocationAllowedByDocumentPolicy() {
  const documentWithPolicy = document as Document & {
    permissionsPolicy?: { allowsFeature(feature: string): boolean };
    featurePolicy?: { allowsFeature(feature: string): boolean };
  };

  try {
    const policy =
      documentWithPolicy.permissionsPolicy ?? documentWithPolicy.featurePolicy;
    return policy ? policy.allowsFeature("geolocation") : true;
  } catch {
    return true;
  }
}

function getBestPosition() {
  return new Promise<GeolocationPosition>((resolve, reject) => {
    let watchId: number | null = null;
    let timerId: number | null = null;
    let finished = false;
    let bestPosition: GeolocationPosition | null = null;

    const cleanup = () => {
      if (watchId !== null) navigator.geolocation.clearWatch(watchId);
      if (timerId !== null) window.clearTimeout(timerId);
    };

    const finishWithPosition = (position: GeolocationPosition) => {
      if (finished) return;
      finished = true;
      cleanup();
      resolve(position);
    };

    const finishWithError = (error: GeoFailure) => {
      if (finished) return;
      finished = true;
      cleanup();
      reject(error);
    };

    timerId = window.setTimeout(() => {
      if (bestPosition) finishWithPosition(bestPosition);
      else finishWithError({ code: 3, message: "location_timeout" });
    }, LOCATION_DEADLINE_MS);

    try {
      watchId = navigator.geolocation.watchPosition(
        (position) => {
          if (
            !bestPosition ||
            position.coords.accuracy < bestPosition.coords.accuracy
          ) {
            bestPosition = position;
          }
          if (position.coords.accuracy <= TARGET_ACCURACY_METERS) {
            finishWithPosition(position);
          }
        },
        (error) => {
          if (bestPosition && error.code === 3) finishWithPosition(bestPosition);
          else finishWithError({ code: error.code, message: error.message });
        },
        {
          enableHighAccuracy: true,
          maximumAge: 5_000,
          timeout: 15_000,
        },
      );
    } catch (error) {
      finishWithError({
        code: 2,
        message: error instanceof Error ? error.message : "location_failed",
      });
    }
  });
}

function isAppleMobileDevice() {
  const userAgent = navigator.userAgent || "";
  return (
    /iPhone|iPad|iPod/i.test(userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

function isStandaloneDisplayMode() {
  const appleNavigator = navigator as Navigator & { standalone?: boolean };
  return (
    window.matchMedia?.("(display-mode: standalone)").matches === true ||
    appleNavigator.standalone === true
  );
}

function readInstallMarker() {
  try {
    return window.localStorage.getItem(IOS_INSTALL_MARKER) === "1";
  } catch {
    return false;
  }
}

function writeInstallMarker() {
  try {
    window.localStorage.setItem(IOS_INSTALL_MARKER, "1");
  } catch {
    // The instruction flow still works when localStorage is unavailable.
  }
}

function installManifestForToken(token: string) {
  const href = token
    ? `/api/schnellbestellung/manifest?t=${encodeURIComponent(token)}&v=1`
    : "/manifest-schnellbestellung.webmanifest?v=1";
  const links = Array.from(
    document.querySelectorAll<HTMLLinkElement>('link[rel="manifest"]'),
  );

  if (links.length === 0) {
    const link = document.createElement("link");
    link.rel = "manifest";
    link.href = href;
    document.head.appendChild(link);
    return;
  }

  links[0].href = href;
  links.slice(1).forEach((link) => link.remove());
}

async function loadSessionInfo() {
  try {
    const response = await fetch("/api/schnellbestellung/session", {
      credentials: "same-origin",
      cache: "no-store",
    });
    return (await response.json().catch(() => ({}))) as SessionResponse;
  } catch {
    return null;
  }
}

export default function SchnellEnterClient({ token }: { token: string }) {
  const router = useRouter();

  const startedRef = useRef(false);
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState("Menü wird geöffnet …");
  const [problem, setProblem] = useState<ProblemKind>(null);
  const [screen, setScreen] = useState<EnterScreen>("status");
  const [retryMode, setRetryMode] = useState<RetryMode>(null);
  const [appleMobile, setAppleMobile] = useState(false);
  const [standalone, setStandalone] = useState(false);
  const [installedHint, setInstalledHint] = useState(false);

  const setBusyState = useCallback((value: boolean) => {
    busyRef.current = value;
    setBusy(value);
  }, []);

  const requestSession = useCallback(
    async (
      location?: GeolocationPosition,
      options: { homeScreen?: boolean; navigate?: boolean } = {},
    ) => {
      const controller = new AbortController();
      const timeoutId = window.setTimeout(() => controller.abort(), 15_000);

      try {
        const response = await fetch("/api/schnellbestellung/location/verify", {
          method: "POST",
          headers: { "content-type": "application/json" },
          credentials: "same-origin",
          cache: "no-store",
          signal: controller.signal,
          body: JSON.stringify({
            token,
            deviceId: getDeviceId(),
            homeScreen: options.homeScreen === true,
            ...(location
              ? {
                  lat: location.coords.latitude,
                  lng: location.coords.longitude,
                  accuracy: location.coords.accuracy,
                }
              : {}),
          }),
        });
        const data = (await response.json().catch(() => ({}))) as VerifyResponse;

        if (response.ok && data.ok) {
          if (options.navigate !== false) {
            router.replace("/schnellbestellung");
          }
          return "done" as const;
        }

        if (data.error === "location_required") {
          return "location_required" as const;
        }

        setBusyState(false);
        setProblem("server");

        if (data.error === "accuracy_too_low") {
          setProblem("accuracy_low");
          setMessage(
            `Ihr Standort ist noch zu ungenau (±${Math.round(
              Number(data.accuracy || 0),
            )} m). Bitte aktivieren Sie „Genauer Standort“ und versuchen Sie es erneut.`,
          );
        } else if (data.error === "outside_radius") {
          setMessage("Schnellbestellungen sind nur direkt im Restaurant möglich.");
        } else if (data.error === "invalid_qr") {
          setMessage(
            options.homeScreen
              ? "Bitte scannen Sie den aktuellen QR-Code im Restaurant erneut."
              : "Der QR-Code ist ungültig. Bitte scannen Sie den aktuellen QR-Code erneut.",
          );
          return "invalid_qr" as const;
        } else if (data.error === "unavailable") {
          setMessage("Die Schnellbestellung ist momentan nicht verfügbar.");
        } else {
          setMessage("Die Schnellbestellung konnte nicht geöffnet werden.");
        }

        return "failed" as const;
      } catch (error) {
        setBusyState(false);
        setProblem("network");
        setMessage(
          error instanceof DOMException && error.name === "AbortError"
            ? "Die Verbindung dauert zu lange. Bitte versuchen Sie es erneut."
            : "Die Verbindung zum Bestellsystem ist fehlgeschlagen.",
        );
        return "failed" as const;
      } finally {
        window.clearTimeout(timeoutId);
      }
    },
    [router, setBusyState, token],
  );

  const start = useCallback(
    async (options: { homeScreen?: boolean; navigate?: boolean } = {}) => {
      if (busyRef.current) return "failed" as const;
      if (!token && options.homeScreen !== true) {
        setBusyState(false);
        setProblem("server");
        setRetryMode(null);
        setMessage(
          "Ungültiger QR-Code. Bitte scannen Sie den aktuellen QR-Code erneut.",
        );
        return "invalid_qr" as const;
      }

      setScreen("status");
      setBusyState(true);
      setProblem(null);
      setRetryMode(options.homeScreen ? "homescreen" : "qr");
      setMessage("Menü wird geöffnet …");

      const directResult = await requestSession(undefined, options);
      if (directResult === "done") {
        if (options.navigate === false) setBusyState(false);
        return directResult;
      }
      if (directResult !== "location_required") return directResult;

      setMessage("Standort wird geprüft …");

      if (!window.isSecureContext) {
        setBusyState(false);
        setProblem("insecure_context");
        setMessage("Der Standortzugriff ist nur über HTTPS möglich.");
        return "failed" as const;
      }
      if (!("geolocation" in navigator)) {
        setBusyState(false);
        setProblem("unsupported");
        setMessage("Dieser Browser unterstützt keine Standortbestimmung.");
        return "failed" as const;
      }
      if (!geolocationAllowedByDocumentPolicy()) {
        setBusyState(false);
        setProblem("policy_blocked");
        setMessage("Der Browser blockiert den Standortzugriff auf dieser Seite.");
        return "failed" as const;
      }

      const permission = await readGeolocationPermission();
      if (permission === "denied") {
        setBusyState(false);
        setProblem("permission_denied");
        setMessage("Der Standortzugriff ist für diese Website blockiert.");
        return "failed" as const;
      }

      try {
        const position = await getBestPosition();
        setMessage("Menü wird geöffnet …");
        const result = await requestSession(position, options);
        if (result === "done" && options.navigate === false) {
          setBusyState(false);
        }
        return result;
      } catch (error) {
        const failure = error as GeoFailure;
        setBusyState(false);
        if (failure.code === 1) {
          setProblem("permission_denied");
          setMessage("Der Standortzugriff ist für diese Website blockiert.");
        } else if (failure.code === 3) {
          setProblem("timeout");
          setMessage(
            "Die Standortbestimmung dauert zu lange. Bitte versuchen Sie es erneut.",
          );
        } else {
          setProblem("position_unavailable");
          setMessage("Ihr Standort konnte momentan nicht bestimmt werden.");
        }
        return "failed" as const;
      }
    },
    [requestSession, setBusyState, token],
  );

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    let cancelled = false;

    const initialize = async () => {
      const isApple = isAppleMobileDevice();
      const isStandalone = isStandaloneDisplayMode();
      const marker = readInstallMarker();

      if (cancelled) return;
      setAppleMobile(isApple);
      setStandalone(isStandalone);
      setInstalledHint(marker);
      installManifestForToken(token);

      const session = await loadSessionInfo();
      if (cancelled) return;

      // Home Screen mode is a separate iOS web-app context. Reuse a valid
      // session, otherwise re-prove restaurant presence by GPS. When GPS is
      // disabled, the signed QR token embedded in the dynamic manifest remains
      // mandatory.
      if (isApple && isStandalone) {
        if (session?.ok && !session.recheckRequired) {
          router.replace("/schnellbestellung");
          return;
        }

        busyRef.current = false;
        if (
          session?.iosHomeScreenFlowEnabled &&
          session.locationCheckEnabled
        ) {
          await start({ homeScreen: true, navigate: true });
          return;
        }

        if (token) {
          await start({ navigate: true });
          return;
        }

        setBusyState(false);
        setProblem("server");
        setRetryMode(null);
        setMessage(
          "Bitte scannen Sie den QR-Code im Restaurant erneut. Öffnen Sie danach Burger Brothers über das Symbol auf Ihrem Home-Bildschirm.",
        );
        return;
      }

      // Only iPhone/iPad receives the optional setup choice. Android and every
      // other browser keep the original automatic QR flow unchanged.
      if (isApple && session?.iosHomeScreenFlowEnabled) {
        if (!token) {
          setBusyState(false);
          setProblem("server");
          setMessage(
            "Ungültiger QR-Code. Bitte scannen Sie den aktuellen QR-Code erneut.",
          );
          return;
        }

        setScreen("choice");
        setBusyState(false);
        setProblem(null);
        setRetryMode(null);
        setMessage("");
        return;
      }

      busyRef.current = false;
      await start({ navigate: true });
    };

    void initialize();
    return () => {
      cancelled = true;
    };
  }, [router, setBusyState, start, token]);

  const prepareIosInstall = useCallback(async () => {
    if (!token || busyRef.current) return;

    installManifestForToken(token);
    const result = await start({ navigate: false });
    if (result !== "done") return;

    writeInstallMarker();
    setInstalledHint(true);
    setProblem(null);
    setRetryMode(null);
    setMessage("");
    setScreen("install");
    setBusyState(false);
  }, [setBusyState, start, token]);

  const retry = useCallback(() => {
    if (retryMode === "homescreen") {
      void start({ homeScreen: true, navigate: true });
      return;
    }
    if (retryMode === "qr") {
      void start({ navigate: true });
    }
  }, [retryMode, start]);

  const showInstructions =
    problem === "permission_denied" ||
    problem === "position_unavailable" ||
    problem === "timeout" ||
    problem === "accuracy_low";

  if (screen === "choice") {
    return (
      <main className="grid min-h-dvh place-items-center bg-stone-950 p-5 text-white">
        <section className="w-full max-w-md rounded-3xl border border-white/10 bg-white/5 p-6 shadow-2xl shadow-black/30">
          <div className="text-center">
            <img
              src="/schnell-icon-180.png?v=1"
              className="mx-auto h-24 w-24 rounded-[24px]"
              alt="Burger Brothers"
            />
            <h1 className="mt-5 text-3xl font-black">Schnellbestellung</h1>
            <p className="mt-2 text-stone-300">
              Wie möchten Sie auf Ihrem iPhone bestellen?
            </p>
          </div>

          {installedHint ? (
            <div className="mt-6 rounded-2xl border border-emerald-400/30 bg-emerald-400/10 p-4 text-sm leading-6 text-emerald-100">
              <strong className="block">Burger Brothers bereits eingerichtet?</strong>
              Schließen Sie den Browser und öffnen Sie das Burger-Brothers-Symbol
              auf Ihrem Home-Bildschirm. Die aktuelle QR-Berechtigung wird beim
              Öffnen geprüft.
            </div>
          ) : null}

          <button
            type="button"
            onClick={() => void start({ navigate: true })}
            className="mt-6 w-full rounded-2xl bg-amber-400 px-5 py-4 text-left text-black shadow-lg shadow-amber-500/10"
          >
            <span className="block text-xl font-black">Direkt bestellen</span>
            <span className="mt-1 block text-sm font-semibold text-black/70">
              Ohne Installation direkt im Browser fortfahren.
            </span>
          </button>

          <button
            type="button"
            onClick={() => void prepareIosInstall()}
            className="mt-3 w-full rounded-2xl border border-emerald-300/40 bg-emerald-400/10 px-5 py-4 text-left text-emerald-50"
          >
            <span className="block text-xl font-black">
              Fertig-Benachrichtigung aktivieren
            </span>
            <span className="mt-1 block text-sm text-emerald-100/80">
              Kostenlos · auch bei gesperrtem Bildschirm · keine App-Store-App
            </span>
          </button>

          <p className="mt-5 text-center text-xs leading-5 text-stone-500">
            Die Einrichtung wird nur auf iPhone und iPad angezeigt. Sie können
            jederzeit ohne Einrichtung direkt bestellen.
          </p>
        </section>
      </main>
    );
  }

  if (screen === "install") {
    return (
      <main className="grid min-h-dvh place-items-center bg-stone-950 p-5 text-white">
        <section className="w-full max-w-md rounded-3xl border border-emerald-300/30 bg-white/5 p-6 shadow-2xl shadow-black/30">
          <div className="text-center">
            <img
              src="/schnell-icon-180.png?v=1"
              className="mx-auto h-24 w-24 rounded-[24px]"
              alt="Burger Brothers"
            />
            <p className="mt-5 text-sm font-black uppercase tracking-[0.2em] text-emerald-300">
              Kostenlos aktivieren
            </p>
            <h1 className="mt-2 text-3xl font-black">Zum Home-Bildschirm</h1>
            <p className="mt-3 text-stone-300">
              Danach kann Burger Brothers Ihnen die Fertig-Meldung auch bei
              gesperrtem Bildschirm anzeigen.
            </p>
          </div>

          <ol className="mt-7 space-y-3 text-left">
            {[
              ["1", "Tippen Sie im Browser auf das Teilen-Symbol □↑."],
              ["2", "Wählen Sie „Zum Home-Bildschirm“ aus."],
              ["3", "Tippen Sie oben rechts auf „Hinzufügen“."],
              ["4", "Schließen Sie den Browser und öffnen Sie Burger Brothers auf dem Home-Bildschirm."],
            ].map(([number, text]) => (
              <li
                key={number}
                className="flex gap-3 rounded-2xl border border-white/10 bg-black/20 p-4"
              >
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-amber-400 font-black text-black">
                  {number}
                </span>
                <span className="pt-1 text-sm leading-6 text-stone-200">
                  {text}
                </span>
              </li>
            ))}
          </ol>

          <div className="mt-6 rounded-2xl border border-amber-300/25 bg-amber-300/10 p-4 text-sm leading-6 text-amber-100">
            Öffnen Sie die Bestellung anschließend unbedingt über das neue
            Burger-Brothers-Symbol. Die Benachrichtigungsfrage erscheint beim
            Abschicken der Bestellung.
          </div>

          <button
            type="button"
            onClick={() => router.replace("/schnellbestellung")}
            className="mt-5 w-full rounded-2xl bg-white/10 px-5 py-4 font-black text-white"
          >
            Doch direkt im Browser bestellen
          </button>
        </section>
      </main>
    );
  }

  return (
    <main className="grid min-h-dvh place-items-center bg-stone-950 p-6 text-white">
      <section className="w-full max-w-md rounded-3xl border border-white/10 bg-white/5 p-7 text-center shadow-2xl shadow-black/30">
        <img
          src={appleMobile ? "/schnell-icon-180.png?v=1" : "/logo-burger-brothers.png"}
          className={
            appleMobile
              ? "mx-auto h-24 w-24 rounded-[24px]"
              : "mx-auto h-24 w-24 rounded-full"
          }
          alt="Burger Brothers"
        />
        <h1 className="mt-5 text-3xl font-black">Schnellbestellung</h1>

        {busy ? (
          <div className="mx-auto mt-6 h-10 w-10 animate-spin rounded-full border-4 border-white/15 border-t-amber-400" />
        ) : null}

        <p className="mt-4 text-stone-300" aria-live="polite">
          {message}
        </p>

        {showInstructions ? (
          <div className="mt-5 rounded-2xl border border-amber-300/25 bg-amber-300/10 p-4 text-left text-sm leading-6 text-stone-200">
            <p className="font-bold text-amber-200">Standort erlauben</p>
            <p className="mt-2">
              {appleMobile
                ? "Öffnen Sie die Website-Einstellungen und stellen Sie „Standort“ auf „Fragen“ oder „Erlauben“."
                : "Öffnen Sie die Website-Berechtigungen und erlauben Sie den Standortzugriff."}
            </p>
          </div>
        ) : null}

        {standalone && !busy && !retryMode ? (
          <div className="mt-5 rounded-2xl border border-white/10 bg-black/20 p-4 text-left text-sm leading-6 text-stone-300">
            Der Home-Bildschirm kann einen abgelaufenen QR nicht automatisch
            erneuern. Scannen Sie den QR im Restaurant erneut und öffnen Sie
            danach Burger Brothers über das Home-Bildschirm-Symbol.
          </div>
        ) : null}

        {!busy && retryMode ? (
          <button
            type="button"
            onClick={retry}
            className="mt-7 w-full rounded-2xl bg-amber-400 px-5 py-4 text-lg font-black text-black"
          >
            Erneut versuchen
          </button>
        ) : null}
      </section>
    </main>
  );
}
