"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";

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

type GeoFailure = {
  code: number;
  message?: string;
};

type VerifyResponse = {
  ok?: boolean;
  error?: string;
  accuracy?: number;
  maxAccuracy?: number;
  distance?: number;
  radius?: number;
};

const TARGET_ACCURACY_METERS = 75;
const LOCATION_DEADLINE_MS = 18_000;

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
    permissionsPolicy?: {
      allowsFeature(feature: string): boolean;
    };
    featurePolicy?: {
      allowsFeature(feature: string): boolean;
    };
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
      if (bestPosition) {
        finishWithPosition(bestPosition);
        return;
      }

      finishWithError({ code: 3, message: "location_timeout" });
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
          if (bestPosition && error.code === 3) {
            finishWithPosition(bestPosition);
            return;
          }

          finishWithError({ code: error.code, message: error.message });
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

function isAppleMobile() {
  return (
    typeof navigator !== "undefined" &&
    /iPhone|iPad|iPod/i.test(navigator.userAgent)
  );
}

function formatAccuracy(value: unknown) {
  const number = Number(value);

  return Number.isFinite(number) ? Math.round(number) : null;
}

export default function Enter() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const token = useMemo(
    () => searchParams.get("t")?.trim() ?? "",
    [searchParams],
  );

  const autoStartedRef = useRef(false);
  const busyRef = useRef(false);
  const [message, setMessage] = useState("Standort wird geprüft …");
  const [problem, setProblem] = useState<ProblemKind>(null);
  const [busy, setBusy] = useState(true);

  const setBusyState = useCallback((value: boolean) => {
    busyRef.current = value;
    setBusy(value);
  }, []);

  const showGeoFailure = useCallback(
    (error: GeoFailure) => {
      setBusyState(false);

      if (error.code === 1) {
        setProblem("permission_denied");
        setMessage(
          "Der Standortzugriff ist blockiert. Bitte erlauben Sie den Zugriff und versuchen Sie es erneut.",
        );
        return;
      }

      if (error.code === 3) {
        setProblem("timeout");
        setMessage(
          "Die Standortbestimmung dauert zu lange. Bitte gehen Sie näher ans Fenster und versuchen Sie es erneut.",
        );
        return;
      }

      setProblem("position_unavailable");
      setMessage(
        "Ihr Standort konnte momentan nicht bestimmt werden. Bitte prüfen Sie Ortungsdienste, WLAN und Mobilfunk.",
      );
    },
    [setBusyState],
  );

  const verifyPosition = useCallback(
    async (position: GeolocationPosition) => {
      const controller = new AbortController();
      const timeoutId = window.setTimeout(() => controller.abort(), 15_000);

      try {
        const response = await fetch(
          "/api/schnellbestellung/location/verify",
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
            },
            credentials: "same-origin",
            cache: "no-store",
            signal: controller.signal,
            body: JSON.stringify({
              token,
              lat: position.coords.latitude,
              lng: position.coords.longitude,
              accuracy: position.coords.accuracy,
              deviceId: getDeviceId(),
            }),
          },
        );

        const data = (await response.json().catch(() => ({}))) as VerifyResponse;

        if (response.ok && data.ok) {
          // replace prevents Back from returning to the temporary GPS screen.
          router.replace("/schnellbestellung");
          return;
        }

        setBusyState(false);
        setProblem("server");

        if (data.error === "accuracy_too_low") {
          setProblem("accuracy_low");
          const accuracy = formatAccuracy(data.accuracy);
          const maximum = formatAccuracy(data.maxAccuracy);
          const detail =
            accuracy !== null && maximum !== null
              ? ` Aktuelle Genauigkeit: ±${accuracy} m, benötigt: höchstens ±${maximum} m.`
              : "";

          setMessage(
            `Ihr Standort ist noch zu ungenau. Aktivieren Sie „Genauer Standort“ und versuchen Sie es erneut.${detail}`,
          );
          return;
        }

        if (data.error === "outside_radius") {
          setMessage(
            "Schnellbestellungen sind nur direkt im Restaurant möglich.",
          );
          return;
        }

        if (data.error === "invalid_qr") {
          setMessage(
            "Der QR-Code ist abgelaufen. Bitte scannen Sie den aktuellen QR-Code im Restaurant erneut.",
          );
          return;
        }

        if (data.error === "unavailable") {
          setMessage(
            "Die Schnellbestellung ist momentan nicht verfügbar. Bitte wenden Sie sich an unser Personal.",
          );
          return;
        }

        if (data.error === "origin_not_allowed") {
          setMessage(
            "Die Sicherheitsprüfung ist fehlgeschlagen. Bitte öffnen Sie den QR-Code direkt in Safari oder Chrome.",
          );
          return;
        }

        setMessage(
          "Der Standort konnte nicht bestätigt werden. Bitte versuchen Sie es erneut.",
        );
      } catch (error) {
        setBusyState(false);
        setProblem("network");
        setMessage(
          error instanceof DOMException && error.name === "AbortError"
            ? "Die Verbindung dauert zu lange. Bitte versuchen Sie es erneut."
            : "Die Verbindung zum Bestellsystem ist fehlgeschlagen. Bitte versuchen Sie es erneut.",
        );
      } finally {
        window.clearTimeout(timeoutId);
      }
    },
    [router, setBusyState, token],
  );

  const start = useCallback(async () => {
    if (busyRef.current || !token) return;

    setBusyState(true);
    setProblem(null);
    setMessage("Standort wird geprüft …");

    if (!window.isSecureContext) {
      setBusyState(false);
      setProblem("insecure_context");
      setMessage(
        "Der Standortzugriff ist nur über eine sichere HTTPS-Verbindung möglich.",
      );
      return;
    }

    if (!("geolocation" in navigator)) {
      setBusyState(false);
      setProblem("unsupported");
      setMessage(
        "Dieser Browser unterstützt keine Standortbestimmung. Bitte öffnen Sie den QR-Code in Safari oder Chrome.",
      );
      return;
    }

    if (!geolocationAllowedByDocumentPolicy()) {
      setBusyState(false);
      setProblem("policy_blocked");
      setMessage(
        "Der Browser blockiert den Standortzugriff auf dieser Seite. Bitte öffnen Sie den QR-Code direkt in Safari oder Chrome.",
      );
      return;
    }

    const permission = await readGeolocationPermission();

    if (permission === "denied") {
      setBusyState(false);
      setProblem("permission_denied");
      setMessage(
        "Der Standortzugriff wurde für diese Website blockiert. Bitte ändern Sie die Website-Einstellung und versuchen Sie es erneut.",
      );
      return;
    }

    try {
      const position = await getBestPosition();
      setMessage("Menü wird geöffnet …");
      await verifyPosition(position);
    } catch (error) {
      showGeoFailure(error as GeoFailure);
    }
  }, [setBusyState, showGeoFailure, token, verifyPosition]);

  useEffect(() => {
    if (!token) {
      setBusyState(false);
      setMessage(
        "Ungültiger QR-Code. Bitte scannen Sie den aktuellen QR-Code erneut.",
      );
      setProblem("server");
      return;
    }

    if (autoStartedRef.current) return;

    autoStartedRef.current = true;
    busyRef.current = false;

    // Existing permission is used immediately. On a new device the browser's
    // native permission sheet may appear; no extra restaurant button is needed.
    const frame = window.requestAnimationFrame(() => {
      void start();
    });

    return () => window.cancelAnimationFrame(frame);
  }, [setBusyState, start, token]);

  const appleInstructions =
    problem === "permission_denied" && isAppleMobile();
  const showInstructions =
    problem === "permission_denied" ||
    problem === "position_unavailable" ||
    problem === "timeout" ||
    problem === "accuracy_low";
  const showRetry = !busy && Boolean(token);

  return (
    <main className="grid min-h-dvh place-items-center bg-stone-950 p-6 text-white">
      <section className="w-full max-w-md rounded-3xl border border-white/10 bg-white/5 p-7 text-center shadow-2xl shadow-black/30">
        <img
          src="/logo-burger-brothers.png"
          className="mx-auto h-24 w-24 rounded-full"
          alt="Burger Brothers"
        />

        <h1 className="mt-5 text-3xl font-black">Schnellbestellung</h1>

        {busy ? (
          <div
            className="mx-auto mt-6 h-10 w-10 animate-spin rounded-full border-4 border-white/15 border-t-amber-400"
            aria-label="Standort wird geprüft"
          />
        ) : null}

        <p className="mt-4 text-stone-300" aria-live="polite">
          {message}
        </p>

        {showInstructions ? (
          <div className="mt-5 rounded-2xl border border-amber-300/25 bg-amber-300/10 p-4 text-left text-sm leading-6 text-stone-200">
            {appleInstructions ? (
              <>
                <p className="font-bold text-amber-200">
                  Standort auf dem iPhone erlauben
                </p>
                <p className="mt-2">
                  1. Tippen Sie links in der Adressleiste auf das Seitensymbol.
                  <br />
                  2. Öffnen Sie „Website-Einstellungen“.
                  <br />
                  3. Stellen Sie „Standort“ auf „Fragen“ oder „Erlauben“.
                  <br />
                  4. Aktivieren Sie in den iPhone-Ortungsdiensten auch
                  „Genauer Standort“.
                </p>
              </>
            ) : (
              <>
                <p className="font-bold text-amber-200">Standort erlauben</p>
                <p className="mt-2">
                  Öffnen Sie die Website-Berechtigungen in der Adressleiste,
                  erlauben Sie „Standort“ und aktivieren Sie den genauen
                  Standort.
                </p>
              </>
            )}
          </div>
        ) : null}

        {showRetry ? (
          <button
            type="button"
            onClick={() => void start()}
            className="mt-7 w-full rounded-2xl bg-amber-400 px-5 py-4 text-lg font-black text-black transition active:scale-[0.99]"
          >
            Erneut versuchen
          </button>
        ) : null}
      </section>
    </main>
  );
}
