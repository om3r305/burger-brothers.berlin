"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

type GeoFailure = { code: number; message?: string };

type VerifyResponse = {
  ok?: boolean;
  error?: string;
  locationSkipped?: boolean;
  accuracy?: number;
  maxAccuracy?: number;
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

function isAppleMobile() {
  return /iPhone|iPad|iPod/i.test(navigator.userAgent);
}

export default function EnterPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const token = useMemo(
    () => searchParams.get("t")?.trim() ?? "",
    [searchParams],
  );

  const startedRef = useRef(false);
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState("Menü wird geöffnet …");
  const [problem, setProblem] = useState<ProblemKind>(null);

  const setBusyState = useCallback((value: boolean) => {
    busyRef.current = value;
    setBusy(value);
  }, []);

  const requestSession = useCallback(
    async (location?: GeolocationPosition) => {
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
          router.replace("/schnellbestellung");
          return "done" as const;
        }

        if (data.error === "location_required") return "location_required" as const;

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
          setMessage("Der QR-Code ist ungültig. Bitte scannen Sie den aktuellen QR-Code erneut.");
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

  const start = useCallback(async () => {
    if (busyRef.current || !token) return;

    setBusyState(true);
    setProblem(null);
    setMessage("Menü wird geöffnet …");

    const directResult = await requestSession();
    if (directResult !== "location_required") return;

    setMessage("Standort wird geprüft …");

    if (!window.isSecureContext) {
      setBusyState(false);
      setProblem("insecure_context");
      setMessage("Der Standortzugriff ist nur über HTTPS möglich.");
      return;
    }
    if (!("geolocation" in navigator)) {
      setBusyState(false);
      setProblem("unsupported");
      setMessage("Dieser Browser unterstützt keine Standortbestimmung.");
      return;
    }
    if (!geolocationAllowedByDocumentPolicy()) {
      setBusyState(false);
      setProblem("policy_blocked");
      setMessage("Der Browser blockiert den Standortzugriff auf dieser Seite.");
      return;
    }

    const permission = await readGeolocationPermission();
    if (permission === "denied") {
      setBusyState(false);
      setProblem("permission_denied");
      setMessage("Der Standortzugriff ist für diese Website blockiert.");
      return;
    }

    try {
      const position = await getBestPosition();
      setMessage("Menü wird geöffnet …");
      await requestSession(position);
    } catch (error) {
      const failure = error as GeoFailure;
      setBusyState(false);
      if (failure.code === 1) {
        setProblem("permission_denied");
        setMessage("Der Standortzugriff ist für diese Website blockiert.");
      } else if (failure.code === 3) {
        setProblem("timeout");
        setMessage("Die Standortbestimmung dauert zu lange. Bitte versuchen Sie es erneut.");
      } else {
        setProblem("position_unavailable");
        setMessage("Ihr Standort konnte momentan nicht bestimmt werden.");
      }
    }
  }, [requestSession, setBusyState, token]);

  useEffect(() => {
    if (!token) {
      setBusyState(false);
      setProblem("server");
      setMessage("Ungültiger QR-Code. Bitte scannen Sie den aktuellen QR-Code erneut.");
      return;
    }
    if (startedRef.current) return;
    startedRef.current = true;
    busyRef.current = false;
    const frame = window.requestAnimationFrame(() => void start());
    return () => window.cancelAnimationFrame(frame);
  }, [setBusyState, start, token]);

  const showInstructions =
    problem === "permission_denied" ||
    problem === "position_unavailable" ||
    problem === "timeout" ||
    problem === "accuracy_low";

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
          <div className="mx-auto mt-6 h-10 w-10 animate-spin rounded-full border-4 border-white/15 border-t-amber-400" />
        ) : null}

        <p className="mt-4 text-stone-300" aria-live="polite">
          {message}
        </p>

        {showInstructions ? (
          <div className="mt-5 rounded-2xl border border-amber-300/25 bg-amber-300/10 p-4 text-left text-sm leading-6 text-stone-200">
            <p className="font-bold text-amber-200">Standort erlauben</p>
            <p className="mt-2">
              {isAppleMobile()
                ? "Öffnen Sie die Website-Einstellungen in Safari und stellen Sie „Standort“ auf „Fragen“ oder „Erlauben“."
                : "Öffnen Sie die Website-Berechtigungen und erlauben Sie den Standortzugriff."}
            </p>
          </div>
        ) : null}

        {!busy && token ? (
          <button
            type="button"
            onClick={() => void start()}
            className="mt-7 w-full rounded-2xl bg-amber-400 px-5 py-4 text-lg font-black text-black"
          >
            Erneut versuchen
          </button>
        ) : null}
      </section>
    </main>
  );
}
