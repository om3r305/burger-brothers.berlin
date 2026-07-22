"use client";

import type { ChangeEvent } from "react";
import {
  getSoundButtonLabel,
  getSoundButtonTitle,
} from "@/lib/tv/domain";

export function TvSoundControls({
  enabled,
  unlocked,
  volume,
  error,
  onToggle,
  onVolume,
  onTestDelivery,
  onTestPickup,
}: {
  enabled: boolean;
  unlocked: boolean;
  volume: number;
  error: string;
  onToggle: () => void | Promise<void>;
  onVolume: (volume: number) => void;
  onTestDelivery: () => void | Promise<void>;
  onTestPickup: () => void | Promise<void>;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-white/10 bg-black/15 px-2 py-2 text-xs">
      <button
        type="button"
        onClick={onToggle}
        className={`rounded-full border px-3 py-1 font-semibold transition ${
          enabled
            ? unlocked
              ? "border-emerald-400/50 bg-emerald-500/15 text-emerald-100 hover:bg-emerald-500/25"
              : "border-amber-400/50 bg-amber-500/15 text-amber-100 hover:bg-amber-500/25"
            : "border-white/10 bg-white/5 text-stone-300 hover:bg-white/10"
        }`}
        title={getSoundButtonTitle(enabled, unlocked)}
      >
        {getSoundButtonLabel(enabled, unlocked)}
      </button>

      <label className="flex items-center gap-2 text-stone-300">
        <span className="hidden sm:inline">Lautstärke</span>
        <input
          type="range"
          min={0}
          max={100}
          step={5}
          value={volume}
          onChange={(event: ChangeEvent<HTMLInputElement>) => onVolume(Number(event.target.value))}
          className="h-1 w-20 accent-emerald-400"
          aria-label="Ton-Lautstärke"
        />
        <span className="w-8 text-right tabular-nums">{volume}%</span>
      </label>

      <button
        type="button"
        onClick={onTestDelivery}
        className="rounded-full border border-orange-400/40 bg-orange-500/10 px-2 py-1 text-orange-100 hover:bg-orange-500/20"
        title="Lieferungston testen"
      >
        L
      </button>

      <button
        type="button"
        onClick={onTestPickup}
        className="rounded-full border border-cyan-400/40 bg-cyan-500/10 px-2 py-1 text-cyan-100 hover:bg-cyan-500/20"
        title="Abholton testen"
      >
        A
      </button>

      {error ? (
        <span className="max-w-[260px] truncate text-amber-300" title={error}>
          {error}
        </span>
      ) : null}
    </div>
  );
}
