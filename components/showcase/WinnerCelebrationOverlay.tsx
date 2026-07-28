"use client";

import { useEffect } from "react";
import { playRewardCelebrationSound, prewarmRewardCelebration } from "@/lib/client/reward-celebration";

export type ShowcaseWinnerEvent = {
  id: string;
  ackToken: string;
  expiresAt: string;
  eventType: string;
  payload: {
    displayName?: string;
    rewardLabel?: string;
    customerNumber?: number;
    photoUrl?: string | null;
    durationSeconds?: number;
    soundEnabled?: boolean;
    headline?: string;
    message?: string;
  };
};

const PARTICLES = Array.from({ length: 44 }, (_, index) => index);

export default function WinnerCelebrationOverlay({ event }: { event: ShowcaseWinnerEvent }) {
  useEffect(() => {
    prewarmRewardCelebration();
    playRewardCelebrationSound(event.payload.soundEnabled !== false);
  }, [event.id, event.payload.soundEnabled]);

  const name = String(event.payload.displayName || "Glückspilz").trim();
  const reward = String(event.payload.rewardLabel || "einen Glücksgewinn").trim();
  const headline = String(event.payload.headline || `${name} hat gewonnen!`).trim();

  return (
    <div className="fixed inset-0 z-[2400] overflow-hidden bg-[radial-gradient(circle_at_center,#9a3412_0%,#3b0b07_42%,#020202_82%)] text-white">
      <div className="pointer-events-none absolute inset-0">
        {PARTICLES.map((index) => (
          <span
            key={index}
            className="absolute -top-10 h-5 w-2 animate-[bbRewardFall_linear_infinite] rounded-sm bg-amber-300 odd:bg-fuchsia-400 [&:nth-child(3n)]:bg-emerald-300 [&:nth-child(5n)]:bg-cyan-300"
            style={{
              left: `${(index * 29) % 100}%`,
              animationDelay: `${(index % 11) * 0.08}s`,
              animationDuration: `${2.2 + (index % 8) * 0.2}s`,
            }}
          />
        ))}
        <div className="absolute left-[8%] top-[12%] animate-ping text-[7vw]">🎆</div>
        <div className="absolute right-[8%] top-[14%] animate-ping text-[7vw] [animation-delay:.35s]">🎇</div>
        <div className="absolute bottom-[9%] left-[7%] animate-bounce text-[7vw]">🍔</div>
        <div className="absolute bottom-[9%] right-[7%] animate-bounce text-[7vw] [animation-delay:.3s]">🍀</div>
      </div>

      <main className="relative grid h-full place-items-center p-[4vw] text-center">
        <section className="flex max-h-full w-full max-w-[1500px] flex-col items-center rounded-[4vw] border border-amber-300/40 bg-black/45 p-[3vw] shadow-[0_0_100px_rgba(251,191,36,.32)] backdrop-blur-xl">
          <img
            src="/logo-burger-brothers.png"
            alt="Burger Brothers"
            className="h-[clamp(90px,12vh,180px)] w-[clamp(90px,12vh,180px)] animate-[bbRewardPop_.65s_ease-out] rounded-full object-contain"
          />
          <div className="mt-[2vh] text-[clamp(16px,2vw,34px)] font-black uppercase tracking-[.22em] text-amber-300">
            Burger Brothers Glücksmoment
          </div>
          <h1 className="mt-[1.5vh] text-[clamp(42px,7vw,120px)] font-black leading-[.96]">
            {headline.toLocaleUpperCase("de-DE")}
          </h1>

          <div className={`mt-[3vh] grid w-full items-center gap-[3vw] ${event.payload.photoUrl ? "grid-cols-[minmax(180px,.65fr)_1.35fr]" : "grid-cols-1"}`}>
            {event.payload.photoUrl ? (
              <div className="mx-auto aspect-square w-[min(42vh,34vw)] overflow-hidden rounded-[3vw] border-[.5vw] border-white/80 bg-black shadow-2xl">
                <img src={event.payload.photoUrl} alt={name} className="h-full w-full object-cover" />
              </div>
            ) : null}
            <div className="rounded-[3vw] border border-emerald-300/35 bg-emerald-300/10 px-[3vw] py-[3vh]">
              <div className="text-[clamp(30px,5vw,84px)] font-black leading-tight text-emerald-100">
                {reward}
              </div>
              {Number(event.payload.customerNumber) > 0 ? (
                <div className="mt-[2vh] text-[clamp(18px,2.4vw,42px)] font-bold text-white/85">
                  Bestellnummer {event.payload.customerNumber}
                </div>
              ) : null}
            </div>
          </div>

          <p className="mt-[2.5vh] text-[clamp(18px,2.3vw,40px)] font-bold text-white/85">
            {event.payload.message || "Viel Glück & guten Appetit!"} 🍀
          </p>
        </section>
      </main>
    </div>
  );
}
