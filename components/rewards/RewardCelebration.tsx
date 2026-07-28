"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import {
  playRewardCelebrationSound,
  stopRewardCelebrationSound,
} from "@/lib/client/reward-celebration";
import type { SchnellRewardPublic } from "@/lib/rewards/config";

const RewardCamera = dynamic(() => import("./RewardCamera"), { ssr: false });

type Props = {
  orderId: string;
  customerNumber: string;
  reward: SchnellRewardPublic;
  onClose: () => void;
};

type SubmitResult = {
  showcaseQueued: boolean;
  photoPending: boolean;
};

const CONFETTI = Array.from({ length: 56 }, (_, index) => ({
  id: index,
  left: `${(index * 37) % 100}%`,
  delay: `${(index % 12) * 0.06}s`,
  duration: `${1.9 + (index % 7) * 0.17}s`,
  rotate: `${(index * 47) % 360}deg`,
}));

const FIREWORKS = [
  { left: "12%", top: "16%", delay: "0s" },
  { left: "82%", top: "19%", delay: ".45s" },
  { left: "22%", top: "68%", delay: ".85s" },
  { left: "78%", top: "66%", delay: "1.15s" },
];

export default function RewardCelebration({
  orderId,
  customerNumber,
  reward,
  onClose,
}: Props) {
  const [phase, setPhase] = useState<"celebrate" | "share" | "sent">("celebrate");
  const [displayName, setDisplayName] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoDraft, setPhotoDraft] = useState(false);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<SubmitResult | null>(null);

  const celebrationSeconds = Math.max(5, Math.min(12, reward.celebrationSeconds || 7));

  useEffect(() => {
    playRewardCelebrationSound(reward.celebrationSoundEnabled);
    const timer = window.setTimeout(() => {
      stopRewardCelebrationSound();
      setPhase(reward.photoMode === "off" ? "sent" : "share");
    }, celebrationSeconds * 1_000);

    return () => {
      window.clearTimeout(timer);
      stopRewardCelebrationSound();
    };
  }, [celebrationSeconds, reward.celebrationSoundEnabled, reward.photoMode]);

  useEffect(() => {
    if (phase !== "sent" || reward.photoMode !== "off") return;
    const timer = window.setTimeout(onClose, 2_200);
    return () => window.clearTimeout(timer);
  }, [onClose, phase, reward.photoMode]);

  const photoAllowed = reward.photoMode === "name_photo";
  const canSubmit = useMemo(
    () => Boolean(displayName.trim() && consent && !photoDraft),
    [consent, displayName, photoDraft],
  );

  const submit = async (withoutPhoto = false) => {
    if (!canSubmit || busy) return;
    setBusy(true);
    setError("");

    try {
      const form = new FormData();
      form.set("orderId", orderId);
      form.set("displayName", displayName.trim());
      form.set("consent", String(consent));
      const expectsPhoto = Boolean(!withoutPhoto && photo && photoAllowed);
      form.set("expectsPhoto", String(expectsPhoto));
      if (expectsPhoto && photo) form.set("photo", photo);

      const response = await fetch("/api/schnellbestellung/reward/submission", {
        method: "POST",
        body: form,
        credentials: "same-origin",
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data?.ok === false) {
        const code = String(data?.error || "SUBMISSION_FAILED");
        const retryAfterSeconds = Math.max(
          0,
          Number(data?.retryAfterSeconds) ||
            Number(response.headers.get("Retry-After")) ||
            0,
        );
        throw new Error(
          retryAfterSeconds > 0 ? `${code}:${retryAfterSeconds}` : code,
        );
      }

      if (!withoutPhoto && photo && data?.photoPending !== true) {
        throw new Error("photo_not_received");
      }

      setResult({
        showcaseQueued: data?.showcaseQueued === true,
        photoPending: data?.photoPending === true,
      });
      setPhase("sent");
      window.setTimeout(onClose, 2_800);
    } catch (caught) {
      const rawCode =
        caught instanceof Error ? caught.message : "SUBMISSION_FAILED";
      const [code, retryText] = rawCode.split(":");
      const retryAfterSeconds = Math.max(0, Number(retryText) || 0);
      const messages: Record<string, string> = {
        session_expired: "Deine Schnellbestellung-Sitzung ist abgelaufen. Dein Gewinn bleibt trotzdem gültig.",
        reward_forbidden: "Dieser Gewinn gehört nicht zu dieser Sitzung. Bitte wende dich an unser Personal.",
        reward_not_found: "Der Gewinn konnte nicht mehr gefunden werden. Bitte wende dich an unser Personal.",
        display_consent_required: "Bitte bestätige zuerst die kurze Anzeige auf dem Burger-Brothers-Bildschirm.",
        name_and_order_required: "Bitte gib zuerst deinen Vornamen oder Spitznamen ein.",
        sharing_disabled: "Die Bildschirmfreigabe ist für diesen Gewinn gerade deaktiviert.",
        origin_not_allowed: "Die Anfrage konnte aus Sicherheitsgründen nicht gesendet werden. Bitte öffne die Schnellbestellung erneut.",
        unauthorized: "Die Bildschirmfreigabe war technisch noch nicht für die Schnellbestellung freigeschaltet. Bitte versuche es nach der Aktualisierung erneut.",
        invalid_form: "Die Angaben konnten nicht gelesen werden. Bitte versuche es noch einmal.",
        photo_too_large: "Das Foto ist zu groß. Bitte nimm ein neues Foto auf.",
        photo_type_not_allowed: "Dieses Fotoformat wird nicht unterstützt.",
        photo_missing: "Das bestätigte Foto ist beim Senden nicht angekommen. Bitte wähle das Foto erneut aus.",
        photo_not_received: "Der Server hat das Foto nicht bestätigt. Es wurde nicht versehentlich nur dein Name veröffentlicht.",
        submission_already_name_only: "Dieser Glücksmoment wurde bereits nur mit deinem Namen veröffentlicht. Für ein Foto ist ein neuer Gewinn erforderlich.",
        TEMP_PHOTO_STORAGE_NOT_CONFIGURED: "Der Foto-Upload ist gerade nicht verfügbar. Du kannst deinen Namen ohne Foto senden.",
      };
      setError(
        code === "rate_limited"
          ? `Zu viele schnelle Versuche. Bitte warte ${Math.max(1, retryAfterSeconds)} Sekunden und versuche es erneut.`
          : messages[code] ||
              `Dein Glücksmoment konnte gerade nicht gesendet werden. Dein Gewinn und deine Bestellung bleiben vollständig gültig. (Code: ${code})`,
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[1600] overflow-y-auto bg-[radial-gradient(circle_at_top,#b45309_0%,#7c2d12_22%,#240704_55%,#020202_100%)] px-4 py-5 text-white">
      {phase === "celebrate" ? (
        <>
          <div className="pointer-events-none fixed inset-0 overflow-hidden">
            <div className="absolute inset-0 animate-[bbRewardGlow_1.8s_ease-in-out_infinite] bg-[radial-gradient(circle_at_center,rgba(251,191,36,.18),transparent_58%)]" />
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
            {FIREWORKS.map((firework, index) => (
              <span
                key={index}
                className="absolute h-20 w-20 -translate-x-1/2 -translate-y-1/2 animate-[bbRewardFirework_1.5s_ease-out_infinite] rounded-full border-4 border-amber-200/80 shadow-[0_0_35px_rgba(251,191,36,.9)]"
                style={{ left: firework.left, top: firework.top, animationDelay: firework.delay }}
              />
            ))}
            <div className="absolute bottom-[10%] left-[10%] animate-bounce text-6xl">🍔</div>
            <div className="absolute bottom-[12%] right-[10%] animate-bounce text-6xl [animation-delay:.25s]">🍀</div>
          </div>

          <main className="relative mx-auto grid min-h-[calc(100dvh-2.5rem)] max-w-xl place-items-center text-center">
            <section className="w-full overflow-hidden rounded-[2.5rem] border border-amber-200/50 bg-black/60 p-6 shadow-[0_0_90px_rgba(251,191,36,.38)] backdrop-blur-xl sm:p-9">
              <div className="mx-auto grid h-24 w-24 place-items-center rounded-full border-4 border-amber-300/60 bg-gradient-to-br from-amber-300 to-orange-600 shadow-[0_0_45px_rgba(251,191,36,.65)]">
                <img
                  src="/logo-burger-brothers.png"
                  alt="Burger Brothers"
                  className="h-20 w-20 animate-[bbRewardPop_.65s_ease-out] rounded-full object-contain"
                />
              </div>
              <p className="mt-5 text-sm font-black uppercase tracking-[0.28em] text-amber-300">
                Bestellnummer {customerNumber}
              </p>
              <h1 className="mt-3 text-4xl font-black leading-[.95] sm:text-6xl">
                DU HAST
                <span className="mt-1 block bg-gradient-to-r from-amber-200 via-yellow-300 to-orange-400 bg-clip-text text-transparent">
                  GEWONNEN!
                </span>
              </h1>
              <div className="mx-auto mt-6 animate-[bbRewardPrize_1.25s_ease-in-out_infinite] rounded-[2rem] border-2 border-emerald-200/45 bg-gradient-to-br from-emerald-300/20 to-cyan-300/10 px-5 py-7 shadow-[0_0_45px_rgba(110,231,183,.22)]">
                <p className="text-3xl font-black leading-tight text-emerald-100 sm:text-4xl">
                  🎁 {reward.customerLabel}
                </p>
                <p className="mt-3 text-sm font-bold text-white/75">
                  Der Gewinn wurde direkt auf deine Bestellung angewendet.
                </p>
              </div>

              <div className="mt-6 h-1.5 overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full origin-left animate-[bbRewardCountdown_linear_forwards] rounded-full bg-gradient-to-r from-amber-300 to-emerald-300"
                  style={{ animationDuration: `${celebrationSeconds}s` }}
                />
              </div>

              <button
                type="button"
                onClick={() => {
                  stopRewardCelebrationSound();
                  setPhase(reward.photoMode === "off" ? "sent" : "share");
                }}
                className="mt-5 rounded-full border border-white/15 bg-white/5 px-5 py-2 text-sm font-bold text-white/80"
              >
                Weiter
              </button>
            </section>
          </main>
        </>
      ) : null}

      {phase === "share" ? (
        <main className="mx-auto flex min-h-[calc(100dvh-2.5rem)] max-w-xl items-center">
          <section className="w-full rounded-[2.25rem] border border-white/15 bg-black/70 p-5 shadow-2xl backdrop-blur-xl sm:p-8">
            <div className="text-center">
              <div className="text-5xl">🎉🍔🍀</div>
              <h2 className="mt-3 text-3xl font-black">Teile deinen Glücksmoment</h2>
              <div className="mx-auto mt-4 rounded-2xl border border-emerald-300/25 bg-emerald-300/10 px-4 py-3 text-sm font-black text-emerald-100">
                🎁 {reward.customerLabel}
              </div>
              <p className="mt-3 text-sm leading-6 text-stone-300">
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
                  }}
                  onDraftChange={setPhotoDraft}
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
                  ? `Ich bin damit einverstanden, dass mein Vorname und dieses Foto kurz auf den Burger-Brothers-Bildschirmen gezeigt werden. Das Foto wird nach der Anzeige oder spätestens nach ${reward.photoRetentionMinutes} Minuten automatisch gelöscht.`
                  : photoDraft
                    ? "Bitte bestätige zuerst mit „Foto verwenden“, welches Foto gesendet werden soll."
                    : "Ich bin damit einverstanden, dass mein Vorname oder Spitzname kurz auf den Burger-Brothers-Bildschirmen gezeigt wird."}
              </span>
            </label>

            {error ? (
              <div className="mt-4 rounded-2xl border border-red-400/30 bg-red-500/10 p-3 text-sm leading-6 text-red-100">
                {error}
                {photo ? (
                  <button
                    type="button"
                    disabled={busy || !canSubmit}
                    onClick={() => void submit(true)}
                    className="mt-3 block font-black text-amber-200 underline"
                  >
                    Ohne Foto senden
                  </button>
                ) : null}
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
                onClick={() => void submit(false)}
                disabled={!canSubmit || busy}
                className="rounded-2xl bg-amber-400 px-5 py-4 font-black text-black disabled:cursor-not-allowed disabled:opacity-40"
              >
                {busy
                  ? "Wird gesendet …"
                  : photoDraft
                    ? "Zuerst Foto verwenden"
                    : photo
                      ? "Foto zur Freigabe senden"
                      : "Auf den Bildschirmen zeigen"}
              </button>
            </div>
          </section>
        </main>
      ) : null}

      {phase === "sent" ? (
        <main className="mx-auto grid min-h-[calc(100dvh-2.5rem)] max-w-xl place-items-center text-center">
          <section className="w-full rounded-[2.25rem] border border-emerald-300/30 bg-black/70 p-8 shadow-2xl backdrop-blur-xl">
            <div className="text-7xl">✓</div>
            <h2 className="mt-4 text-3xl font-black text-emerald-200">
              Dein Glücksmoment ist gespeichert
            </h2>
            <p className="mt-3 leading-7 text-stone-300">
              {result?.photoPending
                ? "Dein Foto wird kurz von Burger Brothers geprüft."
                : result?.showcaseQueued
                  ? "Dein Name erscheint gleich auf den aktiven Burger-Brothers-Bildschirmen."
                  : reward.photoMode === "off"
                    ? "Vielen Dank und guten Appetit!"
                    : "Dein Eintrag wurde gespeichert und wird geprüft."}
            </p>
          </section>
        </main>
      ) : null}
    </div>
  );
}
