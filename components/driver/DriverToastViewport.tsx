"use client";

import type { DriverToastMessage } from "@/types/driver";

const toneClass: Record<DriverToastMessage["tone"], string> = {
  info: "border-sky-300/40 bg-sky-500/95 text-white",
  success: "border-emerald-300/45 bg-emerald-500/95 text-black",
  warning: "border-amber-300/45 bg-amber-400/95 text-black",
  error: "border-rose-300/45 bg-rose-600/95 text-white",
};

export function DriverToastViewport({
  messages,
  onDismiss,
}: {
  messages: DriverToastMessage[];
  onDismiss: (id: number) => void;
}) {
  if (!messages.length) return null;

  return (
    <div className="pointer-events-none fixed inset-x-3 top-[max(1rem,env(safe-area-inset-top))] z-[90] mx-auto flex max-w-md flex-col gap-2">
      {messages.map((message) => (
        <button
          key={message.id}
          type="button"
          onClick={() => onDismiss(message.id)}
          className={`pointer-events-auto whitespace-pre-line rounded-2xl border px-4 py-3 text-left text-sm font-semibold shadow-2xl ${toneClass[message.tone]}`}
        >
          {message.message}
        </button>
      ))}
    </div>
  );
}
