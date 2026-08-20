"use client";

import { useEffect, useRef, useState } from "react";
import { readSettings } from "@/lib/settings";
import BurgerAssistantCore from "./BurgerAssistantCore";

type AiControls = {
  assistantEnabled: boolean;
  voiceEnabled: boolean;
};

const DEFAULT_CONTROLS: AiControls = {
  assistantEnabled: true,
  voiceEnabled: true,
};

function readAiControls(value: any): AiControls {
  const ai = value?.features?.ai;
  return {
    assistantEnabled:
      typeof ai?.assistantEnabled === "boolean"
        ? ai.assistantEnabled
        : DEFAULT_CONTROLS.assistantEnabled,
    voiceEnabled:
      typeof ai?.voiceEnabled === "boolean"
        ? ai.voiceEnabled
        : DEFAULT_CONTROLS.voiceEnabled,
  };
}

function isIOSWebKit() {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  return /iPad|iPhone|iPod/i.test(ua) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function isVoiceTrigger(button: HTMLButtonElement | null) {
  if (!button) return false;
  return (
    button.textContent?.trim() === "Sprechen" ||
    button.getAttribute("aria-label") === "Sprachchat starten"
  );
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
 * Customer-side feature gate around the assistant.
 *
 * Admin settings can independently disable the complete assistant or only the
 * Realtime voice entry. Missing legacy settings intentionally default to ON so
 * existing deployments keep their current behavior until the admin changes it.
 */
export default function BurgerAssistant() {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [controls, setControls] = useState<AiControls | null>(null);

  useEffect(() => {
    let stopped = false;

    const apply = (value: any) => {
      if (!stopped) setControls(readAiControls(value));
    };

    const sync = async () => {
      try {
        const response = await fetch(`/api/settings?fresh=1&ts=${Date.now()}`, {
          method: "GET",
          credentials: "same-origin",
          cache: "no-store",
          headers: { accept: "application/json" },
        });
        const json = await response.json().catch(() => ({}));
        if (!response.ok || json?.ok === false) throw new Error("SETTINGS_FETCH_FAILED");
        apply(json);
      } catch {
        apply(readSettings());
      }
    };

    const onSettingsChanged = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      apply(detail || readSettings());
    };

    const onStorage = (event: StorageEvent) => {
      if (event.key && event.key !== "bb_settings_v6") return;
      if (event.newValue) {
        try {
          apply(JSON.parse(event.newValue));
          return;
        } catch {}
      }
      apply(readSettings());
    };

    const onFocus = () => void sync();
    const onVisibility = () => {
      if (document.visibilityState === "visible") void sync();
    };

    void sync();
    window.addEventListener("bb_settings_changed", onSettingsChanged as EventListener);
    window.addEventListener("bb:settings-sync", onSettingsChanged as EventListener);
    window.addEventListener("storage", onStorage);
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      stopped = true;
      window.removeEventListener("bb_settings_changed", onSettingsChanged as EventListener);
      window.removeEventListener("bb:settings-sync", onSettingsChanged as EventListener);
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  const assistantEnabled = controls?.assistantEnabled === true;
  const voiceEnabled = controls?.voiceEnabled === true;

  useEffect(() => {
    if (!assistantEnabled) return;

    const root = hostRef.current;
    if (!root) return;

    const applyVoiceVisibility = () => {
      for (const button of Array.from(root.querySelectorAll("button"))) {
        if (!isVoiceTrigger(button)) continue;

        button.hidden = !voiceEnabled;
        button.disabled = !voiceEnabled;
        button.setAttribute("aria-hidden", voiceEnabled ? "false" : "true");
        button.setAttribute("aria-disabled", voiceEnabled ? "false" : "true");
        button.tabIndex = voiceEnabled ? 0 : -1;
        button.style.display = voiceEnabled ? "" : "none";
      }
    };

    applyVoiceVisibility();
    const observer = new MutationObserver(applyVoiceVisibility);
    observer.observe(root, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [assistantEnabled, voiceEnabled]);

  useEffect(() => {
    if (!assistantEnabled || !voiceEnabled || !isIOSWebKit()) return;

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
  }, [assistantEnabled, voiceEnabled]);

  // Do not flash the floating LED while the authoritative public setting is
  // still loading. Master OFF means the complete customer assistant disappears.
  if (!controls || !assistantEnabled) return null;

  return (
    <div
      ref={hostRef}
      data-bb-assistant="1"
      data-bb-assistant-voice={voiceEnabled ? "on" : "off"}
      onClickCapture={(event) => {
        if (voiceEnabled) return;
        const button = (event.target as HTMLElement | null)?.closest("button");
        if (!isVoiceTrigger(button)) return;
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      <BurgerAssistantCore key={voiceEnabled ? "voice-on" : "voice-off"} />
    </div>
  );
}
