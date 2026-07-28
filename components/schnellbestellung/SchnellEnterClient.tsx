"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import SchnellQrScanner from "@/components/schnellbestellung/SchnellQrScanner";
import { prefetchSchnellCatalog } from "@/lib/client/schnell-catalog";
import {
  clearSchnellActiveOrder,
  readSchnellActiveOrder,
} from "@/lib/client/schnell-active-order";
import {
  activateSchnellPushFromGesture,
  prewarmSchnellPush,
  type SchnellPushActivationResult,
} from "@/lib/client/schnell-push";

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

type EnterScreen = "status" | "choice" | "install" | "scanner" | "push";
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

type ActiveStatusResponse = {
  ok?: boolean;
  status?: string;
  customerNumber?: number;
};

type StartOptions = {
  homeScreen?: boolean;
  navigate?: boolean;
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

function installSchnellManifest() {
  const href = "/api/schnellbestellung/manifest?v=2";
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
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), 8_000);

  try {
    const response = await fetch("/api/schnellbestellung/session", {
      credentials: "same-origin",
      cache: "no-store",
      signal: controller.signal,
    });
    return (await response.json().catch(() => ({}))) as SessionResponse;
  } catch {
    return null;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

async function resumeActiveOrder(router: ReturnType<typeof useRouter>) {
  const active = readSchnellActiveOrder();
  if (!active) return false;

  try {
    const response = await fetch(
      `/api/schnellbestellung/status?order=${encodeURIComponent(active.orderId)}`,
      { credentials: "same-origin", cache: "no-store" },
    );
    const data = (await response.json().catch(() => ({}))) as ActiveStatusResponse;

    if (response.ok && data.ok) {
      const number = Math.max(
        0,
        Math.trunc(Number(data.customerNumber) || active.customerNumber || 0),
      );
      router.replace(
        `/schnellbestellung/success?number=${encodeURIComponent(number || "–")}&order=${encodeURIComponent(active.orderId)}`,
      );
      return true;
    }

    if ([401, 403, 404].includes(response.status)) {
      clearSchnellActiveOrder(active.orderId);
    }
  } catch {
    // A temporary network failure must not block the QR scanner forever.
  }

  return false;
}

export default function SchnellEnterClient({ token }: { token: string }) {
  const router = useRouter();

  const startedRef = useRef(false);
  const busyRef = useRef(false);
  const retryTokenRef = useRef("");
  const retryOptionsRef = useRef<StartOptions>({});

  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState("Schnellbestellung wird vorbereitet …");
  const [problem, setProblem] = useState<ProblemKind>(null);
  const [screen, setScreen] = useState<EnterScreen>("status");
  const [canRetry, setCanRetry] = useState(false);
  const [appleMobile, setAppleMobile] = useState(false);
  const [standalone, setStandalone] = useState(false);
  const [installedHint, setInstalledHint] = useState(false);
  const [scannerError, setScannerError] = useState("");
  const [backgroundPushEnabled, setBackgroundPushEnabled] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  const [pushResult, setPushResult] =
    useState<SchnellPushActivationResult | null>(null);

  const setBusyState = useCallback((value: boolean) => {
    busyRef.current = value;
    setBusy(value);
  }, []);

  const requestSession = useCallback(
    async (
      accessToken: string,
      location?: GeolocationPosition,
      options: StartOptions = {},
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
            token: accessToken,
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
          // Session cookie is available as soon as fetch resolves. Start the
          // catalog request before navigation so the menu can reuse the same
          // in-flight request instead of waiting for a second round trip.
          router.prefetch("/schnellbestellung");
          prefetchSchnellCatalog();

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
            "Der QR-Code ist ungültig oder abgelaufen. Bitte scannen Sie den aktuellen QR-Code im Restaurant.",
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
    [router, setBusyState],
  );

  const start = useCallback(
    async (accessToken: string, options: StartOptions = {}) => {
      const cleanToken = String(accessToken || "").trim();
      if (busyRef.current) return "failed" as const;

      if (!cleanToken) {
        setBusyState(false);
        setProblem("server");
        setCanRetry(false);
        setMessage(
          "Ungültiger QR-Code. Bitte scannen Sie den aktuellen QR-Code im Restaurant.",
        );
        return "invalid_qr" as const;
      }

      retryTokenRef.current = cleanToken;
      retryOptionsRef.current = options;
      setScreen("status");
      setBusyState(true);
      setProblem(null);
      setCanRetry(false);
      setMessage("QR-Code wird geprüft …");

      const directResult = await requestSession(cleanToken, undefined, options);
      if (directResult === "done") {
        if (options.navigate === false) setBusyState(false);
        return directResult;
      }
      if (directResult !== "location_required") {
        setCanRetry(directResult !== "invalid_qr");
        return directResult;
      }

      setMessage("Standort wird geprüft …");

      if (!window.isSecureContext) {
        setBusyState(false);
        setProblem("insecure_context");
        setMessage("Der Standortzugriff ist nur über HTTPS möglich.");
        setCanRetry(false);
        return "failed" as const;
      }
      if (!("geolocation" in navigator)) {
        setBusyState(false);
        setProblem("unsupported");
        setMessage("Dieser Browser unterstützt keine Standortbestimmung.");
        setCanRetry(false);
        return "failed" as const;
      }
      if (!geolocationAllowedByDocumentPolicy()) {
        setBusyState(false);
        setProblem("policy_blocked");
        setMessage("Der Browser blockiert den Standortzugriff auf dieser Seite.");
        setCanRetry(false);
        return "failed" as const;
      }

      const permission = await readGeolocationPermission();
      if (permission === "denied") {
        setBusyState(false);
        setProblem("permission_denied");
        setMessage("Der Standortzugriff ist für Burger Brothers blockiert.");
        setCanRetry(true);
        return "failed" as const;
      }

      try {
        const position = await getBestPosition();
        setMessage("Menü wird geöffnet …");
        const result = await requestSession(cleanToken, position, options);
        if (result === "done" && options.navigate === false) {
          setBusyState(false);
        }
        if (result !== "done") setCanRetry(result !== "invalid_qr");
        return result;
      } catch (error) {
        const failure = error as GeoFailure;
        setBusyState(false);
        setCanRetry(true);
        if (failure.code === 1) {
          setProblem("permission_denied");
          setMessage("Der Standortzugriff ist für Burger Brothers blockiert.");
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
    [requestSession, setBusyState],
  );

  const showStandalonePushStep = useCallback(
    (pushEnabled: boolean | undefined) => {
      if (!pushEnabled) {
        router.replace("/schnellbestellung");
        return;
      }

      prewarmSchnellPush();

      if (
        typeof Notification !== "undefined" &&
        Notification.permission === "granted"
      ) {
        router.replace("/schnellbestellung");
        return;
      }

      setProblem(null);
      setCanRetry(false);
      setMessage("");
      setBusyState(false);
      setScreen("push");
    },
    [router, setBusyState],
  );

  const handleScannedToken = useCallback(
    async (scannedToken: string) => {
      setScannerError("");
      busyRef.current = false;
      const result = await start(scannedToken, {
        homeScreen: true,
        navigate: false,
      });

      if (result === "done") {
        showStandalonePushStep(backgroundPushEnabled);
        return;
      }

      if (result === "invalid_qr") {
        setScannerError(
          "Der QR-Code ist ungültig oder abgelaufen. Bitte scannen Sie den aktuellen QR-Code im Restaurant.",
        );
        setScreen("scanner");
        setBusyState(false);
      }
    }, [backgroundPushEnabled, setBusyState, showStandalonePushStep, start]);

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
      installSchnellManifest();

      // Normal Android/desktop browser flow does not need a separate session
      // read before validating the freshly scanned QR. Removing that serial DB
      // request makes first entry noticeably faster.
      if (!isStandalone && !isApple) {
        busyRef.current = false;
        await start(token, { navigate: true });
        return;
      }

      // The installed Home Screen app can check its active order and load
      // session capabilities in parallel. The status endpoint still validates
      // the secure session, so this removes serial waiting without weakening
      // the QR/session rules.
      if (isStandalone) {
        prewarmSchnellPush();
        const [session, resumedOrder] = await Promise.all([
          loadSessionInfo(),
          resumeActiveOrder(router),
        ]);
        if (cancelled || resumedOrder) return;

        setBackgroundPushEnabled(
          session?.backgroundReadyPushEnabled === true,
        );
        setScannerError("");
        setProblem(null);
        setMessage("");
        setBusyState(false);
        setScreen("scanner");
        return;
      }

      const session = await loadSessionInfo();
      if (cancelled) return;

      const pushEnabled = session?.backgroundReadyPushEnabled === true;
      setBackgroundPushEnabled(pushEnabled);

      // iPhone/iPad browser gets the optional Home Screen setup guide. Android
      // and other browsers keep the direct QR flow.
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
        setCanRetry(false);
        setMessage("");
        return;
      }

      busyRef.current = false;
      await start(token, { navigate: true });
    };

    void initialize();
    return () => {
      cancelled = true;
    };
  }, [router, setBusyState, start, token]);

  const prepareIosInstall = useCallback(async () => {
    if (!token || busyRef.current) return;

    installSchnellManifest();
    const result = await start(token, { navigate: false });
    if (result !== "done") return;

    writeInstallMarker();
    setInstalledHint(true);
    setProblem(null);
    setCanRetry(false);
    setMessage("");
    setScreen("install");
    setBusyState(false);
  }, [setBusyState, start, token]);

  const activatePush = useCallback(async () => {
    if (pushBusy) return;

    setPushBusy(true);
    setPushResult(null);

    const result = await activateSchnellPushFromGesture();
    setPushResult(result);
    setPushBusy(false);

    if (result.ok) {
      window.setTimeout(() => {
        router.replace("/schnellbestellung");
      }, 700);
    }
  }, [pushBusy, router]);

  const retry = useCallback(() => {
    const retryToken = retryTokenRef.current;
    if (!retryToken) return;
    busyRef.current = false;
    void start(retryToken, retryOptionsRef.current);
  }, [start]);

  const backToScanner = useCallback(() => {
    setProblem(null);
    setCanRetry(false);
    setMessage("");
    setScannerError("");
    setBusyState(false);
    setScreen("scanner");
  }, [setBusyState]);

  const showInstructions =
    problem === "permission_denied" ||
    problem === "position_unavailable" ||
    problem === "timeout" ||
    problem === "accuracy_low";

  if (screen === "scanner") {
    return (
      <SchnellQrScanner
        busy={busy}
        errorMessage={scannerError}
        onToken={handleScannedToken}
      />
    );
  }

  if (screen === "push") {
    const pushMessage = pushResult
      ? pushResult.ok
        ? "Benachrichtigungen sind aktiviert. Das Menü wird geöffnet …"
        : pushResult.code === "permission_denied"
          ? "Benachrichtigungen sind blockiert. Öffnen Sie iPhone-Einstellungen → Mitteilungen → Burger Brothers."
          : pushResult.code === "not_configured"
            ? "Der Benachrichtigungsdienst ist auf dem Server noch nicht vollständig eingerichtet."
            : pushResult.code === "disabled"
              ? "Die Hintergrundbenachrichtigung ist momentan deaktiviert."
              : pushResult.code === "service_worker_failed"
                ? "Der Benachrichtigungsdienst konnte nicht gestartet werden. Bitte schließen und öffnen Sie Burger Brothers erneut."
                : pushResult.code === "subscription_failed"
                  ? "Die Push-Anmeldung ist fehlgeschlagen. Bitte prüfen Sie Internetverbindung und iOS-Version."
                  : "Dieses Gerät unterstützt die benötigte Hintergrundbenachrichtigung nicht."
      : "";

    return (
      <main className="grid min-h-dvh place-items-center bg-stone-950 p-5 text-white">
        <section className="w-full max-w-md rounded-3xl border border-emerald-300/25 bg-white/5 p-6 shadow-2xl shadow-black/30">
          <div className="text-center">
            <img
              src="/schnell-icon-180.png?v=1"
              className="mx-auto h-24 w-24 rounded-[24px]"
              alt="Burger Brothers"
            />
            <p className="mt-5 text-sm font-black uppercase tracking-[0.18em] text-emerald-300">
              Home-Bildschirm-App
            </p>
            <h1 className="mt-2 text-3xl font-black">
              Fertig-Meldung aktivieren
            </h1>
            <p className="mt-3 leading-6 text-stone-300">
              Tippen Sie einmal auf den grünen Button. Danach kann Burger
              Brothers die Fertig-Meldung auch bei gesperrtem Bildschirm
              anzeigen.
            </p>
          </div>

          <button
            type="button"
            disabled={pushBusy}
            onClick={() => void activatePush()}
            className="mt-7 w-full rounded-2xl bg-emerald-400 px-5 py-4 text-lg font-black text-black disabled:opacity-60"
          >
            {pushBusy
              ? "Wird aktiviert …"
              : "Benachrichtigungen aktivieren"}
          </button>

          {pushMessage ? (
            <div
              className={`mt-4 rounded-2xl border p-4 text-sm leading-6 ${
                pushResult?.ok
                  ? "border-emerald-300/30 bg-emerald-400/10 text-emerald-100"
                  : "border-red-300/30 bg-red-400/10 text-red-100"
              }`}
              aria-live="polite"
            >
              {pushMessage}
            </div>
          ) : null}

          <button
            type="button"
            onClick={() => router.replace("/schnellbestellung")}
            className="mt-4 w-full rounded-2xl border border-white/15 bg-white/5 px-5 py-4 font-bold text-white"
          >
            Ohne Benachrichtigung bestellen
          </button>

          <p className="mt-5 text-center text-xs leading-5 text-stone-500">
            Dieser Bildschirm erscheint nur in der installierten
            Burger-Brothers-App auf iPhone und iPad.
          </p>
        </section>
      </main>
    );
  }

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
              Schließen Sie Safari, öffnen Sie Burger Brothers auf dem
              Home-Bildschirm und scannen Sie den Restaurant-QR direkt in der
              App.
            </div>
          ) : null}

          <button
            type="button"
            onClick={() => void start(token, { navigate: true })}
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
    const steps = [
      ["1", "Tippen Sie unten in Safari auf das Teilen-Symbol □↑."],
      ["2", "Scrollen Sie im Menü nach unten und wählen Sie „Zum Home-Bildschirm“."],
      ["3", "Tippen Sie oben rechts auf „Hinzufügen“."],
      ["4", "Schließen Sie Safari und öffnen Sie Burger Brothers über das neue Symbol."],
      ["5", "Tippen Sie dort auf „QR-Code scannen“ und scannen Sie den Restaurant-QR erneut."],
    ];

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
              So erhalten Sie die Fertig-Meldung auch bei gesperrtem Bildschirm.
            </p>
          </div>

          <ol className="mt-7 space-y-3 text-left">
            {steps.map(([number, text]) => (
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
            Wichtig: Jede neue Bestellung beginnt in der Burger-Brothers-App
            mit dem aktuellen QR-Code im Restaurant. Danach folgen
            Standortprüfung und Benachrichtigungsfreigabe.
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
          src={
            appleMobile
              ? "/schnell-icon-180.png?v=1"
              : "/logo-burger-brothers.png"
          }
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
                ? "Öffnen Sie die App-/Website-Einstellungen und stellen Sie „Standort“ auf „Fragen“ oder „Erlauben“. Aktivieren Sie außerdem „Genauer Standort“."
                : "Öffnen Sie die Website-Berechtigungen und erlauben Sie den Standortzugriff."}
            </p>
          </div>
        ) : null}

        {!busy && canRetry ? (
          <button
            type="button"
            onClick={retry}
            className="mt-7 w-full rounded-2xl bg-amber-400 px-5 py-4 text-lg font-black text-black"
          >
            Erneut versuchen
          </button>
        ) : null}

        {!busy && standalone ? (
          <button
            type="button"
            onClick={backToScanner}
            className="mt-3 w-full rounded-2xl border border-white/15 bg-white/5 px-5 py-4 font-bold text-white"
          >
            Anderen QR-Code scannen
          </button>
        ) : null}
      </section>
    </main>
  );
}
