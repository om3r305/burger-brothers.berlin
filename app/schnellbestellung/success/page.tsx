"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { clearSchnellActiveOrder } from "@/lib/client/schnell-active-order";
import {
  hasDisplayedSchnellReward,
  markSchnellRewardDisplayed,
} from "@/lib/client/reward-display-once";
import RewardCelebration from "@/components/rewards/RewardCelebration";
import type { SchnellRewardPublic } from "@/lib/rewards/config";
import {
  bindSchnellPushToOrder,
  prewarmSchnellPush,
} from "@/lib/client/schnell-push";

type OrderStatus = "new" | "preparing" | "ready" | "done" | "cancelled";

type StatusResponse = {
  ok?: boolean;
  status?: OrderStatus;
  customerNumber?: number;
  liveReadyAlertEnabled?: boolean;
  readyEventId?: string;
  readyEventAt?: number;
  readyEventSequence?: number;
  reward?: SchnellRewardPublic | null;
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

function stopReadyAlert(timeoutIds: Set<number>) {
  timeoutIds.forEach((timeoutId) => window.clearTimeout(timeoutId));
  timeoutIds.clear();

  try {
    const audioWindow = window as AudioWindow;
    const media = audioWindow.__bbSchnellReadyMedia;
    if (media) {
      media.pause();
      media.currentTime = 0;
    }
    void audioWindow.__bbSchnellReadyAudioContext?.suspend().catch(() => undefined);
  } catch {
    // Audio cleanup is best-effort.
  }

  try {
    navigator.vibrate?.(0);
  } catch {
    // Vibration is not available on every browser.
  }
}

function playReadyAlert(timeoutIds: Set<number>) {
  stopReadyAlert(timeoutIds);

  try {
    const media = getReadyMediaElement();
    [0, 1600, 3200, 4800, 6400, 8000].forEach((delay) => {
      const timeoutId = window.setTimeout(() => {
        timeoutIds.delete(timeoutId);
        playReadyMediaRound(media);
      }, delay);
      timeoutIds.add(timeoutId);
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
  const [ended, setEnded] = useState(false);
  const [statusError, setStatusError] = useState(false);
  const [reward, setReward] = useState<SchnellRewardPublic | null>(null);
  const [rewardVisible, setRewardVisible] = useState(false);
  const rewardShownRef = useRef(false);

  const endedRef = useRef(false);
  const lastReadyEventRef = useRef("");
  const legacyReadyActiveRef = useRef(false);
  const wakeLockRef = useRef<WakeLockSentinelLike | null>(null);
  const readyTimeoutIdsRef = useRef(new Set<number>());


  useEffect(() => {
    if (!orderId) return;
    try {
      const raw = window.sessionStorage.getItem(`bb_schnell_reward:${orderId}`);
      if (!raw) return;
      const parsed = JSON.parse(raw) as SchnellRewardPublic;
      if (parsed?.winId && !hasDisplayedSchnellReward(orderId, parsed)) {
        setReward(parsed);
      } else if (parsed?.winId) {
        window.sessionStorage.removeItem(`bb_schnell_reward:${orderId}`);
      }
    } catch {
      // Status API fallback olarak ödülü yükler.
    }
  }, [orderId]);

  useEffect(() => {
    if (!reward?.winId || rewardShownRef.current || endedRef.current) return;
    if (hasDisplayedSchnellReward(orderId, reward)) {
      setReward(null);
      try {
        window.sessionStorage.removeItem(`bb_schnell_reward:${orderId}`);
      } catch {}
      return;
    }

    rewardShownRef.current = true;
    // Mark before opening: a reload, PWA relaunch or Fertig push must not
    // replay the same prize and photo/name form.
    markSchnellRewardDisplayed(orderId, reward);
    const timer = window.setTimeout(() => setRewardVisible(true), 700);
    return () => window.clearTimeout(timer);
  }, [orderId, reward]);

  useEffect(() => {
    prewarmSchnellPush();
    if (orderId) void bindSchnellPushToOrder(orderId);
  }, [orderId]);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    const onMessage = (messageEvent: MessageEvent) => {
      if (endedRef.current) return;

      const message = messageEvent.data as
        | { type?: string; event?: { id?: string; customerNumber?: number } }
        | undefined;
      if (message?.type !== "BB_SCHNELL_READY_PUSH") return;

      const readyEventId = String(message.event?.id || "").trim();
      if (readyEventId && lastReadyEventRef.current === readyEventId) return;
      if (readyEventId) lastReadyEventRef.current = readyEventId;
      if (Number(message.event?.customerNumber) > 0) {
        setCustomerNumber(String(message.event?.customerNumber));
      }
      setStatus("ready");
      playReadyAlert(readyTimeoutIdsRef.current);
    };

    navigator.serviceWorker.addEventListener("message", onMessage);
    return () => navigator.serviceWorker.removeEventListener("message", onMessage);
  }, []);

  const requestWakeLock = useCallback(async () => {
    try {
      const navigatorWithWakeLock = navigator as NavigatorWithWakeLock;
      if (
        endedRef.current ||
        !navigatorWithWakeLock.wakeLock ||
        document.visibilityState !== "visible"
      ) {
        return;
      }
      wakeLockRef.current = await navigatorWithWakeLock.wakeLock.request("screen");
    } catch {
      // iOS versions without Wake Lock keep the normal browser behavior.
    }
  }, []);

  const releaseWakeLock = useCallback(async () => {
    const sentinel = wakeLockRef.current;
    wakeLockRef.current = null;
    try {
      await sentinel?.release();
    } catch {
      // Wake Lock may already have been released by the browser.
    }
  }, []);

  useEffect(() => {
    void requestWakeLock();

    const onVisibility = () => {
      if (document.visibilityState === "visible" && !endedRef.current) {
        void requestWakeLock();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      stopReadyAlert(readyTimeoutIdsRef.current);
      void releaseWakeLock();
    };
  }, [releaseWakeLock, requestWakeLock]);

  useEffect(() => {
    if (!orderId || ended) return;

    let cancelled = false;
    let timer: number | null = null;

    const poll = async () => {
      if (endedRef.current) return;

      try {
        const response = await fetch(
          `/api/schnellbestellung/status?order=${encodeURIComponent(orderId)}`,
          { credentials: "same-origin", cache: "no-store" },
        );
        const data = (await response.json().catch(() => ({}))) as StatusResponse;

        if (cancelled || endedRef.current) return;

        if (response.ok && data.ok && data.status) {
          setStatus(data.status);
          setStatusError(false);
          if (Number(data.customerNumber) > 0) {
            setCustomerNumber(String(data.customerNumber));
          }
          if (
            data.reward?.winId &&
            !rewardShownRef.current &&
            !hasDisplayedSchnellReward(orderId, data.reward)
          ) {
            setReward(data.reward);
          }

          if (data.status === "ready") {
            const readyEventId = String(data.readyEventId || "").trim();

            if (data.liveReadyAlertEnabled !== false) {
              if (readyEventId) {
                if (lastReadyEventRef.current !== readyEventId) {
                  lastReadyEventRef.current = readyEventId;
                  playReadyAlert(readyTimeoutIdsRef.current);
                }
              } else if (!legacyReadyActiveRef.current) {
                // Eski siparişlerde readyEventId yoksa status geçişini kullan.
                legacyReadyActiveRef.current = true;
                playReadyAlert(readyTimeoutIdsRef.current);
              }
            }
          } else {
            legacyReadyActiveRef.current = false;
          }
        } else if (response.status !== 401) {
          setStatusError(true);
        }
      } catch {
        if (!cancelled && !endedRef.current) setStatusError(true);
      } finally {
        if (!cancelled && !endedRef.current) {
          timer = window.setTimeout(poll, 2500);
        }
      }
    };

    void poll();

    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [ended, orderId]);

  const finish = useCallback(() => {
    endedRef.current = true;
    setEnded(true);
    setStatusError(false);
    clearSchnellActiveOrder(orderId);

    try {
      window.localStorage.removeItem("bb_schnell_pending_order");
      window.localStorage.removeItem("bb_schnell_cart");
    } catch {
      // The order marker was already cleared when storage is unavailable.
    }

    stopReadyAlert(readyTimeoutIdsRef.current);
    void releaseWakeLock();
  }, [orderId, releaseWakeLock]);

  if (ended) {
    return (
      <main className="grid min-h-dvh place-items-center bg-stone-950 p-6 text-white">
        <section className="w-full max-w-lg text-center">
          <div className="mx-auto grid h-24 w-24 place-items-center rounded-full border border-emerald-300/30 bg-emerald-400/10 text-5xl text-emerald-300">
            ✓
          </div>
          <h1 className="mt-7 text-3xl font-black text-emerald-300 sm:text-4xl">
            Bestellung abgeschlossen
          </h1>
          <p className="mx-auto mt-4 max-w-sm text-lg leading-7 text-stone-300">
            Sie können Burger Brothers jetzt schließen.
          </p>

          <div className="mx-auto mt-10 w-full max-w-sm rounded-3xl border border-white/10 bg-white/5 p-6">
            <div className="animate-bounce text-5xl text-amber-300">↑</div>
            <p className="mt-3 font-bold text-white">
              Vom unteren Bildschirmrand nach oben wischen
            </p>
            <p className="mt-2 text-sm leading-6 text-stone-400">
              Beim nächsten Besuch öffnen Sie Burger Brothers und scannen den
              QR-Code im Restaurant direkt in der App.
            </p>
          </div>
        </section>
      </main>
    );
  }

  const ready = status === "ready";
  const done = status === "done";
  const cancelled = status === "cancelled";
  const terminal = ready || done || cancelled;

  return (
    <>
      {rewardVisible && reward ? (
        <RewardCelebration
          orderId={orderId}
          customerNumber={customerNumber}
          reward={reward}
          onClose={() => {
            setRewardVisible(false);
            setReward(null);
            try {
              window.sessionStorage.removeItem(`bb_schnell_reward:${orderId}`);
            } catch {
              // Session storage temizliği best-effort.
            }
          }}
        />
      ) : null}
    <main
      className={`grid min-h-dvh place-items-center p-6 text-white transition-colors duration-500 ${
        ready || done
          ? "bg-emerald-950"
          : cancelled
            ? "bg-red-950"
            : "bg-stone-950"
      }`}
    >
      <section className="w-full max-w-lg text-center">
        <p
          className={`text-2xl font-black sm:text-3xl ${
            ready
              ? "animate-pulse text-emerald-300"
              : done
                ? "text-emerald-300"
                : cancelled
                  ? "text-red-300"
                  : "text-emerald-400"
          }`}
        >
          {ready
            ? "Ihre Bestellung ist fertig!"
            : done
              ? "Bestellung ausgegeben"
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
            : done
              ? "Ihre Bestellung wurde ausgegeben. Vielen Dank!"
              : cancelled
                ? "Bitte wenden Sie sich an unser Personal."
                : "Bitte lassen Sie diese Seite geöffnet. Wir melden uns, sobald Ihre Bestellung fertig ist."}
        </p>

        {!terminal ? (
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

        {terminal ? (
          <button
            type="button"
            onClick={finish}
            className="mt-10 w-full rounded-2xl bg-amber-400 px-5 py-4 text-lg font-black text-black"
          >
            Bestellung beenden
          </button>
        ) : null}
      </section>
    </main>
    </>
  );
}
