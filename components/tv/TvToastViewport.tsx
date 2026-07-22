"use client";

import clsx from "clsx";
import type { TvToastMessage } from "@/types/tv";

const TONE_CLASSES = {
  success: "border-emerald-400/50 bg-emerald-500/20 text-emerald-50",
  error: "border-rose-400/60 bg-rose-500/25 text-rose-50",
  warning: "border-amber-400/60 bg-amber-500/20 text-amber-50",
  info: "border-sky-400/50 bg-sky-500/20 text-sky-50",
} as const;

export function TvToastViewport({
  messages,
  onDismiss,
}: {
  messages: TvToastMessage[];
  onDismiss: (id: number) => void;
}) {
  if (!messages.length) return null;

  return (
    <div
      className="pointer-events-none fixed right-4 top-4 z-[100] flex w-[min(420px,calc(100vw-2rem))] flex-col gap-2"
      aria-live="polite"
      aria-atomic="false"
    >
      {messages.map((toast) => (
        <button
          key={toast.id}
          type="button"
          onClick={() => onDismiss(toast.id)}
          className={clsx(
            "pointer-events-auto rounded-2xl border px-4 py-3 text-left text-sm font-semibold shadow-2xl backdrop-blur-xl transition hover:brightness-110",
            TONE_CLASSES[toast.tone],
          )}
        >
          {toast.message}
        </button>
      ))}
    </div>
  );
}
