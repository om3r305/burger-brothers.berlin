"use client";

type RewardAudioWindow = Window &
  typeof globalThis & {
    __bbRewardAudioContext?: AudioContext;
    __bbRewardMedia?: HTMLAudioElement;
    __bbRewardMediaUnlocked?: boolean;
  };

const REWARD_SOUND_URL = "/sounds/reward-celebration.wav";

function getRewardMedia() {
  const audioWindow = window as RewardAudioWindow;
  const media = audioWindow.__bbRewardMedia || new Audio(REWARD_SOUND_URL);
  media.preload = "auto";
  media.volume = 0.78;
  media.muted = false;
  media.setAttribute("playsinline", "true");
  audioWindow.__bbRewardMedia = media;
  return media;
}

export function prewarmRewardCelebration() {
  try {
    const audioWindow = window as RewardAudioWindow;
    const media = getRewardMedia();
    media.load();

    // iOS/Safari sonraki sayfada sesi engellemesin diye sipariş butonuna
    // basıldığı kullanıcı hareketi içinde medya elemanını sessizce açıyoruz.
    if (!audioWindow.__bbRewardMediaUnlocked) {
      const previousVolume = media.volume;
      media.volume = 0.001;
      void media
        .play()
        .then(() => {
          media.pause();
          media.currentTime = 0;
          media.volume = previousVolume;
          audioWindow.__bbRewardMediaUnlocked = true;
        })
        .catch(() => {
          media.volume = previousVolume;
        });
    }

    const AudioContextClass =
      window.AudioContext ||
      (window as typeof window & { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AudioContextClass) return;
    const context = audioWindow.__bbRewardAudioContext || new AudioContextClass();
    audioWindow.__bbRewardAudioContext = context;
    if (context.state === "suspended") void context.resume().catch(() => undefined);
  } catch {
    // Görsel kutlama ses olmasa da devam eder.
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

  try {
    const media = getRewardMedia();
    media.pause();
    media.currentTime = 0;
    media.volume = 0.78;
    media.muted = false;
    void media.play().catch(() => {
      const audioWindow = window as RewardAudioWindow;
      const context = audioWindow.__bbRewardAudioContext;
      if (!context) return;
      if (context.state === "suspended") {
        void context.resume().then(() => playPleasantFallback(context)).catch(() => undefined);
      } else {
        playPleasantFallback(context);
      }
    });
  } catch {
    try {
      const context = (window as RewardAudioWindow).__bbRewardAudioContext;
      if (context) playPleasantFallback(context);
    } catch {
      // Mobil tarayıcı sesi engellese bile kutlama görünür kalır.
    }
  }
}
