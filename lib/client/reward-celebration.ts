"use client";

type RewardAudioWindow = Window &
  typeof globalThis & {
    __bbRewardAudioContext?: AudioContext;
  };

export function prewarmRewardCelebration() {
  try {
    const audioWindow = window as RewardAudioWindow;
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

export function playRewardCelebrationSound(enabled = true) {
  if (!enabled) return;
  try {
    const audioWindow = window as RewardAudioWindow;
    const context = audioWindow.__bbRewardAudioContext;
    if (!context) return;

    const play = () => {
      const master = context.createGain();
      master.gain.setValueAtTime(0.0001, context.currentTime);
      master.gain.exponentialRampToValueAtTime(0.28, context.currentTime + 0.03);
      master.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 3.1);
      master.connect(context.destination);

      const notes = [523, 659, 784, 1046, 1318, 1568];
      notes.forEach((frequency, index) => {
        const start = context.currentTime + index * 0.18;
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        oscillator.type = index % 2 ? "triangle" : "sine";
        oscillator.frequency.setValueAtTime(frequency, start);
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(0.85, start + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.34);
        oscillator.connect(gain);
        gain.connect(master);
        oscillator.start(start);
        oscillator.stop(start + 0.36);
      });

      [0.85, 1.45, 2.05].forEach((offset, burstIndex) => {
        for (let index = 0; index < 7; index += 1) {
          const start = context.currentTime + offset + index * 0.018;
          const oscillator = context.createOscillator();
          const gain = context.createGain();
          oscillator.type = "square";
          oscillator.frequency.setValueAtTime(700 + burstIndex * 180 + index * 90, start);
          gain.gain.setValueAtTime(0.22, start);
          gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.09);
          oscillator.connect(gain);
          gain.connect(master);
          oscillator.start(start);
          oscillator.stop(start + 0.1);
        }
      });
    };

    if (context.state === "suspended") {
      void context.resume().then(play).catch(() => undefined);
    } else {
      play();
    }
  } catch {
    // Mobil tarayıcı sesi engellese bile kutlama görünür kalır.
  }
}
