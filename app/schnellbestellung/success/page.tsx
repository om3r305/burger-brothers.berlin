"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";

type OrderStatus = "new" | "preparing" | "ready" | "done" | "cancelled";

type StatusResponse = {
  ok?: boolean;
  status?: OrderStatus;
  customerNumber?: number;
  liveReadyAlertEnabled?: boolean;
  readyEventId?: string;
  readyEventAt?: number;
  readyEventSequence?: number;
};

type WakeLockSentinelLike = {
  release(): Promise<void>;
  released?: boolean;
};

type NavigatorWithWakeLock = Navigator & {
  wakeLock?: {
    request(type: "screen"): Promise<WakeLockSentinelLike>;
  };
};

type AudioWindow = Window &
  typeof globalThis & {
    __bbSchnellReadyAudioContext?: AudioContext;
    __bbSchnellReadyMedia?: HTMLAudioElement;
  };

function getReadyMediaElement() {
  const audioWindow = window as AudioWindow;
  const media =
    audioWindow.__bbSchnellReadyMedia || new Audio("/sounds/dine-in.wav");
  media.preload = "auto";
  media.volume = 1;
  media.muted = false;
  media.setAttribute("playsinline", "true");
  audioWindow.__bbSchnellReadyMedia = media;
  return media;
}

function playReadyMediaRound(media: HTMLAudioElement) {
  try {
    media.pause();
    media.currentTime = 0;
    media.volume = 1;
    media.muted = false;
    void media.play().catch(() => undefined);
  } catch {
    // HTML media is best-effort on mobile browsers.
  }
}

function playReadyAlert() {
  try {
    const media = getReadyMediaElement();
    [0, 1600, 3200, 4800, 6400, 8000].forEach((delay) => {
      window.setTimeout(() => playReadyMediaRound(media), delay);
    });
  } catch {
    // Web Audio fallback below still runs.
  }

  try {
    const audioWindow = window as AudioWindow;
    const AudioContextClass =
      window.AudioContext ||
      (window as typeof window & { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AudioContextClass) return;

    const context =
      audioWindow.__bbSchnellReadyAudioContext || new AudioContextClass();
    audioWindow.__bbSchnellReadyAudioContext = context;

    const schedule = () => {
      const compressor = context.createDynamicsCompressor();
      compressor.threshold.value = -24;
      compressor.knee.value = 8;
      compressor.ratio.value = 12;
      compressor.attack.value = 0.002;
      compressor.release.value = 0.18;

      const master = context.createGain();
      master.gain.value = 1;
      compressor.connect(master);
      master.connect(context.destination);

      const roundOffsets = [0, 1.45, 2.9, 4.35, 5.8, 7.25];
      const notes = [988, 1318, 1568, 1318, 1760, 2093];

      roundOffsets.forEach((roundOffset) => {
        notes.forEach((frequency, index) => {
          const start = context.currentTime + roundOffset + index * 0.16;
          const oscillator = context.createOscillator();
          const gain = context.createGain();
          oscillator.type = index % 2 === 0 ? "square" : "sawtooth";
          oscillator.frequency.setValueAtTime(frequency, start);
          gain.gain.setValueAtTime(0.0001, start);
          gain.gain.exponentialRampToValueAtTime(0.96, start + 0.012);
          gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.13);
          oscillator.connect(gain);
          gain.connect(compressor);
          oscillator.start(start);
          oscillator.stop(start + 0.15);
        });
      });
    };

    if (context.state === "suspended") {
      void context.resume().then(schedule).catch(() => undefined);
    } else {
      schedule();
    }
  } catch {
    // Audio is best-effort. Visual ready state still works.
  }

  try {
    navigator.vibrate?.([
      650, 120, 650, 140, 950, 240,
      650, 120, 650, 140, 950, 240,
      800, 140, 800, 140, 1200,
    ]);
  } catch {
    // Vibration is not available on every browser (including iOS Safari).
  }
}

