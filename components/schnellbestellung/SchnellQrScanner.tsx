"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type ScannerInstance = {
  start(): Promise<void>;
  stop(): void;
  destroy(): void;
};

type ScanResult = { data?: string } | string;

type SchnellQrScannerProps = {
  busy?: boolean;
  errorMessage?: string;
  onToken(token: string): void | Promise<void>;
};

function tokenFromQrPayload(payload: string) {
  const value = String(payload || "").trim();
  if (!value) return "";

  try {
    const url = new URL(value, window.location.origin);
    const allowedHosts = new Set([
      window.location.host.toLowerCase(),
      "burger-brothers.berlin",
      "www.burger-brothers.berlin",
    ]);
    if (!allowedHosts.has(url.host.toLowerCase())) return "";
    if (url.pathname !== "/schnellbestellung/enter") return "";
    return String(url.searchParams.get("t") || "").trim();
  } catch {
    return "";
  }
}

function cameraErrorMessage(error: unknown) {
  const name =
    error && typeof error === "object" && "name" in error
      ? String((error as { name?: unknown }).name || "")
      : "";
  const text = String(
    error instanceof Error ? error.message : error || "",
  ).toLowerCase();

  if (name === "NotAllowedError" || text.includes("permission")) {
    return "Der Kamerazugriff ist blockiert. Öffnen Sie die iPhone-Einstellungen und erlauben Sie Burger Brothers den Kamerazugriff.";
  }
  if (name === "NotFoundError" || text.includes("camera not found")) {
    return "Auf diesem Gerät wurde keine verfügbare Kamera gefunden.";
  }
  if (name === "NotReadableError" || text.includes("could not start")) {
    return "Die Kamera wird bereits von einer anderen App verwendet. Schließen Sie die andere App und versuchen Sie es erneut.";
  }
  return "Die Kamera konnte nicht gestartet werden. Bitte versuchen Sie es erneut.";
}

