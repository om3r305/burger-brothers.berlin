"use client";

import { useEffect } from "react";
import BurgerAssistantCore from "./BurgerAssistantCore";

function isIOSWebKit() {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  return /iPad|iPhone|iPod/i.test(ua) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

type MeterlessContext = {
  createAnalyser: () => {
    fftSize: number;
    readonly frequencyBinCount: number;
    getByteFrequencyData: (data: Uint8Array) => void;
  };
  createMediaStreamSource: (stream: MediaStream) => {
    connect: (target: unknown) => unknown;
    disconnect: () => void;
  };
  close: () => Promise<void>;
};

function createMeterlessContext(): MeterlessContext {
  const analyser = {
    fftSize: 256,
    get frequencyBinCount() {
      return Math.max(1, Math.floor(this.fftSize / 2));
    },
    getByteFrequencyData(data: Uint8Array) {
      data.fill(0);
    },
  };

  return {
    createAnalyser: () => analyser,
    createMediaStreamSource: () => ({
      connect: (target: unknown) => target,
      disconnect: () => {},
    }),
    close: async () => {},
  };
}

/**
 * iOS WebKit compatibility shell around the existing assistant.
 *
 * The core voice component previously created both a detached `new Audio()`
 * element and a second AudioContext only for the decorative microphone meter.
 * On iPhone, that combination can disturb the WebRTC audio session even while
 * the Realtime transcript continues normally. This shell keeps the generated
 * remote audio element attached to the DOM and avoids opening the decorative
 * meter AudioContext while the Burger Brothers voice dialog is active.
 */
export default function BurgerAssistant() {
  useEffect(() => {
    if (!isIOSWebKit()) return;

    const NativeAudio = window.Audio;
    const NativeAudioContext = window.AudioContext;
    const attached = new Set<HTMLAudioElement>();

    const assistantDialogOpen = () =>
      Boolean(document.querySelector('[role="dialog"][aria-label="Burger Brothers AI"]'));

    function PatchedAudio(this: unknown, src?: string) {
      const audio = new NativeAudio(src);
      if (!assistantDialogOpen()) return audio;

      audio.dataset.bbRealtimeAudio = "1";
      audio.autoplay = true;
      audio.setAttribute("playsinline", "");
      Object.assign(audio.style, {
        position: "fixed",
        left: "-10000px",
        top: "0",
        width: "1px",
        height: "1px",
        opacity: "0",
        pointerEvents: "none",
      });
      document.body.appendChild(audio);
      attached.add(audio);

      let resumeTimer: number | null = null;
      const scheduleResume = () => {
        if (resumeTimer != null) window.clearTimeout(resumeTimer);
        resumeTimer = window.setTimeout(() => {
          resumeTimer = null;
          if (!audio.srcObject || !audio.paused) return;
          void audio.play().catch((error) => {
            console.warn("[assistant/realtime/ios] audio resume failed", error);
          });
        }, 120);
      };

      audio.addEventListener("pause", () => {
        if (audio.srcObject) {
          console.warn("[assistant/realtime/ios] remote audio paused; retrying");
          scheduleResume();
        }
      });
      audio.addEventListener("waiting", () => {
        console.warn("[assistant/realtime/ios] remote audio waiting");
      });
      audio.addEventListener("stalled", () => {
        console.warn("[assistant/realtime/ios] remote audio stalled");
      });
      audio.addEventListener("error", () => {
        console.error("[assistant/realtime/ios] remote audio error", audio.error?.code);
      });

      return audio;
    }

    Object.setPrototypeOf(PatchedAudio, NativeAudio);
    PatchedAudio.prototype = NativeAudio.prototype;
    window.Audio = PatchedAudio as unknown as typeof Audio;

    if (NativeAudioContext) {
      function PatchedAudioContext(this: unknown, ...args: ConstructorParameters<typeof AudioContext>) {
        // The core's JavaScript AudioContext is only used for the decorative
        // mic meter. WebRTC itself does not depend on this constructor.
        if (assistantDialogOpen()) {
          return createMeterlessContext() as unknown as AudioContext;
        }
        return Reflect.construct(NativeAudioContext, args);
      }
      Object.setPrototypeOf(PatchedAudioContext, NativeAudioContext);
      PatchedAudioContext.prototype = NativeAudioContext.prototype;
      window.AudioContext = PatchedAudioContext as unknown as typeof AudioContext;
    }

    return () => {
      window.Audio = NativeAudio;
      if (NativeAudioContext) window.AudioContext = NativeAudioContext;
      for (const audio of attached) {
        try {
          audio.pause();
          audio.srcObject = null;
          audio.remove();
        } catch {}
      }
      attached.clear();
    };
  }, []);

  return <BurgerAssistantCore />;
}
