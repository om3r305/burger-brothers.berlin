"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import QRCode from "react-qr-code";

type DisplayStatus =
  | "loading"
  | "ready"
  | "disabled"
  | "paused"
  | "configuration_missing"
  | "offline"
  | "unavailable";

type TokenResponse = {
  ok?: boolean;
  token?: string;
  mode?: "static" | "dynamic";
  expiresIn?: number;
  issuedAt?: number;
  error?: string;
};

const STATUS_TEXT: Record<
  Exclude<DisplayStatus, "loading" | "ready">,
  { title: string; body: string }
> = {
  disabled: {
    title: "Schnellbestellung ist noch nicht aktiviert",
    body: "Bitte aktivieren Sie das System im Admin-Bereich.",
  },
  paused: {
    title: "Schnellbestellung ist momentan pausiert",
    body: "Bitte wenden Sie sich an unser Personal.",
  },
  configuration_missing: {
    title: "QR-Code kann noch nicht erstellt werden",
    body: "Die sichere Sitzungskonfiguration fehlt. Bitte informieren Sie das Personal.",
  },
  offline: {
    title: "Keine Verbindung",
    body: "Die Verbindung wird automatisch erneut geprüft.",
  },
  unavailable: {
    title: "QR-Code vorübergehend nicht verfügbar",
    body: "Bitte warten Sie einen Moment oder informieren Sie unser Personal.",
  },
};

function mapStatus(error: string | undefined): DisplayStatus {
  if (error === "disabled") return "disabled";
  if (error === "paused") return "paused";
  if (error === "configuration_missing") return "configuration_missing";
  return "unavailable";
}

function isLocalHost(url: string) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === "localhost" || host === "127.0.0.1" || host === "::1";
  } catch {
    return false;
  }
}

function downloadBlob(blob: Blob, filename: string) {
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(href);
}

