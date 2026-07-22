"use client";

import type { CheckoutToast } from "@/types/checkout";

const toneClasses: Record<CheckoutToast["tone"], string> = {
  success: "border-emerald-400/50 bg-emerald-950/95 text-emerald-50",
  error: "border-rose-400/60 bg-rose-950/95 text-rose-50",
  warning: "border-amber-400/55 bg-amber-950/95 text-amber-50",
  info: "border-sky-400/50 bg-sky-950/95 text-sky-50",
};

export default function CheckoutToastViewport({
  toasts,
  onDismiss,
}: {
  toasts: CheckoutToast[];
  onDismiss: (id: string) => void;
}) {
  if (!toasts.length) return null;

  return (
    <div
      className="fixed inset-x-3 bottom-[max(1rem,env(safe-area-inset-bottom))] z-[130] mx-auto flex max-w-lg flex-col gap-2"
      role="region"
      aria-label="Checkout-Meldungen"
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          role={toast.tone === "error" ? "alert" : "status"}
          className={`flex items-start justify-between gap-3 rounded-2xl border px-4 py-3 text-sm shadow-2xl backdrop-blur ${toneClasses[toast.tone]}`}
        >
          <span className="leading-relaxed">{toast.message}</span>
          <button
            type="button"
            onClick={() => onDismiss(toast.id)}
            className="shrink-0 rounded-lg px-2 py-1 text-lg leading-none text-white/80 hover:bg-white/10 hover:text-white"
            aria-label="Meldung schließen"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
