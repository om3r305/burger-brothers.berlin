"use client";

import { setPauseRemote, type PauseState } from "@/lib/pause";

function ToggleSwitch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onChange}
      aria-pressed={checked}
      className={`flex w-full items-center justify-between rounded-xl border px-3 py-2 transition ${
        checked ? "border-emerald-400/40 bg-emerald-500/10" : "border-white/10 bg-white/5"
      }`}
    >
      <span>{label}</span>

      <span
        className={`flex h-6 w-11 items-center overflow-hidden rounded-full p-0.5 transition ${
          checked ? "justify-end bg-emerald-400" : "justify-start bg-stone-600"
        }`}
      >
        <span className="h-5 w-5 rounded-full bg-white shadow" />
      </span>
    </button>
  );
}

export function PauseBlock({
  pause,
  setPause,
}: {
  pause: PauseState;
  setPause: (pause: PauseState) => void;
}) {
  const toggle = async (key: keyof PauseState) => {
    const nextLocal: PauseState = {
      ...pause,
      [key]: !pause[key],
    };

    setPause(nextLocal);

    try {
      const synced = await setPauseRemote(nextLocal);
      setPause(synced);
    } catch (error) {
      console.error("pause update failed", error);
      setPause(pause);
    }
  };

  return (
    <div className="space-y-2">
      <div className="text-xs uppercase tracking-wider text-stone-300/70">Pause</div>

      <ToggleSwitch
        checked={!!pause.delivery}
        onChange={() => toggle("delivery")}
        label="Lieferung pausieren"
      />

      <ToggleSwitch
        checked={!!pause.pickup}
        onChange={() => toggle("pickup")}
        label="Abholung pausieren"
      />
    </div>
  );
}
