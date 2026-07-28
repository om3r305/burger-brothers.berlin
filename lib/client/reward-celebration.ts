"use client";

type RewardAudioWindow = Window &
  typeof globalThis & {
    __bbRewardAudioContext?: AudioContext;
    __bbRewardMedia?: HTMLAudioElement;
    __bbRewardPlaybackGeneration?: number;
  };

const REWARD_SOUND_URL = "/sounds/reward-celebration.wav";

function getRewardWindow() {
  return window as RewardAudioWindow;
}

function getRewardMedia() {
  const audioWindow = getRewardWindow();
  const media = audioWindow.__bbRewardMedia || new Audio(REWARD_SOUND_URL);
  media.preload = "auto";
  media.volume = 0.78;
  media.muted = false;
  media.setAttribute("playsinline", "true");
  audioWindow.__bbRewardMedia = media;
  return media;
}

function getRewardAudioContext() {
  const audioWindow = getRewardWindow();
  const AudioContextClass =
    window.AudioContext ||
    (window as typeof window & { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;

  if (!AudioContextClass) return null;

  const context = audioWindow.__bbRewardAudioContext || new AudioContextClass();
  audioWindow.__bbRewardAudioContext = context;
  return context;
}

function primeContextSilently(context: AudioContext) {
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  gain.gain.setValueAtTime(0.000001, context.currentTime);
  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start();
  oscillator.stop(context.currentTime + 0.025);
}

export function prewarmRewardCelebration() {
  try {
    // Dosyayı önceden indir, fakat sipariş sonucu gelmeden medya elemanını
    // oynatma. iPhone çok düşük ses seviyesini bile duyurabildiği için eski
    // sessiz-play yöntemi reddedilen siparişte yanlış kutlama sesi çıkarıyordu.
    getRewardMedia().load();

    const context = getRewardAudioContext();
    if (!context) return;

    const prime = () => {
      try {
        primeContextSilently(context);
      } catch {
        // Ses yalnız gerçek ödül geldiğinde best-effort çalışır.
      }
    };

    if (context.state === "suspended") {
      void context.resume().then(prime).catch(() => undefined);
    } else {
      prime();
    }
  } catch {
    // Görsel kutlama ses olmasa da devam eder.
  }
}

export function stopRewardCelebrationSound() {
  try {
    const audioWindow = getRewardWindow();
    audioWindow.__bbRewardPlaybackGeneration =
      Number(audioWindow.__bbRewardPlaybackGeneration || 0) + 1;

    const media = audioWindow.__bbRewardMedia;
    if (media) {
      media.pause();
      media.currentTime = 0;
    }
  } catch {
    // Cleanup best-effort.
  }
}

function playPleasantFallback(context: AudioContext) {
  const now = context.currentTime;
  const master = context.createGain();
  master.gain.setValueAtTime(0.0001, now);
  master.gain.exponentialRampToValueAtTime(0.2, now + 0.025);
  master.gain.exponentialRampToValueAtTime(0.0001, now + 2.8);
  master.connect(context.destination);

  const notes = [523.25, 659.25, 783.99, 1046.5, 1318.5];
  notes.forEach((frequency, index) => {
    const start = now + index * 0.2;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(frequency, start);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.72, start + 0.018);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.55);
    oscillator.connect(gain);
    gain.connect(master);
    oscillator.start(start);
    oscillator.stop(start + 0.58);
  });

  [523.25, 659.25, 783.99].forEach((frequency) => {
    const start = now + 1.15;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "triangle";
    oscillator.frequency.setValueAtTime(frequency, start);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.34, start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 1.15);
    oscillator.connect(gain);
    gain.connect(master);
    oscillator.start(start);
    oscillator.stop(start + 1.2);
  });
}

export function playRewardCelebrationSound(enabled = true) {
  if (!enabled) return;

  stopRewardCelebrationSound();

  const audioWindow = getRewardWindow();
  const playbackGeneration = Number(
    audioWindow.__bbRewardPlaybackGeneration || 0,
  );

  try {
    const media = getRewardMedia();
    media.currentTime = 0;
    media.volume = 0.78;
    media.muted = false;

    void media.play().catch(() => {
      if (
        Number(audioWindow.__bbRewardPlaybackGeneration || 0) !==
        playbackGeneration
      ) {
        return;
      }

      const context = getRewardAudioContext();
      if (!context) return;

      const fallback = () => {
        if (
          Number(audioWindow.__bbRewardPlaybackGeneration || 0) ===
          playbackGeneration
        ) {
          playPleasantFallback(context);
        }
      };

      if (context.state === "suspended") {
        void context.resume().then(fallback).catch(() => undefined);
      } else {
        fallback();
      }
    });
  } catch {
    try {
      if (
        Number(audioWindow.__bbRewardPlaybackGeneration || 0) !==
        playbackGeneration
      ) {
        return;
      }
      const context = getRewardAudioContext();
      if (context) playPleasantFallback(context);
    } catch {
      // Mobil tarayıcı sesi engellese bile kutlama görünür kalır.
    }
  }
}