export default function SchnellbestellungAccessDisplay() {
  const qrWrapRef = useRef<HTMLDivElement | null>(null);
  const [status, setStatus] = useState<DisplayStatus>("loading");
  const [entryUrl, setEntryUrl] = useState("");
  const [qrMode, setQrMode] = useState<"static" | "dynamic">("static");
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [requestNo, setRequestNo] = useState(0);

  const loadToken = useCallback(async (showLoading = false) => {
    if (showLoading) setStatus("loading");

    try {
      const response = await fetch("/api/schnellbestellung/access-token", {
        cache: "no-store",
        headers: { Accept: "application/json" },
      });
      const data = (await response.json().catch(() => ({}))) as TokenResponse;

      if (!response.ok || data.ok !== true || typeof data.token !== "string") {
        setEntryUrl("");
        setExpiresAt(null);
        setStatus(mapStatus(data.error));
        return;
      }

      const mode = data.mode === "dynamic" ? "dynamic" : "static";
      const issuedAt = Number(data.issuedAt) || Date.now();
      const seconds = Math.max(30, Number(data.expiresIn) || 600);
      const url = `${window.location.origin}/schnellbestellung/enter?t=${encodeURIComponent(
        data.token,
      )}`;

      setQrMode(mode);
      setEntryUrl(url);
      setExpiresAt(mode === "dynamic" ? issuedAt + seconds * 1000 : null);
      setStatus("ready");
    } catch {
      setEntryUrl("");
      setExpiresAt(null);
      setStatus("offline");
    }
  }, []);

  useEffect(() => {
    void loadToken(true);

    const refreshTimer = window.setInterval(() => {
      if (qrMode === "dynamic") void loadToken(false);
    }, 60_000);

    return () => window.clearInterval(refreshTimer);
  }, [loadToken, qrMode, requestNo]);

  useEffect(() => {
    const clock = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(clock);
  }, []);

  const remainingSeconds = useMemo(() => {
    if (!expiresAt) return 0;
    return Math.max(0, Math.ceil((expiresAt - now) / 1000));
  }, [expiresAt, now]);

  useEffect(() => {
    if (
      qrMode === "dynamic" &&
      status === "ready" &&
      expiresAt &&
      remainingSeconds <= 15
    ) {
      void loadToken(false);
    }
  }, [expiresAt, loadToken, qrMode, remainingSeconds, status]);

  const downloadSvg = useCallback(() => {
    const svg = qrWrapRef.current?.querySelector("svg");
    if (!svg) return;

    const serialized = new XMLSerializer().serializeToString(svg);
    downloadBlob(
      new Blob([serialized], { type: "image/svg+xml;charset=utf-8" }),
      "burger-brothers-schnellbestellung-qr.svg",
    );
  }, []);

  const downloadPng = useCallback(() => {
    const svg = qrWrapRef.current?.querySelector("svg");
    if (!svg) return;

    const size = 1800;
    const serialized = new XMLSerializer().serializeToString(svg);
    const image = new Image();
    const blob = new Blob([serialized], { type: "image/svg+xml;charset=utf-8" });
    const objectUrl = URL.createObjectURL(blob);

    image.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const context = canvas.getContext("2d");
      if (!context) return;
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, size, size);
      context.drawImage(image, 0, 0, size, size);
      canvas.toBlob((png) => {
        if (png) downloadBlob(png, "burger-brothers-schnellbestellung-qr.png");
      }, "image/png");
      URL.revokeObjectURL(objectUrl);
    };

    image.src = objectUrl;
  }, []);

  const localWarning = status === "ready" && isLocalHost(entryUrl);
  const statusCopy =
    status !== "loading" && status !== "ready" ? STATUS_TEXT[status] : null;

  return (
    <main className="grid min-h-screen place-items-center bg-black p-5 text-white sm:p-10">
      <section className="w-full max-w-3xl text-center">
        <img
          src="/logo-burger-brothers.webp"
          className="mx-auto h-24 w-24 rounded-full object-contain sm:h-32 sm:w-32"
          alt="Burger Brothers"
        />

        <h1 className="mt-5 text-4xl font-black sm:mt-6 sm:text-6xl">
          Jetzt bestellen
        </h1>
        <p className="mt-2 text-xl text-stone-300 sm:mt-3 sm:text-3xl">
          QR-Code scannen und direkt bestellen
        </p>

        <div
          ref={qrWrapRef}
          className="mx-auto mt-8 w-fit rounded-3xl bg-white p-5 shadow-2xl sm:mt-10 sm:p-8"
        >
          {status === "ready" && entryUrl ? (
            <QRCode
              value={entryUrl}
              size={420}
              level="M"
              bgColor="#ffffff"
              fgColor="#000000"
              className="h-[min(68vw,420px)] w-[min(68vw,420px)]"
              aria-label="Schnellbestellung QR-Code"
            />
          ) : status === "loading" ? (
            <div className="grid h-[min(68vw,420px)] w-[min(68vw,420px)] place-items-center bg-stone-100 text-stone-700">
              <div>
                <div className="mx-auto h-10 w-10 animate-spin rounded-full border-4 border-stone-300 border-t-stone-900" />
                <p className="mt-4 font-bold">QR-Code wird geladen …</p>
              </div>
            </div>
          ) : (
            <div className="grid h-[min(68vw,420px)] w-[min(68vw,420px)] place-items-center bg-stone-100 p-6 text-stone-900">
              <div>
                <div className="text-5xl" aria-hidden="true">⚠️</div>
                <h2 className="mt-4 text-xl font-black sm:text-2xl">
                  {statusCopy?.title}
                </h2>
                <p className="mt-3 text-sm text-stone-600 sm:text-base">
                  {statusCopy?.body}
                </p>
                <button
                  type="button"
                  onClick={() => setRequestNo((value) => value + 1)}
                  className="mt-5 rounded-xl bg-black px-5 py-3 font-bold text-white"
                >
                  Erneut versuchen
                </button>
              </div>
            </div>
          )}
        </div>

        {status === "ready" ? (
          <>
            <p className="mt-4 text-sm text-stone-400 sm:text-base">
              {qrMode === "static"
                ? "Statischer Druck-QR · Standortprüfung bleibt aktiv"
                : `Dynamischer QR-Code${remainingSeconds > 0 ? ` · noch ${remainingSeconds} Sek.` : ""}`}
            </p>

            <div className="mt-4 flex flex-wrap justify-center gap-3 print:hidden">
              <button
                type="button"
                onClick={downloadPng}
                className="rounded-xl bg-amber-400 px-5 py-3 font-black text-black"
              >
                PNG herunterladen
              </button>
              <button
                type="button"
                onClick={downloadSvg}
                className="rounded-xl border border-white/20 bg-white/10 px-5 py-3 font-bold"
              >
                SVG herunterladen
              </button>
              <button
                type="button"
                onClick={() => window.print()}
                className="rounded-xl border border-white/20 bg-white/10 px-5 py-3 font-bold"
              >
                Drucken
              </button>
            </div>
          </>
        ) : null}

        {localWarning ? (
          <div className="mx-auto mt-5 max-w-2xl rounded-2xl border border-amber-400/40 bg-amber-400/10 p-4 text-left text-sm text-amber-100 sm:text-base">
            <strong>Lokaler Test:</strong> Dieser QR-Code enthält „localhost“ und
            kann auf einem anderen Handy nicht geöffnet werden. Für den Handytest
            bitte die sichere Vorschau- oder Live-Domain verwenden.
          </div>
        ) : null}
      </section>
    </main>
  );
}
