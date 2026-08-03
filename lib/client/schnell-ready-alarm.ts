"use client";

type AudioWindow = Window &
  typeof globalThis & {
    webkitAudioContext?: typeof AudioContext;
  };

let audioContext: AudioContext | null = null;
let repeatTimer: number | null = null;
let active = false;
let lastPatternAt = 0;
let removeGestureResume: (() => void) | null = null;

function getAudioContext() {
  if (typeof window === "undefined") return null;

  const audioWindow = window as AudioWindow;
  const AudioContextConstructor =
    window.AudioContext || audioWindow.webkitAudioContext;

  if (!AudioContextConstructor) return null;

  if (!audioContext || audioContext.state === "closed") {
    audioContext = new AudioContextConstructor();
  }

  return audioContext;
}

function scheduleTone(
  context: AudioContext,
  startsAt: number,
  frequency: number,
  duration: number,
) {
  const oscillator = context.createOscillator();
  const gain = context.createGain();

  oscillator.type = "square";
  oscillator.frequency.setValueAtTime(frequency, startsAt);
  gain.gain.setValueAtTime(0.0001, startsAt);
  gain.gain.exponentialRampToValueAtTime(0.18, startsAt + 0.025);
  gain.gain.exponentialRampToValueAtTime(
    0.0001,
    startsAt + Math.max(0.08, duration),
  );

  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start(startsAt);
  oscillator.stop(startsAt + duration + 0.03);
}

function playPattern(context: AudioContext) {
  const now = context.currentTime + 0.04;
  scheduleTone(context, now, 880, 0.18);
  scheduleTone(context, now + 0.28, 1040, 0.22);
  scheduleTone(context, now + 0.66, 880, 0.18);
  scheduleTone(context, now + 0.94, 1180, 0.34);
}

async function tryPlayPattern() {
  if (!active) return false;

  const context = getAudioContext();
  if (!context) return false;

  try {
    if (context.state === "suspended") {
      await context.resume();
    }
    if (context.state !== "running") return false;

    const now = Date.now();
    if (now - lastPatternAt < 900) return true;

    lastPatternAt = now;
    playPattern(context);
    return true;
  } catch {
    return false;
  }
}

function clearGestureResume() {
  removeGestureResume?.();
  removeGestureResume = null;
}

function installGestureResume() {
  if (typeof window === "undefined" || removeGestureResume) return;

  const resume = () => {
    void tryPlayPattern().then((played) => {
      if (played) clearGestureResume();
    });
  };

  window.addEventListener("pointerdown", resume, true);
  window.addEventListener("touchstart", resume, true);
  window.addEventListener("keydown", resume, true);

  removeGestureResume = () => {
    window.removeEventListener("pointerdown", resume, true);
    window.removeEventListener("touchstart", resume, true);
    window.removeEventListener("keydown", resume, true);
  };
}

export async function startSchnellReadyAlarm() {
  if (typeof window === "undefined") return;

  active = true;

  try {
    navigator.vibrate?.([650, 120, 650, 160, 1000]);
  } catch {
    // Vibration is best-effort.
  }

  if (repeatTimer === null) {
    repeatTimer = window.setInterval(() => {
      if (!active) return;
      try {
        navigator.vibrate?.([350, 100, 650]);
      } catch {
        // Vibration is best-effort.
      }
      void tryPlayPattern();
    }, 4_200);
  }

  const played = await tryPlayPattern();
  if (!played) installGestureResume();
}

export function stopSchnellReadyAlarm() {
  active = false;
  lastPatternAt = 0;

  if (repeatTimer !== null && typeof window !== "undefined") {
    window.clearInterval(repeatTimer);
  }
  repeatTimer = null;
  clearGestureResume();

  try {
    navigator.vibrate?.(0);
  } catch {
    // Vibration is best-effort.
  }

  if (audioContext?.state === "running") {
    void audioContext.suspend().catch(() => undefined);
  }
}