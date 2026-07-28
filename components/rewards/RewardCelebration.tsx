"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import { playRewardCelebrationSound } from "@/lib/client/reward-celebration";
import type { SchnellRewardPublic } from "@/lib/rewards/config";

const RewardCamera = dynamic(() => import("./RewardCamera"), { ssr: false });

type Props = {
  orderId: string;
  customerNumber: string;
  reward: SchnellRewardPublic;
  onClose: () => void;
};

const CONFETTI = Array.from({ length: 36 }, (_, index) => ({
  id: index,
  left: `${(index * 37) % 100}%`,
  delay: `${(index % 9) * 0.08}s`,
  duration: `${1.8 + (index % 6) * 0.18}s`,
  rotate: `${(index * 47) % 360}deg`,
}));

export default function RewardCelebration({
  orderId,
  customerNumber,
  reward,
  onClose,
}: Props) {
  const [phase, setPhase] = useState<"celebrate" | "share" | "sent">("celebrate");
  const [displayName, setDisplayName] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    playRewardCelebrationSound(reward.celebrationSoundEnabled);
    const timer = window.setTimeout(
      () => setPhase(reward.photoMode === "off" ? "sent" : "share"),
      Math.max(3, reward.celebrationSeconds) * 1_000,
    );
    return () => window.clearTimeout(timer);
  }, [reward.celebrationSeconds, reward.celebrationSoundEnabled, reward.photoMode]);

  useEffect(() => {
    if (phase !== "sent" || reward.photoMode !== "off") return;
    const timer = window.setTimeout(onClose, 1_200);
    return () => window.clearTimeout(timer);
  }, [onClose, phase, reward.photoMode]);

  const photoAllowed = reward.photoMode === "name_photo";
  const canSubmit = useMemo(() => {
    if (!displayName.trim()) return false;
    if (!consent) return false;
    return true;
  }, [consent, displayName]);

  const submit = async () => {
    if (!canSubmit || busy) return;
    setBusy(true);
    setError("");
    try {
      const form = new FormData();
      form.set("orderId", orderId);
      form.set("displayName", displayName.trim());
      form.set("consent", String(consent));
      if (photo && photoAllowed) form.set("photo", photo);
      const response = await fetch("/api/schnellbestellung/reward/submission", {
        method: "POST",
        body: form,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data?.ok === false) {
        throw new Error(String(data?.error || "SUBMISSION_FAILED"));
      }
      setPhase("sent");
      window.setTimeout(onClose, 1_600);
    } catch (caught) {
      const code = caught instanceof Error ? caught.message : "SUBMISSION_FAILED";
      setError(
        code === "TEMP_PHOTO_STORAGE_NOT_CONFIGURED"
          ? "Fotoğraf yükleme şu anda hazır değil. Sadece adınla devam edebilirsin."
          : "Paylaşım gönderilemedi. Siparişin ve ödülün yine de geçerli.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[1600] overflow-y-auto bg-[radial-gradient(circle_at_top,#7c2d12_0%,#250a05_36%,#030303_78%)] px-4 py-6 text-white">
      {phase === "celebrate" ? (
        <>
          <div className="pointer-events-none fixed inset-0 overflow-hidden">
            {CONFETTI.map((piece) => (
              <span
                key={piece.id}
                className="absolute -top-8 h-4 w-2 animate-[bbRewardFall_linear_infinite] rounded-sm odd:bg-amber-300 even:bg-fuchsia-400 [&:nth-child(3n)]:bg-emerald-300 [&:nth-child(5n)]:bg-cyan-300"
                style={{
                  left: piece.left,
                  animationDelay: piece.delay,
                  animationDuration: piece.duration,
                  rotate: piece.rotate,
                }}
              />
            ))}
            <div className="absolute left-[8%] top-[14%] animate-ping text-6xl">✨</div>
            <div className="absolute right-[8%] top-[18%] animate-ping text-6xl [animation-delay:.4s]">🎆</div>
            <div className="absolute bottom-[15%] left-[15%] animate-bounce text-5xl">🍔</div>
            <div className="absolute bottom-[18%] right-[14%] animate-bounce text-5xl [animation-delay:.25s]">🍀</div>
          </div>

          <main className="relative mx-auto grid min-h-[calc(100dvh-3rem)] max-w-xl place-items-center text-center">
            <section className="w-full rounded-[2.25rem] border border-amber-300/40 bg-black/55 p-6 shadow-[0_0_70px_rgba(251,191,36,.28)] backdrop-blur-xl sm:p-9">
              <img
                src="/logo-burger-brothers.png"
                alt="Burger Brothers"
                className="mx-auto h-24 w-24 animate-[bbRewardPop_.65s_ease-out] rounded-full object-contain shadow-2xl"
              />
              <p className="mt-5 text-sm font-black uppercase tracking-[0.25em] text-amber-300">
                Bestellnummer {customerNumber}
              </p>
              <h1 className="mt-3 text-4xl font-black leading-tight sm:text-5xl">
                HERZLICHEN GLÜCKWUNSCH! 🎉
              </h1>
              <div className="mx-auto mt-6 rounded-3xl border border-emerald-300/30 bg-emerald-300/10 px-5 py-6">
                <p className="text-2xl font-black text-emerald-200 sm:text-3xl">
                  {reward.customerLabel}
                </p>
                <p className="mt-3 text-sm text-stone-300">
                  Dein Gewinn wurde direkt auf diese Bestellung angewendet.
                </p>
              </div>
              <button
                type="button"
                onClick={() =>
                  setPhase(reward.photoMode === "off" ? "sent" : "share")
                }
                className="mt-6 text-sm font-bold text-stone-300 underline"
              >
                Animation überspringen
              </button>
            </section>
          </main>
        </>
      ) : null}

      {phase === "share" ? (
        <main className="mx-auto flex min-h-[calc(100dvh-3rem)] max-w-xl items-center">
          <section className="w-full rounded-[2.25rem] border border-white/15 bg-black/65 p-5 shadow-2xl backdrop-blur-xl sm:p-8">
            <div className="text-center">
              <div className="text-5xl">🎉🍔🍀</div>
              <h2 className="mt-3 text-3xl font-black">Teile deinen Glücksmoment</h2>
              <p className="mt-2 text-sm leading-6 text-stone-300">
                Dein Gewinn bleibt auch ohne Namen oder Foto vollständig gültig.
              </p>
            </div>

            <label className="mt-6 block text-sm font-bold text-stone-200">
              Wie dürfen wir dich nennen?
              <input
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value.slice(0, 40))}
                placeholder="Vorname oder Spitzname"
                autoComplete="nickname"
                className="mt-2 w-full rounded-2xl border border-white/15 bg-white/10 px-4 py-4 text-lg font-bold text-white outline-none focus:border-amber-300"
              />
            </label>

            {photoAllowed ? (
              <div className="mt-5">
                <RewardCamera
                  onChange={(file) => {
                    setPhoto(file);
                    if (!file) setConsent(false);
                  }}
                />
              </div>
            ) : null}

            <label className="mt-4 flex items-start gap-3 rounded-2xl border border-white/10 bg-white/5 p-4 text-sm leading-6 text-stone-200">
              <input
                type="checkbox"
                checked={consent}
                onChange={(event) => setConsent(event.target.checked)}
                className="mt-1 h-5 w-5 shrink-0"
              />
              <span>
                {photo
                  ? `Ich bin damit einverstanden, dass mein Vorname und dieses Foto kurz auf dem Burger-Brothers-Bildschirm gezeigt werden. Das Foto wird nach der Anzeige oder spätestens nach ${reward.photoRetentionMinutes} Minuten automatisch gelöscht.`
                  : "Ich bin damit einverstanden, dass mein Vorname oder Spitzname kurz auf dem Burger-Brothers-Bildschirm gezeigt wird."}
              </span>
            </label>

            {error ? (
              <div className="mt-4 rounded-2xl border border-red-400/30 bg-red-500/10 p-3 text-sm text-red-100">
                {error}
              </div>
            ) : null}

            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-2xl border border-white/15 bg-white/10 px-5 py-4 font-black text-white"
              >
                Nein, danke
              </button>
              <button
                type="button"
                onClick={() => void submit()}
                disabled={!canSubmit || busy}
                className="rounded-2xl bg-amber-400 px-5 py-4 font-black text-black disabled:cursor-not-allowed disabled:opacity-40"
              >
                {busy ? "Wird gesendet …" : photo ? "Zur Freigabe senden" : "Auf dem Bildschirm zeigen"}
              </button>
            </div>
          </section>
        </main>
      ) : null}

      {phase === "sent" ? (
        <main className="mx-auto grid min-h-[calc(100dvh-3rem)] max-w-xl place-items-center text-center">
          <section className="w-full rounded-[2.25rem] border border-emerald-300/30 bg-black/65 p-8 shadow-2xl backdrop-blur-xl">
            <div className="text-7xl">✓</div>
            <h2 className="mt-4 text-3xl font-black text-emerald-200">
              Dein Glücksmoment ist gespeichert
            </h2>
            <p className="mt-3 text-stone-300">
              {photo
                ? "Das Foto wird zuerst von Burger Brothers geprüft."
                : "Vielen Dank und guten Appetit!"}
            </p>
          </section>
        </main>
      ) : null}
    </div>
  );
}