export default function SchnellQrScanner({
  busy = false,
  errorMessage = "",
  onToken,
}: SchnellQrScannerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const scannerRef = useRef<ScannerInstance | null>(null);
  const handlingRef = useRef(false);
  const mountedRef = useRef(true);

  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraBusy, setCameraBusy] = useState(false);
  const [localError, setLocalError] = useState("");

  const stopScanner = useCallback(() => {
    const scanner = scannerRef.current;
    scannerRef.current = null;
    if (scanner) {
      try {
        scanner.stop();
      } catch {
        // Best-effort camera cleanup.
      }
      try {
        scanner.destroy();
      } catch {
        // Best-effort worker cleanup.
      }
    }
    setCameraOpen(false);
    setCameraBusy(false);
  }, []);

  const handlePayload = useCallback(
    async (payload: string) => {
      if (handlingRef.current || busy) return;

      const token = tokenFromQrPayload(payload);
      if (!token) {
        setLocalError(
          "Dieser QR-Code gehört nicht zur Burger-Brothers-Schnellbestellung. Bitte scannen Sie den QR-Code im Restaurant.",
        );
        handlingRef.current = false;
        return;
      }

      handlingRef.current = true;
      setLocalError("");
      stopScanner();

      try {
        await onToken(token);
      } finally {
        if (mountedRef.current) handlingRef.current = false;
      }
    },
    [busy, onToken, stopScanner],
  );

  const startCamera = useCallback(async () => {
    if (cameraBusy || busy || scannerRef.current) return;
    if (!window.isSecureContext) {
      setLocalError("Der Kamerazugriff ist nur über eine sichere HTTPS-Verbindung möglich.");
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setLocalError("Dieser Browser unterstützt keinen Kamerazugriff.");
      return;
    }

    setCameraBusy(true);
    setLocalError("");
    handlingRef.current = false;

    try {
      const video = videoRef.current;
      if (!video) throw new Error("camera_video_missing");

      const module = await import("qr-scanner");
      if (!mountedRef.current) return;

      const QrScanner = module.default;
      const scanner = new QrScanner(
        video,
        (result: ScanResult) => {
          const payload = typeof result === "string" ? result : result.data || "";
          void handlePayload(payload);
        },
        {
          preferredCamera: "environment",
          maxScansPerSecond: 10,
          highlightScanRegion: true,
          highlightCodeOutline: true,
          returnDetailedScanResult: true,
        },
      ) as ScannerInstance;

      scannerRef.current = scanner;
      await scanner.start();
      if (!mountedRef.current) {
        scanner.destroy();
        return;
      }
      setCameraOpen(true);
    } catch (error) {
      stopScanner();
      setLocalError(cameraErrorMessage(error));
    } finally {
      if (mountedRef.current) setCameraBusy(false);
    }
  }, [busy, cameraBusy, handlePayload, stopScanner]);

  const scanPhoto = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = "";
      if (!file || busy) return;

      setCameraBusy(true);
      setLocalError("");

      try {
        const module = await import("qr-scanner");
        const result = (await module.default.scanImage(file, {
          returnDetailedScanResult: true,
          alsoTryWithoutScanRegion: true,
        })) as ScanResult;
        const payload = typeof result === "string" ? result : result.data || "";
        await handlePayload(payload);
      } catch {
        setLocalError(
          "Auf dem Bild wurde kein gültiger Burger-Brothers-QR-Code erkannt.",
        );
      } finally {
        if (mountedRef.current) setCameraBusy(false);
      }
    },
    [busy, handlePayload],
  );

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      const scanner = scannerRef.current;
      scannerRef.current = null;
      try {
        scanner?.destroy();
      } catch {
        // Best-effort cleanup during navigation.
      }
    };
  }, []);

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
            Im Restaurant bestellen
          </p>
          <h1 className="mt-2 text-3xl font-black">QR-Code scannen</h1>
          <p className="mt-3 leading-6 text-stone-300">
            Scannen Sie den aktuellen QR-Code im Restaurant. Danach prüfen wir
            Ihren Standort und öffnen das Menü.
          </p>
        </div>

        <div
          className={`relative mt-6 overflow-hidden rounded-3xl border bg-black ${
            cameraOpen ? "border-emerald-300/40" : "border-white/10"
          }`}
        >
          <video
            ref={videoRef}
            playsInline
            muted
            className={`aspect-square w-full object-cover ${
              cameraOpen ? "opacity-100" : "opacity-0"
            }`}
          />

          {!cameraOpen ? (
            <div className="absolute inset-0 grid place-items-center p-8 text-center">
              <div>
                <div className="mx-auto grid h-20 w-20 place-items-center rounded-3xl border border-white/15 bg-white/5 text-4xl">
                  ▣
                </div>
                <p className="mt-4 text-sm leading-6 text-stone-400">
                  Die Kamera wird erst nach Ihrer Bestätigung geöffnet.
                </p>
              </div>
            </div>
          ) : (
            <div className="pointer-events-none absolute inset-0 grid place-items-center">
              <div className="h-56 w-56 rounded-[28px] border-4 border-amber-300/90 shadow-[0_0_0_999px_rgba(0,0,0,.28)]" />
            </div>
          )}
        </div>

        <button
          type="button"
          disabled={busy || cameraBusy}
          onClick={() => (cameraOpen ? stopScanner() : void startCamera())}
          className="mt-5 w-full rounded-2xl bg-emerald-400 px-5 py-4 text-lg font-black text-black disabled:opacity-60"
        >
          {busy
            ? "QR-Code wird geprüft …"
            : cameraBusy
              ? "Kamera wird geöffnet …"
              : cameraOpen
                ? "Kamera schließen"
                : "QR-Code scannen"}
        </button>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="sr-only"
          onChange={(event) => void scanPhoto(event)}
        />
        <button
          type="button"
          disabled={busy || cameraBusy}
          onClick={() => fileInputRef.current?.click()}
          className="mt-3 w-full rounded-2xl border border-white/15 bg-white/5 px-5 py-4 font-bold text-white disabled:opacity-60"
        >
          Foto des QR-Codes aufnehmen
        </button>

        {localError || errorMessage ? (
          <div
            className="mt-4 rounded-2xl border border-red-300/30 bg-red-400/10 p-4 text-sm leading-6 text-red-100"
            aria-live="polite"
          >
            {localError || errorMessage}
          </div>
        ) : null}

        <p className="mt-5 text-center text-xs leading-5 text-stone-500">
          Statischer und dynamischer Restaurant-QR werden unterstützt. Ein
          Foto oder QR-Code von außerhalb des Restaurants reicht ohne gültige
          Standortprüfung nicht aus.
        </p>
      </section>
    </main>
  );
}