export default function SuccessPage() {
  const searchParams = useSearchParams();
  const orderId = searchParams.get("order")?.trim() || "";
  const initialNumber = searchParams.get("number") || "–";
  const [customerNumber, setCustomerNumber] = useState(initialNumber);
  const [status, setStatus] = useState<OrderStatus>("new");
  const [closing, setClosing] = useState(false);
  const [closeHint, setCloseHint] = useState(false);
  const [statusError, setStatusError] = useState(false);
  const lastReadyEventRef = useRef("");
  const legacyReadyActiveRef = useRef(false);
  const wakeLockRef = useRef<WakeLockSentinelLike | null>(null);

  const requestWakeLock = useCallback(async () => {
    try {
      const navigatorWithWakeLock = navigator as NavigatorWithWakeLock;
      if (!navigatorWithWakeLock.wakeLock || document.visibilityState !== "visible") {
        return;
      }
      wakeLockRef.current = await navigatorWithWakeLock.wakeLock.request("screen");
    } catch {
      // iOS versions without Wake Lock keep the normal browser behavior.
    }
  }, []);

  useEffect(() => {
    void requestWakeLock();

    const onVisibility = () => {
      if (document.visibilityState === "visible") void requestWakeLock();
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      void wakeLockRef.current?.release().catch(() => undefined);
    };
  }, [requestWakeLock]);

  useEffect(() => {
    if (!orderId) return;

    let cancelled = false;
    let timer: number | null = null;

    const poll = async () => {
      try {
        const response = await fetch(
          `/api/schnellbestellung/status?order=${encodeURIComponent(orderId)}`,
          { credentials: "same-origin", cache: "no-store" },
        );
        const data = (await response.json().catch(() => ({}))) as StatusResponse;

        if (cancelled) return;

        if (response.ok && data.ok && data.status) {
          setStatus(data.status);
          setStatusError(false);
          if (Number(data.customerNumber) > 0) {
            setCustomerNumber(String(data.customerNumber));
          }

          if (data.status === "ready") {
            const readyEventId = String(data.readyEventId || "").trim();

            if (data.liveReadyAlertEnabled !== false) {
              if (readyEventId) {
                if (lastReadyEventRef.current !== readyEventId) {
                  lastReadyEventRef.current = readyEventId;
                  playReadyAlert();
                }
              } else if (!legacyReadyActiveRef.current) {
                // Eski siparişlerde readyEventId yoksa status geçişini kullan.
                legacyReadyActiveRef.current = true;
                playReadyAlert();
              }
            }
          } else {
            legacyReadyActiveRef.current = false;
          }
        } else if (response.status !== 401) {
          setStatusError(true);
        }
      } catch {
        if (!cancelled) setStatusError(true);
      } finally {
        if (!cancelled && status !== "done" && status !== "cancelled") {
          timer = window.setTimeout(poll, 2500);
        }
      }
    };

    void poll();

    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [orderId, status]);

  function finish() {
    setClosing(true);
    setCloseHint(false);

    try {
      window.close();
    } catch {
      // Safari normally blocks closing a camera-opened tab.
    }

    window.setTimeout(() => {
      setClosing(false);
      setCloseHint(true);
    }, 450);
  }

  const ready = status === "ready";
  const cancelled = status === "cancelled";

  return (
    <main
      className={`grid min-h-dvh place-items-center p-6 text-white transition-colors duration-500 ${
        ready ? "bg-emerald-950" : cancelled ? "bg-red-950" : "bg-stone-950"
      }`}
    >
      <section className="w-full max-w-lg text-center">
        <p
          className={`text-2xl font-black sm:text-3xl ${
            ready
              ? "animate-pulse text-emerald-300"
              : cancelled
                ? "text-red-300"
                : "text-emerald-400"
          }`}
        >
          {ready
            ? "Ihre Bestellung ist fertig!"
            : cancelled
              ? "Bestellung storniert"
              : "Bestellung aufgenommen"}
        </p>

        <p className="mt-8 text-xl text-stone-300">Ihre Nummer</p>
        <div className="my-4 text-[9rem] font-black leading-none text-amber-400 sm:text-[11rem]">
          {customerNumber}
        </div>

        <p className="mx-auto max-w-sm text-xl text-stone-300">
          {ready
            ? "Bitte holen Sie Ihre Bestellung ab."
            : cancelled
              ? "Bitte wenden Sie sich an unser Personal."
              : "Bitte lassen Sie diese Seite geöffnet. Wir melden uns, sobald Ihre Bestellung fertig ist."}
        </p>

        {!ready && !cancelled ? (
          <div className="mx-auto mt-7 flex w-fit items-center gap-3 rounded-full border border-white/10 bg-white/5 px-5 py-3 text-sm text-stone-300">
            <span className="h-3 w-3 animate-pulse rounded-full bg-emerald-400" />
            {status === "preparing" ? "In Vorbereitung" : "Wird angenommen"}
          </div>
        ) : null}

        <p className="mt-8 text-sm text-stone-500">
          Barzahlung an der Ausgabe · BAR OFFEN
        </p>

        {statusError ? (
          <p className="mt-3 text-xs text-amber-300">
            Status wird automatisch erneut geprüft.
          </p>
        ) : null}

        <button
          type="button"
          onClick={finish}
          disabled={closing}
          className="mt-10 w-full rounded-2xl bg-amber-400 px-5 py-4 text-lg font-black text-black disabled:opacity-60"
        >
          {closing ? "Wird geschlossen …" : "Seite schließen"}
        </button>

        {closeHint ? (
          <p className="mt-4 rounded-xl border border-white/10 bg-white/5 p-3 text-sm text-stone-300">
            Safari konnte den Tab nicht automatisch schließen. Sie können diese Seite jetzt schließen.
          </p>
        ) : null}
      </section>
    </main>
  );
}
